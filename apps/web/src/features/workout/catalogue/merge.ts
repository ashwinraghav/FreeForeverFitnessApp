import type { CatalogueEntry } from './types.js';

/**
 * Fold the 873-entry dataset catalogue in behind the hand-written starter set.
 *
 * ## Why the starter set wins, always
 *
 * Two reasons, and the first one is not negotiable.
 *
 * **Its ids are in people's logs.** A logged set stores `exerciseId`, and the two
 * catalogues number the world differently — `bench-press` here, `Bench_Press` upstream.
 * If a merge ever renamed an id, every session that referenced it would point at
 * nothing. So a starter entry is never replaced, only kept.
 *
 * **Its muscle splits are better.** A human wrote 70 of them; the other 803 are
 * inferred by `fromDatasets.ts` from a two-value primary/secondary scale. Both beat an
 * all-1.0 split, but where they overlap the hand-written one is the one to keep.
 *
 * ## What counts as a duplicate
 *
 * Deliberately narrow. Dropping too much is worse than showing two similar rows,
 * because a dropped exercise is invisible — the lifter simply cannot find the thing
 * they did, which is the bug this merge exists to fix.
 *
 *   1. **Same name, or the dataset name is one of our aliases.** "Overhead Press" and
 *      "ohp" both resolve to the starter row.
 *   2. **The dataset name is ours with its equipment spelled out, and the equipment
 *      agrees.** "Barbell Deadlift" is our "Deadlift" (barbell). "Dumbbell Bench Press"
 *      is *not* our "Bench Press" (barbell) — different lift, kept.
 *
 * Nothing else. In particular *containment* is not a duplicate test: "Incline Bench
 * Press" contains "Bench Press" and is a different exercise. 157 dataset rows contain a
 * starter name and only a handful are actually the same lift.
 */

/** Equipment words a dataset name may lead with, longest first so "smith machine" wins. */
const QUALIFIERS = [
  'smith machine',
  'bodyweight',
  'dumbbell',
  'kettlebell',
  'barbell',
  'machine',
  'cable',
  'lever',
  'ez bar',
  'ez-bar',
] as const;

/** Case, punctuation and spacing folded away. "EZ-Bar  Curl" -> "ez bar curl". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function mergeCatalogues(
  starter: readonly CatalogueEntry[],
  extra: readonly CatalogueEntry[],
): CatalogueEntry[] {
  const byName = new Map<string, CatalogueEntry>();
  const takenIds = new Set<string>();

  for (const entry of starter) {
    takenIds.add(entry.id);
    byName.set(normaliseName(entry.name), entry);
    for (const alias of entry.aliases) byName.set(normaliseName(alias), entry);
  }

  const out: CatalogueEntry[] = [...starter];
  for (const entry of extra) {
    // An id collision would make two different exercises indistinguishable in a log.
    // It cannot happen with today's two id schemes, but a merge that silently allowed
    // it would be a data-loss bug rather than a display one, so it is checked.
    if (takenIds.has(entry.id)) continue;
    if (duplicates(entry, byName)) continue;

    takenIds.add(entry.id);
    out.push(entry);
  }
  return out;
}

function duplicates(entry: CatalogueEntry, byName: ReadonlyMap<string, CatalogueEntry>): boolean {
  const name = normaliseName(entry.name);
  if (byName.has(name)) return true;

  for (const qualifier of QUALIFIERS) {
    if (!name.startsWith(`${qualifier} `)) continue;
    const bare = byName.get(name.slice(qualifier.length + 1));
    // Only a duplicate when the qualifier is telling us what we already know. Same
    // words, different implement, is a different exercise.
    return bare !== undefined && normaliseName(bare.equipment) === normaliseName(qualifier);
  }
  return false;
}
