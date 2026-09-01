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

/** A flipbook is the honest way to show change over time. */
const FRAME_MS = 450;

/**
 * The reel: every photo of one pose, in date order, played as a flipbook.
 *
 * This is what progress photos are actually for. A grid of tiles is a folder;
 * change over months only becomes visible when the frames sit in the same place
 * and advance. It is also why this is a reel rather than the before/after
 * composite the original notes ruled out — a composite is a thing you post,
 * and this is a thing you watch. No compositing, no export, no share.
 *
 * **Filtered to one pose, because a reel that mixes poses is noise.** Front and
 * side frames interleaved do not read as change, they read as a slideshow.
 *
 * Object URLs are cached per photo and revoked on unmount. Without that, playing
 * a sixty-frame reel twice leaks sixty blobs the tab keeps until it closes.
 */
function Reel({ photos, onDeleted }: { readonly photos: readonly ProgressPhotoRef[]; readonly onDeleted: () => void }) {
  const store = usePhotoStore();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const cache = useRef<Record<string, string>>({});

  const clamped = Math.min(index, photos.length - 1);
  const current = photos[clamped];

  // Load the current frame and its neighbours, so scrubbing and playback do not
  // flash an empty tile at every step.
  useEffect(() => {
    let live = true;
    const wanted = [clamped - 1, clamped, clamped + 1]
      .map((i) => photos[i])
      .filter((p): p is ProgressPhotoRef => p !== undefined && p.bytesLocation !== 'absent');
    void Promise.all(
      wanted.map(async (p) => {
        if (cache.current[p.id] !== undefined) return;
        const url = await store.openLocal(p.id);
        if (url !== null) cache.current[p.id] = url;
      }),
    ).then(() => {
      if (live) setUrls({ ...cache.current });
    });
    return () => {
      live = false;
    };
  }, [store, photos, clamped]);

  // Revoke every object URL this component created, once, on unmount.
  const cacheRef = cache;
  useEffect(
    () => () => {
      for (const url of Object.values(cacheRef.current)) URL.revokeObjectURL(url);
      cacheRef.current = {};
    },
    [cacheRef],
  );

  useEffect(() => {
    if (!playing || photos.length < 2) return undefined;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1 >= photos.length ? 0 : i + 1));
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, photos.length]);

  if (current === undefined) return null;
  const url = urls[current.id];

  const remove = store.remove;
  const onDelete = async (): Promise<void> => {
    if (remove === undefined) return;
    setPlaying(false);
    await remove(current.id);
    setIndex((i) => Math.max(0, i - 1));
    onDeleted();
  };

  return (
    <div className="ff-in-reel">
      <div className="ff-in-reel__stage">
        {url === undefined ? (
          <span className="ff-in-reel__pending">
            {current.bytesLocation === 'absent' ? 'Not on this device' : 'Loading'}
          </span>
        ) : (
          <img
            src={url}
            alt={`${POSE_LABELS[current.pose]}, ${formatDateShort(current.localDate)} — frame ${clamped + 1} of ${photos.length}`}
          />
        )}
      </div>

      <div className="ff-in-reel__bar">
        <button
          type="button"
          className="ff-control ff-focusable ff-in-reel__play"
          onClick={() => setPlaying((p) => !p)}
          disabled={photos.length < 2}
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        <label className="ff-in-reel__scrub">
          <span className="ff-in-reel__sronly">Frame</span>
          <input
            type="range"
            min={0}
            max={photos.length - 1}
            value={clamped}
            disabled={photos.length < 2}
            onChange={(event) => {
              setPlaying(false);
              setIndex(Number(event.target.value));
            }}
          />
        </label>

        <span className="ff-in-reel__date">{formatDateShort(current.localDate)}</span>

        {remove !== undefined && (
          <button
            type="button"
            className="ff-control ff-focusable ff-in-reel__delete"
            onClick={() => void onDelete()}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function PhotoGallery() {
  const store = usePhotoStore();
  const [photos, setPhotos] = useState<readonly ProgressPhotoRef[]>(() => store.list());
  const [pose, setPose] = useState<PhotoPose>('front_relaxed');

  useEffect(() => {
    setPhotos(store.list());
    return store.subscribe(() => setPhotos(store.list()));
  }, [store]);

  const refresh = (): void => setPhotos(store.list());

  // Date order, and one pose at a time. `localDate` is ISO so it sorts as text.
  const reel = photos
    .filter((p) => p.pose === pose)
    .slice()
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  const posesPresent = [...new Set(photos.map((p) => p.pose))];

  return (
    <>
      <AddPhoto onAdded={refresh} />
      {photos.length === 0 ? (
        <EmptyState
          title="No photos"
          body="Progress photos stay on this device unless you choose otherwise. Nothing here is uploaded."
        />
      ) : (
        <>
          {posesPresent.length > 1 && (
            <div className="ff-in-reel__poses" role="group" aria-label="Pose">
              {posesPresent.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="ff-control ff-focusable ff-in-reel__pose"
                  aria-pressed={p === pose}
                  onClick={() => setPose(p)}
                >
                  {POSE_LABELS[p]}
                </button>
              ))}
            </div>
          )}
          {reel.length === 0 ? (
            <EmptyState title="No photos in this pose" body="Add one, or pick another pose above." />
          ) : (
            <Reel key={pose} photos={reel} onDeleted={refresh} />
          )}
        </>
      )}
    </>
  );
}
