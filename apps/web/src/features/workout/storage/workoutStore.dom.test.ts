import { beforeEach, describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession } from '../model/history.js';
import { startWorkout, workoutReducer } from '../model/session.js';
import { startRest } from '../timer/restTimer.js';
import {
  localWorkoutRepository,
  MAX_DISCARDED_SESSIONS,
  MAX_LOCAL_HISTORY,
  memoryWorkoutRepository,
  WORKOUT_STORAGE_KEYS,
} from './workoutStore.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'bench-press')!);
const NOW = 1_760_000_000_000;

function loggedSession(now = NOW) {
  const started = workoutReducer(startWorkout({ now }), {
    type: 'add_exercise',
    exercise: bench,
    sets: 2,
    now,
  });
  const exercise = started.workout.exercises[0]!;
  return workoutReducer(started, {
    type: 'set_set_state',
    exerciseId: exercise.id,
    setId: exercise.sets[0]!.id,
    state: 'completed',
    commit: { weightKg: 100, reps: 5 },
    now,
  });
}

beforeEach(() => {
  for (const key of WORKOUT_STORAGE_KEYS) localStorage.removeItem(key);
});

describe('the session survives a kill', () => {
  it('comes back with every entered number intact', () => {
    const state = loggedSession();
    localWorkoutRepository.saveActive(state.workout);

    // A fresh read is exactly what happens after the app is force-quit and reopened.
    const revived = localWorkoutRepository.loadActive();
    expect(revived?.id).toBe(state.workout.id);
    expect(revived?.exercises[0]?.sets[0]?.weightKg).toBe(100);
    expect(revived?.exercises[0]?.sets[0]?.reps).toBe(5);
    expect(revived?.exercises[0]?.sets[0]?.state).toBe('completed');
    // The untouched second set stays untouched — `null`, not zero.
    expect(revived?.exercises[0]?.sets[1]?.weightKg).toBeNull();
  });

  it('does not resurrect a finished session as though it were still running', () => {
    const finished = workoutReducer(loggedSession(), { type: 'finish', now: NOW + 1000 });
    localWorkoutRepository.saveActive(finished.workout);
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('does not resurrect a discarded one either', () => {
    const discarded = workoutReducer(loggedSession(), { type: 'discard', now: NOW + 1000 });
    localWorkoutRepository.saveActive(discarded.workout);
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('clears on an explicit null', () => {
    localWorkoutRepository.saveActive(loggedSession().workout);
    localWorkoutRepository.saveActive(null);
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('is null when there is nothing stored', () => {
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });
});

describe('the rest timer survives a kill', () => {
  it('comes back as the two numbers it always was', () => {
    const rest = startRest('x1', 's1', 90, NOW);
    localWorkoutRepository.saveRest(rest);
    const revived = localWorkoutRepository.loadRest();
    expect(revived).toEqual(rest);
    // Which is the whole point: nothing was counting, so nothing was lost.
    expect(revived?.startedAt).toBe(NOW);
  });

  it('clears on null', () => {
    localWorkoutRepository.saveRest(startRest('x1', 's1', 90, NOW));
    localWorkoutRepository.saveRest(null);
    expect(localWorkoutRepository.loadRest()).toBeNull();
  });
});

describe('corrupt or foreign data never takes the screen down', () => {
  const [activeKey] = WORKOUT_STORAGE_KEYS;

  it('ignores unparseable JSON', () => {
    localStorage.setItem(activeKey, 'not json {{{');
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('ignores an envelope from a version this build does not know', () => {
    localStorage.setItem(activeKey, JSON.stringify({ v: 99, data: { id: 'w1' } }));
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('ignores a payload of the wrong shape', () => {
    localStorage.setItem(
      activeKey,
      JSON.stringify({ v: 1, data: { id: 'w1', status: 'in_progress', exercises: 'nope' } }),
    );
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('ignores an exercise whose sets are not a list', () => {
    localStorage.setItem(
      activeKey,
      JSON.stringify({
        v: 1,
        data: { id: 'w1', status: 'in_progress', startedAt: NOW, exercises: [{ sets: null }] },
      }),
    );
    expect(localWorkoutRepository.loadActive()).toBeNull();
  });

  it('treats a non-array history as empty', () => {
    localStorage.setItem(WORKOUT_STORAGE_KEYS[2], JSON.stringify({ v: 1, data: { nope: true } }));
    expect(localWorkoutRepository.loadHistory()).toEqual([]);
  });
});

describe('history', () => {
  it('appends, newest last', () => {
    localWorkoutRepository.putSession(toCompletedSession(loggedSession(NOW - 1000).workout));
    localWorkoutRepository.putSession(toCompletedSession(loggedSession(NOW).workout));
    const stored = localWorkoutRepository.loadHistory();
    expect(stored).toHaveLength(2);
    expect(stored[1]?.startedAt).toBe(NOW);
  });

  it('replaces rather than duplicates when the same session is written twice', () => {
    const session = toCompletedSession(loggedSession().workout);
    localWorkoutRepository.putSession(session);
    localWorkoutRepository.putSession(session);
    expect(localWorkoutRepository.loadHistory()).toHaveLength(1);
  });

  it('is bounded, because free-forever rule 2 applies to bytes too', () => {
    for (let i = 0; i < MAX_LOCAL_HISTORY + 15; i += 1) {
      localWorkoutRepository.putSession(toCompletedSession(loggedSession(NOW + i * 1000).workout));
    }
    const stored = localWorkoutRepository.loadHistory();
    expect(stored).toHaveLength(MAX_LOCAL_HISTORY);
    // The recent end is what everything reads, so the recent end is what is kept.
    expect(stored[stored.length - 1]?.startedAt).toBe(NOW + (MAX_LOCAL_HISTORY + 14) * 1000);
  });
});

describe('a browser with no storage at all', () => {
  it('degrades to in-memory rather than throwing', () => {
    // Safari private browsing, a full quota and a locked-down webview all land here.
    const repository = memoryWorkoutRepository();
    const state = loggedSession();
    repository.saveActive(state.workout);
    expect(repository.loadActive()?.exercises[0]?.sets[0]?.weightKg).toBe(100);
    repository.putSession(toCompletedSession(state.workout));
    expect(repository.loadHistory()).toHaveLength(1);
  });

  it('bounds its history the same way', () => {
    const repository = memoryWorkoutRepository();
    for (let i = 0; i < MAX_LOCAL_HISTORY + 5; i += 1) {
      repository.putSession(toCompletedSession(loggedSession(NOW + i * 1000).workout));
    }
    expect(repository.loadHistory()).toHaveLength(MAX_LOCAL_HISTORY);
  });
});

describe('retracting a session, and why tombstones live in their own key', () => {
  /*
   * The design this replaces put `status: 'discarded'` inline in the history array. It
   * is not merely untidy — `data/workoutDocuments.ts` maps a session to a `Workout`
   * with `status: 'completed'` hard-coded, so a build that predates the `status` field
   * would read a retracted session straight back out of `history` and fold it into the
   * user's volume totals and their all-time personal records. A workout they deleted
   * would come back as a PR. `registerType: 'prompt'` means declining an update is not
   * a narrow window.
   */
  function twoSessions() {
    const older = toCompletedSession(
      workoutReducer(loggedSession(NOW - 86_400_000), { type: 'finish', now: NOW - 86_000_000 })
        .workout,
    );
    const newer = toCompletedSession(
      workoutReducer(loggedSession(NOW), { type: 'finish', now: NOW + 3600_000 }).workout,
    );
    localWorkoutRepository.putSession(older);
    localWorkoutRepository.putSession(newer);
    return { older, newer };
  }

  it('takes a retracted session out of the list every consumer reads', () => {
    const { older, newer } = twoSessions();
    expect(localWorkoutRepository.discardSession(older.id)?.id).toBe(older.id);

    const remaining = localWorkoutRepository.loadHistory();
    expect(remaining.map((session) => session.id)).toEqual([newer.id]);
  });

  it('leaves the history key itself with no trace of it', () => {
    // This is the assertion that matters for an old reader: not "loadHistory filters it"
    // but "there is nothing there to filter". An old bundle never sees it at all.
    const { older } = twoSessions();
    localWorkoutRepository.discardSession(older.id);

    const raw = localStorage.getItem('ff.workout.history.v1') ?? '';
    expect(raw).not.toContain(older.id);
    expect(raw).not.toContain('discarded');
  });

  it('keeps the tombstone where a future sync layer can find it', () => {
    const { older } = twoSessions();
    localWorkoutRepository.discardSession(older.id);

    // Retraction is an update carrying `status: 'discarded'` (ADR-0029), not an erasure.
    const found = localWorkoutRepository.findSession(older.id);
    expect(found?.id).toBe(older.id);
    expect(found?.status).toBe('discarded');
  });

  it('hands the session back un-retracted, so undo restores a workout not a deletion', () => {
    const { older } = twoSessions();
    const removed = localWorkoutRepository.discardSession(older.id);
    expect(removed?.status).toBeUndefined();

    localWorkoutRepository.putSession(removed!);
    expect(localWorkoutRepository.loadHistory().map((s) => s.id)).toContain(older.id);
  });

  it('clears the tombstone on undo, so the session is not both present and deleted', () => {
    const { older } = twoSessions();
    localWorkoutRepository.putSession(localWorkoutRepository.discardSession(older.id)!);

    const found = localWorkoutRepository.findSession(older.id);
    expect(found?.status).toBeUndefined();
    expect(localStorage.getItem('ff.workout.discarded.v1') ?? '').not.toContain(older.id);
  });

  it('returns null for a session that was never there', () => {
    expect(localWorkoutRepository.discardSession('nope')).toBeNull();
    expect(localWorkoutRepository.findSession('nope')).toBeNull();
  });

  it('does not let tombstones compete with the live session cap', () => {
    // The two caps are independent, which is the other reason for the separate key:
    // deleting sessions cannot evict the live ones the ghosts and the strip read.
    for (let i = 0; i < MAX_LOCAL_HISTORY; i += 1) {
      localWorkoutRepository.putSession(
        toCompletedSession(
          workoutReducer(loggedSession(NOW + i * 1000), { type: 'finish', now: NOW + i * 1000 })
            .workout,
        ),
      );
    }
    const before = localWorkoutRepository.loadHistory();
    expect(before).toHaveLength(MAX_LOCAL_HISTORY);

    localWorkoutRepository.discardSession(before[0]!.id);
    expect(localWorkoutRepository.loadHistory()).toHaveLength(MAX_LOCAL_HISTORY - 1);
    expect(localWorkoutRepository.findSession(before[0]!.id)?.status).toBe('discarded');
  });

  it('bounds the tombstones too', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_DISCARDED_SESSIONS + 3; i += 1) {
      const session = toCompletedSession(
        workoutReducer(loggedSession(NOW + i * 1000), { type: 'finish', now: NOW + i * 1000 })
          .workout,
      );
      ids.push(session.id);
      localWorkoutRepository.putSession(session);
      localWorkoutRepository.discardSession(session.id);
    }
    // Free-forever rule 1: nothing per-user may grow without a bound.
    const kept = ids.filter((id) => localWorkoutRepository.findSession(id) !== null);
    expect(kept).toHaveLength(MAX_DISCARDED_SESSIONS);
  });

  it('behaves the same in memory as on disk', () => {
    // The port exists so the Firestore-backed implementation drops in unchanged; a
    // memory version that disagreed about retraction would make every test that uses it
    // a test of something else.
    const repository = memoryWorkoutRepository();
    const session = toCompletedSession(
      workoutReducer(loggedSession(NOW), { type: 'finish', now: NOW + 1000 }).workout,
    );
    repository.putSession(session);
    expect(repository.discardSession(session.id)?.id).toBe(session.id);
    expect(repository.loadHistory()).toHaveLength(0);
    expect(repository.findSession(session.id)?.status).toBe('discarded');
    repository.putSession(session);
    expect(repository.loadHistory()).toHaveLength(1);
    expect(repository.findSession(session.id)?.status).toBeUndefined();
  });
});

describe('putSession is an upsert, which is what makes editing possible at all', () => {
  it('replaces by id rather than appending a second copy', () => {
    // The old name, `appendHistory`, said the opposite of what the body did — and that
    // is why the project went months believing a past session could not be edited.
    const session = toCompletedSession(
      workoutReducer(loggedSession(NOW), { type: 'finish', now: NOW + 1000 }).workout,
    );
    localWorkoutRepository.putSession(session);
    localWorkoutRepository.putSession({ ...session, bodyweightKg: 81 });

    const history = localWorkoutRepository.loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.bodyweightKg).toBe(81);
  });
});
