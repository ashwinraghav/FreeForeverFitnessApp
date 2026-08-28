# NOTICE — upstream data licences for `@freeforever/datasets`

This package contains **build pipeline code** and **datasets derived from third-party sources**.
They are licensed differently. Read this before redistributing anything from this package or from
the artefacts it produces.

| Part | Licence |
|---|---|
| Pipeline code (`pipeline/`, `src/`) | Apache-2.0 — see `LICENSE` |
| `build/food-core.*` (USDA-derived shard) | Public domain (17 U.S.C. § 105) |
| `build/food-off.*` (Open Food Facts-derived shard) | **ODbL-1.0** — attribution **and** share-alike |
| `build/exercises.*` | Public domain (Unlicense), with a caveat — see §3 |
| `build/media/**` | See §3.2 — **unresolved, do not ship without review** |

The two food shards are built and published **separately, and never merged into a single
artefact**, precisely so that the public-domain data does not inherit ODbL's share-alike. See §2.4.

---

## 1. USDA FoodData Central

- **Source:** <https://fdc.nal.usda.gov/> — U.S. Department of Agriculture, Agricultural Research
  Service, FoodData Central. Accessed via `https://api.nal.usda.gov/fdc/v1/`.
- **Status:** A work of the United States federal government. Under **17 U.S.C. § 105** such works
  are not subject to copyright protection in the United States. USDA states the data is in the
  public domain and may be used without permission.
- **Obligations:** None that are legally binding. USDA *requests* (does not require) citation.
- **What we do:** We cite it anyway, in `manifest.json` (`sources[].citation`) and in the app's
  data-sources screen:

  > U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, `<release>`.
  > fdc.nal.usda.gov.

- **Caveat we take seriously:** public-domain status attaches to the *federal work*. USDA's
  **Branded Foods** subset is compiled from label data supplied by manufacturers under the USDA
  Branded Food Products Database public–private partnership. USDA publishes it as part of the
  federal work, and we treat it as such. Third-party **trademark** rights in brand names are
  unaffected by copyright status: we store brand names as factual identifiers for search, we do
  not reproduce logos or trade dress, and we make no claim of affiliation or endorsement.

- **API key:** the FDC API requires a free `api.data.gov` key. It is read from the environment
  (`FDC_API_KEY`) and **is never committed**. See `README.md` and the `.env.example` fragment there.
  The key is a rate-limit identifier, not a licence grant; it places no additional conditions on
  the data.

## 2. Open Food Facts — the binding obligation

This is the one source whose licence constrains what we may build. Everything below is taken from
the Open Food Facts terms of use (<https://world.openfoodfacts.org/terms-of-use>), verified
2026-08-28.

### 2.1 Three licences, three different things

Open Food Facts applies **three** licences to different parts of its database. Conflating them is
the usual way projects get this wrong.

| Part of OFF | Licence | Applies to us? |
|---|---|---|
| The **database** (structure + the collection as a whole) | **ODbL 1.0** | **Yes** — this is the binding one |
| **Individual contents** (a single product's field values) | **DbCL 1.0** | Yes, but DbCL imposes no share-alike on the contents themselves |
| **Product images** | **CC-BY-SA** | **No** — we ingest zero OFF images. See §2.5 |

### 2.2 What ODbL actually requires of us

ODbL 1.0 obligations trigger on **Publicly Using** a Derivative Database. Shipping a queryable
food index inside the app *is* publicly using a derivative database — it is not merely a "Produced
Work" (§4.5), because the app distributes the data in a form users can query, not just a rendered
view of it. We therefore assume the full set of obligations, not the lighter Produced-Work path.

Three concrete duties:

1. **§4.2 Attribution.** Every Public Use must carry a notice identifying the source and the
   licence, with a URI to the licence. We satisfy this in three places:
   - `manifest.json` → `sources[].attribution` (machine-readable, travels with the artefact),
   - the app's *Data sources* screen (human-readable, always reachable),
   - `build/food-off.NOTICE.txt`, emitted next to the artefact by the build.

   The required text:

   > Contains information from Open Food Facts (<https://world.openfoodfacts.org>), made available
   > under the Open Database License (ODbL) v1.0, <https://opendatacommons.org/licenses/odbl/1-0/>.
   > Individual contents are available under the Database Contents License,
   > <https://opendatacommons.org/licenses/dbcl/1-0/>.

   **Additionally**, OFF's terms of use impose a contributor-attribution term beyond bare ODbL:
   *"Contributors agree to be credited by re-user by a link to the product to which they
   contribute."* We satisfy this by retaining the barcode on every OFF-derived record and linking
   each food's detail screen to `https://world.openfoodfacts.org/product/<barcode>`. This is why
   `sourceId` is a **required, non-droppable** field on the OFF shard — dropping it to save bytes
   would break compliance, not just provenance. It is enforced by `pipeline/verify-index.mjs`.

2. **§4.4 Share-alike.** Any Derivative Database we publicly use must be offered under ODbL 1.0
   (or a compatible licence). Our derived OFF index is a Derivative Database. We therefore publish
   it under ODbL — see §2.3.

3. **§4.6 Non-restriction / Parallel Distribution.** If we distribute the database in a form that
   is technologically restricted, we must *also* offer a version without that restriction. Our
   binary format is compression, not a technical restriction, so §4.6 is arguably not triggered.
   We do not rely on that argument: the build **always** emits a plain, documented
   `food-off-<version>.ndjson.gz` alongside the binary shard, and publishes both.

### 2.3 Exactly what we publish, and where

To discharge §4.4 the derived database must be *offered*, not merely offerable. The build produces
these and the release workflow publishes them:

| Artefact | Content | Where |
|---|---|---|
| `food-off-<version>.ndjson.gz` | The full derived OFF database, one JSON record per line, schema documented in `docs/food-index-format.md` | GitHub Release asset, on every index release |
| `food-off-<version>.bin.gz` + `search-off-*`, `barcodes-off-*` | The same data in the on-device binary form | Same release |
| `food-off-<version>.NOTICE.txt` | Attribution text + ODbL URI + build provenance | Same release, and embedded in `manifest.json` |
| `LICENSE-ODbL-1.0.txt` | Full licence text | Same release |

The release is public, permanent, and linked from the app's *Data sources* screen and from this
package's `README.md`. That link **is** the compliance artefact; if the link rots, we are out of
compliance. `pipeline/verify-index.mjs --release` checks the assets exist before a release is cut.

**Contributions back upstream** (`docs/contribution-loop.md`) go further than ODbL requires — ODbL
does not oblige us to push corrections upstream, only to license our derivative alike. We do it
because of constitution rule 8. Do not confuse the two: the contribution loop is *not* a substitute
for publishing the derived database, and cannot discharge §4.4 on its own.

### 2.4 Keeping ODbL from spreading

ODbL is viral across a *Derivative Database*, not across everything in the same repository or
application. The containment rules the pipeline enforces:

- **Two shards, never merged.** `food-core` is built from USDA only. `food-off` is built from OFF
  only. There is no combined artefact. The app loads both and merges *at query time, in memory*;
  a transient in-memory union in a user's browser is not a published database.
- **Dedupe is one-directional.** When a USDA record and an OFF record are the same product
  (matched by GTIN), we keep the USDA record in `food-core` and **suppress** the OFF duplicate from
  `food-off`. We never copy OFF field values into a core record. Suppression is a decision *not* to
  copy, so no OFF content flows into the public-domain shard.
  `pipeline/verify-index.mjs` fails the build if any `food-core` record carries `source: "off"`.
- **Ranking signals stay out.** OFF's `unique_scans_n` is used to order the OFF shard only. It is
  not written into, nor used to order, `food-core`.
- **The long-tail cache inherits the shard's licence.** A locally cached long-tail result keeps its
  `source` field; OFF-sourced cache entries are ODbL-covered like the shard. Since the cache is
  per-device and never published, no further obligation arises. See `docs/long-tail-contract.md`.
- **User-entered foods are a third, separate store.** They are the user's own data, exportable
  under constitution rule 7, and are not part of either shard. If a user chooses to contribute one
  upstream, it goes to OFF under OFF's terms with the user's explicit consent — see
  `docs/contribution-loop.md`.

### 2.5 Images

We ingest **no** Open Food Facts product images. Not for the index, not for the app, not for
thumbnails. Reasons, in order of weight:

1. OFF images are CC-BY-SA, requiring per-image attribution we would have to carry per record.
2. OFF's own terms warn that images "may contain graphical elements subject to copyright or other
   rights" — product packaging design, trademarks, and image rights of people depicted. The CC-BY-SA
   grant covers only the photographer's rights, not those third-party rights.
3. There is no product reason to carry them, and they would blow the download budget (ADR-0006).

`pipeline/sources/off.mjs` does not request image fields, and `verify-index.mjs` fails if any
`image` key appears in an OFF record.

## 3. Exercise data and media

### 3.1 free-exercise-db — the data

- **Source:** <https://github.com/yuhonas/free-exercise-db>, `dist/exercises.json` (873 exercises
  as of the pinned commit).
- **Licence:** **Unlicense** (`LICENSE.md` in the repo; confirmed via the GitHub licence API,
  `spdx_id: "Unlicense"`). The Unlicense is a public-domain dedication with a fallback permissive
  licence. No attribution required.
- **What we do:** attribute anyway, in `manifest.json` and the app's *Data sources* screen. It
  costs nothing and it is the decent thing.
- The exercise *text* (names, instructions, muscle assignments) is what we ingest, normalise, and
  extend with our own form cues and common-mistake copy. **Our added copy is ours**, written for
  this project, and is Apache-2.0 with the rest of the package.

### 3.2 free-exercise-db — the images. **Unresolved. Read this before shipping media.**

State plainly: **the provenance of the demonstration images is not established to my satisfaction,
and I did not resolve it.**

What is established:

- `yuhonas/free-exercise-db` is licensed Unlicense, and that licence file sits at the repository
  root, so on its face it covers the images in `exercises/**` as well as the JSON.
- Its README states the dataset was restructured from `wrkout/exercises.json`, which is *also*
  licensed Unlicense.
- Neither repository documents where the photographs originally came from, nor asserts that the
  photographer released them.

What is **not** established, and is the risk:

- A downstream repository cannot grant rights it never held. If the images entered that chain from
  a source with different terms, the Unlicense stamp on the aggregating repository does not cure
  it. Two hops of undocumented provenance is exactly the shape of an unclearable rights problem.
- I could not find, and therefore cannot cite, an upstream release from the original photographer.

**Consequence for the build:** the media pipeline is written and runs, but it is **gated**.
`pipeline/build-media.mjs` refuses to run without `--acknowledge-provenance-risk`, prints this
section, and stamps every output with its input's SHA-256 and source URL in
`build/media/provenance.json` so any asset can be traced and withdrawn in one pass.

**Recommendation, which is a decision for the project owner and not mine to make:** do not publish
these images to the CDN until either (a) the original photographer's release is located and cited,
or (b) the demonstration frames are replaced with assets we commission or generate ourselves. The
catalogue's *text* is unaffected and ships now; option (b) is the durable answer and the media
pipeline is deliberately source-agnostic so a replacement image set drops in without a rewrite.

### 3.3 wger — not used, and a warning about *how* it could be used

We do **not** use wger at v1. Recorded here because it is the obvious next source and the trap is
easy to walk into.

- **wger's codebase is AGPL-3.0-only.** `packages/datasets` code is Apache-2.0. AGPL-3.0 code
  cannot be relicensed to Apache-2.0. We must not copy, port, or derive our pipeline code from
  wger's — not its importers, not its normalisation logic, not its schema definitions where those
  are expressed as code. This is a code-level prohibition and it is absolute.
  (Note the asymmetry with the repository root, which *is* AGPL-3.0-or-later. Even there, mixing in
  AGPL-3.0-**only** code would constrain the "or-later" option, so the answer is still no.)
- **wger's exercise *data* is separately licensed** — the project distributes exercise database
  contributions under **CC-BY-SA 4.0**, distinct from the code licence. Data under CC-BY-SA is
  usable, but CC-BY-SA is a share-alike licence: an exercise catalogue containing wger data becomes
  an adapted work that must itself be offered under CC-BY-SA 4.0.
- **If we ever ingest it**, it must go into a **third shard** — `exercises-wger`, CC-BY-SA 4.0,
  published as such — on the same containment principle as §2.4. It must not be merged into the
  public-domain `exercises` catalogue.
- I have **not** independently verified wger's current data-licence terms for this NOTICE, because
  we do not use it. Verify at ingestion time; do not rely on this paragraph as the citation.

## 4. Uncertainties, stated rather than papered over

1. **free-exercise-db image provenance (§3.2).** The material one. Text ships; media is gated.
2. **Whether our index is a "Derivative Database" or a "Produced Work" under ODbL.** We assume
   Derivative Database, which is the stricter reading and the one that matches what we ship. If a
   lawyer later concludes it is a Produced Work, our obligations shrink and nothing we built breaks.
   Assuming the looser reading and being wrong is the failure mode that cannot be undone, because
   it would mean we shipped a derivative database under the wrong licence.
3. **USDA Branded Foods and manufacturer-supplied label data (§1).** We treat the published federal
   dataset as public domain in full. This is the standard reading and USDA publishes it as such, but
   the label data originates with manufacturers. Our mitigation is that we reproduce facts (nutrient
   values, net weight, brand name as identifier) and no creative or trade-dress material.
4. **Non-US copyright in USDA data.** 17 U.S.C. § 105 disclaims copyright *in the United States*.
   Some jurisdictions do not automatically treat foreign government works as public domain. In
   practice USDA asserts no rights anywhere and the content is nutrient facts, which attract thin
   protection at best. Noted for completeness, not treated as a live risk.
5. **This document is not legal advice.** It is a careful engineering reading of published licence
   texts, written by the team that built the pipeline. Before the first public release, item 1 needs
   a decision from the project owner and items 2–3 would benefit from a lawyer's eye.

---

*Verified against upstream sources on 2026-08-28. Re-verify on each index release; the build stamps
the verification date into `manifest.json` and `verify-index.mjs` warns when it is over 180 days old.*
