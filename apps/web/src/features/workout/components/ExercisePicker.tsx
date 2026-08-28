import { Chip, Sheet, TextField } from '@freeforever/design-system';
import { useMemo, useState } from 'react';

import { searchExercises } from '../catalogue/search.js';
import type { CatalogueEntry } from '../catalogue/types.js';

/**
 * Picking the next exercise.
 *
 * A `Sheet`, not a `Dialog`. Sheets are non-blocking by default and that is the whole
 * reason to reach for one mid-workout: a modal that can be dismissed by a stray swipe,
 * with the session behind it, is the failure mode CLAUDE.md names as the worst in this
 * category.
 *
 * Two things do the work here, and neither is the search box:
 *
 *   1. **It opens on recents.** Most sessions repeat a handful of lifts, so the list
 *      is usually already showing what the lifter wanted before they type anything.
 *   2. **It searches on every keystroke, offline.** The catalogue is on-device
 *      (ADR-0006) — no query, no network, no per-user cost, and it works in a
 *      basement. See `catalogue/search.ts` for the ranking.
 */

const EQUIPMENT_FILTERS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'Bodyweight' },
];

export interface ExercisePickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPick: (entry: CatalogueEntry) => void;
  readonly catalogue: readonly CatalogueEntry[];
  /** Exercise ids most recently used, most recent first. */
  readonly recentIds: readonly string[];
}

export function ExercisePicker({
  open,
  onClose,
  onPick,
  catalogue,
  recentIds,
}: ExercisePickerProps) {
  const [query, setQuery] = useState('');
  const [equipment, setEquipment] = useState<readonly string[]>([]);

  const results = useMemo(
    () => searchExercises(query, catalogue, { recentIds, equipment, limit: 60 }),
    [query, catalogue, recentIds, equipment],
  );

  const recent = useMemo(() => new Set(recentIds), [recentIds]);

  const toggle = (value: string) => {
    setEquipment((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const pick = (entry: CatalogueEntry) => {
    // Reset the query so the next open starts on recents — which, having just used
    // this one, now includes it.
    setQuery('');
    onPick(entry);
  };

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} title="Add exercise" closeLabel="Close exercise picker">
      <div className="ffw-picker">
        <TextField
          label="Search exercises"
          labelHidden
          placeholder="Search — try “rdl”"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />

        <div className="ffw-picker__filters" role="group" aria-label="Filter by equipment">
          {EQUIPMENT_FILTERS.map((filter) => (
            <Chip
              key={filter.value}
              selected={equipment.includes(filter.value)}
              onClick={() => toggle(filter.value)}
            >
              {filter.label}
            </Chip>
          ))}
        </div>

        {results.length === 0 ? (
          <p className="ffw-note">
            Nothing matches “{query}”. Try a shorter word, or clear the equipment filter.
          </p>
        ) : (
          <ul className="ffw-picker__results" aria-label="Exercises">
            {results.map((hit) => (
              <li key={hit.entry.id}>
                <button
                  type="button"
                  className="ffw-picker__result ff-focusable"
                  onClick={() => pick(hit.entry)}
                >
                  <span>{hit.entry.name}</span>
                  {recent.has(hit.entry.id) ? (
                    <span className="ffw-picker__recent">recent</span>
                  ) : null}
                  <span className="ffw-picker__equipment">{labelFor(hit.entry.equipment)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function labelFor(equipment: string): string {
  return equipment.replace(/_/g, ' ');
}
