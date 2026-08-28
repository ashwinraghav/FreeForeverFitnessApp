import type { ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export interface EmptyStateProps {
  title: string;
  /** One sentence. This is the one place in the app a short paragraph is allowed. */
  body?: string;
  /** A decorative glyph. Never the only thing that explains the state. */
  glyph?: ReactNode;
  /** The single next action. One, not three. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, glyph, action, className }: EmptyStateProps) {
  return (
    <div className={cx('ff-empty', className)}>
      {glyph ? (
        <span className="ff-empty__glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <h2 className="ff-empty__title">{title}</h2>
      {body ? <p className="ff-empty__body">{body}</p> : null}
      {action}
    </div>
  );
}
