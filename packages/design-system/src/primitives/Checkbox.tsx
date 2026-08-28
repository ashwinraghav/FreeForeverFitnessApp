import type { InputHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { cx } from '../lib/cx.js';
import { CheckGlyph, DashGlyph } from '../lib/glyphs.js';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children: ReactNode;
  /** Renders the mixed state. Sets the DOM property, which has no HTML attribute. */
  indeterminate?: boolean;
}

export function Checkbox({
  children,
  indeterminate = false,
  className,
  disabled,
  ...rest
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cx('ff-choice', disabled && 'ff-choice--disabled', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="ff-visually-hidden"
        disabled={disabled ?? false}
        aria-checked={indeterminate ? 'mixed' : undefined}
        {...rest}
      />
      {/* The tick is a shape, not a colour: the checked state survives greyscale. */}
      <span className="ff-choice__control ff-checkbox__control" aria-hidden="true">
        {indeterminate ? <DashGlyph /> : <CheckGlyph />}
      </span>
      <span>{children}</span>
    </label>
  );
}
