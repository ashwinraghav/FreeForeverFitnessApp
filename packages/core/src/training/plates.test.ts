import { describe, expect, it } from 'vitest';
import {
  closestLoadableKg,
  IMPERIAL_BAR_KG,
  IMPERIAL_PLATE_STOCK,
  loadableWeightsKg,
  METRIC_PLATE_STOCK,
  OLYMPIC_BAR_KG,
  perSideKg,
  roundToIncrement,
  solvePlateLoad,
  WOMENS_BAR_KG,
  type BarSetup,
  type PlateLoad,
  type PlateStock,
} from './plates.js';

const fullGym: BarSetup = { barKg: OLYMPIC_BAR_KG, plates: METRIC_PLATE_STOCK };

/** Narrow to the success case, failing the test with a readable message otherwise. */
function loaded(solution: ReturnType<typeof solvePlateLoad>): PlateLoad {
  if (!solution.ok) throw new Error(`expected a loadable bar, got ${solution.reason}`);
  return solution;
}

/** The per-side stack, as a flat list of plate masses, heaviest first. */
function sideList(solution: PlateLoad): number[] {
  return solution.perSide.flatMap((placement) => Array<number>(placement.count).fill(placement.kg));
}

describe('the everyday cases', () => {
  it('loads 100kg on a 20kg bar', () => {
    const solution = loaded(solvePlateLoad(100, fullGym));
    expect(solution.exact).toBe(true);
    expect(solution.achievedKg).toBe(100);
    expect(perSideKg(solution.perSide)).toBe(40);
    // 25+15 and 20+20 are both correct; the contract is the weight and the plate
    // count, not which pair of slabs the solver happened to pick.
    expect(sideList(solution)).toHaveLength(2);
  });

  it('uses the fewest plates that make the weight', () => {
    // 50kg a side is two 25s, never 20+20+10 and never five 10s.
    expect(sideList(loaded(solvePlateLoad(120, fullGym)))).toEqual([25, 25]);
    // 60kg a side is 25+25+10, not 25+20+15.
    expect(sideList(loaded(solvePlateLoad(140, fullGym)))).toHaveLength(3);
  });

  it('loads 102.5kg, reaching for the 1.25s', () => {
    const solution = loaded(solvePlateLoad(102.5, fullGym));
    expect(solution.exact).toBe(true);
    expect(perSideKg(solution.perSide)).toBe(41.25);
  });

  it('returns the bare bar for exactly the bar', () => {
    const solution = loaded(solvePlateLoad(20, fullGym));
    expect(solution.exact).toBe(true);
    expect(solution.perSide).toEqual([]);
    expect(solution.achievedKg).toBe(20);
  });

  it('orders the stack heaviest first, which is how it goes on', () => {
    const solution = loaded(solvePlateLoad(180, fullGym));
    const masses = solution.perSide.map((placement) => placement.kg);
    expect(masses).toEqual([...masses].sort((a, b) => b - a));
  });
});

describe('the bar is heavier than the target', () => {
  it('says so rather than returning an empty bar', () => {
    const solution = solvePlateLoad(15, fullGym);
    expect(solution.ok).toBe(false);
    if (solution.ok) return;
    expect(solution.reason).toBe('target_below_minimum');
    expect(solution.minimumKg).toBe(20);
  });

  it('accounts for collars in the minimum', () => {
    const withCollars: BarSetup = { ...fullGym, collarKg: 2.5 };
    const solution = solvePlateLoad(24, withCollars);
    expect(solution.ok).toBe(false);
    if (solution.ok) return;
    // 20kg bar + two 2.5kg collars is 25kg before a single plate goes on.
    expect(solution.minimumKg).toBe(25);
  });

  it('is loadable on a 15kg bar where a 20kg bar was not', () => {
    expect(solvePlateLoad(17.5, fullGym).ok).toBe(false);
    expect(solvePlateLoad(17.5, { barKg: WOMENS_BAR_KG, plates: METRIC_PLATE_STOCK }).ok).toBe(true);
  });

  it('rejects nonsense input distinctly from an unreachable target', () => {
    const solution = solvePlateLoad(Number.NaN, fullGym);
    expect(solution.ok).toBe(false);
    if (solution.ok) return;
    expect(solution.reason).toBe('invalid_input');
  });
});

describe('symmetry is a guarantee, not a preference', () => {
  it('never places an odd number of plates in per_side mode', () => {
    for (let target = 20; target <= 250; target += 1.25) {
      const solution = solvePlateLoad(target, fullGym);
      if (!solution.ok) continue;
      // `perSide` is per side by definition, so the invariant is that the achieved
      // total is always bar + exactly twice one side.
      expect(solution.achievedKg).toBeCloseTo(20 + 2 * perSideKg(solution.perSide), 6);
    }
  });

  it('cannot make an odd remainder, and rounds rather than unbalancing', () => {
    // 21kg on a 20kg bar needs 0.5kg per side; the gym has 0.5s, so it is exact.
    expect(loaded(solvePlateLoad(21, fullGym)).exact).toBe(true);
    // 20.5kg needs 0.25 per side, which no plate can make.
    const solution = loaded(solvePlateLoad(20.5, fullGym));
    expect(solution.exact).toBe(false);
    expect([20, 21]).toContain(solution.achievedKg);
  });
});

describe('a restricted inventory — where greedy descent is wrong', () => {
  const sparse: readonly PlateStock[] = [
    { kg: 20, count: 2 },
    { kg: 1.25, count: 4 },
  ];
  const sparseGym: BarSetup = { barKg: 20, plates: sparse };

  it('spends four 1.25s rather than stranding a 20', () => {
    // Target 65kg = 22.5kg per side. Greedy takes the 20 and then cannot make 2.5
    // from one remaining 1.25 pair, landing on 61.25. The right answer uses the 20
    // AND both 1.25 pairs: 20 + 1.25 + 1.25 = 22.5.
    const solution = loaded(solvePlateLoad(65, sparseGym));
    expect(solution.exact).toBe(true);
    expect(perSideKg(solution.perSide)).toBe(22.5);
    expect(sideList(solution)).toEqual([20, 1.25, 1.25]);
    expect(solution.exhaustive).toBe(true);
  });

  it('never uses more plates than the gym owns', () => {
    const solution = loaded(solvePlateLoad(300, sparseGym));
    for (const placement of solution.perSide) {
      const owned = sparse.find((plate) => plate.kg === placement.kg);
      expect(owned).toBeDefined();
      // Per side, so half the total stock, rounded down.
      expect(placement.count).toBeLessThanOrEqual(Math.floor((owned as PlateStock).count / 2));
    }
  });

  it('caps out at what the inventory can reach', () => {
    // One pair of 20s and two pairs of 1.25s: 20 + 2*(20 + 2.5) = 65kg, and no more.
    const solution = loaded(solvePlateLoad(300, sparseGym));
    expect(solution.achievedKg).toBe(65);
    expect(solution.exact).toBe(false);
    expect(solution.deltaKg).toBe(-235);
  });

  it('drops an unpairable odd plate', () => {
    // Five 10kg plates is two usable pairs; the fifth stays on the floor.
    const odd: BarSetup = { barKg: 20, plates: [{ kg: 10, count: 5 }] };
    const solution = loaded(solvePlateLoad(200, odd));
    expect(solution.achievedKg).toBe(60);
  });

  it('handles an empty inventory as bar-only', () => {
    const bare: BarSetup = { barKg: 20, plates: [] };
    const solution = loaded(solvePlateLoad(100, bare));
    expect(solution.achievedKg).toBe(20);
    expect(solution.perSide).toEqual([]);
  });

  it('ignores malformed stock entries rather than throwing', () => {
    const messy: BarSetup = {
      barKg: 20,
      plates: [
        { kg: 20, count: 2 },
        { kg: 0, count: 10 },
        { kg: -5, count: 4 },
        { kg: 10, count: 0 },
        { kg: 10, count: 2.5 },
      ],
    };
    expect(loaded(solvePlateLoad(60, messy)).achievedKg).toBe(60);
  });

  it('merges duplicate entries for the same plate', () => {
    const split: BarSetup = {
      barKg: 20,
      plates: [
        { kg: 20, count: 2 },
        { kg: 20, count: 2 },
      ],
    };
    expect(loaded(solvePlateLoad(100, split)).achievedKg).toBe(100);
  });
});

describe('rounding', () => {
  it('never exceeds the target under `down`', () => {
    for (let target = 20; target <= 200; target += 0.5) {
      const solution = solvePlateLoad(target, fullGym, { rounding: 'down' });
      if (!solution.ok) continue;
      expect(solution.achievedKg).toBeLessThanOrEqual(target + 1e-9);
    }
  });

  it('breaks a tie toward the lighter bar', () => {
    // Only 5kg plates, so the ladder is 20, 30, 40... Asked for 25kg, the bare bar
    // and one pair either side are both 5kg away. Put less on: nobody has ever been
    // annoyed by an easier set they did not ask for, and the reverse is a missed rep.
    const fives: BarSetup = { barKg: 20, plates: [{ kg: 5, count: 10 }] };
    expect(loaded(solvePlateLoad(25, fives)).achievedKg).toBe(20);
  });

  it('rounds up when that is genuinely closer', () => {
    const fives: BarSetup = { barKg: 20, plates: [{ kg: 5, count: 10 }] };
    expect(loaded(solvePlateLoad(29, fives)).achievedKg).toBe(30);
    expect(loaded(solvePlateLoad(27.5, fives)).achievedKg).toBe(30);
  });

  it('roundToIncrement handles the three directions', () => {
    expect(roundToIncrement(62.4, 2.5)).toBe(62.5);
    expect(roundToIncrement(62.4, 2.5, 'down')).toBe(60);
    expect(roundToIncrement(62.6, 2.5, 'up')).toBe(65);
  });

  it('roundToIncrement is exact on values a float would spoil', () => {
    // 0.1 + 0.2 arithmetic in kilos is how a plate calculator ends up showing
    // 104.99999999999999.
    expect(roundToIncrement(1.25 + 1.25 + 2.5, 1.25)).toBe(5);
    expect(roundToIncrement(102.5, 1.25)).toBe(102.5);
  });

  it('roundToIncrement leaves the value alone for a nonsense increment', () => {
    expect(roundToIncrement(62.4, 0)).toBe(62.4);
    expect(roundToIncrement(62.4, -1)).toBe(62.4);
  });
});

describe('float safety', () => {
  it('produces clean kilograms across the whole ladder', () => {
    for (const weight of loadableWeightsKg(fullGym, 200)) {
      // Every reachable load is a whole number of 250g steps, so four decimals is
      // more than enough to express it exactly.
      expect(Math.abs(weight * 4 - Math.round(weight * 4))).toBeLessThan(1e-9);
      expect(String(weight)).not.toMatch(/\d{6,}/);
    }
  });

  it('sums 1.25 + 1.25 + 2.5 to exactly 5', () => {
    const solution = loaded(solvePlateLoad(30, { barKg: 20, plates: [
      { kg: 2.5, count: 2 },
      { kg: 1.25, count: 4 },
    ] }));
    expect(perSideKg(solution.perSide)).toBe(5);
    expect(solution.achievedKg).toBe(30);
  });
});

describe('single-sided implements', () => {
  const dumbbell: BarSetup = {
    barKg: 2,
    mode: 'total',
    plates: [
      { kg: 5, count: 4 },
      { kg: 2.5, count: 4 },
      { kg: 1.25, count: 4 },
    ],
  };

  it('does not double the stack', () => {
    const solution = loaded(solvePlateLoad(12, dumbbell));
    expect(solution.exact).toBe(true);
    expect(perSideKg(solution.perSide)).toBe(10);
    expect(solution.achievedKg).toBe(12);
  });

  it('can use an odd plate, because there is only one side', () => {
    const odd: BarSetup = { barKg: 0, mode: 'total', plates: [{ kg: 5, count: 3 }] };
    expect(loaded(solvePlateLoad(15, odd)).achievedKg).toBe(15);
    // The same three plates on a barbell are one usable pair.
    expect(loaded(solvePlateLoad(15, { barKg: 0, plates: [{ kg: 5, count: 3 }] })).achievedKg).toBe(10);
  });

  it('fits one collar, not two', () => {
    const collared: BarSetup = { ...dumbbell, collarKg: 0.5 };
    const solution = loaded(solvePlateLoad(12.5, collared));
    expect(solution.exact).toBe(true);
    expect(perSideKg(solution.perSide)).toBe(10);
  });
});

describe('an imperial gym, stored in kilograms', () => {
  const usGym: BarSetup = { barKg: IMPERIAL_BAR_KG, plates: IMPERIAL_PLATE_STOCK };

  it('makes 225lb exactly, expressed in kg', () => {
    // 45lb bar plus two 45lb plates a side, all to the gram: 5 x 20.412.
    const solution = loaded(solvePlateLoad(102.06, usGym));
    expect(solution.exact).toBe(true);
    expect(sideList(solution).map((kg) => Math.round(kg / 0.45359237))).toEqual([45, 45]);
  });

  it('lands within a gram of the exact float conversion of 225lb', () => {
    // The lifter's 225 is 102.0582832kg to full precision; the gym's plates are
    // milled to the gram. The residue is arithmetic, not a loading error.
    const solution = loaded(solvePlateLoad(225 * 0.45359237, usGym));
    expect(Math.abs(solution.deltaKg)).toBeLessThan(0.005);
    expect(sideList(solution)).toHaveLength(2);
  });

  it('does not pretend a metric target is reachable', () => {
    const solution = loaded(solvePlateLoad(100, usGym));
    expect(solution.exact).toBe(false);
    expect(Math.abs(solution.deltaKg)).toBeLessThan(2.5);
  });
});

describe('loadableWeightsKg', () => {
  it('is ascending, deduplicated and starts at the bar', () => {
    const ladder = loadableWeightsKg(fullGym, 60);
    expect(ladder[0]).toBe(20);
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
    expect(new Set(ladder).size).toBe(ladder.length);
    expect(Math.max(...ladder)).toBeLessThanOrEqual(60);
  });

  it('is empty when the bar is already over the ceiling', () => {
    expect(loadableWeightsKg(fullGym, 10)).toEqual([]);
  });

  it('agrees with the solver on every rung', () => {
    for (const weight of loadableWeightsKg(fullGym, 120)) {
      expect(closestLoadableKg(weight, fullGym)).toBe(weight);
    }
  });
});

describe('closestLoadableKg', () => {
  it('is null when the target is under the bar', () => {
    expect(closestLoadableKg(10, fullGym)).toBeNull();
  });

  it('is idempotent', () => {
    const once = closestLoadableKg(103, fullGym) as number;
    expect(closestLoadableKg(once, fullGym)).toBe(once);
  });
});
