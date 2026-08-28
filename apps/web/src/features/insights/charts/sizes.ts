import { space } from '@freeforever/design-system/tokens';

/**
 * Chart heights, composed from the spacing scale rather than picked.
 *
 * ADR-0021 bans raw px in a style position, and a chart height is exactly that even
 * though it arrives as a number rather than a string. Building them out of `space`
 * keeps every vertical rhythm in the product on one scale, and makes a scale change
 * move the charts with everything else.
 */
export const CHART_HEIGHT = {
  /** The default plot: tall enough to read a trend, short enough to leave room below. */
  standard: space[48] * 4,
  /** Time series that carry an x-axis band and a direct label. */
  tall: space[64] * 4,
} as const;
