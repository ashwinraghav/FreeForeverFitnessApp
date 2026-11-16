# Privacy, health and liability

One page, three subjects, because splitting them into three would mean three pages nobody
reads. It is written to be checkable, like the rest of this repository: where it makes a
claim, it says how you would verify it.

**Last reviewed:** 2026-09-08. **Not yet reviewed by a lawyer** — see
[Open questions](#open-questions).

---

## 1. Privacy

### There is no account, so there is no profile of you

The app has no authentication code and never asks who you are. Nothing identifies you to
this project, which is why there is no login screen to find, no password to reset, and no
"delete my account" flow — there is no account to delete.

### What the app stores, and where

All of it on your own device, in your browser's storage for this site:

| What | Where |
|---|---|
| Workouts, sets, weights, history | `localStorage` |
| Food log, custom foods, targets | `localStorage` |
| Bodyweight weigh-ins | `localStorage` |
| Progress photos | IndexedDB (pixels are too large for `localStorage`) |

**How to check:** DevTools → Application → Storage. Everything the app has about you is
visible there, in plain form.

### What leaves your device

Nothing you log. The app makes network requests only to fetch **itself** — HTML, JavaScript,
CSS, and the food and exercise datasets it ships. All of them `GET`, all to one domain.

**How to check:** DevTools → Network, then log a set. There is no `POST` request, because
there is nowhere to post to.

There are no cookies (`document.cookie` is an empty string, which is also why there is no
consent banner), no analytics, no error reporting, no advertising SDK, no font CDN, and no
third-party domains.

### The one exception: the server that sends you the app

Like every web server, the host serving these files receives the request that asks for them.
That request contains your IP address, your browser's user-agent string, the path requested,
and a timestamp, and it is written to standard access logs by the hosting provider (Firebase
Hosting, operated by Google).

This is the honest boundary of "nothing leaves your device": your *log* never leaves it, but
*asking for the app* is a network request like any other, and an IP address is personal data.
We do not read these logs to build any picture of you, and there is no identifier in them
that ties a request to anything you have logged — because nothing you log is ever sent.

If you would rather not make that request at all: install the app once, then use it offline.
It works with the aeroplane mode on, indefinitely.

> **To verify before publishing:** the retention period Firebase Hosting applies to access
> logs by default, and whether any of it is configurable. This section should state a number.

### The camera

Barcode scanning uses your camera, with the browser's permission prompt. Frames are decoded
on your device and are never uploaded or stored. The scanning code contains no network calls
at all.

### Deleting everything

Clear site data for this domain in your browser, and it is gone — there is no server copy to
outlive it. **Export first if you want to keep it:** More → App → Download my data gives you
plain JSON of everything.

Because there is no account and no server-side copy, requests to access, correct, or erase
personal data have nothing to act on: you already hold the only copy, and you can read and
delete it without asking anyone.

---

## 2. Health, fitness and nutrition

**This app does not give medical advice, and nothing in it is a substitute for a qualified
professional.**

It does two things that can look like advice, so it is worth being precise about what they
actually are:

- **Calorie and macronutrient targets** are estimates computed from formulas for the general
  population, using the height, weight, age and activity level you enter. They are not
  personalised to your health, medication, history or goals, because the app knows none of
  those things.
- **Progressive-overload suggestions** are arithmetic on the sets you logged yourself. The
  app has no idea whether you slept, whether something hurts, or whether today is the day to
  push.

The intake maths refuses to prescribe below documented floors and tells you when it has
clamped a number rather than silently substituting one — see
[`packages/core/src/nutrition/safety.ts`](packages/core/src/nutrition/safety.ts). Those floors
are a guardrail on a general-population estimate. They are not a judgement about you, and
they are not supervision.

**Please talk to a doctor, dietitian or qualified coach before acting on any number here**, and
especially if you are pregnant or breastfeeding, under 18, managing a medical condition, taking
medication that interacts with diet or exercise, or have any history of disordered eating.

Lifting weights carries a risk of injury. You are responsible for your own training decisions.

If you are struggling with food or your body, a number on a screen is the wrong tool. Please
reach out to someone qualified.

---

## 3. Warranty and liability

The software is licensed under AGPL-3.0 (the app) and Apache-2.0 (`packages/core`,
`packages/design-system`), and those licences disclaim warranty for the code itself — AGPL-3.0
sections 15 and 16, Apache-2.0 sections 7 and 8. See [LICENSING.md](LICENSING.md).

The same applies to the hosted site at `freeforeverfitness.app`, stated separately because
running a website is a different relationship from publishing source code:

- **It is provided as-is, with no warranty of any kind**, express or implied, including
  fitness for a particular purpose.
- **There is no uptime commitment.** This is a free service with no revenue behind it and no
  support rota. It may be slow, broken, or gone.
- **Your data lives on one device and nobody else has a copy.** Clearing your browser storage,
  losing the device, or a browser evicting site data will lose your log, and there is nothing
  anyone can restore. Export backups.
- **To the fullest extent permitted by law, the author is not liable** for any loss or damage
  arising from use of the app or the site, including lost data and any outcome of following a
  number it displayed.

Nothing here removes rights you have under consumer law that cannot be waived.

---

## Changes

This page is versioned in git like everything else, so its full history is public and any
edit is a diff you can read. Material changes will be noted in the release notes rather than
applied quietly.

## Questions and corrections

Open an issue. If something on this page is wrong, that is
[the most valuable issue you can file](https://github.com/ashwinraghav/FreeForeverFitnessApp/issues/new?template=claim_is_wrong.yml).
For anything exploitable, see [SECURITY.md](SECURITY.md) instead.

## Open questions

Left visible rather than resolved with a guess:

1. **No lawyer has read this.** The privacy and liability sections in particular are written
   from what the code does, not from what a jurisdiction requires.
2. **Hosting log retention is unstated** — see the note in section 1.
3. **Whether a formal Terms of Service is needed at all.** With no accounts, no payments and
   no user-generated content, most of what a ToS normally does does not apply here; section 3
   is the part that does. This may be enough, or it may not.
4. **Jurisdiction and governing law are not stated.** Deliberate for now, and a lawyer's call.
