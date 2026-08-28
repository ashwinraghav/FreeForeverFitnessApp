import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocsFromCache,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentChange,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { z } from 'zod';
import type {
  AggregateEvent,
  AggregateEventKind,
  AggregateId,
  AggregateReducer,
  AggregateStateById,
  DomainSnapshot,
} from '../aggregates.js';
import { AGGREGATE_IDS, aggregateDocumentSchema } from '../aggregates.js';
import { COLLECTIONS, paths, type UserSubcollection } from '../collections.js';
import { SCHEMA_VERSION, type DocumentEnvelope } from '../common/envelope.js';
import type { UserId } from '../common/ids.js';
import type { FirestoreTimestampLike } from '../common/time.js';
import { bodyMetricSchema } from '../schemas/body.js';
import { habitDaySchema, habitSchema } from '../schemas/habits.js';
import { macroTargetSchema, nutritionDaySchema } from '../schemas/nutrition.js';
import { profileSchema } from '../schemas/profile.js';
import { personalRecordSchema } from '../schemas/records.js';
import { routineSchema } from '../schemas/routine.js';
import { workoutSchema } from '../schemas/workout.js';
import { defaultKeyValueStore, type KeyValueStore } from './kv.js';
import type { WriteContext, WriteDiagnostic } from './writes.js';
import { REDUCERS } from './reducers/registry.js';
import {
  applyEvent,
  freshRecord,
  rebuildRecord,
  statesEqual,
  type AggregateRecord,
} from './runner.js';

/**
 * The sync engine.
 *
 * One instance per signed-in uid. It owns the two jobs ADR-0005 splits off from
 * the UI:
 *
 * **Delta sync in, aggregates out.** Each source collection gets one listener,
 * bounded by `where('updatedAt', '>', cursor)` — the only query shape SCHEMA.md
 * permits. Every observed change becomes an `AggregateEvent` fed through the
 * reducers, so the aggregates are maintained *on write* (including this device's
 * own offline writes, which arrive through the same listener with estimated
 * timestamps, before any network exists). `features/insights` reads exclusively
 * from {@link SyncEngine.getAggregate} / {@link SyncEngine.subscribe}; it has no
 * reason — and with the build rule, no way — to touch Firestore.
 *
 * **Bounded flushes.** The fold is pushed to `/users/{uid}/aggregates/{id}` so a
 * cold device pays one read instead of replaying years of history, but pushes are
 * debounced and throttled (at most one in-flight write per aggregate, no more
 * than one per {@link SyncEngineOptions.flushMinIntervalMs}) so logging a set
 * costs one document write, not six. Cursors are persisted only after their
 * events' folds are safely flushed; a crash in between re-delivers events, which
 * the replace-by-id reducers absorb.
 *
 * Known limitation, stated rather than hidden: a **hard delete performed on
 * another device** does not travel through a delta query (a deleted document
 * matches nothing), so it reaches this device's aggregates only via
 * {@link SyncEngine.repair}. The domain barely hard-deletes — workouts retract via
 * `status: 'discarded'`, day documents by emptying — and local deletes are
 * covered by {@link SyncEngine.noteLocalDelete}.
 */

export type SyncEngineDiagnostic =
  | { readonly kind: 'parse-failed'; readonly collection: string; readonly id: string }
  | {
      readonly kind: 'event-dropped';
      readonly aggregateId: AggregateId;
      readonly entries: readonly { readonly id: string; readonly reason: string }[];
    }
  | { readonly kind: 'rebuild'; readonly aggregateIds: readonly AggregateId[]; readonly reason: string }
  | { readonly kind: 'flush-failed'; readonly aggregateId: AggregateId; readonly error: unknown }
  | { readonly kind: 'drift-repaired'; readonly aggregateId: AggregateId };

export interface SyncEngineOptions {
  readonly firestore: Firestore;
  readonly uid: UserId;
  /** Device-local store for cursors. Defaults to Web Storage, else memory. */
  readonly kv?: KeyValueStore;
  /** Fallback IANA zone for rebuilds when no profile document exists yet. */
  readonly timeZone?: string;
  /** Quiet period between the last fold and a Firestore flush. */
  readonly flushQuietMs?: number;
  /** Floor between two flushes of the same aggregate document. */
  readonly flushMinIntervalMs?: number;
  readonly onDiagnostic?: (diagnostic: SyncEngineDiagnostic) => void;
}

interface SourceSpec {
  readonly kind: AggregateEventKind;
  readonly collection: UserSubcollection;
  readonly schema: z.ZodType<unknown>;
}

const SOURCES: readonly SourceSpec[] = [
  { kind: 'workout', collection: COLLECTIONS.workouts, schema: workoutSchema as z.ZodType<unknown> },
  { kind: 'routine', collection: COLLECTIONS.routines, schema: routineSchema as z.ZodType<unknown> },
  {
    kind: 'personalRecord',
    collection: COLLECTIONS.personalRecords,
    schema: personalRecordSchema as z.ZodType<unknown>,
  },
  {
    kind: 'bodyMetric',
    collection: COLLECTIONS.bodyMetrics,
    schema: bodyMetricSchema as z.ZodType<unknown>,
  },
  {
    kind: 'nutritionDay',
    collection: COLLECTIONS.nutritionDays,
    schema: nutritionDaySchema as z.ZodType<unknown>,
  },
  {
    kind: 'macroTarget',
    collection: COLLECTIONS.macroTargets,
    schema: macroTargetSchema as z.ZodType<unknown>,
  },
  { kind: 'habit', collection: COLLECTIONS.habits, schema: habitSchema as z.ZodType<unknown> },
  { kind: 'habitDay', collection: COLLECTIONS.habitDays, schema: habitDaySchema as z.ZodType<unknown> },
];

const KIND_BY_COLLECTION: ReadonlyMap<UserSubcollection, AggregateEventKind> = new Map(
  SOURCES.map((source) => [source.collection, source.kind]),
);

interface AggregateSlot {
  readonly reducer: AggregateReducer<AggregateId>;
  readonly record: AggregateRecord;
  lastFlushAt: number;
  flushInFlight: boolean;
}

export class SyncEngine {
  private readonly firestore: Firestore;
  private readonly uid: UserId;
  private readonly kv: KeyValueStore;
  private readonly fallbackTimeZone: string;
  private readonly flushQuietMs: number;
  private readonly flushMinIntervalMs: number;
  private readonly onDiagnostic: ((diagnostic: SyncEngineDiagnostic) => void) | undefined;

  private readonly slots = new Map<AggregateId, AggregateSlot>();
  private readonly shadow = new Map<AggregateEventKind, Map<string, unknown>>();
  private readonly sequences: Record<string, number> = {};
  private readonly cursors = new Map<UserSubcollection, Timestamp>();
  private readonly persistedCursors = new Map<UserSubcollection, Timestamp>();
  private readonly subscribers = new Map<AggregateId, Set<(state: unknown) => void>>();
  private readonly unsubscribes: (() => void)[] = [];
  private readonly rebuildQueue = new Set<AggregateId>();
  private readonly primed: Promise<void>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private stopped = false;
  private primedAll: Promise<void> = Promise.resolve();

  constructor(options: SyncEngineOptions) {
    this.firestore = options.firestore;
    this.uid = options.uid;
    this.kv = options.kv ?? defaultKeyValueStore(`freeforever.sync.${options.uid}`);
    this.fallbackTimeZone = options.timeZone ?? 'UTC';
    this.flushQuietMs = options.flushQuietMs ?? 15_000;
    this.flushMinIntervalMs = options.flushMinIntervalMs ?? 60_000;
    this.onDiagnostic = options.onDiagnostic;
    for (const id of AGGREGATE_IDS) {
      // One audited cast: REDUCERS pairs each id with its own reducer, and the
      // record is created from that same reducer, so the pair cannot cross-match.
      const reducer = REDUCERS[id] as unknown as AggregateReducer<AggregateId>;
      this.slots.set(id, {
        reducer,
        record: freshRecord(reducer),
        lastFlushAt: 0,
        flushInFlight: false,
      });
    }
    for (const source of SOURCES) this.shadow.set(source.kind, new Map());
  }

  /** Loads persisted folds, then attaches the delta listeners. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.loadAggregateRecords();
    await this.loadCursors();
    for (const source of SOURCES) {
      let resolvePrimed: () => void = () => undefined;
      this.primed.push(new Promise<void>((resolve) => (resolvePrimed = resolve)));
      const cursor = this.cursors.get(source.collection) ?? new Timestamp(0, 0);
      const sourceQuery = query(
        collection(this.firestore, paths.userCollection(this.uid, source.collection)),
        where('updatedAt', '>', cursor),
      );
      const unsubscribe = onSnapshot(
        sourceQuery,
        (snapshot) => {
          this.handleSnapshot(source, snapshot);
          resolvePrimed();
        },
        () => resolvePrimed(), // A failed listen must not wedge whenPrimed().
      );
      this.unsubscribes.push(unsubscribe);
    }
    this.primedAll = Promise.all(this.primed).then(async () => {
      if (this.rebuildQueue.size > 0) await this.performQueuedRebuilds('stale or missing fold');
    });
  }

  /** Resolves once every source has delivered its first (possibly cached) snapshot. */
  whenPrimed(): Promise<void> {
    return this.primedAll;
  }

  /** The only read path `features/insights` has. Local, synchronous, no Firestore. */
  getAggregate<TId extends AggregateId>(id: TId): AggregateStateById[TId] {
    return (this.slots.get(id) as AggregateSlot).record.state as AggregateStateById[TId];
  }

  subscribe<TId extends AggregateId>(
    id: TId,
    listener: (state: AggregateStateById[TId]) => void,
  ): () => void {
    const set = this.subscribers.get(id) ?? new Set();
    set.add(listener as (state: unknown) => void);
    this.subscribers.set(id, set);
    return () => set.delete(listener as (state: unknown) => void);
  }

  /**
   * A {@link WriteContext} whose writes fold into the aggregates immediately.
   * This is the context the app should use: a pending offline write carries an
   * unresolved `updatedAt` sentinel, which the delta listeners cannot match, so
   * without this hook a set logged in a basement would not reach a chart until
   * the write drained. The eventual server ack re-delivers the document through
   * the listener; the replace-by-id reducers absorb the duplicate.
   */
  writeContext(onDiagnostic?: (diagnostic: WriteDiagnostic) => void): WriteContext {
    return {
      firestore: this.firestore,
      uid: this.uid,
      ...(onDiagnostic !== undefined ? { onDiagnostic } : {}),
      onLocalWrite: (collectionName, document) => this.noteLocalWrite(collectionName, document),
    };
  }

  /** Folds a local write immediately, ahead of its server acknowledgement. */
  noteLocalWrite(
    collectionName: UserSubcollection,
    document: DocumentEnvelope & { id: string },
  ): void {
    const kind = KIND_BY_COLLECTION.get(collectionName);
    if (kind === undefined) return;
    const shadow = this.shadow.get(kind) as Map<string, unknown>;
    const previous = shadow.get(document.id) ?? null;
    shadow.set(document.id, document);
    this.dispatchEvent(kind, document.id, previous, document);
    this.scheduleFlush();
  }

  /**
   * Folds a local hard delete immediately. Delta queries cannot observe a
   * deletion, so the code that calls `deleteUserDocument` tells the engine.
   */
  noteLocalDelete(collectionName: UserSubcollection, id: string): void {
    const kind = KIND_BY_COLLECTION.get(collectionName);
    if (kind === undefined) return;
    const shadow = this.shadow.get(kind) as Map<string, unknown>;
    const previous = shadow.get(id) ?? null;
    shadow.delete(id);
    this.dispatchEvent(kind, id, previous, null);
    this.scheduleFlush();
  }

  /**
   * Drift detection and repair: recompute every aggregate from the documents in
   * the local cache and replace any fold that disagrees. Costs zero Firestore
   * reads. Returns the ids that had drifted.
   */
  async repair(): Promise<readonly AggregateId[]> {
    const snapshot = await this.readSnapshotFromCache();
    const drifted: AggregateId[] = [];
    for (const [id, slot] of this.slots) {
      const expected = slot.reducer.rebuild(snapshot);
      if (!statesEqual(expected, slot.record.state) || slot.record.version !== slot.reducer.version) {
        rebuildRecord(slot.record, slot.reducer, snapshot, this.sequences);
        drifted.push(id);
        this.onDiagnostic?.({ kind: 'drift-repaired', aggregateId: id });
        this.notify(id);
      }
    }
    if (drifted.length > 0) this.scheduleFlush();
    return drifted;
  }

  /**
   * Flushes every dirty aggregate immediately, bypassing the throttle. The
   * returned promise settles on server acknowledgement — await it in tests and
   * online teardown, but never in an offline path (an ack cannot arrive there;
   * the writes are queued in the SDK's persistent cache regardless).
   */
  flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const acks: Promise<void>[] = [];
    for (const [id, slot] of this.slots) {
      if (slot.record.dirty && !slot.flushInFlight) acks.push(this.flushSlot(id, slot));
    }
    return Promise.allSettled(acks).then(() => undefined);
  }

  /** Detaches listeners and initiates a final flush without awaiting its ack. */
  stop(): void {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    void this.flushNow();
  }

  // -------------------------------------------------------------------------
  // Event intake
  // -------------------------------------------------------------------------

  private handleSnapshot(source: SourceSpec, snapshot: QuerySnapshot): void {
    let maxUpdatedAt: Timestamp | null = null;
    for (const change of snapshot.docChanges()) {
      const id = change.doc.id;
      const shadow = this.shadow.get(source.kind) as Map<string, unknown>;
      if (change.type === 'removed') {
        const previous = shadow.get(id) ?? null;
        shadow.delete(id);
        this.dispatchEvent(source.kind, id, previous, null);
        continue;
      }
      const raw = change.doc.data({ serverTimestamps: 'estimate' });
      const parsed = source.schema.safeParse(raw);
      if (!parsed.success) {
        this.onDiagnostic?.({ kind: 'parse-failed', collection: source.collection, id });
        continue;
      }
      const previous = shadow.get(id) ?? null;
      shadow.set(id, parsed.data);
      this.dispatchEvent(source.kind, id, previous, parsed.data);
      maxUpdatedAt = laterOf(maxUpdatedAt, serverConfirmedUpdatedAt(change));
    }
    if (maxUpdatedAt !== null) {
      const current = this.cursors.get(source.collection);
      if (current === undefined || maxUpdatedAt.toMillis() > current.toMillis()) {
        this.cursors.set(source.collection, maxUpdatedAt);
      }
    }
    this.scheduleFlush();
    if (this.rebuildQueue.size > 0) {
      this.performQueuedRebuilds('reducer refused folded state').catch(() => {
        // A failed cache read leaves the queue populated for the next attempt.
      });
    }
  }

  private dispatchEvent(
    kind: AggregateEventKind,
    id: string,
    previous: unknown,
    next: unknown,
  ): void {
    const sequence = (this.sequences[kind] ?? 0) + 1;
    this.sequences[kind] = sequence;
    // Safe by construction: `previous`/`next` were parsed by the schema paired
    // with `kind` in SOURCES, which is exactly what the event type states.
    const event = { kind, id, previous, next, sequence } as AggregateEvent;
    for (const [aggregateId, slot] of this.slots) {
      const outcome = applyEvent(slot.record, slot.reducer, event);
      if (outcome.rebuildRequired) this.rebuildQueue.add(aggregateId);
      if (outcome.dropped.length > 0) {
        this.onDiagnostic?.({ kind: 'event-dropped', aggregateId, entries: outcome.dropped });
      }
      if (outcome.applied) this.notify(aggregateId);
    }
  }

  private notify(id: AggregateId): void {
    const listeners = this.subscribers.get(id);
    if (listeners === undefined) return;
    const state = (this.slots.get(id) as AggregateSlot).record.state;
    for (const listener of listeners) listener(state);
  }

  // -------------------------------------------------------------------------
  // Load, rebuild
  // -------------------------------------------------------------------------

  private async loadAggregateRecords(): Promise<void> {
    await Promise.all(
      [...this.slots.entries()].map(async ([id, slot]) => {
        const ref = doc(this.firestore, paths.aggregate(this.uid, id));
        let data: unknown = null;
        let createdAt: FirestoreTimestampLike | null = null;
        try {
          const cached = await getDocFromCache(ref);
          if (cached.exists()) {
            data = cached.data();
            createdAt = cached.get('createdAt') as FirestoreTimestampLike;
          }
        } catch {
          // Not cached. On a cold device this one read replaces replaying the
          // user's entire history, which is the point of syncing the fold.
          try {
            const remote = await getDoc(ref);
            if (remote.exists()) {
              data = remote.data();
              createdAt = remote.get('createdAt') as FirestoreTimestampLike;
            }
          } catch {
            // Offline and cold: start empty; the delta listeners fill us in.
          }
        }
        if (data === null) {
          this.rebuildQueue.add(id);
          return;
        }
        const parsed = aggregateDocumentSchema.safeParse(data);
        if (!parsed.success || parsed.data.version !== slot.reducer.version) {
          slot.record.remoteCreatedAt = createdAt;
          this.rebuildQueue.add(id);
          return;
        }
        slot.record.state = parsed.data.state as AggregateStateById[AggregateId];
        slot.record.version = parsed.data.version;
        slot.record.sequenceByKind = { ...parsed.data.sequenceByKind };
        slot.record.computedThrough = parsed.data.computedThrough ?? null;
        slot.record.remoteCreatedAt = createdAt;
        slot.record.dirty = false;
        for (const [kind, sequence] of Object.entries(parsed.data.sequenceByKind)) {
          if ((this.sequences[kind] ?? 0) < sequence) this.sequences[kind] = sequence;
        }
      }),
    );
  }

  private async performQueuedRebuilds(reason: string): Promise<void> {
    const ids = [...this.rebuildQueue];
    this.rebuildQueue.clear();
    if (ids.length === 0) return;
    let snapshot: DomainSnapshot;
    try {
      snapshot = await this.readSnapshotFromCache();
    } catch (error) {
      for (const id of ids) this.rebuildQueue.add(id); // retry on the next batch
      throw error;
    }
    for (const id of ids) {
      const slot = this.slots.get(id) as AggregateSlot;
      rebuildRecord(slot.record, slot.reducer, snapshot, this.sequences);
      this.notify(id);
    }
    this.onDiagnostic?.({ kind: 'rebuild', aggregateIds: ids, reason });
    this.scheduleFlush();
  }

  /**
   * Everything a rebuild needs, read from the local cache only — repair never
   * re-downloads. (`getDocsFromCache` bills nothing and works offline.)
   */
  private async readSnapshotFromCache(): Promise<DomainSnapshot> {
    const readAll = async <T>(name: UserSubcollection, schema: z.ZodType<T>): Promise<T[]> => {
      const snapshot = await getDocsFromCache(
        collection(this.firestore, paths.userCollection(this.uid, name)),
      );
      const out: T[] = [];
      snapshot.forEach((docSnapshot) => {
        const parsed = schema.safeParse(docSnapshot.data({ serverTimestamps: 'estimate' }));
        if (parsed.success) out.push(parsed.data);
        else this.onDiagnostic?.({ kind: 'parse-failed', collection: name, id: docSnapshot.id });
      });
      return out;
    };

    let timeZone = this.fallbackTimeZone;
    try {
      const profileSnapshot = await getDocFromCache(doc(this.firestore, paths.profile(this.uid)));
      if (profileSnapshot.exists()) {
        const profile = profileSchema.safeParse(
          profileSnapshot.data({ serverTimestamps: 'estimate' }),
        );
        if (profile.success && profile.data.timeZone !== undefined) {
          timeZone = profile.data.timeZone;
        }
      }
    } catch {
      // No cached profile; the fallback zone stands.
    }

    const [workouts, routines, personalRecords, bodyMetrics, nutritionDays, macroTargets, habits, habitDays] =
      await Promise.all([
        readAll(COLLECTIONS.workouts, workoutSchema as z.ZodType<DomainSnapshot['workouts'][number]>),
        readAll(COLLECTIONS.routines, routineSchema as z.ZodType<DomainSnapshot['routines'][number]>),
        readAll(
          COLLECTIONS.personalRecords,
          personalRecordSchema as z.ZodType<DomainSnapshot['personalRecords'][number]>,
        ),
        readAll(
          COLLECTIONS.bodyMetrics,
          bodyMetricSchema as z.ZodType<DomainSnapshot['bodyMetrics'][number]>,
        ),
        readAll(
          COLLECTIONS.nutritionDays,
          nutritionDaySchema as z.ZodType<DomainSnapshot['nutritionDays'][number]>,
        ),
        readAll(
          COLLECTIONS.macroTargets,
          macroTargetSchema as z.ZodType<DomainSnapshot['macroTargets'][number]>,
        ),
        readAll(COLLECTIONS.habits, habitSchema as z.ZodType<DomainSnapshot['habits'][number]>),
        readAll(COLLECTIONS.habitDays, habitDaySchema as z.ZodType<DomainSnapshot['habitDays'][number]>),
      ]);

    return {
      workouts,
      routines,
      personalRecords,
      bodyMetrics,
      nutritionDays,
      macroTargets,
      habits,
      habitDays,
      timeZone,
    };
  }

  // -------------------------------------------------------------------------
  // Flush
  // -------------------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.stopped || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDirty();
    }, this.flushQuietMs);
  }

  private flushDirty(): void {
    const now = Date.now();
    let deferred = false;
    for (const [id, slot] of this.slots) {
      if (!slot.record.dirty || slot.flushInFlight) continue;
      if (slot.lastFlushAt !== 0 && now - slot.lastFlushAt < this.flushMinIntervalMs) {
        deferred = true;
        continue;
      }
      void this.flushSlot(id, slot);
    }
    if (deferred) this.scheduleFlush();
  }

  /**
   * Initiates the write and handles completion in the background. The `setDoc`
   * promise resolves only on server ack — offline that is indefinitely later —
   * so nothing in the engine's event path ever awaits it; the `flushInFlight`
   * latch keeps it the only queued write per aggregate in the meantime.
   */
  private async flushSlot(id: AggregateId, slot: AggregateSlot): Promise<void> {
    const ref = doc(this.firestore, paths.aggregate(this.uid, id));
    const record = slot.record;
    const payload: Record<string, unknown> = {
      sv: SCHEMA_VERSION,
      uid: this.uid,
      id,
      createdAt: record.remoteCreatedAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: record.version,
      sequenceByKind: { ...record.sequenceByKind },
      computedAt: serverTimestamp(),
      state: stripUndefinedDeep(record.state),
      ...(record.computedThrough !== null ? { computedThrough: record.computedThrough } : {}),
    };
    record.dirty = false;
    slot.flushInFlight = true;
    slot.lastFlushAt = Date.now();
    try {
      await setDoc(ref, payload);
      if (record.remoteCreatedAt === null) {
        // First ack for a created doc: learn the resolved timestamp so the next
        // full overwrite carries it unchanged, as the rules demand.
        try {
          const written = await getDocFromCache(ref);
          record.remoteCreatedAt = written.get('createdAt') as FirestoreTimestampLike;
        } catch {
          record.remoteCreatedAt = null;
        }
      }
      await this.persistCursors();
    } catch (error) {
      record.dirty = true;
      if (isPermissionDenied(error)) {
        // Another device created or owns this document. Adopt its createdAt and
        // let the next flush write over it — folds converge, so losing this
        // round costs nothing.
        try {
          const remote = await getDoc(ref);
          if (remote.exists()) {
            record.remoteCreatedAt = remote.get('createdAt') as FirestoreTimestampLike;
          }
        } catch {
          // Still offline or denied; retry on the next flush.
        }
      }
      this.onDiagnostic?.({ kind: 'flush-failed', aggregateId: id, error });
    } finally {
      slot.flushInFlight = false;
    }
    if (record.dirty && !this.stopped) this.scheduleFlush();
  }

  /**
   * Cursors persist only after the folds that consumed their events are safely
   * written. Persisting earlier would let a crash skip events forever; persisting
   * later merely re-delivers some, which replace-by-id absorbs.
   */
  private async persistCursors(): Promise<void> {
    for (const [name, cursor] of this.cursors) {
      const persisted = this.persistedCursors.get(name);
      if (persisted !== undefined && persisted.toMillis() >= cursor.toMillis()) continue;
      await this.kv.set(
        `cursor.${name}`,
        JSON.stringify({ seconds: cursor.seconds, nanoseconds: cursor.nanoseconds }),
      );
      this.persistedCursors.set(name, cursor);
    }
  }

  private async loadCursors(): Promise<void> {
    await Promise.all(
      SOURCES.map(async (source) => {
        const raw = await this.kv.get(`cursor.${source.collection}`);
        if (raw === null) return;
        try {
          const value = JSON.parse(raw) as { seconds: number; nanoseconds: number };
          const cursor = new Timestamp(value.seconds, value.nanoseconds);
          this.cursors.set(source.collection, cursor);
          this.persistedCursors.set(source.collection, cursor);
        } catch {
          // A corrupt cursor re-syncs from zero. Wasteful, never wrong.
        }
      }),
    );
  }
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'permission-denied'
  );
}

function serverConfirmedUpdatedAt(change: DocumentChange): Timestamp | null {
  if (change.doc.metadata.hasPendingWrites) return null;
  const value = change.doc.get('updatedAt') as unknown;
  return value instanceof Timestamp ? value : null;
}

function laterOf(a: Timestamp | null, b: Timestamp | null): Timestamp | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.toMillis() >= b.toMillis() ? a : b;
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (typeof value === 'object' && value !== null && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = stripUndefinedDeep(entry);
    }
    return out;
  }
  return value;
}
