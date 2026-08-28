import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * Who this represents. Required - an avatar with no name is decoration wearing a
   * person's face. Used for the initials fallback and for the image's alt text.
   */
  name: string;
  src?: string;
  size?: AvatarSize;
}

/** First letters of the first two words - enough to distinguish, short enough to fit. */
export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
}

export function Avatar({ name, src, size = 'md', className, ...rest }: AvatarProps) {
  return (
    <span className={cx('ff-avatar', `ff-avatar--${size}`, className)} data-ff-size={size} {...rest}>
      {src ? (
        <img className="ff-avatar__image" src={src} alt={name} />
      ) : (
        // The initials are decorative here; the name is announced by the label below.
        <>
          <span aria-hidden="true">{initialsFor(name)}</span>
          <span className="ff-visually-hidden">{name}</span>
        </>
      )}
    </span>
  );
}
