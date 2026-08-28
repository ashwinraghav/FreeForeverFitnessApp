import { ListItem } from '@freeforever/design-system';
import {
  formatEnergy,
  formatGrams,
  scaleNutrients,
  type NutrientProfile,
} from '@freeforever/core/src/nutrition/index.js';

/**
 * One food in a list: search results, recents, favourites, custom foods.
 *
 * The energy figure is per the amount that will actually be logged, not per
 * 100 g. A search result showing "165 kcal" when tapping it logs 280 is a
 * number that trains users to distrust the app.
 */
export function FoodRow({
  name,
  brand,
  nutrientsPer100g,
  previewGrams,
  energyUnit,
  massUnit,
  detail,
  trailing,
  onActivate,
  activateLabel,
}: {
  name: string;
  brand?: string | null | undefined;
  nutrientsPer100g: NutrientProfile;
  /** The mass the preview figures describe. Defaults to 100 g. */
  previewGrams?: number | undefined;
  energyUnit: 'kcal' | 'kJ';
  massUnit: 'g' | 'oz';
  detail?: string | undefined;
  trailing?: React.ReactNode | undefined;
  onActivate?: (() => void) | undefined;
  activateLabel?: string | undefined;
}) {
  const grams = previewGrams ?? 100;
  const nutrients = scaleNutrients(nutrientsPer100g, grams);
  const macros = `P ${formatGrams(nutrients.proteinG, massUnit)} · C ${formatGrams(nutrients.carbsG, massUnit)} · F ${formatGrams(nutrients.fatG, massUnit)}`;

  return (
    <ListItem
      {...(onActivate ? { onActivate } : {})}
      {...(activateLabel !== undefined ? { activateLabel } : {})}
      {...(trailing !== undefined ? { trailing } : {})}
    >
      <div className="ffn-food">
        <span className="ffn-food-name">
          {name}
          {brand !== undefined && brand !== null && brand !== '' ? (
            <span className="ffn-muted"> · {brand}</span>
          ) : null}
        </span>
        <span className="ffn-food-energy">
          {formatEnergy(nutrients.energyKcal, energyUnit)} {energyUnit}
        </span>
        <span className="ffn-food-meta">{detail ?? `${macros} · per ${Math.round(grams)} g`}</span>
      </div>
    </ListItem>
  );
}
