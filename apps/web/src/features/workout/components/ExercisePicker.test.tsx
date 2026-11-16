import { fireEvent, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import type { CatalogueEntry } from '../catalogue/types.js';
import { ExercisePicker } from './ExercisePicker.js';

function setup(options: { recentIds?: readonly string[]; open?: boolean } = {}) {
  const onPick = vi.fn<(entry: CatalogueEntry) => void>();
  const onClose = vi.fn();
  const view = render(
    <ExercisePicker
      open={options.open ?? true}
      onClose={onClose}
      onPick={onPick}
      catalogue={STARTER_CATALOGUE}
      recentIds={options.recentIds ?? []}
    />,
  );

  const results = () =>
    [...view.container.querySelectorAll('.ffw-picker__result')] as HTMLElement[];
  const names = () =>
    results().map((button) => (button.querySelector('span')?.textContent ?? '').trim());
  const search = () => view.getByRole('searchbox', { name: 'Search exercises' });

  return { ...view, onPick, onClose, results, names, search };
}

describe('the picker is not a modal', () => {
  it('is a region with no scrim, so the session behind stays live', () => {
    const picker = setup();
    // A `region`, not a `dialog`: nothing here traps focus or blocks the session.
    expect(picker.getByRole('region', { name: 'Add exercise' })).toBeInTheDocument();
    expect(picker.queryByRole('dialog')).not.toBeInTheDocument();
    expect(picker.container.querySelector('[data-ff-scrim]')).toBeNull();
  });

  it('renders nothing at all when closed', () => {
    const picker = setup({ open: false });
    expect(picker.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('it opens on recents', () => {
  it('shows the last-used lifts first, before anything is typed', () => {
    // The fastest search is the one nobody has to type.
    const picker = setup({ recentIds: ['deadlift', 'bench-press'] });
    expect(picker.names().slice(0, 2)).toEqual(['Deadlift', 'Bench Press']);
  });

  it('marks them so the ordering is explained rather than mysterious', () => {
    const picker = setup({ recentIds: ['deadlift'] });
    const first = picker.results()[0] as HTMLElement;
    expect(within(first).getByText('recent')).toBeInTheDocument();
  });
});

describe('search', () => {
  it('narrows on every keystroke', () => {
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'bench' } });
    const names = picker.names();
    expect(names[0]).toBe('Bench Press');
    expect(names.every((name) => name.toLowerCase().includes('bench'))).toBe(true);
  });

  it('finds a lift by gym shorthand nobody spells out', () => {
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'rdl' } });
    expect(picker.names()[0]).toBe('Romanian Deadlift');
  });

  it('says so plainly when nothing matches, rather than showing an empty list', () => {
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'zzzqqq' } });
    expect(picker.results()).toHaveLength(0);
    expect(picker.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('works with no network — the catalogue is a module, not a fetch', () => {
    // ADR-0006: search is the highest-frequency read in the picker, so answering it
    // from the server would turn the core interaction into a per-user cost.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'squat' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(picker.names().length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });
});

describe('filters', () => {
  it('narrows by equipment and can be turned back off', () => {
    const picker = setup();
    const before = picker.names().length;

    fireEvent.click(picker.getByRole('button', { name: 'Barbell' }));
    const filtered = picker.names();
    expect(filtered.length).toBeLessThan(before);
    expect(filtered).toContain('Back Squat');
    expect(filtered).not.toContain('Lateral Raise');

    fireEvent.click(picker.getByRole('button', { name: 'Barbell' }));
    expect(picker.names()).toHaveLength(before);
  });

  it('exposes the pressed state to assistive technology, not only as a fill', () => {
    const picker = setup();
    expect(picker.getByRole('button', { name: 'Dumbbell' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(picker.getByRole('button', { name: 'Dumbbell' }));
    expect(picker.getByRole('button', { name: 'Dumbbell' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('picking', () => {
  it('hands back the catalogue entry, not a name', () => {
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'bench press' } });
    fireEvent.click(picker.results()[0] as HTMLElement);
    expect(picker.onPick).toHaveBeenCalledTimes(1);
    expect(picker.onPick.mock.calls[0]?.[0].id).toBe('bench-press');
  });

  it('clears the query so the next open starts on recents again', () => {
    const picker = setup();
    fireEvent.change(picker.search(), { target: { value: 'bench' } });
    fireEvent.click(picker.results()[0] as HTMLElement);
    expect(picker.search()).toHaveValue('');
  });
});

describe('every result is reachable', () => {
  it('exposes results as a named list of buttons', () => {
    const picker = setup();
    const list = picker.getByRole('list', { name: 'Exercises' });
    expect(within(list).getAllByRole('button').length).toBeGreaterThan(0);
  });
});

/**
 * Writing down an exercise the catalogue does not have.
 *
 * The offer appears only where the catalogue has demonstrably failed — a typed query
 * with no matches — and only when the caller can persist one. Both halves are asserted,
 * because an escape hatch that shows up in the wrong place is worse than none: it would
 * invite a lifter to invent a duplicate of a lift the search merely mis-ranked.
 */
describe('the escape hatch', () => {
  const setupCreatable = (onCreated = vi.fn()) => {
    const onPick = vi.fn<(entry: CatalogueEntry) => void>();
    const view = render(
      <ExercisePicker
        open
        onClose={vi.fn()}
        onPick={onPick}
        onCreated={onCreated}
        catalogue={STARTER_CATALOGUE}
        recentIds={[]}
      />,
    );
    const search = () => view.getByRole('searchbox', { name: 'Search exercises' });
    return { ...view, onPick, onCreated, search };
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('is absent while the search is finding things', () => {
    const picker = setupCreatable();
    fireEvent.change(picker.search(), { target: { value: 'bench' } });
    expect(picker.queryByRole('button', { name: /yourself/i })).not.toBeInTheDocument();
  });

  it('appears once a typed query matches nothing', () => {
    const picker = setupCreatable();
    fireEvent.change(picker.search(), { target: { value: 'jefferson curl' } });
    expect(
      picker.getByRole('button', { name: /Add “jefferson curl” yourself/i }),
    ).toBeInTheDocument();
  });

  it('stays away when the empty list is the lifter’s own filter', () => {
    // No query, so the fix is to clear a chip. Offering to invent an exercise here
    // would be answering a question nobody asked.
    const picker = setupCreatable();
    fireEvent.click(picker.getByRole('button', { name: 'Barbell' }));
    fireEvent.click(picker.getByRole('button', { name: 'Bodyweight' }));
    expect(picker.queryByRole('button', { name: /yourself/i })).not.toBeInTheDocument();
  });

  it('is withheld from a picker that cannot persist one', () => {
    const onPick = vi.fn<(entry: CatalogueEntry) => void>();
    const view = render(
      <ExercisePicker
        open
        onClose={vi.fn()}
        onPick={onPick}
        catalogue={STARTER_CATALOGUE}
        recentIds={[]}
      />,
    );
    fireEvent.change(view.getByRole('searchbox', { name: 'Search exercises' }), {
      target: { value: 'jefferson curl' },
    });
    expect(view.queryByRole('button', { name: /yourself/i })).not.toBeInTheDocument();
  });

  it('opens the form in the same sheet rather than stacking a second one', () => {
    const picker = setupCreatable();
    fireEvent.change(picker.search(), { target: { value: 'jefferson curl' } });
    fireEvent.click(picker.getByRole('button', { name: /yourself/i }));

    expect(picker.getByRole('region', { name: 'New exercise' })).toBeInTheDocument();
    // The modality rule from CLAUDE.md holds through the swap, not just on open.
    expect(picker.queryByRole('dialog')).not.toBeInTheDocument();
    expect(picker.queryByRole('region', { name: 'Add exercise' })).not.toBeInTheDocument();
  });

  it('puts the new exercise straight into the session and tells the caller to refresh', () => {
    const onCreated = vi.fn();
    const picker = setupCreatable(onCreated);
    fireEvent.change(picker.search(), { target: { value: 'jefferson curl' } });
    fireEvent.click(picker.getByRole('button', { name: /yourself/i }));
    fireEvent.click(picker.getByRole('button', { name: /add and use it/i }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(picker.onPick).toHaveBeenCalledTimes(1);
    expect(picker.onPick.mock.calls[0]?.[0]).toMatchObject({ name: 'jefferson curl' });
  });

  it('goes back to the results without saving', () => {
    const picker = setupCreatable();
    fireEvent.change(picker.search(), { target: { value: 'jefferson curl' } });
    fireEvent.click(picker.getByRole('button', { name: /yourself/i }));
    fireEvent.click(picker.getByRole('button', { name: /back to search/i }));

    expect(picker.getByRole('region', { name: 'Add exercise' })).toBeInTheDocument();
    expect(picker.onCreated).not.toHaveBeenCalled();
  });
});
