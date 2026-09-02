import { openExerciseCatalogue } from '@freeforever/datasets/exercises';

import { adaptCatalogue, type DatasetExercise } from './fromDatasets.js';
import { mergeCatalogues } from './merge.js';
import { STARTER_CATALOGUE } from './starter.js';
import type { CatalogueEntry } from './types.js';

/**
 * The full exercise catalogue: 70 hand-written entries plus ~830 from the dataset.
 *
 * ## This was already built and simply never plugged in
 *
 * `fromDatasets.ts` carried a note saying the 873-entry catalogue was unreachable
 * because `@freeforever/datasets` published no specifier for it. That was true when it
 * was written and is not true now — the package exports `./exercises`, the artefact
 * ships to `/data/exercises.json.gz` on every build, and `openExerciseCatalogue({url})`
 * does the fetch and the gunzip. So the picker searched 70 exercises while 873 sat in
 * the deployed bundle, which is why "straight-arm pulldown" could not be found.
 *
 * ## Loaded lazily, and never blocking
 *
 * 216 KB gzipped, 1.66 MB parsed. Nobody waits for that before they can log a set: the
 * picker opens on {@link STARTER_CATALOGUE} — which is the seventy lifts most sessions
 * are made of — and grows to the full list when this resolves. A failed fetch is not an
 * error state, it is the starter catalogue, which is exactly what shipped before.
 *
 * The service worker precaches the artefact, so this works in the basement gym the
 * design context describes (ADR-0006: search is the highest-frequency read in the
 * picker and must never require the network).
 */

/** Where the build puts the artefact. Same origin — no CDN, so no CSP change. */
export const CATALOGUE_URL = '/data/exercises.json.gz';

/**
 * Memoised so the 1.66 MB parse happens once per page load however many screens ask.
 * The promise is cached rather than the value, so two callers racing on a cold start
 * share one fetch instead of starting two.
 */
let inFlight: Promise<readonly CatalogueEntry[]> | null = null;

export function loadFullCatalogue(
  options: { readonly url?: string; readonly fetchImpl?: typeof fetch } = {},
): Promise<readonly CatalogueEntry[]> {
  inFlight ??= fetchAndMerge(options).catch((error: unknown) => {
    // Degrade to the starter set rather than throwing. A lifter mid-session must still
    // be able to add a bench press when the catalogue fetch fails.
    console.warn('exercise catalogue unavailable, using the starter set', error);
    // Cleared so a later attempt — a reconnect, a second screen — can try again.
    inFlight = null;
    return STARTER_CATALOGUE;
  });
  return inFlight;
}

async function fetchAndMerge(options: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<readonly CatalogueEntry[]> {
  const catalogue = await openExerciseCatalogue({
    url: options.url ?? CATALOGUE_URL,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const adapted = adaptCatalogue(catalogue.all() as readonly DatasetExercise[]);
  return mergeCatalogues(STARTER_CATALOGUE, adapted);
}

/** Test seam: forget the memoised load so each case starts cold. */
export function resetCatalogueCache(): void {
  inFlight = null;
}
