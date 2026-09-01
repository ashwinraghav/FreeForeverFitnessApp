/**
 * The app's mark: two plates on a bar, which at small sizes reads as ∞.
 * Dumbbell and "forever" in one shape.
 *
 * Inlined rather than an <img src="/favicon.svg">. It costs no request, it
 * scales without a second asset, and `currentColor` lets it take the accent
 * from whatever it sits in — which matters because the app has a light theme
 * and a fixed-colour file would be wrong in one of them.
 *
 * The geometry is the same as scripts/build-icons.mjs, deliberately duplicated:
 * that script is a build tool that writes PNGs and this is a React component,
 * and coupling them through a shared module would mean the browser bundle
 * importing from a Node build script.
 */
export function Mark({ size = 24, title }: { readonly size?: number; readonly title?: string }) {
  // Same proportions as the icon at inset 0, expressed on a 100-unit grid.
  const c = 50;
  const r = 21.5;
  const ring = 8.5;
  const gap = 11.5;
  const barH = 10;
  const barW = gap * 2 + r * 0.7;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      // Decorative next to a visible wordmark; labelled when it stands alone.
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
    >
      <rect
        x={c - barW / 2}
        y={c - barH / 2}
        width={barW}
        height={barH}
        rx={barH / 2}
        fill="currentColor"
      />
      <circle
        cx={c - gap - r * 0.52}
        cy={c}
        r={r - ring / 2}
        stroke="currentColor"
        strokeWidth={ring}
      />
      <circle
        cx={c + gap + r * 0.52}
        cy={c}
        r={r - ring / 2}
        stroke="currentColor"
        strokeWidth={ring}
      />
    </svg>
  );
}
