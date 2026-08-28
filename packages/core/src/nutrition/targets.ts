import { dailyEnergyDeltaForRate, estimateMaintenanceKcal } from './energy.js';
import { roundTo } from './nutrients.js';
import {
  ABSOLUTE_FLOOR_KCAL,
  clampRateKgPerWeek,
  energyFloorKcal,
  KCAL_PER_KG_BODY_MASS,
  MAX_DEFICIT_FRACTION_OF_TDEE,
  MAX_SURPLUS_FRACTION_OF_TDEE,
  type SafetyAdjustment,
} from './safety.js';
import {
  KCAL_PER_GRAM,
  type ActivityLevel,
  type BiologicalSex,
  type Goal,
  type MacroTargetValues,
} from './types.js';

/**
 * Macro targets.
 *
 * All of this is free because it costs nothing: four numbers the user typed,
 * one regression equation, and arithmetic. Custom macros, per-day targets and
 * the micronutrient view are behind a paywall in the paid apps not because they
 * are expensive but because they are the things people will pay for. They are
 * unpaywalled here for the same reason (ADR-0001 rule 6).
 */

/**
 * Protein, in grams per kilogram of bodyweight, by goal.
 *
 * Bodyweight rather than lean mass because most users do not know their body-fat
 * percentage, and a guessed lean mass in a more precise formula is a worse
 * estimate than a real bodyweight in a coarser one. The deficit figure is the
 * highest because protein requirements rise as energy falls — it is what
 * preserves lean mass when the body is short of energy.
 */
export const PROTEIN_G_PER_KG: Readonly<Record<Goal, number>> = {
  lose_fat: 2.0,
  maintain: 1.6,
  gain_muscle: 1.8,
  recomp: 2.2,
  performance: 1.8,
};

/** Fat as a share of total energy, by goal. */
export const FAT_FRACTION_OF_ENERGY: Readonly<Record<Goal, number>> = {
  lose_fat: 0.28,
  maintain: 0.3,
  gain_muscle: 0.28,
  recomp: 0.28,
  /** Lower, so carbohydrate has room; a performance goal is fuelled by glycogen. */
  performance: 0.25,
};

/**
 * Essential fat floor. Below roughly this, fat-soluble vitamin absorption and
 * hormone synthesis suffer. A hard floor, taken before the energy split.
 */
export const MIN_FAT_G_PER_KG = 0.5;

/** The general-population RDA. The floor protein is reduced to, never past. */
export const MIN_PROTEIN_G_PER_KG = 0.8;

/**
 * Protein is capped as a share of energy rather than allowed to consume the
 * whole budget. At a low target a 2.2 g/kg prescription can exceed the entire
 * intake, which is not a macro split, it is a bug rendered as advice.
 */
export const MAX_PROTEIN_FRACTION_OF_ENERGY = 0.4;

/** US Dietary Guidelines: 14 g of fibre per 1000 kcal. */
export const FIBRE_G_PER_1000_KCAL = 14;

/** A conventional baseline. Not a medical figure, and adjustable by the user. */
export const WATER_ML_PER_KG = 35;

/** Energy targets are rounded to this, because false precision invites false trust. */
export const ENERGY_TARGET_ROUNDING_KCAL = 10;

export interface MacroSplitInput {
  energyKcal: number;
  bodyweightKg: number;
  goal: Goal;
  /** Overrides the goal default. This is the "custom macros" the others charge for. */
  proteinGPerKg?: number;
  /** Overrides the goal default, as a fraction of energy. */
  fatFractionOfEnergy?: number;
}

/**
 * Split an energy target into macros.
 *
 * Protein is set from bodyweight, fat from an energy share with an absolute
 * floor, and carbohydrate takes the remainder. Carbohydrate is the remainder
 * rather than a target of its own because it is the only macro with no
 * established minimum requirement — the body can make what it needs — so it is
 * the one that should absorb the arithmetic.
 *
 * The returned macros always account for the returned `energyKcal` to within a
 * kilocalorie. When the minimums cannot fit inside the requested energy, the
 * energy is raised to cover them and the adjustment says so; the alternative is
 * returning macros that silently do not add up to the number on the ring.
 */
export function macrosForEnergy(input: MacroSplitInput): {
  values: MacroTargetValues;
  adjustments: SafetyAdjustment[];
} {
  const { bodyweightKg, goal } = input;
  const adjustments: SafetyAdjustment[] = [];
  let energyKcal = input.energyKcal;

  const proteinPerKg = input.proteinGPerKg ?? PROTEIN_G_PER_KG[goal];
  const fatFraction = input.fatFractionOfEnergy ?? FAT_FRACTION_OF_ENERGY[goal];

  const proteinFloorG = bodyweightKg * MIN_PROTEIN_G_PER_KG;
  const fatFloorG = bodyweightKg * MIN_FAT_G_PER_KG;

  let proteinG = bodyweightKg * proteinPerKg;
  let fatG = Math.max((energyKcal * fatFraction) / KCAL_PER_GRAM.fat, fatFloorG);

  if (fatG > (energyKcal * fatFraction) / KCAL_PER_GRAM.fat) {
    adjustments.push({
      code: 'fat_raised_to_essential_minimum',
      requested: roundTo((energyKcal * fatFraction) / KCAL_PER_GRAM.fat, 1),
      applied: roundTo(fatG, 1),
    });
  }

  // Protein must not eat the whole budget, but must not fall below the RDA to
  // make room either. Those two bounds can cross at a very low target; the
  // energy floor below is what resolves it.
  const proteinCapG = (energyKcal * MAX_PROTEIN_FRACTION_OF_ENERGY) / KCAL_PER_GRAM.protein;
  if (proteinG > proteinCapG) {
    const reduced = Math.max(proteinCapG, proteinFloorG);
    if (reduced < proteinG) {
      adjustments.push({
        code: 'protein_reduced_to_fit_energy_budget',
        requested: roundTo(proteinG, 1),
        applied: roundTo(reduced, 1),
      });
      proteinG = reduced;
    }
  }

  let carbKcal =
    energyKcal - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat;

  if (carbKcal < 0) {
    // Give protein back first: fat has an essential-nutrient floor and protein
    // above the RDA does not.
    const overspendKcal = -carbKcal;
    const reducibleProteinG = Math.max(0, proteinG - proteinFloorG);
    const takenG = Math.min(reducibleProteinG, overspendKcal / KCAL_PER_GRAM.protein);
    if (takenG > 0) {
      adjustments.push({
        code: 'protein_reduced_to_fit_energy_budget',
        requested: roundTo(proteinG, 1),
        applied: roundTo(proteinG - takenG, 1),
      });
      proteinG -= takenG;
      carbKcal += takenG * KCAL_PER_GRAM.protein;
    }
  }

  if (carbKcal < 0) {
    // Both minimums together exceed the target. Raise the target rather than
    // ship a split that does not sum, or a fat figure below the essential floor.
    const requiredKcal = proteinG * KCAL_PER_GRAM.protein + fatG * KCAL_PER_GRAM.fat;
    adjustments.push({
      code: 'energy_raised_to_cover_macro_minimums',
      requested: roundTo(energyKcal, 0),
      applied: roundTo(requiredKcal, 0),
    });
    energyKcal = requiredKcal;
    carbKcal = 0;
  }

  const carbsG = carbKcal / KCAL_PER_GRAM.carb;

  return {
    values: {
      energyKcal: roundTo(energyKcal, 0),
      proteinG: roundTo(proteinG, 1),
      carbsG: roundTo(carbsG, 1),
      fatG: roundTo(fatG, 1),
      fiberG: roundTo((energyKcal / 1000) * FIBRE_G_PER_1000_KCAL, 0),
      waterMl: roundTo(bodyweightKg * WATER_ML_PER_KG, 0),
    },
    adjustments,
  };
}

export interface MacroTargetInput {
  bodyweightKg: number;
  heightCm: number;
  ageYears: number;
  biologicalSex: BiologicalSex;
  activityLevel: ActivityLevel;
  goal: Goal;
  /** Requested rate of bodyweight change. Negative is loss. Clamped on safety. */
  rateKgPerWeek: number;
  proteinGPerKg?: number;
  fatFractionOfEnergy?: number;
}

export interface CalculatedMacroTarget {
  values: MacroTargetValues;
  /** Everything needed to explain the number, matching `macroTargetSchema.basis`. */
  basis: {
    bmrKcal: number;
    tdeeKcal: number;
    activityLevel: ActivityLevel;
    goal: Goal;
    /** The rate the target actually delivers, after clamping. Not the requested one. */
    rateKgPerWeek: number;
    bodyweightKg: number;
  };
  /** The energy floor in force for this user. Rendered as a line on the ring. */
  energyFloorKcal: number;
  /** Every safety clamp applied, so the UI can say why the number is what it is. */
  adjustments: SafetyAdjustment[];
}

/**
 * The whole calculation: profile facts and a goal in, a target and its
 * justification out. Pure, deterministic, no network, no model.
 *
 * The clamps are applied in a fixed order and each one is reported. The order
 * matters: the rate cap first (so the requested deficit is already sane), then
 * the fraction-of-TDEE caps, then the absolute and BMR floors, which are last
 * because they are the ones that must not be overridden by anything.
 */
export function calculateMacroTarget(input: MacroTargetInput): CalculatedMacroTarget {
  const adjustments: SafetyAdjustment[] = [];

  const maintenance = estimateMaintenanceKcal(input);
  adjustments.push(...maintenance.adjustments);

  const rate = clampRateKgPerWeek(input.rateKgPerWeek, input.bodyweightKg);
  if (rate.adjustment) adjustments.push(rate.adjustment);

  const delta = dailyEnergyDeltaForRate(rate.rate, KCAL_PER_KG_BODY_MASS);
  let energyKcal = maintenance.tdeeKcal + delta;

  const deficitFloor = maintenance.tdeeKcal * (1 - MAX_DEFICIT_FRACTION_OF_TDEE);
  if (energyKcal < deficitFloor) {
    adjustments.push({
      code: 'deficit_capped_to_fraction_of_tdee',
      requested: roundTo(energyKcal, 0),
      applied: roundTo(deficitFloor, 0),
    });
    energyKcal = deficitFloor;
  }

  const surplusCeiling = maintenance.tdeeKcal * (1 + MAX_SURPLUS_FRACTION_OF_TDEE);
  if (energyKcal > surplusCeiling) {
    adjustments.push({
      code: 'surplus_capped_to_fraction_of_tdee',
      requested: roundTo(energyKcal, 0),
      applied: roundTo(surplusCeiling, 0),
    });
    energyKcal = surplusCeiling;
  }

  const absoluteFloor = ABSOLUTE_FLOOR_KCAL[input.biologicalSex];
  const floor = energyFloorKcal(input.biologicalSex, maintenance.bmrKcal);
  if (energyKcal < floor) {
    adjustments.push({
      // Name the floor that actually bound, so the UI can explain the right one.
      code: floor === absoluteFloor ? 'energy_raised_to_absolute_floor' : 'energy_raised_to_bmr_floor',
      requested: roundTo(energyKcal, 0),
      applied: roundTo(floor, 0),
    });
    energyKcal = floor;
  }

  energyKcal =
    Math.round(energyKcal / ENERGY_TARGET_ROUNDING_KCAL) * ENERGY_TARGET_ROUNDING_KCAL;
  // Rounding must never round *through* the floor.
  if (energyKcal < floor) energyKcal += ENERGY_TARGET_ROUNDING_KCAL;

  const split = macrosForEnergy({
    energyKcal,
    bodyweightKg: input.bodyweightKg,
    goal: input.goal,
    ...(input.proteinGPerKg !== undefined ? { proteinGPerKg: input.proteinGPerKg } : {}),
    ...(input.fatFractionOfEnergy !== undefined
      ? { fatFractionOfEnergy: input.fatFractionOfEnergy }
      : {}),
  });
  adjustments.push(...split.adjustments);

  // The rate the user will actually experience, derived back from the delivered
  // target. Reporting the requested rate here would be a lie the projection
  // graph then repeats for twelve weeks.
  const effectiveRate = roundTo(
    ((split.values.energyKcal - maintenance.tdeeKcal) * 7) / KCAL_PER_KG_BODY_MASS,
    3,
  );

  return {
    values: split.values,
    basis: {
      bmrKcal: maintenance.bmrKcal,
      tdeeKcal: maintenance.tdeeKcal,
      activityLevel: input.activityLevel,
      goal: input.goal,
      rateKgPerWeek: effectiveRate,
      bodyweightKg: input.bodyweightKg,
    },
    energyFloorKcal: roundTo(floor, 0),
    adjustments,
  };
}

/**
 * A manually entered energy target, put through the same floors.
 *
 * A manual number is still the app prescribing an intake, so it gets the same
 * protection. Without this, "custom target" is the hole every safety floor
 * leaks through, and it is the first thing a user in trouble reaches for.
 */
export function manualMacroTarget(input: {
  energyKcal: number;
  bodyweightKg: number;
  goal: Goal;
  biologicalSex: BiologicalSex;
  /** Omit when the profile lacks the facts for a BMR; only the absolute floor applies. */
  bmrKcal?: number;
  proteinGPerKg?: number;
  fatFractionOfEnergy?: number;
}): { values: MacroTargetValues; energyFloorKcal: number; adjustments: SafetyAdjustment[] } {
  const adjustments: SafetyAdjustment[] = [];
  const absoluteFloor = ABSOLUTE_FLOOR_KCAL[input.biologicalSex];
  const floor =
    input.bmrKcal !== undefined
      ? energyFloorKcal(input.biologicalSex, input.bmrKcal)
      : absoluteFloor;

  let energyKcal = input.energyKcal;
  if (energyKcal < floor) {
    adjustments.push({
      code: floor === absoluteFloor ? 'energy_raised_to_absolute_floor' : 'energy_raised_to_bmr_floor',
      requested: roundTo(energyKcal, 0),
      applied: roundTo(floor, 0),
    });
    energyKcal = floor;
  }

  const split = macrosForEnergy({
    energyKcal,
    bodyweightKg: input.bodyweightKg,
    goal: input.goal,
    ...(input.proteinGPerKg !== undefined ? { proteinGPerKg: input.proteinGPerKg } : {}),
    ...(input.fatFractionOfEnergy !== undefined
      ? { fatFractionOfEnergy: input.fatFractionOfEnergy }
      : {}),
  });

  return {
    values: split.values,
    energyFloorKcal: roundTo(floor, 0),
    adjustments: [...adjustments, ...split.adjustments],
  };
}
