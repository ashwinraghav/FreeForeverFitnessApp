import type { MassDisplayUnit } from '@freeforever/data';
import type { PrEntry } from '../select/prs';
import { formatPrValue, prImprovement } from '../select/prs';
import { formatDateLong, formatSignedPercent } from '../select/format';

/**
 * A filled diamond. The record marker, everywhere it appears.
 *
 * A shape rather than a colour, and the same shape the e1RM line uses for a record
 * point, so the two screens teach one symbol between them. It is `aria-hidden`
 * because the row's text already says "personal record" — a glyph that duplicates
 * the label in the accessibility tree is noise, not redundancy.
 */
export function RecordGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Personal records, listed.
 *
 * Flat, chronological, one line each. No tiers, no rarity, no streak of records, no
 * animation — constitution rule 6 and the anti-engagement-bait stance in ADR-0013.
 * The improvement over the previous best is stated as a number where one exists and
 * omitted where it does not, and a first record says "first" rather than "+∞".
 */
export function PrTimeline({
  entries,
  unit,
}: {
  readonly entries: readonly PrEntry[];
  readonly unit: MassDisplayUnit;
}) {
  return (
    <ul className="ff-in-bars" aria-label="Personal records, most recent first">
      {entries.map((entry) => {
        const improvement = prImprovement(entry);
        return (
          <li key={`${entry.exerciseKey}-${entry.type}-${entry.achievedAt}`} className="ff-in-pr">
            <span className="ff-in-pr__glyph">
              <RecordGlyph />
            </span>
            <span className="ff-in-pr__body">
              <span className="ff-in-pr__name">{entry.exerciseName}</span>
              <span className="ff-in-pr__meta">
                {entry.typeLabel} · {formatDateLong(entry.achievedOn)}
                {entry.isFirst
                  ? ' · first'
                  : improvement === null
                    ? ''
                    : ` · ${formatSignedPercent(improvement)} on previous`}
              </span>
            </span>
            <span className="ff-in-pr__value">{formatPrValue(entry, unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}
