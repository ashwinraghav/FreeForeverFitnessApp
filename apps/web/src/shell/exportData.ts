/**
 * Take everything with you.
 *
 * Constitution rule 7 promises the data is the user's and portable. That promise
 * was unimplemented: `packages/data/src/sync/export.ts` exists but its signature
 * is `exportUserData(firestore, uid)` — it reads the synced copy, and there is
 * no synced copy. Everything this app knows lives in localStorage on the device.
 *
 * **Enumerated by prefix, never by a list.** A hand-maintained array of key names
 * is a check that approximates the thing it guards, and it goes stale the first
 * time a team adds a key without knowing this file exists — silently, producing
 * an export that looks complete and is not. Matching `/^ff[.:]/` at runtime means
 * a new key is included the day it is written. Both separators, because the teams
 * settled on different ones and the first-run check already had to learn that.
 */
const APP_KEY = /^ff[.:]/u;

export const EXPORT_FORMAT = 'thefreeforeverfitnessapp.local-export';
export const EXPORT_VERSION = 1;

export interface LocalExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  /** Raw stored values, keyed exactly as the app stores them. */
  readonly data: Record<string, unknown>;
  /** Keys found but unreadable, so a partial export is never silently partial. */
  readonly unreadable: readonly string[];
}

export function collectLocalData(storage: Storage): LocalExport {
  const data: Record<string, unknown> = {};
  const unreadable: string[] = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null || !APP_KEY.test(key)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      // Stored as JSON by every writer, but parsed defensively: a corrupt value
      // must not cost the user the rest of the export.
      data[key] = JSON.parse(raw);
    } catch {
      unreadable.push(key);
    }
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    unreadable,
  };
}

/** `freeforever-export-2026-09-01.json` — sorts, and says what it is. */
export function exportFilename(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `freeforever-export-${date}.json`;
}

export interface ExportSummary {
  readonly filename: string;
  readonly keys: number;
  readonly bytes: number;
  readonly unreadable: readonly string[];
}

/**
 * Serialise and hand it to the browser. Returns what was written so the UI can
 * say something specific — "4 items, 82 KB" is checkable; "Exported!" is not.
 */
export function downloadLocalData(
  storage: Storage = localStorage,
  doc: Document = document,
): ExportSummary {
  const payload = collectLocalData(storage);
  const text = JSON.stringify(payload, null, 2);
  const filename = exportFilename();

  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick rather than immediately: some browsers have not
  // finished reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return {
    filename,
    keys: Object.keys(payload.data).length,
    bytes: new TextEncoder().encode(text).length,
    unreadable: payload.unreadable,
  };
}
