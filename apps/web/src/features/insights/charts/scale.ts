/**
 * Scales and ticks.
 *
 * Pure arithmetic, deliberately separate from anything that can draw, so the geometry
 * of every chart in this feature is unit-testable without a canvas — which matters
 * because jsdom has no 2D context, and a chart whose maths is only ever exercised in
 * a browser is a chart whose maths is not exercised.
 */

export interface LinearScale {
  readonly domainMin: number;
  readonly domainMax: number;
  readonly rangeMin: number;
  readonly rangeMax: number;
  (value: number): number;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  // A zero-width domain centres rather than dividing by zero: a flat series is a
  // real thing that happens in week one, and NaN coordinates blank the whole canvas.
  const map = (value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0);
  return Object.assign(map, {
    domainMin: d0,
    domainMax: d1,
    rangeMin: r0,
    rangeMax: r1,
  });
}

/** 1, 2, 2.5 or 5 times a power of ten — the steps a reader can do arithmetic on. */
function niceStep(rough: number): number {
  if (rough <= 0 || !Number.isFinite(rough)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface NiceDomain {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

/**
 * A rounded domain and its ticks.
 *
 * `zeroBased` is the honest default for anything that is a quantity — volume, sets,
 * sessions. A bar chart whose axis starts at 8,000 exaggerates every difference on
 * it, which is the oldest chart lie there is. Measurements that are not quantities
 * (bodyweight, a 1RM estimate) pass `zeroBased: false`, because a bodyweight axis
 * from zero compresses the entire signal into the top two percent of the plot.
 */
export function niceDomain(
  min: number,
  max: number,
  options: { readonly ticks?: number; readonly zeroBased?: boolean } = {},
): NiceDomain {
  const targetTicks = Math.max(2, options.ticks ?? 4);
  const zeroBased = options.zeroBased ?? true;

  let lo = zeroBased ? Math.min(0, min) : min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };

  if (hi === lo) {
    // A flat series still needs a plot with height. Pad it symmetrically rather than
    // letting the line sit exactly on an edge where it is half-clipped.
    const pad = Math.abs(hi) === 0 ? 1 : Math.abs(hi) * 0.1;
    hi += pad;
    if (!zeroBased) lo -= pad;
  }

  const step = niceStep((hi - lo) / targetTicks);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Accumulate by index rather than by repeated addition so a fractional step
  // (2.5, 0.25) does not drift and emit 7.499999999999999 as a tick label.
  const count = Math.round((niceHi - niceLo) / step);
  for (let i = 0; i <= count; i += 1) ticks.push(Number((niceLo + i * step).toPrecision(12)));

  return { min: niceLo, max: niceHi, step, ticks };
}

/**
 * Bar geometry for a banded axis.
 *
 * Two rules from the mark spec, both of which stop a chart reading as loud: a bar is
 * capped at 24px however much room the band has, and touching bars are separated by
 * a 2px gap in the surface colour rather than by a stroke. Below the point where the
 * gap would eat the bar, the gap yields — a 1px sliver of bar with a 2px gap either
 * side is not a chart, and a year of weekly columns on a phone gets there fast.
 */
export interface BandGeometry {
  readonly bandWidth: number;
  readonly barWidth: number;
  readonly offset: number;
}

export const MAX_BAR_PX = 24;
export const SURFACE_GAP_PX = 2;

export function bandGeometry(plotWidth: number, count: number): BandGeometry {
  if (count <= 0 || plotWidth <= 0) return { bandWidth: 0, barWidth: 0, offset: 0 };
  const bandWidth = plotWidth / count;
  const gap = bandWidth > SURFACE_GAP_PX * 3 ? SURFACE_GAP_PX : 0;
  const barWidth = Math.max(1, Math.min(MAX_BAR_PX, bandWidth - gap));
  return { bandWidth, barWidth, offset: (bandWidth - barWidth) / 2 };
}

/**
 * Which band indices get an x-axis label.
 *
 * Every seventh week label on a 52-week axis is unreadable overlap, so labels thin
 * out until they fit, and the last band is always labelled because "where does this
 * end" is the first thing anyone asks of a time axis.
 */
export function labelStride(count: number, bandWidth: number, minLabelPx: number): number {
  if (count <= 0 || bandWidth <= 0) return 1;
  return Math.max(1, Math.ceil(minLabelPx / bandWidth));
}

export function labelledIndices(count: number, stride: number): readonly number[] {
  const indices: number[] = [];
  for (let i = count - 1; i >= 0; i -= stride) indices.push(i);
  return indices.reverse();
}
