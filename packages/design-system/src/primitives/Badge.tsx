import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';
import type { GlyphProps } from '../lib/glyphs.js';
import { AlertGlyph, CheckGlyph, DangerGlyph, DashGlyph, InfoGlyph } from '../lib/glyphs.js';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'attention' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
  /**
   * Hide the tone glyph. Only for a badge whose text already states the state
   * unambiguously - the glyph exists so the tone is not colour-only (ADR-0013).
   */
  glyphHidden?: boolean;
}

const GLYPHS: Record<BadgeTone, (props: GlyphProps) => ReactNode> = {
  neutral: DashGlyph,
  info: InfoGlyph,
  success: CheckGlyph,
  attention: AlertGlyph,
  danger: DangerGlyph,
};

/**
 * A non-interactive status label. The glyph ships by default rather than as an
 * opt-in: a green badge and an amber badge must still be distinguishable on a
 * sun-washed screen, in greyscale, and with any colour-vision deficiency.
 */
export function Badge({
  tone = 'neutral',
  children,
  glyphHidden = false,
  className,
  ...rest
}: BadgeProps) {
  const Glyph = GLYPHS[tone];
  return (
    <span className={cx('ff-badge', `ff-badge--${tone}`, className)} data-ff-tone={tone} {...rest}>
      {glyphHidden ? null : (
        <span className="ff-badge__glyph">
          <Glyph />
        </span>
      )}
      {children}
    </span>
  );
}
