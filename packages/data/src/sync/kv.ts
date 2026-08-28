/**
 * A minimal device-local key-value store.
 *
 * The sync engine keeps two things outside Firestore's own cache: per-collection
 * delta cursors, and the account-linking journal. Both are device-local by
 * nature — a cursor describes what *this* device has folded, and the linking
 * journal must survive a crash on *this* device — so they do not belong in a
 * synced document, and the rules deliberately have no collection for them.
 *
 * The interface is asynchronous so an IndexedDB-backed implementation can slot
 * in later without an API change; the two implementations here cover the browser
 * (Web Storage) and tests (memory).
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

/** Web Storage adapter. `prefix` namespaces keys per uid so accounts don't bleed. */
export function webStorageKeyValueStore(storage: Storage, prefix: string): KeyValueStore {
  const namespaced = (key: string): string => `${prefix}:${key}`;
  return {
    get(key) {
      try {
        return Promise.resolve(storage.getItem(namespaced(key)));
      } catch {
        return Promise.resolve(null);
      }
    },
    set(key, value) {
      try {
        storage.setItem(namespaced(key), value);
      } catch {
        // Quota or privacy mode. Losing a cursor costs re-delivery, never data.
      }
      return Promise.resolve();
    },
    delete(key) {
      try {
        storage.removeItem(namespaced(key));
      } catch {
        // Same as above.
      }
      return Promise.resolve();
    },
  };
}

/** The default store: Web Storage when available, otherwise memory. */
export function defaultKeyValueStore(prefix: string): KeyValueStore {
  const candidate = (globalThis as { localStorage?: Storage }).localStorage;
  if (candidate !== undefined) {
    try {
      const probe = `${prefix}:__probe__`;
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      return webStorageKeyValueStore(candidate, prefix);
    } catch {
      // Storage exists but is unusable (private mode, disabled cookies).
    }
  }
  return new MemoryKeyValueStore();
}
