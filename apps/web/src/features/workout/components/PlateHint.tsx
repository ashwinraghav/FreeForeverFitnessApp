import { plates as PLATE_TOKENS, plateOutlineVar } from '@freeforever/design-system/tokens';
import {
  solvePlateLoad,
  type BarSetup,
  type PlateSolution,
} from '@freeforever/core';

import { formatNumber } from './SetRow.js';

/**
 * What to put on the bar, one side.
 *
 * Rendered inline in the set editor rather than behind its own screen: the question is
 * asked while standing at the rack with the bar already loaded wrong, and a lifter
 * should not have to navigate to answer it.
 *
 * The plate colours are the IWF ones and are identical in both themes, because a 20kg
 * plate is blue in a dark gym too — ADR-0013 carves them out of the blueprint palette
 * deliberately. Two rules come with them, and both are obeyed here:
 *
 *   1. Every slab is drawn with a `line-strong` outline. The 5kg white and the 1.25kg
 *      light grey do not separate from a light surface on their own.
 *   2. The mass is always printed on the slab. Colour alone never identifies a plate.
 */

export interface PlateHintProps {
  readonly targetKg: number | null;
  readonly setup: BarSetup;
}

export function PlateHint({ targetKg, setup }: PlateHintProps) {
  if (targetKg === null || targetKg <= 0) return null;
  const solution = solvePlateLoad(targetKg, setup);
  return <PlateSolutionView solution={solution} />;
}

export function PlateSolutionView({ solution }: { readonly solution: PlateSolution }) {
  if (!solution.ok) {
    if (solution.reason === 'invalid_input') return null;
    return (
      <p className="ffw-plates__note">
        Bar alone is {formatNumber(solution.minimumKg)} kg — heavier than the target.
      </p>
    );
  }

  const slabs = solution.perSide.flatMap((placement) =>
    Array.from({ length: placement.count }, (_, index) => ({
      key: `${placement.kg}-${index}`,
      kg: placement.kg,
    })),
  );

  const perSideLabel = solution.mode === 'per_side' ? 'each side' : 'total';

  return (
    <div className="ffw-plates">
      <span className="ffw-plates__note">
        {formatNumber(solution.barKg)} kg bar &middot; {perSideLabel}
      </span>
      {slabs.length === 0 ? (
        <span className="ffw-plates__note">no plates</span>
      ) : (
        slabs.map((slab) => <PlateChip key={slab.key} kg={slab.kg} />)
      )}
      {solution.exact ? null : (
        <span className="ffw-plates__note">
          closest is {formatNumber(solution.achievedKg)} kg
          {solution.exhaustive ? '' : ' (best found)'}
        </span>
      )}
    </div>
  );
}

/** A single slab: IWF fill where one exists, always outlined, always labelled. */
function PlateChip({ kg }: { readonly kg: number }) {
  const token = PLATE_TOKENS[`kg-${kg}` as keyof typeof PLATE_TOKENS];
  return (
    <span
      className="ffw-plate"
      style={
        token === undefined
          ? { borderColor: plateOutlineVar }
          : { background: token.fill, color: token.label, borderColor: plateOutlineVar }
      }
      // The visible label already says the mass; this names the colour for a screen
      // reader, which is the one channel that cannot see the slab.
      aria-label={token === undefined ? `${formatNumber(kg)} kilograms` : `${formatNumber(kg)} kilogram ${token.name}`}
    >
      {formatNumber(kg)}
    </span>
  );
}
