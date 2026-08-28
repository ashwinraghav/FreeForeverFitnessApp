import type {
  EffortKind,
  Equipment,
  ExerciseId,
  LoadKind,
  MuscleContribution,
  MuscleGroup,
} from '@freeforever/data';

import type { CatalogueEntry } from './types.js';

/**
 * A starter catalogue: the lifts that make up the overwhelming majority of logged
 * sets, with honest muscle fractions.
 *
 * The fractions matter more than the length of the list. A bench press is 1.0 chest,
 * 0.5 triceps and 0.5 front delts — not 1.0 of all three — because every volume chart
 * downstream sums these, and an all-1.0 split double-counts until the number the
 * lifter is trying to steer by is meaningless.
 *
 * This is a placeholder for `@freeforever/datasets`' 873-entry build; see
 * `catalogue/types.ts` for what swapping it over involves.
 */

interface Spec {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly equipment: Equipment;
  readonly load?: LoadKind;
  readonly effort?: EffortKind;
  readonly muscles: readonly (readonly [MuscleGroup, number])[];
  readonly unilateral?: boolean;
  readonly barKg?: number;
}

function entry(spec: Spec): CatalogueEntry {
  const muscles: MuscleContribution[] = spec.muscles.map(([muscle, fraction]) => ({
    muscle,
    fraction,
  }));
  return {
    id: spec.id as ExerciseId,
    name: spec.name,
    aliases: spec.aliases ?? [],
    equipment: spec.equipment,
    loadKind: spec.load ?? 'external',
    effortKind: spec.effort ?? 'reps',
    muscles,
    unilateral: spec.unilateral ?? false,
    ...(spec.barKg === undefined ? {} : { implementMassKg: spec.barKg }),
  };
}

const SPECS: readonly Spec[] = [
  // ---------------------------------------------------------------- barbell, lower
  {
    id: 'back-squat',
    name: 'Back Squat',
    aliases: ['squat', 'bb squat', 'high bar squat'],
    equipment: 'barbell',
    muscles: [['quads', 1], ['glutes', 0.7], ['adductors', 0.4], ['lower_back', 0.3]],
  },
  {
    id: 'front-squat',
    name: 'Front Squat',
    aliases: ['fs'],
    equipment: 'barbell',
    muscles: [['quads', 1], ['glutes', 0.5], ['upper_back', 0.3], ['abs', 0.3]],
  },
  {
    id: 'deadlift',
    name: 'Deadlift',
    aliases: ['dl', 'conventional deadlift'],
    equipment: 'barbell',
    muscles: [['hamstrings', 1], ['glutes', 1], ['lower_back', 0.7], ['traps', 0.5], ['lats', 0.3], ['forearms', 0.3]],
  },
  {
    id: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    aliases: ['rdl', 'stiff leg deadlift'],
    equipment: 'barbell',
    muscles: [['hamstrings', 1], ['glutes', 0.7], ['lower_back', 0.4]],
  },
  {
    id: 'sumo-deadlift',
    name: 'Sumo Deadlift',
    aliases: ['sumo'],
    equipment: 'barbell',
    muscles: [['glutes', 1], ['quads', 0.6], ['hamstrings', 0.6], ['adductors', 0.6], ['traps', 0.4]],
  },
  {
    id: 'hip-thrust',
    name: 'Barbell Hip Thrust',
    aliases: ['hip thrust'],
    equipment: 'barbell',
    muscles: [['glutes', 1], ['hamstrings', 0.4]],
  },
  {
    id: 'barbell-lunge',
    name: 'Barbell Lunge',
    equipment: 'barbell',
    unilateral: true,
    muscles: [['quads', 1], ['glutes', 0.7]],
  },
  {
    id: 'good-morning',
    name: 'Good Morning',
    equipment: 'barbell',
    muscles: [['hamstrings', 1], ['lower_back', 0.7], ['glutes', 0.5]],
  },

  // ---------------------------------------------------------------- barbell, upper
  {
    id: 'bench-press',
    name: 'Bench Press',
    aliases: ['bench', 'bb bench', 'flat bench'],
    equipment: 'barbell',
    muscles: [['chest', 1], ['triceps', 0.5], ['front_delts', 0.5]],
  },
  {
    id: 'incline-bench-press',
    name: 'Incline Bench Press',
    aliases: ['incline bench', 'incline press'],
    equipment: 'barbell',
    muscles: [['chest', 1], ['front_delts', 0.7], ['triceps', 0.5]],
  },
  {
    id: 'close-grip-bench',
    name: 'Close-Grip Bench Press',
    aliases: ['cgbp', 'close grip bench'],
    equipment: 'barbell',
    muscles: [['triceps', 1], ['chest', 0.7], ['front_delts', 0.4]],
  },
  {
    id: 'overhead-press',
    name: 'Overhead Press',
    aliases: ['ohp', 'military press', 'strict press', 'shoulder press'],
    equipment: 'barbell',
    muscles: [['front_delts', 1], ['side_delts', 0.5], ['triceps', 0.6], ['upper_back', 0.3]],
  },
  {
    id: 'push-press',
    name: 'Push Press',
    equipment: 'barbell',
    muscles: [['front_delts', 1], ['triceps', 0.5], ['quads', 0.3]],
  },
  {
    id: 'barbell-row',
    name: 'Barbell Row',
    aliases: ['bb row', 'bent over row', 'pendlay row'],
    equipment: 'barbell',
    muscles: [['upper_back', 1], ['lats', 0.8], ['biceps', 0.5], ['rear_delts', 0.5], ['lower_back', 0.3]],
  },
  {
    id: 'barbell-curl',
    name: 'Barbell Curl',
    aliases: ['bb curl'],
    equipment: 'barbell',
    muscles: [['biceps', 1], ['forearms', 0.4]],
  },
  {
    id: 'ez-bar-curl',
    name: 'EZ-Bar Curl',
    equipment: 'ez_bar',
    muscles: [['biceps', 1], ['forearms', 0.4]],
  },
  {
    id: 'skullcrusher',
    name: 'Skullcrusher',
    aliases: ['lying tricep extension'],
    equipment: 'ez_bar',
    muscles: [['triceps', 1]],
  },

  // -------------------------------------------------------------------- dumbbell
  {
    id: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    aliases: ['db bench', 'db press'],
    equipment: 'dumbbell',
    muscles: [['chest', 1], ['triceps', 0.5], ['front_delts', 0.5]],
  },
  {
    id: 'incline-dumbbell-press',
    name: 'Incline Dumbbell Press',
    aliases: ['incline db press'],
    equipment: 'dumbbell',
    muscles: [['chest', 1], ['front_delts', 0.7], ['triceps', 0.5]],
  },
  {
    id: 'dumbbell-shoulder-press',
    name: 'Dumbbell Shoulder Press',
    aliases: ['db shoulder press', 'db ohp'],
    equipment: 'dumbbell',
    muscles: [['front_delts', 1], ['side_delts', 0.5], ['triceps', 0.5]],
  },
  {
    id: 'lateral-raise',
    name: 'Lateral Raise',
    aliases: ['side raise', 'lat raise'],
    equipment: 'dumbbell',
    muscles: [['side_delts', 1]],
  },
  {
    id: 'rear-delt-fly',
    name: 'Rear Delt Fly',
    aliases: ['reverse fly'],
    equipment: 'dumbbell',
    muscles: [['rear_delts', 1], ['upper_back', 0.4]],
  },
  {
    id: 'dumbbell-row',
    name: 'Dumbbell Row',
    aliases: ['db row', 'one arm row'],
    equipment: 'dumbbell',
    unilateral: true,
    muscles: [['lats', 1], ['upper_back', 0.7], ['biceps', 0.5], ['rear_delts', 0.3]],
  },
  {
    id: 'dumbbell-curl',
    name: 'Dumbbell Curl',
    aliases: ['db curl'],
    equipment: 'dumbbell',
    unilateral: true,
    muscles: [['biceps', 1], ['forearms', 0.4]],
  },
  {
    id: 'hammer-curl',
    name: 'Hammer Curl',
    equipment: 'dumbbell',
    unilateral: true,
    muscles: [['biceps', 0.8], ['forearms', 1]],
  },
  {
    id: 'dumbbell-fly',
    name: 'Dumbbell Fly',
    aliases: ['db fly', 'chest fly'],
    equipment: 'dumbbell',
    muscles: [['chest', 1], ['front_delts', 0.3]],
  },
  {
    id: 'bulgarian-split-squat',
    name: 'Bulgarian Split Squat',
    aliases: ['bss', 'rear foot elevated split squat', 'rfess'],
    equipment: 'dumbbell',
    unilateral: true,
    muscles: [['quads', 1], ['glutes', 0.8], ['adductors', 0.3]],
  },
  {
    id: 'goblet-squat',
    name: 'Goblet Squat',
    equipment: 'dumbbell',
    muscles: [['quads', 1], ['glutes', 0.6], ['abs', 0.3]],
  },
  {
    id: 'dumbbell-rdl',
    name: 'Dumbbell Romanian Deadlift',
    aliases: ['db rdl'],
    equipment: 'dumbbell',
    muscles: [['hamstrings', 1], ['glutes', 0.7]],
  },
  {
    id: 'walking-lunge',
    name: 'Walking Lunge',
    equipment: 'dumbbell',
    unilateral: true,
    muscles: [['quads', 1], ['glutes', 0.8]],
  },
  {
    id: 'overhead-tricep-extension',
    name: 'Overhead Triceps Extension',
    equipment: 'dumbbell',
    muscles: [['triceps', 1]],
  },
  {
    id: 'farmers-carry',
    name: "Farmer's Carry",
    aliases: ['farmers walk'],
    equipment: 'dumbbell',
    effort: 'distance',
    muscles: [['forearms', 1], ['traps', 0.8], ['abs', 0.5], ['obliques', 0.5]],
  },

  // ----------------------------------------------------------- machine and cable
  {
    id: 'lat-pulldown',
    name: 'Lat Pulldown',
    aliases: ['pulldown'],
    equipment: 'cable',
    muscles: [['lats', 1], ['biceps', 0.5], ['upper_back', 0.5]],
  },
  {
    id: 'seated-cable-row',
    name: 'Seated Cable Row',
    aliases: ['cable row'],
    equipment: 'cable',
    muscles: [['upper_back', 1], ['lats', 0.8], ['biceps', 0.5], ['rear_delts', 0.4]],
  },
  {
    id: 'cable-tricep-pushdown',
    name: 'Triceps Pushdown',
    aliases: ['pushdown', 'tricep pushdown'],
    equipment: 'cable',
    muscles: [['triceps', 1]],
  },
  {
    id: 'cable-lateral-raise',
    name: 'Cable Lateral Raise',
    equipment: 'cable',
    unilateral: true,
    muscles: [['side_delts', 1]],
  },
  {
    id: 'face-pull',
    name: 'Face Pull',
    equipment: 'cable',
    muscles: [['rear_delts', 1], ['upper_back', 0.7], ['traps', 0.4]],
  },
  {
    id: 'cable-fly',
    name: 'Cable Fly',
    equipment: 'cable',
    muscles: [['chest', 1], ['front_delts', 0.3]],
  },
  {
    id: 'leg-press',
    name: 'Leg Press',
    equipment: 'machine',
    muscles: [['quads', 1], ['glutes', 0.7], ['adductors', 0.3]],
  },
  {
    id: 'hack-squat',
    name: 'Hack Squat',
    equipment: 'machine',
    muscles: [['quads', 1], ['glutes', 0.5]],
  },
  {
    id: 'leg-extension',
    name: 'Leg Extension',
    aliases: ['quad extension'],
    equipment: 'machine',
    muscles: [['quads', 1]],
  },
  {
    id: 'lying-leg-curl',
    name: 'Lying Leg Curl',
    aliases: ['hamstring curl', 'leg curl'],
    equipment: 'machine',
    muscles: [['hamstrings', 1], ['calves', 0.2]],
  },
  {
    id: 'seated-leg-curl',
    name: 'Seated Leg Curl',
    equipment: 'machine',
    muscles: [['hamstrings', 1]],
  },
  {
    id: 'calf-raise',
    name: 'Standing Calf Raise',
    aliases: ['calf raise'],
    equipment: 'machine',
    muscles: [['calves', 1]],
  },
  {
    id: 'chest-press-machine',
    name: 'Chest Press Machine',
    equipment: 'machine',
    muscles: [['chest', 1], ['triceps', 0.5], ['front_delts', 0.4]],
  },
  {
    id: 'pec-deck',
    name: 'Pec Deck',
    aliases: ['machine fly'],
    equipment: 'machine',
    muscles: [['chest', 1]],
  },
  {
    id: 'smith-machine-squat',
    name: 'Smith Machine Squat',
    equipment: 'smith_machine',
    muscles: [['quads', 1], ['glutes', 0.6]],
  },
  {
    id: 'hip-abduction',
    name: 'Hip Abduction',
    equipment: 'machine',
    muscles: [['abductors', 1], ['glutes', 0.5]],
  },
  {
    id: 'back-extension',
    name: 'Back Extension',
    aliases: ['hyperextension'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['lower_back', 1], ['glutes', 0.6], ['hamstrings', 0.5]],
  },

  // --------------------------------------------------------------- bodyweight
  {
    id: 'pull-up',
    name: 'Pull-Up',
    aliases: ['pullup', 'chin up', 'chinup'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['lats', 1], ['biceps', 0.6], ['upper_back', 0.5], ['forearms', 0.3]],
  },
  {
    id: 'assisted-pull-up',
    name: 'Assisted Pull-Up',
    aliases: ['machine pull up'],
    equipment: 'machine',
    load: 'assisted',
    muscles: [['lats', 1], ['biceps', 0.6], ['upper_back', 0.5]],
  },
  {
    id: 'dip',
    name: 'Dip',
    aliases: ['dips', 'parallel bar dip'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['chest', 0.8], ['triceps', 1], ['front_delts', 0.5]],
  },
  {
    id: 'push-up',
    name: 'Push-Up',
    aliases: ['pushup', 'press up'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['chest', 1], ['triceps', 0.5], ['front_delts', 0.4], ['abs', 0.2]],
  },
  {
    id: 'inverted-row',
    name: 'Inverted Row',
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['upper_back', 1], ['lats', 0.7], ['biceps', 0.5]],
  },
  {
    id: 'hanging-leg-raise',
    name: 'Hanging Leg Raise',
    aliases: ['leg raise'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['abs', 1], ['obliques', 0.4], ['forearms', 0.3]],
  },
  {
    id: 'plank',
    name: 'Plank',
    equipment: 'bodyweight',
    load: 'none',
    effort: 'duration',
    muscles: [['abs', 1], ['obliques', 0.5], ['lower_back', 0.3]],
  },
  {
    id: 'side-plank',
    name: 'Side Plank',
    equipment: 'bodyweight',
    load: 'none',
    effort: 'duration',
    unilateral: true,
    muscles: [['obliques', 1], ['abs', 0.5]],
  },
  {
    id: 'dead-hang',
    name: 'Dead Hang',
    equipment: 'bodyweight',
    load: 'none',
    effort: 'duration',
    muscles: [['forearms', 1], ['lats', 0.4]],
  },
  {
    id: 'ab-wheel-rollout',
    name: 'Ab Wheel Rollout',
    aliases: ['ab rollout'],
    equipment: 'other',
    load: 'bodyweight',
    muscles: [['abs', 1], ['obliques', 0.4], ['lats', 0.3]],
  },
  {
    id: 'nordic-curl',
    name: 'Nordic Hamstring Curl',
    aliases: ['nordic'],
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['hamstrings', 1], ['glutes', 0.3]],
  },
  {
    id: 'glute-bridge',
    name: 'Glute Bridge',
    equipment: 'bodyweight',
    load: 'bodyweight',
    muscles: [['glutes', 1], ['hamstrings', 0.4]],
  },
  {
    id: 'pistol-squat',
    name: 'Pistol Squat',
    equipment: 'bodyweight',
    load: 'bodyweight',
    unilateral: true,
    muscles: [['quads', 1], ['glutes', 0.7], ['abs', 0.3]],
  },

  // ------------------------------------------------------------ kettlebell, other
  {
    id: 'kettlebell-swing',
    name: 'Kettlebell Swing',
    aliases: ['kb swing'],
    equipment: 'kettlebell',
    muscles: [['glutes', 1], ['hamstrings', 0.8], ['lower_back', 0.4], ['traps', 0.3]],
  },
  {
    id: 'turkish-get-up',
    name: 'Turkish Get-Up',
    aliases: ['tgu'],
    equipment: 'kettlebell',
    unilateral: true,
    muscles: [['front_delts', 1], ['abs', 0.8], ['obliques', 0.6], ['quads', 0.4]],
  },
  {
    id: 'trap-bar-deadlift',
    name: 'Trap Bar Deadlift',
    aliases: ['hex bar deadlift'],
    equipment: 'trap_bar',
    muscles: [['quads', 0.8], ['glutes', 1], ['hamstrings', 0.7], ['traps', 0.5], ['lower_back', 0.5]],
  },
  {
    id: 'sled-push',
    name: 'Sled Push',
    aliases: ['prowler'],
    equipment: 'sled',
    effort: 'distance',
    muscles: [['quads', 1], ['glutes', 0.8], ['calves', 0.5]],
  },
  {
    id: 'rowing-machine',
    name: 'Rowing Machine',
    aliases: ['erg', 'row erg'],
    equipment: 'cardio_machine',
    load: 'none',
    effort: 'distance',
    // The legs drive the stroke; the back finishes it. Primary mover gets the 1.0.
    muscles: [['quads', 1], ['upper_back', 0.8], ['lats', 0.6], ['glutes', 0.5], ['biceps', 0.3]],
  },
  {
    id: 'treadmill-run',
    name: 'Treadmill Run',
    aliases: ['run', 'running'],
    equipment: 'cardio_machine',
    load: 'none',
    effort: 'distance',
    muscles: [['calves', 1], ['quads', 0.7], ['hamstrings', 0.6], ['glutes', 0.5]],
  },
  {
    id: 'stationary-bike',
    name: 'Stationary Bike',
    aliases: ['bike', 'cycling'],
    equipment: 'cardio_machine',
    load: 'none',
    effort: 'distance',
    muscles: [['quads', 1], ['glutes', 0.5], ['calves', 0.3]],
  },
  {
    id: 'band-pull-apart',
    name: 'Band Pull-Apart',
    equipment: 'band',
    load: 'none',
    muscles: [['rear_delts', 1], ['upper_back', 0.6]],
  },
];

export const STARTER_CATALOGUE: readonly CatalogueEntry[] = SPECS.map(entry);

/** By id, for resolving a recent list or a routine reference back to an entry. */
export const CATALOGUE_BY_ID: ReadonlyMap<string, CatalogueEntry> = new Map(
  STARTER_CATALOGUE.map((item) => [item.id, item]),
);
