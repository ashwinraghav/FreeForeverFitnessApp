import { FOOD_BARCODE_FORMATS } from './barcode.js';

/**
 * Camera and decoder plumbing for the barcode scanner.
 *
 * The feature this replaces is the clearest example of what this project is
 * for: MyFitnessPal charges roughly $80 a year for barcode scanning, and the
 * whole of it is a browser API reading a public-domain database. There is no
 * server here and no per-scan cost — the decode happens on the device and the
 * lookup happens against bytes already downloaded.
 *
 * Degradation ladder, in order. Every rung works; none of them dead-ends:
 *
 *   1. `BarcodeDetector` — native, hardware-accelerated, no bytes to download.
 *   2. `@zxing/browser` — lazily imported, only when rung 1 is missing, so
 *      Chrome and Android users never pay for it.
 *   3. Manual keypad entry — no camera, no permission, no decoder, no cost.
 *      This is the zero-cost path ADR-0001 rule 1 requires, and it is a real
 *      path rather than an error screen: the numbers under the bars are
 *      printed on the packet for exactly this reason.
 *
 * And when a barcode resolves to nothing, the answer is a pre-filled custom
 * food carrying that barcode — not "not found". A user standing in a kitchen
 * with the packet in their hand is the best possible source for that record.
 */

export type ScannerKind = 'native' | 'zxing' | 'manual';

export type CameraFailure =
  | 'insecure_context'
  | 'unsupported'
  | 'permission_denied'
  | 'no_camera'
  | 'camera_in_use'
  | 'unknown';

/** Minimal shape of the Barcode Detection API. Not in the TypeScript DOM lib. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeDetectorConstructor(): BarcodeDetectorConstructor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Which decoder this device can use.
 *
 * `manual` is not a failure state. It is what a desktop browser with no camera
 * gets, and it is a perfectly good way to log a packet.
 */
export function detectScannerKind(): ScannerKind {
  if (!canUseCamera()) return 'manual';
  return nativeDetectorConstructor() !== null ? 'native' : 'zxing';
}

/** Whether asking for a camera could possibly succeed. Cheap, synchronous. */
export function canUseCamera(): boolean {
  if (typeof window === 'undefined') return false;
  // getUserMedia is unavailable outside a secure context, and the resulting
  // error is opaque, so check first and give the real reason.
  if (window.isSecureContext !== true) return false;
  return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined;
}

/**
 * Map a `getUserMedia` rejection onto something the UI can act on.
 *
 * Pure, so every branch is testable without a camera. The distinctions matter:
 * "you denied permission" needs a settings link, "no camera" needs the keypad,
 * and "camera in use" needs a retry — telling a user with no webcam to check
 * their permissions sends them somewhere with nothing to fix.
 */
export function classifyCameraError(error: unknown): CameraFailure {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotReadableError':
    case 'AbortError':
      return 'camera_in_use';
    default:
      return 'unknown';
  }
}

export type CameraResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: CameraFailure };

/**
 * Ask for the rear camera.
 *
 * `facingMode: 'environment'` is a preference, not a constraint, so a laptop
 * with only a front camera still gets one rather than an OverconstrainedError.
 */
export async function openCamera(): Promise<CameraResult> {
  if (typeof window !== 'undefined' && window.isSecureContext !== true) {
    return { ok: false, reason: 'insecure_context' };
  }
  if (!canUseCamera()) return { ok: false, reason: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
    return { ok: true, stream };
  } catch (error) {
    return { ok: false, reason: classifyCameraError(error) };
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export interface DecoderHandle {
  kind: 'native' | 'zxing';
  stop: () => void;
}

/**
 * How often the native detector samples the video.
 *
 * Not every frame: detection is the expensive part and 60 Hz of it flattens a
 * phone battery for no gain, since a person cannot hold a packet steady faster
 * than this anyway.
 */
export const NATIVE_SAMPLE_INTERVAL_MS = 120;

/**
 * Start decoding from a `<video>` already playing a camera stream.
 *
 * Returns a handle whose `stop` is idempotent and must be called on unmount —
 * a detector left running holds the camera and the indicator light stays on,
 * which users reasonably read as the app spying on them.
 */
export async function startDecoding(
  video: HTMLVideoElement,
  onRead: (rawValue: string) => void,
): Promise<DecoderHandle> {
  const Native = nativeDetectorConstructor();
  if (Native !== null) return startNative(Native, video, onRead);
  return startZxing(video, onRead);
}

function startNative(
  Native: BarcodeDetectorConstructor,
  video: HTMLVideoElement,
  onRead: (rawValue: string) => void,
): DecoderHandle {
  const detector = new Native({ formats: [...FOOD_BARCODE_FORMATS] });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        for (const result of await detector.detect(video)) onRead(result.rawValue);
      }
    } catch {
      // A detect() failure on one frame is normal — the frame may be mid-decode
      // or the format unsupported. Dropping it and trying the next frame is the
      // correct response; surfacing it would flicker an error at the user
      // several times a second.
    }
    if (!stopped) timer = setTimeout(() => void tick(), NATIVE_SAMPLE_INTERVAL_MS);
  };

  void tick();

  return {
    kind: 'native',
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * The fallback, imported only when it is needed.
 *
 * A dynamic import so Chrome and Android — where `BarcodeDetector` exists —
 * never download the decoder. It is a meaningful share of a bundle, and making
 * every user pay for Safari's missing API is the kind of small, permanent cost
 * this project is supposed to refuse.
 */
async function startZxing(
  video: HTMLVideoElement,
  onRead: (rawValue: string) => void,
): Promise<DecoderHandle> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) onRead(result.getText());
  });
  let stopped = false;
  return {
    kind: 'zxing',
    stop: () => {
      if (stopped) return;
      stopped = true;
      controls.stop();
    },
  };
}
