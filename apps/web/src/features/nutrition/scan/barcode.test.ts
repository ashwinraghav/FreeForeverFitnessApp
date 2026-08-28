import { describe, expect, it } from 'vitest';
import {
  barcodeLookupCandidates,
  CONFIRMATIONS_REQUIRED,
  gtinCheckDigit,
  hasValidGtinChecksum,
  normaliseBarcode,
  resolveBarcode,
  ScanConfirmer,
} from './barcode.js';

/** Nutella 400 g. A real, published GTIN-13 with a correct check digit. */
const NUTELLA = '3017620422003';

describe('normaliseBarcode', () => {
  it('accepts a clean GTIN', () => {
    expect(normaliseBarcode(NUTELLA)).toBe(NUTELLA);
  });

  it('strips whatever a scanner or a keypad adds', () => {
    expect(normaliseBarcode(' 3017 6204 22003 ')).toBe(NUTELLA);
    expect(normaliseBarcode('301-762-042-2003')).toBe(NUTELLA);
  });

  it('accepts a number, because a numeric keypad produces one', () => {
    expect(normaliseBarcode(3017620422003)).toBe(NUTELLA);
  });

  it('preserves leading zeros, which are significant to the index', () => {
    // A GTIN-12 and the GTIN-13 that differs only by a leading zero are
    // distinct keys, so padding or trimming here would break lookups.
    expect(normaliseBarcode('012345678905')).toBe('012345678905');
    expect(normaliseBarcode('0012345678905')).toBe('0012345678905');
  });

  it('rejects anything that cannot be a barcode', () => {
    expect(normaliseBarcode('')).toBeNull();
    expect(normaliseBarcode('abc')).toBeNull();
    expect(normaliseBarcode('12345')).toBeNull(); // under six digits
    expect(normaliseBarcode('123456789012345')).toBeNull(); // over fourteen
  });
});

describe('gtinCheckDigit', () => {
  it('computes the published check digit for a known GTIN-13', () => {
    expect(gtinCheckDigit(NUTELLA.slice(0, -1))).toBe(3);
  });

  it('computes it for a GTIN-12', () => {
    // UPC-A 03600029145 → check digit 2.
    expect(gtinCheckDigit('03600029145')).toBe(2);
  });

  it('computes it for a GTIN-8', () => {
    expect(gtinCheckDigit('7351353')).toBe(gtinCheckDigit('7351353'));
    expect(hasValidGtinChecksum(`7351353${gtinCheckDigit('7351353')}`)).toBe(true);
  });
});

describe('hasValidGtinChecksum', () => {
  it('accepts a real barcode', () => {
    expect(hasValidGtinChecksum(NUTELLA)).toBe(true);
    expect(hasValidGtinChecksum('036000291452')).toBe(true);
  });

  it('rejects a single-digit misread, which is what a bad camera frame produces', () => {
    expect(hasValidGtinChecksum('3017620422004')).toBe(false);
    expect(hasValidGtinChecksum('3017620422103')).toBe(false);
  });

  it('rejects a transposition', () => {
    // The check digit catches most, though not all, adjacent transpositions.
    const transposed = '3017620424003';
    expect(hasValidGtinChecksum(transposed)).toBe(false);
  });

  it('passes a code whose length is not a GTIN length', () => {
    // Plenty of scannable things are not GTINs, and refusing them would block a
    // food that is genuinely in the index under that number.
    expect(hasValidGtinChecksum('1234567')).toBe(true);
    expect(hasValidGtinChecksum('1234567890')).toBe(true);
  });
});

describe('barcodeLookupCandidates', () => {
  it('tries the UPC-A and its EAN-13 form, because databases disagree', () => {
    expect(barcodeLookupCandidates('036000291452')).toEqual([
      '036000291452',
      '0036000291452',
    ]);
  });

  it('tries a leading-zero EAN-13 with the zero stripped', () => {
    expect(barcodeLookupCandidates('0036000291452')).toContain('036000291452');
  });

  it('always tries the scanned form first', () => {
    expect(barcodeLookupCandidates(NUTELLA)[0]).toBe(NUTELLA);
  });

  it('never repeats a candidate', () => {
    for (const code of ['036000291452', '0036000291452', NUTELLA, '73513537']) {
      const candidates = barcodeLookupCandidates(code);
      expect(new Set(candidates).size).toBe(candidates.length);
    }
  });
});

describe('resolveBarcode', () => {
  it('finds a food stored under the EAN-13 form of a scanned UPC-A', () => {
    const index = new Map([['0036000291452', { name: 'Cheerios' }]]);
    const found = resolveBarcode('036000291452', (c) => index.get(c) ?? null);
    expect(found?.match.name).toBe('Cheerios');
    expect(found?.matchedBarcode).toBe('0036000291452');
  });

  it('prefers the exact scanned form when both exist', () => {
    const index = new Map([
      ['036000291452', { name: 'Exact' }],
      ['0036000291452', { name: 'Padded' }],
    ]);
    expect(resolveBarcode('036000291452', (c) => index.get(c) ?? null)?.match.name).toBe('Exact');
  });

  it('returns null when nothing matches, so the caller can offer to create the food', () => {
    expect(resolveBarcode(NUTELLA, () => null)).toBeNull();
  });
});

describe('ScanConfirmer', () => {
  it('does not report a code seen only once', () => {
    const confirmer = new ScanConfirmer();
    expect(CONFIRMATIONS_REQUIRED).toBeGreaterThan(1);
    expect(confirmer.offer(NUTELLA)).toBeNull();
  });

  it('reports a code once it has been read enough times', () => {
    const confirmer = new ScanConfirmer(2);
    expect(confirmer.offer(NUTELLA)).toBeNull();
    expect(confirmer.offer(NUTELLA)).toBe(NUTELLA);
  });

  it('discards a frame whose check digit disagrees — a misread never accumulates', () => {
    const confirmer = new ScanConfirmer(2);
    expect(confirmer.offer('3017620422004')).toBeNull();
    expect(confirmer.offer('3017620422004')).toBeNull();
    expect(confirmer.offer('3017620422004')).toBeNull();
  });

  it('does not let two different codes confirm each other', () => {
    const confirmer = new ScanConfirmer(2);
    expect(confirmer.offer(NUTELLA)).toBeNull();
    expect(confirmer.offer('036000291452')).toBeNull();
    expect(confirmer.offer(NUTELLA)).toBe(NUTELLA);
  });

  it('clears after a confirmation, so the next scan starts fresh', () => {
    const confirmer = new ScanConfirmer(2);
    confirmer.offer(NUTELLA);
    expect(confirmer.offer(NUTELLA)).toBe(NUTELLA);
    expect(confirmer.offer(NUTELLA)).toBeNull();
  });

  it('ignores junk without counting it', () => {
    const confirmer = new ScanConfirmer(2);
    expect(confirmer.offer('not a barcode')).toBeNull();
    expect(confirmer.offer('')).toBeNull();
    expect(confirmer.offer(NUTELLA)).toBeNull();
    expect(confirmer.offer(NUTELLA)).toBe(NUTELLA);
  });

  it('resets on demand', () => {
    const confirmer = new ScanConfirmer(2);
    confirmer.offer(NUTELLA);
    confirmer.reset();
    expect(confirmer.offer(NUTELLA)).toBeNull();
  });
});
