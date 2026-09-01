import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@freeforever/design-system';
import type { PhotoPose } from '@freeforever/data';
import type { ProgressPhotoRef } from '../data/ports';
import { usePhotoStore } from '../data/context';
import { formatDateShort } from '../select/format';

/**
 * Progress photos.
 *
 * Three rules, and the component is mostly the rules:
 *
 * 1. **Device-local by default.** Nothing here uploads. There is no upload call, no
 *    signed URL, no background sync, and no "back these up?" prompt on a screen the
 *    user opened to look at a chart. Opting a photo into the cloud is an explicit,
 *    separate action that lives outside this feature, and it stays that way.
 * 2. **Bytes may simply not be there.** ADR-0024 leaves a `photos`-scoped coach
 *    holding metadata and no image, and a user on a second device is in the same
 *    position. So an absent photo is a normal, designed state — a labelled tile —
 *    not an error, and never a broken-image icon.
 * 3. **No comparison slider, no before/after composite, no share button.** This is a
 *    body-image-adjacent product with no public feed (ADR-0017); the affordances that
 *    turn a private log into a post do not get built here.
 */
const POSE_LABELS: Readonly<Record<PhotoPose, string>> = {
  front_relaxed: 'Front',
  side_relaxed: 'Side',
  back_relaxed: 'Back',
  front_flexed: 'Front, flexed',
  other: 'Other',
};

/**
 * Capture, shown only when the store can actually accept a photo.
 *
 * A plain file input with `capture`: the camera on a phone, the picker on a
 * desktop, and no getUserMedia stream to manage, no permission prompt on a
 * screen the user opened to read a chart, and no preview surface to get wrong.
 */
function AddPhoto({ onAdded }: { readonly onAdded: () => void }) {
  const store = usePhotoStore();
  const input = useRef<HTMLInputElement>(null);
  const [pose, setPose] = useState<PhotoPose>('front_relaxed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = store.add;
  if (add === undefined) return null;

  const onFile = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const today = new Date();
      const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await add(file, pose, localDate as Parameters<typeof add>[2]);
      onAdded();
    } catch {
      // Storage can be full or blocked outright. Say so rather than appearing
      // to succeed — a photo the user believes is saved and is not is worse
      // than a refusal.
      setError('Could not save that photo on this device.');
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  };

  return (
    <div className="ff-in-addphoto">
      <label className="ff-in-addphoto__pose">
        <span className="ff-in-addphoto__poselabel">Pose</span>
        <select
          className="ff-control ff-focusable"
          value={pose}
          onChange={(event) => setPose(event.target.value as PhotoPose)}
        >
          {Object.entries(POSE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ff-control ff-focusable ff-in-addphoto__button"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Saving…' : 'Add photo'}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void onFile(file);
        }}
      />
      {error !== null && (
        <p className="ff-in-addphoto__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PhotoGallery() {
  const store = usePhotoStore();
  const [photos, setPhotos] = useState<readonly ProgressPhotoRef[]>(() => store.list());

  useEffect(() => {
    setPhotos(store.list());
    return store.subscribe(() => setPhotos(store.list()));
  }, [store]);

  const refresh = (): void => setPhotos(store.list());

  return (
    <>
      <AddPhoto onAdded={refresh} />
      {photos.length === 0 ? (
        <EmptyState
          title="No photos"
          body="Progress photos stay on this device unless you choose otherwise. Nothing here is uploaded."
        />
      ) : (
        <ul className="ff-in-photos">
          {photos.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} />
          ))}
        </ul>
      )}
    </>
  );
}

function PhotoTile({ photo }: { readonly photo: ProgressPhotoRef }) {
  const store = usePhotoStore();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (photo.bytesLocation === 'absent') return;
    let live = true;
    let created: string | null = null;
    void store.openLocal(photo.id).then((next) => {
      if (!live) {
        if (next !== null) URL.revokeObjectURL(next);
        return;
      }
      created = next;
      setUrl(next);
    });
    return () => {
      live = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [store, photo.id, photo.bytesLocation]);

  return (
    <li className="ff-in-photo">
      {url === null ? (
        <span className="ff-in-photo__absent">
          {photo.bytesLocation === 'absent' ? 'Not on this device' : 'Loading'}
        </span>
      ) : (
        <img src={url} alt={`Progress photo, ${photo.pose.replace('_', ' ')}, ${formatDateShort(photo.localDate)}`} />
      )}
      <span className="ff-in-photo__meta">{formatDateShort(photo.localDate)}</span>
    </li>
  );
}
