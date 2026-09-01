# `@freeforever/datasets`

The on-device food index and exercise catalogue, and the pipeline that builds
them. This package is why food search works offline, instantly, and at zero
recurring cost (ADR-0006).

**Before you touch anything here, read [`NOTICE.md`](./NOTICE.md).** This package
carries the project's only binding legal obligation — Open Food Facts is
ODbL-licensed, with attribution *and* share-alike — and several of the design
decisions below exist to satisfy it rather than for engineering reasons.

## Contents

| Path | What |
|---|---|
| [`NOTICE.md`](./NOTICE.md) | **Upstream licences and what they require of us. Binding.** |
| [`docs/food-index-format.md`](./docs/food-index-format.md) | **The output contract. The nutrition team codes against this.** |
| [`docs/search-index-design.md`](./docs/search-index-design.md) | Index structure, with the measurements that chose it |
| [`docs/normalisation.md`](./docs/normalisation.md) | Per-100 g rules, validation, dedupe, ranking |
| [`docs/exercise-catalogue.md`](./docs/exercise-catalogue.md) | **Exercise contract — read the load-cost warning before importing** |
| [`docs/long-tail-contract.md`](./docs/long-tail-contract.md) | Cloud Run endpoint contract (specified, not built) |
| [`docs/pack-layering.md`](./docs/pack-layering.md) | Additive/regional pack design (design only) — read before touching record numbering |
| [`docs/media-budget.md`](./docs/media-budget.md) | Exercise media budget, format, CDN layout |
| [`docs/contribution-loop.md`](./docs/contribution-loop.md) | How improvements flow back to Open Food Facts |
| `src/` | Runtime: the reader the app imports |
| `pipeline/` | Build tooling. Not part of the app |
| `fixtures/` | Small committed samples, enough to run the whole pipeline |
| `build/` | Sample build output, committed so an artefact can be inspected without running anything |

## Quick start

No install step. The package has zero dependencies and no build; it runs on
Node 22+ as it sits.

```sh
cd packages/datasets

node --test "pipeline/test/*.test.mjs"   # 87 tests, ~150 ms
node pipeline/build-food-index.mjs       # builds from fixtures/ into build-sample/
node pipeline/build-exercise-catalogue.mjs
node pipeline/verify-index.mjs           # integrity + licence compliance
node pipeline/report-index.mjs           # where the bytes go
```

Expected output from the fixture build:

```
loaded  usda=500 off=600
mapped  791 kept, 309 rejected by validation
select  576 pass the entry rules (ingredients 387/387, packaged 189/404)
        packaged rejected: no serving grams 100, no serving label 0, mass-only label 115, inconsistent 0 of 179 checkable
dedupe  576 -> 571 (gtin 0, off-suppressed-by-core 0, fingerprint 4, product-cluster 1)
core    387/387 records, 0.01 MB gz (38.5 B/record)
off     184/184 records, 0.01 MB gz (67.2 B/record)
total   0.03 MB gz of a 4.00 MB budget
```

The `select` stage is where the index stops being a corpus. Branded packaged
goods must be able to answer "one serving = what?" to earn their ~50 gzipped
bytes; ingredients are exempt, because per 100 g is their natural basis. Full
rules and the reasoning: [`docs/normalisation.md`](./docs/normalisation.md).

### Why plain JavaScript in a TypeScript repo

No build step and no dependencies means the pipeline runs in CI before anything
is installed, and the reader runs identically in Node, a browser tab, and a
service worker. `src/index.d.ts` gives consumers the same strict types they
would get from compiled source; treat a change to it as a change to a published
API.

## ⚠ The exercise catalogue is 213 KB gzipped / 1.66 MB parsed — lazy-load it

The workout feature chunk is ~17 KB gzipped. This catalogue is twelve times that
compressed and roughly a hundred times parsed. It must never sit in an eager
import path.

```js
// Correct: reader and data both load on first exercise-picker open.
const { openExerciseCatalogue } = await import('@freeforever/datasets/exercises');
const catalogue = await openExerciseCatalogue({ url: '/data/exercises.json.gz' });

// Wrong: pulls the reader into the eager graph.
import { openExerciseCatalogue } from '@freeforever/datasets';
```

`openExerciseCatalogue()` is async and resolves its data at call time rather than
through a static import, so no bundler pulls the artefact in on its own. Keeping
the *call* off the startup path is the caller's job. Ship a small synchronous
starter set and lazy-load these 873 behind it. Full contract:
[`docs/exercise-catalogue.md`](./docs/exercise-catalogue.md).

The food index has the same property and the same rule — `openIndexFromUrls()`
is async for the same reason.

## Where the artefacts live

| Path | What | Committed? |
|---|---|---|
| `build/` | **The shipped index.** `apps/web/scripts/sync-datasets.mjs` copies from here and nutrition's recall suite measures against it. | **Yes** — committing it is what lets jsDelivr serve it free (ADR-0007, ADR-0031) |
| `build-sample/` | Fixture build output, ~570 records. Inspectable without running anything. | Yes |

**Nothing may be parked inside `build/`.** `sync-datasets.mjs` copies it
recursively into `apps/web/public/data`, so a scratch subdirectory becomes part
of the web app's deploy payload. That is why the sample build is a sibling.

**A sample build must never write to `build/`.** It used to: `--out` defaulted to
`build/`, so the documented fixture command silently replaced a 97,000-record
corpus with a 571-record sample, and the only symptom was another team's recall
numbers quietly measuring the wrong thing. That default is now `build/sample/`.
It is also how the project came to ship 784 records to a real user who then
could not find their food.

Commit `build/` on **index-version bumps only**, never per rebuild. Every
filename carries the version, so a bump writes new paths rather than rewriting
existing blobs, which keeps the tracked weight to a few MB a year.

## Refreshing the samples

```sh
node pipeline/fetch-samples.mjs                       # all three sources
node pipeline/fetch-samples.mjs --only off --off-products 2000
```

- **USDA** comes from the FoodData Central API. Without `FDC_API_KEY` it falls
  back to `DEMO_KEY` (~30 requests/hour), which is enough for a sample.
- **Open Food Facts** comes from a **byte-range prefix of the published dump**,
  not from the search API. Same code path as a full build, and it costs Open
  Food Facts one ranged GET rather than hundreds of query executions.
- **free-exercise-db** is a single 1 MB JSON file.

## Running a full build

The full corpora are large — Open Food Facts' dump alone is ~12.7 GB
compressed — so a full build is a CI job on a machine with disk, not something
you run on a laptop by accident.

### 1. Get an FDC API key

Free, instant, no approval: <https://fdc.nal.usda.gov/api-key-signup.html>

```sh
export FDC_API_KEY=...        # never commit this
```

Add to your `.env.local` (which is gitignored) as:

```
# Server-side only. Rate-limit identifier for the USDA FoodData Central API.
# Free from https://fdc.nal.usda.gov/api-key-signup.html
FDC_API_KEY=
```

The key is a rate-limit identifier, not a licence grant — it places no
conditions on the data (`NOTICE.md` §1).

### 2. Fetch the full sources

Prefer the bulk exports over the APIs. Paging an API for a million products is
slow, fragile, and rude.

The build discovers its inputs by directory. Put the bulk exports here and it
streams them; leave them out and it falls back to the committed samples, running
the *same* adapters either way.

```
raw/usda/*.json          USDA bulk exports, unzipped
raw/off/*.jsonl.gz       the published Open Food Facts dump (or a projected copy)
```

```sh
mkdir -p raw/usda raw/off

# USDA: bulk JSON exports, ~700 MB zipped / ~3.5 GB unpacked.
#   Listed at https://fdc.nal.usda.gov/download-datasets
#   Branded is the big one; Foundation and SR Legacy are the ingredient corpus
#   and carry the `foodPortions` that become household serving labels.
for f in FoodData_Central_branded_food_json_2026-04-30.zip \
         FoodData_Central_foundation_food_json_2026-04-30.zip \
         FoodData_Central_sr_legacy_food_json_2021-10-28.zip; do
  curl -L -C - -o "raw/usda/$f" "https://fdc.nal.usda.gov/fdc-datasets/$f"
  unzip -o -q "raw/usda/$f" -d raw/usda
done

# Open Food Facts: the full JSONL dump, ~12.8 GB compressed. Download it to
# disk rather than streaming it into the build — at ~2 MB/s this is over an
# hour, and a network hiccup 50 minutes in must not cost the whole transfer.
curl -L -C - --compressed \
  -A "TheFreeForeverFitnessApp/0.1 (dataset build pipeline)" \
  -o raw/off/openfoodfacts-products.jsonl.gz \
  https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
```

**Do not substitute the CSV export.** `en.openfoodfacts.org.products.csv.gz` is
ten times smaller and tempting, and it has no `*_serving` nutrient columns at
all. Those columns are the only independent witness to a record's serving
arithmetic, and the consistency rule in `lib/select.mjs` is built on them — with
the CSV, the rule silently checks nothing.

The build projects every dump row through the OFF field allow-list as it reads,
so no image URL is ever held in memory or written anywhere (`NOTICE.md` §2.5).

**USDA's bulk JSON is one 3.3 GB object wrapping one array**, which `JSON.parse`
cannot hold. `lib/json-array-stream.mjs` streams the elements out. It is not a
general JSON parser and is not meant to be. Note that USDA's arrays end with a
run of literal `null` elements — that is the file, not a parse failure.

### 3. Build

```sh
node pipeline/build-food-index.mjs \
  --input raw \
  --out build/full \
  --budget-mb 4 \
  --locale us \
  --version 2026.09.1

node pipeline/build-exercise-catalogue.mjs --input raw --out build/full
node pipeline/verify-index.mjs --dir build/full --release
node pipeline/report-index.mjs --input raw
```

A full ingest reads ~1.4M USDA rows and ~4.7M Open Food Facts rows and takes
roughly **15 minutes** with a peak heap around 1 GB, so pass
`--max-old-space-size=8192`. It writes to `build/full`, which is gitignored —
`build/` holds the small committed *sample* output and a full build must not
overwrite it.

`--release` adds the checks that only matter when publishing, including that
`manifest.publishedAt` names the public URL where the ODbL derived database is
offered. Set it before cutting a release; without it, publishing puts us in
breach of ODbL §4.4.

Expect roughly **~100,000 foods in 4 MB gzipped**. `fitToBudget` binary-searches
the real encoded size and drops the lowest-ranked tail until it fits, so the
budget is a hard constraint rather than a target.

### The acceptance probes are the check that matters

`--release` also runs `lib/probes.mjs`: a short list of **named foods that a
shipped index must still contain**, searched for the way the app searches, with
their expected serving label and per-serving numbers.

They exist because of the failure this pipeline actually had. Every unit test
passed while the shipped index held 784 sample records, no serving label on a
single one, and 1% of the download budget used. A green suite could not see it.
A probe that types `gold standard whey vanilla` into the real index can:

```
ok    probe gold-standard-whey-vanilla
      #1 Optimum Nutrition — Gold Standard Whey (Vanilla Ice Cream Flavour)
         · 1 scoop (31 g) · ~120 kcal · ~23.9 g protein
```

Each probe is a claim about the corpus that a rebuild can falsify — a dropped
record, a duplicate ranked above it, a serving label that reverts to a bare
mass, or nutrition off by a factor all fail the build. `maxMatches` is what
pins the dedupe: three rows for that tub reached a user once.

Add probes for shapes of failure we have actually seen, not for coverage.
`pipeline/test/probes.test.mjs` drives the harness against stub readers in both
directions, so the probes cannot pass because the harness never ran.

### 4. Media (gated — read `NOTICE.md` §3.2 first)

```sh
node pipeline/build-media.mjs --acknowledge-provenance-risk --limit 12
```

The gate is not ceremony. The provenance of the upstream demonstration
photographs is unresolved, and publishing them to a CDN is a decision for the
project owner, not for this pipeline. Building locally to evaluate the pipeline
is fine.

## What CI must run

```sh
node --test "pipeline/test/*.test.mjs"
node pipeline/build-food-index.mjs && node pipeline/verify-index.mjs
```

A **release** build must additionally pass the acceptance probes, which the
sample build cannot run because it does not contain the foods they name:

```sh
node pipeline/verify-index.mjs --dir build/full --probes
```

`verify-index.mjs` is not only an integrity check. Half of it enforces the
licence invariants from `NOTICE.md`:

- no OFF-sourced record in the public-domain shard, and vice versa;
- every OFF record carries a barcode and a product attribution URL;
- no image field anywhere in the OFF-derived output;
- the OFF shard ships its ODbL notice and its plain NDJSON parallel
  distribution;
- upstream licence terms were verified within the last 180 days.

It also asserts **100% search recall**: every record must have at least one
indexable term, and every probed record must be findable by its own first
indexed term. Not a threshold — a record you cannot reach by typing a word from
its own name is dead weight in the download.

Those invariants are only real because something fails the build when they
break. A comment saying "never merge OFF into core" is a wish.

## Things that will bite you

- **USDA Branded's missing 1.5M records are a KNOWN, DEPRIORITISED gap.** Not a
  surprise to rediscover: the decision was that the missing records are
  overwhelmingly US branded groceries, which is the one category the 4 MB budget
  already over-spends on (~0.94 MB of it). More candidates of that category
  improve selection marginally and reach in a direction the project's first user
  does not live in. Revisit after per-region packs exist, when the extra
  candidates would land in a US pack rather than in everyone's base.
- **USDA's Branded *JSON* export is not all of Branded.** The April 2026 JSON
  holds **455,458** foods; `food.csv` in the full CSV release lists
  **1,999,950** with `data_type = branded_food`. Three independent per-record
  markers in the JSON (`gtinUpc`, `brandedFoodCategory`,
  `householdServingFullText`) all agree at 455,458, so this is the export's
  scope and not a parser bug. The current build therefore draws from a 23%
  slice of USDA Branded. Fixing it means an adapter that joins
  `branded_food.csv` + `food.csv` + `food_nutrient.csv` — worth doing, not yet
  done.
- **`sodiumMg` is milligrams.** Open Food Facts states sodium in grams and the
  pipeline converts. A value that looks 1000x wrong is worth reporting, not
  patching at the call site.
- **Numeric record ids are not stable across index versions.** Rebuilding
  re-ranks and reorders. Persist `Food.id` (`shard:sourceId`), and store the
  nutrient values a user logged against alongside it, so their history never
  changes retroactively because we rebuilt an index.
- **Never overwrite a published media path.** jsDelivr caches immutably; a
  changed file behind an existing tag is a cache-poisoning bug that outlives the
  deploy. New media means a new `MEDIA_VERSION`.
- **`raw/` is gitignored** and holds multi-gigabyte downloads. `fixtures/` is
  the small committed sample.
- **`FDC_API_KEY` is not yet in the root `.env.example`.** Root config is
  integrator-only (ADR-0018), so the fragment above needs adding there; until it
  is, the build falls back to `DEMO_KEY` and warns.

## Open questions for the integrator

1. **free-exercise-db image provenance** (`NOTICE.md` §3.2). Unresolved, and it
   gates publishing any exercise media. The catalogue text is unaffected and
   ships now. Needs a decision.
2. **Media repository placement** (`docs/media-budget.md`). ~34 MB of binaries
   in the app repo's git history forever, versus a separate public media repo
   that jsDelivr serves identically. The second is better; it is a deviation
   from ADR-0007 as written, so it is flagged rather than taken.
3. **Muscle vocabulary.** `build-exercise-catalogue.mjs` defines a canonical
   muscle list. If `packages/data` grows a muscle enum, that map is the seam to
   align on.
