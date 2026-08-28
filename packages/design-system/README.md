# @freeforever/design-system

Tokens and primitives for TheFreeForeverFitnessApp.

The governing constraint is not brand preference, it is the physical situation
(ADR-0013): a phone held in one chalky hand, in bad light, by someone out of breath,
interrupted every ninety seconds, for 45–90 minutes of screen-on time. Everything
below follows from that.

---

## Setup

Once, at the root of your app:

```ts
import "@freeforever/design-system/tokens.css";  // custom properties, both themes
import "@freeforever/design-system/styles.css";  // primitive styles + reduced motion
```

Using Tailwind v4, add the theme block **after** Tailwind itself:

```css
@import "@freeforever/design-system/tokens.css";
@import "tailwindcss";
@import "@freeforever/design-system/theme.css";
```

Then:

```tsx
import { Button, NumberField } from "@freeforever/design-system";
```

### Choosing a theme

The palette uses the three-state pattern. The complete palette is on bare `:root`,
so a document that stamps nothing still renders correctly:

| Document state | Result |
|---|---|
| no attribute, light OS | light |
| no attribute, dark OS | dark |
| `data-theme="dark"` | dark, beating a light OS preference |
| `data-theme="light"` | light, beating a dark OS preference |

ADR-0013 is dark-first as a *design direction*. The app shell should stamp
`data-theme="dark"` as its default rather than leaving it to the OS; the light theme
is fully designed, not an afterthought, and a user who asks for it gets it.

---

## The rule: no raw literals (ADR-0021)

**No hex colours. No raw `px` spacing. No raw durations. Anywhere outside this package.**

Six teams building UI in parallel will produce six slightly different greys unless
something mechanical prevents it. That something is a lint rule, not a review comment:

```js
// eslint.config.js
import freeforever from "@freeforever/design-system/eslint";

export default [
  ...freeforever.configs.recommended,
];
```

It fails the build on hex colours anywhere, and on `px`/duration literals in any
style position. It deliberately leaves user-facing copy alone — `"Rest 90s"` is not a
violation — because a rule that cries wolf gets switched off, and then it enforces
nothing.

The Tailwind theme block enforces the same rule from the other side: it clears
Tailwind's stock scales (`--color-*: initial`), so `bg-red-500` and `p-7` simply do
not exist. There is no utility class that can smuggle a raw value in.

**If you need a value that does not exist, add a token here.** That is the intended
path, and it is cheap. Do not add an eslint-disable.

### What to write instead

| Instead of | Write |
|---|---|
| `color: #FF7A33` | `color: var(--ff-color-accent)` |
| `padding: 16px` | `padding: var(--ff-space-16)` |
| `transition: 180ms` | `transition: var(--ff-duration-base)` |
| `border-radius: 8px` | `border-radius: var(--ff-radius-lg)` |
| `min-height: 48px` | `min-block-size: var(--ff-hit-min)` |
| `border: 1px solid …` | `border: var(--ff-border-hairline) solid …` |
| `var(--ff-border, 1px)` | `var(--ff-border-hairline)` — a fallback literal is still a literal |
| a hex in a canvas chart | `colorFor(theme, "accent")` from `@freeforever/design-system/tokens` |

---

## Tokens

`tokens/tokens.json` is the single source of truth. A build step emits three
artefacts from it, so they cannot drift:

| Artefact | For |
|---|---|
| `dist/tokens.css` | CSS custom properties, both themes |
| `dist/tokens.ts` | typed exports — canvas charts, native status bars |
| `dist/theme.css` | Tailwind v4 `@theme` block |

Everything in `dist/` is generated and carries a do-not-edit banner. Regenerate with
`pnpm --filter @freeforever/design-system build:tokens`. `test/tokens-sync.test.ts`
fails if an artefact disagrees with the source, which also catches a hand-edit.

### Colour

Four surfaces, three text weights, five semantic colours. Each token declares a
`role` in `tokens.json`, and the role decides which contrast threshold CI holds it to.

```
--ff-color-ground     app background
--ff-color-surface    default panel
--ff-color-raised     elevated card, sheet, popover
--ff-color-sunken     inset field wells, track backgrounds

--ff-color-fg-primary     the number you are reading mid-set
--ff-color-fg-secondary   labels and supporting copy
--ff-color-fg-muted       placeholders, ghost values, timestamps

--ff-color-accent     the single safety-orange signal
--ff-color-info --ff-color-success --ff-color-attention --ff-color-danger

--ff-color-hairline     decorative rule between rows
--ff-color-line-strong  boundary of an interactive control (held to 3:1)
```

Use `--ff-color-on-accent` (and `on-info`, `on-success`, …) for a label drawn on a
solid fill. Do not guess — those pairings are asserted.

**Colour never carries meaning alone.** Every semantic state also has a glyph or a
shape, so it survives greyscale, colour-vision deficiency and a sun-washed screen.
`Badge` and `Toast` ship their glyph by default; if you build something new with a
tone, pair it with a shape too.

### Scales

```
space      4 8 12 16 20 24 32 40 48 64          (rem)
radius     none(0) sm(3) md(5) lg(8) full        (px)
border     hairline(1) strong(2)                 (px)
hit        compact(44) min(48) mid-set(56)       (px, on purpose)
duration   fast(120) base(180) slow(240)
easing     --ff-ease-standard: cubic-bezier(.2,0,0,1)
type       display-xl(44) display-lg(34) title(22) heading(18)
           body(16) body-sm(14) label(12) caption(11)     (all in rem)
```

Type is emitted in `rem` so the app works at a 200% text setting. Hit targets are
emitted in `px` on purpose: a thumb does not get bigger when the root font size does.

`tabular-nums` is set on `:root`. Every number in this product is compared to the
last one, so digits must not shift width between glances.

### Plate colours

IWF calibrated plate colours live in a separate domain group and are **identical in
both themes**, because a 20kg plate is blue in a dark gym too. ADR-0013 carves them
out of the blueprint palette deliberately: this is the language already printed on
the equipment.

Two rules if you render a plate:

1. Always draw it with a `--ff-color-line-strong` outline. The 5kg white and the
   1.25kg grey do not separate from a light surface on their own.
2. Always print the mass on the slab. Colour alone never identifies a plate. The
   label colour per plate is in the token file and is asserted at 4.5:1.

`platesDescending` is exported ready-sorted for a greedy plate-loading solve.

**Do not hand-write a plate custom-property name.** The CSS name is not the same
string as the token key: a `.` is not valid in a CSS ident, so `kg-2.5` is emitted as
`--ff-plate-kg-2_5-fill`. Import the reference instead, keyed exactly like `plates`:

```ts
import { plateVar, plates, plateOutlineVar } from "@freeforever/design-system/tokens";

plateVar["kg-2.5"].fill;   // "var(--ff-plate-kg-2_5-fill)"
plateVar["kg-2.5"].label;  // "var(--ff-plate-kg-2_5-label)"
plates["kg-2.5"].fill;     // "#8B939B"  - a literal, for canvas
```

An underscore rather than an escaped `\.` is deliberate: an escaped dot is valid CSS,
but anyone who later types `var(--ff-plate-kg-2.5-fill)` without the backslash gets
silence rather than an error. A token whose correct spelling is easy to typo
invisibly is a bad token, so the spelling is something you import.

---

## Primitives

22 of them: `Button` `IconButton` `NumberField` `TextField` `Select` `Toggle`
`Checkbox` `Radio` `Chip` `Badge` `ProgressBar` `Meter` `Skeleton` `Divider`
`Sheet` `Dialog` `Toast` `Tabs` `SegmentedControl` `List` `EmptyState` `Avatar`.

Every one has a test and a Storybook story showing both themes — enforced by
`test/completeness.test.ts`, not by good intentions.

### What they guarantee

- **48px minimum hit target, 56px for `xl`.** Button sizes differ in type size and
  padding, never in how easy they are to hit. `xl` is the mid-set size, for anything
  tapped between sets with one hand.
- **A visible focus ring on everything interactive.** Two-tone — an inner ring that
  contrasts with the control's own fill and an outer ring that contrasts with the
  page — so it stays visible on an accent button. There is a `forced-colors`
  fallback, because that mode discards `box-shadow`.
- **An accessible name that cannot be omitted.** `IconButton` does not compile
  without one:
  ```tsx
  <IconButton icon={<PlusGlyph />} />                      // Type error.
  <IconButton icon={<PlusGlyph />} aria-label="Add set" /> // Fine.
  ```
- **`prefers-reduced-motion` honoured globally**, in one unscoped block in
  `styles.css` — not per component, so a new component is covered on the day it is
  written. Durations collapse to 1ms rather than 0, so `transitionend` still fires.

### NumberField

The most important control in the product. Three things it gets right:

```tsx
<NumberField
  label="Weight"
  unit="kg"
  step={2.5}
  value={value}          // null means "nothing entered", which is not zero
  ghostValue={60}        // last session's number, shown until the user types
  onValueChange={setValue}
/>
```

1. `inputMode="decimal"` — never a generic keyboard. There is no prop to turn it off.
2. The **ghost value** is visibly not an entered value: muted, lighter weight, and
   dashed-underlined, so the difference survives bad light and greyscale. Tapping `+`
   on a carried-over 60kg gives 62.5kg, not 2.5kg.
3. Steppers at 56px, because typing while holding a dumbbell is not realistic.

`null` is not `0`. An empty set and a set of 0 reps are different facts, and the
component keeps them different.

### Sheet vs Dialog

**No modals during a workout** (CLAUDE.md) — losing entered sets to a dismissed
dialog is the worst failure mode in this category.

- `Sheet` is non-blocking by default and is what you reach for mid-workout.
- `Dialog` is a real modal built on native `<dialog>`. It is for settings,
  destructive confirmations and onboarding. Keep it out of the workout flow.

### ProgressBar vs Meter

`ProgressBar` is progress through a task with a known end (`role="progressbar"`).
`Meter` is a measurement inside a range — macros against a target (`role="meter"`).
Screen readers announce them differently; picking the wrong one is a real bug.

---

## Contrast is a unit test, not a review comment

`test/contrast.test.ts` implements WCAG 2.2 relative luminance from the spec and
asserts, for **both** themes:

- body text at **4.5:1** against every surface
- UI component boundaries and large text at **3:1**
- every declared foreground-on-fill pair
- every plate's printed mass at 4.5:1 against its own fill

A colour can only escape those assertions by being marked `decorative`, and that
escape hatch costs a written justification in the token file, which is itself
asserted. **If a pair fails, fix the token.** Do not lower a threshold, and do not
reclassify a colour to make a failure go away.

### Tokens adjusted to pass

Seven of the specified values failed WCAG 2.2 AA and were adjusted. Each was moved
along lightness only — hue and saturation are unchanged — by the smallest step that
cleared the threshold, so the palette's character is intact.

| Token | Theme | Before | After | Failed | Now |
|---|---|---|---|---|---|
| `fg-muted` | dark | `#6F8397` | `#8596A7` | 3.51:1 on `sunken` | 4.52:1 |
| `fg-muted` | light | `#6F8098` | `#57657A` | 3.09:1 on `sunken` | 4.54:1 |
| `accent` | light | `#C74E19` | `#AC4316` | 3.55:1 on `sunken`, and 4.63:1 for white-on-accent | 4.51:1 / 5.88:1 |
| `success` | light | `#1E7F4E` | `#1B7246` | 3.83:1 on `sunken` | 4.55:1 |
| `attention` | light | `#8A6100` | `#855D00` | 4.25:1 on `sunken` | 4.52:1 |
| `line-strong` | dark | `#2C4055` | `#5379A0` | 1.29:1 on `sunken` | 3.01:1 |
| `line-strong` | light | `#B2BECE` | `#6B82A1` | 1.44:1 on `sunken` | 3.02:1 |

The two `line-strong` moves are the large ones, and they are the important ones. At
1.3:1 a "strong line" was invisible as a control boundary — a field border you cannot
see is not a field border. It is now held to WCAG 1.4.11 at 3:1 against **all four**
surfaces, including `sunken`, because a field filled with `sunken` sitting on
`surface` must be distinguishable from both. The decorative `hairline` token is
unchanged and keeps its original weight for non-semantic rules between rows.

---

## Emitted CSS is a public interface

`packages/design-system` is Apache-2.0 so it can be reused outside this project
(ADR-0003), which makes the custom properties in `dist/` published API, not an
implementation detail.

Two mechanisms keep them valid:

- **The build fails** if it would emit a custom-property name that is not a valid
  `<dashed-ident>`. Both declarations and `var()` references are checked, in all three
  artefacts.
- **`test/css-idents.test.ts`** asserts the same property over the emitted files, plus
  that every `--ff-*` reference resolves to something actually declared.

This is the same class of problem as the contrast suite — a mechanical property of the
output that no human will re-check, and that fails *silently*. An invalid custom
property does not throw; it resolves to nothing, so a colour just does not appear.

## Scripts

```
pnpm build:tokens   regenerate dist/ from tokens/tokens.json
pnpm test           build tokens, then run the full suite
pnpm storybook      the component gallery, with a theme toolbar and the a11y addon
```

## Fonts

Self-hosted, subset to latin, WOFF2, variable, ~120KB budget (ADR-0014). No Google
Fonts CDN: the app renders fully offline with zero third-party requests, which is
non-negotiable for a gym in a basement. The family tokens (`--ff-font-sans`,
`--ff-font-numeric`) are defined here with a system fallback stack; the face files
and their `@font-face` block are added by the app shell.

## Licence

Apache-2.0 (see `LICENSE`). The rest of the repository is AGPL-3.0-or-later; this
package is permissively licensed so the design system can be reused (ADR-0003).
