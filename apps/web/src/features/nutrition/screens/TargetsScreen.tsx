import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Chip, Divider, NumberField, SegmentedControl, Select } from '@freeforever/design-system';
import {
  ACTIVITY_LEVELS_LIST,
  calculateMacroTarget,
  formatEnergy,
  formatGrams,
  GOALS_LIST,
  ISO_WEEKDAYS,
  MAX_SWING_FRACTION,
  manualMacroTarget,
  maxGainKgPerWeek,
  maxLossKgPerWeek,
  planWeeklyTargets,
  type ActivityLevel,
  type BiologicalSex,
  type Goal,
  type IsoWeekday,
  type SafetyAdjustment,
} from '@freeforever/core/src/nutrition/index.js';
import { today } from '../data/dates.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { TargetPlan } from '../data/types.js';

/**
 * Work out a target, and say where the number came from.
 *
 * All of this runs on the device: Mifflin-St Jeor, an activity multiplier and
 * arithmetic. No model, no request, nothing metered. Per-day targets and custom
 * macros are here rather than behind a tier because they cost nothing to
 * provide — the cost ledger in `docs/strategy/` is the argument, ADR-0001
 * rule 6 is the rule.
 *
 * Where a safety floor changes the number, this screen says so in words. That
 * is the whole reason `calculateMacroTarget` returns its clamps rather than
 * quietly applying them: a user who asked for 1,200 kcal and got 1,680 is owed
 * an explanation, and in a product adjacent to body image the explanation is
 * the feature, not the apology.
 */

const ADJUSTMENT_COPY: Record<SafetyAdjustment['code'], (a: SafetyAdjustment) => string> = {
  rate_capped_to_safe_maximum: (a) =>
    `You asked to change weight at ${Math.abs(a.requested).toFixed(2)} kg a week. This app will not prescribe faster than ${Math.abs(a.applied).toFixed(2)} kg a week — past that, most of what changes is lean mass rather than fat.`,
  energy_raised_to_absolute_floor: (a) =>
    `Raised to ${Math.round(a.applied)} kcal. Below roughly that, a diet cannot reliably meet micronutrient needs from food without supervision.`,
  energy_raised_to_bmr_floor: (a) =>
    `Raised to ${Math.round(a.applied)} kcal, which is your estimated resting metabolic rate. Sustained intake below what your body spends at rest is what drives lean-mass loss and metabolic adaptation.`,
  deficit_capped_to_fraction_of_tdee: (a) =>
    `The deficit is capped at a quarter of your daily expenditure, so the target is ${Math.round(a.applied)} kcal rather than ${Math.round(a.requested)}.`,
  surplus_capped_to_fraction_of_tdee: (a) =>
    `The surplus is capped at a fifth above maintenance (${Math.round(a.applied)} kcal). Beyond that, extra energy reliably becomes fat rather than muscle.`,
  goal_weight_raised_to_minimum_healthy_bmi: (a) =>
    `Goal weight adjusted to ${a.applied.toFixed(1)} kg. This app will not help aim below a BMI of 18.5.`,
  age_outside_validated_range: (a) =>
    `The equation behind this estimate was validated in adults aged 18 to 80, and your age (${Math.round(a.requested)}) is outside that. Treat the number as a rough starting point.`,
  fat_raised_to_essential_minimum: () =>
    'Fat was raised to the minimum needed for hormone synthesis and fat-soluble vitamin absorption.',
  protein_reduced_to_fit_energy_budget: () =>
    'Protein was reduced so the macros fit inside the energy target. It stays above the recommended daily allowance.',
  energy_raised_to_cover_macro_minimums: (a) =>
    `Raised to ${Math.round(a.applied)} kcal, the least that covers the minimum protein and fat for your bodyweight.`,
  day_variation_reduced_to_respect_floor: () =>
    'The training-day swing was reduced so no rest day falls below your floor.',
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function TargetsScreen() {
  const navigate = useNavigate();
  const { state, mutate } = useNutrition();
  const existing = state.target;

  const [mode, setMode] = useState<'calculated' | 'manual'>(existing?.source ?? 'calculated');
  const [bodyweight, setBodyweight] = useState<number | null>(existing?.basis?.bodyweightKg ?? 75);
  const [height, setHeight] = useState<number | null>(175);
  const [age, setAge] = useState<number | null>(35);
  const [sex, setSex] = useState<BiologicalSex>('unspecified');
  const [activity, setActivity] = useState<ActivityLevel>('moderately_active');
  const [goal, setGoal] = useState<Goal>('maintain');
  const [rate, setRate] = useState<number | null>(existing?.basis?.rateKgPerWeek ?? 0);
  const [manualKcal, setManualKcal] = useState<number | null>(existing?.base.energyKcal ?? 2200);
  const [proteinPerKg, setProteinPerKg] = useState<number | null>(null);
  const [trainingDays, setTrainingDays] = useState<IsoWeekday[]>(
    (existing?.trainingDays as IsoWeekday[] | undefined) ?? [],
  );
  const [swing, setSwing] = useState<number | null>((existing?.swingFraction ?? 0) * 100);

  const canCalculate =
    bodyweight !== null && bodyweight > 0 && height !== null && height > 0 && age !== null && age > 0;

  const calculated = useMemo(() => {
    if (!canCalculate) return null;
    return calculateMacroTarget({
      bodyweightKg: bodyweight,
      heightCm: height,
      ageYears: age,
      biologicalSex: sex,
      activityLevel: activity,
      goal,
      rateKgPerWeek: rate ?? 0,
      ...(proteinPerKg !== null && proteinPerKg > 0 ? { proteinGPerKg: proteinPerKg } : {}),
    });
  }, [canCalculate, bodyweight, height, age, sex, activity, goal, rate, proteinPerKg]);

  const manualResult = useMemo(() => {
    if (manualKcal === null || bodyweight === null || bodyweight <= 0) return null;
    return manualMacroTarget({
      energyKcal: manualKcal,
      bodyweightKg: bodyweight,
      goal,
      biologicalSex: sex,
      ...(calculated ? { bmrKcal: calculated.basis.bmrKcal } : {}),
      ...(proteinPerKg !== null && proteinPerKg > 0 ? { proteinGPerKg: proteinPerKg } : {}),
    });
  }, [manualKcal, bodyweight, goal, sex, calculated, proteinPerKg]);

  const active = mode === 'manual' ? manualResult : calculated;
  const adjustments = active?.adjustments ?? [];

  const week = useMemo(() => {
    if (!active) return null;
    return planWeeklyTargets({
      base: active.values,
      plan: { trainingDays, swingFraction: (swing ?? 0) / 100 },
      energyFloorKcal: active.energyFloorKcal,
    });
  }, [active, trainingDays, swing]);

  const save = () => {
    if (!active) return;
    const plan: TargetPlan = {
      base: active.values,
      energyFloorKcal: active.energyFloorKcal,
      trainingDays,
      swingFraction: week?.appliedSwingFraction ?? 0,
      source: mode,
      effectiveFrom: today(),
      ...(mode === 'calculated' && calculated
        ? {
            basis: {
              bmrKcal: calculated.basis.bmrKcal,
              tdeeKcal: calculated.basis.tdeeKcal,
              rateKgPerWeek: calculated.basis.rateKgPerWeek,
              bodyweightKg: calculated.basis.bodyweightKg,
            },
          }
        : {}),
    };
    mutate((current) => ({ ...current, target: plan }));
    navigate('..');
  };

  const lossCap = bodyweight !== null && bodyweight > 0 ? maxLossKgPerWeek(bodyweight) : 1;
  const gainCap = bodyweight !== null && bodyweight > 0 ? maxGainKgPerWeek(bodyweight) : 0.5;

  return (
    <div className="ffn ffn-pad">
      <h1 className="ffn-h1" style={{ marginBlock: 'var(--ff-space-16)' }}>
        Your targets
      </h1>

      <SegmentedControl
        label="How to set the target"
        value={mode}
        onValueChange={(value) => setMode(value as 'calculated' | 'manual')}
        options={[
          { value: 'calculated', label: 'Work it out' },
          { value: 'manual', label: 'I know my number' },
        ]}
      />

      <div className="ffn-fields" style={{ marginBlockStart: 'var(--ff-space-16)' }}>
        <div className="ffn-fields-2">
          <NumberField label="Bodyweight" unit="kg" value={bodyweight} onValueChange={setBodyweight} step={0.5} min={0} />
          <NumberField label="Height" unit="cm" value={height} onValueChange={setHeight} step={1} min={0} />
          <NumberField label="Age" unit="years" value={age} onValueChange={setAge} step={1} min={0} />
          <Select
            label="Biological sex"
            value={sex}
            onChange={(event) => setSex(event.currentTarget.value as BiologicalSex)}
            hint="Used only for the BMR estimate, which is the one place the formula differs."
          >
            <option value="unspecified">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>

        <Select
          label="Activity"
          value={activity}
          onChange={(event) => setActivity(event.currentTarget.value as ActivityLevel)}
          hint="A starting estimate. Adjust it against real weight data after a fortnight."
        >
          {ACTIVITY_LEVELS_LIST.map((level) => (
            <option key={level} value={level}>
              {level.replace(/_/gu, ' ')}
            </option>
          ))}
        </Select>

        <Select label="Goal" value={goal} onChange={(event) => setGoal(event.currentTarget.value as Goal)}>
          {GOALS_LIST.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/gu, ' ')}
            </option>
          ))}
        </Select>

        {mode === 'calculated' ? (
          <NumberField
            label="Rate of change"
            unit="kg/week"
            value={rate}
            onValueChange={setRate}
            step={0.05}
            min={-lossCap}
            max={gainCap}
            hint={`Negative to lose. Capped at ${lossCap.toFixed(2)} kg down and ${gainCap.toFixed(2)} kg up per week for your bodyweight.`}
          />
        ) : (
          <NumberField
            label="Daily energy"
            unit="kcal"
            value={manualKcal}
            onValueChange={setManualKcal}
            step={10}
            min={0}
            hint="Safety floors still apply to a number you set yourself."
          />
        )}

        <NumberField
          label="Protein (custom)"
          unit="g/kg"
          value={proteinPerKg}
          onValueChange={setProteinPerKg}
          step={0.1}
          min={0}
          placeholder="—"
          hint="Optional. Leave blank to use the figure for your goal."
        />
      </div>

      {active ? (
        <>
          <Divider />
          <section className="ffn-section" aria-label="Your target">
            <h2 className="ffn-h2">Your daily target</h2>
            <div className="ffn-portion-summary">
              <div className="ffn-portion-figure">
                <b>{formatEnergy(active.values.energyKcal, state.preferences.energyUnit)}</b>
                <span>{state.preferences.energyUnit}</span>
              </div>
              <div className="ffn-portion-figure">
                <b>{formatGrams(active.values.proteinG)}</b>
                <span>protein</span>
              </div>
              <div className="ffn-portion-figure">
                <b>{formatGrams(active.values.carbsG)}</b>
                <span>carbs</span>
              </div>
              <div className="ffn-portion-figure">
                <b>{formatGrams(active.values.fatG)}</b>
                <span>fat</span>
              </div>
            </div>

            {calculated ? (
              <p className="ffn-muted" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
                Resting metabolic rate {calculated.basis.bmrKcal} kcal (Mifflin-St Jeor),
                daily expenditure {calculated.basis.tdeeKcal} kcal at your activity level.
                At this target you would change weight by about{' '}
                {calculated.basis.rateKgPerWeek.toFixed(2)} kg a week. Your floor is{' '}
                {active.energyFloorKcal} kcal.
              </p>
            ) : null}
          </section>

          {adjustments.length > 0 ? (
            <section className="ffn-section" aria-label="Adjustments made">
              <h2 className="ffn-h2">
                <Badge tone="attention">Adjusted</Badge>
              </h2>
              <div className="ffn-stack-tight">
                {adjustments.map((adjustment, index) => (
                  <p className="ffn-notice" key={`${adjustment.code}:${index}`}>
                    {ADJUSTMENT_COPY[adjustment.code](adjustment)}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="ffn-section" aria-label="Per-day variation">
            <h2 className="ffn-h2">Eat more on training days</h2>
            <p className="ffn-muted">
              Moves energy onto the days you train and off the days you do not, keeping the week
              the same. Carbohydrate absorbs the swing; protein and fat stay put.
            </p>
            <div className="ffn-chips" style={{ marginBlock: 'var(--ff-space-12)' }}>
              {ISO_WEEKDAYS.map((day, index) => (
                <Chip
                  key={day}
                  selected={trainingDays.includes(day)}
                  onClick={() =>
                    setTrainingDays((current) =>
                      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
                    )
                  }
                >
                  {WEEKDAY_LABELS[index]}
                </Chip>
              ))}
            </div>
            <NumberField
              label="Training-day increase"
              unit="%"
              value={swing}
              onValueChange={setSwing}
              step={5}
              min={0}
              max={MAX_SWING_FRACTION * 100}
              hint={`Up to ${MAX_SWING_FRACTION * 100}%. Reduced automatically if a rest day would fall below your floor.`}
            />
            {week !== null && week.appliedSwingFraction > 0 ? (
              <p className="ffn-muted" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
                Training days {formatEnergy(week.days[trainingDays[0] ?? 1].energyKcal)} kcal, rest
                days{' '}
                {formatEnergy(
                  week.days[(ISO_WEEKDAYS.find((d) => !trainingDays.includes(d)) ?? 1)].energyKcal,
                )}{' '}
                kcal. Same weekly total.
              </p>
            ) : null}
          </section>

          <Button variant="primary" size="xl" block onClick={save}>
            Save target
          </Button>
        </>
      ) : (
        <p className="ffn-muted">Fill in bodyweight, height and age to see a target.</p>
      )}
    </div>
  );
}
