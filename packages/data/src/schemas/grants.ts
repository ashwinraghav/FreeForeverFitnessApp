import { z } from 'zod';
import { schemaVersionSchema, shortTextSchema } from '../common/envelope.js';
import { coachGrantIdSchema, userIdSchema } from '../common/ids.js';
import { serverTimestampSchema } from '../common/time.js';

/**
 * Coach access grants — the only mechanism by which one account ever reads another's
 * data, and the only reason a `get()` appears in `firestore.rules`.
 *
 * Four properties make this safe enough to ship in a public repository:
 *
 * 1. **Explicit.** Access exists only while a grant document exists. There is no
 *    role, no claim, no admin flag, and no path that is readable by default.
 * 2. **Unforgeable.** Only the owner may create, update or revoke a grant, and only
 *    for themselves. A coach cannot write one naming themselves. The rules enforce
 *    both halves; `test/rules/coach-grants.test.ts` asserts both.
 * 3. **Scoped.** A grant lists what it opens. A nutrition coach does not get progress
 *    photos, and photos are never in a default scope.
 * 4. **Revocable, immediately.** Revocation is a write to one document. The next read
 *    the coach attempts fails, because the rule re-reads the grant every time rather
 *    than trusting anything cached or claimed.
 *
 * A grant confers **read only**. There is no scope that lets a coach write into a
 * client's log, now or later: a coach who can edit history can hide what they did.
 *
 * The document id is derived — `${ownerUid}__${coachUid}` — so a rule resolves it
 * with one `get()` on a known path instead of a query. Rules cannot run queries, so
 * a random id here would make the whole design impossible.
 */

export const COACH_SCOPES = [
  /** Name, units, goal. Implied by every other scope being useful, but still explicit. */
  'profile',
  /** Workouts, routines, personal records, custom exercises, training aggregates. */
  'training',
  /** Nutrition days, foods, recipes, macro targets. */
  'nutrition',
  /** Bodyweight and measurements. */
  'body',
  /** Progress photos. Never implied; always a separate, deliberate tick. */
  'photos',
] as const;

export const coachScopeSchema = z.enum(COACH_SCOPES);
export type CoachScope = z.infer<typeof coachScopeSchema>;

export const GRANT_STATUSES = ['active', 'revoked'] as const;
export const grantStatusSchema = z.enum(GRANT_STATUSES);
export type GrantStatus = z.infer<typeof grantStatusSchema>;

/**
 * Grants live in a top-level collection rather than under `/users/{uid}`, because a
 * coach must be able to list the clients who granted them access, and a subcollection
 * under someone else's uid cannot be listed without reading that user's document
 * path. This is the one collection a rule allows a non-owner to see, and it holds
 * nothing but the fact of the relationship.
 */
export const coachGrantSchema = z
  .strictObject({
    sv: schemaVersionSchema,
    id: coachGrantIdSchema,
    ownerUid: userIdSchema,
    coachUid: userIdSchema,
    status: grantStatusSchema,
    scopes: z.array(coachScopeSchema).min(1).max(COACH_SCOPES.length),
    /**
     * Hard stop. A grant with no expiry is legal but the UI defaults to one, because
     * "I'll revoke it later" is a thing nobody does.
     */
    expiresAt: serverTimestampSchema.optional(),
    revokedAt: serverTimestampSchema.optional(),
    note: shortTextSchema.optional(),
    createdAt: serverTimestampSchema,
    updatedAt: serverTimestampSchema,
  })
  .refine((grant) => grant.ownerUid !== grant.coachUid, 'a user cannot grant access to themselves')
  .refine(
    (grant) => grant.id === `${grant.ownerUid}__${grant.coachUid}`,
    'the grant id must be derived from its two uids',
  )
  .refine(
    (grant) => grant.status !== 'revoked' || grant.revokedAt !== undefined,
    'a revoked grant must record when',
  )
  .refine(
    (grant) => new Set(grant.scopes).size === grant.scopes.length,
    'scopes must not repeat',
  );

export type CoachGrant = z.infer<typeof coachGrantSchema>;

/** Which scope opens which collection. Mirrored exactly in `firestore.rules`. */
export const SCOPE_BY_COLLECTION = {
  workouts: 'training',
  routines: 'training',
  personalRecords: 'training',
  exercises: 'training',
  aggregates: 'training',
  nutritionDays: 'nutrition',
  foods: 'nutrition',
  recipes: 'nutrition',
  macroTargets: 'nutrition',
  bodyMetrics: 'body',
  progressPhotos: 'photos',
  habits: 'training',
  habitDays: 'training',
} as const satisfies Record<string, CoachScope>;

export type ScopedCollection = keyof typeof SCOPE_BY_COLLECTION;
