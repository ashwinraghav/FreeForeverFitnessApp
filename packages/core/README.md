# @freeforever/core

Training and nutrition maths. **Apache-2.0**, deliberately — this is the part of the
project most worth reusing, and the licence should not stop anyone.

## What is in here

Pure functions. No I/O, no React, no Firebase, no `window`. Give it numbers, get numbers
back. That is what makes it testable to the degree it is: 482 tests over 21 source files.

```
src/training/     progression, volume, e1rm, plates, records, load, energy
src/nutrition/    targets, safety floors, portions, recipes, day totals, nutrients
```

Two worth knowing about before you use them:

- **`training/progression.ts`** — four progression schemes (linear, double, RPE,
  percent-of-max). Every rule reads the same three facts out of the last session: did the
  working sets complete, what was the worst rep count, how hard did it feel. Deterministic,
  no model, no network. A `failed` set never earns a progression — that state is exactly
  the signal these rules exist to read.
- **`nutrition/targets.ts`** — calorie targets with hard, explained safety floors
  ([ADR-0027](../../docs/decisions/0027-calorie-safety-floors.md)). A prescription below
  the floor is raised, and the adjustment is reported rather than silently applied.

## Rules for changing it

**Nothing in here may reach for I/O.** The moment this package imports a browser API or a
network client it stops being the thing that can be reused and tested cheaply. If you need
a clock or a random number, take it as an argument.

**Every prescribed load is rounded onto an increment the gym can make.** A prescription of
62.4kg is not a prescription.

**Safety invariants get swept, not sampled.** `targets.test.ts` runs an exhaustive sweep
over every combination of sex, activity, goal, bodyweight, height, age and rate. It is slow
on purpose and carries an explicit 30s timeout; the answer to "the exhaustive check is
slow" is never "check less".

## Running it

```bash
pnpm --filter @freeforever/core test
```

There is a `vitest.config.ts` here for one reason: `tsc -b` emits compiled tests into
`dist/`, and without excluding it vitest collected both copies and ran every test twice.
It went unnoticed for weeks because it only shows up after a typecheck.
