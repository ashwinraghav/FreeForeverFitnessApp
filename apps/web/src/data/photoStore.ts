import type { LocalDate } from '@freeforever/data';
import type { PhotoPose } from '@freeforever/data';
import type { ProgressPhotoRef, ProgressPhotoStore } from '../features/insights/data/ports';

/**
 * Progress photos, on the device.
 *
 * The port has existed since the insights work and nothing ever implemented it,
 * so the gallery rendered an empty state forever. This is that implementation.
 *
 * **Metadata and pixels are stored separately, which the port already assumed.**
 * `list()` is synchronous, so metadata has to be somewhere synchronous —
 * localStorage. Pixels cannot go there: it is a ~5 MB string-quota store and one
 * phone photo would fill it. So blobs live in IndexedDB, keyed by photo id, and
 * a missing blob is a normal state (`bytesLocation: 'absent'`) rather than an
 * error — exactly the case ADR-0024 describes for a second device.
 *
 * **Re-encoded through a canvas on the way in, deliberately.** Two reasons, and
 * the second is the important one:
 *
 * 1. A modern phone photo is 3–12 MB. A weekly photo for a year at that size is
 *    a quarter of a gigabyte for something that will only ever be looked at on a
 *    phone screen. Longest edge is capped and it is re-encoded as JPEG.
 * 2. **It strips EXIF, and EXIF on a body photo routinely carries GPS.** Nothing
 *    here uploads, but a device-local store is still the wrong place to keep the
 *    coordinates of the room someone photographs themselves in. Canvas re-encode
 *    drops every tag; orientation is applied first so the picture stays upright.
 */

const META_KEY = 'ff.photos.v1';
const DB_NAME = 'ff-photos';
const DB_STORE = 'blobs';
const MAX_EDGE_PX = 1440;
const JPEG_QUALITY = 0.82;

function readMeta(storage: Storage): ProgressPhotoRef[] {
  try {
    const raw = storage.getItem(META_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProgressPhotoRef[]) : [];
  } catch {
    return [];
  }
}

function writeMeta(storage: Storage, refs: readonly ProgressPhotoRef[]): void {
  try {
    storage.setItem(META_KEY, JSON.stringify(refs));
  } catch {
    // Quota or blocked storage. The caller already has the blob written; losing
    // the metadata is bad but throwing here would lose the photo too.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function putBlob(id: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (db === null) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(blob, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

async function getBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  if (db === null) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

async function deleteBlob(id: string): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export interface DownscaledImage {
  readonly blob: Blob;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Cap the longest edge, apply EXIF orientation, and drop every tag by re-encoding. */
export async function downscale(file: Blob, maxEdge = MAX_EDGE_PX): Promise<DownscaledImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const widthPx = Math.max(1, Math.round(bitmap.width * scale));
  const heightPx = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0, widthPx, heightPx);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });
  if (blob === null) throw new Error('encode failed');
  return { blob, widthPx, heightPx };
}

export interface DevicePhotoStore extends ProgressPhotoStore {
  add(file: Blob, pose: PhotoPose, localDate: LocalDate, weightKg?: number): Promise<ProgressPhotoRef>;
  remove(id: string): Promise<void>;
}

export function createDevicePhotoStore(storage: Storage = localStorage): DevicePhotoStore {
  let refs = readMeta(storage);
  const listeners = new Set<() => void>();
  const announce = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    list: () => refs,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async openLocal(id) {
      const blob = await getBlob(id);
      if (blob === null) {
        // Metadata without pixels. Record it so the tile says "not on this
        // device" rather than spinning forever.
        //
        // Checked BEFORE rebuilding the array, not after. A `map` that spreads
        // the matching record produces a new object even when the field it sets
        // is already correct, so an identity comparison afterwards is always
        // true — every failed read announced a change, and a gallery of absent
        // photos re-rendered on every one of them.
        const known = refs.find((r) => r.id === id);
        if (known !== undefined && known.bytesLocation !== 'absent') {
          refs = refs.map((r) => (r.id === id ? { ...r, bytesLocation: 'absent' as const } : r));
          writeMeta(storage, refs);
          announce();
        }
        return null;
      }
      return URL.createObjectURL(blob);
    },

    async add(file, pose, localDate, weightKg) {
      const { blob, widthPx, heightPx } = await downscale(file);
      const id = crypto.randomUUID();
      const stored = await putBlob(id, blob);
      if (!stored) throw new Error('could not save the photo on this device');
      const ref: ProgressPhotoRef = {
        id,
        localDate,
        pose,
        widthPx,
        heightPx,
        bytesLocation: 'device',
        ...(weightKg === undefined ? {} : { weightKg }),
      };
      // Newest last, matching how the gallery reads.
      refs = [...refs, ref].sort((a, b) => a.localDate.localeCompare(b.localDate));
      writeMeta(storage, refs);
      announce();
      return ref;
    },

    async remove(id) {
      await deleteBlob(id);
      refs = refs.filter((r) => r.id !== id);
      writeMeta(storage, refs);
      announce();
    },
  };
}
