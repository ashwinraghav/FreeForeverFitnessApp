# ADR-0032: A serving is a thing you eat, not a quantity

- **Status:** Accepted
- **Date:** 2026-08-31
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The project owner reported, of the food logging sheet: *"I see an amount and then a serving
(where the only option is 100g)"*, and separately set the acceptance test — *"I should just be
able to select Optimum Nutrition and select one serving, and a subtitle appears that it's one
scoop, roughly about 120 calories... not an editable thing, just a subtitle."*

Two defects sat behind that, and the first was worse than the report suggested.

**Every food without a stated serving opened on one gram.** `servingsForFood` pushed
`GRAM_SERVING` before `HUNDRED_GRAM_SERVING` whenever the dataset row carried no serving mass,
and `PortionSheet` opened on `quantity = 1`. So the sheet's initial state was "1 g" — one gram
of chicken, 1.65 kcal. **A test asserted this ordering** ("grams first, then 100 g"), which is
why it survived: the test encoded the picker's construction order and never asked what the
first row meant when combined with the default quantity.

**A serving named for a quantity forces the amount beside it to become a multiplier.** With a
"100 g" row selected, the quantity field means *multiples of 100 g* — so logging 150 g requires
typing `1.5`, and the sheet reads "1 × 100 g". That is the shape the owner called noisy. The
unit and the amount were fighting for the same job.

## Decision

**A serving is a thing a person eats — a scoop, a slice, a portion — never a quantity.**

- The `100 g` row is removed from the picker. `defaultPortion` opens on **100 grams** instead:
  the same number, in a field that reads `100 g`, where the amount is an amount and the unit is
  a unit.
- A food's stated serving stays first when it has one, so Gold Standard Whey opens on `1 scoop`.
- The serving is presented as a **read-only subtitle**, as the owner asked: `1 scoop (31 g) ·
  ~120 kcal · 24 g protein`. Energy is rounded to whole units behind a `~`; mass follows the
  app's existing macro rounding rule, so the subtitle can never disagree with the figures
  rendered beside it.
- `normaliseStatedServingName` reduces dataset labels to the thing eaten: `1 Scoop` and
  `1 scoop (31 g)` both become `scoop`. **`2 tbsp` is kept whole** — reducing it to `tbsp`
  would silently halve every amount logged against it. Labels that only restate the mass
  (`33g`, `177.441g`) carry no wording and get none.

## Consequences

The picker no longer offers a row whose selection changes what the number beside it means.

Two 200%-text overflows were found and fixed in the same work, neither visible to any test
here: `.ffn-fields-2`'s rem-based minimum doubled to 512px inside a 412px phone and pushed the
sheet sideways, and `.ffn-sheet-actions` put "Log it" off the right edge. Both are the class of
bug CLAUDE.md records as untestable in jsdom — found by opening a browser at 200% text.

The removed test is the lesson worth keeping. It asserted the order of a list rather than the
meaning of its first element under the sheet's default quantity, so it passed while the feature
shipped one gram of everything. **A test that pins construction order can hold a defect in
place.** Assert what the user sees on open, not how the array was built.

## Alternatives considered

**Keep `100 g` and default the quantity to 1** (rejected: the status quo, and the reported bug —
a multiplier masquerading as a unit).

**Make the serving subtitle editable** (rejected: explicitly not what was asked for. The owner
wanted a fact to read, not another control to operate one-handed, out of breath, mid-set.)

**Drop foods with no stated serving from the index** (rejected: they are the USDA reference
foods — plain chicken, rice, dal — which ADR-0030's ranking work shows are what people most
want for a generic query. Opening them on `100 g` is correct, not a fallback.)
