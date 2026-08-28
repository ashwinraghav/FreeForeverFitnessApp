import { describe, expect, it } from 'vitest';
import {
  CENTIMETRES_PER_INCH,
  DEFAULT_UNIT_PREFERENCES,
  KILOGRAMS_PER_POUND,
} from '@freeforever/data';
import * as local from '../select/constants';

/**
 * The copies in `select/constants.ts` exist so the feature's chunk does not carry Zod
 * and the whole domain schema set for three numbers. This is the price of that: the
 * copies are asserted against the originals, so a change in `@freeforever/data`
 * breaks CI here rather than silently reinterpreting somebody's training history.
 *
 * The test file imports the barrel freely — tests are not bundled.
 */
describe('constants copied from @freeforever/data', () => {
  it('has not drifted', () => {
    expect(local.KILOGRAMS_PER_POUND).toBe(KILOGRAMS_PER_POUND);
    expect(local.CENTIMETRES_PER_INCH).toBe(CENTIMETRES_PER_INCH);
    expect(local.FALLBACK_UNIT_PREFERENCES).toEqual(DEFAULT_UNIT_PREFERENCES);
  });
});
