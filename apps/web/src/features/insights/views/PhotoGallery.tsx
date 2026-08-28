import { useEffect, useState } from 'react';
import { EmptyState } from '@freeforever/design-system';
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
export function PhotoGallery() {
  const store = usePhotoStore();
  const [photos, setPhotos] = useState<readonly ProgressPhotoRef[]>(() => store.list());

  useEffect(() => {
    setPhotos(store.list());
    return store.subscribe(() => setPhotos(store.list()));
  }, [store]);

  if (photos.length === 0) {
    return (
      <EmptyState
        title="No photos"
        body="Progress photos stay on this device unless you choose otherwise. Nothing here is uploaded."
      />
    );
  }

  return (
    <ul className="ff-in-photos">
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} />
      ))}
    </ul>
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
