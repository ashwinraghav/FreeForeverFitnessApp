import type { LocalDate } from '@freeforever/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevicePhotoStore } from '../photoStore';

/**
 * What is worth testing here is the half that runs without IndexedDB.
 *
 * The canvas re-encode and the blob round trip need a real browser and were
 * verified there (a 3024x4032 source came back 1080x1440 and rendered as an
 * <img>). What jsdom CAN exercise is the metadata layer and, more importantly,
 * the missing-bytes path — a photo whose pixels are not on this device is a
 * designed state under ADR-0024, not an error, and it is the state a second
 * device is permanently in.
 *
 * jsdom provides no `indexedDB`, so `openDb` resolves null and every blob read
 * misses. That is exactly the condition being tested, so the absence is the
 * fixture rather than a gap.
 */

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
}

const REF = {
  id: 'p1',
  localDate: '2026-08-01',
  pose: 'front_relaxed',
  widthPx: 1080,
  heightPx: 1440,
  bytesLocation: 'device',
};

beforeEach(() => {
  // Make the absence explicit rather than relying on the environment.
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
});

describe('the device photo store', () => {
  it('reads its list synchronously, because the gallery renders from it', () => {
    const store = createDevicePhotoStore(fakeStorage({ 'ff.photos.v1': JSON.stringify([REF]) }));
    // Not a promise. `list()` is called on every subscribe and every render.
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.id).toBe('p1');
  });

  it('survives metadata that will not parse instead of losing the feature', () => {
    const store = createDevicePhotoStore(fakeStorage({ 'ff.photos.v1': '{not json' }));
    expect(store.list()).toEqual([]);
  });

  it('marks a photo absent when its bytes are gone, and says so once', async () => {
    const storage = fakeStorage({ 'ff.photos.v1': JSON.stringify([REF]) });
    const store = createDevicePhotoStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    const url = await store.openLocal('p1');

    // Null, not a broken object URL — the tile shows a label, never a broken image.
    expect(url).toBeNull();
    expect(store.list()[0]?.bytesLocation).toBe('absent');
    // Persisted, so the next render does not retry and flash "Loading" forever.
    expect(storage.getItem('ff.photos.v1')).toContain('absent');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not re-announce a photo already known to be absent', async () => {
    const absent = { ...REF, bytesLocation: 'absent' };
    const store = createDevicePhotoStore(fakeStorage({ 'ff.photos.v1': JSON.stringify([absent]) }));
    const listener = vi.fn();
    store.subscribe(listener);
    await store.openLocal('p1');
    // Nothing changed, so nothing should re-render.
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying once unsubscribed', async () => {
    const store = createDevicePhotoStore(fakeStorage({ 'ff.photos.v1': JSON.stringify([REF]) }));
    const listener = vi.fn();
    store.subscribe(listener)();
    await store.openLocal('p1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('refuses to claim a photo was saved when storage is unavailable', async () => {
    const store = createDevicePhotoStore(fakeStorage());
    // With no IndexedDB the blob cannot be written, and a photo the user
    // believes is saved and is not is worse than a visible refusal.
    await expect(
      store.add(new Blob(['x'], { type: 'image/jpeg' }), 'front_relaxed', '2026-09-01' as LocalDate),
    ).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});
