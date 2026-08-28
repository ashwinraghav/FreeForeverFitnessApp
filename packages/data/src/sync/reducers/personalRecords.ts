import type {
  AggregateEvent,
  AggregateReducer,
  AggregateReduceResult,
  PersonalRecordsAggregate,
} from '../../aggregates.js';
import { AGGREGATE_VERSIONS } from '../../aggregates.js';
import type { PersonalRecord, PrAchievement } from '../../schemas/records.js';
import { sortedKeys, unchanged, without } from './internal.js';

/**
 * The PR timeline.
 *
 * The simplest reducer of the five, because the source documents are already
 * shaped for it: one `personalRecords` document holds everything for one exercise
 * key, so the fold is literally "index the documents by id and flatten". No
 * internal collection is needed — `byExerciseKey` is keyed by the source document
 * id, which makes replace-by-id and the declared shape the same thing.
 */

function achievementsOf(record: PersonalRecord): readonly PrAchievement[] {
  // History holds every achievement; `current` can additionally hold ones that
  // predate history's cap or were written before history existed. Union, deduped.
  const seen = new Set<string>();
  const all: PrAchievement[] = [];
  for (const achievement of [...record.history, ...Object.values(record.current)]) {
    const key = `${achievement.type}|${achievement.achievedAt}|${achievement.workoutId}|${achievement.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(achievement);
  }
  // Newest first, with a total order so derive is deterministic.
  return all.sort(
    (a, b) => b.achievedAt - a.achievedAt || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
  );
}

function derive(
  byExerciseKey: Readonly<Record<string, readonly PrAchievement[]>>,
): PersonalRecordsAggregate {
  const achievements: PrAchievement[] = [];
  for (const key of sortedKeys(byExerciseKey)) {
    achievements.push(...(byExerciseKey[key] as readonly PrAchievement[]));
  }
  achievements.sort(
    (a, b) => b.achievedAt - a.achievedAt || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
  );
  return { kind: 'personal_records', achievements, byExerciseKey };
}

function reduce(
  state: PersonalRecordsAggregate,
  event: AggregateEvent,
): AggregateReduceResult<'personal_records'> {
  if (event.kind !== 'personalRecord') return unchanged(state);
  try {
    const remaining = without(state.byExerciseKey, event.id);
    if (event.next === null) return { state: derive(remaining), dropped: [] };
    return {
      state: derive({ ...remaining, [event.id]: achievementsOf(event.next) }),
      dropped: [],
    };
  } catch (error) {
    return { state, dropped: [{ id: event.id, reason: String(error) }] };
  }
}

export const personalRecordsReducer: AggregateReducer<'personal_records'> = {
  id: 'personal_records',
  version: AGGREGATE_VERSIONS.personal_records,
  handles: ['personalRecord'],
  empty: () => derive({}),
  reduce,
  rebuild: (snapshot) => {
    const byExerciseKey: Record<string, readonly PrAchievement[]> = {};
    for (const record of snapshot.personalRecords) {
      byExerciseKey[record.id] = achievementsOf(record);
    }
    return derive(byExerciseKey);
  },
};
