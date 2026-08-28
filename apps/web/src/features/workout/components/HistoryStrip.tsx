import type { ExerciseHistoryEntry } from '../model/history.js';
import type { DraftSet } from '../model/types.js';
import { formatNumber } from './SetRow.js';

/**
 * The last three outings of the lift currently on screen.
 *
 * Inline, under the exercise, not behind a tap: the question "what did I do last time,
 * and the time before?" is the one thing that decides what goes on the bar, and a
 * lifter should not have to navigate away from the row they are about to fill in to
 * answer it.
 *
 * Three lines, three numbers each, no prose. This is read between sets.
 *
 * It reads the previous `workouts` documents already in the local cache — never a
 * query (ADR-0005, and the access-pattern table in SCHEMA.md).
 */

export interface HistoryStripProps {
  readonly entries: readonly ExerciseHistoryEntry[];
  readonly today: string;
}

export function HistoryStrip({ entries, today }: HistoryStripProps) {
  if (entries.length === 0) {
    return <p className="ffw-history__empty">First time — no history yet.</p>;
  }

  return (
    <div className="ffw-history">
      {entries.map((entry) => (
        <div className="ffw-history__row" key={entry.workoutId}>
          <span className="ffw-history__date">{relativeDay(entry.localDate, today)}</span>
          <span className="ffw-history__sets">{summariseSets(entry.sets)}</span>
          <span className="ffw-history__volume">
            {entry.volumeKg > 0 ? `${formatNumber(Math.round(entry.volumeKg))} kg` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * "100x5, 100x5, 90x8", collapsing consecutive identical sets to "100x5 x2".
 *
 * Collapsing matters more than it looks: five straight sets written out is a line that
 * wraps, and a wrapped line is two glances instead of one.
 */
export function summariseSets(sets: readonly DraftSet[]): string {
  const parts: string[] = [];
  let run = 0;
  let previous: string | null = null;

  const flush = () => {
    if (previous === null) return;
    parts.push(run > 1 ? `${previous} x${run}` : previous);
  };

  for (const set of sets) {
    const label = describeSet(set);
    if (label === previous) {
      run += 1;
      continue;
    }
    flush();
    previous = label;
    run = 1;
  }
  flush();

  return parts.join(', ');
}

function describeSet(set: DraftSet): string {
  const miss = set.state === 'failed' ? '✕' : '';
  if (set.effortKind === 'duration') {
    return `${set.durationSec ?? 0}s${miss}`;
  }
  if (set.effortKind === 'distance') {
    return `${set.distanceM ?? 0}m${miss}`;
  }
  const reps = set.reps ?? 0;
  if (set.loadKind === 'none' || set.weightKg === null) return `${reps}${miss}`;
  if (set.loadKind === 'assisted') return `-${formatNumber(set.weightKg)}x${reps}${miss}`;
  if (set.loadKind === 'bodyweight' && set.weightKg === 0) return `BW x${reps}${miss}`;
  if (set.loadKind === 'bodyweight') return `BW+${formatNumber(set.weightKg)}x${reps}${miss}`;
  return `${formatNumber(set.weightKg)}x${reps}${miss}`;
}

/**
 * "Today", "Yesterday", "6d ago", "3w ago".
 *
 * Computed from the two `YYYY-MM-DD` local dates rather than from timestamps, because
 * the day boundary that matters is the lifter's own (`common/time.ts`) and a UTC
 * subtraction moves a third of the world's evening sessions into yesterday.
 */
export function relativeDay(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days === null) return date;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 28) return `${Math.floor(days / 7)}w ago`;
  return date.slice(5);
}

function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}
