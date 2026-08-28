import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, initialsFor } from './Avatar.js';

describe('initialsFor', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
  });

  it('handles a single name', () => {
    expect(initialsFor('Ada')).toBe('A');
  });

  it('ignores extra whitespace and further names', () => {
    expect(initialsFor('  Ada  Byron King ')).toBe('AB');
  });
});

describe('Avatar', () => {
  it('announces who it represents when falling back to initials', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('Ada Lovelace')).toHaveClass('ff-visually-hidden');
    expect(screen.getByText('AL')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the name as alt text for a photo', () => {
    render(<Avatar name="Ada Lovelace" src="/ada.jpg" />);
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
  });

  it.each(['sm', 'md', 'lg'] as const)('renders at %s', (size) => {
    const { container } = render(<Avatar name="Ada Lovelace" size={size} />);
    expect(container.querySelector('.ff-avatar')).toHaveClass(`ff-avatar--${size}`);
  });
});
