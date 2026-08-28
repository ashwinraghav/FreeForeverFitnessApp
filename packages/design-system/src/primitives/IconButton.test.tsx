import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlusGlyph } from '../lib/glyphs.js';
import { IconButton } from './IconButton.js';

describe('IconButton', () => {
  it('takes its accessible name from aria-label', () => {
    render(<IconButton icon={<PlusGlyph />} aria-label="Add set" />);
    expect(screen.getByRole('button', { name: 'Add set' })).toBeInTheDocument();
  });

  it('takes its accessible name from aria-labelledby', () => {
    render(
      <>
        <span id="add-label">Add set</span>
        <IconButton icon={<PlusGlyph />} aria-labelledby="add-label" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Add set' })).toBeInTheDocument();
  });

  it('hides the glyph from assistive technology so the name is not doubled', () => {
    const { container } = render(<IconButton icon={<PlusGlyph />} aria-label="Add set" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the mid-set hit class at xl', () => {
    render(<IconButton icon={<PlusGlyph />} aria-label="Add set" size="xl" />);
    expect(screen.getByRole('button')).toHaveClass('ff-icon-button--xl');
  });

  it('cannot be constructed without a name', () => {
    // @ts-expect-error - an icon-only control with no accessible name must not compile.
    const invalid = <IconButton icon={<PlusGlyph />} />;
    expect(invalid).toBeTruthy();
  });
});
