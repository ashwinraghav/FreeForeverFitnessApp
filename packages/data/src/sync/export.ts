import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import { paths, USER_SUBCOLLECTIONS, type UserSubcollection } from '../collections.js';
import { SCHEMA_VERSION } from '../common/envelope.js';
import type { UserId } from '../common/ids.js';
import {
  saveBodyMetric,
  saveExercise,
  saveFood,
  saveHabit,
  saveHabitDay,
  saveMacroTarget,
  saveNutritionDay,
  savePersonalRecord,
  saveProfile,
  saveProgressPhoto,
  saveRecipe,
  saveRoutine,
  saveWorkout,
  type WriteContext,
} from './writes.js';

/**
 * Export and import (constitution rule 7: unconditional and complete).
 *
 * **Export** works with no account beyond the anonymous uid every install has
 * (ADR-0009), and with no network: `source: 'cache'` reads only the local cache,
 * which on the authoring device holds everything the user ever wrote. The format
 * is plain JSON — documents exactly as stored, with Firestore timestamps flattened
 * to ISO-8601 strings — so it is readable by a human, a spreadsheet, or another
 * app, with no proprietary anything.
 *
 * **Import** replays an export through the ordinary write layer, so every
 * document is Zod-validated and every collision resolved by the same per-class
 * merge policies as live sync: day documents union, personal records join, and
 * random-id documents land intact because their ids are globally unique. Running
 * an import twice is therefore harmless, which is what makes the account-linking
 * merge (see `linking.ts`) resumable after a mid-flight failure.
 *
 * Two honest exclusions:
 * - `aggregates` are exported (completeness) but never imported — they are
 *   derived caches, and the engine rebuilds them from what the import wrote.
 * - Progress-photo **bytes** live in Cloud Storage and are not in this file; the
 *   metadata (date, pose, blurhash) is. Byte export needs a Storage download
 *   pass that is an app-shell concern; the gap is named in SYNC.md.
 */

export const EXPORT_FORMAT = 'thefreeforeverfitnessapp.export';

export interface UserDataExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: 1;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly uid: string;
  readonly profile: Record<string, unknown> | null;
  readonly collections: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

export interface ExportOptions {
  /**
   * `cache` never touches the network (works offline, costs nothing);
   * `server` reads fresh; `auto` tries the server and falls back to cache.
   */
  readonly source?: 'cache' | 'server' | 'auto';
}

function isTimestampLike(value: unknown): value is { seconds: number; nanoseconds: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { seconds?: unknown }).seconds === 'number' &&
    typeof (value as { nanoseconds?: unknown }).nanoseconds === 'number' &&
    Object.keys(value).every((key) => key === 'seconds' || key === 'nanoseconds' || key.startsWith('_'))
  );
}

/** Firestore timestamps become ISO strings; everything else is already JSON. */
function toPlainJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
    if (typeof candidate.toDate === 'function' || isTimestampLike(value)) {
      const seconds = Number(candidate.seconds ?? 0);
      const nanoseconds = Number(candidate.nanoseconds ?? 0);
      return new Date(seconds * 1000 + nanoseconds / 1_000_000).toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toPlainJson(entry);
    }
    return out;
  }
  return value;
}

async function readCollection(
  firestore: Firestore,
  uid: UserId,
  name: UserSubcollection,
  source: 'cache' | 'server' | 'auto',
): Promise<Record<string, unknown>[]> {
  const ref = collection(firestore, paths.userCollection(uid, name));
  let snapshot: QuerySnapshot;
  if (source === 'cache') {
    snapshot = await getDocsFromCache(ref);
  } else {
    try {
      snapshot = await getDocs(ref);
    } catch (error) {
      if (source === 'server') throw error;
      snapshot = await getDocsFromCache(ref);
    }
  }
  const out: Record<string, unknown>[] = [];
  snapshot.forEach((docSnapshot) => {
    out.push(toPlainJson(docSnapshot.data({ serverTimestamps: 'estimate' })) as Record<string, unknown>);
  });
  return out;
}

export async function exportUserData(
  firestore: Firestore,
  uid: UserId,
  options: ExportOptions = {},
): Promise<UserDataExport> {
  const source = options.source ?? 'auto';
  const collections: Record<string, readonly Record<string, unknown>[]> = {};
  for (const name of USER_SUBCOLLECTIONS) {
    collections[name] = await readCollection(firestore, uid, name, source);
  }

  let profile: Record<string, unknown> | null = null;
  const profileRef = doc(firestore, paths.profile(uid));
  try {
    const snapshot =
      source === 'cache' ? await getDocFromCache(profileRef) : await getDoc(profileRef);
    if (snapshot.exists()) {
      profile = toPlainJson(snapshot.data({ serverTimestamps: 'estimate' })) as Record<
        string,
        unknown
      >;
    }
  } catch {
    if (source === 'auto') {
      try {
        const cached = await getDocFromCache(profileRef);
        if (cached.exists()) {
          profile = toPlainJson(cached.data({ serverTimestamps: 'estimate' })) as Record<
            string,
            unknown
          >;
        }
      } catch {
        // No profile anywhere — a legitimate state before onboarding.
      }
    }
  }

  return {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    uid,
    profile,
    collections,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportFailure {
  readonly collection: string;
  readonly id: string;
  readonly reason: string;
}

export interface ImportReport {
  readonly written: number;
  readonly skipped: number;
  readonly failures: readonly ImportFailure[];
}

type SaveFn = (ctx: WriteContext, body: never) => Promise<void>;

/** Import order is fixed so referenced-by documents land before referencing ones. */
const IMPORTERS: readonly { readonly collection: UserSubcollection; readonly save: SaveFn }[] = [
  { collection: 'exercises', save: saveExercise as SaveFn },
  { collection: 'foods', save: saveFood as SaveFn },
  { collection: 'recipes', save: saveRecipe as SaveFn },
  { collection: 'routines', save: saveRoutine as SaveFn },
  { collection: 'habits', save: saveHabit as SaveFn },
  { collection: 'macroTargets', save: saveMacroTarget as SaveFn },
  { collection: 'workouts', save: saveWorkout as SaveFn },
  { collection: 'personalRecords', save: savePersonalRecord as SaveFn },
  { collection: 'bodyMetrics', save: saveBodyMetric as SaveFn },
  { collection: 'progressPhotos', save: saveProgressPhoto as SaveFn },
  { collection: 'nutritionDays', save: saveNutritionDay as SaveFn },
  { collection: 'habitDays', save: saveHabitDay as SaveFn },
];

const IMPORT_CHUNK = 20;

/** Envelope fields are re-stamped by the write layer; strip the exported ones. */
function bodyOf(document: Record<string, unknown>): Record<string, unknown> {
  const { sv: _sv, uid: _uid, createdAt: _c, updatedAt: _u, ...body } = document;
  return body;
}

/**
 * Replays an export under `ctx.uid`. Idempotent: re-running after a partial
 * failure completes rather than duplicating — random ids collide with
 * themselves, and date-keyed documents merge by union.
 */
export async function importUserData(
  ctx: WriteContext,
  data: UserDataExport,
): Promise<ImportReport> {
  if (data.format !== EXPORT_FORMAT) {
    throw new Error(`not a recognised export file (format: ${String(data.format)})`);
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `export is schema version ${data.schemaVersion}, this app understands ${SCHEMA_VERSION}; ` +
        'update the app before importing',
    );
  }

  let written = 0;
  let skipped = 0;
  const failures: ImportFailure[] = [];

  for (const importer of IMPORTERS) {
    const documents = data.collections[importer.collection] ?? [];
    for (let i = 0; i < documents.length; i += IMPORT_CHUNK) {
      const chunk = documents.slice(i, i + IMPORT_CHUNK);
      const results = await Promise.allSettled(
        chunk.map((document) => {
          const body = bodyOf(document);
          if (importer.collection === 'progressPhotos' && typeof body['storagePath'] === 'string') {
            // Metadata survives a uid change; the bytes are a named gap (SYNC.md).
            body['storagePath'] = (body['storagePath'] as string).replace(
              /^users\/[^/]+\//,
              `users/${ctx.uid}/`,
            );
          }
          return importer.save(ctx, body as never);
        }),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          written += 1;
        } else {
          failures.push({
            collection: importer.collection,
            id: String((chunk[index] as Record<string, unknown>)['id'] ?? '?'),
            reason: String(result.reason),
          });
        }
      });
    }
  }

  // Aggregates are derived; the engine rebuilds them. Count them as skipped so
  // the report is honest about what was in the file but not written.
  skipped += (data.collections['aggregates'] ?? []).length;

  // The profile imports only where the target account has none: an account that
  // already has preferences keeps them, and the anonymous profile (mostly
  // defaults) never overwrites a real one.
  if (data.profile !== null) {
    try {
      const existing = await getDoc(doc(ctx.firestore, paths.profile(ctx.uid)));
      if (!existing.exists()) {
        const body = bodyOf(data.profile);
        body['id'] = ctx.uid;
        await saveProfile(ctx, body as never);
        written += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures.push({ collection: 'profile', id: ctx.uid, reason: String(error) });
    }
  }

  return { written, skipped, failures };
}
