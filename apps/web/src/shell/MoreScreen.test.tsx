import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MoreScreen } from './MoreScreen';

/**
 * The point of this screen is reachability, so the tests assert exactly that:
 * that the screens which previously had no way in now have one, by name and by
 * destination. `/nutrition/recipes` in particular was linked from nowhere in
 * the entire app and could only be reached by typing the URL.
 */
const renderMore = () =>
  render(
    <MemoryRouter>
      <MoreScreen />
    </MemoryRouter>,
  );

describe('MoreScreen', () => {
  it.each([
    ['Your targets', '/nutrition/targets'],
    ['Recipes', '/nutrition/recipes'],
    ['Add a food', '/nutrition/custom'],
  ])('gives %s a way in, pointing at %s', (label, href) => {
    renderMore();
    expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toHaveAttribute('href', href);
  });

  it('explains what each tab is for, since nothing else does', () => {
    renderMore();
    const prose = screen.getByRole('heading', { name: /how this works/i }).parentElement;
    expect(prose).not.toBeNull();
    for (const tab of ['Train', 'Eat', 'Progress']) {
      expect(within(prose as HTMLElement).getByText(tab)).toBeInTheDocument();
    }
  });

  it('states the free-forever promise where someone looking for the catch would look', () => {
    renderMore();
    expect(screen.getByText(/nothing to pay for/i)).toBeInTheDocument();
  });

  it('groups the links under headings rather than presenting a flat pile', () => {
    renderMore();
    expect(screen.getByRole('heading', { name: /eating/i })).toBeInTheDocument();
  });
});
