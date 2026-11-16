import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { record } from './diagnostics';
import { briefForThisDevice } from './brief/sources';
import { briefBytes, copyBrief, downloadBrief, shareBrief, type Handoff } from './brief/handoff';

/**
 * The brief, on a page.
 *
 * Three jobs, and the third is the one that is easy to miss:
 *
 *  1. **Consent you can inspect.** "Send my training to an AI" is not a thing anyone
 *     should have to agree to blind. Every byte that would leave the device is on this
 *     page first, selectable, before any button is pressed.
 *  2. **The manual path.** When `shareBrief` returns `'failed'` — a locked-down
 *     webview with no clipboard, no share target and no downloads — this page is the
 *     fallback that always works, because selecting text always works.
 *  3. **Machine-readable without any of the machinery.** An agent already driving the
 *     browser — Claude in Chrome, Gemini in Chrome, any of them — can read this page
 *     as it stands. No API, no origin trial, no server: the data is simply on a page
 *     the user can point their assistant at. That is the whole of the "connect the app
 *     to an AI" story working today, and it cost one route.
 *
 * Rendered in a `<pre>` with `pre-wrap`, not `pre`. A monospace block of 80-column
 * lines is exactly the "wide content" that scrolls a phone document sideways — the
 * failure this repo has hit three times. Wrapping cannot do that, and the brief has no
 * column alignment worth preserving.
 */
export default function BriefScreen() {
  const brief = useMemo(() => {
    try {
      return briefForThisDevice();
    } catch (error: unknown) {
      // Deliberately not diagnosed on screen. The first version of this said
      // "storage is blocked", which was a guess — and the first time it fired, in a
      // browser with working storage, the real cause was a session on disk in a
      // shape the fold could not read. A message that names the wrong cause sends
      // the user to fix the wrong thing.
      record('brief.unreadable', {
        message: String(error instanceof Error ? error.message : 'non-error').slice(0, 200),
      });
      return null;
    }
  }, []);
  const [status, setStatus] = useState<Handoff | null>(null);

  if (brief === null) {
    return (
      <div className="ff-brief">
        <Header />
        <div className="ff-more__prose">
          <p>
            Your training could not be read on this device, so there is nothing to show
            you here.
          </p>
          <p>
            <strong>Nothing has been lost.</strong> Your sessions are still on the
            device and <Link to={ROUTES.more}>Download my data</Link> in More still
            takes a complete copy. If you have a moment, turn on “Record a problem”
            there and open this page again — that log says why.
          </p>
        </div>
      </div>
    );
  }

  const kb = Math.max(1, Math.round(briefBytes(brief) / 1024));

  return (
    <div className="ff-brief">
      <Header />
      <div className="ff-more__prose">
        <p>
          Everything below, and nothing else, is what leaves the device when you send
          it. {kb} KB of plain text. No ids, no timestamps, no photos.
        </p>
        <p className="ff-update-status" role="status">
          {status === null ? 'Nothing has been sent yet.' : SENT[status]}
        </p>
      </div>

      <div className="ff-more__actions">
        <button
          type="button"
          className="ff-control ff-focusable ff-more__action ff-more__action--primary"
          onClick={() => void shareBrief(brief).then(setStatus)}
        >
          Send it to an app
        </button>
        <button
          type="button"
          className="ff-control ff-focusable ff-more__action"
          onClick={() => void copyBrief(brief).then(setStatus)}
        >
          Copy
        </button>
        <button
          type="button"
          className="ff-control ff-focusable ff-more__action"
          onClick={() => setStatus(downloadBrief(brief))}
        >
          Save as a file
        </button>
      </div>

      {/*
        * A labelled region rather than a bare `<pre>` with a `tabIndex`.
        *
        * The first attempt made the block itself focusable, on the theory that
        * selecting the text by hand is the last fallback and must not need a mouse.
        * The a11y lint was right to refuse it: the block wraps rather than scrolls,
        * so it has nothing a keyboard would do there, and the tab stop would have
        * been a stop on the way to the buttons that does nothing. A named region
        * gives screen readers the same thing without spending a tab.
        */}
      <section aria-labelledby="brief-text">
        <h2 className="ff-brief__subtitle" id="brief-text">
          The brief itself
        </h2>
        <pre className="ff-brief__text">{brief}</pre>
      </section>
    </div>
  );
}

const SENT: Record<Handoff, string> = {
  shared: 'Handed over to the app you chose.',
  cancelled: 'Nothing was sent.',
  copied: 'Copied to the clipboard.',
  downloaded: 'Saved as a file.',
  failed: 'This browser would not share, copy or save it. Select the text below instead.',
};

function Header() {
  return (
    <header className="ff-brief__head">
      <h1 className="ff-brief__title">What gets sent</h1>
      <Link className="ff-brief__back ff-focusable" to={ROUTES.more}>
        Back to More
      </Link>
    </header>
  );
}
