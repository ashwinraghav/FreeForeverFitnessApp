import {
  linkWithCredential,
  signInWithCredential,
  type Auth,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { doc, getDocFromCache, type Firestore } from 'firebase/firestore';
import { paths } from '../collections.js';
import type { UserId } from '../common/ids.js';
import { profileSchema } from '../schemas/profile.js';
import { exportUserData, importUserData, type ImportReport, type UserDataExport } from './export.js';
import type { KeyValueStore } from './kv.js';
import { saveProfile, type WriteContext } from './writes.js';

/**
 * Anonymous → linked account upgrade (ADR-0009). Data loss here is unforgivable,
 * so the flow is built backwards from its failure cases.
 *
 * **The happy path is not a migration.** `linkWithCredential` attaches the
 * credential to the anonymous account *in place*: same uid, same documents,
 * nothing moves, nothing can be lost. This is why ADR-0009 chose anonymous auth
 * over local-only storage in the first place.
 *
 * **The hard path is "this credential already has an account"** — the same
 * person installed on a second device, or came back after reinstalling. Policy:
 * **merge, into the existing account.** Refusing would strand whichever half of
 * the training history the user is not currently holding, and a fitness log has
 * no meaningful "pick one" — both halves are things that really happened. The
 * merge direction is fixed (anonymous data moves into the credentialed account)
 * because the credentialed uid is the durable identity the user can sign into
 * elsewhere; the anonymous uid dies with this device's storage.
 *
 * Ordering is what makes the merge unable to lose data:
 *
 * 1. **Export first, while still anonymous.** The full backup is written to the
 *    device journal *before* any auth call. From this moment the data exists in
 *    three places: the anonymous account's documents (untouched throughout),
 *    the local Firestore cache, and the journal backup.
 * 2. **Then switch** (`signInWithCredential`). If this fails, the user is still
 *    anonymous and nothing has changed.
 * 3. **Then import** the backup into the target uid — through the ordinary write
 *    layer, so collisions merge under the per-class policies and every write is
 *    server-acknowledged. Import is idempotent, so a crash anywhere in step 3
 *    resumes on next launch via {@link resumePendingLink} and simply re-runs.
 *
 * The same-person-two-devices case falls out: device A linked in place; device
 * B hits the merge path and unions its history into the same account. Running
 * either order, or both twice, converges.
 *
 * What is deliberately NOT done: deleting the anonymous account's documents
 * after a merge. Once signed in as the target, this device can no longer act as
 * the anonymous user (an anonymous credential cannot be re-obtained), so those
 * documents become unreachable-but-extant. That is the orphaned-account residue
 * ADR-0009 already prices in; the cleanup policy is a server-side job and needs
 * its own ADR (proposed in SYNC.md).
 */

export type LinkOutcome =
  | { readonly kind: 'linked-in-place'; readonly uid: string }
  | {
      readonly kind: 'merged-into-existing';
      readonly fromUid: string;
      readonly toUid: string;
      readonly report: ImportReport;
    };

export type LinkStage = 'export' | 'link' | 'sign-in' | 'import';

/** A linking failure, always with the honest answer to "is my data safe". */
export class LinkError extends Error {
  readonly stage: LinkStage;
  /** True in every reachable case; the flow is ordered so this cannot be false. */
  readonly dataIntact: boolean;
  override readonly cause: unknown;

  constructor(stage: LinkStage, cause: unknown) {
    super(`account linking failed during ${stage}`);
    this.name = 'LinkError';
    this.stage = stage;
    this.dataIntact = true;
    this.cause = cause;
  }
}

export interface LinkDeps {
  readonly auth: Auth;
  readonly firestore: Firestore;
  /** Device-local journal; must survive a crash. */
  readonly journal: KeyValueStore;
  /**
   * OAuth credentials are often single-use: when the link attempt consumed the
   * one passed in, this recovers a fresh credential from the link error (e.g.
   * `GoogleAuthProvider.credentialFromError`). Email/password and email-link
   * credentials are reusable and need no resolver.
   */
  readonly resolveSignInCredential?: (linkError: unknown) => AuthCredential | null;
}

const JOURNAL_STATE = 'link.state';
const JOURNAL_BACKUP = 'link.backup';

interface JournalState {
  readonly phase: 'exported' | 'switched';
  readonly fromUid: string;
  readonly toUid?: string;
}

const CREDENTIAL_IN_USE_CODES = new Set([
  'auth/credential-already-in-use',
  'auth/email-already-in-use',
  'auth/account-exists-with-different-credential',
]);

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

export async function linkAnonymousAccount(
  deps: LinkDeps,
  credential: AuthCredential,
): Promise<LinkOutcome> {
  const user = deps.auth.currentUser;
  if (user === null) throw new LinkError('link', new Error('no signed-in user to link'));

  // Step 1: the backup, before anything can go wrong. `auto` prefers the server
  // copy (linking requires being online anyway) and falls back to cache.
  let backup: UserDataExport;
  try {
    backup = await exportUserData(deps.firestore, user.uid as UserId, { source: 'auto' });
    await deps.journal.set(JOURNAL_BACKUP, JSON.stringify(backup));
    await deps.journal.set(
      JOURNAL_STATE,
      JSON.stringify({ phase: 'exported', fromUid: user.uid } satisfies JournalState),
    );
  } catch (error) {
    throw new LinkError('export', error);
  }

  // Step 2a: try to upgrade in place. Same uid — no data moves at all.
  let linkError: unknown = null;
  try {
    const result = await linkWithCredential(user, credential);
    await clearJournal(deps.journal);
    await updateAuthMirror(deps.firestore, result.user);
    return { kind: 'linked-in-place', uid: result.user.uid };
  } catch (error) {
    linkError = error;
    if (!CREDENTIAL_IN_USE_CODES.has(errorCode(error))) {
      // Wrong password, popup closed, network — still anonymous, nothing changed.
      await clearJournal(deps.journal);
      throw new LinkError('link', error);
    }
  }

  // Step 2b: the credential already has an account. Switch to it.
  const signInCredential = deps.resolveSignInCredential?.(linkError) ?? credential;
  let target: User;
  try {
    const result = await signInWithCredential(deps.auth, signInCredential);
    target = result.user;
    await deps.journal.set(
      JOURNAL_STATE,
      JSON.stringify({
        phase: 'switched',
        fromUid: user.uid,
        toUid: target.uid,
      } satisfies JournalState),
    );
  } catch (error) {
    // Sign-in failed: the current user is still the anonymous one; clean up.
    await clearJournal(deps.journal);
    throw new LinkError('sign-in', error);
  }

  // Step 3: merge the backup into the target account.
  const report = await runImport(deps, target.uid as UserId, backup);
  await updateAuthMirror(deps.firestore, target);
  return { kind: 'merged-into-existing', fromUid: user.uid, toUid: target.uid, report };
}

/**
 * Call on every app start. Completes a merge that crashed between the account
 * switch and the end of the import. Safe to call when nothing is pending.
 */
export async function resumePendingLink(deps: LinkDeps): Promise<ImportReport | null> {
  const rawState = await deps.journal.get(JOURNAL_STATE);
  if (rawState === null) return null;
  let state: JournalState;
  try {
    state = JSON.parse(rawState) as JournalState;
  } catch {
    await clearJournal(deps.journal);
    return null;
  }

  if (state.phase === 'exported') {
    // Crashed before any auth change: the anonymous session is intact and the
    // journal is just leftovers.
    await clearJournal(deps.journal);
    return null;
  }

  // phase === 'switched': the import may be partial. Re-run it — idempotent.
  const user = deps.auth.currentUser;
  if (user === null || user.uid !== state.toUid) {
    // Signed out or signed into something else since; leave the journal for a
    // session that can act on it.
    return null;
  }
  const rawBackup = await deps.journal.get(JOURNAL_BACKUP);
  if (rawBackup === null) {
    await clearJournal(deps.journal);
    return null;
  }
  const backup = JSON.parse(rawBackup) as UserDataExport;
  const report = await runImport(deps, user.uid as UserId, backup);
  await updateAuthMirror(deps.firestore, user);
  return report;
}

async function runImport(
  deps: LinkDeps,
  toUid: UserId,
  backup: UserDataExport,
): Promise<ImportReport> {
  const ctx: WriteContext = { firestore: deps.firestore, uid: toUid };
  try {
    const report = await importUserData(ctx, backup);
    if (report.failures.length > 0) {
      // Partial: keep the journal so the next launch retries the failures.
      // Everything that did land is server-acknowledged and safe.
      throw new LinkError('import', new Error(`${report.failures.length} documents not imported`));
    }
    await clearJournal(deps.journal);
    return report;
  } catch (error) {
    if (error instanceof LinkError) throw error;
    throw new LinkError('import', error);
  }
}

/**
 * Reflects the auth state onto the profile's informational mirror. Best-effort:
 * no profile in cache means onboarding has not created one yet, and the mirror
 * will be right when it is created.
 */
async function updateAuthMirror(firestore: Firestore, user: User): Promise<void> {
  try {
    const snapshot = await getDocFromCache(doc(firestore, paths.profile(user.uid as UserId)));
    if (!snapshot.exists()) return;
    const parsed = profileSchema.safeParse(snapshot.data({ serverTimestamps: 'estimate' }));
    if (!parsed.success) return;
    const { sv: _sv, uid: _uid, createdAt: _c, updatedAt: _u, ...body } = parsed.data;
    const providers = user.providerData
      .map((info) => info.providerId)
      .filter(
        (id): id is 'password' | 'google.com' | 'apple.com' | 'emailLink' =>
          id === 'password' || id === 'google.com' || id === 'apple.com' || id === 'emailLink',
      );
    await saveProfile(
      { firestore, uid: user.uid as UserId },
      { ...body, auth: { isAnonymous: user.isAnonymous, linkedProviders: providers } },
    );
  } catch {
    // The mirror is informational (no rule reads it); never fail a link over it.
  }
}

async function clearJournal(journal: KeyValueStore): Promise<void> {
  await journal.delete(JOURNAL_STATE);
  await journal.delete(JOURNAL_BACKUP);
}
