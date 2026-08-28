import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Ctx2D, Frame } from './draw';
import { useChartInk, useRootFontPx } from './useTheme';

/**
 * What a draw program hands back so the chart can be read one point at a time.
 *
 * `x` is in CSS pixels within the canvas, which is what the host needs to hit-test
 * and to place the cursor rule. `readout` is the sentence a person hears or reads —
 * built by the caller, because only the caller knows the units.
 */
export interface CursorTarget {
  readonly x: number;
  readonly readout: string;
}

export interface ChartCursor {
  readonly targets: readonly CursorTarget[];
  readonly plotTop: number;
  readonly plotBottom: number;
}

export interface CanvasChartProps {
  /**
   * The whole drawing, as one function of the frame, optionally returning the points
   * a reader can step through. Called on mount, on resize, on a theme change and on a
   * text-size change — and nowhere else. Keep it referentially stable (`useCallback`)
   * or the chart repaints on every parent render.
   */
  readonly draw: (ctx: Ctx2D, frame: Frame) => ChartCursor | void;
  readonly height: number;
  /** Sentence describing the chart for a screen reader. The table view carries the values. */
  readonly label: string;
}

/**
 * A device-pixel-ratio-correct canvas host, with the selection layer.
 *
 * **Why a snap-to-nearest cursor and not a hover tooltip.** Hover does not exist on
 * the device this product is used on, and a tooltip that follows a thumb is under the
 * thumb. So: tapping anywhere in the plot selects the nearest point — the whole plot
 * height is the target, which makes a 5px-wide column on a year-long axis genuinely
 * hittable — and the value appears in a fixed readout line beneath the chart rather
 * than in a floating box. Arrow keys step the same selection, so the chart is fully
 * keyboard-operable, and the readout is a live region, so it is fully audible.
 *
 * The values are never gated behind it. Every chart also ships direct labels, an axis
 * and a table twin; the cursor is a convenience on top of three other ways to read
 * the same number.
 *
 * The canvas itself is `aria-hidden`: pixels are not an accessible representation of
 * anything.
 */
export function CanvasChart({ draw, height, label }: CanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<ChartCursor | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const ink = useChartInk(host);
  const rootFontPx = useRootFontPx(host);

  useEffect(() => {
    if (host === null) return;
    const view = host.ownerDocument.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') return;
    const observer = new view.ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(host);
    setWidth(host.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [host]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || width <= 0 || height <= 0) return;
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    // jsdom has no 2D context, and a browser can refuse one under memory pressure.
    // A chart that cannot draw renders as an empty box beside a full table, not a crash.
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setCursor(draw(ctx as unknown as Ctx2D, { width, height, rootFontPx, ink }) ?? null);
  }, [draw, width, height, rootFontPx, ink]);

  useEffect(paint, [paint]);

  const targets = cursor?.targets ?? [];
  // A resize or a new range can shrink the series under a selection that was valid.
  const index = selected === null ? null : Math.min(selected, targets.length - 1);
  const active = index === null || index < 0 ? null : (targets[index] ?? null);

  const selectNearest = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (canvas === null || targets.length === 0) return;
      const offset = clientX - canvas.getBoundingClientRect().left;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      targets.forEach((target, at) => {
        const distance = Math.abs(target.x - offset);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = at;
        }
      });
      setSelected(best);
    },
    [targets],
  );

  const step = useCallback(
    (delta: number) => {
      if (targets.length === 0) return;
      setSelected((current) => {
        const from = current ?? targets.length - 1;
        return Math.min(targets.length - 1, Math.max(0, from + delta));
      });
    },
    [targets.length],
  );

  const rule = useMemo(() => {
    if (active === null || cursor === null) return null;
    return {
      insetInlineStart: `${(active.x / Math.max(1, width)) * 100}%`,
      insetBlockStart: `${(cursor.plotTop / Math.max(1, height)) * 100}%`,
      blockSize: `${((cursor.plotBottom - cursor.plotTop) / Math.max(1, height)) * 100}%`,
    };
  }, [active, cursor, width, height]);

  const interactive = targets.length > 0;

  return (
    <>
      <div
        className={interactive ? 'ff-in-canvas ff-focusable' : 'ff-in-canvas'}
        ref={setHost}
        style={{ blockSize: `${height / rootFontPx}rem` }}
        {...(interactive
          ? {
              tabIndex: 0,
              role: 'group',
              'aria-label': `${label} Use the arrow keys to read each point.`,
              onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                selectNearest(event.clientX);
              },
              onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
                // Only while a finger is down: a drag across the plot scrubs it.
                if (event.buttons !== 0) selectNearest(event.clientX);
              },
              onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  step(event.key === 'ArrowLeft' ? -1 : 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setSelected(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setSelected(targets.length - 1);
                } else if (event.key === 'Escape') {
                  setSelected(null);
                }
              },
            }
          : {})}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ inlineSize: '100%', blockSize: '100%', display: 'block' }}
        />
        {rule !== null && <span className="ff-in-cursor" style={rule} aria-hidden="true" />}
        {!interactive && <span className="ff-visually-hidden">{label}</span>}
      </div>
      {interactive && (
        <p className="ff-in-readout" aria-live="polite">
          {active?.readout ?? 'Tap the chart, or press an arrow key, to read a point.'}
        </p>
      )}
    </>
  );
}
