# The contribution loop

Constitution rule 8: *give the improvements back.*

## The problem this solves

Both upstreams are US-centric. USDA is a US federal dataset by definition, and
Open Food Facts, while global, has far denser coverage in France and the US than
almost anywhere else. Rank the corpus by likely search frequency and weight it
towards a US locale — which `pipeline/lib/rank.mjs` does — and you ship an index
that is excellent in Ohio and thin in Lagos, Jakarta or Lima.

Buying international food data would breach constitution rule 5 (own the data or
don't ship the feature) and rule 6. Scraping retailer sites is not open data and
not legal to redistribute. The only route to coverage that stays free forever is
that the people who cannot find their food add it to a database everyone can
use.

So international coverage is not a roadmap item we will fund later. It is a loop
we build now, and it either works or the app stays US-centric.

## The loop

```
  user scans a barcode
        │
        ├─ found in a local shard ──────────────────────► log it. done.
        │
        ├─ found in the long-tail cache ────────────────► log it. done.
        │
        ├─ found by the long-tail endpoint ─────────────► log it, cache it. done.
        │
        └─ not found anywhere
                 │
                 ▼
        user enters it manually  ← this already works, offline, always (rule 1)
                 │
                 ▼
        food is saved to the user's OWN store, and they can log it immediately
                 │
                 ▼
        AFTERWARDS, never blocking the log:
        "Add this to Open Food Facts so others can find it?"
                 │
                 ├─ no (default) ──► nothing leaves the device. ever.
                 │
                 └─ yes ──► user reviews exactly what will be sent
                              │
                              ▼
                     submitted to Open Food Facts under THEIR account
                              │
                              ▼
                     next index build picks it up from the OFF dump
                              │
                              ▼
                     every user of this app, and every user of every other
                     app built on Open Food Facts, can now find it
```

## Rules the implementation must follow

**1. The contribution never blocks the log.** The user is mid-meal or
mid-workout. They enter the food, they log it, they move on. The offer to
contribute appears after the log is saved, and dismissing it costs one tap and
never comes back for that food.

**2. Opt-in, per contribution, with the payload visible.** No global "help
improve the app" toggle that silently uploads everything afterwards. The user
sees the exact fields that will be sent, on screen, before they send them. Food
logs are among the most sensitive personal data a person keeps; the default is
that nothing leaves the device.

**3. It goes to Open Food Facts, not to us.** We do not run a food database.
Contributions are submitted to OFF's write API against **the user's own OFF
account** — they authenticate with OFF, and the contribution is theirs, with
their name on it, revocable and editable by them under OFF's own terms.

This matters for three reasons. It is honest: they contributed to a commons, not
to a company. It keeps us out of the business of moderating a food database,
which would be a paid human in the loop (constitution rule 4). And it means the
data is under ODbL from the moment it exists, so nothing we do afterwards can
enclose it.

**4. Only what came off the label.** OFF's terms require contributions to be
information the contributor read from the product's own packaging, not copied
from another database or a retailer's website. The contribution UI must state
this and must not pre-fill from any third-party source.

**5. Photographs are out of scope.** We ingest no OFF images (`../NOTICE.md`
§2.5) and we should not push any either: a photo of packaging carries
trademark and design rights that are not the user's to license, and OFF's
CC-BY-SA image licence does not cover them. Text and numbers only.

**6. Corrections flow back too.** The loop is not only for missing foods. If a
user notices that a food's values are wrong, the same path applies: correct it
locally so their log is right immediately, then offer to push the correction
upstream. This is the higher-value half of the loop — a wrong record harms every
user who finds it, and the person who noticed is the person best placed to fix
it.

**7. Failure is silent and the local record survives.** If OFF is down or the
submission is rejected, the user's own food is unaffected — it is already saved
locally and already logged. The contribution retries in the background at most a
few times and then gives up quietly. A failed act of generosity must never
present itself as the user's problem.

## What this does and does not discharge

**It does not discharge ODbL share-alike.** ODbL §4.4 requires us to offer our
*derived database* under ODbL. We do that by publishing
`food-off-<version>.ndjson.gz` on every index release (`../NOTICE.md` §2.3). The
contribution loop is a separate thing that ODbL does not require at all.

Do not let the two get confused in anyone's head. If the loop works perfectly
and we stop publishing the derived index, we are in breach. If we publish the
index and nobody ever contributes, we are compliant and the app is merely
US-centric.

**What it does discharge is constitution rule 8**, and it does something ODbL
cannot: it makes the data better for everyone, including for people who will
never use this app.

## Measuring it without surveilling anyone

The only number worth watching is the **barcode miss rate by region**, and it
can be computed from the long-tail endpoint's aggregate counters without any
query text, any user identifier, or any food name reaching a server
(`long-tail-contract.md`). A miss rate that falls in a region over successive
index builds is the loop working. A miss rate that stays flat where we have
users is the signal to look at whether the offer to contribute is buried, badly
worded, or asking for too much.

Do not instrument contribution *counts* per user. It would be a leaderboard
waiting to happen, and gamifying a food database is how you get junk in it.
