import { Badge, Button } from '@freeforever/design-system';
import { sessionTotals, sessionEnergyKcal } from '@freeforever/core';

import { recordsThisSession } from '../model/coaching.js';
import type { CompletedSession } from '../model/history.js';
import { toPerformedSet } from '../model/history.js';
import { orderedExercises } from '../model/session.js';
import type { DraftWorkout } from '../model/types.js';
import { formatNumber } from '../components/SetRow.js';

/**
 * What just got saved.
 *
 * This screen exists because finishing a session used to do nothing visible: the
 * reducer marked the workout completed, the repository wrote it to history and
 * cleared the active slot, and the screen carried on rendering the same exercises
 * with the clock still running. Every layer worked except the one the lifter
 * could see.
 *
 * A bare reset would have fixed the bug and thrown away the moment. This is the one
 * point in the whole flow where the lifter is not mid-set, not out of breath, and not
 * holding anything — the only place a paragraph would be allowed, and the only place
 * where showing every personal record at once is the point rather than noise. Mid
 * session the badges collapse to one plus a count; here they all belong.
 *
 * It is a screen rather than a sheet or a dialog. The no-modals rule protects a
 * session in progress; this one is over, and there is nothing left to lose to a
 * stray dismissal.
 */

export interface SessionSummaryProps {
  readonly workout: DraftWorkout;
  /** History *excluding* this session, so records compare against what came before. */
  readonly priorSessions: readonly CompletedSession[];
  readonly onStartNext: () => void;
}

const PR_LABEL: Record<string, string> = {
  heaviest_weight: 'Heaviest weight',
  best_e1rm: 'Best estimated 1RM',
  most_reps: 'Most reps',
  best_set_volume: 'Best set',
  best_session_volume: 'Best session',
  best_duration: 'Longest hold',
  best_distance: 'Furthest',
};

export function SessionSummary({ workout, priorSessions, onStartNext }: SessionSummaryProps) {
  const exercises = orderedExercises(workout);

  const totals = sessionTotals(
    exercises.map((exercise) => ({
      exercise: exercise.exercise,
      sets: exercise.sets.map(toPerformedSet),
    })),
    workout.bodyweightKg === undefined ? {} : { bodyweightKg: workout.bodyweightKg },
  );

  const durationSec = Math.max(
    0,
    Math.round(((workout.endedAt ?? workout.startedAt) - workout.startedAt) / 1000),
  );

  const energyKcal = sessionEnergyKcal({
    durationSec,
    bodyweightKg: workout.bodyweightKg,
  });

  const records = exercises.flatMap((exercise) =>
    recordsThisSession(exercise, workout, priorSessions).map((record) => ({
      exercise: exercise.exercise.name,
      type: record.type,
      value: record.value,
    })),
  );

  return (
    <div className="ffw-summary-screen">
      <h2 className="ffw-summary-screen__title">Session saved</h2>
      <p className="ffw-summary-screen__subtitle">{workout.title}</p>

      {/* Three numbers, one glance each. */}
      <dl className="ffw-figures">
        <Figure label="sets" value={String(totals.completedSetCount + totals.failedSetCount)} />
        {/*
          * "0" and "we cannot say" are different facts. A bodyweight session with no
          * recorded bodyweight has unresolvable load, and printing 0 tells the lifter
          * they lifted nothing — which is both wrong and the opposite of encouraging.
          */}
        <Figure
          label="kg lifted"
          value={
            totals.volumeKg > 0 ? formatNumber(Math.round(totals.volumeKg)) : '—'
          }
        />
        <Figure label="time" value={formatDuration(durationSec)} />
        {/*
          * An estimate, and marked as one. It is duration x bodyweight through a
          * single MET value — it does not know your effort, your load or your
          * rest, and nothing consumes it. In particular it never reaches the
          * calorie target: that already assumes you train, via a standing
          * activity multiplier, so feeding this in would count the same session
          * twice. Same reason as "kg lifted" above, "—" means we cannot say
          * rather than nothing happened.
          */}
        <Figure
          label="kcal"
          value={energyKcal === null ? '—' : `≈${formatNumber(energyKcal)}`}
        />
      </dl>

      {energyKcal === null ? (
        <p className="ffw-summary-screen__note">
          Add your bodyweight in Targets and sessions will show a rough energy estimate.
        </p>
      ) : (
        <p className="ffw-summary-screen__note">
          Energy is a rough estimate from time and bodyweight. Your calorie target already
          accounts for training, so this is not added to it.
        </p>
      )}

      {records.length === 0 ? null : (
        <section className="ffw-summary-screen__records" aria-label="Personal records">
          <h3 className="ffw-summary-screen__heading">
            {records.length === 1 ? 'A personal record' : `${records.length} personal records`}
          </h3>
          <ul className="ffw-pr-list">
            {records.map((record) => (
              <li key={`${record.exercise}-${record.type}`} className="ffw-pr-list__item">
                <Badge tone="success">{PR_LABEL[record.type] ?? record.type}</Badge>
                <span className="ffw-pr-list__exercise">{record.exercise}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="ffw-summary-screen__breakdown" aria-label="Exercises">
        {exercises.map((exercise) => {
          const attempted = exercise.sets.filter((set) => set.state !== 'pending');
          if (attempted.length === 0) return null;
          return (
            <li key={exercise.id} className="ffw-summary-screen__row">
              <span className="ffw-summary-screen__exercise">{exercise.exercise.name}</span>
              <span className="ffw-summary-screen__count">
                {attempted.length} {attempted.length === 1 ? 'set' : 'sets'}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Bottom third, like everything else that gets tapped — and docked inside
          the scroll container, so it sits above the shell's tab bar rather than
          over it. */}
      <div className="ffw-dock">
        <div className="ffw-actions">
          <Button size="xl" variant="primary" onClick={onStartNext}>
            Start next session
          </Button>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="ffw-figure">
      <dt className="ffw-figure__label">{label}</dt>
      <dd className="ffw-figure__value">{value}</dd>
    </div>
  );
}

/** `48m`, `1h 12m`, `0m` — a session length, not a stopwatch. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
