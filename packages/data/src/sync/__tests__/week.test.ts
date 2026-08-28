import { describe, expect, it } from 'vitest';
import { addDays, epochDayOf, isoMonthOf, isoWeekOf, streaksOf } from '../week.js';

describe('isoWeekOf', () => {
  it('matches known ISO 8601 values, including year-boundary edges', () => {
    expect(isoWeekOf('2026-08-28')).toBe('2026-W35');
    // 2021-01-01 was a Friday belonging to the last week of ISO 2020.
    expect(isoWeekOf('2021-01-01')).toBe('2020-W53');
    expect(isoWeekOf('2021-01-04')).toBe('2021-W01');
    // 2024-12-30 was a Monday belonging to the first week of ISO 2025.
    expect(isoWeekOf('2024-12-30')).toBe('2025-W01');
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
  });

  it('keeps a whole Monday-to-Sunday span in one week', () => {
    // 2026-08-24 is a Monday.
    for (let offset = 0; offset < 7; offset += 1) {
      expect(isoWeekOf(addDays('2026-08-24', offset))).toBe('2026-W35');
    }
    expect(isoWeekOf(addDays('2026-08-24', 7))).toBe('2026-W36');
  });
});

describe('addDays / epochDayOf', () => {
  it('crosses months and leap days correctly', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(epochDayOf('1970-01-02')).toBe(1);
  });
});

describe('isoMonthOf', () => {
  it('is the year-month prefix', () => {
    expect(isoMonthOf('2026-08-28')).toBe('2026-08');
  });
});

describe('streaksOf', () => {
  it('computes current and longest runs without consulting a clock', () => {
    const result = streaksOf([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03', // run of 3
      '2026-08-10',
      '2026-08-11', // run of 2, and it is the most recent
    ]);
    expect(result.longestDays).toBe(3);
    expect(result.currentDays).toBe(2);
    expect(result.lastQualifyingDate).toBe('2026-08-11');
  });

  it('handles empty and single-day inputs', () => {
    expect(streaksOf([])).toEqual({ currentDays: 0, longestDays: 0, lastQualifyingDate: null });
    expect(streaksOf(['2026-08-28']).currentDays).toBe(1);
  });
});
