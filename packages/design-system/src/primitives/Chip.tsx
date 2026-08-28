import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  children: ReactNode;
  selected?: boolean;
}

/**
 * A toggleable filter pill. `aria-pressed` rather than `aria-selected`, because a chip
 * outside a listbox is a toggle button. Selection is signalled by fill AND by the
 * pressed state being exposed to assistive technology.
 */
export function Chip({ children, selected = false, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx('ff-control', 'ff-focusable', 'ff-chip', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
