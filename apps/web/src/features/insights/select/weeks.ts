import type { IsoWeek, LocalDate } from '@freeforever/data';

/**
 * ISO week arithmetic.
 *
 * Aggregates are bucketed by ISO week (`YYYY-Www`) and a chart's x-axis has to be
 * *dense*: a week with no training is a gap in the data and a zero on the chart, not
 * a bucket that quietly disappears and makes four sparse months look like four solid
 * ones. Everything here exists so that filling those gaps is exact rather than
 * approximate — no date arithmetic on strings, no 7-day-multiples fudge across a
 * 53-week year.
 *
 * All arithmetic is done in UTC on purpose. These are calendar labels, not instants;
 * the user's zone was already applied when the sync layer chose the bucket.
 */

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-Www`. Returns null rather than throwing — one bad key is not an outage. */
export function parseIsoWeek(week: string): { year: number; week: number } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (match === null) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  if (index < 1 || index > 53) return null;
  return { year, week: index };
}

export function formatIsoWeek(year: number, week: number): IsoWeek {
  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}` as IsoWeek;
}

/** Monday of an ISO week, at UTC midnight. */
export function isoWeekStart(week: IsoWeek): Date | null {
  const parsed = parseIsoWeek(week);
  if (parsed === null) return null;
  // 4 January is always in ISO week 1, in every year, by definition.
  const jan4 = new Date(Date.UTC(parsed.year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const week1Monday = jan4.getTime() - jan4Dow * MS_PER_DAY;
  return new Date(week1Monday + (parsed.week - 1) * 7 * MS_PER_DAY);
}

/** The ISO week a UTC-midnight calendar date falls in. */
export function isoWeekOfDate(date: Date): IsoWeek {
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Thursday of this week decides the year, which is what makes 52/53 come out right.
  const dow = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - dow + 3);
  const isoYear = shifted.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = jan4.getTime() + (3 - jan4Dow) * MS_PER_DAY;
  const index = Math.round((shifted.getTime() - week1Thursday) / (7 * MS_PER_DAY)) + 1;
  return formatIsoWeek(isoYear, index);
}

/** `YYYY-MM-DD` to a UTC-midnight Date. Null on anything malformed. */
export function parseLocalDate(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(value.getTime()) ? null : value;
}

export function formatLocalDate(date: Date): LocalDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function isoWeekOfLocalDate(date: LocalDate): IsoWeek | null {
  const parsed = parseLocalDate(date);
  return parsed === null ? null : isoWeekOfDate(parsed);
}

/** Move `n` weeks (signed) from `week`, crossing 52/53-week year ends correctly. */
export function addWeeks(week: IsoWeek, n: number): IsoWeek | null {
  const start = isoWeekStart(week);
  if (start === null) return null;
  return isoWeekOfDate(addDays(start, n * 7));
}

/**
 * The dense list of the `count` weeks ending at `endWeek`, oldest first.
 * This is the x-axis, produced before any data is looked at — which is what stops a
 * missing bucket from silently compressing the timeline.
 */
export function weekWindow(endWeek: IsoWeek, count: number): readonly IsoWeek[] {
  if (count <= 0) return [];
  const end = isoWeekStart(endWeek);
  if (end === null) return [];
  const weeks: IsoWeek[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    weeks.push(isoWeekOfDate(addDays(end, -offset * 7)));
  }
  return weeks;
}
