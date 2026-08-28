/**
 * An accessible name that cannot be omitted.
 *
 * Spreading this into a control's props makes the type check fail unless exactly one
 * of `aria-label` or `aria-labelledby` is supplied. This is the mechanism behind the
 * "every icon-only control has a name" rule: it is not a lint warning or a review
 * comment, it is a compile error (ADR-0013).
 *
 *   <IconButton icon={<Plus />} />                       // Type error.
 *   <IconButton icon={<Plus />} aria-label="Add set" />  // Fine.
 */
export type AccessibleName =
  | { 'aria-label': string; 'aria-labelledby'?: undefined }
  | { 'aria-labelledby': string; 'aria-label'?: undefined };

/** Props an icon-only control must not declare itself - they come from AccessibleName. */
export type NamedProps<T> = Omit<T, 'aria-label' | 'aria-labelledby' | 'children'> &
  AccessibleName;

let counter = 0;

/**
 * Stable-enough id for wiring `aria-describedby` when the caller supplies none.
 * Prefer React's `useId`; this exists for the few places a hook cannot be called.
 */
export function nextId(prefix: string): string {
  counter += 1;
  return `ff-${prefix}-${counter}`;
}
