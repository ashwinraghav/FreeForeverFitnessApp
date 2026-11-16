import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearDiagnostics, setDiagnostics, buildReport } from '../diagnostics.js';
import {
  briefBytes,
  briefFilename,
  copyBrief,
  downloadBrief,
  shareBrief,
  shareFilename,
} from './handoff.js';

const TEXT = '# Training brief\n\n80x5@8\n';
const NOW = new Date('2026-09-03T09:15:00.000Z');

/**
 * A navigator with exactly the capabilities a case names and no others.
 *
 * Built rather than patched onto the real one, because the whole point of these tests
 * is which mechanism gets picked when the others are missing — and a stray real
 * `clipboard` would quietly satisfy a case that was meant to fall through to a file.
 */
function nav(parts: {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}): Navigator {
  return parts as unknown as Navigator;
}

/** Every browser that has a share sheet at all has `share`; `canShare` came later. */
const NOOP_SHARE = async (_data: ShareData): Promise<void> => undefined;

function docWithAnchor(): { doc: Document; clicked: () => HTMLAnchorElement | null } {
  let anchor: HTMLAnchorElement | null = null;
  const real = document;
  const doc = {
    createElement: (tag: string) => {
      const element = real.createElement(tag) as HTMLAnchorElement;
      element.click = () => {
        anchor = element;
      };
      return element;
    },
    body: real.body,
  } as unknown as Document;
  return { doc, clicked: () => anchor };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the filename', () => {
  it('says what it is and sorts', () => {
    expect(briefFilename(NOW)).toBe('freeforever-brief-2026-09-03.md');
  });

  it('offers a share sheet `.txt`, because `.md` is not on the allowlist', () => {
    // Chromium validates shared files against an allowlist carrying `.txt` and `.csv`
    // and not `.md`, so a markdown file silently costs the entire share mechanism.
    // The download keeps `.md`, where no allowlist applies.
    expect(shareFilename(NOW)).toBe('freeforever-brief-2026-09-03.txt');
  });
});

describe('sharing the brief', () => {
  it('hands over a file when the browser will take one', async () => {
    const share = vi.fn(async () => undefined);
    const files: File[] = [];

    const how = await shareBrief(TEXT, {
      nav: nav({
        canShare: (data) => {
          if (data.files !== undefined) files.push(...data.files);
          return data.files !== undefined;
        },
        share,
      }),
      now: NOW,
    });

    expect(how).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(files[0]?.name).toBe('freeforever-brief-2026-09-03.txt');
    expect(files[0]?.type).toBe('text/plain');
  });

  it('falls back to sharing text when the browser refuses the file', async () => {
    const shared: ShareData[] = [];

    const how = await shareBrief(TEXT, {
      nav: nav({
        // Files no, text yes — the shape several mobile browsers actually have.
        canShare: (data) => data.files === undefined,
        share: async (data) => {
          shared.push(data);
        },
      }),
      now: NOW,
    });

    expect(how).toBe('shared');
    expect(shared[0]?.text).toBe(TEXT);
    expect(shared[0]?.files).toBeUndefined();
  });

  it('stops when the user dismisses the sheet, and downloads nothing', async () => {
    // The case worth having a test for. Treating AbortError as "share unavailable"
    // would save a file the user just declined to send.
    const { doc, clicked } = docWithAnchor();
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, {
      nav: nav({
        canShare: () => true,
        share: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
        clipboard: { writeText },
      }),
      doc,
      now: NOW,
    });

    expect(how).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
    expect(clicked()).toBeNull();
  });

  it('carries on to the clipboard when the share itself breaks', async () => {
    // Not an AbortError: the mechanism failed rather than the user declining.
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, {
      nav: nav({
        canShare: () => true,
        share: () => Promise.reject(new TypeError('no share target')),
        clipboard: { writeText },
      }),
      now: NOW,
    });

    expect(how).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(TEXT);
  });

  it('shares on a browser that has `share` but not `canShare`', async () => {
    // Every Safari before 16.4. The first version gated on `canShare?.(…) === true`,
    // so a missing `canShare` read as a refusal and these devices — which have a
    // perfectly good share sheet — were silently sent to the clipboard instead.
    // This is the bug a real phone reported.
    const share = vi.fn(async (_data: ShareData) => undefined);
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, {
      nav: nav({ share, clipboard: { writeText } }),
      now: NOW,
    });

    expect(how).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('goes to the clipboard when `canShare` refuses both payloads', async () => {
    // The legitimate route to step 3: a share sheet exists and wants neither a file
    // nor a string. Proven beside the positive cases above so a pass here cannot
    // mean the share branch was never reachable.
    const share = vi.fn(async (_data: ShareData) => undefined);
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, {
      nav: nav({ share, canShare: () => false, clipboard: { writeText } }),
      now: NOW,
    });

    expect(how).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('copies when there is no share sheet at all', async () => {
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, { nav: nav({ clipboard: { writeText } }), now: NOW });

    expect(how).toBe('copied');
  });

  it('treats a throwing `canShare` as a refusal rather than a crash', async () => {
    const writeText = vi.fn(async () => undefined);

    const how = await shareBrief(TEXT, {
      nav: nav({
        share: NOOP_SHARE,
        canShare: () => {
          throw new TypeError('bad share data');
        },
        clipboard: { writeText },
      }),
      now: NOW,
    });

    expect(how).toBe('copied');
  });

  it('saves a file when there is no share sheet and no clipboard', async () => {
    const { doc, clicked } = docWithAnchor();

    const how = await shareBrief(TEXT, { nav: nav({}), doc, now: NOW });

    expect(how).toBe('downloaded');
    expect(clicked()?.download).toBe('freeforever-brief-2026-09-03.md');
  });

  it('says so rather than pretending, when nothing at all is available', async () => {
    // A webview with no share target, no clipboard, and downloads blocked outright.
    // The button must report that rather than look like it worked.
    const doc = {
      createElement: () => {
        throw new Error('blocked');
      },
      body: document.body,
    } as unknown as Document;

    const how = await shareBrief(TEXT, { nav: nav({}), doc, now: NOW });

    expect(how).toBe('failed');
  });
});

describe('copy and save on their own', () => {
  it('copies, and falls back to a file when the clipboard refuses', async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyBrief(TEXT, { nav: nav({ clipboard: { writeText } }) })).toBe('copied');

    const { doc, clicked } = docWithAnchor();
    const refusing = nav({
      clipboard: { writeText: () => Promise.reject(new Error('not permitted')) },
    });
    expect(await copyBrief(TEXT, { nav: refusing, doc, now: NOW })).toBe('downloaded');
    expect(clicked()).not.toBeNull();
  });

  it('saves a file with the brief in it', () => {
    const { doc, clicked } = docWithAnchor();

    expect(downloadBrief(TEXT, { doc, now: NOW })).toBe('downloaded');
    expect(clicked()?.href).toMatch(/^blob:/u);
  });
});

describe('the byte count the UI reports', () => {
  it('counts bytes and not characters', () => {
    // "10 KB" has to be true on a phone with a Devanagari exercise note in it.
    expect(briefBytes('abc')).toBe(3);
    expect(briefBytes('डेडलिफ्ट')).toBeGreaterThan('डेडलिफ्ट'.length);
  });
});

/**
 * The part that answers "why did my phone copy instead of sharing?" next time.
 *
 * Neither jsdom nor code review can say which gate a particular handset closed, which
 * is exactly why `diagnostics.ts` exists. So the ladder's own account of itself is
 * asserted here: without it, the next report is another guessing session.
 */
describe('the diagnostic trail', () => {
  it('records what the browser offered and what it refused', async () => {
    setDiagnostics(true);
    clearDiagnostics();

    await shareBrief(TEXT, {
      nav: nav({
        share: NOOP_SHARE,
        canShare: (data) => data.files === undefined,
        clipboard: { writeText: async () => undefined },
      }),
      now: NOW,
    });

    const tags = buildReport().events.map((event) => event.tag);
    expect(tags).toContain('brief.share.probe');
    expect(tags).toContain('brief.share.done');

    const probe = buildReport().events.find((event) => event.tag === 'brief.share.probe');
    expect(probe?.data?.share).toBe('function');
    expect(probe?.data?.canShare).toBe('function');
    // Capability flags only. A log that carried the brief would be a data leak
    // dressed up as a bug report.
    expect(JSON.stringify(buildReport())).not.toContain('80x5');

    setDiagnostics(false);
  });

  it('names the mechanism it fell through to', async () => {
    setDiagnostics(true);
    clearDiagnostics();

    await shareBrief(TEXT, {
      nav: nav({ clipboard: { writeText: async () => undefined } }),
      now: NOW,
    });

    const fell = buildReport().events.find((event) => event.tag === 'brief.share.fell_through');
    expect(fell?.data?.to).toBe('clipboard');

    setDiagnostics(false);
  });
});
