import { describe, expect, it } from 'vitest';
import {
  type SortKey,
  sortKeyAfter,
  sortKeyBefore,
  sortKeyBetween,
  sortKeySchema,
  sortKeySequence,
  sortedByKey,
} from '../../src/common/sortKey.js';

const key = (value: string): SortKey => sortKeySchema.parse(value);

describe('sortKeyBetween', () => {
  it('produces a first key when the list is empty', () => {
    const first = sortKeyBetween(null, null);
    expect(sortKeySchema.safeParse(first).success).toBe(true);
  });

  it('produces a key strictly between two neighbours', () => {
    const a = sortKeyBetween(null, null);
    const b = sortKeyAfter(a);
    const middle = sortKeyBetween(a, b);
    expect(a < middle).toBe(true);
    expect(middle < b).toBe(true);
  });

  it('appends after the last key', () => {
    let last = sortKeyBetween(null, null);
    for (let index = 0; index < 50; index += 1) {
      const next = sortKeyAfter(last);
      expect(last < next).toBe(true);
      last = next;
    }
  });

  it('prepends before the first key', () => {
    let first = sortKeyBetween(null, null);
    for (let index = 0; index < 50; index += 1) {
      const previous = sortKeyBefore(first);
      expect(previous < first).toBe(true);
      first = previous;
    }
  });

  it('survives repeated insertion into the same gap', () => {
    // The mid-workout case: a user keeps adding a set between the same two sets.
    let low = sortKeyBetween(null, null);
    const high = sortKeyAfter(low);
    for (let index = 0; index < 200; index += 1) {
      const inserted = sortKeyBetween(low, high);
      expect(low < inserted).toBe(true);
      expect(inserted < high).toBe(true);
      expect(sortKeySchema.safeParse(inserted).success).toBe(true);
      low = inserted;
    }
  });

  it('never produces a key ending in zero', () => {
    let cursor = sortKeyBetween(null, null);
    const keys: SortKey[] = [cursor];
    for (let index = 0; index < 500; index += 1) {
      cursor = sortKeyBetween(null, cursor);
      keys.push(cursor);
    }
    for (const generated of keys) {
      expect(generated.endsWith('0')).toBe(false);
    }
  });

  it('refuses neighbours that are not in order', () => {
    const a = key('V');
    const b = key('G');
    expect(() => sortKeyBetween(a, b)).toThrow();
    expect(() => sortKeyBetween(a, a)).toThrow();
  });

  it('lets two devices insert into the same gap without either losing', () => {
    // Both keys land in the gap. The merge is a union; the order between the two is
    // arbitrary but stable, and nothing is overwritten.
    const low = sortKeyBetween(null, null);
    const high = sortKeyAfter(low);
    const fromPhone = sortKeyBetween(low, high);
    const fromWatch = sortKeyBetween(low, fromPhone);
    const merged = [high, fromWatch, low, fromPhone].sort();
    expect(merged).toEqual([low, fromWatch, fromPhone, high]);
  });
});

describe('sortKeySequence', () => {
  it('lays out an ascending run', () => {
    const keys = sortKeySequence(10);
    expect(keys).toHaveLength(10);
    expect([...keys].sort()).toEqual(keys);
  });

  it('lays out a run inside an existing gap', () => {
    const low = sortKeyBetween(null, null);
    const high = sortKeyAfter(low);
    const keys = sortKeySequence(8, low, high);
    expect([...keys].sort()).toEqual(keys);
    expect(low < (keys[0] as SortKey)).toBe(true);
    expect((keys[keys.length - 1] as SortKey) < high).toBe(true);
  });

  it('returns nothing for a count of zero, and refuses a negative one', () => {
    expect(sortKeySequence(0)).toEqual([]);
    expect(() => sortKeySequence(-1)).toThrow();
  });
});

describe('sortedByKey', () => {
  it('orders by key and breaks ties on id, so two devices agree', () => {
    const items = [
      { id: 'b', sortKey: key('V') },
      { id: 'a', sortKey: key('V') },
      { id: 'c', sortKey: key('G') },
    ];
    expect(sortedByKey(items).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate its input', () => {
    const items = [
      { id: 'b', sortKey: key('V') },
      { id: 'a', sortKey: key('G') },
    ];
    sortedByKey(items);
    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('sortKeySchema', () => {
  it('rejects keys that would break ordering or grow without bound', () => {
    for (const invalid of ['', 'V0', 'V-', 'v!', 'a'.repeat(65)]) {
      expect(sortKeySchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });
});
