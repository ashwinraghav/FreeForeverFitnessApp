/**
 * @freeforever/design-system
 *
 * Tokens and primitives for TheFreeForeverFitnessApp.
 *
 * Consuming app, once, at the root:
 *
 *   import "@freeforever/design-system/tokens.css";
 *   import "@freeforever/design-system/styles.css";
 *
 * Then import primitives from the package root. Do not write hex colours, raw px
 * spacing or duration literals in your own code - the shared ESLint rule at
 * `@freeforever/design-system/eslint` fails the build on them (ADR-0021). If you
 * need a value that does not exist, add a token here rather than an exception there.
 */

export { Avatar, initialsFor } from './primitives/Avatar.js';
export type { AvatarProps, AvatarSize } from './primitives/Avatar.js';

export { Badge } from './primitives/Badge.js';
export type { BadgeProps, BadgeTone } from './primitives/Badge.js';

export { Button } from './primitives/Button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './primitives/Button.js';

export { Checkbox } from './primitives/Checkbox.js';
export type { CheckboxProps } from './primitives/Checkbox.js';

export { Chip } from './primitives/Chip.js';
export type { ChipProps } from './primitives/Chip.js';

export { Dialog } from './primitives/Dialog.js';
export type { DialogProps } from './primitives/Dialog.js';

export { Divider } from './primitives/Divider.js';
export type { DividerProps } from './primitives/Divider.js';

export { EmptyState } from './primitives/EmptyState.js';
export type { EmptyStateProps } from './primitives/EmptyState.js';

export { IconButton } from './primitives/IconButton.js';
export type { IconButtonProps } from './primitives/IconButton.js';

export { List, ListItem } from './primitives/List.js';
export type { ListItemProps, ListProps } from './primitives/List.js';

export { Meter } from './primitives/Meter.js';
export type { MeterProps } from './primitives/Meter.js';

export { NumberField } from './primitives/NumberField.js';
export type { NumberFieldProps } from './primitives/NumberField.js';

export { ProgressBar } from './primitives/ProgressBar.js';
export type { ProgressBarProps } from './primitives/ProgressBar.js';

export { Radio } from './primitives/Radio.js';
export type { RadioProps } from './primitives/Radio.js';

export { SegmentedControl } from './primitives/SegmentedControl.js';
export type { SegmentedControlProps, SegmentOption } from './primitives/SegmentedControl.js';

export { Select } from './primitives/Select.js';
export type { SelectProps } from './primitives/Select.js';

export { Sheet } from './primitives/Sheet.js';
export type { SheetProps } from './primitives/Sheet.js';

export { Skeleton } from './primitives/Skeleton.js';
export type { SkeletonProps } from './primitives/Skeleton.js';

export { Tabs } from './primitives/Tabs.js';
export type { TabItem, TabsProps } from './primitives/Tabs.js';

export { TextField } from './primitives/TextField.js';
export type { TextFieldProps } from './primitives/TextField.js';

export { Toast, ToastRegion } from './primitives/Toast.js';
export type { ToastProps, ToastRegionProps, ToastTone } from './primitives/Toast.js';

export { Toggle } from './primitives/Toggle.js';
export type { ToggleProps } from './primitives/Toggle.js';

/* Glyphs - the internal shape set. Exported so feature teams pair a state with a
   shape rather than reaching for an icon library and a raw colour. */
export {
  AlertGlyph,
  CheckGlyph,
  ChevronDownGlyph,
  CloseGlyph,
  DangerGlyph,
  DashGlyph,
  InfoGlyph,
  MinusGlyph,
  PlusGlyph,
} from './lib/glyphs.js';
export type { GlyphProps } from './lib/glyphs.js';

/* Helpers */
export { cx } from './lib/cx.js';
export type { AccessibleName, NamedProps } from './lib/a11y.js';
export { contrastRatio, relativeLuminance } from './lib/contrast.js';
