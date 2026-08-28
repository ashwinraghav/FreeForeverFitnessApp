import type {
  LocalDate,
  SetId,
  WorkoutExerciseId,
  WorkoutId,
} from '@freeforever/data';

/**
 * Client-generated identifiers.
 *
 * Every id in this domain is made on the device, never by the server: a lifter must
 * be able to start a session and log a set with no network at all, which means the id
 * has to exist before any write reaches Firestore (`common/ids.ts`).
 *
 * The format is time-ordered — a base-36 millisecond prefix and a random suffix — so
 * that ids generated on one device sort roughly chronologically, which makes a log
 * dump readable and makes collisions between two devices in the same millisecond
 * vanishingly unlikely without needing a UUID's 36 characters.
 */

const ID_RANDOM_BYTES = 8;

function randomSuffix(): string {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(ID_RANDOM_BYTES);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Only reachable in an environment with no Web Crypto at all. Still unique enough
  // for a per-device id, and the time prefix carries most of the entropy anyway.
  let out = '';
  while (out.length < ID_RANDOM_BYTES * 2) out += Math.random().toString(16).slice(2);
  return out.slice(0, ID_RANDOM_BYTES * 2);
}

function newId(prefix: string, now: number): string {
  return `${prefix}${now.toString(36)}-${randomSuffix()}`;
}

export function newWorkoutId(now: number = Date.now()): WorkoutId {
  return newId('w', now) as WorkoutId;
}

export function newWorkoutExerciseId(now: number = Date.now()): WorkoutExerciseId {
  return newId('x', now) as WorkoutExerciseId;
}

export function newSetId(now: number = Date.now()): SetId {
  return newId('s', now) as SetId;
}

/**
 * The user's own calendar day, `YYYY-MM-DD`, in their own timezone.
 *
 * Built from the local date parts rather than from `toISOString()`, which is UTC and
 * would silently move a third of the world's evening sessions into tomorrow
 * (`common/time.ts`).
 */
export function localDateOf(at: Date = new Date()): LocalDate {
  const year = String(at.getFullYear()).padStart(4, '0');
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
}

/**
 * Minutes to add to UTC to get local time. `getTimezoneOffset` returns the opposite
 * sign to the one `tzOffsetMinutesSchema` stores, which is the kind of detail that is
 * wrong in exactly one place in every codebase, so it is negated here and only here.
 */
export function tzOffsetMinutesOf(at: Date = new Date()): number {
  return -at.getTimezoneOffset();
}
