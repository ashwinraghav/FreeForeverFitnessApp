import { beforeEach, describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession } from '../model/history.js';
import { startWorkout, workoutReducer } from '../model/session.js';
import { startRest } from '../timer/restTimer.js';
import {
  localWorkoutRepository,
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
    localWorkoutRepository.appendHistory(toCompletedSession(loggedSession(NOW - 1000).workout));
    localWorkoutRepository.appendHistory(toCompletedSession(loggedSession(NOW).workout));
    const stored = localWorkoutRepository.loadHistory();
    expect(stored).toHaveLength(2);
    expect(stored[1]?.startedAt).toBe(NOW);
  });

  it('replaces rather than duplicates when the same session is written twice', () => {
    const session = toCompletedSession(loggedSession().workout);
    localWorkoutRepository.appendHistory(session);
    localWorkoutRepository.appendHistory(session);
    expect(localWorkoutRepository.loadHistory()).toHaveLength(1);
  });

  it('is bounded, because free-forever rule 2 applies to bytes too', () => {
    for (let i = 0; i < MAX_LOCAL_HISTORY + 15; i += 1) {
      localWorkoutRepository.appendHistory(toCompletedSession(loggedSession(NOW + i * 1000).workout));
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
    repository.appendHistory(toCompletedSession(state.workout));
    expect(repository.loadHistory()).toHaveLength(1);
  });

  it('bounds its history the same way', () => {
    const repository = memoryWorkoutRepository();
    for (let i = 0; i < MAX_LOCAL_HISTORY + 5; i += 1) {
      repository.appendHistory(toCompletedSession(loggedSession(NOW + i * 1000).workout));
    }
    expect(repository.loadHistory()).toHaveLength(MAX_LOCAL_HISTORY);
  });
});
