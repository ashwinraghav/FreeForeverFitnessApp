import type { ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';

import { cx } from '../lib/cx.js';
import { ChevronDownGlyph } from '../lib/glyphs.js';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/**
 * A native `<select>`, deliberately. A custom listbox is more work, more bugs, and
 * worse with one thumb than the platform picker the user already knows.
 */
export function Select({
  label,
  labelHidden = false,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = cx(hint ? hintId : '', error ? errorId : '').trim() || undefined;

  return (
    <div className={cx('ff-field', className)}>
      <label className={cx('ff-field__label', labelHidden && 'ff-visually-hidden')} htmlFor={selectId}>
        {label}
      </label>
      <div className="ff-select-wrap">
        <select
          id={selectId}
          className="ff-input ff-select ff-focusable"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {children}
        </select>
        <span className="ff-select-wrap__chevron">
          <ChevronDownGlyph />
        </span>
      </div>
      {hint ? (
        <span className="ff-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ff-field__error" id={errorId} role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </span>
      ) : null}
    </div>
  );
}
