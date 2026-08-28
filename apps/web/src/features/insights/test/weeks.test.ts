import { describe, expect, it } from 'vitest';
import type { IsoWeek, LocalDate } from '@freeforever/data';
import {
  addWeeks,
  isoWeekOfDate,
  isoWeekOfLocalDate,
  isoWeekStart,
  parseIsoWeek,
  weekWindow,
} from '../select/weeks';

const week = (value: string): IsoWeek => value as IsoWeek;

describe('ISO week arithmetic', () => {
  it('places the four ISO edge cases correctly', () => {
    // 2021-01-01 is a Friday and belongs to ISO week 53 of 2020.
    expect(isoWeekOfDate(new Date(Date.UTC(2021, 0, 1)))).toBe('2020-W53');
    // 2019-12-30 is a Monday and belongs to ISO week 1 of 2020.
    expect(isoWeekOfDate(new Date(Date.UTC(2019, 11, 30)))).toBe('2020-W01');
    expect(isoWeekOfDate(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01');
    // 2026 is a 53-week ISO year.
    expect(isoWeekOfDate(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-W53');
  });

  it('round-trips a week key through its Monday', () => {
    for (const key of ['2020-W53', '2024-W01', '2026-W35', '2026-W53']) {
      const start = isoWeekStart(week(key));
      expect(start).not.toBeNull();
      expect(start?.getUTCDay()).toBe(1);
      expect(isoWeekOfDate(start ?? new Date(0))).toBe(key);
    }
  });

  it('crosses a 53-week year boundary when stepping', () => {
    expect(addWeeks(week('2020-W52'), 1)).toBe('2020-W53');
    expect(addWeeks(week('2020-W53'), 1)).toBe('2021-W01');
    expect(addWeeks(week('2021-W01'), -1)).toBe('2020-W53');
  });

  it('rejects malformed keys instead of guessing', () => {
    expect(parseIsoWeek('2026-W00')).toBeNull();
    expect(parseIsoWeek('2026-W54')).toBeNull();
    expect(parseIsoWeek('nonsense')).toBeNull();
    expect(isoWeekStart(week('nonsense'))).toBeNull();
  });

  it('builds a dense, ordered, correctly sized window', () => {
    const axis = weekWindow(week('2021-W02'), 5);
    expect(axis).toEqual(['2020-W51', '2020-W52', '2020-W53', '2021-W01', '2021-W02']);
    expect(weekWindow(week('2021-W02'), 0)).toEqual([]);
  });


  it('maps a local date to its week', () => {
    expect(isoWeekOfLocalDate('2026-08-28' as LocalDate)).toBe('2026-W35');
    expect(isoWeekOfLocalDate('not-a-date' as LocalDate)).toBeNull();
  });
});
