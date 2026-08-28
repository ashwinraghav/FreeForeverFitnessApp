import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders its text', () => {
    render(<Badge tone="success">PR</Badge>);
    expect(screen.getByText('PR')).toBeInTheDocument();
  });

  it.each(['neutral', 'info', 'success', 'attention', 'danger'] as const)(
    'pairs the %s tone with a glyph, so colour is never the only signal',
    (tone) => {
      const { container } = render(<Badge tone={tone}>State</Badge>);
      expect(container.querySelector('.ff-badge__glyph svg')).toBeInTheDocument();
      expect(container.querySelector('.ff-badge')).toHaveAttribute('data-ff-tone', tone);
    },
  );

  it('allows the glyph to be dropped only explicitly', () => {
    const { container } = render(
      <Badge tone="danger" glyphHidden>
        Failed
      </Badge>,
    );
    expect(container.querySelector('.ff-badge__glyph')).not.toBeInTheDocument();
  });
});
