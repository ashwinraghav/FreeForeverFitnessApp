import { describe, expect, it } from 'vitest';
import {
  MAX_BAR_PX,
  SURFACE_GAP_PX,
  bandGeometry,
  labelStride,
  labelledIndices,
  linearScale,
  niceDomain,
} from '../charts/scale';

describe('linearScale', () => {
  it('maps the domain onto an inverted screen range', () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });

  it('centres a zero-width domain rather than dividing by zero', () => {
    const y = linearScale([5, 5], [100, 0]);
    expect(y(5)).toBe(50);
    expect(Number.isNaN(y(5))).toBe(false);
  });
});

describe('niceDomain', () => {
  it('starts a quantity axis at zero', () => {
    const domain = niceDomain(1200, 9400);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThanOrEqual(9400);
    expect(domain.ticks[0]).toBe(0);
  });

  it('does not force zero onto a measurement axis', () => {
    const domain = niceDomain(82.1, 86.4, { zeroBased: false });
    expect(domain.min).toBeGreaterThan(0);
    expect(domain.min).toBeLessThanOrEqual(82.1);
    expect(domain.max).toBeGreaterThanOrEqual(86.4);
  });

  it('emits clean ticks with no floating-point dust', () => {
    const domain = niceDomain(0, 10, { ticks: 4 });
    for (const tick of domain.ticks) {
      expect(String(tick)).not.toMatch(/\d{8,}/);
    }
    expect(domain.ticks).toContain(domain.min);
    expect(domain.ticks[domain.ticks.length - 1]).toBe(domain.max);
  });

  it('gives a flat series a plot with height', () => {
    const domain = niceDomain(80, 80, { zeroBased: false });
    expect(domain.max).toBeGreaterThan(domain.min);
  });

  it('survives an empty or non-finite series', () => {
    expect(niceDomain(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY).ticks.length).toBe(2);
  });
});

describe('bandGeometry', () => {
  it('caps a bar at the mark-spec maximum however wide the band', () => {
    const band = bandGeometry(1200, 4);
    expect(band.barWidth).toBe(MAX_BAR_PX);
    expect(band.offset).toBeGreaterThan(0);
  });

  it('keeps a surface gap of the mark-spec width between touching bars', () => {
    // 18px bands: below the 24px cap, so the leftover is exactly the surface gap.
    const band = bandGeometry(360, 20);
    expect(band.bandWidth - band.barWidth).toBeCloseTo(SURFACE_GAP_PX, 5);
  });

  it('leaves the extra as air, not as a wider bar, once the cap binds', () => {
    const band = bandGeometry(360, 12);
    expect(band.barWidth).toBe(MAX_BAR_PX);
    expect(band.bandWidth - band.barWidth).toBeGreaterThan(SURFACE_GAP_PX);
  });

  it('drops the gap rather than the bar when a year of weeks is on a phone', () => {
    const band = bandGeometry(320, 52);
    expect(band.barWidth).toBeGreaterThanOrEqual(1);
    expect(band.barWidth).toBeLessThanOrEqual(band.bandWidth);
  });

  it('is inert on an unmeasured container', () => {
    expect(bandGeometry(0, 10)).toEqual({ bandWidth: 0, barWidth: 0, offset: 0 });
  });
});

describe('axis labels', () => {
  it('thins labels until they fit', () => {
    expect(labelStride(52, 6, 30)).toBe(5);
    expect(labelStride(8, 40, 30)).toBe(1);
  });

  it('always labels the last band and never runs off the start', () => {
    const indices = labelledIndices(10, 4);
    expect(indices[indices.length - 1]).toBe(9);
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
    expect([...indices].sort((a, b) => a - b)).toEqual([...indices]);
  });
});
