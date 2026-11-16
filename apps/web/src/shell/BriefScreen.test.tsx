import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Handoff } from './brief/handoff';

const BRIEF = ['# Training brief', '', '## Sessions', '', '2026-09-02 (65 min, bw 78.4kg)', '  Bench Press: 80x5@8 80x5@8'].join('\n');

const stub = {
  brief: vi.fn((): string => BRIEF),
  shareBrief: vi.fn(async (_text: string): Promise<Handoff> => 'shared'),
  copyBrief: vi.fn(async (_text: string): Promise<Handoff> => 'copied'),
  downloadBrief: vi.fn((_text: string): Handoff => 'downloaded'),
};

vi.mock('./brief/sources', () => ({ briefForThisDevice: () => stub.brief() }));
vi.mock('./brief/handoff', async () => {
  const real = await import('./brief/handoff');
  return {
    ...real,
    shareBrief: (text: string) => stub.shareBrief(text),
    copyBrief: (text: string) => stub.copyBrief(text),
    downloadBrief: (text: string) => stub.downloadBrief(text),
  };
});

const BriefScreen = (await import('./BriefScreen')).default;

function mount() {
  return render(
    <MemoryRouter>
      <BriefScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stub.brief = vi.fn((): string => BRIEF);
  stub.shareBrief = vi.fn(async (_text: string): Promise<Handoff> => 'shared');
  stub.copyBrief = vi.fn(async (_text: string): Promise<Handoff> => 'copied');
  stub.downloadBrief = vi.fn((_text: string): Handoff => 'downloaded');
});

describe('BriefScreen', () => {
  it('shows the whole brief, verbatim, before anything is sent', () => {
    mount();

    // The page is the consent surface: what is on it is what would leave. A
    // truncated or reformatted preview would make that promise false.
    expect(screen.getByRole('region', { name: 'The brief itself' })).toHaveTextContent(
      'Bench Press: 80x5@8 80x5@8',
    );
    expect(screen.getByText(/Nothing has been sent yet/i)).toBeInTheDocument();
  });

  it('sends nothing on arrival', () => {
    mount();

    expect(stub.shareBrief).not.toHaveBeenCalled();
    expect(stub.copyBrief).not.toHaveBeenCalled();
    expect(stub.downloadBrief).not.toHaveBeenCalled();
  });

  it('offers all three routes off the device, each with the same text', async () => {
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));
    expect(stub.shareBrief).toHaveBeenCalledWith(BRIEF);
    expect(await screen.findByText('Handed over to the app you chose.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(stub.copyBrief).toHaveBeenCalledWith(BRIEF);
    expect(await screen.findByText('Copied to the clipboard.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save as a file' }));
    expect(stub.downloadBrief).toHaveBeenCalledWith(BRIEF);
    expect(await screen.findByText('Saved as a file.')).toBeInTheDocument();
  });

  it('states the size in kilobytes so the claim is checkable', () => {
    mount();

    expect(screen.getByText(/1 KB of plain text/)).toBeInTheDocument();
  });

  it('names the text for a screen reader without spending a tab stop on it', () => {
    mount();

    // A named region, not a focusable block: it wraps rather than scrolls, so there
    // is nothing a keyboard would do inside it. See the note in BriefScreen.tsx.
    const region = screen.getByRole('region', { name: 'The brief itself' });
    expect(region).toBeInTheDocument();
    expect(region.querySelector('pre')).not.toHaveAttribute('tabindex');
  });

  it('says so plainly when the device will not give up its data', () => {
    stub.brief = vi.fn((): string => {
      throw new Error('site data blocked');
    });
    mount();

    expect(screen.getByText(/could not be read on this device/i)).toBeInTheDocument();
    // And is explicit that this is not data loss, which is the fear it would raise.
    expect(screen.getByText(/Nothing has been lost/i)).toBeInTheDocument();
    // But never names a cause it does not know. The first version guessed "storage
    // is blocked" and was wrong the first time it fired.
    expect(screen.queryByText(/storage is blocked/i)).not.toBeInTheDocument();
    // The positive case is proven above in the same file, so this negative cannot
    // be a harness that never rendered anything.
    expect(screen.queryByRole('region', { name: 'The brief itself' })).not.toBeInTheDocument();
  });
});
