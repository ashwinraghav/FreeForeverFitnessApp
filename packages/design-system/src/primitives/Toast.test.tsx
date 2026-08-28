import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toast, ToastRegion } from './Toast.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('is polite for a routine confirmation', () => {
    render(<Toast tone="success">Set logged</Toast>);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Set logged');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it('is assertive only for danger', () => {
    render(<Toast tone="danger">Could not save</Toast>);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it.each(['info', 'success', 'danger'] as const)('pairs the %s tone with a glyph', (tone) => {
    const { container } = render(<Toast tone={tone}>Message</Toast>);
    expect(container.querySelector('.ff-toast__glyph svg')).toBeInTheDocument();
  });

  it('auto-dismisses after the given duration', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast durationMs={180} onDismiss={onDismiss}>
        Set logged
      </Toast>,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('stays put when no duration is given', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Set logged</Toast>);
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('ToastRegion', () => {
  it('is a named region so the stack is findable', () => {
    render(
      <ToastRegion>
        <Toast>Set logged</Toast>
      </ToastRegion>,
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
  });
});
