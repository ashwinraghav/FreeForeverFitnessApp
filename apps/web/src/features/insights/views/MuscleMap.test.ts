import { describe, expect, it } from 'vitest';

import { BOX, FRONT, BACK, offsetFor, SILHOUETTE, type Region, type Shape } from './MuscleMap.js';

/*
 * Geometry, not layout.
 *
 * CLAUDE.md is right that no test here can catch a layout bug — jsdom has no layout
 * engine. But this is not layout: it is two lists of numbers in one declared coordinate
 * space, and whether a rectangle sits inside a body is arithmetic. It went wrong exactly
 * because the ground was a relative-bezier `d` string, which is the one form of this
 * data that cannot be checked without rendering it.
 *
 * What went wrong, measured before the fix: regions spanned x 12–88 centred on 50, the
 * silhouette spanned 11.9–76.1 centred on 44. Every region on the right sat up to twelve
 * units outside the figure.
 */

const boundsOf = (shape: Shape) =>
  shape.kind === 'rect'
    ? { x1: shape.x, y1: shape.y, x2: shape.x + shape.w, y2: shape.y + shape.h }
    : {
        x1: shape.cx - shape.rx,
        y1: shape.cy - shape.ry,
        x2: shape.cx + shape.rx,
        y2: shape.cy + shape.ry,
      };

/**
 * Is this point on the ground?
 *
 * Rounded rectangles are treated as plain rectangles, which over-counts the four
 * corners by at most the corner radius. That is the right direction to be wrong in for
 * a containment check on a schematic figure: it can let a region poke a couple of units
 * into a rounded corner, and it can never claim coverage that is nowhere near.
 */
function covers(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'rect') {
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  }
  const dx = (x - shape.cx) / shape.rx;
  const dy = (y - shape.cy) / shape.ry;
  return dx * dx + dy * dy <= 1;
}

const onBody = (x: number, y: number): boolean => SILHOUETTE.some((s) => covers(s, x, y));

/** A grid of points across a shape, including its edges — corners are what drift. */
function samples(shape: Shape): readonly { x: number; y: number }[] {
  const b = boundsOf(shape);
  const out: { x: number; y: number }[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const x = b.x1 + ((b.x2 - b.x1) * i) / steps;
      const y = b.y1 + ((b.y2 - b.y1) * j) / steps;
      // Only points actually inside the region: an ellipse's bounding-box corners are
      // outside the ellipse and are not the region's problem.
      if (covers(shape, x, y)) out.push({ x, y });
    }
  }
  return out;
}

const everyRegion: readonly { view: string; region: Region }[] = [
  ...FRONT.map((region) => ({ view: 'front', region })),
  ...BACK.map((region) => ({ view: 'back', region })),
];

describe('every muscle sits on the body', () => {
  for (const { view, region } of everyRegion) {
    it(`${view}: ${region.muscle}`, () => {
      for (const shape of region.shapes) {
        const off = samples(shape).filter((p) => !onBody(p.x, p.y));
        // Report where, not just that — a bare boolean here sends you back to a browser.
        expect(
          off.map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`),
          `${region.muscle} pokes outside the silhouette`,
        ).toEqual([]);
      }
    });
  }
});

describe('the figure is symmetric', () => {
  it('is centred on the same line the regions are built on', () => {
    // The old path was centred on 44 while the regions were centred on 50, which is the
    // entire bug in one sentence.
    const xs = SILHOUETTE.map(boundsOf);
    const left = Math.min(...xs.map((b) => b.x1));
    const right = Math.max(...xs.map((b) => b.x2));
    expect((left + right) / 2).toBe(BOX.centreX);
  });

  it('mirrors every shape about the centre line', () => {
    const key = (b: { x1: number; y1: number; x2: number; y2: number }) =>
      `${b.x1.toFixed(2)},${b.y1.toFixed(2)},${b.x2.toFixed(2)},${b.y2.toFixed(2)}`;
    const mirror = (b: { x1: number; y1: number; x2: number; y2: number }) => ({
      x1: 2 * BOX.centreX - b.x2,
      y1: b.y1,
      x2: 2 * BOX.centreX - b.x1,
      y2: b.y2,
    });

    const present = new Set(SILHOUETTE.map((s) => key(boundsOf(s))));
    for (const shape of SILHOUETTE) {
      expect(present.has(key(mirror(boundsOf(shape))))).toBe(true);
    }
  });
});

describe('both views fit the viewBox', () => {
  const bodyBounds = () => {
    const bs = [...SILHOUETTE, ...FRONT.flatMap((r) => r.shapes), ...BACK.flatMap((r) => r.shapes)].map(
      boundsOf,
    );
    return {
      x1: Math.min(...bs.map((b) => b.x1)),
      x2: Math.max(...bs.map((b) => b.x2)),
      y1: Math.min(...bs.map((b) => b.y1)),
      y2: Math.max(...bs.map((b) => b.y2)),
    };
  };

  it('leaves nothing clipped horizontally', () => {
    const b = bodyBounds();
    for (const index of [0, 1]) {
      expect(b.x1 + offsetFor(index)).toBeGreaterThanOrEqual(0);
      expect(b.x2 + offsetFor(index)).toBeLessThanOrEqual(BOX.viewBoxWidth);
    }
  });

  it('leaves nothing clipped vertically, with no scale factor to hide a mismatch', () => {
    const b = bodyBounds();
    expect(b.y1).toBeGreaterThanOrEqual(0);
    expect(b.y2).toBeLessThanOrEqual(BOX.viewBoxHeight);
  });

  it('places the two views symmetrically in the viewBox', () => {
    // The old transform translated by 116 into a 216-wide box, which left the pair
    // sitting slightly left of centre.
    const centres = [0, 1].map((index) => BOX.centreX + offsetFor(index));
    expect(centres[0]).toBe(BOX.viewBoxWidth / 4);
    expect(centres[1]).toBe((BOX.viewBoxWidth / 4) * 3);
  });

  it('does not overlap the two figures', () => {
    const b = bodyBounds();
    expect(b.x2 + offsetFor(0)).toBeLessThan(b.x1 + offsetFor(1));
  });
});
