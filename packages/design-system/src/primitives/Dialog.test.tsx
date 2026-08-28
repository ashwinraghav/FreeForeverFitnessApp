import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.js';

beforeAll(() => {
  // jsdom does not implement the top layer.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

describe('Dialog', () => {
  it('opens as a labelled modal dialog', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Delete workout?">
        This cannot be undone.
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Delete workout?' })).toBeInTheDocument();
  });

  it('stays shut when open is false', () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Delete workout?">
        body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders its actions', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Delete workout?" actions={<button>Delete</button>}>
        body
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('reports close back to the caller so state cannot drift', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Delete workout?">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalled();
  });
});
