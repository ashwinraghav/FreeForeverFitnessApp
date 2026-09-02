import type { SVGProps } from 'react';

/**
 * The internal glyph set.
 *
 * ADR-0013: colour never carries meaning on its own, so every semantic state in this
 * package pairs its colour with one of these shapes. They are decorative by default -
 * the surrounding component supplies the accessible name - so they are aria-hidden and
 * take their colour from `currentColor`.
 */
export type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'>;

function Glyph({ path, ...rest }: GlyphProps & { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

export const CheckGlyph = (p: GlyphProps) => <Glyph {...p} path="M4 12.5 9.5 18 20 6" />;
export const MinusGlyph = (p: GlyphProps) => <Glyph {...p} path="M5 12h14" />;
export const PlusGlyph = (p: GlyphProps) => <Glyph {...p} path="M12 5v14M5 12h14" />;
export const ChevronDownGlyph = (p: GlyphProps) => <Glyph {...p} path="M5 9l7 7 7-7" />;
// A clock face reading two o'clock. Hands at 12 and 2 rather than 12 and 3 so the two
// strokes stay distinguishable at 1em on a phone, where a right angle blurs into a corner.
export const TimerGlyph = (p: GlyphProps) => (
  <Glyph {...p} path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2M9 1.5h6" />
);
export const CloseGlyph = (p: GlyphProps) => <Glyph {...p} path="M6 6l12 12M18 6L6 18" />;
export const AlertGlyph = (p: GlyphProps) => (
  <Glyph {...p} path="M12 3 1.5 21h21L12 3zM12 9v5M12 17.5v.01" />
);
export const InfoGlyph = (p: GlyphProps) => (
  <Glyph {...p} path="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM12 11v6M12 7.5v.01" />
);
export const DangerGlyph = (p: GlyphProps) => (
  <Glyph {...p} path="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM8 8l8 8M16 8l-8 8" />
);
export const DashGlyph = (p: GlyphProps) => <Glyph {...p} path="M6 12h12" />;
