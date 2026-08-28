import type {
  ExerciseProgressAggregate,
  LocalDate,
  MassDisplayUnit,
  PersonalRecordsAggregate,
  PrAchievement,
  PrType,
} from '@freeforever/data';
import { formatMass, percentChange } from './format';
import { parseLocalDate } from './weeks';

/**
 * Personal records.
 *
 * Built from `byExerciseKey`, not from the flat `achievements` list.
 *
 * That is not a preference. `PrAchievement` carries the value, the date and the
 * workout id but no exercise identity, so a record read out of the flat list cannot
 * be labelled with the lift it belongs to — "102.5 kg" on its own is not a record,
 * it is a number. The keyed map supplies the identity, and `exercise_progress`
 * supplies the display name for that key. Reported as a contract gap: the flat list
 * wants an `exerciseKey` on each entry (or the aggregate wants a pre-joined timeline).
 */

export interface PrEntry {
  readonly exerciseKey: string;
  readonly exerciseName: string;
  readonly type: PrType;
  readonly typeLabel: string;
  readonly achievedOn: LocalDate;
  readonly achievedAt: number;
  readonly value: number;
  readonly previousValue: number | null;
  /** No previous value: the first time this lift was measured this way. */
  readonly isFirst: boolean;
  readonly reps: number | null;
  readonly loadKg: number | null;
}

const PR_TYPE_LABELS: Readonly<Record<PrType, string>> = {
  heaviest_weight: 'Heaviest weight',
  best_e1rm: 'Best estimated 1RM',
  most_reps: 'Most reps',
  best_set_volume: 'Best set volume',
  best_session_volume: 'Best session volume',
  best_duration: 'Longest hold',
  best_distance: 'Furthest',
};

/** How the canonical `value` should be read, per type. */
const PR_TYPE_UNITS: Readonly<Record<PrType, 'mass' | 'reps' | 'seconds' | 'metres'>> = {
  heaviest_weight: 'mass',
  best_e1rm: 'mass',
  most_reps: 'reps',
  best_set_volume: 'mass',
  best_session_volume: 'mass',
  best_duration: 'seconds',
  best_distance: 'metres',
};

export function prTypeLabel(type: PrType): string {
  return PR_TYPE_LABELS[type];
}

export function formatPrValue(
  entry: Pick<PrEntry, 'type' | 'value'>,
  unit: MassDisplayUnit,
): string {
  switch (PR_TYPE_UNITS[entry.type]) {
    case 'mass':
      return formatMass(entry.value, unit, entry.type === 'best_e1rm' ? 1 : 2);
    case 'reps':
      return `${Math.round(entry.value)} reps`;
    case 'seconds':
      return entry.value >= 60
        ? `${Math.floor(entry.value / 60)}m ${Math.round(entry.value % 60)}s`
        : `${Math.round(entry.value)}s`;
    case 'metres':
      return entry.value >= 1000
        ? `${(entry.value / 1000).toFixed(2)} km`
        : `${Math.round(entry.value)} m`;
  }
}

function displayNames(
  progress: ExerciseProgressAggregate | null,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const series of progress?.series ?? []) names.set(series.exerciseKey, series.displayName);
  return names;
}

function toEntry(
  exerciseKey: string,
  exerciseName: string,
  achievement: PrAchievement,
): PrEntry {
  return {
    exerciseKey,
    exerciseName,
    type: achievement.type,
    typeLabel: PR_TYPE_LABELS[achievement.type],
    achievedOn: achievement.achievedOn,
    achievedAt: achievement.achievedAt,
    value: achievement.value,
    previousValue: achievement.previousValue ?? null,
    isFirst: achievement.previousValue === undefined,
    reps: achievement.reps ?? null,
    loadKg: achievement.loadKg ?? null,
  };
}

/**
 * The timeline, newest first.
 *
 * Every record is listed once, on the day it happened, and that is the whole
 * treatment. No badge tiers, no "you are on fire", no confetti — constitution rule 6
 * and the anti-engagement-bait line in ADR-0013. A record is worth something because
 * it is rare and true, and a screen that celebrates it also has to celebrate the
 * fourteen sessions that were not one, which is how a log turns into a slot machine.
 */
export function prTimeline(
  records: PersonalRecordsAggregate | null,
  progress: ExerciseProgressAggregate | null,
  options: { readonly limit?: number; readonly since?: LocalDate } = {},
): readonly PrEntry[] {
  const names = displayNames(progress);
  const entries: PrEntry[] = [];

  for (const [exerciseKey, achievements] of Object.entries(records?.byExerciseKey ?? {})) {
    const name = names.get(exerciseKey) ?? exerciseKey;
    for (const achievement of achievements) {
      if (options.since !== undefined && achievement.achievedOn < options.since) continue;
      entries.push(toEntry(exerciseKey, name, achievement));
    }
  }

  entries.sort(
    (a, b) =>
      b.achievedAt - a.achievedAt ||
      b.achievedOn.localeCompare(a.achievedOn) ||
      a.exerciseName.localeCompare(b.exerciseName) ||
      a.type.localeCompare(b.type),
  );

  return options.limit === undefined ? entries : entries.slice(0, options.limit);
}

/** Percentage improvement over what this record beat, or null for a first record. */
export function prImprovement(entry: PrEntry): number | null {
  return entry.previousValue === null ? null : percentChange(entry.value, entry.previousValue);
}

export interface PrCounts {
  readonly total: number;
  readonly last30Days: number;
  readonly last90Days: number;
  readonly exercises: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Counts, stated flatly. `last30Days` is a count of events, not a score, and nothing
 * downstream compares it to a target — there is no target, and inventing one would
 * make a quiet month into a failure.
 */
export function prCounts(entries: readonly PrEntry[], today: LocalDate): PrCounts {
  const now = parseLocalDate(today);
  const withinDays = (entry: PrEntry, days: number): boolean => {
    if (now === null) return false;
    const achieved = parseLocalDate(entry.achievedOn);
    return achieved !== null && now.getTime() - achieved.getTime() <= days * MS_PER_DAY;
  };
  return {
    total: entries.length,
    last30Days: entries.filter((entry) => withinDays(entry, 30)).length,
    last90Days: entries.filter((entry) => withinDays(entry, 90)).length,
    exercises: new Set(entries.map((entry) => entry.exerciseKey)).size,
  };
}
