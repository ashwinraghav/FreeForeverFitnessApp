import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  value: number;
  min?: number;
  max: number;
  /** Values at or above this read as on-target. */
  optimum?: number;
  /** Below this reads as low. */
  low?: number;
  label: string;
  valueText?: string;
  /** Show the min/max endpoints beneath the track. */
  showScale?: boolean;
  unit?: string;
}

/**
 * A measurement within a known range - protein against target, volume against a cap.
 * Distinct from ProgressBar: this is a level, not progress, and the band it falls in
 * is signalled by fill colour AND by the announced value text, never colour alone.
 */
export function Meter({
  value,
  min = 0,
  max,
  optimum,
  low,
  label,
  valueText,
  showScale = false,
  unit,
  className,
  ...rest
}: MeterProps) {
  const span = max - min;
  const clamped = Math.min(max, Math.max(min, value));
  const pct = span > 0 ? Math.round(((clamped - min) / span) * 100) : 0;

  const band =
    optimum !== undefined && clamped >= optimum
      ? 'optimum'
      : low !== undefined && clamped < low
        ? 'low'
        : 'medium';

  const spoken = valueText ?? `${value}${unit ? ` ${unit}` : ''} of ${max}${unit ? ` ${unit}` : ''}`;

  return (
    <div className={className}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={spoken}
        data-ff-band={band}
        className="ff-track"
        {...rest}
      >
        <div className={cx('ff-track__fill', `ff-meter__fill--${band}`)} style={{ inlineSize: `${pct}%` }} />
      </div>
      {showScale ? (
        <div className="ff-meter__scale" aria-hidden="true">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      ) : null}
    </div>
  );
}
