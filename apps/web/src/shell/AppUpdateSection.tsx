import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

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
    idle: 'Your sessions and food log stay on this device — updating never clears them.',
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
        <p className="ff-update-status" role="status">
          {message[status]}
        </p>
        <div className="ff-more__actions">
          <button
            type="button"
            className="ff-control ff-focusable ff-more__action"
            onClick={() => void check()}
          >
            Check for updates
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
    </section>
  );
}
