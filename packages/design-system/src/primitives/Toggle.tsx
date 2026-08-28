import type { InputHTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children: ReactNode;
}

/**
 * A switch. Uses a native checkbox with `role="switch"` so it keeps native keyboard
 * behaviour and form participation, and reads as on/off rather than checked/unchecked.
 * The state is carried by knob position, not by colour.
 */
export function Toggle({ children, className, disabled, ...rest }: ToggleProps) {
  return (
    <label className={cx('ff-choice', disabled && 'ff-choice--disabled', className)}>
      <input
        type="checkbox"
        role="switch"
        className="ff-visually-hidden"
        disabled={disabled ?? false}
        {...rest}
      />
      <span className="ff-choice__control ff-toggle__track" aria-hidden="true">
        <span className="ff-toggle__knob" />
      </span>
      <span>{children}</span>
    </label>
  );
}
