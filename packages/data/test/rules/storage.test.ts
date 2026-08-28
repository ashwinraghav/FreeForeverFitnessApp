import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, listAll, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COACH,
  IMAGE_BYTES,
  OTHER,
  OWNER,
  STORAGE_RULES_SOURCE,
  anonymousContext,
  createStorageTestEnvironment,
  grantDoc,
  linkedContext,
  oversizedBytes,
  photoPath,
  progressPhotoDoc,
} from './harness.js';

/**
 * Cloud Storage rules — the bytes behind the progress-photo metadata.
 *
 * This is the most sensitive store in the product, and under ADR-0009 every
 * visitor holds a uid within seconds of opening the app, so `signed in` proves
 * nothing here. Every assertion below is made in both directions.
 *
 * Requires the Firestore AND Storage emulators, because a coach's read resolves a
 * grant document across services:
 *
 *   firebase emulators:exec --only firestore,storage "pnpm test:rules"
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createStorageTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
});

const IMAGE = { contentType: 'image/jpeg' } as const;

async function seedPhoto(uid = OWNER, fileName = 'p1.jpg'): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), photoPath(uid, fileName)), IMAGE_BYTES, IMAGE);
  });
}

async function seedGrant(overrides: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `coachGrants/${OWNER}__${COACH}`), {
      ...grantDoc(OWNER, COACH, { scopes: ['photos'] }),
      ...overrides,
    });
  });
}

const ownerStorage = () => linkedContext(env, OWNER).storage();
const coachStorage = () => linkedContext(env, COACH).storage();
const otherStorage = () => linkedContext(env, OTHER).storage();

describe('a user owns the bytes under their own prefix', () => {
  it('uploads, reads, lists, overwrites and deletes their own photo', async () => {
    const storage = ownerStorage();
    const object = ref(storage, photoPath(OWNER));

    await assertSucceeds(uploadBytes(object, IMAGE_BYTES, IMAGE));
    const bytes = await assertSucceeds(getBytes(object));
    expect(bytes.byteLength).toBe(IMAGE_BYTES.byteLength);
    await assertSucceeds(uploadBytes(object, IMAGE_BYTES, { contentType: 'image/webp' }));

    const listing = await assertSucceeds(listAll(ref(storage, `users/${OWNER}/photos`)));
    expect(listing.items.map((item) => item.name)).toEqual(['p1.jpg']);

    await assertSucceeds(deleteObject(object));
  });
});

describe('a second user is refused, in every direction', () => {
  beforeEach(async () => {
    await seedPhoto();
  });

  it('cannot read another user’s photo', async () => {
    await assertFails(getBytes(ref(otherStorage(), photoPath(OWNER))));
  });

  it('cannot list another user’s prefix', async () => {
    await assertFails(listAll(ref(otherStorage(), `users/${OWNER}/photos`)));
  });

  it('cannot upload into another user’s prefix', async () => {
    await assertFails(
      uploadBytes(ref(otherStorage(), photoPath(OWNER, 'intruder.jpg')), IMAGE_BYTES, IMAGE),
    );
  });

  it('cannot overwrite another user’s photo', async () => {
    await assertFails(uploadBytes(ref(otherStorage(), photoPath(OWNER)), IMAGE_BYTES, IMAGE));
  });

  it('cannot delete another user’s photo', async () => {
    await assertFails(deleteObject(ref(otherStorage(), photoPath(OWNER))));
  });

  it('is refused just the same when anonymous, which is what every visitor is', async () => {
    // The bug this file exists to close: on the console default ruleset,
    // `request.auth != null` is true for anyone who opened the app once.
    const storage = anonymousContext(env, OTHER).storage();
    await assertFails(getBytes(ref(storage, photoPath(OWNER))));
    await assertFails(listAll(ref(storage, `users/${OWNER}/photos`)));
    await assertFails(uploadBytes(ref(storage, photoPath(OWNER, 'x.jpg')), IMAGE_BYTES, IMAGE));
    await assertFails(deleteObject(ref(storage, photoPath(OWNER))));
  });

  it('is refused when unauthenticated', async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(storage, photoPath(OWNER))));
    await assertFails(uploadBytes(ref(storage, photoPath(OWNER, 'x.jpg')), IMAGE_BYTES, IMAGE));
  });
});

describe('an anonymous account has the same rights over its own bytes', () => {
  it('uploads, reads and deletes exactly as a linked account does', async () => {
    // ADR-0009 parity, asserted on Storage as well as Firestore. A photo taken
    // before linking must still be there afterwards.
    const anonymous = anonymousContext(env, OWNER).storage();
    await assertSucceeds(uploadBytes(ref(anonymous, photoPath(OWNER)), IMAGE_BYTES, IMAGE));
    await assertSucceeds(getBytes(ref(anonymous, photoPath(OWNER))));

    const linked = linkedContext(env, OWNER).storage();
    const bytes = await assertSucceeds(getBytes(ref(linked, photoPath(OWNER))));
    expect(bytes.byteLength).toBe(IMAGE_BYTES.byteLength);
    await assertSucceeds(deleteObject(ref(linked, photoPath(OWNER))));
  });

  it('and the rules never look at how you signed in', async () => {
    for (const forbidden of ['sign_in_provider', 'email_verified', 'provider_id', 'isAnonymous']) {
      expect(
        STORAGE_RULES_SOURCE.includes(forbidden),
        `storage.rules must not reference ${forbidden}`,
      ).toBe(false);
    }
  });
});

describe('uploads are validated, not trusted', () => {
  it('rejects an upload over the size ceiling', async () => {
    await assertFails(
      uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'huge.jpg')), oversizedBytes(), IMAGE),
    );
  });

  it('accepts one just under it', async () => {
    await assertSucceeds(
      uploadBytes(
        ref(ownerStorage(), photoPath(OWNER, 'big.jpg')),
        new Uint8Array(10 * 1024 * 1024 - 1),
        IMAGE,
      ),
    );
  });

  it('rejects an empty object', async () => {
    await assertFails(
      uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'empty.jpg')), new Uint8Array(0), IMAGE),
    );
  });

  it.each(['application/pdf', 'text/html', 'application/octet-stream', 'video/mp4'])(
    'rejects content type %s',
    async (contentType) => {
      await assertFails(
        uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'x.bin')), IMAGE_BYTES, { contentType }),
      );
    },
  );

  it('rejects image/svg+xml specifically', async () => {
    // An SVG is a document that can carry script. Served from the bucket's own
    // origin it is stored XSS, so it is excluded from the image allowlist even
    // though its content type starts with `image/`.
    await assertFails(
      uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'x.svg')), IMAGE_BYTES, {
        contentType: 'image/svg+xml',
      }),
    );
  });

  it('rejects a content type that merely contains an allowed one', async () => {
    for (const contentType of ['text/html+image/jpeg', 'image/jpeg-evil', 'ximage/jpeg']) {
      await assertFails(
        uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'x.jpg')), IMAGE_BYTES, { contentType }),
      );
    }
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])(
    'accepts content type %s',
    async (contentType) => {
      await assertSucceeds(
        uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'ok.img')), IMAGE_BYTES, { contentType }),
      );
    },
  );

  it('rejects an object name longer than the rules allow', async () => {
    await assertFails(
      uploadBytes(ref(ownerStorage(), photoPath(OWNER, `${'n'.repeat(129)}.jpg`)), IMAGE_BYTES, IMAGE),
    );
  });

  it('rejects custom metadata used as a payload', async () => {
    const metadata: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) metadata[`k${index}`] = 'v';
    await assertFails(
      uploadBytes(ref(ownerStorage(), photoPath(OWNER, 'meta.jpg')), IMAGE_BYTES, {
        contentType: 'image/jpeg',
        customMetadata: metadata,
      }),
    );
  });
});

describe('prefixes that are not declared', () => {
  it.each([
    `users/${OWNER}/exports/backup.zip`,
    `users/${OWNER}/avatar.jpg`,
    `users/${OWNER}/photos/nested/p1.jpg`,
    `public/${OWNER}.jpg`,
    'admin/keys.json',
  ])('deny %s, even to the owner', async (path) => {
    const storage = ownerStorage();
    await assertFails(uploadBytes(ref(storage, path), IMAGE_BYTES, IMAGE));
    await assertFails(getBytes(ref(storage, path)));
  });

  it('deny listing the bucket root', async () => {
    await assertFails(listAll(ref(ownerStorage(), '/')));
    await assertFails(listAll(ref(ownerStorage(), `users/${OWNER}`)));
  });
});

describe('coach access to the bytes is deferred to Phase 4', () => {
  // A `photos`-scoped coach can read a progress photo's METADATA through
  // firestore.rules, and cannot read the FILE. That asymmetry is deliberate and
  // temporary; storage.rules carries the full reasoning and the two blockers.
  //
  // These two tests are the honest record of the state we actually shipped. The
  // first fails the moment someone wires cross-service access without updating
  // that record; the second fails if the metadata half is quietly removed too.
  beforeEach(async () => {
    await seedPhoto();
    await seedGrant({ scopes: ['photos'] });
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `users/${OWNER}/progressPhotos/p1`),
        progressPhotoDoc(OWNER, 'p1'),
      );
    });
  });

  it('a photos-scoped coach is refused the file, and the owner is not', async () => {
    await assertFails(getBytes(ref(coachStorage(), photoPath(OWNER))));
    await assertFails(listAll(ref(coachStorage(), `users/${OWNER}/photos`)));
    await assertSucceeds(getBytes(ref(ownerStorage(), photoPath(OWNER))));
  });

  it('but does read the metadata, which is the asymmetry we are recording', async () => {
    const metadata = await assertSucceeds(
      getDoc(doc(linkedContext(env, COACH).firestore(), `users/${OWNER}/progressPhotos/p1`)),
    );
    expect(metadata.exists()).toBe(true);
  });
});

describe('the storage rules file itself', () => {
  it('ends in an explicit default deny', async () => {
    expect(STORAGE_RULES_SOURCE).toMatch(
      /match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/,
    );
  });

  it('contains no unconditional allow', async () => {
    expect(STORAGE_RULES_SOURCE).not.toMatch(/allow\s+[a-z, ]+:\s*if\s+true\s*;/);
  });

  it('guards every allow on ownership, a grant, or false', async () => {
    const allowLines = STORAGE_RULES_SOURCE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('allow '));
    expect(allowLines.length).toBeGreaterThan(0);
    for (const line of allowLines) {
      expect(/if (false|isOwner)/.test(line), `unguarded allow: ${line}`).toBe(true);
    }
  });

  it('has no catch-all under a user', async () => {
    expect(STORAGE_RULES_SOURCE).not.toMatch(/match \/users\/\{uid\}\/\{[a-zA-Z]+=\*\*\}/);
  });

  it('performs no cross-service lookup while coach access is deferred', async () => {
    // The deferral is only real if the rule genuinely does not consult Firestore.
    expect(STORAGE_RULES_SOURCE).not.toMatch(/^\s*[^/]*firestore\.(get|exists)\(/m);
  });
});
