import { useEffect, useState } from 'react';

import { loadFullCatalogue } from './load.js';
import { STARTER_CATALOGUE } from './starter.js';
import type { CatalogueEntry } from './types.js';

/**
 * The exercise catalogue, starting at 70 and growing to ~900.
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
 */
export function useCatalogue(): readonly CatalogueEntry[] {
  const [catalogue, setCatalogue] = useState<readonly CatalogueEntry[]>(STARTER_CATALOGUE);

  useEffect(() => {
    let live = true;
    void loadFullCatalogue().then((full) => {
      // The screen may have unmounted mid-fetch; setting state then is a no-op React
      // warns about, and on a session screen it would also be a wasted 1.66 MB parse
      // held alive by the closure.
      if (live) setCatalogue(full);
    });
    return () => {
      live = false;
    };
  }, []);

  return catalogue;
}
