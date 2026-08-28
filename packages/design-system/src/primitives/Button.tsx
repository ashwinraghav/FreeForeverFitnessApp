import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * `xl` is the mid-set size: 56px, for anything tapped between sets with one hand
 * while out of breath. Every other size still clears the 48px floor - they differ
 * in type size and horizontal padding, never in how easy they are to hit.
 */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fill the inline axis. The default primary action on a screen usually should. */
  block?: boolean;
  /** Required: a Button always carries a visible text label. For icon-only, use IconButton. */
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Default to type="button": a stray submit inside a workout form is a data-loss bug.
      type={type}
      className={cx(
        'ff-control',
        'ff-focusable',
        'ff-button',
        `ff-button--${variant}`,
        `ff-button--${size}`,
        block && 'ff-button--block',
        className,
      )}
      data-ff-size={size}
      data-ff-variant={variant}
      {...rest}
    >
      {children}
    </button>
  );
}
