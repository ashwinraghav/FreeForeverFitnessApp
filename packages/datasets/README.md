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

node --test "pipeline/test/*.test.mjs"   # 58 tests, ~150 ms
node pipeline/build-food-index.mjs       # builds from fixtures/
node pipeline/build-exercise-catalogue.mjs
node pipeline/verify-index.mjs           # integrity + licence compliance
node pipeline/report-index.mjs           # where the bytes go
```

Expected output from the fixture build:

```
loaded  usda=500 off=600
mapped  791 kept, 309 rejected by validation
dedupe  791 -> 784 (gtin 0, off-suppressed-by-core 0, fingerprint 7)
core    486/486 records, 0.02 MB gz (47.9 B/record)
off     298/298 records, 0.02 MB gz (62.0 B/record)
total   0.04 MB gz of a 4.00 MB budget
```

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

```sh
mkdir -p raw

# USDA: full bulk exports, ~1 GB.
#   https://fdc.nal.usda.gov/download-datasets.html
#   Take "Foundation Foods", "SR Legacy", and "Branded Foods" (JSON).
#   Unpack into raw/ and point the build at them.

# Open Food Facts: the full JSONL dump, ~12.7 GB compressed.
node -e "
  import('./pipeline/sources/off.mjs').then(async ({ fetchDump }) => {
    const { createWriteStream } = await import('node:fs');
    const out = createWriteStream('raw/off-full.ndjson');
    let n = 0;
    for await (const p of fetchDump()) {           // no byteLimit = the whole dump
      out.write(JSON.stringify(p) + '\n');
      if (++n % 100000 === 0) console.log(n);
    }
    out.end();
  });
"
```

`fetchDump()` projects each row through the field allow-list as it reads, so the
local copy never contains an image URL (`NOTICE.md` §2.5) and is a fraction of
the dump's size.

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

`--release` adds the checks that only matter when publishing, including that
`manifest.publishedAt` names the public URL where the ODbL derived database is
offered. Set it before cutting a release; without it, publishing puts us in
breach of ODbL §4.4.

Expect roughly **~100,000 foods in 4 MB gzipped**. `fitToBudget` binary-searches
the real encoded size and drops the lowest-ranked tail until it fits, so the
budget is a hard constraint rather than a target.

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
