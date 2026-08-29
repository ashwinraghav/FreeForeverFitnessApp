import type { ReactNode } from 'react';

export interface HeroFigureProps {
  readonly label: string;
  readonly value: string;
  /** Set a size down beside the number, so the two never break apart. */
  readonly unit?: string | undefined;
  /** A signed change against a named period. Omitted when there is nothing honest to compare. */
  readonly delta?: { readonly text: string; readonly direction: 'up' | 'down' | 'flat' } | undefined;
  readonly detail?: string | undefined;
}

const ARROWS = { up: '↑', down: '↓', flat: '→' } as const;

/**
 * The one number a screen leads with. Exactly one per view.
 *
 * This replaced a row of four equal stat tiles, and the reason is not only that four
 * display-size figures do not fit across 412px — they did not, and "0 kg" wrapped so
 * that "kg" sat on its own line. It is that three of the four were context for the
 * fourth. CLAUDE.md asks for one number per glance and ADR-0013 says the reader is
 * out of breath holding a weight; a KPI row of equal-weight figures makes them decide
 * which one matters, every time, in bad light. The supporting numbers are facts, not
 * headlines, and they read better as a line of text (see {@link FactRow}).
 *
 * The delta wears an arrow **glyph** and no colour. This app does not know which way
 * the user wants any of these numbers to move: volume down is a deload, bodyweight
 * down is a cut or a bad week. Green and red would be the app inventing an opinion.
 *
 * Proportional figures, not the app-wide `tabular-nums`: equal-width digits make a
 * three-digit number look loose at display size. Tabular is for columns that align.
 *
 * The unit is a size down and glued to the number. Measured at 412px: set at the same
 * size, "2,204.6 lb" overflows its box at a 200% text setting; split, it fits with
 * room to spare, and the type reads better for it.
 */
export function HeroFigure({ label, value, unit, delta, detail }: HeroFigureProps) {
  return (
    <div className="ff-in-hero">
      <span className="ff-in-hero__label">{label}</span>
      <span className="ff-in-hero__value">
        {value}
        {unit !== undefined && <span className="ff-in-hero__unit"> {unit}</span>}
      </span>
      {(delta !== undefined || detail !== undefined) && (
        <span className="ff-in-hero__meta">
          {delta !== undefined && (
            <>
              <span aria-hidden="true">{ARROWS[delta.direction]}</span> {delta.text}
            </>
          )}
          {delta !== undefined && detail !== undefined && ' · '}
          {detail}
        </span>
      )}
    </div>
  );
}

export interface Fact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Set a size down beside the number, so the two never break apart. */
  readonly unit?: string | undefined;
}

/**
 * The supporting numbers, as a definition list rather than as more figures.
 *
 * A real `<dl>`, so each value is announced with the thing it measures instead of as
 * a loose number. It wraps naturally at any width and at any text size, which is what
 * a fixed grid of tiles could not do — and it costs about a fifth of the vertical
 * space the tiles did, on the screen where vertical space runs out first.
 */
export function FactRow({ facts, label }: { readonly facts: readonly Fact[]; readonly label: string }) {
  if (facts.length === 0) return null;
  return (
    <dl className="ff-in-facts" aria-label={label}>
      {facts.map((fact) => (
        <div key={fact.key} className="ff-in-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Wraps a hero and its facts so a view does not have to know the spacing. */
export function Headline({ children }: { readonly children: ReactNode }) {
  return <div className="ff-in-headline">{children}</div>;
}
