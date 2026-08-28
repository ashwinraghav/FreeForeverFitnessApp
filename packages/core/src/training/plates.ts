import { fromGrams, round4, toGrams } from './load.js';

/**
 * Plate maths.
 *
 * "What do I put on the bar for 102.5kg?" is a question a lifter answers wrong at
 * least once a session, in bad light, out of breath, and the cost of getting it wrong
 * is a failed set. Three properties matter more than elegance here:
 *
 *   1. **It never returns an unbalanced bar.** In `per_side` mode a plate is only
 *      ever placed in pairs. There is no option to turn that off, because there is no
 *      case where an asymmetrically loaded barbell is the right answer and plenty
 *      where it is an injury. Genuinely single-sided loading — a dumbbell handle, a
 *      plate-loaded machine, a landmine — is a different mode, not a flag.
 *   2. **It respects the inventory.** A gym with 20s and 1.25s and nothing between
 *      cannot make 102.5kg, and greedy descent will happily tell you it can by
 *      running out of plates halfway down. This searches the reachable sums instead,
 *      so "closest achievable" means closest with *these* plates, in *this* quantity.
 *   3. **It works in integer grams.** 2.5 + 1.25 + 1.25 in floating point is not 5,
 *      and a plate calculator that is off by 4e-16 shows "104.99999999999999".
 *
 * All arithmetic below is in whole grams for that third reason, and converts back
 * only at the boundary.
 */

export interface PlateStock {
  /** Mass of one plate, kg. */
  readonly kg: number;
  /**
   * How many of this plate the gym has **in total**, across both sides of the bar.
   * Six 20kg plates means three pairs.
   */
  readonly count: number;
}

/** Where the bar's load is hung. Not a preference — a physical fact about the implement. */
export type LoadingMode =
  /** A barbell. The target is bar + collars + two identical stacks. */
  | 'per_side'
  /** A dumbbell handle, landmine or plate-loaded machine: one stack, and it is the total. */
  | 'total';

export interface BarSetup {
  /** Mass of the empty bar, handle or carriage, kg. */
  readonly barKg: number;
  /** Mass of one collar, kg. Two are fitted in `per_side` mode, one in `total`. */
  readonly collarKg?: number;
  readonly plates: readonly PlateStock[];
  readonly mode?: LoadingMode;
}

export interface PlatePlacement {
  readonly kg: number;
  /** How many of this plate go on **one** side in `per_side` mode; in total otherwise. */
  readonly count: number;
}

export type PlateRounding =
  /** Closest achievable load; ties go to the lighter bar. */
  | 'nearest'
  /** Never exceed the target. What a percentage-based program wants. */
  | 'down';

export interface PlateSolveOptions {
  readonly rounding?: PlateRounding;
}

export interface PlateLoad {
  readonly ok: true;
  readonly targetKg: number;
  /** What the bar will actually weigh, bar and collars included. */
  readonly achievedKg: number;
  /** `achievedKg - targetKg`. Negative means the bar is lighter than asked for. */
  readonly deltaKg: number;
  readonly exact: boolean;
  readonly barKg: number;
  readonly collarKg: number;
  readonly mode: LoadingMode;
  /** Heaviest first — the order a plate actually goes on. */
  readonly perSide: readonly PlatePlacement[];
  /**
   * False when the inventory was too large to enumerate and a greedy descent was
   * used instead. Surfaced rather than hidden: a greedy answer can be beaten.
   */
  readonly exhaustive: boolean;
}

export interface PlateLoadImpossible {
  readonly ok: false;
  readonly reason: 'target_below_minimum' | 'invalid_input';
  readonly targetKg: number;
  /** The lightest thing this setup can produce — usually the bare bar. */
  readonly minimumKg: number;
  readonly barKg: number;
  readonly mode: LoadingMode;
}

export type PlateSolution = PlateLoad | PlateLoadImpossible;

/** Standard IWF men's bar. */
export const OLYMPIC_BAR_KG = 20;
/** IWF women's bar. */
export const WOMENS_BAR_KG = 15;
/** A typical EZ / curl bar. Varies by gym, which is why it is a constant to override. */
export const EZ_BAR_KG = 7.5;

/** A well-equipped metric gym. */
export const METRIC_PLATE_STOCK: readonly PlateStock[] = [
  { kg: 25, count: 8 },
  { kg: 20, count: 8 },
  { kg: 15, count: 4 },
  { kg: 10, count: 4 },
  { kg: 5, count: 4 },
  { kg: 2.5, count: 4 },
  { kg: 1.25, count: 4 },
  { kg: 0.5, count: 4 },
];

/**
 * A US gym, in kilograms — because storage is canonical (`units.ts`) and a pound is a
 * display preference. These are the real conversions, not the 20/15/10 the labels
 * round to, so three 45s a side plus the bar reads 142.884kg rather than a fiction.
 *
 * Rounded to the **gram**, deliberately, and not further. The solver works in whole
 * grams, so a constant carried to more places than that contributes a sub-gram error
 * to every plate and then reports a bar that is 2g off as "not exact". Rounding here
 * rather than there keeps `exact` meaning what it says.
 */
export const IMPERIAL_PLATE_STOCK: readonly PlateStock[] = [
  { kg: 20.412, count: 8 }, // 45 lb = 20.41165665 kg
  { kg: 15.876, count: 4 }, // 35 lb = 15.87573295 kg
  { kg: 11.34, count: 4 }, //  25 lb = 11.33980925 kg
  { kg: 4.536, count: 4 }, //  10 lb =  4.5359237  kg
  { kg: 2.268, count: 4 }, //   5 lb =  2.26796185 kg
  { kg: 1.134, count: 4 }, // 2.5 lb =  1.13398093 kg
];

/** 45lb bar, in kilograms, to the gram. */
export const IMPERIAL_BAR_KG = 20.412;

/** Above this many distinct reachable sums the search gives up and goes greedy. */
const MAX_SEARCH_STATES = 40_000;

/**
 * Work out what to put on the bar.
 *
 * @param targetKg the total the lifter asked for, bar included.
 */
export function solvePlateLoad(
  targetKg: number,
  setup: BarSetup,
  options: PlateSolveOptions = {},
): PlateSolution {
  const mode: LoadingMode = setup.mode ?? 'per_side';
  const collarKg = setup.collarKg ?? 0;
  const rounding: PlateRounding = options.rounding ?? 'nearest';

  if (
    !Number.isFinite(targetKg) ||
    !Number.isFinite(setup.barKg) ||
    !Number.isFinite(collarKg) ||
    setup.barKg < 0 ||
    collarKg < 0 ||
    targetKg < 0
  ) {
    return {
      ok: false,
      reason: 'invalid_input',
      targetKg,
      minimumKg: Number.NaN,
      barKg: setup.barKg,
      mode,
    };
  }

  // One collar per side on a barbell; a single-sided implement gets one.
  const sides = mode === 'per_side' ? 2 : 1;
  const baseG = toGrams(setup.barKg) + sides * toGrams(collarKg);
  const targetG = toGrams(targetKg);

  if (targetG < baseG) {
    // The bar alone is heavier than what was asked for. Say so, rather than
    // returning an empty bar and letting the caller believe it hit the target.
    return {
      ok: false,
      reason: 'target_below_minimum',
      targetKg,
      minimumKg: fromGrams(baseG),
      barKg: setup.barKg,
      mode,
    };
  }

  const stock = normaliseStock(setup.plates, sides);
  const remainderG = targetG - baseG;
  // In `per_side` mode the remainder is split between two identical stacks, so an odd
  // remainder is simply not reachable — that is the symmetry guarantee, arithmetically.
  const perSideTargetG = Math.floor(remainderG / sides);

  const smallestUnitG = stock.length > 0 ? (stock[stock.length - 1] as StockG).unitG : 0;
  const capG = rounding === 'down' ? perSideTargetG : perSideTargetG + smallestUnitG;

  const search = reachableSums(stock, capG, perSideTargetG);
  const best = pickBest(search.sums, perSideTargetG, rounding);

  const counts = best === null ? [] : (search.sums.get(best) ?? []);
  const perSide: PlatePlacement[] = stock
    .map((entry, index) => ({ kg: entry.kg, count: counts[index] ?? 0 }))
    .filter((placement) => placement.count > 0);

  const achievedG = baseG + sides * (best ?? 0);

  return {
    ok: true,
    targetKg,
    achievedKg: fromGrams(achievedG),
    deltaKg: fromGrams(achievedG - targetG),
    exact: achievedG === targetG,
    barKg: setup.barKg,
    collarKg,
    mode,
    perSide,
    exhaustive: search.exhaustive,
  };
}

/** The load this setup can actually produce nearest `targetKg`. */
export function closestLoadableKg(
  targetKg: number,
  setup: BarSetup,
  options: PlateSolveOptions = {},
): number | null {
  const solution = solvePlateLoad(targetKg, setup, options);
  return solution.ok ? solution.achievedKg : null;
}

/**
 * Every load this setup can produce, ascending, up to `maxKg`.
 *
 * For a weight picker that only offers reachable numbers — the honest alternative to
 * a free-text field that lets someone log 103.7kg on a bar that cannot make it.
 */
export function loadableWeightsKg(setup: BarSetup, maxKg: number): number[] {
  const mode: LoadingMode = setup.mode ?? 'per_side';
  const sides = mode === 'per_side' ? 2 : 1;
  const collarKg = setup.collarKg ?? 0;
  const baseG = toGrams(setup.barKg) + sides * toGrams(collarKg);
  const maxG = toGrams(maxKg);
  if (maxG < baseG) return [];

  const stock = normaliseStock(setup.plates, sides);
  const capG = Math.floor((maxG - baseG) / sides);
  const { sums } = reachableSums(stock, capG);

  return [...sums.keys()].sort((left, right) => left - right).map((sum) => fromGrams(baseG + sides * sum));
}

/**
 * Round a load to something the gym can actually make, without solving for plates.
 *
 * This is the cheap path used on every progression calculation; `solvePlateLoad` is
 * for the moment the lifter is standing at the rack.
 */
export function roundToIncrement(
  kg: number,
  incrementKg: number,
  rounding: PlateRounding | 'up' = 'nearest',
): number {
  if (!Number.isFinite(kg) || !Number.isFinite(incrementKg) || incrementKg <= 0) return round4(kg);
  const stepG = toGrams(incrementKg);
  const valueG = toGrams(kg);
  const steps = valueG / stepG;
  const rounded =
    rounding === 'down' ? Math.floor(steps) : rounding === 'up' ? Math.ceil(steps) : Math.round(steps);
  return fromGrams(rounded * stepG);
}

/** Total mass of one side's stack, kg. */
export function perSideKg(placements: readonly PlatePlacement[]): number {
  return fromGrams(placements.reduce((total, p) => total + toGrams(p.kg) * p.count, 0));
}

interface StockG {
  readonly kg: number;
  readonly unitG: number;
  /** Usable *per side* — a pair of 20s is one usable 20 on each side. */
  readonly available: number;
}

/**
 * Collapse the inventory to per-side availability, heaviest first, dropping anything
 * that cannot be used. In `per_side` mode an odd plate is unusable: five 10kg plates
 * are two pairs and one that stays on the floor.
 */
function normaliseStock(plates: readonly PlateStock[], sides: number): StockG[] {
  const merged = new Map<number, number>();
  for (const plate of plates) {
    if (!Number.isFinite(plate.kg) || plate.kg <= 0) continue;
    if (!Number.isInteger(plate.count) || plate.count <= 0) continue;
    const unitG = toGrams(plate.kg);
    if (unitG <= 0) continue;
    merged.set(unitG, (merged.get(unitG) ?? 0) + plate.count);
  }

  return [...merged.entries()]
    .map(([unitG, count]) => ({
      kg: fromGrams(unitG),
      unitG,
      available: Math.floor(count / sides),
    }))
    .filter((entry) => entry.available > 0)
    .sort((left, right) => right.unitG - left.unitG);
}

interface ReachResult {
  /** Per-side gram sum -> how many of each stock entry, by index into `stock`. */
  readonly sums: Map<number, number[]>;
  readonly exhaustive: boolean;
}

/**
 * Every per-side sum reachable with this inventory, up to `capG`.
 *
 * A bounded-multiplicity subset sum. Greedy would be shorter and is what most plate
 * calculators do; it is also wrong the moment the inventory is not canonical. With
 * only 20kg and 1.25kg plates, greedy asked for 22.5kg per side takes one 20 and then
 * finds it cannot make 2.5 from a single remaining 1.25, and reports 21.25 — when
 * 21.25 was indeed the best available, but with two 1.25s left it should have said
 * 22.5. Enumerating the reachable set cannot make that class of mistake.
 */
function reachableSums(
  stock: readonly StockG[],
  capG: number,
  greedyTargetG: number = capG,
): ReachResult {
  const sums = new Map<number, number[]>();
  if (capG < 0) return { sums, exhaustive: true };

  sums.set(0, new Array<number>(stock.length).fill(0));

  for (let index = 0; index < stock.length; index += 1) {
    const entry = stock[index] as StockG;
    const additions = new Map<number, number[]>();

    for (const [sum, counts] of sums) {
      for (let taken = 1; taken <= entry.available; taken += 1) {
        const next = sum + taken * entry.unitG;
        if (next > capG) break;
        const nextCounts = counts.slice();
        nextCounts[index] = taken;
        // A sum reachable two ways keeps the combination with fewer plates. It is the
        // same weight either way, and the lifter has to carry every one of them.
        const held = additions.get(next) ?? sums.get(next);
        if (held !== undefined && plateCount(held) <= plateCount(nextCounts)) continue;
        additions.set(next, nextCounts);
      }
    }

    for (const [sum, counts] of additions) sums.set(sum, counts);

    if (sums.size > MAX_SEARCH_STATES) {
      // Pathological inventory. Fall back to a greedy descent rather than hang the
      // main thread between sets, and tell the caller the answer is not provably best.
      return { sums: greedyOnly(stock, greedyTargetG), exhaustive: false };
    }
  }

  return { sums, exhaustive: true };
}

function plateCount(counts: readonly number[]): number {
  let total = 0;
  for (const count of counts) total += count;
  return total;
}

/** Greedy descent, expressed as a one-entry reach map so the caller path is identical. */
function greedyOnly(stock: readonly StockG[], targetG: number): Map<number, number[]> {
  const counts = new Array<number>(stock.length).fill(0);
  let remaining = Math.max(0, targetG);
  for (let index = 0; index < stock.length; index += 1) {
    const entry = stock[index] as StockG;
    const take = Math.min(entry.available, Math.floor(remaining / entry.unitG));
    counts[index] = take;
    remaining -= take * entry.unitG;
  }
  return new Map([[Math.max(0, targetG) - remaining, counts]]);
}

/**
 * Closest reachable sum to the target. Ties go to the lighter bar: told to choose
 * between 2.5kg over and 2.5kg under, put less on. Nobody has ever been annoyed by an
 * easier set they did not ask for; the reverse is a missed rep.
 */
function pickBest(
  sums: ReadonlyMap<number, number[]>,
  targetG: number,
  rounding: PlateRounding,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const sum of sums.keys()) {
    if (rounding === 'down' && sum > targetG) continue;
    const distance = Math.abs(sum - targetG);
    if (distance < bestDistance || (distance === bestDistance && best !== null && sum < best)) {
      best = sum;
      bestDistance = distance;
    }
  }

  return best;
}
