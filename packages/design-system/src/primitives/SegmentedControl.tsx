import type { ReactNode } from 'react';
import { useId } from 'react';

import { cx } from '../lib/cx.js';

export interface SegmentOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Required: names the group for assistive technology. */
  label: string;
  className?: string;
}

/**
 * A one-of-N picker for two to four short options - units, a rep-range preset.
 *
 * Exposed as a radiogroup rather than as tabs: it selects a value, it does not
 * reveal a panel. Arrow keys move and select, matching native radio behaviour.
 */
export function SegmentedControl({
  options,
  value,
  onValueChange,
  label,
  className,
}: SegmentedControlProps) {
  const baseId = useId();
  const enabled = options.filter((option) => !option.disabled);

  const move = (delta: number) => {
    const index = enabled.findIndex((option) => option.value === value);
    if (index === -1 || enabled.length === 0) return;
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (!next) return;
    onValueChange(next.value);
    document.getElementById(`${baseId}-${next.value}`)?.focus();
  };

  return (
    <div className={cx('ff-segmented', className)} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            id={`${baseId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled ?? false}
            className={cx('ff-control', 'ff-focusable', 'ff-segmented__option')}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
