import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /** Any CSS length. Defaults to filling the inline axis. */
  width?: string;
  height?: string;
  /** Round it - for an avatar placeholder. */
  circle?: boolean;
}

/**
 * A loading placeholder. Always aria-hidden: the region it sits in should carry
 * `aria-busy`, so assistive technology hears "loading" once rather than a row of
 * meaningless boxes. Its sweep is removed entirely under prefers-reduced-motion,
 * handled globally in primitives.css.
 */
export function Skeleton({ width, height, circle = false, className, style, ...rest }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('ff-skeleton', className)}
      style={{
        inlineSize: width ?? '100%',
        blockSize: height ?? 'var(--ff-space-16)',
        borderRadius: circle ? 'var(--ff-radius-full)' : undefined,
        ...style,
      }}
      {...rest}
    />
  );
}
