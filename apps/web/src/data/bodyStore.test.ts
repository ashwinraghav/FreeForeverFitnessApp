import { describe, expect, it } from 'vitest';

import { createBodyStore, isoWeekOf, toBodyMetrics, type WeighIn } from './bodyStore';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

const d = (s: string) => s as WeighIn['localDate'];

describe('recording a weigh-in', () => {
  it('keeps them oldest first, however they arrive', () => {
    const store = createBodyStore(memoryStorage());
    store.record(d('2026-09-03'), 82);
    store.record(d('2026-09-01'), 81);
    expect(store.list().map((w) => w.localDate)).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('replaces the same day rather than appending', () => {
    /*
     * Bodyweight moves a kilo within a day on water alone, so several readings from one
     * morning are noise wearing the clothes of signal — and the aggregate documents
     * `days` as one entry per day. Replacing also makes fixing a typo the same gesture
     * as logging.
     */
    const store = createBodyStore(memoryStorage());
    store.record(d('2026-09-03'), 82);
    const after = store.record(d('2026-09-03'), 81.4);
    expect(after).toHaveLength(1);
    expect(after[0]?.weightKg).toBe(81.4);
  });

  it('survives a storage value that is not what we wrote', () => {
    // Hand-edited, half-written, or from a future version. A bad row must cost the row,
    // never the chart.
    const storage = memoryStorage();
    storage.setItem('ff.body.v1', '{"v":1,"weighIns":[{"localDate":"2026-09-01","weightKg":80},{"nope":true},{"localDate":"x","weightKg":"heavy"}]}');
    expect(createBodyStore(storage).list()).toEqual([{ localDate: '2026-09-01', weightKg: 80 }]);
  });

  it('is unbothered by outright garbage', () => {
    const storage = memoryStorage();
    storage.setItem('ff.body.v1', 'not json at all');
    expect(createBodyStore(storage).list()).toEqual([]);
  });

  it('removes a day', () => {
    const store = createBodyStore(memoryStorage());
    store.record(d('2026-09-01'), 80);
    store.record(d('2026-09-02'), 81);
    expect(store.remove(d('2026-09-01')).map((w) => w.localDate)).toEqual(['2026-09-02']);
  });
});

describe('the aggregate the Body tab reads', () => {
  it('is null with nothing logged, which is the contract for "not materialised"', () => {
    // Not an empty aggregate: every view already renders null as an empty state, and an
    // aggregate with no days is a chart of nothing.
    expect(toBodyMetrics([])).toBeNull();
  });

  it('carries one day per weigh-in, oldest first', () => {
    const out = toBodyMetrics([
      { localDate: d('2026-09-03'), weightKg: 82 },
      { localDate: d('2026-09-01'), weightKg: 80 },
    ]);
    expect(out?.days.map((p) => p.localDate)).toEqual(['2026-09-01', '2026-09-03']);
    expect(out?.days[0]?.weightKg).toBe(80);
  });

  it('means the week rather than taking the last reading', () => {
    // The contract says weekly *mean*, and it says so because a single Friday reading
    // after a heavy meal is not the week.
    const out = toBodyMetrics([
      { localDate: d('2026-08-31'), weightKg: 80 }, // Monday
      { localDate: d('2026-09-02'), weightKg: 82 }, // Wednesday, same ISO week
    ]);
    const weeks = Object.values(out?.weeklyMeanWeightKg ?? {});
    expect(weeks).toEqual([81]);
  });

  it('means the month too', () => {
    const out = toBodyMetrics([
      { localDate: d('2026-09-01'), weightKg: 80 },
      { localDate: d('2026-09-20'), weightKg: 84 },
      { localDate: d('2026-10-01'), weightKg: 90 },
    ]);
    expect(out?.monthlyMeanWeightKg).toEqual({ '2026-09': 82, '2026-10': 90 });
  });

  it('claims no measurement sites, because nothing logs them yet', () => {
    // `measuredSites` drives the measurement picker. Listing a site with no data behind
    // it would offer a dead option.
    expect(toBodyMetrics([{ localDate: d('2026-09-01'), weightKg: 80 }])?.measuredSites).toEqual([]);
  });
});

describe('ISO weeks', () => {
  it('groups a Monday and the Sunday after it together', () => {
    expect(isoWeekOf(d('2026-08-31'))).toBe(isoWeekOf(d('2026-09-06')));
  });

  it('splits a Sunday from the Monday after it', () => {
    expect(isoWeekOf(d('2026-09-06'))).not.toBe(isoWeekOf(d('2026-09-07')));
  });

  it('puts early January in the previous year when ISO says so', () => {
    // 1 Jan 2027 is a Friday, so it belongs to ISO week 53 of 2026. Getting this wrong
    // silently splits a trend across a year boundary.
    expect(isoWeekOf(d('2027-01-01'))).toBe('2026-W53');
  });

  it('does not shift a day for a timezone', () => {
    // The date is already local and is a string; constructing a local Date from its
    // parts and reading UTC fields is how this class of bug appears east of Greenwich.
    expect(isoWeekOf(d('2026-01-01'))).toBe('2026-W01');
  });
});
