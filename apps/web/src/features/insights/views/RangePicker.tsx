import { SegmentedControl } from '@freeforever/design-system';

export const RANGE_WEEKS = { '8w': 8, '12w': 12, '26w': 26, '52w': 52 } as const;
export type RangeKey = keyof typeof RANGE_WEEKS;
export const DEFAULT_RANGE: RangeKey = '12w';

export function isRangeKey(value: string): value is RangeKey {
  return Object.hasOwn(RANGE_WEEKS, value);
}

/**
 * One range control for the whole screen, above every card it scopes.
 *
 * Deliberately not per-chart. Two charts on one screen showing two different windows
 * is a reading error waiting to happen, and a filter inside a card is one the reader
 * does not know applies to only that card.
 */
export function RangePicker({
  value,
  onChange,
}: {
  readonly value: RangeKey;
  readonly onChange: (value: RangeKey) => void;
}) {
  return (
    <SegmentedControl
      label="Time range"
      value={value}
      onValueChange={(next) => {
        if (isRangeKey(next)) onChange(next);
      }}
      options={[
        { value: '8w', label: '8w' },
        { value: '12w', label: '12w' },
        { value: '26w', label: '26w' },
        { value: '52w', label: '52w' },
      ]}
    />
  );
}
