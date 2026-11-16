import { useCallback, useEffect, useState } from 'react';

import { listCustomExercises } from '../storage/customExercises.js';
import { loadFullCatalogue } from './load.js';
import { STARTER_CATALOGUE } from './starter.js';
import type { CatalogueEntry } from './types.js';

/**
 * The exercise catalogue, plus the handle a screen needs to fold a newly written
 * exercise in.
 *
 * Returns the starter set synchronously on the first render so the picker is usable in
 * the same frame it opens — there is no loading state and no spinner, because there is
 * nothing to wait for: the seventy hand-written lifts are the ones most sessions are
 * made of. The full list swaps in when the fetch resolves, typically before anyone has
 * finished typing.
 *
 * Deliberately not a context. Two screens use it, both already memoise their derived
 * values, and `loadFullCatalogue` memoises the fetch itself — so a provider would add a
 * wrapper and change nothing about how many times the work happens.
 *
 * ## Custom exercises go first
 *
 * Same reasoning `merge.ts` gives for the starter set winning: a lifter's own entry is
 * the one they meant. It is also the one whose id is already in their history, so it can
 * never be shadowed by a bundled row that happens to share a name.
 *
 * They are read from `localStorage` synchronously on mount rather than fetched, so they
 * are present in that same first frame. No deduplication against the bundled list:
 * somebody who writes down "Bench Press" despite the catalogue having one has said
 * something, and silently dropping their row would be the picker overruling them. Two
 * similar rows is the cheaper mistake — `merge.ts` reached the same conclusion for the
 * same reason.
 *
 * `refreshCustom` re-reads storage rather than taking the new entry as an argument. The
 * store is the truth, the read is a single `getItem` on a bounded array, and a signature
 * that cannot drift out of step with what was actually saved is worth more here than
 * avoiding it.
 */
export function useCatalogueWithCustom(): {
  readonly catalogue: readonly CatalogueEntry[];
  readonly refreshCustom: () => void;
} {
  const [bundled, setBundled] = useState<readonly CatalogueEntry[]>(STARTER_CATALOGUE);
  const [custom, setCustom] = useState<readonly CatalogueEntry[]>(() => listCustomExercises());

  useEffect(() => {
    let live = true;
    void loadFullCatalogue().then((full) => {
      // The screen may have unmounted mid-fetch; setting state then is a no-op React
      // warns about, and on a session screen it would also be a wasted 1.66 MB parse
      // held alive by the closure.
      if (live) setBundled(full);
    });
    return () => {
      live = false;
    };
  }, []);

  const refreshCustom = useCallback(() => {
    setCustom(listCustomExercises());
  }, []);

  return {
    // Identity is stable while `custom` is empty, which is the common case — so a screen
    // that memoises on the catalogue does not re-derive on every render of this hook.
    catalogue: custom.length === 0 ? bundled : [...custom, ...bundled],
    refreshCustom,
  };
}

/**
 * The list alone, for a caller that cannot create one.
 *
 * A thin wrapper rather than a second implementation: the two drifting apart would mean
 * one screen seeing custom exercises and the other not, which is precisely the bug a
 * lifter would report as "it is there on one screen and gone on the other".
 */
export function useCatalogue(): readonly CatalogueEntry[] {
  return useCatalogueWithCustom().catalogue;
}
