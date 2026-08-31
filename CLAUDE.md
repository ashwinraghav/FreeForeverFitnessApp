# Working in this repository

Read [`docs/decisions/README.md`](docs/decisions/README.md) before making any architectural choice.
The ADRs are binding, not advisory. If you disagree with one, write a superseding ADR — do not
quietly work around it.

## The five constraints that govern everything

1. **Free forever is a build constraint.** No feature may add unbounded per-user cost.
   Quotas ship in the same PR as the feature they bound. (ADR-0001)
2. **The zero-cost path ships first.** A feature's deterministic version must work standalone
   before an AI-assisted version is layered on. AI is a garnish, never load-bearing. (ADR-0016)
3. **Firestore is a sync engine, never a query engine.** Reads come from the local cache;
   analytics read locally materialised aggregates. A Firestore query that renders a chart is a
   bug, not an optimisation opportunity. (ADR-0005)
4. **No raw literals.** No hex colours, raw `px` spacing or durations outside
   `packages/design-system`. Tokens only — CI enforces it. (ADR-0021)
5. **This repository is public.** No secrets, ever. The Firebase *client* config is safe and
   committed deliberately; service-account keys, provider API keys and Terraform state are not.
   (ADR-0010, SECURITY.md)

## File ownership

Teams write only inside directories they own (ADR-0018). Need a change elsewhere? Report it to
the integrator rather than reaching across.

Ownership is enforced per **directory**, so it cannot see a collision that lives in a shared
**string**. Two teams styling one CSS class name is invisible to the model: the shell's
`.ff-tab` and the design system's `.ff-tab` sat in different owned files and silently fought,
and a design-system change would have restyled the app's primary navigation. Prefix a class
with the component that owns it, and grep the other packages before claiming a name.

| Area | Owns |
|---|---|
| design-system | `packages/design-system` |
| domain-model | `packages/data` (except `src/sync`), `firestore.rules`, `storage.rules` |
| sync | `packages/data/src/sync`, Firebase client init, **App Check enforcement** |
| workout | `apps/web/src/features/workout`, `packages/core/src/training` |
| nutrition | `apps/web/src/features/nutrition`, `packages/core/src/nutrition` |
| insights | `apps/web/src/features/insights` |
| infra | `infra/`, `.github/` |
| datasets | `packages/datasets` |
| integrator | root config, `apps/web/src/app`, `apps/web/src/shell`, **CSP**, **service worker** |

Root config (`package.json`, `tsconfig.base.json`, `apps/web/src/app/routes.ts`) is
integrator-only. Feature teams never edit the route manifest — four teams appending to one
array is exactly the collision this model exists to prevent.

## Before any fan-out: audit this map (ADR-0023)

Strict ownership converts collision risk into **coverage** risk. It prevents two agents
touching one file; it does nothing about a file nobody was assigned, and nobody reports a
gap in their own brief. That is how the Cloud Storage ruleset came to be missing while
every Firestore rule was carefully tested.

So before each fan-out the integrator enumerates every security-relevant artefact and
confirms each has a named owner. Currently: `firestore.rules`, `storage.rules`, Content
Security Policy, the service worker, App Check enforcement, auth and account-linking, and
(from Phase 3) the AI proxy and its quotas. **An artefact with no owner is a defect in this
map, not an oversight by a team.**

## No test in this repo can catch a layout bug

jsdom has no layout engine. Every element reports zero size, so the whole suite is green
at every viewport because it does not know what a viewport is. This is not a gap that
more tests fix — it is a gap the test *environment* cannot address.

It has already cost real bugs three times, each found only by opening a browser:

- The rest bar measured 490px inside a 390px screen and pushed the button that ends the
  rest off the right edge. A grid item's default `min-width: auto` refused to shrink.
- An `IconButton` with `aspect-ratio: 1 / 1` sat in a `1fr` column of a full-width grid,
  so at 1920px it became 624px wide and therefore 624px tall, stretching the whole action
  bar to 649px and burying the screen. **The same bug was present at 390px** — 114px
  instead of 81px — survivable, which is exactly why nobody caught it there.
- The bottom tab bar measured 498px inside a 412px phone **at 200% text**, scrolling the
  whole document sideways. `grid-auto-columns: 1fr` is `minmax(auto, 1fr)`, and that `auto`
  floor is content width, so "Progress" widened its own column and the four columns stopped
  being equal. Fixing it needed `minmax(0, 1fr)` in **three** nested places — the strip's
  columns, the item's `min-width`, and the item's own implicit track — because each level
  refused to shrink independently. The real cause was one level further out again: the
  shell's nav reused the class name `.ff-tab`, which **the design system already owns** for
  its Tabs primitive, and so inherited `padding-inline: var(--ff-space-16)` meant for a
  segmented control — 32px a side at 200% text, leaving 39px of a 103px tab for a label
  needing 66px. Renamed to `.ff-navbar`/`.ff-navtab`.

Two rules follow, and a third habit that took three separate mistakes today to learn:
**a mechanism that plausibly could fire is not evidence that it did, and a number moving in the
right direction is not evidence it crossed the line.** Both were asserted here without
measurement, in both directions — once to claim a bug was harmless, once to claim it was
serious. The harness was open each time.


1. **Check a real browser at more than one viewport before calling a screen done.**
   `pnpm dev` and resize. Four minutes found the second bug; nothing else would have.
2. **Be suspicious of `aspect-ratio` and of any intrinsically-sized control inside a
   flexible track.** Both bugs were a sizing rule meeting a container that grows.

If a layout assertion ever becomes testable here it will need a real browser
(Playwright or similar) — a tier this repo does not yet have. Until then this is on
whoever opens the app.

## Two jsdom traps that make tests pass for the wrong reason

Both found the hard way. A test that passes because it never exercised anything is
worse than a failing one, so check for these before trusting a green DOM suite.

**1. `import.meta.url` is rewritten under the jsdom project.** Vite prefixes it with
`/@fs` **and drops the trailing slash from `URL.pathname`**, while the node project keeps
it — so a naive join produces `.../buildmanifest.json` and silently misses every file. A
stubbed `fetch` then 404s, and assertions about "not found" behaviour pass against an
index that never loaded. Use the shared fixture-path helper rather than building paths by
hand, and **make your fetch stub throw on a missing fixture rather than returning a
404** — then a broken path fails loudly instead of quietly confirming what you expected.

**2. jsdom defines `DecompressionStream` but its `Blob` has no `.stream()`.** Feature
detection therefore says gunzip is available and the call throws. Serve
pre-decompressed bytes in tests; the datasets reader supports that path explicitly.

**3. A closed `<dialog>` is still in the DOM.** The browser hides it with a UA stylesheet
jsdom does not apply, so `queryByText('Delete this session?')` finds the heading whether the
dialog is open or shut — and an assertion built on it passes in both states. Read `dialog.open`
off the element instead. Note also that a `showModal`/`close` shim buys content and behaviour
assertions and **none** of the modality: focus trapping and Escape are platform behaviour, and
only a real browser sees them.

**4. An element is never its own container query container.** A `@container` condition is
evaluated against the nearest *ancestor* container, so a selector matching the container itself
resolves against its parent — and with no ancestor container, never matches. This fails silently
and asymmetrically: overriding `--ffw-cols` on `.ffw-card` inside `@container (inline-size <
18em)` did nothing, while the rule beside it hiding a *descendant* matched fine. The result was a
column hidden with its grid track still in place, so the value cells got **narrower** (34px) than
the 47px bug being fixed. Every test stayed green. Set the property on the descendants that read
it, and assert that no container-class selector appears inside the query block.

Worth pairing with why that query was in `em` at all: at 200% text the viewport is not narrow,
the *text* is large. `em` inside `@container` resolves against font size, so 412px reads as
25.8em at 100% and 12.9em at 200%. A `max-width` media query would punish the 412px phone this
app is designed for and miss the case that is actually broken.

**5. A CSS guard only guards the package it parses.** `hit-targets.test.ts` reads
`primitives.css` and fails the build on a `min-inline-size: 0` that would let a value collapse to
nothing. It cannot see a rule in `apps/web` overriding the same property on the same class, so a
scoped override in another package reintroduces the regression invisibly. Same seam as the units
correction in ADR-0032: the check and the thing being checked are in different packages, so the
check is *silent* about the other side rather than wrong. If you find yourself writing another
package's class name into your stylesheet, that is the signal — and the fix belongs upstream, not
in a permanent local override.

**And a static guard is deliberately blunter than the rendering.** That same rule pins the
declaration regardless of context, which is correct for a shared primitive — but it means its
verdict can be stricter than what the browser actually does. Measured: `min-inline-size: 0` is
dangerous *alone*, because the well is `flex: 1` beside two steppers and is the only thing that
can absorb the deficit; *paired with* `flex-wrap: wrap` the steppers take their own line and the
zero minimum is close to inert (well 204px, input 206px, value still readable). So a guard firing
is a reason to stop and measure, not proof of the harm it names.

**And read the owning package's tests before proposing a change to it.** A fix that looks
obviously right from outside may be one the owner already tried and removed, with the reason
recorded in a test rather than in the CSS. The absent declaration is invisible; only the guard
explains it.

The general rule: when a DOM test asserts a negative — not found, unsupported,
degraded — prove the positive case works in the same file. Otherwise you cannot tell a
real negative from a harness that never ran.

## Accessibility is not negotiable

WCAG 2.2 AA. 48px minimum hit targets, 56px for anything tapped mid-set. Never colour as the
only signal. Works at 200% text size. Full keyboard operation with a visible focus ring.
These are CI-enforced, not review comments. (ADR-0013)

## The design context

The user is holding a weight in one hand, in bad light, out of breath, interrupted every 90
seconds, for 45–90 minutes of screen-on time. No paragraphs in the workout flow. No modals
during a workout — losing entered sets to a dismissed dialog is the worst failure mode in this
category. One number per glance.

## Conventions

- TypeScript strict. No `any`, no non-null assertions without a comment justifying them.
- Tests and a Storybook entry ship with a component, not in a follow-up.
- Commits are signed off: `git commit -s` (DCO, ADR-0003).
- Anything worth arguing about becomes an ADR in the same PR: `pnpm adr "Title"`.
