import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';

import { cx } from '../lib/cx.js';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  /** Present means invalid. Wired to aria-invalid and announced via role="alert". */
  error?: string;
}

export function TextField({
  label,
  labelHidden = false,
  hint,
  error,
  className,
  id,
  type = 'text',
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = cx(hint ? hintId : '', error ? errorId : '').trim() || undefined;

  return (
    <div className={cx('ff-field', className)}>
      <label className={cx('ff-field__label', labelHidden && 'ff-visually-hidden')} htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        className="ff-input ff-focusable"
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint ? (
        <span className="ff-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ff-field__error" id={errorId} role="alert">
          {/* Error state is never colour alone (ADR-0013). */}
          <span aria-hidden="true">!</span>
          {error}
        </span>
      ) : null}
    </div>
  );
}
