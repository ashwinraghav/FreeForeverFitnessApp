import { useEffect, useState } from 'react';
import type { ChartInk } from './palette';
import { fallbackInk, readChartInk } from './palette';

/**
 * Re-resolve chart ink whenever the theme the document is actually showing changes.
 *
 * Both triggers matter, because the palette has three states (ADR-0013). A user
 * flipping the in-app theme changes `data-theme` on the root; a user with no explicit
 * choice changes theme when the OS does, and nothing in the DOM moves at all. Watching
 * only one of them leaves canvas charts painted in the wrong theme's ink until the
 * next unrelated re-render — which, on a screen made of memoised charts, can be never.
 */
export function useChartInk(element: Element | null): ChartInk {
  const [ink, setInk] = useState<ChartInk>(() => fallbackInk());

  useEffect(() => {
    if (element === null) return;
    const resolve = (): void => setInk(readChartInk(element));
    resolve();

    const root = element.ownerDocument.documentElement;
    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

    // Guarded rather than assumed: an old WebView — and jsdom — has no matchMedia,
    // and a chart that throws on mount is a worse failure than one that misses an
    // OS-level theme flip.
    const view = element.ownerDocument.defaultView;
    const media =
      typeof view?.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', resolve);

    return () => {
      observer.disconnect();
      media?.removeEventListener('change', resolve);
    };
  }, [element]);

  return ink;
}

const DEFAULT_ROOT_FONT_PX = 16;

/**
 * The root font size in px.
 *
 * Canvas text does not inherit anything, so a chart drawn at a fixed pixel size is
 * the one part of the app that ignores a 200% text setting. Reading the root size and
 * scaling chart type by it is what keeps the charts inside the same accessibility
 * promise as the rest of the product.
 */
export function useRootFontPx(element: Element | null): number {
  const [size, setSize] = useState(DEFAULT_ROOT_FONT_PX);

  useEffect(() => {
    const view = element?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    const root = view.document.documentElement;
    const resolve = (): void => {
      const parsed = Number.parseFloat(view.getComputedStyle(root).fontSize);
      setSize(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROOT_FONT_PX);
    };
    resolve();
    const observer = new view.ResizeObserver(resolve);
    observer.observe(root);
    return () => observer.disconnect();
  }, [element]);

  return size;
}

