import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DisclaimerSection } from './DisclaimerSection';

/**
 * What is worth asserting here is that the operative sentences are present and
 * findable, because the whole point of this section is that they existed only in a
 * source comment before it.
 *
 * The link is checked for `rel` as well as `href`: it opens in a new tab, and
 * `target="_blank"` without `noopener` hands the opened page a handle on this one.
 */
describe('DisclaimerSection', () => {
  it('says plainly that the numbers are not medical advice', () => {
    render(<DisclaimerSection />);
    expect(screen.getByText(/none of this is medical advice/i)).toBeInTheDocument();
  });

  it('names the groups who should ask someone before acting on a number', () => {
    render(<DisclaimerSection />);
    const note = screen.getByText(/talk to a doctor, dietitian or qualified coach/i);
    for (const group of [/pregnant/i, /under 18/i, /medical condition/i, /disordered eating/i]) {
      expect(note.textContent).toMatch(group);
    }
  });

  it('distinguishes the safety floors from supervision, rather than implying oversight', () => {
    render(<DisclaimerSection />);
    expect(screen.getByText(/a guardrail on an\s+estimate, not supervision/i)).toBeInTheDocument();
  });

  it('links out to the full text, safely', () => {
    render(<DisclaimerSection />);
    const link = screen.getByRole('link', { name: /privacy, health and liability/i });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/ashwinraghav/FreeForeverFitnessApp/blob/main/PRIVACY.md',
    );
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  it('keeps the link on the 48px control, not an inline anchor', () => {
    render(<DisclaimerSection />);
    // jsdom has no layout engine, so the class contract is the only thing assertable
    // here — `.ff-control` is what carries `min-block-size: var(--ff-hit-min)`.
    const link = screen.getByRole('link', { name: /privacy, health and liability/i });
    expect(link.className).toMatch(/\bff-control\b/);
  });
});
