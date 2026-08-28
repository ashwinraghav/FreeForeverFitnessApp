/**
 * Client-generated identifiers.
 *
 * Ids are made on the device, never by a server: a user must be able to log a
 * meal with no network, which means the id has to exist before any write leaves
 * the device (`packages/data/src/common/ids.ts`).
 *
 * URL-safe and bounded to match `ID_PATTERN` in the domain package, and
 * time-ordered at the front so a list of ids sorts roughly chronologically —
 * useful when debugging a log, and harmless otherwise.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Node without webcrypto, or a very old browser. Collision risk here is
    // irrelevant: ids are scoped to one user's own documents.
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function newId(now: number = Date.now()): string {
  return `${now.toString(36)}${randomSuffix(8)}`;
}

/** A batch of ids, for commands that add several entries at once. */
export function newIds(count: number, now: number = Date.now()): string[] {
  return Array.from({ length: count }, () => newId(now));
}
