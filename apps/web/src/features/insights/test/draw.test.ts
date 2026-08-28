import { describe, expect, it } from 'vitest';
import type { Frame } from '../charts/draw';
import { drawColumns, drawLine } from '../charts/draw';
import { RecordingCtx } from './recordingCtx';
import { MAX_BAR_PX } from '../charts/scale';
import { fallbackInk } from '../charts/palette';

/** Canvas output, tested for real. See `recordingCtx.ts` for how. */

const frame = (width = 360, height = 200): Frame => ({
  width,
  height,
  rootFontPx: 16,
  ink: fallbackInk('dark'),
});

describe('drawColumns', () => {
  const spec = {
    values: [1000, 4000, 0, 8000, 6000],
    xLabels: ['1 Jan', '8 Jan', '15 Jan', '22 Jan', '29 Jan'],
    formatValue: (value: number) => String(value),
    labelledBands: [3, 4],
  };

  it('clears before it draws, so a repaint is not a composite', () => {
    const ctx = new RecordingCtx();
    drawColumns(ctx, frame(), spec);
    expect(ctx.calls[0]?.op).toBe('clearRect');
  });

  it('grows every bar from one zero baseline', () => {
    const ctx = new RecordingCtx();
    const layout = drawColumns(ctx, frame(), spec);
    const baselines = layout.bars.map((bar) => bar.y + bar.h);
    for (const baseline of baselines) expect(baseline).toBeCloseTo(baselines[0] ?? 0, 6);
    expect(baselines[0]).toBeCloseTo(layout.plot.bottom, 6);
  });

  it('scales height by value and draws nothing for a zero week', () => {
    const ctx = new RecordingCtx();
    const layout = drawColumns(ctx, frame(), spec);
    expect(layout.bars[2]?.h).toBe(0);
    expect((layout.bars[3]?.h ?? 0) / (layout.bars[1]?.h ?? 1)).toBeCloseTo(2, 5);
    // A zero-height bar emits no mark at all rather than a one-pixel stub.
    expect(ctx.ops('roundRect')).toHaveLength(4);
  });

  it('rounds the data end and leaves the baseline square', () => {
    const ctx = new RecordingCtx();
    drawColumns(ctx, frame(), spec);
    const radii = ctx.ops('roundRect')[0]?.args[4] as number[];
    expect(radii[0]).toBeGreaterThan(0);
    expect(radii[1]).toBe(radii[0]);
    expect(radii[2]).toBe(0);
    expect(radii[3]).toBe(0);
  });

  it('caps bar thickness however wide the container', () => {
    const ctx = new RecordingCtx();
    const layout = drawColumns(ctx, frame(1600, 200), spec);
    for (const bar of layout.bars) expect(bar.w).toBeLessThanOrEqual(MAX_BAR_PX);
  });

  it('direct-labels only the bands it was asked to', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawColumns(ctx, frame(), spec);
    // Direct labels are the ones in primary ink; axis ticks are muted.
    const direct = ctx
      .ops('fillText')
      .filter((call) => call.state.fillStyle === ink.fgPrimary)
      .map((call) => String(call.args[0]));
    expect(direct).toEqual(['8000', '6000']);
    // Never a number on every column.
    expect(direct).not.toContain('1000');
  });

  it('thins x labels rather than overlapping them', () => {
    const many = {
      ...spec,
      values: Array.from({ length: 52 }, (_, i) => i * 100),
      xLabels: Array.from({ length: 52 }, (_, i) => `w${i}`),
      labelledBands: [],
    };
    const ctx = new RecordingCtx();
    drawColumns(ctx, frame(320, 200), many);
    const drawn = ctx.texts().filter((text) => text.startsWith('w'));
    expect(drawn.length).toBeLessThan(52);
    // The last band always keeps its label — "where does this end" is asked first.
    expect(drawn).toContain('w51');
  });

  it('draws gridlines as solid hairlines in the decorative ink', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawColumns(ctx, frame(), spec);
    const gridStrokes = ctx.ops('stroke').filter((call) => call.state.strokeStyle === ink.hairline);
    expect(gridStrokes.length).toBeGreaterThan(1);
    for (const call of gridStrokes) expect(call.state.lineWidth).toBe(1);
    // Half-pixel offsets keep a 1px rule on one device row instead of two.
    for (const move of ctx.ops('moveTo')) expect(Number(move.args[1]) % 1).toBeCloseTo(0.5, 6);
  });

  it('paints the marks in the accent and the text in text ink, never the reverse', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawColumns(ctx, frame(), spec);
    for (const call of ctx.ops('roundRect')) expect(call.state.fillStyle).toBe(ink.accent);
    for (const call of ctx.ops('fillText')) {
      expect([ink.fgMuted, ink.fgPrimary]).toContain(call.state.fillStyle);
    }
  });

  it('survives an empty series', () => {
    const ctx = new RecordingCtx();
    const layout = drawColumns(ctx, frame(), { ...spec, values: [], xLabels: [], labelledBands: [] });
    expect(layout.bars).toEqual([]);
  });
});

describe('drawLine', () => {
  const points = [
    { x: 0, y: 100 },
    { x: 7, y: 102, emphasis: true },
    { x: 21, y: 101 },
    { x: 28, y: 105, emphasis: true },
  ];
  const spec = {
    points,
    xLabels: [{ x: 0, text: '1 Jan' }, { x: 28, text: '29 Jan' }],
    formatValue: (value: number) => String(value),
    labelExtremes: true,
  };

  it('draws a 2px round-joined line', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawLine(ctx, frame(), spec);
    const lineStroke = ctx.ops('stroke').find((call) => call.state.strokeStyle === ink.accent);
    expect(lineStroke?.state.lineWidth).toBe(2);
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineCap).toBe('round');
  });

  it('does not force a measurement axis through zero', () => {
    const ctx = new RecordingCtx();
    const layout = drawLine(ctx, frame(), spec);
    expect(layout.domain.min).toBeGreaterThan(0);
  });

  it('starts a quantity axis at zero when asked', () => {
    const ctx = new RecordingCtx();
    const layout = drawLine(ctx, frame(), { ...spec, zeroBased: true });
    expect(layout.domain.min).toBe(0);
  });

  it('marks records with a diamond, not with a second colour', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawLine(ctx, frame(), spec);
    // A diamond is four lineTo calls after a moveTo, then closePath.
    expect(ctx.ops('closePath').length).toBe(2);
    // Every mark on the series is the one accent colour; the shape carries the rest.
    const markFills = ctx.ops('fill').map((call) => call.state.fillStyle);
    expect(new Set(markFills.filter((fill) => fill !== ink.lineStrong))).toEqual(new Set([ink.accent]));
  });

  it('rings every marker in the surface colour so overlaps stay legible', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawLine(ctx, frame(), spec);
    const rings = ctx.ops('stroke').filter((call) => call.state.strokeStyle === ink.surface);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring.state.lineWidth).toBe(2);
  });

  it('keeps the end markers inside the plot rather than half-clipped', () => {
    const ctx = new RecordingCtx();
    const layout = drawLine(ctx, frame(), spec);
    for (const point of layout.screen) {
      expect(point.x).toBeGreaterThanOrEqual(layout.plot.left);
      expect(point.x).toBeLessThanOrEqual(layout.plot.right);
    }
  });

  it('draws the de-emphasis context series behind the emphasis series', () => {
    const ctx = new RecordingCtx();
    const { ink } = frame();
    drawLine(ctx, frame(), { ...spec, contextPoints: [{ x: 3, y: 99 }, { x: 10, y: 103 }] });
    const firstContext = ctx.calls.findIndex((call) => call.state.fillStyle === ink.lineStrong);
    const firstAccentStroke = ctx.calls.findIndex(
      (call) => call.op === 'stroke' && call.state.strokeStyle === ink.accent,
    );
    expect(firstContext).toBeLessThan(firstAccentStroke);
  });

  it('survives a single point and an empty series', () => {
    const ctx = new RecordingCtx();
    expect(() => drawLine(ctx, frame(), { ...spec, points: [{ x: 0, y: 80 }] })).not.toThrow();
    expect(() => drawLine(ctx, frame(), { ...spec, points: [], xLabels: [] })).not.toThrow();
  });
});
