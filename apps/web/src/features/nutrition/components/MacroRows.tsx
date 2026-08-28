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
      <div className="ffn-macro-meter">
        <Meter
          label={name}
          value={progress.consumed}
          max={progress.target > 0 ? progress.target : Math.max(1, progress.consumed)}
          valueText={
            progress.target > 0
              ? `${format(progress.consumed)} of ${format(progress.target)} ${unit}`
              : `${format(progress.consumed)} ${unit}`
          }
        />
      </div>
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
