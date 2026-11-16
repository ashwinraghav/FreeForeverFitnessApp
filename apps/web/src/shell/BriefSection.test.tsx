import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Handoff } from './brief/handoff';

const BRIEF = `# Training brief\n\n${'80x5@8 '.repeat(400)}\n`;

const stub = {
  handoff: 'shared' as Handoff,
  shareBrief: vi.fn(async (_text: string): Promise<Handoff> => stub.handoff),
  brief: vi.fn((): string => BRIEF),
};

vi.mock('./brief/handoff', async () => {
  // Only the two functions the component calls are replaced. `briefBytes` is real
  // arithmetic, and a stub for it could make the "14 KB" claim true by fiat.
  const real = await import('./brief/handoff');
  return { ...real, shareBrief: (text: string) => stub.shareBrief(text) };
});

// `brief/sources` reads the device and pulls in the reducers; the component's job is
// only to call it at the right moment and report what happened.
vi.mock('./brief/sources', () => ({ briefForThisDevice: () => stub.brief() }));

const { BriefSection } = await import('./BriefSection');

function mount() {
  return render(
    <MemoryRouter>
      <BriefSection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stub.handoff = 'shared';
  stub.shareBrief = vi.fn(async (_text: string): Promise<Handoff> => stub.handoff);
  stub.brief = vi.fn((): string => BRIEF);
});

describe('BriefSection', () => {
  it('promises out loud that nothing leaves the device unasked', () => {
    mount();

    // Asserted on the guarantee rather than the sentence: the copy may be reworded,
    // the promise may not. This is the one feature in the app that sends a lifter's
    // training to a third party, so the consent has to be on screen before the tap.
    expect(screen.getByText(/only leaves this device when you tap/i)).toBeInTheDocument();
  });

  it('writes nothing out until the button is pressed', () => {
    mount();

    expect(stub.brief).not.toHaveBeenCalled();
    expect(stub.shareBrief).not.toHaveBeenCalled();
  });

  it('generates the brief on the tap and hands over exactly that text', async () => {
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));

    expect(stub.brief).toHaveBeenCalledOnce();
    expect(stub.shareBrief).toHaveBeenCalledWith(BRIEF);
  });

  it('says which mechanism actually happened, and how big it was', async () => {
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));

    // "Done!" is not checkable. "Handed over … (3 KB)" is.
    const status = await screen.findByText(/Handed over/i);
    expect(status).toHaveTextContent('3 KB');
  });

  it('does not claim a send when the user backed out of the share sheet', async () => {
    stub.handoff = 'cancelled';
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));

    expect(await screen.findByText('Nothing was sent.')).toBeInTheDocument();
  });

  it('points at the manual path when the browser refuses every mechanism', async () => {
    stub.handoff = 'failed';
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));

    expect(await screen.findByText(/copy it by hand/i)).toBeInTheDocument();
  });

  it('separates "could not be written" from "could not be sent"', async () => {
    // Two different problems with two different next steps. Telling someone their
    // browser refused to copy, when in fact the fold could not read what is on disk,
    // sends them to fix the wrong thing.
    stub.brief = vi.fn((): string => {
      throw new Error('unreadable session on disk');
    });
    mount();

    await userEvent.click(screen.getByRole('button', { name: 'Send it to an app' }));

    expect(await screen.findByText(/could not be read on this device/i)).toBeInTheDocument();
    expect(screen.queryByText(/would not share, copy or save/i)).not.toBeInTheDocument();
    expect(stub.shareBrief).not.toHaveBeenCalled();
  });

  it('offers a look at the text before sending it', () => {
    mount();

    expect(screen.getByRole('link', { name: 'See what gets sent' })).toHaveAttribute(
      'href',
      '/brief',
    );
  });
});
