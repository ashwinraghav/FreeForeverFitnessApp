import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Divider } from './Divider.js';

describe('Divider', () => {
  it('renders a plain rule with separator semantics', () => {
    render(<Divider />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders a labelled separator', () => {
    render(<Divider>Yesterday</Divider>);
    const separator = screen.getByRole('separator');
    expect(separator).toHaveTextContent('Yesterday');
    expect(separator).toHaveClass('ff-divider--labelled');
  });
});
