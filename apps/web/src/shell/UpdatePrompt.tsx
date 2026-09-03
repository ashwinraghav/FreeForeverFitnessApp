import { useSyncExternalStore } from 'react';

import { dismissUpdate, installUpdate, isUpdateReady, subscribe } from './appUpdate';

/**
 * The other half of `registerType: 'prompt'`.
 *
 * The service worker is registered in prompt mode on purpose — an automatic swap can
 * reload the page mid-workout, and losing entered sets to something the user did not ask
 * for is the worst failure in this category (ADR-0013). But prompt mode only downloads
 * the new build and parks it in `waiting`; something has to offer it. Nothing did, so
 * every deploy was invisible to anyone who had already visited.
 *
 * State and the install itself both come from `appUpdate`, which registers exactly once.
 * This component used to call `useRegisterSW()` itself, and so did `AppUpdateSection` —
 * two registrations over one worker, where only whichever instance happened to see the
 * `waiting` event had a working button. That is why Update sometimes did nothing at all.
 *
 * Deliberately a row in the frame's grid rather than a floating overlay. A fixed-position
 * bar over the bottom of the screen is exactly how this repo has previously buried a
 * control it did not mean to (see the CLAUDE.md layout notes) — a grid row cannot
 * occlude anything, because the rest of the app is laid out around it.
 *
 * Not a modal, and not dismissible-by-timeout: `role="status"` announces it without
 * stealing focus mid-set, and it stays until the user acts. Reloading is safe at any
 * moment — the draft workout is written to storage on every change — but it is still the
 * user's call when to take it.
 */
export function UpdatePrompt() {
  const ready = useSyncExternalStore(subscribe, isUpdateReady, () => false);

  if (!ready) return null;

  return (
    <div className="ff-update" role="status">
      <span className="ff-update__text">A new version is ready.</span>
      <button
        type="button"
        className="ff-control ff-focusable ff-update__action"
        onClick={() => void installUpdate()}
      >
        Update
      </button>
      <button
        type="button"
        className="ff-control ff-focusable ff-update__later"
        onClick={dismissUpdate}
      >
        Later
      </button>
    </div>
  );
}
