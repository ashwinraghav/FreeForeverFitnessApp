import { Button, Dialog, EmptyState, Toast, ToastRegion } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { notifyLocalDataChanged } from '../../../data/insightsSource.js';
import { useCatalogue } from '../catalogue/useCatalogue.js';
import { toExerciseRef, type CatalogueEntry } from '../catalogue/types.js';
import { ExercisePicker } from '../components/ExercisePicker.js';
import { longDate, PastSessionCard } from '../components/PastSessionCard.js';
import type { EditableField } from '../components/SetRow.js';
import type { CompletedSession } from '../model/history.js';
import { byMostRecent, recentExerciseIds } from '../model/history.js';
import { localDateOf } from '../model/ids.js';
import {
  addExerciseToPastSession,
  editPastSession,
  emptyPastSession,
  isEmptyNow,
  type PastSessionEdit,
} from '../model/pastSession.js';
import type { SetPatch } from '../model/session.js';
import { MAX_LOCAL_HISTORY, type WorkoutRepository } from '../storage/workoutStore.js';

/**
 * Past sessions: view them, and correct them.
 *
 * The project owner's first report opened with **"I am unable to edit training sessions
 * or even view them historically"**, and it was accurate — sessions were persisted and
 * readable, but the only thing that read them was the three-line strip inside an
 * exercise card, and `WorkoutRepository` had no update at all. This screen is the read
 * half; `putSession` and `discardSession` are the write half.
 *
 * ## Everything here is device-local and synchronous
 *
 * Sessions come from `repository.loadHistory()`, which is `localStorage` and a parse.
 * No query, no loading state, no spinner — ADR-0005 says Firestore is a sync engine and
 * a query that renders a list is a bug. That is also why the list can be sorted and
 * folded in a `useMemo` without anyone worrying about cost.
 *
 * ## Undo is a whole-session snapshot
 *
 * Every mutation stashes the session as it was and offers it back from a toast. That
 * covers a corrected weight exactly as well as a deleted set, which the reducer's own
 * undo stack does not — it only tracks removals, which is the right scope for a live
 * session and the wrong one here. A session is a few kilobytes.
 *
 * ## The one dialog in this feature
 *
 * Deleting a whole session asks first. CLAUDE.md bans modals *during a workout*, where a
 * dismissed dialog can take entered sets with it; this is a sofa activity with two hands
 * and nothing in flight, and a destructive action that spans weeks of data is exactly
 * what the design system says `Dialog` is for. Deleting a single *set* does not ask —
 * it is one row, and the undo toast is the cheaper answer.
 */

export interface SessionHistoryScreenProps {
  readonly repository: WorkoutRepository;
  /** Smallest load step this gym can make, kg. From the profile's unit preferences. */
  readonly loadStepKg?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
  /** The exercises the picker can offer. Same default as the live screen. */
  readonly catalogue?: readonly CatalogueEntry[];
}

interface OpenEditor {
  readonly sessionId: string;
  readonly setId: SetId;
  readonly field: EditableField;
}

export function SessionHistoryScreen({
  repository,
  loadStepKg = 2.5,
  now = Date.now,
  catalogue: catalogueProp,
}: SessionHistoryScreenProps) {
  // Tests and stories can pin the list; everything else gets the full ~900.
  const loaded = useCatalogue();
  const catalogue = catalogueProp ?? loaded;
  /*
   * The history is held in state rather than re-read on every render, because a write
   * has to re-render the list and `loadHistory()` returns a fresh array each call — so
   * reading it inline would make every render a new value and defeat any memo below it.
   * `reload()` is the single point that pulls it back in after a write.
   */
  const [sessions, setSessions] = useState<readonly CompletedSession[]>(() =>
    repository.loadHistory(),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openEditor, setOpenEditor] = useState<OpenEditor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CompletedSession | null>(null);
  /** The session as it was before the last change, with what to say about it. */
  const [undo, setUndo] = useState<{
    readonly session: CompletedSession;
    readonly label: string;
  } | null>(null);
  /** Set when the last edit left a session with nothing logged in it. */
  const [emptiedId, setEmptiedId] = useState<string | null>(null);
  /** Which session the picker is adding to. Null when it is closed. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  /** The date field of the "log a past workout" prompt, or null when it is shut. */
  const [logDate, setLogDate] = useState<string | null>(null);

  const today = useMemo(() => localDateOf(new Date(now())), [now]);
  const ordered = useMemo(() => byMostRecent(sessions), [sessions]);
  // The picker opens on what you actually train, exactly as the live screen does.
  const recentIds = useMemo(() => recentExerciseIds(sessions), [sessions]);

  const reload = useCallback(() => {
    setSessions(repository.loadHistory());
    // Progress folds the same sessions. `insightsSource` re-validates on read, so it is
    // correct without this — but only from its next render, and the `storage` event that
    // would wake it does not fire in the tab that wrote. Its own exported call, so this
    // is using that module's API rather than editing its file (ADR-0018).
    notifyLocalDataChanged();
  }, [repository]);

  /** Apply one edit to one set, stash the previous session, persist, refresh. */
  const applyEdit = useCallback(
    (
      sessionId: string,
      exerciseId: WorkoutExerciseId,
      setId: SetId,
      edit: PastSessionEdit,
      label: string,
    ) => {
      const before = sessions.find((candidate) => candidate.id === sessionId);
      if (before === undefined) return;

      const after = editPastSession(before, { exerciseId, setId }, edit, now());
      // `editPastSession` returns the same object when the edit hit nothing, so a no-op
      // cannot stamp `editedAt` and make an untouched session claim it was edited.
      if (after === before) return;

      repository.putSession(after);
      reload();
      setUndo({ session: before, label });
      setEmptiedId(isEmptyNow(after) ? after.id : null);
    },
    [sessions, repository, reload, now],
  );

  /**
   * Add an exercise to a finished session.
   *
   * Its own handler rather than a fifth `PastSessionEdit`, because every edit in that
   * union names the set it acts on and this one has no set to name. Same undo, same
   * persistence, same reload as `applyEdit` — only the model call differs.
   */
  const applyAddExercise = useCallback(
    (sessionId: string, entry: CatalogueEntry) => {
      const before = sessions.find((candidate) => candidate.id === sessionId);
      if (before === undefined) return;

      const after = addExerciseToPastSession(before, toExerciseRef(entry), now());
      if (after === before) return;

      repository.putSession(after);
      reload();
      setUndo({ session: before, label: `${entry.name} added` });
      // Deliberately not touching `emptiedId`: the new exercise arrives with one pending
      // set, which is not logged work, so a session that was empty is still empty and
      // the retract offer must stand.
      setPickerFor(null);
    },
    [sessions, repository, reload, now],
  );

  /**
   * Write up a workout that already happened.
   *
   * Creates the empty session, files it, and drops straight into editing it with the
   * exercise picker already open — because the very next thing anybody doing this wants
   * is to name the first lift. Two taps from the button to typing a weight.
   */
  const logPastWorkout = useCallback(
    (isoDate: string) => {
      const parsed = fromDateInput(isoDate);
      if (parsed === null) return;

      const session = emptyPastSession(parsed, now());
      repository.putSession(session);
      reload();
      setLogDate(null);
      setExpandedId(session.id);
      setEditingId(session.id);
      setPickerFor(session.id);
      // No undo offer. An empty session is not a change worth reverting, and it deletes
      // itself from the retract prompt the moment the lifter looks away.
    },
    [repository, reload, now],
  );

  const restore = useCallback(() => {
    if (undo === null) return;
    repository.putSession(undo.session);
    reload();
    setUndo(null);
    setEmptiedId(null);
  }, [undo, repository, reload]);

  const confirmDelete = useCallback(() => {
    if (pendingDelete === null) return;
    const removed = repository.discardSession(pendingDelete.id);
    setPendingDelete(null);
    if (removed === null) return;
    reload();
    setExpandedId(null);
    setEditingId(null);
    setUndo({ session: removed, label: 'Session deleted' });
    setEmptiedId(null);
  }, [pendingDelete, repository, reload]);


  return (
    <div className="ffw-history-screen">
      <Header count={ordered.length} />

      {/*
        No early return for the empty case any more. It used to short-circuit above,
        which meant the "log a past workout" dialog was not mounted for the one person
        most likely to want it: somebody with no sessions yet, writing up the training
        they did before they installed this.
      */}
      {ordered.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          body="Finish a workout and it will show up here. Trained already? Write it up with the button below."
        />
      ) : null}

      <ul className="ffw-history-list" aria-label="Past sessions">
        {ordered.map((session) => (
          <PastSessionCard
            key={session.id}
            session={session}
            today={today}
            expanded={expandedId === session.id}
            editing={editingId === session.id}
            openEditor={
              openEditor !== null && openEditor.sessionId === session.id
                ? { setId: openEditor.setId, field: openEditor.field }
                : null
            }
            loadStepKg={loadStepKg}
            onToggleExpanded={() => {
              const next = expandedId === session.id ? null : session.id;
              setExpandedId(next);
              // Collapsing while editing must not leave an invisible session in edit
              // mode, or reopening it later lands the lifter in a state they did not ask
              // for and did not see themselves enter.
              if (next === null) {
                setEditingId(null);
                setOpenEditor(null);
              }
            }}
            onStartEditing={() => setEditingId(session.id)}
            onStopEditing={() => {
              setEditingId(null);
              setOpenEditor(null);
            }}
            onOpenEditor={(setId, field) =>
              setOpenEditor(field === null ? null : { sessionId: session.id, setId, field })
            }
            onChangeSetState={(exerciseId, setId, state: SetState) =>
              applyEdit(session.id, exerciseId, setId, { kind: 'state', state }, 'Set changed')
            }
            onEditSet={(exerciseId, setId, patch: SetPatch) =>
              applyEdit(session.id, exerciseId, setId, { kind: 'value', patch }, 'Set changed')
            }
            onRemoveSet={(exerciseId, setId) => {
              setOpenEditor(null);
              applyEdit(session.id, exerciseId, setId, { kind: 'remove' }, 'Set removed');
            }}
            onAddSetAfter={(exerciseId, setId) =>
              applyEdit(session.id, exerciseId, setId, { kind: 'add_after' }, 'Set added')
            }
            onAddExercise={() => setPickerFor(session.id)}
            onDiscard={() => setPendingDelete(session)}
          />
        ))}
      </ul>

      {/*
        One picker for the whole list, not one per card: only one session can be adding
        at a time, and sixty mounted pickers would each hold their own query state.

        An overlay is fine here in a way it is not on the live screen. The rule against
        modals is about losing entered sets mid-workout (CLAUDE.md); this screen is read
        after the fact, with nothing half-typed to lose.
      */}
      <ExercisePicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={(entry) => {
          if (pickerFor !== null) applyAddExercise(pickerFor, entry);
        }}
        catalogue={catalogue}
        recentIds={recentIds}
      />

      <p className="ffw-history-screen__logpast">
        <Button size="lg" variant="secondary" onClick={() => setLogDate(toDateInput(new Date(now())))}>
          Log a past workout
        </Button>
      </p>

      {/*
        The cap, stated only once it is actually reached.
        `MAX_LOCAL_HISTORY` is a real limit and a user who edits their 61st-oldest session
        will find it gone, so the list says where it stops rather than just stopping. It
        deliberately does not imply the older ones are recoverable — without sync they are
        not, and a promise this screen cannot keep is worse than a plain sentence.
      */}
      {ordered.length >= MAX_LOCAL_HISTORY ? (
        <p className="ffw-history-screen__cap">
          This device keeps your {MAX_LOCAL_HISTORY} most recent sessions. Older ones are
          not stored.
        </p>
      ) : null}

      {/*
        Recording a workout that already happened — the second way people use this app.
        A dialog is right here in a way it never is mid-workout: nothing is entered yet,
        so there is nothing a dismissal could lose.
      */}
      <Dialog
        open={logDate !== null}
        onClose={() => setLogDate(null)}
        title="Log a workout you have already done"
        actions={
          <>
            <Button size="lg" variant="secondary" onClick={() => setLogDate(null)}>
              Cancel
            </Button>
            <Button
              size="lg"
              variant="primary"
              onClick={() => {
                if (logDate !== null) logPastWorkout(logDate);
              }}
            >
              Start writing it up
            </Button>
          </>
        }
      >
        <label className="ffw-logpast">
          <span className="ffw-logpast__label">Which day did you train?</span>
          <input
            className="ffw-logpast__date ff-focusable"
            type="date"
            value={logDate ?? ''}
            max={toDateInput(new Date(now()))}
            onChange={(event) => setLogDate(event.target.value)}
          />
        </label>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this session?"
        actions={
          <>
            <Button size="lg" variant="secondary" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button size="lg" variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          {pendingDelete === null
            ? ''
            : `${describeSession(pendingDelete)} will be removed from your history, your volume totals and your records.`}
        </p>
      </Dialog>

      {/*
        One toast, two jobs.

        The second only appears when an edit has left a session with nothing logged in
        it. An empty session is not a workout — it is the same rule `hasLoggedWork`
        enforces when one is finished — and leaving it in history puts a phantom into
        the streak and the session count insights reads. Rather than deleting it out
        from under the lifter, the toast says what happened and offers the out.
      */}
      {undo === null ? null : (
        <ToastRegion>
          <Toast
            tone={emptiedId === null ? 'info' : 'danger'}
            durationMs={8000}
            onDismiss={() => setUndo(null)}
            action={
              <Button size="lg" variant="ghost" onClick={restore}>
                Undo
              </Button>
            }
          >
            {emptiedId === null
              ? undo.label
              : `${undo.label} — nothing is logged in this session now.`}
          </Toast>
        </ToastRegion>
      )}
    </div>
  );
}

/**
 * `<input type="date">` speaks `YYYY-MM-DD` in the *local* calendar, and `new Date(iso)`
 * parses that same string as **UTC** — so east of Greenwich a session logged for today
 * lands on yesterday. Parsed by hand into local parts instead.
 */
function fromDateInput(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (match === null) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejects the 31st of February, which the constructor would happily roll forward.
  return Number.isNaN(date.getTime()) || date.getMonth() !== Number(month) - 1 ? null : date;
}

/** The same format, going the other way, for the field's initial value. */
function toDateInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function Header({ count }: { readonly count: number }) {
  return (
    <>
      {/*
        The way back is a link to the session, above the title rather than a chevron
        beside it. This screen is reached from the Train tab and the tab bar does not
        change when you are on it, so without this the only way back is the browser's
        own gesture — which an installed PWA does not always give you.
      */}
      <p className="ffw-history-screen__back">
        <Link className="ffw-headerlink ff-focusable" to="..">
          Back to session
        </Link>
      </p>
      <header className="ffw-screen__header">
        <h2 className="ffw-screen__title">History</h2>
        <span className="ffw-screen__meta">
          {count === 0 ? null : (
            <span className="ffw-elapsed">
              {count} {count === 1 ? 'session' : 'sessions'}
            </span>
          )}
        </span>
      </header>
    </>
  );
}

/** "Your session on Sat 30 Aug". Names what is about to go, rather than "this item". */
function describeSession(session: CompletedSession): string {
  return `Your session on ${longDate(session.localDate)}`;
}
