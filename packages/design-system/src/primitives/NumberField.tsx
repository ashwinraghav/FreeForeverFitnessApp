import type { InputHTMLAttributes } from 'react';
import { useId, useRef, useState } from 'react';

import { cx } from '../lib/cx.js';
import { MinusGlyph, PlusGlyph } from '../lib/glyphs.js';
import { IconButton } from './IconButton.js';

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode' | 'size'
>;

export interface NumberFieldProps extends NativeProps {
  label: string;
  /** Hide the label visually. It stays in the accessibility tree. */
  labelHidden?: boolean;
  /**
   * The entered value, or `null` when nothing has been entered this session.
   * `null` is not zero: an empty set and a set of 0 reps are different facts.
   */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /**
   * The carried-over suggestion from last session, shown when `value` is null.
   * Rendered as a ghost: muted, lighter weight and dashed-underlined, so it is
   * distinguishable from an entered value in bad light and in greyscale.
   */
  ghostValue?: number | null;
  /** Unit shown beside the number - "kg", "reps", "s". */
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  error?: string;
  /** Accessible name for the decrement control. Defaults to "Decrease {label}". */
  decrementLabel?: string;
  incrementLabel?: string;
}

const clamp = (n: number, min: number | undefined, max: number | undefined): number => {
  let out = n;
  if (typeof min === 'number' && out < min) out = min;
  if (typeof max === 'number' && out > max) out = max;
  return out;
};

/**
 * The most important control in the product.
 *
 * Three things it must get right:
 *  1. `inputMode="decimal"` - a generic keyboard mid-set costs a whole extra tap and
 *     covers the screen. There is no prop to turn this off.
 *  2. A ghost value (last session's number) that is visibly not an entered value.
 *  3. Stepper buttons at the mid-set hit size, because typing while holding a
 *     dumbbell is not realistic.
 */
export function NumberField({
  label,
  labelHidden = false,
  value,
  onValueChange,
  ghostValue = null,
  unit,
  step = 1,
  min,
  max,
  hint,
  error,
  decrementLabel,
  incrementLabel,
  className,
  disabled,
  id,
  ...rest
}: NumberFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const unitId = `${inputId}-unit`;
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * What the user has literally typed, while they are typing it.
   *
   * Without this, a controlled numeric input cannot accept an intermediate state: type
   * "2," and the parsed value (2) is written straight back over the comma, so the
   * decimal separator can never be entered. The draft holds the raw string until blur;
   * the parsed number is still emitted on every keystroke, so the caller stays current.
   */
  const [draft, setDraft] = useState<string | null>(null);

  const editing = draft !== null;
  const showingGhost = !editing && value === null && ghostValue !== null;
  const committed = value !== null ? value : showingGhost ? ghostValue : null;
  const displayed = editing ? draft : committed === null ? '' : String(committed);

  // The unit is described, not labelled: "Weight, kilograms, edit text" reads correctly,
  // whereas folding it into the label gives "Weight kg" on every announcement.
  const describedBy =
    cx(unit ? unitId : '', hint ? hintId : '', error ? errorId : '').trim() || undefined;

  const nudge = (direction: 1 | -1) => {
    // Stepping from a ghost commits the ghost first, then moves. Tapping "+" on a
    // carried-over 60kg should give 62.5kg, not 2.5kg.
    const base = value ?? ghostValue ?? 0;
    setDraft(null);
    onValueChange(clamp(Number((base + direction * step).toFixed(4)), min, max));
    inputRef.current?.focus();
  };

  return (
    <div className={cx('ff-field', className)}>
      <label className={cx('ff-field__label', labelHidden && 'ff-visually-hidden')} htmlFor={inputId}>
        {label}
      </label>

      <div className="ff-number">
        <IconButton
          className="ff-number__step"
          icon={<MinusGlyph />}
          aria-label={decrementLabel ?? `Decrease ${label}`}
          variant="secondary"
          size="xl"
          onClick={() => nudge(-1)}
          disabled={disabled ?? false}
        />

        <div className="ff-number__well">
          <input
            ref={inputRef}
            id={inputId}
            className="ff-number__input"
            // Never a generic keyboard. This is not configurable.
            inputMode="decimal"
            type="text"
            // `text` + a decimal inputMode rather than type="number": type="number"
            // silently discards invalid input and its spinners are far below 48px.
            autoComplete="off"
            enterKeyHint="done"
            value={displayed}
            data-ff-ghost={showingGhost ? 'true' : 'false'}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            disabled={disabled ?? false}
            onChange={(event) => {
              const raw = event.target.value;
              setDraft(raw);
              const trimmed = raw.trim();
              if (trimmed === '') {
                onValueChange(null);
                return;
              }
              // Accept a comma decimal separator - most of the world types one.
              const parsed = Number(trimmed.replace(',', '.'));
              if (Number.isFinite(parsed)) onValueChange(parsed);
            }}
            onBlur={() => {
              // Drop the draft so the field re-renders in canonical form, and clamp.
              setDraft(null);
              if (value !== null) onValueChange(clamp(value, min, max));
            }}
            {...rest}
          />
          {unit ? (
            <span className="ff-number__unit" id={unitId}>
              {unit}
            </span>
          ) : null}
        </div>

        <IconButton
          className="ff-number__step"
          icon={<PlusGlyph />}
          aria-label={incrementLabel ?? `Increase ${label}`}
          variant="secondary"
          size="xl"
          onClick={() => nudge(1)}
          disabled={disabled ?? false}
        />
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
