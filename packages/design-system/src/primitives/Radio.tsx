import type { InputHTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';
import { CheckGlyph } from '../lib/glyphs.js';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children: ReactNode;
  /** Radios only mean anything in a group - the shared name is required. */
  name: string;
}

export function Radio({ children, className, disabled, ...rest }: RadioProps) {
  return (
    <label className={cx('ff-choice', disabled && 'ff-choice--disabled', className)}>
      <input type="radio" className="ff-visually-hidden" disabled={disabled ?? false} {...rest} />
      <span className="ff-choice__control ff-radio__control" aria-hidden="true">
        <CheckGlyph />
      </span>
      <span>{children}</span>
    </label>
  );
}
