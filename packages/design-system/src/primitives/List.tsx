import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { cx } from '../lib/cx.js';

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  children: ReactNode;
  /** Names the list. Required when the list is not already under a heading. */
  label?: string;
}

export function List({ children, label, className, ...rest }: ListProps) {
  return (
    <ul className={cx('ff-list', className)} aria-label={label} {...rest}>
      {children}
    </ul>
  );
}

export interface ListItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'onClick'> {
  children: ReactNode;
  /** Leading slot - an Avatar, a glyph, a set number. */
  leading?: ReactNode;
  /** Trailing slot - a Badge, a chevron, a value. */
  trailing?: ReactNode;
  /** Makes the whole row a button. Rows are 48px tall either way. */
  onActivate?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  /** Required when `onActivate` is set and the row's text is not self-describing. */
  activateLabel?: string;
}

export function ListItem({
  children,
  leading,
  trailing,
  onActivate,
  activateLabel,
  className,
  ...rest
}: ListItemProps) {
  const inner = (
    <>
      {leading ? <span aria-hidden="true">{leading}</span> : null}
      <span className="ff-list__primary">{children}</span>
      {trailing ? <span className="ff-list__secondary">{trailing}</span> : null}
    </>
  );

  if (!onActivate) {
    return (
      <li className={cx('ff-list__item', className)} {...rest}>
        {inner}
      </li>
    );
  }

  return (
    <li className={cx(className)} {...rest}>
      <button
        type="button"
        className="ff-control ff-focusable ff-list__item ff-list__button"
        aria-label={activateLabel}
        onClick={onActivate}
      >
        {inner}
      </button>
    </li>
  );
}
