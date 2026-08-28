import type { ReactNode } from 'react';

export interface StatTileProps {
  readonly label: string;
  readonly value: string;
  /** A signed change against a named period. Omitted when there is nothing honest to compare. */
  readonly delta?: { readonly text: string; readonly direction: 'up' | 'down' | 'flat' } | undefined;
  readonly detail?: string | undefined;
  readonly children?: ReactNode;
}

const ARROWS = { up: '↑', down: '↓', flat: '→' } as const;

/**
 * One number, read at a glance.
 *
 * The delta is a signed number with an arrow *glyph* and never a colour: this app
 * does not know which direction the user wants any of these numbers to move. Volume
 * down is a deload, bodyweight down is a cut or a bad week, and painting either green
 * or red is the app inventing an opinion it has no basis for. The arrow states the
 * direction; the reader supplies the meaning.
 *
 * The value uses proportional figures rather than the app-wide `tabular-nums`, which
 * is for columns of numbers that must align — at display size, equal-width digits
 * make a three-digit number look loose.
 */
export function StatTile({ label, value, delta, detail, children }: StatTileProps) {
  return (
    <div className="ff-in-tile">
      <span className="ff-in-tile__label">{label}</span>
      <span className="ff-in-tile__value">{value}</span>
      {delta !== undefined && (
        <span className="ff-in-tile__delta">
          <span aria-hidden="true">{ARROWS[delta.direction]}</span> {delta.text}
        </span>
      )}
      {detail !== undefined && <span className="ff-in-tile__detail">{detail}</span>}
      {children}
    </div>
  );
}
