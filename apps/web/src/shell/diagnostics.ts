/**
 * A small ring buffer of what actually happened, so a bug on a phone can be
 * reported rather than guessed at.
 *
 * This exists because a held stepper stopped after three increments on mobile
 * and worked on desktop, and the only tools available were reasoning and jsdom —
 * neither of which has a thumb. Two plausible causes were found by reading code;
 * whether either is THE cause on a real device is not something code review can
 * settle.
 *
 * Rules it follows, because a diagnostic that leaks is worse than none:
 *
 *  - **Nothing personal.** Event names, timings, numbers, and a handful of
 *    capability flags. No workout contents, no food, no photos, no storage keys.
 *  - **Nothing leaves the device on its own.** There is no endpoint. The buffer
 *    sits in memory until the user deliberately copies it.
 *  - **Bounded.** A ring buffer, so a long session cannot grow it without limit.
 */

export interface DiagEvent {
  readonly t: number;
  readonly tag: string;
  readonly data?: Record<string, string | number | boolean | null>;
}

const MAX_EVENTS = 400;
const buffer: DiagEvent[] = [];
let enabled = false;
const started = Date.now();

/** Off by default: a ring buffer nobody reads is still work on every pointer move. */
export function setDiagnostics(on: boolean): void {
  enabled = on;
  if (on) record('diagnostics.on');
}

export function diagnosticsEnabled(): boolean {
  return enabled;
}

export function record(tag: string, data?: DiagEvent['data']): void {
  if (!enabled) return;
  buffer.push({ t: Date.now() - started, tag, ...(data === undefined ? {} : { data }) });
  if (buffer.length > MAX_EVENTS) buffer.shift();
}

export function clearDiagnostics(): void {
  buffer.length = 0;
}

let listening = false;

/**
 * Catch the things nobody remembered to instrument.
 *
 * A report is only useful if it contains the failure, and most failures are not
 * in whichever component someone thought to add a `record()` call to. Errors and
 * rejected promises are where the real ones surface, so they are captured
 * generically — the alternative is a third-party crash reporter, which this
 * project will not ship: it is an unbounded per-user cost, a metered dependency,
 * and it sends a user's data somewhere without asking.
 *
 * Attached once and left attached. The handlers do nothing while recording is
 * off, and never swallow the event — the console still gets everything.
 */
export function installGlobalCapture(): void {
  if (listening) return;
  listening = true;

  globalThis.addEventListener?.('error', (event) => {
    const e = event as ErrorEvent;
    record('error', {
      message: String(e.message ?? 'unknown').slice(0, 300),
      // File and line, never the whole stack: a stack can carry values.
      source: `${String(e.filename ?? '').split('/').pop() ?? ''}:${e.lineno ?? 0}`,
    });
  });

  globalThis.addEventListener?.('unhandledrejection', (event) => {
    const e = event as PromiseRejectionEvent;
    const reason: unknown = e.reason;
    record('unhandledrejection', {
      message: String(
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'non-error',
      ).slice(0, 300),
    });
  });
}

/**
 * Where the user was when it happened, which is the first question anyone asks.
 * The path only — never the query or hash, which can carry entered values.
 */
export function recordRoute(pathname: string): void {
  record('route', { path: pathname });
}

/**
 * What the environment can do, which is half of any pointer bug. Feature
 * detection rather than user-agent sniffing — what matters is whether the API
 * is there, not what the browser calls itself.
 */
function capabilities(): Record<string, string | number | boolean> {
  // Every lookup is guarded. This module is imported by pure-logic tests with no
  // DOM at all, and a diagnostic that throws while being collected is worse than
  // useless — it destroys the report of the bug it was collecting.
  const g = globalThis as typeof globalThis & {
    Element?: { prototype: unknown };
    devicePixelRatio?: number;
    innerWidth?: number;
    innerHeight?: number;
    matchMedia?: (q: string) => { matches: boolean };
  };
  const nav = g.navigator as (Navigator & { vibrate?: unknown; maxTouchPoints?: number }) | undefined;
  const el = g.Element?.prototype as { setPointerCapture?: unknown } | undefined;
  let standalone = false;
  try {
    standalone = g.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    standalone = false;
  }
  return {
    pointerCapture: typeof el?.setPointerCapture === 'function',
    pointerEvents: 'PointerEvent' in g,
    maxTouchPoints: nav?.maxTouchPoints ?? -1,
    vibrate: typeof nav?.vibrate === 'function',
    dpr: g.devicePixelRatio ?? 0,
    viewport: `${g.innerWidth ?? 0}x${g.innerHeight ?? 0}`,
    // Decides whether the keyboard shrinks the layout, and differs by browser.
    visualViewport: 'visualViewport' in g,
    standalone,
    online: nav?.onLine ?? true,
    language: nav?.language ?? 'unknown',
  };
}

export interface DiagnosticsReport {
  readonly format: 'thefreeforeverfitnessapp.diagnostics';
  readonly version: 1;
  readonly capturedAt: string;
  readonly capabilities: Record<string, string | number | boolean>;
  readonly events: readonly DiagEvent[];
}

export function buildReport(): DiagnosticsReport {
  return {
    format: 'thefreeforeverfitnessapp.diagnostics',
    version: 1,
    capturedAt: new Date().toISOString(),
    capabilities: capabilities(),
    events: [...buffer],
  };
}

/**
 * Copy to the clipboard, falling back to a download.
 *
 * Clipboard first because the point is to paste it into a message on the same
 * phone. `navigator.clipboard` needs a secure context and a user gesture, and
 * refuses in some in-app browsers — hence the fallback, and hence returning
 * which one happened so the UI can say something true.
 */
export async function shareDiagnostics(): Promise<'copied' | 'downloaded' | 'failed'> {
  const text = JSON.stringify(buildReport(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `freeforever-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/gu, '-')}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return 'downloaded';
    } catch {
      return 'failed';
    }
  }
}
