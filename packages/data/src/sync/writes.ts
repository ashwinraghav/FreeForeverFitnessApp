import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  serverTimestamp,
  setDoc,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { z } from 'zod';
import { SCHEMA_VERSION, type DocumentEnvelope } from '../common/envelope.js';
import type { UserId } from '../common/ids.js';
import { COLLECTIONS, paths, type UserSubcollection } from '../collections.js';
import type { BodyMetric } from '../schemas/body.js';
import { bodyMetricSchema } from '../schemas/body.js';
import type { Exercise } from '../schemas/exercise.js';
import { exerciseSchema } from '../schemas/exercise.js';
import type { Habit, HabitDay } from '../schemas/habits.js';
import { habitDaySchema, habitSchema } from '../schemas/habits.js';
import type { FoodItem, MacroTarget, NutritionDay, Recipe } from '../schemas/nutrition.js';
import {
  foodItemSchema,
  macroTargetSchema,
  nutritionDaySchema,
  recipeSchema,
} from '../schemas/nutrition.js';
import type { Profile } from '../schemas/profile.js';
import { profileSchema } from '../schemas/profile.js';
import type { PersonalRecord } from '../schemas/records.js';
import { personalRecordSchema } from '../schemas/records.js';
import type { Routine } from '../schemas/routine.js';
import { routineSchema } from '../schemas/routine.js';
import type { Workout } from '../schemas/workout.js';
import { workoutSchema } from '../schemas/workout.js';
import type { ProgressPhoto } from '../schemas/body.js';
import { progressPhotoSchema } from '../schemas/body.js';
import {
  mergeBodyMetrics,
  mergeHabitDays,
  mergeNutritionDays,
  mergePersonalRecords,
  preferLocal,
  type MergeStrategy,
} from './merge.js';

/**
 * The write boundary.
 *
 * Every write in the app goes through here, which is what makes three promises
 * hold everywhere instead of wherever someone remembered:
 *
 * 1. **Zod validates the full document before it leaves the device.** The rules
 *    bound what they can (ownership, envelope, enums, caps); element-level
 *    validation of nested arrays is this layer's job, per SCHEMA.md.
 * 2. **The envelope is stamped in one place.** `sv`, `uid`, and the two
 *    `serverTimestamp()` sentinels — and `createdAt` is resent only with its
 *    stored value, because the rules reject anything else.
 * 3. **A rejected offline create is recovered, not lost.** Two devices that both
 *    created Tuesday's nutrition day address the same document id; the loser's
 *    queued create drains as an invalid update and is denied. The recovery path
 *    fetches the winner, merges under the data class's policy (`merge.ts`), and
 *    retries as a proper update. The user's entries survive the collision.
 *
 * Calls return a promise that settles on **server acknowledgement**. The local
 * cache is updated synchronously before that, so UI code must not await these to
 * render — awaiting a write in a basement gym is a spinner that never resolves.
 */

export interface WriteDiagnostic {
  readonly kind: 'conflict-recovered' | 'write-failed' | 'recovery-failed';
  readonly path: string;
  readonly error?: unknown;
}

export interface WriteContext {
  readonly firestore: Firestore;
  readonly uid: UserId;
  readonly onDiagnostic?: (diagnostic: WriteDiagnostic) => void;
  /**
   * Invoked synchronously with every validated document as it is handed to
   * Firestore (and again with the merged result after a conflict recovery).
   * This is how the sync engine folds a write into the aggregates *immediately*:
   * a pending write's `updatedAt` sentinel is unresolved, so the engine's delta
   * listeners cannot see it until the server acknowledges — hours later in a
   * basement gym. Use {@link SyncEngine.writeContext} to get a wired context.
   */
  readonly onLocalWrite?: (
    collection: UserSubcollection,
    document: DocumentEnvelope & { id: string },
  ) => void;
}

/** What a caller supplies: the document minus everything this layer stamps. */
export type DraftBody<T extends DocumentEnvelope> = Omit<
  T,
  'sv' | 'uid' | 'createdAt' | 'updatedAt'
>;

/** Structurally a Firestore timestamp; lets the full schema validate a draft. */
const PLACEHOLDER_TIME = { seconds: 0, nanoseconds: 0 } as const;

const MAX_RECOVERY_ATTEMPTS = 3;

interface DocClass<T extends DocumentEnvelope & { id: string }> {
  readonly schema: z.ZodType<T>;
  readonly merge: MergeStrategy<T>;
  readonly path: (uid: UserId, id: string) => string;
  /** Set for aggregate-feeding collections; drives the onLocalWrite hook. */
  readonly collection?: UserSubcollection;
}

function subPath(collection: UserSubcollection): (uid: UserId, id: string) => string {
  return (uid, id) => `${paths.userCollection(uid, collection)}/${id}`;
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'permission-denied'
  );
}

/** Firestore rejects `undefined` values; optional fields are absent, not null. */
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

async function cachedSnapshot(ref: DocumentReference): Promise<DocumentSnapshot | null> {
  try {
    const snapshot = await getDocFromCache(ref);
    return snapshot.exists() ? snapshot : null;
  } catch {
    return null; // Not cached is the common case for a first write.
  }
}

function payloadOf<T extends DocumentEnvelope>(
  document: T,
  createdAt: unknown,
): Record<string, unknown> {
  const body = stripUndefinedDeep(document) as Record<string, unknown>;
  body['createdAt'] = createdAt;
  body['updatedAt'] = serverTimestamp();
  return body;
}

async function writeWithRecovery<T extends DocumentEnvelope & { id: string }>(
  ctx: WriteContext,
  docClass: DocClass<T>,
  document: T,
): Promise<void> {
  if (docClass.collection !== undefined) ctx.onLocalWrite?.(docClass.collection, document);
  const ref = doc(ctx.firestore, docClass.path(ctx.uid, document.id));
  const cached = await cachedSnapshot(ref);
  const createdAt = cached === null ? serverTimestamp() : cached.get('createdAt');
  try {
    await setDoc(ref, payloadOf(document, createdAt));
  } catch (error) {
    if (!isPermissionDenied(error)) {
      ctx.onDiagnostic?.({ kind: 'write-failed', path: ref.path, error });
      throw error;
    }
    await recover(ctx, docClass, ref, document, 1);
  }
}

/**
 * The conflict path. A denied write is retried against what the server actually
 * holds: adopt its `createdAt`, merge its body with ours under the class policy,
 * write as a well-formed update. Runs online by construction — a queued offline
 * write can only be denied once it has drained.
 */
async function recover<T extends DocumentEnvelope & { id: string }>(
  ctx: WriteContext,
  docClass: DocClass<T>,
  ref: DocumentReference,
  local: T,
  attempt: number,
): Promise<void> {
  try {
    const serverSnapshot = await getDoc(ref);
    let toWrite = local;
    let createdAt: unknown = serverTimestamp();
    if (serverSnapshot.exists()) {
      createdAt = serverSnapshot.get('createdAt');
      const parsed = docClass.schema.safeParse(serverSnapshot.data());
      // A server document we cannot parse is one we must not guess a merge for;
      // fall back to our own body over its createdAt.
      if (parsed.success) toWrite = docClass.merge(local, parsed.data);
    }
    if (docClass.collection !== undefined && toWrite !== local) {
      ctx.onLocalWrite?.(docClass.collection, toWrite);
    }
    await setDoc(ref, payloadOf(toWrite, createdAt));
    ctx.onDiagnostic?.({ kind: 'conflict-recovered', path: ref.path });
  } catch (error) {
    if (isPermissionDenied(error) && attempt < MAX_RECOVERY_ATTEMPTS) {
      await recover(ctx, docClass, ref, local, attempt + 1);
      return;
    }
    ctx.onDiagnostic?.({ kind: 'recovery-failed', path: ref.path, error });
    throw error;
  }
}

function makeSave<T extends DocumentEnvelope & { id: string }>(
  docClass: DocClass<T>,
): (ctx: WriteContext, body: DraftBody<T>) => Promise<void> {
  return (ctx, body) => {
    // Full-schema validation with placeholder timestamps: every cross-field
    // refinement runs, and the placeholders never reach the wire.
    const document = docClass.schema.parse({
      ...body,
      sv: SCHEMA_VERSION,
      uid: ctx.uid,
      createdAt: PLACEHOLDER_TIME,
      updatedAt: PLACEHOLDER_TIME,
    });
    return writeWithRecovery(ctx, docClass, document);
  };
}

// ---------------------------------------------------------------------------
// One save function per collection, each carrying its conflict policy.
// ---------------------------------------------------------------------------

export const saveProfile = makeSave<Profile>({
  schema: profileSchema,
  merge: preferLocal,
  path: (uid) => paths.profile(uid),
});

export const saveWorkout = makeSave<Workout>({
  schema: workoutSchema as unknown as z.ZodType<Workout>,
  merge: preferLocal,
  path: subPath(COLLECTIONS.workouts),
  collection: COLLECTIONS.workouts,
});

export const saveRoutine = makeSave<Routine>({
  schema: routineSchema as unknown as z.ZodType<Routine>,
  merge: preferLocal,
  path: subPath(COLLECTIONS.routines),
  collection: COLLECTIONS.routines,
});

export const saveExercise = makeSave<Exercise>({
  schema: exerciseSchema,
  merge: preferLocal,
  path: subPath(COLLECTIONS.exercises),
  collection: COLLECTIONS.exercises,
});

export const saveFood = makeSave<FoodItem>({
  schema: foodItemSchema,
  merge: preferLocal,
  path: subPath(COLLECTIONS.foods),
  collection: COLLECTIONS.foods,
});

export const saveRecipe = makeSave<Recipe>({
  schema: recipeSchema as unknown as z.ZodType<Recipe>,
  merge: preferLocal,
  path: subPath(COLLECTIONS.recipes),
  collection: COLLECTIONS.recipes,
});

export const saveMacroTarget = makeSave<MacroTarget>({
  schema: macroTargetSchema,
  merge: preferLocal,
  path: subPath(COLLECTIONS.macroTargets),
  collection: COLLECTIONS.macroTargets,
});

export const saveHabit = makeSave<Habit>({
  schema: habitSchema as unknown as z.ZodType<Habit>,
  merge: preferLocal,
  path: subPath(COLLECTIONS.habits),
  collection: COLLECTIONS.habits,
});

export const saveProgressPhoto = makeSave<ProgressPhoto>({
  schema: progressPhotoSchema,
  merge: preferLocal,
  path: subPath(COLLECTIONS.progressPhotos),
  collection: COLLECTIONS.progressPhotos,
});

export const saveNutritionDay = makeSave<NutritionDay>({
  schema: nutritionDaySchema as unknown as z.ZodType<NutritionDay>,
  merge: mergeNutritionDays,
  path: subPath(COLLECTIONS.nutritionDays),
  collection: COLLECTIONS.nutritionDays,
});

export const saveHabitDay = makeSave<HabitDay>({
  schema: habitDaySchema as unknown as z.ZodType<HabitDay>,
  merge: mergeHabitDays,
  path: subPath(COLLECTIONS.habitDays),
  collection: COLLECTIONS.habitDays,
});

export const saveBodyMetric = makeSave<BodyMetric>({
  schema: bodyMetricSchema as unknown as z.ZodType<BodyMetric>,
  merge: mergeBodyMetrics,
  path: subPath(COLLECTIONS.bodyMetrics),
  collection: COLLECTIONS.bodyMetrics,
});

const personalRecordClass: DocClass<PersonalRecord> = {
  schema: personalRecordSchema,
  merge: mergePersonalRecords,
  path: subPath(COLLECTIONS.personalRecords),
  collection: COLLECTIONS.personalRecords,
};

/**
 * PRs get the join applied on the way in as well as on conflict: whatever the
 * local cache already knows is folded into the write, so a plain overwrite can
 * never regress a record this device has seen.
 */
export async function savePersonalRecord(
  ctx: WriteContext,
  body: DraftBody<PersonalRecord>,
): Promise<void> {
  const document = personalRecordSchema.parse({
    ...body,
    sv: SCHEMA_VERSION,
    uid: ctx.uid,
    createdAt: PLACEHOLDER_TIME,
    updatedAt: PLACEHOLDER_TIME,
  });
  const ref = doc(ctx.firestore, personalRecordClass.path(ctx.uid, document.id));
  const cached = await cachedSnapshot(ref);
  let toWrite = document;
  if (cached !== null) {
    const parsed = personalRecordSchema.safeParse(cached.data());
    if (parsed.success) toWrite = mergePersonalRecords(document, parsed.data);
  }
  return writeWithRecovery(ctx, personalRecordClass, toWrite);
}

/** Hard delete. Rare on purpose — most of the domain retracts via status fields. */
export async function deleteUserDocument(
  ctx: WriteContext,
  collection: UserSubcollection,
  id: string,
): Promise<void> {
  await deleteDoc(doc(ctx.firestore, `${paths.userCollection(ctx.uid, collection)}/${id}`));
}
