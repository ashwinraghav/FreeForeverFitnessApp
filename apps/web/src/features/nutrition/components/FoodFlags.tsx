import { Badge } from '@freeforever/design-system';
import type { FoodSnapshot } from '../data/types.js';

/**
 * Data-quality caveats and the licence attribution.
 *
 * These are not decoration. `energyDerived` fires on about a quarter of USDA
 * records — the energy was computed from the macros because upstream stated
 * none — and a user comparing two foods deserves to know which number was
 * measured and which was inferred. `Badge` ships a glyph with every tone, so
 * each caveat reads without colour.
 *
 * The attribution link is a licence obligation, not a nicety: Open Food Facts
 * is ODbL and requires a link to the product page reachable from the food's
 * detail view (`packages/datasets/NOTICE.md` §2.2). Removing it puts the
 * project in breach.
 */
export function FoodFlags({ snapshot }: { snapshot: FoodSnapshot }) {
  const flags = snapshot.flags;
  const hasCaveat =
    flags !== undefined &&
    (flags.energyDerived || flags.servingEstimated || flags.atwaterMismatch);

  if (!hasCaveat && snapshot.attributionUrl === undefined) return null;

  return (
    <>
      {hasCaveat ? (
        <div className="ffn-flags">
          {flags?.energyDerived === true ? (
            <Badge tone="attention">Energy estimated from macros</Badge>
          ) : null}
          {flags?.servingEstimated === true ? (
            <Badge tone="attention">Serving size approximate</Badge>
          ) : null}
          {flags?.atwaterMismatch === true ? (
            <Badge tone="info">Stated energy disagrees with its macros</Badge>
          ) : null}
        </div>
      ) : null}

      {snapshot.attributionUrl !== undefined ? (
        <p className="ffn-attribution">
          Data from{' '}
          <a href={snapshot.attributionUrl} target="_blank" rel="noreferrer noopener">
            Open Food Facts
          </a>
          , used under ODbL.
        </p>
      ) : null}
    </>
  );
}
