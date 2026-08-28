import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, Skeleton, TextField } from '@freeforever/design-system';
import type { MealSlot } from '@freeforever/core/src/nutrition/index.js';
import { PortionSheet } from '../components/PortionSheet.js';
import { UndoToast } from '../components/UndoToast.js';
import { snapshotFromCustomFood, snapshotFromIndexFood } from '../data/mapping.js';
import { useLogging } from '../data/useLogging.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { FoodSnapshot } from '../data/types.js';
import { normaliseBarcode, resolveBarcode, ScanConfirmer } from '../scan/barcode.js';
import {
  detectScannerKind,
  openCamera,
  startDecoding,
  stopStream,
  type CameraFailure,
  type DecoderHandle,
  type ScannerKind,
} from '../scan/scanner.js';

/**
 * Barcode scanning.
 *
 * The clearest single illustration of what this project is. MyFitnessPal
 * charges about $80 a year for this screen. It is a browser API decoding a
 * barcode and a lookup against a public-domain database that is already on the
 * device. There is no server involved and no marginal cost per scan.
 *
 * Every failure has somewhere to go:
 *
 *   no `BarcodeDetector`  → ZXing, lazily imported so only the browsers that
 *                           need it pay for the bytes
 *   permission refused    → the keypad, with the real reason and no nagging
 *   no camera at all      → the keypad, without mentioning permissions
 *   camera busy           → retry, because that one usually clears
 *   barcode not in index  → create the food, with the barcode already filled in
 *
 * The last one matters most. An unknown barcode is the moment a user is
 * standing in their kitchen holding the packet — the best possible moment to
 * capture that food, and the worst possible moment to show a dead end.
 */

const FAILURE_COPY: Record<CameraFailure, { title: string; body: string; retry: boolean }> = {
  permission_denied: {
    title: 'Camera access is off',
    body: 'Allow camera access for this site in your browser settings, or type the number under the barcode.',
    retry: true,
  },
  no_camera: {
    title: 'No camera on this device',
    body: 'Type the number printed under the barcode instead — it works just as well.',
    retry: false,
  },
  camera_in_use: {
    title: 'The camera is busy',
    body: 'Another app or tab is using it. Close that and try again, or type the number.',
    retry: true,
  },
  insecure_context: {
    title: 'Camera needs a secure connection',
    body: 'Browsers only allow camera access over HTTPS. Type the number under the barcode instead.',
    retry: false,
  },
  unsupported: {
    title: 'This browser cannot use the camera',
    body: 'Type the number printed under the barcode instead.',
    retry: false,
  },
  unknown: {
    title: 'The camera could not start',
    body: 'Try again, or type the number printed under the barcode.',
    retry: true,
  },
};

export function ScanScreen() {
  const navigate = useNavigate();
  const { state, catalogue, ensureBarcodeIndex, catalogueStatus } = useNutrition();
  const logging = useLogging();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<DecoderHandle | null>(null);
  const confirmerRef = useRef(new ScanConfirmer());

  const [kind, setKind] = useState<ScannerKind>('manual');
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [scanning, setScanning] = useState(false);
  /**
   * Held as a string, not a number.
   *
   * A numeric field parses "0009300003346" to 9300003346 and destroys the
   * leading zeros — which are significant: a GTIN-12 and the GTIN-13 that
   * differs only by a leading zero are distinct keys in the index. Storing the
   * digits as typed is the whole reason `normaliseBarcode` refuses to pad or
   * trim, and a numeric input here quietly undid that.
   */
  const [manual, setManual] = useState('');
  const [portionFor, setPortionFor] = useState<FoodSnapshot | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  /**
   * The barcode tables are fetched when this screen opens, and a lookup before
   * they arrive resolves to nothing — which the UI would then report as "not in
   * the catalogue" for a food that is in it. Worst on the path that needs the
   * keypad most: with no camera there is nothing to slow the user down, so they
   * can type a number and tap Look up inside the load window.
   */
  const [indexReady, setIndexReady] = useState(false);
  const [slot] = useState<MealSlot>('other');

  const teardown = useCallback(() => {
    decoderRef.current?.stop();
    decoderRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setScanning(false);
  }, []);

  /**
   * Resolve a confirmed barcode against the on-device index.
   *
   * Custom foods are checked first: a user who has already saved this packet
   * with their own corrections means their version, not the catalogue's.
   */
  const handleBarcode = useCallback(
    (barcode: string) => {
      const own = state.customFoods.find((food) => food.barcode === barcode);
      if (own) {
        teardown();
        setPortionFor(snapshotFromCustomFood(own, { imperial: state.preferences.massUnit === 'oz' }));
        return;
      }

      const resolved =
        catalogue === null
          ? null
          : resolveBarcode(barcode, (candidate) => catalogue.byBarcode(candidate));

      if (resolved === null) {
        teardown();
        setUnknownBarcode(barcode);
        return;
      }

      teardown();
      setPortionFor(
        snapshotFromIndexFood(resolved.match, { imperial: state.preferences.massUnit === 'oz' }),
      );
    },
    [catalogue, state.customFoods, state.preferences.massUnit, teardown],
  );

  const start = useCallback(async () => {
    setFailure(null);
    setUnknownBarcode(null);
    confirmerRef.current.reset();

    // The barcode tables are only fetched when the scanner opens — no user who
    // never scans downloads them.
    await ensureBarcodeIndex();
    setIndexReady(true);

    const detected = detectScannerKind();
    setKind(detected);
    if (detected === 'manual') {
      // Ask openCamera for the precise reason rather than assuming the browser
      // is unsupported. An insecure context and a device with no camera API
      // both land here and need different copy — telling someone on plain HTTP
      // that their browser cannot use a camera sends them nowhere useful.
      // Neither branch reaches getUserMedia, so this costs no permission prompt.
      const probe = await openCamera();
      if (probe.ok) stopStream(probe.stream);
      setFailure(probe.ok ? 'unknown' : probe.reason);
      return;
    }

    const camera = await openCamera();
    if (!camera.ok) {
      setFailure(camera.reason);
      return;
    }

    streamRef.current = camera.stream;
    const video = videoRef.current;
    if (!video) {
      stopStream(camera.stream);
      return;
    }
    video.srcObject = camera.stream;
    // `playsInline` and a muted autoplay are what stop iOS opening the stream
    // full-screen over the app.
    await video.play().catch(() => undefined);

    decoderRef.current = await startDecoding(video, (raw) => {
      const confirmed = confirmerRef.current.offer(raw);
      if (confirmed !== null) handleBarcode(confirmed);
    });
    setScanning(true);
  }, [ensureBarcodeIndex, handleBarcode]);

  useEffect(() => {
    void start();
    return teardown;
    // Start once on mount. Re-running on every `start` identity change would
    // restart the camera on unrelated state updates, which flickers the
    // indicator light and reads as the app watching you.
     
  }, []);

  const manualBarcode = useMemo(() => normaliseBarcode(manual), [manual]);

  const failureCopy = failure === null ? null : FAILURE_COPY[failure];

  return (
    <div className="ffn">
      <div className="ffn-scan">
        <h1 className="ffn-h1">Scan a barcode</h1>

        {failure === null ? (
          <>
            <div className="ffn-viewfinder">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live
                  camera preview has no audio track and nothing to caption. */}
              <video ref={videoRef} playsInline muted aria-label="Camera preview" />
              <div className="ffn-reticle" aria-hidden="true" />
            </div>
            <p className="ffn-scan-status">
              {scanning ? (
                <>
                  <Badge tone="success">
                    {kind === 'native' ? 'Ready' : 'Ready (compatibility decoder)'}
                  </Badge>
                  Hold the barcode inside the frame.
                </>
              ) : catalogueStatus === 'loading' ? (
                <Skeleton width="60%" />
              ) : (
                'Starting the camera…'
              )}
            </p>
          </>
        ) : (
          failureCopy && (
            <EmptyState
              title={failureCopy.title}
              body={failureCopy.body}
              action={
                failureCopy.retry ? (
                  <Button variant="secondary" size="lg" onClick={() => void start()}>
                    Try again
                  </Button>
                ) : undefined
              }
            />
          )
        )}

        {unknownBarcode !== null ? (
          <EmptyState
            title="That barcode is not in the catalogue yet"
            body={`${unknownBarcode} — add it once and it is yours forever. It only takes what is on the label.`}
            action={
              <Button
                variant="primary"
                size="xl"
                onClick={() => navigate(`../custom?barcode=${unknownBarcode}`)}
              >
                Add this food
              </Button>
            }
          />
        ) : null}

        <section aria-label="Enter a barcode by hand">
          <h2 className="ffn-h2">Or type the number</h2>
          <p className="ffn-muted">
            The digits printed under the bars. Works with no camera and no permission.
          </p>
          <div className="ffn-row" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
            <div className="ffn-grow">
              <TextField
                label="Barcode"
                labelHidden
                value={manual}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0000000000000"
                onChange={(event) => setManual(event.currentTarget.value.replace(/\D/gu, ''))}
              />
            </div>
            <Button
              variant="secondary"
              size="xl"
              disabled={manualBarcode === null || !indexReady}
              onClick={() => {
                if (manualBarcode !== null && indexReady) handleBarcode(manualBarcode);
              }}
            >
              {indexReady ? 'Look up' : 'Loading catalogue'}
            </Button>
          </div>
        </section>
      </div>

      <PortionSheet
        open={portionFor !== null}
        onClose={() => {
          setPortionFor(null);
          void start();
        }}
        snapshot={portionFor}
        initialSlot={slot}
        massUnit={state.preferences.massUnit}
        energyUnit={state.preferences.energyUnit}
        isFavourite={portionFor !== null && state.favourites.includes(portionFor.key)}
        onToggleFavourite={() => {
          if (portionFor) logging.favourite(portionFor.key);
        }}
        onLog={({ quantity, serving, slot: chosen }) => {
          if (!portionFor) return;
          logging.log({ snapshot: portionFor, quantity, serving, slot: chosen });
          setPortionFor(null);
          navigate('..');
        }}
      />

      <UndoToast action={logging.undoAction} onDismiss={logging.dismissUndo} />
    </div>
  );
}
