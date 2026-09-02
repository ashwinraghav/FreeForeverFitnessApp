import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession, type CompletedSession } from '../model/history.js';
import { orderedSets, startWorkout, workoutReducer } from '../model/session.js';
import {
  MAX_LOCAL_HISTORY,
  memoryWorkoutRepository,
  type WorkoutRepository,
} from '../storage/workoutStore.js';
import { SessionHistoryScreen } from './SessionHistoryScreen.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'bench-press')!);
const squat = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'back-squat')!);

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
let clock = NOW;
const now = () => clock;

beforeAll(() => {
  /*
   * jsdom has no top layer, so `<dialog>` has neither `showModal` nor `close`, and the
   * design system's `Dialog` calls both in an effect. Same shim as
   * `design-system/src/primitives/Dialog.test.tsx`.
   *
   * Worth being explicit about what this does and does not buy, in the spirit of
   * CLAUDE.md's warning about tests that pass for the wrong reason: it makes the
   * dialog's *content and behaviour* assertable — the copy, the two buttons, what each
   * one does to the store — and it verifies none of the modality. Focus trapping, the
   * top layer and Escape all come from the platform and are checked in a browser.
   */
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

beforeEach(() => {
  clock = NOW;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A finished session `daysAgo` back: two logged sets at 100x5 and one untouched. */
function session(daysAgo: number, exercise = bench): CompletedSession {
  const at = NOW - daysAgo * DAY;
  const started = workoutReducer(startWorkout({ now: at }), {
    type: 'add_exercise',
    exercise,
    sets: 3,
    now: at,
  });
  const draft = started.workout.exercises[0]!;
  const logged = orderedSets(draft)
    .slice(0, 2)
    .reduce(
      (state, set) =>
        workoutReducer(state, {
          type: 'set_set_state',
          exerciseId: draft.id,
          setId: set.id,
          state: 'completed',
          commit: { weightKg: 100, reps: 5 },
          now: at,
        }),
      started,
    );
  return toCompletedSession(workoutReducer(logged, { type: 'finish', now: at + 3600_000 }).workout);
}

function repositoryWith(...sessions: readonly CompletedSession[]): WorkoutRepository {
  const repository = memoryWorkoutRepository();
  for (const one of sessions) repository.putSession(one);
  return repository;
}

function mount(repository: WorkoutRepository) {
  return render(
    <MemoryRouter initialEntries={['/workout/history']}>
      <SessionHistoryScreen repository={repository} now={now} />
    </MemoryRouter>,
  );
}

const rows = () => screen.getAllByRole('listitem');
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/**
 * Is the confirmation actually open?
 *
 * Read off the element, not off whether its title is in the document. A closed
 * `<dialog>` is still in the DOM — the browser hides it with a UA style that jsdom does
 * not apply — so `queryByText('Delete this session?')` finds the heading whether the
 * dialog is open or shut, and an assertion built on it passes in both states. That is
 * the "test passes for the wrong reason" trap CLAUDE.md warns about, hit for real here.
 */
const deleteDialog = (): HTMLDialogElement | undefined =>
  [...document.querySelectorAll('dialog')].find((el) =>
    el.textContent?.includes('will be removed from your history'),
  ) as HTMLDialogElement | undefined;

/*
 * Was `document.querySelector('dialog')`, on the reasoning that this feature had one
 * dialog. It has two now — "log a past workout" is also one — and the bare selector
 * silently started reading the wrong element, so a test about the delete confirmation
 * was asserting against the date prompt. Found by that test failing; it would have been
 * far worse the other way round, with the assertion quietly passing.
 */
const dialogOpen = (): boolean => deleteDialog()?.open === true;

/** The "log a past workout" prompt, found by its own copy. */
const logDialog = (): HTMLDialogElement | undefined =>
  [...document.querySelectorAll('dialog')].find((el) =>
    el.textContent?.includes('Which day did you train'),
  ) as HTMLDialogElement | undefined;

/** Open the first session in the list, the way a thumb does. */
function expandFirst(): void {
  fireEvent.click(screen.getAllByRole('button', { expanded: false })[0]!);
}

describe('viewing sessions historically — the first thing the owner asked for', () => {
  it('lists finished sessions, newest first', () => {
    mount(repositoryWith(session(9), session(1), session(4)));
    // Reverse chronological, because "what did I do last time" is the question this
    // screen exists to answer and the answer is at the top.
    const listed = within(screen.getByRole('list', { name: 'Past sessions' })).getAllByRole(
      'listitem',
    );
    expect(listed).toHaveLength(3);
    expect(listed[0]?.textContent).toContain('Yesterday');
  });

  it('shows each session as three figures without opening it', () => {
    const view = mount(repositoryWith(session(1)));
    const summary = view.container.querySelector('.ffw-past__summary')?.textContent ?? '';
    expect(summary).toContain('2 sets');
    expect(summary).toContain('1000 kg');
    expect(summary).toContain('1h 0m');
  });

  it('never shows a set count that contradicts the volume beside it', () => {
    /*
     * The same trap the live header fell into and the reason this screen uses
     * `hardSetCount` too: `completedSetCount` excludes a missed set while `volumeKg`
     * includes it (ADR-0025), so the two printed side by side read as broken. It matters
     * more here than on the live screen, because this is the screen someone opens
     * specifically to check a number.
     */
    const one = session(1);
    const exercise = one.exercises[0]!;
    const missed: CompletedSession = {
      ...one,
      exercises: [
        {
          ...exercise,
          sets: exercise.sets.map((set) =>
            set.state === 'completed' ? { ...set, state: 'failed' as const } : set,
          ),
        },
      ],
    };
    const view = mount(repositoryWith(missed));

    const summary = view.container.querySelector('.ffw-past__summary')?.textContent ?? '';
    expect(summary).toContain('2 sets');
    expect(summary).toContain('1000 kg');
    expect(summary).not.toContain('0 sets');
  });

  it('reads a logged set as one line, not as a form', () => {
    // Reading is the common case. The editable version is a tap away.
    const view = mount(repositoryWith(session(1)));
    expandFirst();
    const lines = [...view.container.querySelectorAll('.ffw-pastset')];
    expect(lines).toHaveLength(3);
    expect(lines[0]?.textContent).toContain('100 kg');
    expect(lines[0]?.textContent).toContain('5 reps');
    // A word for the state, not only a colour and not only a glyph (ADR-0013).
    expect(lines[0]?.textContent).toContain('made');
    expect(view.container.querySelector('.ffw-row')).toBeNull();
  });

  it('says nothing about the cap until the cap is actually reached', () => {
    const view = mount(repositoryWith(session(1), session(2)));
    expect(view.container.textContent).not.toContain('most recent sessions');
  });

  it('says where the list stops once it is full, without promising recovery', () => {
    // A user editing their 61st-oldest session finds it gone. That should be a sentence,
    // not a list that silently ends.
    const many = Array.from({ length: MAX_LOCAL_HISTORY }, (_, index) => session(index + 1));
    const view = mount(repositoryWith(...many));
    expect(view.container.textContent).toContain(`${MAX_LOCAL_HISTORY} most recent sessions`);
    expect(view.container.textContent).toContain('Older ones are not stored');
  });

  it('offers an empty state rather than a blank screen', () => {
    mount(memoryWorkoutRepository());
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });
});

describe('editing a session that is already finished', () => {
  it('does not show editable rows until Edit is asked for', () => {
    const view = mount(repositoryWith(session(1)));
    expandFirst();
    expect(view.container.querySelector('.ffw-row')).toBeNull();

    fireEvent.click(button('Edit session'));
    expect(view.container.querySelector('.ffw-row')).not.toBeNull();
  });

  it('corrects a mistyped weight and persists it immediately', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));

    fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '102.5' } });

    const saved = repository.loadHistory()[0]!;
    expect(orderedSets(saved.exercises[0]!)[0]?.weightKg).toBe(102.5);
  });

  it('reuses the live set row, so editing history is the same interaction as logging it', () => {
    // Same component, same labelled Made / Missed / Not yet, same 56px targets. A second
    // implementation of set editing would drift from this one within a release.
    mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /, reps:/i })[0]!);

    for (const name of ['Made', 'Missed', 'Not yet']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('offers no ghost, so an edit cannot overwrite what happened with what the app guessed', () => {
    const view = mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    // A ghost is a suggestion for a set that has not happened yet. Three weeks later
    // there is nothing to suggest.
    expect(view.container.querySelector('.ffw-cell[data-ff-source="ghost"]')).toBeNull();
  });

  it('marks a past set missed, in words', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /, reps:/i })[0]!);
    fireEvent.click(screen.getByRole('radio', { name: 'Missed' }));

    const saved = repository.loadHistory()[0]!;
    expect(orderedSets(saved.exercises[0]!)[0]?.state).toBe('failed');
    // A failed set is real work: the numbers stay (ADR-0025).
    expect(orderedSets(saved.exercises[0]!)[0]?.weightKg).toBe(100);
  });

  it('adds a set the lifter forgot', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(button('Add a set'));

    expect(orderedSets(repository.loadHistory()[0]!.exercises[0]!)).toHaveLength(4);
  });

  it('removes a set and offers it straight back', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
    fireEvent.click(button(/^Remove set/));

    expect(orderedSets(repository.loadHistory()[0]!.exercises[0]!)).toHaveLength(2);
    fireEvent.click(button('Undo'));
    expect(orderedSets(repository.loadHistory()[0]!.exercises[0]!)).toHaveLength(3);
  });

  it('undoes a corrected value too, not only a removal', () => {
    /*
     * This is why undo is a whole-session snapshot rather than the reducer's own undo
     * stack: that stack only tracks removals, which is the right scope for a live session
     * and the wrong one here. A mistyped correction is as worth undoing as a deletion.
     */
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '999' } });
    expect(orderedSets(repository.loadHistory()[0]!.exercises[0]!)[0]?.weightKg).toBe(999);

    fireEvent.click(button('Undo'));
    expect(orderedSets(repository.loadHistory()[0]!.exercises[0]!)[0]?.weightKg).toBe(100);
  });

  it('marks an edited session as edited, because records are derived from it', () => {
    const view = mount(repositoryWith(session(1)));
    expect(view.container.querySelector('.ffw-past__edited')).toBeNull();

    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '102.5' } });

    expect(view.container.querySelector('.ffw-past__edited')?.textContent).toBe('edited');
  });

  it('warns when an edit has left a session with nothing logged in it', () => {
    // An empty session in history is a phantom in the streak and the session count. It is
    // said out loud rather than deleted out from under the lifter.
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));

    for (const _ of [0, 1]) {
      fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
      fireEvent.click(button(/^Remove set/));
    }
    expect(document.querySelector('.ff-toast')?.textContent).toMatch(/nothing is logged/i);
  });
});

describe('adding an exercise to a session that is already finished', () => {
  /*
   * Reported by the owner: "When I edit a session, I can't seem to add an exercise. only
   * edit existing exercises." It was accurate — `PastSessionEdit` had four kinds and all
   * four named a set, so there was no way in for a whole exercise.
   */
  it('offers Add exercise only while editing', () => {
    mount(repositoryWith(session(1)));
    expandFirst();
    expect(screen.queryByRole('button', { name: 'Add exercise' })).toBeNull();

    fireEvent.click(button('Edit session'));
    expect(screen.getByRole('button', { name: 'Add exercise' })).toBeInTheDocument();
  });

  it('adds the picked exercise and persists it', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(button('Add exercise'));

    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));

    const saved = repository.loadHistory()[0]!;
    expect(saved.exercises).toHaveLength(2);
    expect(saved.exercises[1]!.exercise.exerciseId).toBe(squat.exerciseId);
    // One empty set, and no numbers invented into a session that already happened.
    expect(saved.exercises[1]!.sets).toHaveLength(1);
    expect(saved.exercises[1]!.sets[0]!.weightKg).toBeNull();
  });

  it('shows the new exercise on screen, not just in storage', () => {
    const view = mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(button('Add exercise'));
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));

    expect(view.container.textContent).toContain('Back Squat');
  });

  it('can be undone like any other edit', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(button('Add exercise'));
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));
    expect(repository.loadHistory()[0]!.exercises).toHaveLength(2);

    fireEvent.click(button('Undo'));
    expect(repository.loadHistory()[0]!.exercises).toHaveLength(1);
  });

  it('closes the picker once something is picked', () => {
    mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(button('Add exercise'));
    // Prove the positive: the picker really is open, so the assertion below is not just
    // agreeing with a picker that never rendered.
    expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));
    expect(screen.queryByPlaceholderText(/Search/i)).toBeNull();
  });
});

describe('writing up a workout you have already done', () => {
  /*
   * The second of the two ways this app is meant to be used. One is live, phone on the
   * bench, rest timer running. This is the other: you trained, your phone stayed in the
   * bag, and now you are sitting down afterwards. Before this there was no entry point
   * at all — you could only edit a session the live flow had already created.
   */
  const logButton = () => button('Log a past workout');

  it('offers the button even with no sessions at all', () => {
    // The person most likely to want this is the one with an empty history: they
    // trained before they installed the app. This used to be unreachable, because the
    // empty state returned early and never mounted the dialog.
    mount(repositoryWith());
    expect(logButton()).toBeInTheDocument();
  });

  it('defaults the date to today and will not accept a future one', () => {
    mount(repositoryWith(session(1)));
    fireEvent.click(logButton());

    const field = screen.getByLabelText(/Which day did you train/i) as HTMLInputElement;
    const today = new Date(clock);
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(field.value).toBe(iso);
    expect(field.max).toBe(iso);
  });

  it('files the session on the day chosen, not the day it was typed', () => {
    const repository = repositoryWith();
    mount(repository);
    fireEvent.click(logButton());

    fireEvent.change(screen.getByLabelText(/Which day did you train/i), {
      target: { value: '2025-10-07' },
    });
    fireEvent.click(button('Start writing it up'));

    const saved = repository.loadHistory();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.localDate).toBe('2025-10-07');
  });

  it('does not drift a day west or east of Greenwich', () => {
    // `new Date('2025-10-07')` is UTC midnight, which in Chennai is already the 7th at
    // 05:30 but in Los Angeles is still the 6th. The field speaks local dates, so the
    // parse must too — this is the bug that would put every Indian session a day early.
    const repository = repositoryWith();
    mount(repository);
    fireEvent.click(logButton());
    fireEvent.change(screen.getByLabelText(/Which day did you train/i), {
      target: { value: '2025-01-01' },
    });
    fireEvent.click(button('Start writing it up'));

    expect(repository.loadHistory()[0]!.localDate).toBe('2025-01-01');
  });

  it('opens straight into editing with the picker up', () => {
    // Two taps from the button to typing a weight. The next thing anybody doing this
    // wants is to name the first lift.
    mount(repositoryWith());
    fireEvent.click(logButton());
    fireEvent.click(button('Start writing it up'));

    expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();
  });

  it('fills in like any other session, and persists', () => {
    const repository = repositoryWith();
    mount(repository);
    fireEvent.click(logButton());
    fireEvent.click(button('Start writing it up'));
    fireEvent.click(screen.getByRole('button', { name: /Back Squat/i }));

    const saved = repository.loadHistory()[0]!;
    expect(saved.exercises).toHaveLength(1);
    expect(saved.exercises[0]!.exercise.exerciseId).toBe(squat.exerciseId);
  });

  it('carries no end time, so nothing invents a duration', () => {
    // The lifter knows the date and nothing else. `endedAt` absent is the honest
    // record; a fabricated hour would flow straight into the energy estimate.
    const repository = repositoryWith();
    mount(repository);
    fireEvent.click(logButton());
    fireEvent.click(button('Start writing it up'));

    expect(repository.loadHistory()[0]!.endedAt).toBeUndefined();
  });

  it('can be abandoned without filing anything', () => {
    const repository = repositoryWith();
    mount(repository);
    fireEvent.click(logButton());
    expect(logDialog()?.open).toBe(true);

    fireEvent.click(button('Cancel'));

    expect(repository.loadHistory()).toHaveLength(0);
    /*
     * `.open`, not `queryByLabelText`. A closed `<dialog>` is still in the DOM — the
     * browser hides it with a UA style jsdom does not apply — so the field is findable
     * whether the prompt is open or shut, and asserting absence passes in both states.
     * Exactly the trap CLAUDE.md documents; hit again here.
     */
    expect(logDialog()?.open).toBe(false);
  });
});

describe('deleting a whole session', () => {
  it('asks first, in a dialog', () => {
    /*
     * CLAUDE.md bans modals *during a workout*, where a dismissed dialog can take entered
     * sets with it. This is a sofa activity with two hands and nothing in flight, and the
     * action spans weeks of data, which is exactly what the design system says Dialog is
     * for.
     */
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Delete session'));

    expect(dialogOpen()).toBe(true);
    expect(screen.getByText('Delete this session?')).toBeInTheDocument();
    // Nothing has happened yet.
    expect(repository.loadHistory()).toHaveLength(1);
  });

  it('says what will go, and what it will take with it', () => {
    mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Delete session'));
    // Volume and records are derived from history, so deleting a session changes both.
    // Saying so is the difference between a confirmation and a speed bump.
    expect(deleteDialog()?.textContent).toMatch(/volume totals and your records/);
  });

  it('keeps the session when the lifter backs out', () => {
    const repository = repositoryWith(session(1));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Delete session'));
    fireEvent.click(button('Keep it'));

    expect(repository.loadHistory()).toHaveLength(1);
    expect(dialogOpen()).toBe(false);
  });

  it('retracts rather than erases, and offers an undo', () => {
    const repository = repositoryWith(session(1), session(3));
    mount(repository);
    expandFirst();
    fireEvent.click(button('Delete session'));
    fireEvent.click(button('Delete'));

    expect(repository.loadHistory()).toHaveLength(1);
    fireEvent.click(button('Undo'));
    expect(repository.loadHistory()).toHaveLength(2);
  });

  it('leaves the other sessions alone', () => {
    const kept = session(3, squat);
    const repository = repositoryWith(session(1), kept);
    mount(repository);
    expandFirst();
    fireEvent.click(button('Delete session'));
    fireEvent.click(button('Delete'));

    expect(repository.loadHistory().map((one) => one.id)).toEqual([kept.id]);
  });
});

describe('no dialog is ever opened over a live session', () => {
  it('confirms nothing when deleting a single set', () => {
    // One row, and the undo toast is the cheaper answer. A dialog per set would make
    // correcting a session as slow as re-logging it.
    mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    fireEvent.click(screen.getAllByRole('button', { name: /Weight:/ })[0]!);
    fireEvent.click(button(/^Remove set/));

    expect(dialogOpen()).toBe(false);
  });

  it('closes edit mode when the session is collapsed', () => {
    // Otherwise reopening it later lands the lifter in a state they did not ask for and
    // never saw themselves enter.
    const view = mount(repositoryWith(session(1)));
    expandFirst();
    fireEvent.click(button('Edit session'));
    expect(view.container.querySelector('.ffw-row')).not.toBeNull();

    fireEvent.click(screen.getAllByRole('button', { expanded: true })[0]!);
    expandFirst();
    expect(view.container.querySelector('.ffw-row')).toBeNull();
    expect(rows().length).toBeGreaterThan(0);
  });
});
