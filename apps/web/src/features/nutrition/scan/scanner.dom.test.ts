import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canUseCamera,
  classifyCameraError,
  detectScannerKind,
  openCamera,
  stopStream,
} from './scanner.js';

/**
 * Scanner capability detection and degradation.
 *
 * A real camera is out of reach in jsdom and faking one would test the fake.
 * What *is* testable is the part that will actually fire for most users: which
 * decoder a device gets, how a `getUserMedia` rejection is classified, and that
 * every failure lands somewhere with an action rather than an apology.
 *
 * These paths matter more than the happy path. The happy path is a browser API
 * doing its job; the failure paths are where a scanner either degrades
 * gracefully or dead-ends a user standing in their kitchen.
 */

const originalDescriptors = {
  isSecureContext: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
};

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

function setBarcodeDetector(value: unknown): void {
  if (value === undefined) delete (globalThis as Record<string, unknown>).BarcodeDetector;
  else (globalThis as Record<string, unknown>).BarcodeDetector = value;
}

afterEach(() => {
  setBarcodeDetector(undefined);
  if (originalDescriptors.isSecureContext) {
    Object.defineProperty(window, 'isSecureContext', originalDescriptors.isSecureContext);
  }
  if (originalDescriptors.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalDescriptors.mediaDevices);
  }
  vi.restoreAllMocks();
});

describe('canUseCamera', () => {
  it('is false outside a secure context, because getUserMedia is unavailable there', () => {
    setSecureContext(false);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    expect(canUseCamera()).toBe(false);
  });

  it('is false when the browser exposes no mediaDevices at all', () => {
    setSecureContext(true);
    setMediaDevices(undefined);
    expect(canUseCamera()).toBe(false);
  });

  it('is true when a secure context and getUserMedia are both present', () => {
    setSecureContext(true);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    expect(canUseCamera()).toBe(true);
  });
});

describe('detectScannerKind — which rung of the ladder a device lands on', () => {
  it('picks the native detector when the browser has one', () => {
    setSecureContext(true);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    setBarcodeDetector(function BarcodeDetector() {});
    expect(detectScannerKind()).toBe('native');
  });

  it('falls back to the lazily-imported decoder when BarcodeDetector is absent', () => {
    // Safari and older Firefox. They get ZXing, and only they download it.
    setSecureContext(true);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    setBarcodeDetector(undefined);
    expect(detectScannerKind()).toBe('zxing');
  });

  it('falls all the way back to manual entry when there is no camera to use', () => {
    setSecureContext(true);
    setMediaDevices(undefined);
    setBarcodeDetector(function BarcodeDetector() {});
    // Not a failure state — a desktop browser with no camera gets the keypad,
    // which is a perfectly good way to log a packet.
    expect(detectScannerKind()).toBe('manual');
  });

  it('ignores a BarcodeDetector that is not constructible', () => {
    setSecureContext(true);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    setBarcodeDetector({ notAConstructor: true });
    expect(detectScannerKind()).toBe('zxing');
  });
});

describe('classifyCameraError — the distinctions decide what the user is told', () => {
  it('separates a refusal from a missing camera', () => {
    // Telling someone with no webcam to check their permissions sends them
    // somewhere with nothing to fix.
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('permission_denied');
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('no_camera');
  });

  it('treats a security error as a refusal, because that is what it means to the user', () => {
    expect(classifyCameraError({ name: 'SecurityError' })).toBe('permission_denied');
  });

  it('recognises a camera held by something else, which is worth retrying', () => {
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('camera_in_use');
    expect(classifyCameraError({ name: 'AbortError' })).toBe('camera_in_use');
  });

  it('treats over-constrained as no usable camera', () => {
    expect(classifyCameraError({ name: 'OverconstrainedError' })).toBe('no_camera');
  });

  it('does not throw on junk it has never seen', () => {
    for (const junk of [null, undefined, 'a string', 0, {}, new Error('boom')]) {
      expect(classifyCameraError(junk)).toBe('unknown');
    }
  });
});

describe('openCamera', () => {
  it('reports an insecure context specifically, rather than an opaque failure', async () => {
    setSecureContext(false);
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    // Checked before calling getUserMedia, because the error it throws there is
    // opaque and the user needs the real reason.
    await expect(openCamera()).resolves.toEqual({ ok: false, reason: 'insecure_context' });
  });

  it('reports an unsupported browser rather than crashing on a missing API', async () => {
    setSecureContext(true);
    setMediaDevices(undefined);
    await expect(openCamera()).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('converts a rejection into a reason the UI can act on', async () => {
    setSecureContext(true);
    setMediaDevices({
      getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
    });
    await expect(openCamera()).resolves.toEqual({ ok: false, reason: 'permission_denied' });
  });

  it('asks for the rear camera as a preference, not a hard constraint', async () => {
    // `{ ideal: 'environment' }`, not `{ exact: … }` — a laptop with only a
    // front camera must still get one rather than an OverconstrainedError.
    setSecureContext(true);
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
    setMediaDevices({ getUserMedia });

    await openCamera();

    const constraints = getUserMedia.mock.calls[0]?.[0] as { video: { facingMode: unknown } };
    expect(constraints.video.facingMode).toEqual({ ideal: 'environment' });
    expect(JSON.stringify(constraints)).not.toContain('exact');
  });

  it('returns the stream on success', async () => {
    setSecureContext(true);
    const stream = { getTracks: () => [] };
    setMediaDevices({ getUserMedia: () => Promise.resolve(stream) });
    await expect(openCamera()).resolves.toEqual({ ok: true, stream });
  });
});

describe('stopStream', () => {
  it('stops every track, so the camera indicator light goes out', () => {
    // A detector left running holds the camera and the light stays on, which
    // users reasonably read as the app spying on them.
    const stop = vi.fn();
    stopStream({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('tolerates being called with nothing, so teardown is always safe', () => {
    expect(() => stopStream(null)).not.toThrow();
  });
});
