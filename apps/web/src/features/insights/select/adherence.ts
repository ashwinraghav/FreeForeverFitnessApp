import type { AdherenceAggregate, IsoWeek, LocalDate, StreakState } from '@freeforever/data';
import { addDays, formatLocalDate, isoWeekOfDate, parseLocalDate, weekWindow } from './weeks';

/**
 * Adherence, streaks and the calendar grid.
 *
 * The governing constraint here is not a chart rule, it is constitution rule 6. This
 * is a body-image-adjacent product, and streak-loss shaming is the dark pattern the
 * category is built on. So:
 *
 * - A day with no session has **no state of its own**. It is not "missed", it is not
 *   red, it does not carry a glyph. It is an empty cell, because that is all the data
 *   says. The type below has no `missed` variant, which is the point — there is no
 *   value a caller could pass that would render a reproach.
 * - `currentDays` is reported next to `longestDays`, never against it. Nothing here
 *   computes "days until you lose it", and nothing exposes a countdown.
 * - A zero streak is a fact and renders as `0`, with the same weight as any other
 *   number. There is no encouragement copy attached to it.
 */

export type DayState = 'trained' | 'untrained' | 'future' | 'before-history';

export interface CalendarDay {
  readonly date: LocalDate;
  readonly state: DayState;
  /** Monday = 0. */
  readonly weekday: number;
}

export interface CalendarWeek {
  readonly week: IsoWeek;
  readonly days: readonly CalendarDay[];
  readonly trainedCount: number;
  readonly plannedSessions: number | null;
  readonly completedSessions: number | null;
}

/**
 * A Monday-aligned grid of the `weeks` ISO weeks ending in the week of `today`.
 *
 * Days before the first day of history are `before-history` rather than `untrained`,
 * so a user who installed the app on Thursday is not shown three empty months.
 */
export function calendarGrid(
  aggregate: AdherenceAggregate | null,
  today: LocalDate,
  weeks: number,
): readonly CalendarWeek[] {
  const todayDate = parseLocalDate(today);
  if (todayDate === null) return [];

  const active = new Set<LocalDate>(aggregate?.activeDates ?? []);
  const firstActive = [...active].sort()[0];
  const historyStart = firstActive === undefined ? null : parseLocalDate(firstActive);

  const weekly = new Map<IsoWeek, { planned: number; completed: number }>();
  for (const bucket of aggregate?.weeks ?? []) {
    weekly.set(bucket.week, {
      planned: bucket.plannedSessions,
      completed: bucket.completedSessions,
    });
  }

  const axis = weekWindow(isoWeekOfDate(todayDate), weeks);
  const todayWeekday = (todayDate.getUTCDay() + 6) % 7;
  return axis.map((week, axisIndex) => {
    // weekWindow walks back in 7-day steps from today, so the grid's Monday is
    // derived from today's weekday rather than re-parsed out of the week key.
    const offset = (axis.length - 1 - axisIndex) * 7;
    const monday = addDays(todayDate, -todayWeekday - offset);

    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = addDays(monday, weekday);
      const date = formatLocalDate(day);
      const state: DayState = active.has(date)
        ? 'trained'
        : day.getTime() > todayDate.getTime()
          ? 'future'
          : historyStart !== null && day.getTime() < historyStart.getTime()
            ? 'before-history'
            : 'untrained';
      days.push({ date, state, weekday });
    }

    const counts = weekly.get(week);
    return {
      week,
      days,
      trainedCount: days.filter((day) => day.state === 'trained').length,
      plannedSessions: counts?.planned ?? null,
      completedSessions: counts?.completed ?? null,
    };
  });
}

export interface AdherenceSummary {
  readonly currentStreakDays: number;
  readonly longestStreakDays: number;
  readonly lastQualifyingDate: LocalDate | null;
  readonly sessionsInWindow: number;
  readonly weeksInWindow: number;
  readonly sessionsPerWeek: number;
  /** Mean prescription compliance over weeks that actually prescribed something. */
  readonly meanCompliance: number | null;
}

const NO_STREAK: StreakState = {
  currentDays: 0,
  longestDays: 0,
  lastQualifyingDate: null,
  timeZone: null,
};

export function adherenceSummary(
  aggregate: AdherenceAggregate | null,
  today: LocalDate,
  weeks: number,
): AdherenceSummary {
  const streak = aggregate?.trainingStreak ?? NO_STREAK;
  const todayDate = parseLocalDate(today);
  const axis = new Set(todayDate === null ? [] : weekWindow(isoWeekOfDate(todayDate), weeks));

  const inWindow = (aggregate?.weeks ?? []).filter((bucket) => axis.has(bucket.week));
  const sessions = inWindow.reduce((sum, bucket) => sum + bucket.completedSessions, 0);
  const compliances = inWindow
    .map((bucket) => bucket.prescriptionCompliance)
    .filter((value): value is number => value !== null);

  return {
    currentStreakDays: streak.currentDays,
    longestStreakDays: streak.longestDays,
    lastQualifyingDate: streak.lastQualifyingDate,
    sessionsInWindow: sessions,
    weeksInWindow: weeks,
    sessionsPerWeek: weeks === 0 ? 0 : sessions / weeks,
    meanCompliance:
      compliances.length === 0
        ? null
        : compliances.reduce((sum, value) => sum + value, 0) / compliances.length,
  };
}

