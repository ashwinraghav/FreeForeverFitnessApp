import { describe, expect, it } from 'vitest';
import type { Food } from '@freeforever/datasets';
import { snapshotFromIndexFood } from './mapping.js';

/**
 * The index-row-to-snapshot boundary, where a barcode can change identity.
 *
 * Several barcodes now resolve to one `Food`: the index merges near-duplicate
 * regional SKUs and keeps the losers' barcodes pointing at the survivor, so
 * `byBarcode(x).barcode` is not necessarily `x`. That is fine for lookup and
 * wrong for storage — `ScanScreen` finds a user's own corrections by matching
 * the number they scanned, and a snapshot holding the survivor's primary
 * instead would not be found by re-scanning the packet in their hand.
 */

const OFF_FOOD: Food = {
  id: 'off:5000112637922',
  name: 'Cola Zero',
  brand: 'Coca-Cola',
  sourceId: '5000112637922',
  // The survivor's own barcode. A merged regional SKU's barcode also resolves
  // here, and that is the one a user in a different country would scan.
  barcode: '5000112637922',
  source: 'off',
  shard: 'off',
  licence: 'ODbL-1.0',
  attributionUrl: 'https://world.openfoodfacts.org/product/5000112637922',
  basis: 'ml',
  per100: { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, sugarG: 0, sodiumMg: 4, satFatG: 0 },
  servingGrams: 330,
  servingLabel: '1 can (330 ml)',
  flags: {
    servingEstimated: false,
    atwaterMismatch: false,
    highConfidence: true,
    hasBarcode: true,
    energyReported: true,
    energyDerived: false,
  },
};

describe('snapshotFromIndexFood and the barcode a user actually scanned', () => {
  it('keeps the record’s own barcode when nothing else is supplied', () => {
    expect(snapshotFromIndexFood(OFF_FOOD).barcode).toBe('5000112637922');
  });

  it('keeps the scanned number when it differs from the record’s own', () => {
    const snapshot = snapshotFromIndexFood(OFF_FOOD, { scannedBarcode: '5449000131805' });
    expect(snapshot.barcode).toBe('5449000131805');
    // Everything else still comes from the record it resolved to.
    expect(snapshot.key).toBe('off:5000112637922');
    expect(snapshot.ref.name).toBe('Cola Zero');
  });

  it('carries the stated serving through, so the sheet opens on one can', () => {
    const snapshot = snapshotFromIndexFood(OFF_FOOD);
    expect(snapshot.servings[0]).toMatchObject({ name: 'can', gramsPerServing: 330 });
  });

  it('omits the barcode entirely for a record that has none', () => {
    const noBarcode: Food = { ...OFF_FOOD, barcode: null };
    expect(snapshotFromIndexFood(noBarcode).barcode).toBeUndefined();
    expect('barcode' in snapshotFromIndexFood(noBarcode)).toBe(false);
  });

  it('renders the attribution link, which is a licence obligation for an OFF row', () => {
    // NOTICE.md §2.2 — ODbL requires a link to the contributed product.
    expect(snapshotFromIndexFood(OFF_FOOD).attributionUrl).toContain('openfoodfacts.org/product/');
  });
});
