import type { ChartInk } from './palette';
import {
  bandGeometry,
  labelStride,
  labelledIndices,
  linearScale,
  niceDomain,
  SURFACE_GAP_PX,
} from './scale';

/**
 * Draw programs.
 *
 * These take a context and produce marks; they never touch the DOM, never read a
 * clock and never resolve a colour. That is what makes them testable: `test/draw.ts`
 * runs them against a recording fake and asserts the geometry, which is the only way
 * to cover canvas output at all — jsdom's `getContext('2d')` returns null.
 *
 * Canvas rather than SVG for the time-series charts on purpose. Two years of weekly
 * columns plus their gridlines is several hundred nodes per chart, on a phone, on a
 * screen that also has to stay responsive to a thumb; the body map is SVG precisely
 * because it is the opposite case — twenty static shapes that each need a hit target
 * and an accessible name.
 */

/** The subset of `CanvasRenderingContext2D` these programs use. */
export interface Ctx2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect?(x: number, y: number, w: number, h: number, radii: readonly number[]): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface Frame {
  readonly width: number;
  readonly height: number;
  /** Root font size in px, so chart type tracks a 200% text setting like everything else. */
  readonly rootFontPx: number;
  readonly ink: ChartInk;
}

export interface Plot {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

const LABEL_TYPE_PX = 11;
const BODY_SM_TYPE_PX = 14;
const LINE_PX = 2;
const MARKER_RADIUS_PX = 4.5;
const DATA_END_RADIUS_PX = 4;

const scaleType = (frame: Frame, px: number): number => (px * frame.rootFontPx) / 16;
const fontFor = (frame: Frame, px: number, weight = 500): string =>
  `${weight} ${scaleType(frame, px)}px system-ui, sans-serif`;

/**
 * The plot box, sized from the text that has to fit around it.
 *
 * Measured rather than guessed, and the x-axis band is included in the box the
 * caller asked for rather than added below it — a container sized to the plot and
 * not the axis is how a chart card ends up with its own tiny scrollbar.
 */
export function plotBox(
  ctx: Ctx2D,
  frame: Frame,
  yTickLabels: readonly string[],
  hasXAxis: boolean,
): Plot {
  ctx.font = fontFor(frame, LABEL_TYPE_PX);
  const widest = yTickLabels.reduce((max, label) => Math.max(max, ctx.measureText(label).width), 0);
  const gutter = scaleType(frame, 8);
  const left = widest === 0 ? 0 : widest + gutter;
  const top = scaleType(frame, 12);
  const bottom = frame.height - (hasXAxis ? scaleType(frame, 20) : 0);
  return {
    left,
    top,
    right: frame.width,
    bottom,
    width: Math.max(0, frame.width - left),
    height: Math.max(0, bottom - top),
  };
}

function gridAndTicks(
  ctx: Ctx2D,
  frame: Frame,
  plot: Plot,
  ticks: readonly number[],
  y: (value: number) => number,
  format: (value: number) => string,
): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = frame.ink.hairline;
  ctx.fillStyle = frame.ink.fgMuted;
  ctx.font = fontFor(frame, LABEL_TYPE_PX);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of ticks) {
    // Half-pixel offset so a 1px hairline lands on one device row instead of two.
    const row = Math.round(y(tick)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.left, row);
    ctx.lineTo(plot.right, row);
    ctx.stroke();
    ctx.fillText(format(tick), plot.left - scaleType(frame, 8), row);
  }
}

function roundedDataEnd(
  ctx: Ctx2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    // Rounded at the data end, square at the baseline — the bar grows out of the
    // axis rather than floating above it.
    ctx.roundRect(x, y, width, height, [r, r, 0, 0]);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
}

export interface ColumnSpec {
  readonly values: readonly number[];
  readonly xLabels: readonly string[];
  readonly formatValue: (value: number) => string;
  /** Bands that get a direct label. Keep this to one or two — never every column. */
  readonly labelledBands: readonly number[];
  readonly ticks?: number;
}

export interface ColumnLayout {
  readonly plot: Plot;
  readonly bars: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  readonly domain: ReturnType<typeof niceDomain>;
}

/**
 * Columns. One series, one colour, grown from a single zero baseline.
 *
 * Returns its layout so the React host can put invisible hit targets over the bands —
 * a 5px-wide column on a 52-week axis is not a tap target, and the mark is not the
 * hit area.
 */
export function drawColumns(ctx: Ctx2D, frame: Frame, spec: ColumnSpec): ColumnLayout {
  const max = spec.values.reduce((m, v) => Math.max(m, v), 0);
  const domain = niceDomain(0, max, { ticks: spec.ticks ?? 4, zeroBased: true });
  const tickLabels = domain.ticks.map(spec.formatValue);
  const plot = plotBox(ctx, frame, tickLabels, true);

  ctx.clearRect(0, 0, frame.width, frame.height);
  const y = linearScale([domain.min, domain.max], [plot.bottom, plot.top]);
  gridAndTicks(ctx, frame, plot, domain.ticks, y, spec.formatValue);

  const band = bandGeometry(plot.width, spec.values.length);
  const baseline = y(0);
  const bars: ColumnLayout['bars'] = spec.values.map((value, index) => {
    const x = plot.left + index * band.bandWidth + band.offset;
    const top = y(value);
    return { x, y: top, w: band.barWidth, h: Math.max(0, baseline - top) };
  });

  ctx.fillStyle = frame.ink.accent;
  for (const bar of bars) {
    if (bar.h <= 0) continue;
    roundedDataEnd(ctx, bar.x, bar.y, bar.w, bar.h, DATA_END_RADIUS_PX);
  }

  // X labels, thinned until they stop colliding, last band always kept.
  ctx.fillStyle = frame.ink.fgMuted;
  ctx.font = fontFor(frame, LABEL_TYPE_PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const widest = spec.xLabels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const stride = labelStride(spec.values.length, band.bandWidth, widest + scaleType(frame, 8));
  for (const index of labelledIndices(spec.values.length, stride)) {
    const label = spec.xLabels[index];
    if (label === undefined) continue;
    ctx.fillText(
      label,
      plot.left + index * band.bandWidth + band.bandWidth / 2,
      plot.bottom + scaleType(frame, 4),
    );
  }

  // Direct labels ride the caps, in text ink, never in the series colour.
  ctx.fillStyle = frame.ink.fgPrimary;
  ctx.font = fontFor(frame, LABEL_TYPE_PX, 600);
  ctx.textBaseline = 'bottom';
  for (const index of spec.labelledBands) {
    const bar = bars[index];
    const value = spec.values[index];
    if (bar === undefined || value === undefined || bar.h <= 0) continue;
    ctx.fillText(spec.formatValue(value), bar.x + bar.w / 2, bar.y - scaleType(frame, 4));
  }

  return { plot, bars, domain };
}

export interface LinePoint {
  readonly x: number;
  readonly y: number;
  /** Drawn as a diamond instead of a disc. Shape, not colour, carries the meaning. */
  readonly emphasis?: boolean;
}

export interface LineSpec {
  /** The emphasis series, in the accent colour. */
  readonly points: readonly LinePoint[];
  /** Optional context series behind it, in the de-emphasis ink. Dots only, no line. */
  readonly contextPoints?: readonly { readonly x: number; readonly y: number }[];
  readonly xLabels: readonly { readonly x: number; readonly text: string }[];
  readonly formatValue: (value: number) => string;
  readonly zeroBased?: boolean;
  readonly ticks?: number;
  /** Label the last point, and the highest one when it is not the last. */
  readonly labelExtremes?: boolean;
}

export interface LineLayout {
  readonly plot: Plot;
  readonly screen: readonly { readonly x: number; readonly y: number }[];
  readonly domain: ReturnType<typeof niceDomain>;
}

function diamond(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/**
 * A line with markers.
 *
 * The markers carry a ring in the surface colour so they stay readable where they
 * overlap each other or cross the line, and the ring is part of the mark rather than
 * a stroke around it. Records are diamonds. Nothing in this chart is distinguished
 * by colour alone.
 */
export function drawLine(ctx: Ctx2D, frame: Frame, spec: LineSpec): LineLayout {
  const all = [...spec.points.map((p) => p.y), ...(spec.contextPoints ?? []).map((p) => p.y)];
  const min = all.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY);
  const max = all.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);
  const domain = niceDomain(Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 1, {
    ticks: spec.ticks ?? 4,
    zeroBased: spec.zeroBased ?? false,
  });
  const tickLabels = domain.ticks.map(spec.formatValue);
  const plot = plotBox(ctx, frame, tickLabels, spec.xLabels.length > 0);

  ctx.clearRect(0, 0, frame.width, frame.height);
  const y = linearScale([domain.min, domain.max], [plot.bottom, plot.top]);
  gridAndTicks(ctx, frame, plot, domain.ticks, y, spec.formatValue);

  const xs = [...spec.points, ...(spec.contextPoints ?? [])].map((p) => p.x);
  const xMin = xs.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY);
  const xMax = xs.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);
  const inset = MARKER_RADIUS_PX + LINE_PX;
  const x = linearScale(
    [Number.isFinite(xMin) ? xMin : 0, Number.isFinite(xMax) ? xMax : 1],
    [plot.left + inset, plot.right - inset],
  );

  // Context first, so the emphasis series sits on top of it rather than under.
  ctx.fillStyle = frame.ink.lineStrong;
  for (const point of spec.contextPoints ?? []) {
    ctx.beginPath();
    ctx.arc(x(point.x), y(point.y), LINE_PX, 0, Math.PI * 2);
    ctx.fill();
  }

  const screen = spec.points.map((point) => ({ x: x(point.x), y: y(point.y) }));

  ctx.strokeStyle = frame.ink.accent;
  ctx.lineWidth = LINE_PX;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  screen.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (screen.length > 1) ctx.stroke();

  spec.points.forEach((point, index) => {
    const at = screen[index];
    if (at === undefined) return;
    const isEnd = index === screen.length - 1;
    if (point.emphasis !== true && !isEnd && screen.length > 2) return;
    ctx.strokeStyle = frame.ink.surface;
    ctx.lineWidth = SURFACE_GAP_PX;
    ctx.fillStyle = frame.ink.accent;
    if (point.emphasis === true) diamond(ctx, at.x, at.y, MARKER_RADIUS_PX + 1.5);
    else {
      ctx.beginPath();
      ctx.arc(at.x, at.y, MARKER_RADIUS_PX, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = frame.ink.fgMuted;
  ctx.font = fontFor(frame, LABEL_TYPE_PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const label of spec.xLabels) {
    ctx.fillText(label.text, x(label.x), plot.bottom + scaleType(frame, 4));
  }

  if (spec.labelExtremes === true) {
    const last = screen[screen.length - 1];
    const lastValue = spec.points[spec.points.length - 1]?.y;
    if (last !== undefined && lastValue !== undefined) {
      ctx.fillStyle = frame.ink.fgPrimary;
      ctx.font = fontFor(frame, BODY_SM_TYPE_PX, 600);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(spec.formatValue(lastValue), last.x - scaleType(frame, 8), last.y - scaleType(frame, 8));
    }
  }

  return { plot, screen, domain };
}
