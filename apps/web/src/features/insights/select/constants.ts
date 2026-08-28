import type { UnitPreferences } from '@freeforever/data';

/**
 * Values copied from `@freeforever/data`, deliberately, with a test that fails if the
 * copy drifts.
 *
 * `@freeforever/data` has a single barrel entry point, so importing one number from it
 * as a *value* pulls Zod and every schema in the domain into this feature's chunk —
 * about a hundred kilobytes, code-split onto a screen that needs three constants and
 * no validation at all. Free-forever rule 2 is about bytes as much as requests, and a
 * hundred kilobytes on a gym's basement 3G is a real cost paid by every user.
 *
 * Every other import in this feature from that package is `import type`, which erases
 * completely. These four are the exceptions, and `test/constants.test.ts` asserts each
 * one against the source of truth, so "only one file is right about what a pound is"
 * stays true — the second file is checked against the first by CI rather than by hope.
 *
 * The proper fix is a `@freeforever/data/units` subpath export. Reported to the
 * integrator; this file disappears the day it exists.
 */

/** Exact by international definition (1959). */
export const KILOGRAMS_PER_POUND = 0.45359237;

/** Exact by definition. */
export const CENTIMETRES_PER_INCH = 2.54;

/** Mirrors `DEFAULT_UNIT_PREFERENCES`. Used only when no profile has loaded yet. */
export const FALLBACK_UNIT_PREFERENCES: UnitPreferences = {
  trainingLoad: 'kg',
  bodyMass: 'kg',
  bodyLength: 'cm',
  distance: 'km',
  energy: 'kcal',
  barbellIncrementKg: 2.5,
  dumbbellIncrementKg: 2,
};
