import type { IsoMonth, IsoWeek, LocalDate } from '../common/time.js';

/**
 * Calendar arithmetic over `YYYY-MM-DD` strings.
 *
 * Everything here is pure string/UTC maths: `Date` is used only as a calendar
 * calculator over `Date.UTC`, never as a clock. That matters because the aggregate
 * reducers must be pure (same inputs, same output), and a reducer that consulted
 * the device clock would make `reduce(empty(), events) === rebuild(snapshot)`
 * untestable.
 */

const MS_PER_DAY = 86_400_000;

function partsOf(date: string): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Days since 1970-01-01 for a local-date string. */
export function epochDayOf(date: LocalDate | string): number {
  const { year, month, day } = partsOf(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** The local-date string `days` days after `date`. Negative goes backwards. */
export function addDays(date: LocalDate | string, days: number): LocalDate {
  const shifted = new Date((epochDayOf(date) + days) * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10) as LocalDate;
}

/** Plain string comparison is the correct sort for `YYYY-MM-DD`. */
export function compareLocalDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO 8601 week of a local date, as `YYYY-Www`. Weeks start Monday. */
export function isoWeekOf(date: LocalDate | string): IsoWeek {
  const { year, month, day } = partsOf(date);
  const target = new Date(Date.UTC(year, month - 1, day));
  // Shift to the Thursday of this ISO week; its calendar year is the ISO year.
  const weekday = (target.getUTCDay() + 6) % 7; // 0 = Monday
  target.setUTCDate(target.getUTCDate() - weekday + 3);
  const isoYear = target.getUTCFullYear();
  // Week 1 is the week containing January 4th.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = jan4.getTime() - jan4Weekday * MS_PER_DAY;
  const week = 1 + Math.floor((target.getTime() - week1Monday) / (7 * MS_PER_DAY));
  return `${String(isoYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}` as IsoWeek;
}

/** `YYYY-MM` of a local date. The bucket key for monthly rollups. */
export function isoMonthOf(date: LocalDate | string): IsoMonth {
  return date.slice(0, 7) as IsoMonth;
}

/**
 * Consecutive-day streaks over a sorted, de-duplicated list of local dates.
 *
 * "Current" is the run ending at the most recent qualifying date, with no clock
 * involved: whether that run is still alive today is a display question, answered
 * by the UI against `lastQualifyingDate`, not baked into stored state where it
 * would rot the moment midnight passed.
 */
export function streaksOf(sortedDates: readonly (LocalDate | string)[]): {
  currentDays: number;
  longestDays: number;
  lastQualifyingDate: LocalDate | null;
} {
  let longest = 0;
  let run = 0;
  let previousDay: number | null = null;
  for (const date of sortedDates) {
    const day = epochDayOf(date);
    run = previousDay !== null && day === previousDay + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previousDay = day;
  }
  const last = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : undefined;
  return {
    currentDays: run,
    longestDays: longest,
    lastQualifyingDate: last !== undefined ? (last as LocalDate) : null,
  };
}
