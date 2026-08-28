import { z } from 'zod';

/**
 * Fractional index keys, for ordering sets inside a workout.
 *
 * The obvious design — an integer `order` field — is wrong here, and the reason is
 * specific to this app rather than general fastidiousness. Inserting a set between
 * set 2 and set 3 mid-workout renumbers every set after it. Under ADR-0005 the
 * document is the sync unit, so a renumber is a rewrite of the whole session, and
 * two devices doing it concurrently resolve last-writer-wins: the phone that
 * inserted a drop set and the watch that ticked off set 5 do not merge, one of them
 * loses. Losing entered sets is the worst failure mode in this category.
 *
 * A fractional index gives every set a key that is *derived from its neighbours* and
 * never depends on anything else. Inserting between two sets mutates one field on
 * one set. Deleting mutates nothing. Two devices inserting in the same gap produce
 * two different keys that both sort into that gap, so the merge is a union and
 * nothing is lost — the worst case is two sets in an arbitrary but stable order.
 *
 * Keys are base-62 fraction digits ordered to match ASCII (`0-9 < A-Z < a-z`), so
 * plain string comparison is the sort. A key never ends in `0`, which is what keeps
 * `a < between(a, b) < b` true for every pair.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO_DIGIT = '0';

export const sortKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z]+$/, 'sort key must be base-62 digits')
  .refine((key) => !key.endsWith('0'), 'sort key must not end in 0')
  .brand<'SortKey'>();

export type SortKey = z.infer<typeof sortKeySchema>;

/**
 * Returns a key strictly between `before` and `after`.
 *
 * `null` for `before` means "start of the list"; `null` for `after` means "end of
 * the list". `sortKeyBetween(null, null)` is the key for the first item.
 *
 * @throws if `before >= after`, which means the caller passed neighbours that are
 *         not actually adjacent or not actually sorted.
 */
export function sortKeyBetween(before: SortKey | null, after: SortKey | null): SortKey {
  const a = before ?? '';
  const b = after;
  if (b !== null && a >= b) {
    throw new Error(`sortKeyBetween: expected before < after, got ${JSON.stringify([a, b])}`);
  }
  return midpoint(a, b) as SortKey;
}

/** Appends after the last key in an already-sorted list. */
export function sortKeyAfter(last: SortKey | null): SortKey {
  return sortKeyBetween(last, null);
}

/** Prepends before the first key in an already-sorted list. */
export function sortKeyBefore(first: SortKey | null): SortKey {
  return sortKeyBetween(null, first);
}

/**
 * Generates `count` keys spread across the gap, for laying out a routine's planned
 * sets in one pass without count-many round trips through {@link sortKeyBetween}.
 */
export function sortKeySequence(
  count: number,
  before: SortKey | null = null,
  after: SortKey | null = null,
): SortKey[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`sortKeySequence: count must be a non-negative integer, got ${count}`);
  }
  const keys: SortKey[] = [];
  let cursor = before;
  for (let index = 0; index < count; index += 1) {
    cursor = sortKeyBetween(cursor, after);
    keys.push(cursor);
  }
  return keys;
}

/** Comparator for anything carrying a sort key. Stable, total, and pure. */
export function bySortKey<T extends { readonly sortKey: SortKey }>(left: T, right: T): number {
  if (left.sortKey < right.sortKey) return -1;
  if (left.sortKey > right.sortKey) return 1;
  return 0;
}

/**
 * Sorts by key, breaking ties on id so two devices that generated the same key in
 * the same gap still agree on the order. Array order inside a stored document is
 * never authoritative; this function is.
 */
export function sortedByKey<T extends { readonly sortKey: SortKey; readonly id: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((left, right) => bySortKey(left, right) || (left.id < right.id ? -1 : 1));
}

/**
 * Midpoint of two base-62 fractions. `a` is the empty string for 0; `b` is `null`
 * for 1. Both are assumed not to end in `0`, which the schema enforces and which
 * every value this function returns preserves.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Descend past the shared prefix so the recursion only ever compares the first
    // digit that actually differs.
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) {
      shared += 1;
    }
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }

  // `a` empty means the fraction 0, so its leading digit is 0. `b` null or empty
  // means 1, which is one past the last digit.
  const digitA = DIGITS.indexOf(a.slice(0, 1) || ZERO_DIGIT);
  const digitB = b !== null && b.length > 0 ? DIGITS.indexOf(b.slice(0, 1)) : BASE;

  if (digitB - digitA > 1) {
    // There is room for a digit between them; take the middle one. The index is in
    // range because digitA >= 0 and digitB <= BASE, so `digit()` cannot fail.
    return digit(Math.round(0.5 * (digitA + digitB)));
  }
  if (b !== null && b.length > 1) {
    // Adjacent digits, but `b` has more to give — borrow from its tail.
    return b.slice(0, 1);
  }
  // Adjacent digits and nothing to borrow: keep `a`'s digit and grow one place.
  return (a.slice(0, 1) || ZERO_DIGIT) + midpoint(a.slice(1), null);
}

function digit(index: number): string {
  const found = DIGITS[index];
  if (found === undefined) {
    throw new Error(`sortKey: digit index ${index} out of range`);
  }
  return found;
}
