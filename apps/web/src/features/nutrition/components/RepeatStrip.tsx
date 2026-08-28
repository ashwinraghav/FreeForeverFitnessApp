import { formatEnergy, formatPortion, scaleNutrients } from '@freeforever/core/src/nutrition/index.js';
import type { RecentFood } from '../data/types.js';

/**
 * The two-tap path, and the reason this feature exists in the shape it does.
 *
 * MyFitnessPal takes six taps to log a food you have eaten a hundred times:
 * plus, Food, choose meal, open the list, pick the food, confirm the portion.
 * That is the single biggest reason people abandon food logging — not the
 * database, not the accuracy, the tap count on the ninetieth repetition.
 *
 * Here it is one tap from this screen. The strip sits at the bottom, in the
 * reachable third, and each button logs the food with the portion and the meal
 * the user chose last time — data the recents row already carries, so there is
 * no lookup, no index read and nothing that can be slow or missing. Undo lives
 * on the toast that follows, which is what makes a one-tap write safe.
 *
 * Deliberately not a modal, not a menu, and not behind a "+" — every layer of
 * disclosure is a tap, and taps are the thing being spent.
 */
export function RepeatStrip({
  recents,
  energyUnit,
  onLogAgain,
  onOpenPortion,
}: {
  recents: readonly RecentFood[];
  energyUnit: 'kcal' | 'kJ';
  /** One tap: log it exactly as last time. */
  onLogAgain: (recent: RecentFood) => void;
  /** Long-press / secondary: open the portion sheet instead. */
  onOpenPortion: (recent: RecentFood) => void;
}) {
  if (recents.length === 0) return null;

  return (
    <div className="ffn-repeat" role="list" aria-label="Log again">
      {recents.map((recent) => {
        const energy = scaleNutrients(
          recent.snapshot.nutrientsPer100g,
          recent.lastQuantity * recent.lastServing.gramsPerServing,
        ).energyKcal;
        const portion = formatPortion(recent.lastQuantity, recent.lastServing);

        return (
          <button
            key={recent.snapshot.key}
            type="button"
            role="listitem"
            className="ffn-repeat-item"
            onClick={() => onLogAgain(recent)}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenPortion(recent);
            }}
            // The accessible name carries the whole action, because the visible
            // label is truncated to two lines and a screen-reader user must
            // still know what one tap is about to do.
            aria-label={`Log ${recent.snapshot.ref.name}, ${portion}, ${Math.round(energy)} kilocalories, to ${recent.lastSlot.replace('_', ' ')}`}
          >
            <span className="ffn-repeat-name">{recent.snapshot.ref.name}</span>
            <span className="ffn-repeat-meta">
              {portion} · {formatEnergy(energy, energyUnit)} {energyUnit}
            </span>
          </button>
        );
      })}
    </div>
  );
}
