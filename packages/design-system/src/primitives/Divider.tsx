import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional text set into the rule. Rendered as a real separator with a name. */
  children?: ReactNode;
}

export function Divider({ children, className, ...rest }: DividerProps) {
  if (children === undefined) {
    return <hr className={cx('ff-divider', className)} {...rest} />;
  }
  return (
    <div role="separator" className={cx('ff-divider--labelled', className)} {...rest}>
      {children}
    </div>
  );
}
