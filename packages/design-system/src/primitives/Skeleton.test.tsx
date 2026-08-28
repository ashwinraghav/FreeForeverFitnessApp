import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('is hidden from assistive technology - the busy region announces the wait', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('.ff-skeleton')).toHaveAttribute('aria-hidden', 'true');
  });

  it('accepts explicit dimensions', () => {
    const { container } = render(<Skeleton width="50%" height="var(--ff-space-24)" />);
    const el = container.querySelector('.ff-skeleton') as HTMLElement;
    expect(el.style.inlineSize).toBe('50%');
    expect(el.style.blockSize).toBe('var(--ff-space-24)');
  });

  it('rounds itself for an avatar placeholder', () => {
    const { container } = render(<Skeleton circle />);
    const el = container.querySelector('.ff-skeleton') as HTMLElement;
    expect(el.style.borderRadius).toBe('var(--ff-radius-full)');
  });
});
