import type { LocalDate } from './types.js';

/**
 * Local calendar days.
 *
 * A meal eaten at 23:40 belongs to that day, and it stays on that day after the
 * user flies to Tokyo. Every day-keyed document is keyed by the user's own
 * local date, never by a UTC-derived one — a UTC boundary silently moves a
 * third of the world's evening meals into tomorrow
 * (`packages/data/src/common/time.ts`).
 */

/** `YYYY-MM-DD` in the device's own timezone. */
export function toLocalDate(at: Date): LocalDate {
  const year = at.getFullYear();
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  const day = `${at.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Minutes to add to UTC to reach local time, as the device reports it. */
export function tzOffsetMinutes(at: Date): number {
  // `getTimezoneOffset` is minutes to add to *local* to reach UTC — the
  // opposite sign to what the schema stores. Getting this backwards puts a
  // reconstructed day boundary out by twice the offset.
  return -at.getTimezoneOffset();
}

export function today(now: Date = new Date()): LocalDate {
  return toLocalDate(now);
}

/** Shift a local date by whole days, without going near a timezone. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return toLocalDate(
    new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

/** Human label for a day header: "Today", "Yesterday", or a date. */
export function dayLabel(date: LocalDate, now: Date = new Date()): string {
  const todayDate = toLocalDate(now);
  if (date === todayDate) return 'Today';
  if (date === addDays(todayDate, -1)) return 'Yesterday';
  if (date === addDays(todayDate, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function isFuture(date: LocalDate, now: Date = new Date()): boolean {
  return date > toLocalDate(now);
}
