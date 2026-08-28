/**
 * Shown only while a feature chunk loads. Deliberately not a spinner: anything
 * already local should appear instantly, and a spinner for cached content
 * teaches people the app is slow when it is not.
 */
export function Booting() {
  return <div className="ff-booting" role="status" aria-live="polite">Loading…</div>;
}
