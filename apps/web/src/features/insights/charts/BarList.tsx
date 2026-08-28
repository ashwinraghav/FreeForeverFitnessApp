export interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly valueText: string;
  /** Secondary detail for the row, e.g. tonnage behind a set count. */
  readonly detail?: string;
}

export interface BarListProps {
  readonly rows: readonly BarRow[];
  /** Names the list for assistive technology. */
  readonly label: string;
}

/**
 * A sorted horizontal bar list.
 *
 * This is the answer to "per-muscle-group distribution", and it is deliberately not a
 * pie, a donut or a treemap. Twenty-one muscle groups is three times the point at
 * which colour classes stop being distinguishable, and this design system has exactly
 * one signal colour — a twenty-one-hue categorical palette does not exist in it, and
 * generating one would fail every colourblind separation check. Sorted length in a
 * single hue answers the ranking question better than any of them would anyway:
 * position and length carry the comparison, and nothing is encoded in colour at all.
 *
 * HTML rather than canvas because the rows are few, the labels are text that must
 * reflow and scale, and each row is already its own accessible list item.
 */
export function BarList({ rows, label }: BarListProps) {
  const max = rows.reduce((m, row) => Math.max(m, row.value), 0);
  return (
    <ul className="ff-in-bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="ff-in-bar">
          <span className="ff-in-bar__label">{row.label}</span>
          <span className="ff-in-bar__track">
            <span
              className="ff-in-bar__fill"
              style={{ inlineSize: max === 0 ? '0%' : `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="ff-in-bar__value">
            {row.valueText}
            {row.detail !== undefined && <span className="ff-in-bar__detail"> {row.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
