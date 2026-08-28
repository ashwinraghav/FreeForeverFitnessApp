import {
  formatGrams,
  formatMilligrams,
  OPTIONAL_NUTRIENT_FIELDS,
  type NutrientProfile,
} from '@freeforever/core/src/nutrition/index.js';

/**
 * The full micronutrient breakdown.
 *
 * Free, and not because we are generous — because it costs nothing. The numbers
 * are already in the day document; showing them is a render, not a query. It is
 * paywalled elsewhere for the same reason per-day targets are: it is something
 * people will pay for, not something that is expensive
 * (ADR-0001 rule 6, and the cost ledger in `docs/strategy/`).
 *
 * A field the day carries no figure for is omitted rather than shown as zero. A
 * row reading "Iron 0 mg" is a measurement claim; the absence of the row is the
 * truth. That distinction only survives for user-authored foods and recipes —
 * the binary index encodes a missing figure as a zero and the reader cannot
 * tell them apart, which is noted on this panel rather than hidden.
 */

const LABELS: Partial<Record<(typeof OPTIONAL_NUTRIENT_FIELDS)[number], string>> = {
  fiberG: 'Fibre',
  sugarG: 'Sugars',
  addedSugarG: 'Added sugars',
  saturatedFatG: 'Saturated fat',
  transFatG: 'Trans fat',
  monounsaturatedFatG: 'Monounsaturated fat',
  polyunsaturatedFatG: 'Polyunsaturated fat',
  cholesterolMg: 'Cholesterol',
  sodiumMg: 'Sodium',
  potassiumMg: 'Potassium',
  calciumMg: 'Calcium',
  ironMg: 'Iron',
  alcoholG: 'Alcohol',
};

export function MicronutrientPanel({
  nutrients,
  massUnit,
  includesBundledFoods,
}: {
  nutrients: NutrientProfile;
  massUnit: 'g' | 'oz';
  /** True when any contributing food came from the bundled index. */
  includesBundledFoods: boolean;
}) {
  const rows = OPTIONAL_NUTRIENT_FIELDS.flatMap((field) => {
    const value = nutrients[field];
    if (value === undefined) return [];
    const label = LABELS[field] ?? field;
    const formatted = field.endsWith('Mg') ? formatMilligrams(value) : `${formatGrams(value, massUnit)} ${massUnit}`;
    return [{ field, label, formatted }];
  });

  if (rows.length === 0) {
    return <p className="ffn-muted">No micronutrient figures on today&rsquo;s foods.</p>;
  }

  return (
    <>
      <div className="ffn-micros">
        {rows.map((row) => (
          <div className="ffn-micro" key={row.field}>
            <span>{row.label}</span>
            <span>{row.formatted}</span>
          </div>
        ))}
      </div>
      {includesBundledFoods ? (
        <p className="ffn-muted">
          Foods from the bundled catalogue report a figure for every nutrient, including
          where the upstream record had none. Treat a zero on those as &ldquo;not
          stated&rdquo; rather than as a measurement.
        </p>
      ) : null}
    </>
  );
}
