import { z } from 'zod';
import { userIdSchema } from './ids.js';
import { serverTimestampSchema } from './time.js';

/**
 * Every synced document carries the same four-field envelope. It is the only thing
 * `firestore.rules` can validate cheaply and uniformly, so it is also the only thing
 * every rule validates identically.
 *
 *   sv        schema version — see below
 *   uid       owner, denormalised out of the path so a rule can compare it
 *   createdAt server time, immutable after create
 *   updatedAt server time, rewritten on every write
 *
 * `uid` duplicates information already in the document path. That redundancy is
 * deliberate: it lets a rule reject a payload that claims to belong to someone else
 * even when the path is the writer's own, and it makes an exported document
 * self-describing without its path.
 */

/**
 * Bumped whenever a document shape changes in a way a previous client cannot read.
 *
 * `firestore.rules` rejects any write with `sv` above this number, which means the
 * deployment order is fixed and not optional: **rules deploy before the client that
 * writes the new version**. The reverse order takes every write from the new client
 * to PERMISSION_DENIED.
 */
export const SCHEMA_VERSION = 1;

export const schemaVersionSchema = z.number().int().min(1).max(SCHEMA_VERSION);

export const documentEnvelopeSchema = z.strictObject({
  sv: schemaVersionSchema,
  uid: userIdSchema,
  createdAt: serverTimestampSchema,
  updatedAt: serverTimestampSchema,
});

export type DocumentEnvelope = z.infer<typeof documentEnvelopeSchema>;

/**
 * The shape a client actually hands to `setDoc`/`updateDoc`: identical to the stored
 * document minus the two server timestamps, which are written as sentinels and
 * resolved by the server. Keeping this as a distinct type is what stops a client
 * from ever inventing a `createdAt` — the type simply has no slot for one, and the
 * rules reject it if a hand-rolled write tries anyway.
 */
export type Draft<T extends DocumentEnvelope> = Omit<T, 'createdAt' | 'updatedAt'>;

/** Strips the server-written fields from a document schema to get its draft schema. */
export function draftSchemaOf<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): z.ZodObject<Omit<T['shape'], 'createdAt' | 'updatedAt'>> {
  return schema.omit({ createdAt: true, updatedAt: true }) as unknown as z.ZodObject<
    Omit<T['shape'], 'createdAt' | 'updatedAt'>
  >;
}

/** Short free text a user typed. Bounded so a note cannot become a payload. */
export const shortTextSchema = z.string().max(280);
/** Longer free text — a routine description, a recipe method step. */
export const longTextSchema = z.string().max(2_000);
/** A display name: exercise title, routine name, meal name. */
export const displayNameSchema = z.string().min(1).max(120);
