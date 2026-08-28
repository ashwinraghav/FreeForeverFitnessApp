import { formatEnergy, formatPercent, type MacroProgress } from '@freeforever/core/src/nutrition/index.js';

/**
 * The day's energy, as one number.
 *
 * One number per glance (CLAUDE.md). Everything else on this screen is
 * supporting detail; this is the thing read at arm's length, so it gets the
 * display type size and tabular figures.
 *
 * Three things the ring does that a plain arc does not:
 *
 * - **Overshoot is a separate arc, not a wrapped one.** A 140% ring drawn as a
 *   single arc wraps and reads as 40%, which is the opposite of the truth.
 * - **Over target is a shape change, not only a colour.** The overshoot arc is
 *   drawn outside the track and the label says "over" in words, so the state
 *   survives greyscale, colour-vision deficiency and a sun-washed screen
 *   (ADR-0013).
 * - **The safety floor is marked.** A user cycling calories or eating into a
 *   deficit can see the line below which the app will not go, rather than only
 *   meeting it as a clamp they never asked about.
 */

const VIEWBOX = 100;
const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface MacroRingProps {
  energy: MacroProgress;
  /** The binding safety floor, when one is known. Drawn as a tick on the track. */
  floorKcal?: number | undefined;
  energyUnit: 'kcal' | 'kJ';
}

export function MacroRing({ energy, floorKcal, energyUnit }: MacroRingProps) {
  const remaining = energy.target > 0 ? energy.remaining : null;
  const overshoot =
    energy.target > 0 ? Math.min(1, energy.overBy / energy.target) : 0;

  // The floor as a fraction of the target, so it lands on the same arc.
  const floorFraction =
    floorKcal !== undefined && energy.target > 0
      ? Math.min(1, Math.max(0, floorKcal / energy.target))
      : null;

  const label =
    energy.target > 0
      ? `${formatEnergy(energy.consumed, energyUnit)} of ${formatEnergy(energy.target, energyUnit)} ${energyUnit}, ${formatPercent(energy.fraction)}${energy.isOver ? `, ${formatEnergy(energy.overBy, energyUnit)} over` : ''}`
      : `${formatEnergy(energy.consumed, energyUnit)} ${energyUnit} logged, no target set`;

  return (
    <div className="ffn-ring-wrap">
      <svg
        className="ffn-ring"
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        role="img"
        aria-label={label}
      >
        {/* Rotate so the arc starts at twelve o'clock rather than three. */}
        <g transform={`rotate(-90 ${VIEWBOX / 2} ${VIEWBOX / 2})`}>
          <circle
            className="ffn-ring-track"
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            strokeWidth={10}
          />
          <circle
            className="ffn-ring-fill"
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            strokeWidth={10}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - energy.fraction)}
          />
          {energy.isOver ? (
            <circle
              className="ffn-ring-over"
              cx={VIEWBOX / 2}
              cy={VIEWBOX / 2}
              /* Outside the track, so the overshoot is a distinct shape. */
              r={RADIUS + 8}
              strokeWidth={4}
              strokeDasharray={2 * Math.PI * (RADIUS + 8)}
              strokeDashoffset={2 * Math.PI * (RADIUS + 8) * (1 - overshoot)}
            />
          ) : null}
          {floorFraction !== null ? (
            <line
              className="ffn-ring-floor"
              x1={VIEWBOX / 2 + (RADIUS - 8) * Math.cos(floorFraction * 2 * Math.PI)}
              y1={VIEWBOX / 2 + (RADIUS - 8) * Math.sin(floorFraction * 2 * Math.PI)}
              x2={VIEWBOX / 2 + (RADIUS + 8) * Math.cos(floorFraction * 2 * Math.PI)}
              y2={VIEWBOX / 2 + (RADIUS + 8) * Math.sin(floorFraction * 2 * Math.PI)}
              strokeWidth={2}
            />
          ) : null}
        </g>
      </svg>

      <div className="ffn-stack-tight">
        <div>
          <span className="ffn-ring-value">
            {remaining === null
              ? formatEnergy(energy.consumed, energyUnit)
              : formatEnergy(Math.abs(remaining), energyUnit)}
          </span>{' '}
          <span className="ffn-ring-unit">{energyUnit}</span>
        </div>
        <div className={energy.isOver ? 'ffn-over' : 'ffn-muted'}>
          {remaining === null ? 'logged today' : energy.isOver ? 'over target' : 'left today'}
        </div>
        {energy.target > 0 ? (
          <div className="ffn-muted">
            {formatEnergy(energy.consumed, energyUnit)} of{' '}
            {formatEnergy(energy.target, energyUnit)} {energyUnit}
          </div>
        ) : null}
      </div>
    </div>
  );
}
