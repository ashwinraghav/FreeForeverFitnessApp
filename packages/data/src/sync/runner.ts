import type {
  AggregateEvent,
  AggregateId,
  AggregateReducer,
  AggregateStateById,
  DomainSnapshot,
} from '../aggregates.js';
import type { FirestoreTimestampLike, LocalDate } from '../common/time.js';
import { REBUILD_REASON_PREFIX } from './reducers/internal.js';

/**
 * The runner: what sits between the event stream and a reducer.
 *
 * The consistency model, in one paragraph. Reducers are replace-by-id folds (see
 * `reducers/internal.ts`), so their state is a pure function of the *latest seen
 * version of each source document*. The runner's only ordering job is therefore
 * per-document: never fold an older version of a document over a newer one. It
 * does that with the per-kind sequence gate below — the engine assigns strictly
 * increasing sequences in the order it observes changes, and an event whose
 * sequence is not greater than the highest already folded is returned unchanged,
 * exactly as the contract in `aggregates.ts` requires. Cross-document ordering
 * needs no protection at all: any interleaving converges to the same state.
 */

export interface AggregateRecord<TId extends AggregateId = AggregateId> {
  readonly id: TId;
  version: number;
  /** Highest event sequence folded in, per source kind. */
  sequenceByKind: Record<string, number>;
  state: AggregateStateById[TId];
  computedThrough: LocalDate | null;
  /** True when the in-memory fold is ahead of the persisted document. */
  dirty: boolean;
  /**
   * `createdAt` of the persisted Firestore document, once known. Null means the
   * next flush is a create; the rules make resending a changed `createdAt` on an
   * update a PERMISSION_DENIED, so this is load-bearing, not bookkeeping.
   */
  remoteCreatedAt: FirestoreTimestampLike | null;
}

export interface ApplyOutcome {
  /** False when the sequence gate dropped the event as a replay. */
  readonly applied: boolean;
  /** True when the reducer declared its state unusable; caller must rebuild. */
  readonly rebuildRequired: boolean;
  readonly dropped: readonly { readonly id: string; readonly reason: string }[];
}

export function freshRecord<TId extends AggregateId>(
  reducer: AggregateReducer<TId>,
): AggregateRecord<TId> {
  return {
    id: reducer.id,
    version: reducer.version,
    sequenceByKind: {},
    state: reducer.empty(),
    computedThrough: null,
    dirty: false,
    remoteCreatedAt: null,
  };
}

export function applyEvent<TId extends AggregateId>(
  record: AggregateRecord<TId>,
  reducer: AggregateReducer<TId>,
  event: AggregateEvent,
): ApplyOutcome {
  if (!reducer.handles.includes(event.kind)) {
    return { applied: false, rebuildRequired: false, dropped: [] };
  }
  const folded = record.sequenceByKind[event.kind] ?? 0;
  if (event.sequence <= folded) {
    // A replay. The reducer would be idempotent anyway, but dropping here keeps
    // `sequenceByKind` an honest high-water mark for gap detection.
    return { applied: false, rebuildRequired: false, dropped: [] };
  }
  const result = reducer.reduce(record.state, event);
  const rebuildRequired = result.dropped.some((entry) =>
    entry.reason.startsWith(REBUILD_REASON_PREFIX),
  );
  if (!rebuildRequired) {
    record.state = result.state;
    record.sequenceByKind = { ...record.sequenceByKind, [event.kind]: event.sequence };
    const date = eventLocalDate(event);
    if (date !== null && (record.computedThrough === null || date > record.computedThrough)) {
      record.computedThrough = date;
    }
    record.dirty = true;
  }
  return { applied: !rebuildRequired, rebuildRequired, dropped: result.dropped };
}

/** Replaces a record's fold with a full recomputation from source documents. */
export function rebuildRecord<TId extends AggregateId>(
  record: AggregateRecord<TId>,
  reducer: AggregateReducer<TId>,
  snapshot: DomainSnapshot,
  sequences: Readonly<Record<string, number>>,
): void {
  record.state = reducer.rebuild(snapshot);
  record.version = reducer.version;
  // Adopt the engine's current high-water marks: everything observed so far is,
  // by construction, included in the snapshot the rebuild just consumed.
  const adopted: Record<string, number> = {};
  for (const kind of reducer.handles) {
    adopted[kind] = sequences[kind] ?? 0;
  }
  record.sequenceByKind = adopted;
  record.dirty = true;
}

function eventLocalDate(event: AggregateEvent): LocalDate | null {
  const doc = event.next ?? event.previous;
  if (doc === null) return null;
  if ('localDate' in doc) return doc.localDate;
  if ('lastAchievedOn' in doc) return doc.lastAchievedOn ?? null;
  return null;
}

/**
 * Deterministic deep equality for aggregate states, used by the drift check.
 * States are plain JSON-safe data; key order is normalised so a state that has
 * round-tripped through Firestore (which does not preserve map key order)
 * compares equal to a freshly derived one.
 */
export function statesEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
