import { record } from '../diagnostics';

/**
 * Getting the brief off this device and into whichever AI the user already has.
 *
 * Four mechanisms, tried in order, because no single one of them is available
 * everywhere and the failure mode of guessing wrong is a button that does nothing:
 *
 *  1. **The share sheet, with the brief as a file.** The whole point on a phone: the
 *     OS lists every app that accepts a text file, the user taps Claude or ChatGPT or
 *     Gemini or their notes app, and the file arrives there.
 *  2. **The share sheet, with the brief as text.** Some browsers refuse file shares
 *     but take a string, which lands in the target app's compose box. Better than a
 *     download for the same tap.
 *  3. **The clipboard**, for desktop, where paste is faster than any of this.
 *  4. **A download**, which always works and needs no permission.
 *
 * ## Reaching step 3 on a phone is a bug, and it happened
 *
 * Reported from a real handset: the button copied to the clipboard instead of opening
 * the share sheet. Falling all the way to step 3 means both share gates said no, and
 * the first version had two independent reasons for that — a `.md` file against
 * Chromium's file-type allowlist (see {@link shareFilename}) and a feature detection
 * that treated a missing `canShare` as a refusal (see `permits`). Both are fixed.
 *
 * The lasting fix is the third one: **the ladder now records why it fell through.**
 * jsdom cannot tell us which gate a Pixel closed, and neither can reading the code —
 * the same lesson `diagnostics.ts` was written for. Turn on "Record a problem" in More,
 * press the button, copy the log: `brief.share.probe` says what the browser has and
 * `brief.share.rejected` says what it refused.
 *
 * ## Cancel is not failure
 *
 * A dismissed share sheet rejects with `AbortError`, and the tempting thing is to
 * treat that as "share unavailable" and fall through to the next mechanism. That would
 * mean a user who opened the sheet and changed their mind gets a file downloaded
 * anyway — the app doing the thing they just declined. `'cancelled'` is therefore a
 * first-class outcome and stops the ladder.
 *
 * ## Nothing here happens on its own
 *
 * Every path is behind a tap, and the tap is the consent: this is the one feature in
 * the app that deliberately sends a lifter's training off the device, to a company
 * whose terms are not ours. The caller's copy says so before the button is pressed,
 * and this module has no timer, no retry and no automatic anything.
 */

export type Handoff = 'shared' | 'cancelled' | 'copied' | 'downloaded' | 'failed';

/** `freeforever-brief-2026-09-03.md` — sorts, and says what it is. */
export function briefFilename(now: Date = new Date()): string {
  return `freeforever-brief-${now.toISOString().slice(0, 10)}.md`;
}

/**
 * The same brief, named and typed for a share sheet rather than for a disk.
 *
 * `.md` / `text/markdown` is the honest description of the content and the wrong thing
 * to hand `navigator.share`. Chromium validates shared files against an **allowlist**
 * (`kPermitted` in `ShareServiceImpl::IsDangerousFilename`) which carries `.txt` and
 * `.csv` and shows no sign of `.md` — and an allowlist refuses by default, so
 * `canShare({files})` returns false and the share sheet is never offered. The brief is
 * plain text that happens to use a few markdown headings; on a share sheet the
 * extension buys nothing and costs the whole mechanism.
 *
 * The download keeps `.md`, where there is no allowlist and the extension is what makes
 * the file open nicely.
 */
export function shareFilename(now: Date = new Date()): string {
  return `freeforever-brief-${now.toISOString().slice(0, 10)}.txt`;
}

interface HandoffDeps {
  readonly nav?: Navigator;
  readonly doc?: Document;
  readonly now?: Date;
}

export async function shareBrief(text: string, deps: HandoffDeps = {}): Promise<Handoff> {
  const nav: Navigator | undefined = deps.nav ?? globalThis.navigator;
  const doc: Document | undefined = deps.doc ?? globalThis.document;
  const title = 'My training brief';

  // Recorded before anything is attempted, because "why did I get the clipboard
  // instead of the share sheet?" is a question about a device that is not in the
  // room. This is capability flags only — no brief contents, per `diagnostics.ts`.
  record('brief.share.probe', {
    share: typeof nav?.share,
    canShare: typeof nav?.canShare,
    clipboard: typeof nav?.clipboard,
    secureContext: globalThis.isSecureContext ?? false,
  });

  const file = makeFile(text, shareFilename(deps.now));
  if (file !== null && permits(nav, { files: [file], title })) {
    const outcome = await attempt(() => nav?.share({ files: [file], title }), 'file');
    if (outcome !== 'unavailable') return outcome;
  }

  if (permits(nav, { text, title })) {
    const outcome = await attempt(() => nav?.share({ text, title }), 'text');
    if (outcome !== 'unavailable') return outcome;
  }

  try {
    await nav?.clipboard.writeText(text);
    record('brief.share.fell_through', { to: 'clipboard' });
    return 'copied';
  } catch {
    // Needs a secure context and a user gesture, and several in-app browsers
    // refuse regardless. Not an error worth showing — there is still a file.
  }

  record('brief.share.fell_through', { to: 'download' });
  return download(text, briefFilename(deps.now), doc) ? 'downloaded' : 'failed';
}

/**
 * Would this browser take this payload?
 *
 * **`canShare` being absent is not a no.** The first version of this gated both share
 * attempts on `nav.canShare?.(data) === true`, which quietly means "no share sheet on
 * any browser that ships `share` without `canShare`" — and that is every Safari before
 * 16.4. Those devices have a perfectly good share sheet and were being sent to the
 * clipboard by a feature-detection typo, with no way to tell from the outside.
 *
 * So: no `share` at all is a no, `canShare` says no is a no, and `canShare` missing
 * means *unknown* — in which case try it and let the rejection be the answer. A failed
 * `share()` costs one caught promise; a wrong `false` costs the whole mechanism.
 */
function permits(nav: Navigator | undefined, data: ShareData): boolean {
  if (typeof nav?.share !== 'function') return false;
  if (typeof nav.canShare !== 'function') return true;
  try {
    return nav.canShare(data);
  } catch {
    // Not specified to throw, but a `canShare` that does must not take the button
    // down with it. Treat a throw as a refusal and move to the next mechanism.
    return false;
  }
}

/** Just the clipboard, for the "Copy" button where a share sheet would be a detour. */
export async function copyBrief(
  text: string,
  deps: Pick<HandoffDeps, 'nav' | 'doc' | 'now'> = {},
): Promise<Handoff> {
  const nav: Navigator | undefined = deps.nav ?? globalThis.navigator;
  try {
    await nav?.clipboard.writeText(text);
    return 'copied';
  } catch {
    const doc: Document | undefined = deps.doc ?? globalThis.document;
    return download(text, briefFilename(deps.now), doc) ? 'downloaded' : 'failed';
  }
}

export function downloadBrief(text: string, deps: Pick<HandoffDeps, 'doc' | 'now'> = {}): Handoff {
  const doc: Document | undefined = deps.doc ?? globalThis.document;
  return download(text, briefFilename(deps.now), doc) ? 'downloaded' : 'failed';
}

/**
 * `File` is missing in a few embedded webviews and `Blob` is not — and a missing
 * constructor must degrade to the text share rather than throw on a tap.
 */
function makeFile(text: string, filename: string): File | null {
  try {
    return new File([text], filename, { type: 'text/plain' });
  } catch {
    return null;
  }
}

async function attempt(
  share: () => Promise<void> | undefined,
  as: 'file' | 'text',
): Promise<Handoff | 'unavailable'> {
  try {
    await share();
    record('brief.share.done', { as });
    return 'shared';
  } catch (error: unknown) {
    // The user dismissing the sheet and the browser refusing the payload both land
    // here, and they must not be treated alike. Only `AbortError` means "they said
    // no"; anything else means this mechanism did not work, so try the next.
    const name = error instanceof DOMException ? error.name : 'Error';
    record('brief.share.rejected', { as, name });
    return name === 'AbortError' ? 'cancelled' : 'unavailable';
  }
}

function download(text: string, filename: string, doc: Document | undefined): boolean {
  if (doc === undefined) return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick rather than immediately: some browsers have not
    // finished reading the blob when click() returns. Same as `exportData.ts`.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** Bytes, for a UI that would rather say "14 KB" than "done". */
export function briefBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
