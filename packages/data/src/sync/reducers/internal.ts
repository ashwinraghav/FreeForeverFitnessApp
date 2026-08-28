import type { AggregateId, AggregateReduceResult, AggregateStateById } from '../../aggregates.js';

/**
 * The convention every reducer here follows, and why.
 *
 * Each reducer's state carries, beside the declared aggregate shape, one or more
 * underscore-prefixed **internal collections keyed by source document id**. The
 * declared fields (`weeks`, `series`, `days`, ...) are *derived* from those
 * collections, from scratch, on every fold.
 *
 * That one decision buys the three properties the contract demands, structurally
 * rather than by care:
 *
 * - **Idempotence**: `reduce` replaces the entry for `event.id` and re-derives.
 *   Applying the same event twice replaces the same entry with the same value —
 *   a no-op — with no dependence on `previous` being accurate.
 * - **Convergence under reordering**: the derived state is a pure function of the
 *   current entry per id. Whatever order events for *different* documents arrive
 *   in, the final state is identical. (Ordering between two versions of the *same*
 *   document is the runner's sequence gate.)
 * - **`reduce(empty(), events) === rebuild(snapshot)`**: both paths insert the same
 *   entries and call the same `derive`, summing in sorted-key order, so equal
 *   inputs produce bit-identical output — which is what makes the drift check a
 *   deep-equal rather than a tolerance.
 *
 * No incremental totals exist anywhere, so floating-point drift cannot accumulate:
 * a wrong number can only come from a wrong entry, and a wrong entry is replaced
 * whole by the next event for its document.
 *
 * The internal fields ride along inside the persisted `state` (which the schema
 * deliberately types as `z.unknown()`), and `features/insights` never sees them —
 * it reads the declared shape. A state that arrives *without* the internal fields
 * (older reducer version, foreign writer, corruption) is not guessed at:
 * {@link needsRebuild} refuses the event and the engine rebuilds from source.
 */

/** Marks a dropped-event reason as "state unusable, rebuild from source". */
export const REBUILD_REASON_PREFIX = 'rebuild:';

export function needsRebuild<TId extends AggregateId>(
  state: AggregateStateById[TId],
  id: string,
  detail: string,
): AggregateReduceResult<TId> {
  return { state, dropped: [{ id, reason: `${REBUILD_REASON_PREFIX} ${detail}` }] };
}

export function unchanged<TId extends AggregateId>(
  state: AggregateStateById[TId],
): AggregateReduceResult<TId> {
  return { state, dropped: [] };
}

export function changed<TId extends AggregateId>(
  state: AggregateStateById[TId],
): AggregateReduceResult<TId> {
  return { state, dropped: [] };
}

/** True when `state` carries the given internal collection as a plain object. */
export function hasInternal(state: object, field: string): boolean {
  const value = (state as Record<string, unknown>)[field];
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sorted keys, so every derive sums in one deterministic order. */
export function sortedKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort();
}

/** Copy of `record` without `id`; returns `record` itself when `id` is absent. */
export function without<T>(
  record: Readonly<Record<string, T>>,
  id: string,
): Readonly<Record<string, T>> {
  if (!(id in record)) return record;
  const out: Record<string, T> = {};
  for (const key of Object.keys(record)) {
    if (key !== id) out[key] = record[key] as T;
  }
  return out;
}
