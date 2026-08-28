import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NutritionRoutes from '../NutritionRoutes.js';

/**
 * The scanner's degradation ladder, end to end through the real screen.
 *
 * No camera is faked. Every case below is one a real user hits — a refused
 * permission, a laptop with no camera, a barcode the catalogue has never seen —
 * and the assertion in each is that there is somewhere to go next.
 *
 * The known-barcode case serves the *real* committed index artefacts through a
 * stubbed `fetch`, so the lookup being exercised is the actual on-device
 * decode, not a mock that agrees with me.
 */

/**
 * Resolved from the working directory, not from `import.meta.url`: under the
 * jsdom project Vite rewrites module URLs with a `/@fs` prefix, and a path
 * built from it silently misses every file. That failure is invisible — the
 * fetch stub returns 404, the index comes up empty, and the test "passes" by
 * asserting a food is absent when in truth nothing ever loaded.
 */
const BUILD = `${process.cwd()}/../../packages/datasets/build/`;

/**
 * Serves the real artefacts from disk, the way a server with content-encoding
 * already applied would.
 *
 * The bodies are decompressed here rather than served gzipped, because jsdom
 * defines `DecompressionStream` but its `Blob` has no `.stream()`, so the
 * reader's gunzip takes the streaming branch and throws. Serving plain bytes
 * uses a path the reader explicitly supports — it sniffs the gzip magic bytes
 * and passes anything else through — so this exercises the real decode rather
 * than working around it.
 */
function serveRealIndex(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const file = url.slice(url.lastIndexOf('/') + 1);
      let raw: Uint8Array;
      try {
        raw = new Uint8Array(readFileSync(`${BUILD}${file}`));
      } catch (error) {
        // Loud on purpose. A silent 404 leaves the index empty and makes the
        // "unknown barcode" assertions pass for entirely the wrong reason.
        throw new Error(`test fixture missing: ${file} (${String(error)})`);
      }
      const body = file.endsWith('.gz') ? new Uint8Array(gunzipSync(raw)) : raw;
      return new Response(body, { status: 200 });
    }),
  );
}

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

function renderScanner() {
  return render(
    <MemoryRouter initialEntries={['/scan']}>
      <NutritionRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no HTMLMediaElement.play; the screen calls it after attaching a
  // stream and must not blow up when it rejects.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('jsdom'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('when the camera is refused', () => {
  it('says so, offers a retry, and still shows the keypad', async () => {
    setSecureContext(true);
    setMediaDevices({
      getUserMedia: () =>
        Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
    });
    renderScanner();

    expect(await screen.findByText(/camera access is off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // The zero-cost path is always present, never gated behind the failure.
    expect(screen.getByRole('button', { name: /look up|loading catalogue/i })).toBeInTheDocument();
  });
});

describe('when there is no camera at all', () => {
  it('points at the keypad and does not mention permissions', async () => {
    setSecureContext(true);
    setMediaDevices({
      getUserMedia: () =>
        Promise.reject(Object.assign(new Error('no'), { name: 'NotFoundError' })),
    });
    renderScanner();

    const notice = await screen.findByText(/no camera on this device/i);
    // Sending someone with no webcam to a settings page is a dead end, so the
    // notice itself must not talk about permissions. (The keypad's own copy
    // does say "no permission needed", which is why this is scoped.)
    const body = notice.parentElement?.textContent ?? '';
    expect(body).not.toMatch(/permission/i);
    expect(body).toMatch(/type the number/i);
    expect(screen.getByRole('button', { name: /look up|loading catalogue/i })).toBeInTheDocument();
  });
});

describe('when the page is not on HTTPS', () => {
  it('explains why, rather than showing an opaque camera failure', async () => {
    setSecureContext(false);
    setMediaDevices({ getUserMedia: () => Promise.resolve({ getTracks: () => [] }) });
    renderScanner();

    expect(await screen.findByText(/secure connection/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /look up|loading catalogue/i })).toBeInTheDocument();
  });
});

describe('an unknown barcode', () => {
  it('leads into creating the food, with the barcode already filled in', async () => {
    serveRealIndex();
    setSecureContext(true);
    setMediaDevices({
      getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotFoundError' })),
    });
    const user = userEvent.setup();
    renderScanner();

    // Waiting for the name "Look up" IS the readiness wait: until the barcode
    // tables land the control reads "Loading catalogue". That is the fix for a
    // lookup racing the load and reporting a food as missing when it is not.
    const lookUp = await screen.findByRole('button', { name: /^look up$/i }, { timeout: 5000 });
    // A valid GTIN-13 that is genuinely not in the catalogue.
    await user.type(screen.getByRole('textbox', { name: /barcode/i }), '4006381333931');
    await user.click(lookUp);

    expect(await screen.findByText(/not in the catalogue yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add this food/i }));

    // Not a dead end: the custom-food form, carrying the scanned number.
    expect(await screen.findByRole('heading', { name: /add a food/i })).toBeInTheDocument();
    expect(screen.getByText(/4006381333931 will be saved with this food/i)).toBeInTheDocument();
  });
});

describe('a barcode that is in the catalogue', () => {
  it('resolves against the real on-device index and opens the portion sheet', async () => {
    serveRealIndex();
    setSecureContext(true);
    setMediaDevices({
      getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotFoundError' })),
    });
    const user = userEvent.setup();
    renderScanner();

    const lookUp = await screen.findByRole('button', { name: /^look up$/i }, { timeout: 5000 });

    // A real Open Food Facts record in the committed fixture build. Picked by
    // reading the artefact rather than from the docs: the fixture is a
    // byte-range prefix of the OFF dump, so the famous example barcodes are
    // not in it and a test using one would fail for the wrong reason.
    await user.type(screen.getByRole('textbox', { name: /barcode/i }), '0009300003346');
    await user.click(lookUp);

    await waitFor(
      () => {
        expect(screen.queryByText(/not in the catalogue yet/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /log it/i })).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    // The ODbL attribution link is a licence obligation, and it has to be
    // reachable from the food's detail view. NOTICE.md §2.2.
    const attribution = screen.getByRole('link', { name: /open food facts/i });
    expect(attribution).toHaveAttribute(
      'href',
      expect.stringContaining('world.openfoodfacts.org/product/'),
    );
  });
});
