import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /** 0-1. Omit for an indeterminate bar. */
  value?: number;
  /** Required: a bare progressbar with no name is a rectangle. */
  label: string;
  /** Human-readable position, e.g. "set 3 of 5". Read instead of the raw percentage. */
  valueText?: string;
}

/**
 * Progress through a task with a known end. For "a measurement inside a range"
 * (macros against a target, 1RM against a goal) use Meter instead - the two have
 * different ARIA roles and screen readers announce them differently.
 */
export function ProgressBar({ value, label, valueText, className, ...rest }: ProgressBarProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? 0 : Math.min(1, Math.max(0, value));
  const pct = Math.round(clamped * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : pct}
      aria-valuetext={valueText ?? undefined}
      className={cx('ff-track', className)}
      {...rest}
    >
      <div
        className={cx('ff-track__fill', indeterminate && 'ff-track__fill--indeterminate')}
        style={indeterminate ? undefined : { inlineSize: `${pct}%` }}
      />
    </div>
  );
}
