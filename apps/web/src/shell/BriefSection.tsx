import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { briefBytes, shareBrief, type Handoff } from './brief/handoff';
import { record } from './diagnostics';

/**
 * "Ask an AI about your training", in More.
 *
 * One button, deliberately. `shareBrief` already degrades from the share sheet to the
 * clipboard to a file, so a row of three buttons would be asking the user to guess
 * which of them their browser supports — a question they cannot answer and the code
 * can. The status line then says which one actually happened, because "Done!" is not
 * checkable and "Copied" is.
 *
 * The brief is generated on the tap and never on mount. Two reasons, and the second is
 * the load-bearing one:
 *
 *  1. Nobody opening More is owed the work of folding their whole history.
 *  2. `brief/sources` reaches the reducers through a barrel that drags in the entire
 *     Firebase SDK — 132 kB gzipped — and More is the screen a first-time user lands
 *     on (`firstRun.ts`). A static import here would put that in front of everyone.
 *     See the note in `brief/sources.ts`; the fix is not ours to make yet.
 */

const MESSAGES: Record<Handoff, string> = {
  shared: 'Handed over. What happens to it next is that app’s business, not ours.',
  cancelled: 'Nothing was sent.',
  copied: 'Copied. Paste it into your assistant and ask away.',
  downloaded: 'Saved as a file. Upload it to your assistant and ask away.',
  failed: 'This browser would not share, copy or save. Open “what gets sent” and copy it by hand.',
};

/**
 * Two ways this can go wrong, and they are not the same sentence.
 *
 * `failed` means the brief was written and no mechanism would carry it. `unreadable`
 * means it was never written, because the fold could not read what is on disk — a
 * different problem, with a different next step, and telling the user their browser
 * refused to copy would be a lie about which half broke.
 */
type Result = { readonly kind: 'sent'; readonly how: Handoff; readonly bytes: number } | { readonly kind: 'unreadable' };

const UNREADABLE =
  'Your training could not be read on this device. Nothing has been lost — “Download my data” below still takes a full copy.';

/**
 * The size, but only where it means something.
 *
 * Reported for the three outcomes where bytes actually moved. A cancelled share sent
 * nothing, so "(3 KB)" beside "Nothing was sent" would describe a payload that never
 * left — and a failure has no size at all.
 */
function size(result: Result): string {
  if (result.kind !== 'sent') return '';
  const moved = result.how === 'shared' || result.how === 'copied' || result.how === 'downloaded';
  return moved && result.bytes > 0 ? ` (${Math.max(1, Math.round(result.bytes / 1024))} KB)` : '';
}

export function BriefSection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { briefForThisDevice } = await import('./brief/sources');
      const text = briefForThisDevice();
      setResult({ kind: 'sent', how: await shareBrief(text), bytes: briefBytes(text) });
    } catch (error: unknown) {
      // Storage refused, a session on disk the fold cannot read, or a chunk that
      // would not load offline. All of them mean "no brief", which is worth saying —
      // and none of them mean the share sheet failed.
      record('brief.unreadable', {
        message: String(error instanceof Error ? error.message : 'non-error').slice(0, 200),
      });
      setResult({ kind: 'unreadable' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ff-more__group" aria-labelledby="more-brief">
      <h2 className="ff-more__grouptitle" id="more-brief">
        Ask an AI about your training
      </h2>
      <div className="ff-more__prose">
        <p>
          This app has no AI in it and never charges you for one. What it can do is write
          your training out as a short, plain summary — sessions, bests, weekly volume,
          recent food — and hand it to whichever assistant you already use.
        </p>
        <p>
          <strong>It only leaves this device when you tap.</strong> Once you send it, it is
          under that app’s rules rather than ours, so send it somewhere you are happy
          having it.
        </p>
        <p className="ff-update-status" role="status">
          {result === null
            ? 'A few kilobytes of text. Small enough to paste into a chat.'
            : result.kind === 'unreadable'
              ? UNREADABLE
              : `${MESSAGES[result.how]}${size(result)}`}
        </p>
        <div className="ff-more__actions">
          <button
            type="button"
            className="ff-control ff-focusable ff-more__action ff-more__action--primary"
            aria-busy={busy}
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? 'Writing it out…' : 'Send it to an app'}
          </button>
          <Link className="ff-control ff-focusable ff-more__action" to={ROUTES.brief}>
            See what gets sent
          </Link>
        </div>
      </div>
    </section>
  );
}
