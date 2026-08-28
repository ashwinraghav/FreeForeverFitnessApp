import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession } from '../model/history.js';
import { startWorkout, workoutReducer } from '../model/session.js';
import {
  memoryWorkoutRepository,
  type WorkoutRepository,
} from '../storage/workoutStore.js';
import { ActiveWorkoutScreen, elapsed } from './ActiveWorkoutScreen.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'bench-press')!);
const NOW = 1_760_000_000_000;

let clock = NOW;
const now = () => clock;

beforeEach(() => {
  clock = NOW;
  // A jsdom AudioContext does not exist, and `navigator.vibrate` does not either. Both
  // paths are feature-detected in `feedback.ts`; this just keeps the console quiet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A repository whose history already contains one bench session at 100x5. */
function repositoryWithHistory(): WorkoutRepository {
  const repository = memoryWorkoutRepository();
  const past = workoutReducer(startWorkout({ now: NOW - 7 * 86_400_000 }), {
    type: 'add_exercise',
    exercise: bench,
    sets: 3,
    now: NOW - 7 * 86_400_000,
  });
  const exercise = past.workout.exercises[0]!;
  const logged = exercise.sets.reduce(
    (state, set) =>
      workoutReducer(state, {
        type: 'set_set_state',
        exerciseId: exercise.id,
        setId: set.id,
        state: 'completed',
        commit: { weightKg: 100, reps: 5 },
        now: NOW - 7 * 86_400_000,
      }),
    past,
  );
  const finished = workoutReducer(logged, { type: 'finish', now: NOW - 7 * 86_400_000 + 3600_000 });
  repository.appendHistory(toCompletedSession(finished.workout));
  return repository;
}

/** A repository whose *active* session is already laid out, as after an app kill. */
function repositoryWithActiveSession(): WorkoutRepository {
  const repository = repositoryWithHistory();
  const started = workoutReducer(startWorkout({ now: NOW }), {
    type: 'add_exercise',
    exercise: bench,
    sets: 3,
    now: NOW,
  });
  repository.saveActive(started.workout);
  return repository;
}

function mountScreen(repository: WorkoutRepository) {
  return render(
    <ActiveWorkoutScreen repository={repository} now={now} onFinished={() => undefined} />,
  );
}

/** The next un-logged set's button. Re-queried each time: the row re-renders. */
const nextLogButton = () => screen.getAllByRole('button', { name: /^Log as made/ })[0]!;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const weightCell = () => screen.getAllByRole('button', { name: /Weight:/ })[0]!;

/** Open the picker and choose a lift by name, the way a thumb does. */
function pickExercise(name: string | RegExp): void {
  fireEvent.click(button(/Exercise$/));
  fireEvent.click(within(screen.getByRole('list', { name: 'Exercises' })).getByRole('button', { name }));
}

describe('cold start to a logged set', () => {
  it('resumes the session that was in progress on the very first paint', () => {
    // No "resume?" prompt, no loading state, no effect that runs after the first
    // frame. The lifter opens the app under a bar and the session is already there.
    const view = mountScreen(repositoryWithActiveSession());
    expect(view.container.textContent).toContain('Bench Press');
    expect(view.container.querySelectorAll('.ffw-row')).toHaveLength(3);
  });

  it('logs a repeat set in ONE tap, with last session already ghosted in', () => {
    // This is the Phase 0 headline test, reduced to the thing that can be asserted:
    // from the screen the app opens on, a made set is a single interaction.
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    const first = nextLogButton();
    fireEvent.click(first);

    const saved = repository.loadActive();
    const set = saved?.exercises[0]?.sets[0];
    expect(set?.state).toBe('completed');
    expect(set?.weightKg).toBe(100);
    expect(set?.reps).toBe(5);
    expect(set?.performedAt).toBe(NOW);
  });

  it('logs the whole exercise in three taps', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    for (let i = 0; i < 3; i += 1) {
      // Re-query each time: the row re-renders as its state changes.
      const next = nextLogButton();
      fireEvent.click(next);
    }

    const saved = repository.loadActive();
    expect(saved?.exercises[0]?.sets.every((set) => set.state === 'completed')).toBe(true);
    expect(saved?.exercises[0]?.sets.every((set) => set.weightKg === 100)).toBe(true);
  });

  it('starts a fresh empty session when there is nothing to resume', () => {
    const view = mountScreen(repositoryWithHistory());
    expect(view.container.textContent).toContain('Nothing logged yet');
  });
});

describe('the one-tap claim, driven by a real pointer sequence', () => {
  /**
   * `user-event` rather than `fireEvent` for this one case, because this is the claim
   * the whole feature is judged on. `fireEvent.click` dispatches one synthetic event;
   * `user-event` performs the sequence a thumb actually produces — pointerdown,
   * mousedown, focus, pointerup, mouseup, click — against a control it first checks is
   * visible and not disabled. If the log button were covered by the rest bar, or
   * disabled, or not really focusable, this fails and `fireEvent` would not.
   */
  it('logs a completed set with last session’s numbers from a single tap', async () => {
    const user = userEvent.setup();
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    // Before: nothing entered. The row is showing ghosts, and the store agrees they
    // are not data.
    const before = repository.loadActive()?.exercises[0]?.sets[0];
    expect(before?.state).toBe('pending');
    expect(before?.weightKg).toBeNull();
    expect(before?.reps).toBeNull();

    await user.click(nextLogButton());

    const after = repository.loadActive()?.exercises[0]?.sets[0];
    expect(after?.state).toBe('completed');
    expect(after?.weightKg).toBe(100);
    expect(after?.reps).toBe(5);
    expect(after?.performedAt).toBe(NOW);
  });

  it('never commits a ghost onto a set the lifter did not log', async () => {
    // The failure this guards against: the pre-fill leaking into rows two and three
    // as though they had been performed. Ghosts are a rendering concern only until an
    // explicit tap promotes one.
    const user = userEvent.setup();
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    await user.click(nextLogButton());

    const sets = repository.loadActive()?.exercises[0]?.sets ?? [];
    expect(sets).toHaveLength(3);
    for (const set of sets.slice(1)) {
      expect(set.state).toBe('pending');
      expect(set.weightKg).toBeNull();
      expect(set.reps).toBeNull();
      expect(set.performedAt).toBeUndefined();
    }
  });

  it('never writes a ghost for an exercise the lifter never logged', async () => {
    const user = userEvent.setup();
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    await user.click(nextLogButton());
    fireEvent.click(button('Finish'));

    // The finished session in history must contain one completed set and two
    // untouched ones — not three sets at 100x5.
    const history = repository.loadHistory();
    const saved = history[history.length - 1]?.exercises[0]?.sets ?? [];
    expect(saved.filter((set) => set.state === 'completed')).toHaveLength(1);
    expect(saved.filter((set) => set.weightKg === 100)).toHaveLength(1);
  });

  it('takes two taps to record a miss, and keeps the numbers', async () => {
    const user = userEvent.setup();
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    await user.click(nextLogButton());
    await user.click(screen.getByRole('button', { name: /^Mark as missed: Bench Press, set 1/ }));

    const set = repository.loadActive()?.exercises[0]?.sets[0];
    expect(set?.state).toBe('failed');
    // A failed set is real work: the load and the reps that were made stay.
    expect(set?.weightKg).toBe(100);
    expect(set?.reps).toBe(5);
  });
});

describe('every change is persisted immediately', () => {
  it('writes the session on the first log, not on unmount', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());
    // Read before unmounting: the app can be killed between any two frames.
    expect(repository.loadActive()?.exercises[0]?.sets[0]?.state).toBe('completed');
  });

  it('survives a remount with everything intact', () => {
    const repository = repositoryWithActiveSession();
    const first = mountScreen(repository);
    fireEvent.click(nextLogButton());

    // A whole new component tree, reading only what is on disk.
    const second = mountScreen(repository);
    const rows = second.container.querySelectorAll('.ffw-row');
    expect(rows[0]?.getAttribute('data-ff-state')).toBe('completed');
    expect(rows[1]?.getAttribute('data-ff-state')).toBe('pending');
  });

  it('keeps a typed value across a remount', () => {
    const repository = repositoryWithActiveSession();
    const first = mountScreen(repository);
    fireEvent.click(weightCell());
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '102.5' } });

    const second = mountScreen(repository);
    const cell = second.container.querySelector('.ffw-cell');
    expect(cell?.getAttribute('data-ff-source')).toBe('entered');
    expect(cell?.textContent).toContain('102.5');
  });
});

describe('the rest timer', () => {
  it('appears after a set is logged and counts from the moment of the tap', () => {
    const repository = repositoryWithActiveSession();
    const view = mountScreen(repository);
    expect(view.container.querySelector('.ffw-restbar')).toBeNull();

    fireEvent.click(nextLogButton());
    expect(view.container.querySelector('.ffw-restbar')).not.toBeNull();
    expect(view.container.querySelector('.ffw-restbar__clock')?.textContent).toBe('2:00');

    const stored = repository.loadRest();
    expect(stored?.startedAt).toBe(NOW);
    expect(stored?.durationSec).toBe(120);
  });

  it('shows the right number after a gap with no ticks — the backgrounding case', () => {
    const repository = repositoryWithActiveSession();
    const first = mountScreen(repository);
    fireEvent.click(nextLogButton());

    // Ninety seconds pass with the app closed. Nothing ticked; nothing counted.
    clock = NOW + 90_000;
    const second = mountScreen(repository);
    expect(second.container.querySelector('.ffw-restbar__clock')?.textContent).toBe('0:30');
  });

  it('counts up in overtime rather than vanishing at zero', () => {
    const repository = repositoryWithActiveSession();
    const first = mountScreen(repository);
    fireEvent.click(nextLogButton());

    clock = NOW + 135_000;
    const second = mountScreen(repository);
    const bar = second.container.querySelector('.ffw-restbar');
    expect(bar?.getAttribute('data-ff-done')).toBe('true');
    expect(second.container.querySelector('.ffw-restbar__clock')?.textContent).toBe('-0:15');
    // Done is a colour AND a sign AND a changed label.
    expect(bar?.textContent).toContain('Rest over');
  });

  it('logs the rest actually taken, not the rest prescribed', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());

    // Four minutes of chatting on a two-minute timer.
    clock = NOW + 240_000;
    fireEvent.click(nextLogButton());

    const second = repository.loadActive()?.exercises[0]?.sets[1];
    expect(second?.restSecBefore).toBe(240);
  });

  it('is cleared when the session finishes', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());
    expect(repository.loadRest()).not.toBeNull();
    fireEvent.click(button('Finish'));
    expect(repository.loadRest()).toBeNull();
  });
});

describe('no modals, anywhere in the flow', () => {
  it('opens the exercise picker as a non-blocking sheet', () => {
    mountScreen(repositoryWithHistory());
    fireEvent.click(button(/Add exercise$/));
    const sheet = document.querySelector('.ff-sheet');
    expect(sheet).not.toBeNull();
    // A region, not a dialog; and no scrim, so the session behind stays live.
    expect(sheet?.getAttribute('role')).toBe('region');
    expect(sheet?.getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('[data-ff-scrim]')).toBeNull();
  });

  it('never renders a native dialog while a session is on screen', () => {
    mountScreen(repositoryWithActiveSession());
    fireEvent.click(weightCell());
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('offers an undo instead of a confirmation when a set is removed', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);

    fireEvent.click(weightCell());
    fireEvent.click(button(/^Remove Bench Press, set 1/));
    expect(repository.loadActive()?.exercises[0]?.sets).toHaveLength(2);

    const toast = document.querySelector('.ff-toast');
    expect(toast?.textContent).toContain('Removed set');
    fireEvent.click(within(toast as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(repository.loadActive()?.exercises[0]?.sets).toHaveLength(3);
  });

  it('puts a removed exercise back with its logged sets intact', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());

    fireEvent.click(button('Remove'));
    expect(repository.loadActive()?.exercises).toHaveLength(0);

    fireEvent.click(
      within(document.querySelector('.ff-toast') as HTMLElement).getByRole('button', {
        name: 'Undo',
      }),
    );
    const restored = repository.loadActive()?.exercises[0];
    expect(restored?.sets[0]?.state).toBe('completed');
    expect(restored?.sets[0]?.weightKg).toBe(100);
  });
});

describe('adding and reordering mid-session', () => {
  it('adds an exercise from the picker without touching what is already logged', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());

    pickExercise(/Back Squat/);

    const saved = repository.loadActive();
    expect(saved?.exercises).toHaveLength(2);
    expect(saved?.exercises[0]?.sets[0]?.weightKg).toBe(100);
  });

  it('adds a set to an exercise mid-session', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(button(/^Set$/));
    expect(repository.loadActive()?.exercises[0]?.sets).toHaveLength(4);
  });

  it('reorders exercises without losing entered data', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());

    pickExercise(/Back Squat/);

    fireEvent.click(button('Move Back Squat up'));

    const saved = repository.loadActive();
    const sorted = [...(saved?.exercises ?? [])].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    expect(sorted[0]?.exercise.name).toBe('Back Squat');
    expect(sorted[1]?.sets[0]?.weightKg).toBe(100);
    expect(sorted[1]?.sets[0]?.state).toBe('completed');
  });
});

describe('history is on screen, not behind a tap', () => {
  it('shows the last outing under the exercise', () => {
    const view = mountScreen(repositoryWithActiveSession());
    expect(view.container.querySelector('.ffw-history')?.textContent).toContain('100x5 x3');
  });

  it('says so plainly for a lift never done before', () => {
    const repository = memoryWorkoutRepository();
    const started = workoutReducer(startWorkout({ now: NOW }), {
      type: 'add_exercise',
      exercise: bench,
      sets: 1,
      now: NOW,
    });
    repository.saveActive(started.workout);
    const view = mountScreen(repository);
    expect(view.container.textContent).toContain('First time');
  });
});

describe('the deterministic coach', () => {
  it('shows what the progression rules say to do next', () => {
    // Last session was 3x5 at 100kg, which is under the 8-12 default range, so the
    // rule says add a rep at the same weight. No model, no network, no cost.
    const view = mountScreen(repositoryWithActiveSession());
    expect(view.container.querySelector('.ffw-note')?.textContent).toContain('Next: 100kg x6');
  });

  it('says nothing at all for a lift with no history', () => {
    const repository = memoryWorkoutRepository();
    const started = workoutReducer(startWorkout({ now: NOW }), {
      type: 'add_exercise',
      exercise: bench,
      sets: 1,
      now: NOW,
    });
    repository.saveActive(started.workout);
    const view = mountScreen(repository);
    expect(view.container.querySelector('.ffw-note')).toBeNull();
  });

  it('marks a personal record as soon as the set is logged', () => {
    const repository = repositoryWithActiveSession();
    const view = mountScreen(repository);
    expect(view.container.querySelector('.ff-badge')).toBeNull();

    // 100kg for 5 equals last session rather than beating it, so bump the weight.
    fireEvent.click(weightCell());
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '105' } });
    fireEvent.click(nextLogButton());

    const badges = [...view.container.querySelectorAll('.ff-badge')].map(
      (badge) => badge.textContent,
    );
    expect(badges.join(' ')).toContain('Heaviest PR');
  });

  it('does not mark a PR for a set that only equalled the best', () => {
    const repository = repositoryWithActiveSession();
    const view = mountScreen(repository);
    fireEvent.click(nextLogButton());
    expect(view.container.querySelector('.ff-badge')).toBeNull();
  });
});

describe('finishing', () => {
  it('writes the session to history and clears the active slot', () => {
    const repository = repositoryWithActiveSession();
    mountScreen(repository);
    fireEvent.click(nextLogButton());
    clock = NOW + 1_800_000;
    fireEvent.click(button('Finish'));

    expect(repository.loadActive()).toBeNull();
    const history = repository.loadHistory();
    expect(history).toHaveLength(2);
    expect(history[1]?.exercises[0]?.sets[0]?.weightKg).toBe(100);
  });

  it('cannot be tapped with nothing in the session', () => {
    mountScreen(repositoryWithHistory());
    expect(button('Finish')).toHaveProperty('disabled', true);
  });
});

describe('the running total', () => {
  it('counts only completed sets and their volume', () => {
    const repository = repositoryWithActiveSession();
    const view = mountScreen(repository);
    expect(view.container.querySelector('.ffw-summary')?.textContent).toContain('0 sets');

    fireEvent.click(nextLogButton());
    const summary = view.container.querySelector('.ffw-summary')?.textContent;
    expect(summary).toContain('1 sets');
    expect(summary).toContain('500 kg');
  });

  it('does not count a missed set toward volume', () => {
    const repository = repositoryWithActiveSession();
    const view = mountScreen(repository);
    fireEvent.click(nextLogButton());
    fireEvent.click(button(/^Mark as missed: Bench Press, set 1/));
    expect(view.container.querySelector('.ffw-summary')?.textContent).toContain('0 sets');
  });
});

describe('elapsed clock', () => {
  it('formats minutes and hours', () => {
    expect(elapsed(NOW, NOW)).toBe('0:00');
    expect(elapsed(NOW, NOW + 42_000)).toBe('0:42');
    expect(elapsed(NOW, NOW + 605_000)).toBe('10:05');
    expect(elapsed(NOW, NOW + 4_050_000)).toBe('1:07:30');
  });

  it('never runs backwards if the device clock does', () => {
    expect(elapsed(NOW, NOW - 60_000)).toBe('0:00');
  });
});
