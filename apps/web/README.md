# @freeforever/web

The app. React 19, Vite 6, an offline-first PWA. **AGPL-3.0** — a hosted fork publishes
its source.

## Layout

```
src/app/        routes and the root. Integrator-owned: four features appending to one
                route array is the collision ADR-0018 exists to prevent.
src/shell/      the frame — tab bar, More screen, update prompt, data export,
                diagnostics. Integrator-owned.
src/features/   workout · nutrition · insights. One directory per owning area.
src/data/       local stores and the aggregate sources the insights views read.
```

Each feature owns its directory and nothing outside it
([ADR-0018](../../docs/decisions/0018-monorepo-file-ownership.md),
[`.github/CODEOWNERS`](../../.github/CODEOWNERS)).

## Running it

```bash
pnpm dev        # http://localhost:5173 — no account, no backend, no emulator
pnpm verify     # from the repo root: typecheck, lint, every suite
```

The app is local-first, so there is genuinely nothing else to start. Only sync and
security-rule work needs `pnpm emulators`.

The recording harnesses live in `dev-harness/` and are served only by the dev server —
they used to sit in `public/` and shipped to production for weeks, answering 200 on the
live domain.

## Three things that will catch you out

**1. The test suite cannot see layout.** jsdom has no layout engine, so every element
reports zero size and the suite is green at every viewport because it does not know what a
viewport is. Four real bugs have shipped past it: a rest bar measuring 490px inside a 390px
screen, an `IconButton` with `aspect-ratio: 1/1` growing to 624px, a tab bar 498px wide
inside a 412px phone at 200% text, and a muscle overlay drawn 6 units off centre.

**Open a real browser at 412px and at 200% text before calling a screen done.** There is no
substitute available in this repository.

**2. A test asserting a negative must prove the positive in the same file.** "Not found",
"renders nothing", "unsupported" all pass when the harness never ran. `CLAUDE.md` lists
five specific ways this has happened here — a closed `<dialog>` still being in the DOM, an
element never being its own container-query container, a CSS guard that only guards the
package it parses.

**3. Design tokens are checked for syntax, not existence.** `pnpm lint` fails on a raw hex
colour but cannot tell you `--ff-space-2xs` is fictional. Four invented token names once
shipped and silently resolved to nothing. Grep `packages/design-system/dist/tokens.css`.

## The design context

One hand on a barbell, bad light, out of breath, interrupted every ninety seconds. No
paragraphs in the workout flow. **No modals during a workout** — losing entered sets to a
dismissed dialog is the worst failure in this category. One number per glance.

## Offline

`vite-plugin-pwa` with `registerType: 'prompt'`, so a new build never reloads the page
underneath someone mid-set. The prompt lives in `src/shell/UpdatePrompt.tsx` and the
lifecycle in `src/shell/appUpdate.ts` — one registration for the whole app, because two
components each calling `useRegisterSW()` gave two workers and a button that silently did
nothing.

39 files are precached, including the 913-exercise catalogue, so search works in a basement.
