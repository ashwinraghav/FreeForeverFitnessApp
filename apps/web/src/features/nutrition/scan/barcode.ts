/**
 * Barcode normalisation and validation. Pure — no camera, no DOM.
 *
 * Split out from the scanner because this is the part that is easy to get
 * subtly wrong and easy to test exhaustively, and because it runs on manually
 * typed barcodes too. A scanner that reads a digit wrong and silently logs the
 * wrong food is worse than one that fails.
 */

/** Matches `barcode` in `packages/data/src/schemas/nutrition.ts`. */
const BARCODE_PATTERN = /^\d{6,14}$/;

/**
 * Strip everything a scanner or a keypad might add. Returns null when what is
 * left cannot be a barcode.
 *
 * Deliberately does not pad or trim to a fixed length: leading zeros are
 * significant to the index, which stores GTIN-12 and the GTIN-13 that differs
 * only by a leading zero as distinct barcodes.
 */
export function normaliseBarcode(raw: string | number): string | null {
  const digits = String(raw).replace(/\D/gu, '');
  return BARCODE_PATTERN.test(digits) ? digits : null;
}

/**
 * GTIN check digit, modulo 10.
 *
 * Defined for GTIN-8, -12, -13 and -14. Weights alternate 3 and 1 from the
 * right, excluding the check digit itself. A camera that misreads one bar
 * usually produces a code that fails this, so checking it turns a silent wrong
 * food into a re-scan.
 */
export function gtinCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  for (let i = digitsWithoutCheck.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(digitsWithoutCheck[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** GTIN lengths the check digit is defined for. Other lengths are not GTINs. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Whether a barcode's own check digit agrees with its payload.
 *
 * Returns `true` for a code whose length is not a GTIN length — plenty of real
 * things scan as codes that are not GTINs, and refusing them would block a user
 * from a food that is genuinely in the index under that number.
 */
export function hasValidGtinChecksum(barcode: string): boolean {
  if (!GTIN_LENGTHS.has(barcode.length)) return true;
  const body = barcode.slice(0, -1);
  const check = Number(barcode[barcode.length - 1]);
  return gtinCheckDigit(body) === check;
}

/**
 * Every form of a scanned code worth trying against the index, most likely
 * first.
 *
 * A UPC-A (12 digits) and its EAN-13 form (the same digits with a leading zero)
 * are the same physical product but different keys, and which one a database
 * holds depends on where the record came from. Open Food Facts is inconsistent
 * about it. Trying both is the difference between "not found" and a scan that
 * works.
 */
export function barcodeLookupCandidates(barcode: string): string[] {
  const out = [barcode];
  if (barcode.length === 12) out.push(`0${barcode}`);
  if (barcode.length === 13 && barcode.startsWith('0')) out.push(barcode.slice(1));
  if (barcode.length === 14 && barcode.startsWith('0')) out.push(barcode.slice(1));
  if (barcode.length === 13) out.push(`0${barcode}`);
  if (barcode.length === 8) out.push(barcode.padStart(13, '0'));
  return [...new Set(out)];
}

/**
 * Resolve a scanned code against a lookup, trying each candidate form.
 *
 * Injected lookup so this is testable without an index, and so the same
 * function serves the bundled index today and a long-tail endpoint later
 * without the call sites changing.
 */
export function resolveBarcode<T>(
  barcode: string,
  lookup: (candidate: string) => T | null,
): { match: T; matchedBarcode: string } | null {
  for (const candidate of barcodeLookupCandidates(barcode)) {
    const match = lookup(candidate);
    if (match !== null && match !== undefined) return { match, matchedBarcode: candidate };
  }
  return null;
}

/** Symbologies worth asking a detector for. Food packaging uses these. */
export const FOOD_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'] as const;

/**
 * A scan is only accepted after the same code is read this many times.
 *
 * One frame is not a scan. Cameras produce transient misreads at the edge of
 * focus, and a wrong food logged from a bad frame is exactly the failure this
 * whole module is built to avoid. Two agreeing reads costs a few tens of
 * milliseconds and removes essentially all of it.
 */
export const CONFIRMATIONS_REQUIRED = 2;

/**
 * Accumulates raw reads and reports a code only once it has been seen enough
 * times. Pure state machine, so the debounce is testable without a camera.
 */
export class ScanConfirmer {
  #counts = new Map<string, number>();
  #required: number;

  constructor(required: number = CONFIRMATIONS_REQUIRED) {
    this.#required = Math.max(1, required);
  }

  /** Returns the barcode once confirmed, otherwise null. */
  offer(raw: string | number): string | null {
    const barcode = normaliseBarcode(raw);
    if (barcode === null) return null;
    // A code whose own check digit disagrees with its payload is a misread.
    if (!hasValidGtinChecksum(barcode)) return null;

    const next = (this.#counts.get(barcode) ?? 0) + 1;
    this.#counts.set(barcode, next);
    if (next < this.#required) return null;
    this.#counts.clear();
    return barcode;
  }

  reset(): void {
    this.#counts.clear();
  }
}
