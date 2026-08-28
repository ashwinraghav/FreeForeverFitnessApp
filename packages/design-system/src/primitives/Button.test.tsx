import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button.js';

describe('Button', () => {
  it('renders a named button', () => {
    render(<Button>Log set</Button>);
    expect(screen.getByRole('button', { name: 'Log set' })).toBeInTheDocument();
  });

  it('defaults to type=button so it cannot submit a form by accident', () => {
    render(<Button>Log set</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('is focusable and carries the shared focus-ring class', () => {
    render(<Button>Log set</Button>);
    expect(screen.getByRole('button')).toHaveClass('ff-focusable');
  });

  it.each(['sm', 'md', 'lg', 'xl'] as const)('exposes its size (%s) for the hit-target audit', (size) => {
    render(<Button size={size}>Log set</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-ff-size', size);
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)('renders the %s variant', (variant) => {
    render(<Button variant={variant}>Log set</Button>);
    expect(screen.getByRole('button')).toHaveClass(`ff-button--${variant}`);
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Log set</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Log set
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
