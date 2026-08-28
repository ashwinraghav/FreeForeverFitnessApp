import { z } from 'zod';

/**
 * Three different kinds of time exist in this domain and conflating them is the
 * source of most date bugs in fitness apps.
 *
 * 1. **Server time** (`createdAt`, `updatedAt`) — written with the Firestore
 *    `serverTimestamp()` sentinel and enforced by security rules to equal
 *    `request.time`. Used for sync ordering and conflict resolution only. Never
 *    shown to a user: an offline write committed three days later has a server
 *    timestamp three days after the workout happened.
 *
 * 2. **Wall-clock instant** (`startedAt`, `performedAt`) — epoch milliseconds from
 *    the device clock. This is when the thing actually happened. It is trusted for
 *    display and untrusted for ordering, because device clocks are wrong.
 *
 * 3. **Local calendar day** (`localDate`) — a `YYYY-MM-DD` string in the user's
 *    own timezone at the moment of logging, plus the offset that produced it.
 *    A meal eaten at 23:40 belongs to that day, and it stays on that day after the
 *    user flies to Tokyo. Every "per day" document is keyed by this, never by a
 *    UTC-derived date, because a UTC day boundary silently moves a third of the
 *    world's evening meals into tomorrow.
 */

/** Firestore `Timestamp` from either the client or admin SDK, structurally. */
export interface FirestoreTimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
}

export const serverTimestampSchema = z.custom<FirestoreTimestampLike>(
  (value): boolean =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FirestoreTimestampLike).seconds === 'number' &&
    typeof (value as FirestoreTimestampLike).nanoseconds === 'number',
  { message: 'expected a Firestore Timestamp' },
);

/** Epoch milliseconds from a device clock. Bounded to keep obvious garbage out. */
export const epochMillisSchema = z
  .number()
  .int()
  .min(946_684_800_000) // 2000-01-01
  .max(4_102_444_800_000) // 2100-01-01
  .brand<'EpochMillis'>();

export type EpochMillis = z.infer<typeof epochMillisSchema>;

const LOCAL_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * `YYYY-MM-DD` in the user's local timezone. Doubles as a document id for every
 * day-keyed collection, which makes an offline day-write idempotent: two devices
 * logging the same day converge on one document instead of two.
 */
export const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, 'expected YYYY-MM-DD')
  .refine(isRealCalendarDate, 'not a real calendar date')
  .brand<'LocalDate'>();

export type LocalDate = z.infer<typeof localDateSchema>;

function isRealCalendarDate(value: string): boolean {
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day
  );
}

/**
 * Minutes to add to UTC to get local time, as reported by the logging device.
 * Stored alongside every `localDate` so a later timezone change is detectable and
 * the original day boundary is reconstructable. Range covers UTC-12 to UTC+14.
 */
export const tzOffsetMinutesSchema = z.number().int().min(-720).max(840);

/** ISO week key, `YYYY-Www`. The bucket key for weekly aggregates. */
export const isoWeekSchema = z
  .string()
  .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, 'expected YYYY-Www')
  .brand<'IsoWeek'>();

export type IsoWeek = z.infer<typeof isoWeekSchema>;

/** `YYYY-MM`. The bucket key for monthly aggregates. */
export const isoMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM')
  .brand<'IsoMonth'>();

export type IsoMonth = z.infer<typeof isoMonthSchema>;
