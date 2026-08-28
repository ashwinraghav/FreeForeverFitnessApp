import { z } from 'zod';

/**
 * Units are a first-class problem in this domain, so they get a first-class rule:
 *
 *   **Persistence is always canonical. Display preference never touches storage.**
 *
 * A stored number is always in the canonical unit for its dimension. A number that
 * has been converted for display is a `string` on its way to a DOM node and must
 * never travel back into a document. The failure this prevents is the one every
 * fitness app eventually ships: a user flips kg/lb, and history silently reinterprets.
 *
 * Canonical units:
 *
 *   | dimension        | canonical      | why                                        |
 *   |------------------|----------------|--------------------------------------------|
 *   | training load    | kilograms      | plate maths is metric everywhere but the US |
 *   | food mass        | grams          | every nutrition dataset is per-100g         |
 *   | volume           | millilitres    | ditto for liquids                           |
 *   | body length      | centimetres    | tape measures                               |
 *   | distance         | metres         | cardio; avoids km/mi in storage             |
 *   | energy           | kilocalories   | dataset-native; kJ is a display conversion  |
 *   | duration         | seconds        | integers, no float drift on rest timers     |
 *
 * Conversions live in `packages/core`. This module owns the canonical definitions,
 * the display-preference type, and the exact factors, so that only one file has to
 * be right about what a pound is.
 */

/** Exact by international definition (1959). Not a rounded constant. */
export const KILOGRAMS_PER_POUND = 0.45359237;
/** Exact by definition. */
export const CENTIMETRES_PER_INCH = 2.54;
/** Exact by definition. */
export const METRES_PER_MILE = 1609.344;
/** Thermochemical kilocalorie. Exact by definition. */
export const KILOJOULES_PER_KILOCALORIE = 4.184;

export const MASS_DISPLAY_UNITS = ['kg', 'lb'] as const;
export const LENGTH_DISPLAY_UNITS = ['cm', 'in'] as const;
export const DISTANCE_DISPLAY_UNITS = ['km', 'mi'] as const;
export const ENERGY_DISPLAY_UNITS = ['kcal', 'kJ'] as const;

export const massDisplayUnitSchema = z.enum(MASS_DISPLAY_UNITS);
export const lengthDisplayUnitSchema = z.enum(LENGTH_DISPLAY_UNITS);
export const distanceDisplayUnitSchema = z.enum(DISTANCE_DISPLAY_UNITS);
export const energyDisplayUnitSchema = z.enum(ENERGY_DISPLAY_UNITS);

export type MassDisplayUnit = z.infer<typeof massDisplayUnitSchema>;
export type LengthDisplayUnit = z.infer<typeof lengthDisplayUnitSchema>;
export type DistanceDisplayUnit = z.infer<typeof distanceDisplayUnitSchema>;
export type EnergyDisplayUnit = z.infer<typeof energyDisplayUnitSchema>;

/**
 * A plate the gym owns, counted in pairs — a barbell loads symmetrically, and a
 * single plate on one side is not a thing anyone does.
 */
export const gymPlateSchema = z.strictObject({
  massKg: z.number().positive().max(100),
  /** Pairs available. Zero is legal: it records "this gym has none of these". */
  pairCount: z.number().int().min(0).max(20),
});

export type GymPlate = z.infer<typeof gymPlateSchema>;

/**
 * Carried on the profile, never on a logged value. Changing any of these is a
 * presentation change and rewrites no history — with the exception of the three
 * equipment fields below, which describe the world rather than the reader.
 *
 * `barbellIncrementKg`, `dumbbellIncrementKg` and `gymPlates` are canonical (kg) and
 * are facts about the user's gym, not reading preferences — which is why a US lifter
 * with 2.5lb plates stores 1.13398 rather than 2.5. They live here because this is
 * where the increments already were, and splitting three related equipment facts
 * across two objects would be worse than one object whose name has outgrown its
 * contents. Worth renaming if a fourth arrives.
 */
export const unitPreferencesSchema = z.strictObject({
  trainingLoad: massDisplayUnitSchema,
  bodyMass: massDisplayUnitSchema,
  bodyLength: lengthDisplayUnitSchema,
  distance: distanceDisplayUnitSchema,
  energy: energyDisplayUnitSchema,
  /** Smallest load step available on a barbell, in kg. Drives plate maths and rounding. */
  barbellIncrementKg: z.number().positive().max(10),
  /** Smallest load step available on the dumbbell rack, in kg. */
  dumbbellIncrementKg: z.number().positive().max(10),
  /**
   * The plates this user's usual gym has. A **default**, not a constraint: the plate
   * calculator takes an inventory as a parameter and falls back to this, because one
   * person trains at two gyms and the travelling case must not require editing a
   * profile to get the right answer.
   *
   * Absent means "assume a standard metric set", which is what the calculator's own
   * default already does — so this field is an override, and omitting it is normal.
   */
  gymPlates: z.array(gymPlateSchema).max(20).optional(),
});

export type UnitPreferences = z.infer<typeof unitPreferencesSchema>;

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  trainingLoad: 'kg',
  bodyMass: 'kg',
  bodyLength: 'cm',
  distance: 'km',
  energy: 'kcal',
  barbellIncrementKg: 2.5,
  dumbbellIncrementKg: 2,
};

/**
 * Canonical quantity schemas. Bounds are deliberately loose enough for real outliers
 * (a 500kg deadlift exists) and tight enough that a unit-conversion bug — which is
 * always off by 2.2 or 2.54 — cannot hide inside them for long.
 */
export const massKgSchema = z.number().finite().min(0).max(1000);
/** Signed: assistance and negative-load machines are represented as negative. */
export const signedMassKgSchema = z.number().finite().min(-500).max(1000);
export const foodMassGramsSchema = z.number().finite().min(0).max(100_000);
export const volumeMlSchema = z.number().finite().min(0).max(100_000);
export const bodyLengthCmSchema = z.number().finite().min(0).max(400);
export const distanceMetresSchema = z.number().finite().min(0).max(1_000_000);
export const energyKcalSchema = z.number().finite().min(0).max(100_000);
export const durationSecondsSchema = z.number().int().min(0).max(86_400);
