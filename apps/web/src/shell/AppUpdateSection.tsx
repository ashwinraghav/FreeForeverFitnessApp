import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { downloadLocalData, type ExportSummary } from './exportData';
import {
  clearDiagnostics,
  diagnosticsEnabled,
  setDiagnostics,
  shareDiagnostics,
} from './diagnostics';

type Status = 'idle' | 'checking' | 'uptodate' | 'ready' | 'unsupported';

/**
 * A way to pull an update without clearing site data.
 *
 * Reported by the project owner: the only way they had found to refresh the app
 * was deleting browsing data, which also deletes their logged sessions and food
 * — so the one available refresh was destructive, and shipping an upgrade meant
 * asking people to wipe their own history.
 *
 * The prompt in `UpdatePrompt` covers the case where the browser has already
 * noticed a new build. This covers the case where it has not: it asks the
 * service worker to poll the server now, rather than whenever it next feels
 * like it. Together they mean a user is never stuck on an old build with no
 * non-destructive way out.
 *
 * **Nothing here touches storage.** Sessions, food log and custom foods live in
 * localStorage and are untouched by a worker swap or a reload; that is stated on
 * screen because the owner had reasonably concluded otherwise.
 */
export function AppUpdateSection() {
  const [status, setStatus] = useState<Status>('idle');
  const [exported, setExported] = useState<ExportSummary | null>(null);
  const [diagOn, setDiagOn] = useState(diagnosticsEnabled);
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const check = async () => {
    // Test the VALUE, not the key. `'serviceWorker' in navigator` is true when
    // the property exists and holds undefined, which is exactly the shape a
    // locked-down or non-secure context presents — and the guard then passes
    // straight into a TypeError on the next line.
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (container === undefined) {
      setStatus('unsupported');
      return;
    }
    setStatus('checking');
    try {
      const registration = await container.getRegistration();
      if (registration === undefined) {
        setStatus('unsupported');
        return;
      }
      // Ask the server now. Without this the browser decides when to look,
      // which can be hours, and there is no way for a user to hurry it along.
      await registration.update();
      setStatus(registration.waiting !== null || needRefresh ? 'ready' : 'uptodate');
    } catch {
      // Registration lookup throws outright in some contexts — a non-secure
      // origin, or a browser with site data blocked. Saying so is better than
      // leaving the status stuck on "Checking…" forever.
      setStatus('unsupported');
    }
  };

  const message: Record<Status, string> = {
    idle: 'Everything is on this device. Updating never clears it, and you can take a copy whenever you like.',
    checking: 'Checking…',
    uptodate: 'You already have the newest version.',
    ready: 'A new version is ready to install.',
    unsupported: 'This browser cannot check for updates here. Reloading the page still works.',
  };

  return (
    <section className="ff-more__group" aria-labelledby="more-update">
      <h2 className="ff-more__grouptitle" id="more-update">
        App
      </h2>
      <div className="ff-more__prose">
        <p className="ff-update-status" role="status" aria-label="App version status">
          {message[status]}
        </p>
        {exported !== null && (
          <p className="ff-update-status" role="status">
            {`Saved ${exported.filename} — ${exported.keys} item${exported.keys === 1 ? '' : 's'}, ${Math.max(1, Math.round(exported.bytes / 1024))} KB.`}
            {exported.unreadable.length > 0
              ? ` ${exported.unreadable.length} could not be read: ${exported.unreadable.join(', ')}.`
              : ''}
          </p>
        )}
        <div className="ff-more__actions">
          <button
            type="button"
            className="ff-control ff-focusable ff-more__action"
            onClick={() => void check()}
          >
            Check for updates
          </button>
          <button
            type="button"
            className="ff-control ff-focusable ff-more__action"
            onClick={() => setExported(downloadLocalData())}
          >
            Download my data
          </button>
          {(status === 'ready' || needRefresh) && (
            <button
              type="button"
              className="ff-control ff-focusable ff-more__action ff-more__action--primary"
              onClick={() => void updateServiceWorker(true)}
            >
              Install and reload
            </button>
          )}
        </div>
      </div>

      {/*
        * Diagnostics.
        *
        * Added because a held stepper stopped after three increments on a phone
        * and worked everywhere else, and the only tools to hand were reading the
        * code and jsdom — neither of which has a thumb. Two plausible causes were
        * found and fixed; whether either was THE cause on a real device is not
        * something code review can settle.
        *
        * Off by default, kept in memory, never sent anywhere on its own. It
        * records event names, timings and capability flags — no workout
        * contents, no food, no photos.
        */}
      <div className="ff-more__prose">
        <p className="ff-update-status" role="status" aria-label="Problem recording status">
          {diagResult ??
            (diagOn
              ? 'Recording. Reproduce the problem, then copy the log and send it over.'
              : 'Only if something is misbehaving and you have been asked for it.')}
        </p>
        <div className="ff-more__actions">
          <button
            type="button"
            className="ff-control ff-focusable ff-more__action"
            aria-pressed={diagOn}
            onClick={() => {
              const next = !diagOn;
              setDiagnostics(next);
              if (next) clearDiagnostics();
              setDiagOn(next);
              setDiagResult(null);
            }}
          >
            {diagOn ? 'Stop recording' : 'Record a problem'}
          </button>
          {diagOn && (
            <button
              type="button"
              className="ff-control ff-focusable ff-more__action ff-more__action--primary"
              onClick={() => {
                void shareDiagnostics().then((how) => {
                  setDiagResult(
                    how === 'copied'
                      ? 'Copied to the clipboard — paste it wherever you are reporting this.'
                      : how === 'downloaded'
                        ? 'Saved as a file — the clipboard was not available here.'
                        : 'Could not copy or save the log on this browser.',
                  );
                });
              }}
            >
              Copy the log
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
