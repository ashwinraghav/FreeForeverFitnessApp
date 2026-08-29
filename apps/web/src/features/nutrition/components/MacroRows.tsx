import { Meter } from '@freeforever/design-system';
import {
  formatGrams,
  formatMillilitres,
  type DaySummary,
  type MacroProgress,
} from '@freeforever/core/src/nutrition/index.js';

/**
 * Protein, carbohydrate, fat, and — when a target sets them — fibre and water.
 *
 * `Meter`, not `ProgressBar`: this is a measurement inside a range, not
 * progress through a task with a known end. Screen readers announce the two
 * differently and picking the wrong one is a real bug, not a nicety
 * (`packages/design-system/README.md`).
 *
 * The numeric value is always printed next to the bar. A bar alone is a
 * comparison the user cannot make precisely, and precision is the entire point
 * of logging food.
 *
 * **With no target set there is no bar at all.** The previous version fell back
 * to `max = consumed`, which made every macro render as a full amber bar the
 * moment anything was logged — one pickle spear filled the carbohydrate meter
 * to 100%. Directly above it the ring correctly said "no target set yet, so the
 * ring has nothing to measure against", so the screen contradicted itself and
 * the bar was the more alarming half. A meter against no range is not a
 * measurement; the number alone is the honest rendering.
 */

function MacroLine({
  name,
  progress,
  unit,
  format,
}: {
  name: string;
  progress: MacroProgress;
  unit: string;
  format: (value: number) => string;
}) {
  return (
    <div className="ffn-macro">
      <span className="ffn-macro-name">{name}</span>
      <span className={progress.isOver ? 'ffn-macro-value ffn-over' : 'ffn-macro-value'}>
        {format(progress.consumed)}
        {progress.target > 0 ? ` / ${format(progress.target)}` : ''} {unit}
        {progress.isOver ? ` · ${format(progress.overBy)} over` : ''}
      </span>
      {progress.target > 0 ? (
        <div className="ffn-macro-meter">
          <Meter
            label={name}
            value={progress.consumed}
            max={progress.target}
            valueText={`${format(progress.consumed)} of ${format(progress.target)} ${unit}`}
          />
        </div>
      ) : null}
    </div>
  );
}

export function MacroRows({ summary, massUnit }: { summary: DaySummary; massUnit: 'g' | 'oz' }) {
  const grams = (value: number) => formatGrams(value, massUnit);
  return (
    <div className="ffn-macros">
      <MacroLine name="Protein" progress={summary.protein} unit={massUnit} format={grams} />
      <MacroLine name="Carbs" progress={summary.carbs} unit={massUnit} format={grams} />
      <MacroLine name="Fat" progress={summary.fat} unit={massUnit} format={grams} />
      {summary.fiber ? (
        <MacroLine name="Fibre" progress={summary.fiber} unit={massUnit} format={grams} />
      ) : null}
      {summary.water ? (
        <MacroLine
          name="Water"
          progress={summary.water}
          unit=""
          format={(value) => formatMillilitres(value)}
        />
      ) : null}
    </div>
  );
}
