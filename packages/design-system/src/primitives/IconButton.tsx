import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { NamedProps } from '../lib/a11y.js';
import { cx } from '../lib/cx.js';
import type { ButtonSize, ButtonVariant } from './Button.js';

/**
 * An icon-only control.
 *
 * The accessible name is part of the type, not a convention: `NamedProps` requires
 * exactly one of `aria-label` or `aria-labelledby`, so an unnamed IconButton does not
 * compile. That is the whole point of this component existing separately from Button.
 */
export type IconButtonProps = NamedProps<ButtonHTMLAttributes<HTMLButtonElement>> & {
  /** The glyph. Rendered aria-hidden - the name comes from the props above. */
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ff-control',
        'ff-focusable',
        'ff-button',
        'ff-icon-button',
        `ff-button--${variant}`,
        `ff-icon-button--${size}`,
        className,
      )}
      data-ff-size={size}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
