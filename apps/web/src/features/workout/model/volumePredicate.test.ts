import {
  SET_STATES,
  SET_TYPES,
  isRecordEligible as isRecordEligibleCanonical,
  isVolumeEligible as isVolumeEligibleCanonical,
} from '@freeforever/data';
import {
  isRecordEligible as isRecordEligibleCore,
  isVolumeEligible as isVolumeEligibleCore,
} from '@freeforever/core';
import { describe, expect, it } from 'vitest';

/**
 * The two definitions of "does this set count" are pinned together here.
 *
 * `@freeforever/data` owns the canonical `isVolumeEligible`, and importing it into
 * `@freeforever/core` would be the obvious way to guarantee one definition. It is not
 * available there: `packages/core` is **Apache-2.0** and `packages/data` is
 * **AGPL-3.0-or-later**, split deliberately by ADR-0003 so the reusable maths stays
 * reusable. An Apache package taking an AGPL dependency puts core's distribution under
 * the AGPL and destroys the reuse the split exists to enable.
 *
 * `apps/web` is AGPL itself and depends on both, so this is the one place the two can
 * legally be compared. It is a *cheaper* guarantee than an import, not a weaker one:
 * an import makes them the same function, this makes them the same behaviour across
 * every input that exists — and it fails loudly the day either side is edited.
 *
 * This is also the divergence that was live: sync's `contribution.ts` counted failed
 * sets while `sessionTotals` did not, so the same lifter's week rendered two different
 * volume numbers depending on the code path. One definition, mechanically enforced, is
 * what stops that recurring.
 */

/** Every state and type the schema allows. 3 x 8 = 24 combinations, all of them. */
const EVERY_SET = SET_STATES.flatMap((state) => SET_TYPES.map((type) => ({ state, type })));

describe('isVolumeEligible agrees across the licence boundary', () => {
  it('covers every state and type the schema permits', () => {
    expect(EVERY_SET).toHaveLength(SET_STATES.length * SET_TYPES.length);
    expect(EVERY_SET.length).toBeGreaterThan(20);
  });

  it.each(EVERY_SET)('$type/$state', (set) => {
    expect(isVolumeEligibleCore(set)).toBe(isVolumeEligibleCanonical(set));
  });

  it('agrees that a missed working set is volume', () => {
    // The ruling. A set that ground out three of five moved the bar three times.
    const missed = { type: 'working', state: 'failed' } as const;
    expect(isVolumeEligibleCanonical(missed)).toBe(true);
    expect(isVolumeEligibleCore(missed)).toBe(true);
  });

  it('agrees that a warmup never is, however heavy', () => {
    const warmup = { type: 'warmup', state: 'completed' } as const;
    expect(isVolumeEligibleCanonical(warmup)).toBe(false);
    expect(isVolumeEligibleCore(warmup)).toBe(false);
  });

  it('agrees that an untouched set never is', () => {
    const pending = { type: 'working', state: 'pending' } as const;
    expect(isVolumeEligibleCanonical(pending)).toBe(false);
    expect(isVolumeEligibleCore(pending)).toBe(false);
  });
});

describe('isRecordEligible agrees too, and is a different question', () => {
  it.each(EVERY_SET)('$type/$state', (set) => {
    expect(isRecordEligibleCore(set)).toBe(isRecordEligibleCanonical(set));
  });

  it('diverges from volume on exactly the failed non-warmup sets, and nowhere else', () => {
    // If these two ever collapse into each other, one of the questions has been lost:
    // "did the body do work" and "did this prove a capability" are not the same, and
    // the whole reason `state` is three-valued is to keep them apart.
    const divergent = EVERY_SET.filter(
      (set) => isVolumeEligibleCanonical(set) !== isRecordEligibleCanonical(set),
    );
    expect(divergent.every((set) => set.state === 'failed' && set.type !== 'warmup')).toBe(true);
    // Every non-warmup type, not just `working` — a failed drop set is still work.
    expect(divergent).toHaveLength(SET_TYPES.length - 1);
  });
});
