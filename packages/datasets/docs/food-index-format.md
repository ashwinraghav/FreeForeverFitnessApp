# Food index output format

**This is the contract. The nutrition team codes against this document and
`src/index.d.ts`; everything else in this package is implementation.**

## The short version

```js
import { FoodIndex, FoodIndexSet, openIndexFromUrls } from '@freeforever/datasets';

const core = await openIndexFromUrls({
  records:  '/data/food-core-records-2026.08.1.bin.gz',
  search:   '/data/food-core-search-2026.08.1.bin.gz',
  barcodes: '/data/food-core-barcodes-2026.08.1.bin.gz',
});
const off = await openIndexFromUrls({ /* the off-shard equivalents */ });

const foods = new FoodIndexSet([core, off]);

foods.search('chicken brea', { limit: 20 }); // -> SearchHit[]
foods.byBarcode('3017620422003');            // -> Food | null
```

`search()` is safe to call on every keystroke: it decodes only the postings for
the terms in the query and only materialises the records it returns.

## Artefacts

A build emits, per shard (`core` and `off`):

| File | Contains | Needed for |
|---|---|---|
| `food-<shard>-records-<version>.bin.gz` | names, brands, nutrients, servings, source ids, flags | everything; open the index without it and nothing works |
| `food-<shard>-search-<version>.bin.gz` | term dictionary + postings | `search()`. Omit it and search returns `[]` |
| `food-<shard>-barcodes-<version>.bin.gz` | GTIN → record id | `byBarcode()` and `Food.barcode`. Omit it and both are null |
| `manifest.json` | versions, sizes, SHA-256 per file, source licences | integrity checks, the Data sources screen |

Plus, for the OFF shard only, `food-off-<version>.ndjson.gz` and
`food-off-<version>.NOTICE.txt` — the ODbL parallel distribution and attribution
text. **Those two are published, not shipped in the app bundle.** See
`../NOTICE.md` §2.3.

The three binaries are separate files so they can be fetched independently. The
recommended load order is: `records` + `search` for the core shard on first run
(a few hundred KB), the OFF shard lazily on first search miss or first barcode
scan, and the barcode tables only when the scanner opens.

## Two shards, and why you must not merge them yourself

`core` is USDA-derived and public domain. `off` is Open Food Facts-derived and
carries ODbL attribution and share-alike obligations. They are separate
artefacts so that the public-domain data does not inherit share-alike
(`../NOTICE.md` §2.4).

`FoodIndexSet` unions them **in memory, on the user's device**, which creates no
published database and so triggers no obligation. What you must not do is
persist a merged copy anywhere we publish, or copy an OFF record's fields into
a record you then treat as public domain.

## `Food`

```ts
interface Food {
  id: string;              // `${shard}:${sourceId}` — stable within an index version
  name: string;
  brand: string | null;
  sourceId: string;        // FDC id, or the OFF barcode
  barcode: string | null;  // GTIN as scanned, leading zeros intact
  source: string;          // 'usda-foundation' | 'usda-sr-legacy' | 'usda-branded' | 'off'
  shard: string;           // 'core' | 'off'
  licence: string;         // 'public-domain-usgov' | 'ODbL-1.0'
  attributionUrl: string | null;
  basis: 'g' | 'ml';
  per100: Nutrients;
  servingGrams: number | null;
  servingLabel: string | null;
  flags: FoodFlags;
}
```

### `per100` — always per 100, never per serving

```ts
interface Nutrients {
  kcal: number;      // integer
  proteinG: number;  // grams, 0.01 resolution
  carbG: number;
  fatG: number;
  fibreG: number;
  sugarG: number;
  sodiumMg: number;  // MILLIGRAMS, integer
  satFatG: number;   // grams, 0.5 resolution
}
```

Every value is per 100 g, or per 100 ml when `basis === 'ml'`. To log a portion:

```js
const factor = grams / 100;
const kcal = Math.round(food.per100.kcal * factor);
```

`sodiumMg` is in milligrams. Open Food Facts states sodium in *grams* and the
pipeline converts; if you ever see a sodium value that looks 1000x wrong, the
bug is upstream of you and worth reporting rather than patching at the edge.

`satFatG` is stored in half-gram steps and clamps at 127.5 g, which no real food
reaches. The other values are stored as 16-bit integers and clamp at 655.35 g
(macros), 65535 kcal, and 65535 mg sodium.

### `flags` — what the app must surface

| Flag | Meaning | Suggested UI |
|---|---|---|
| `servingEstimated` | `servingGrams` was derived from a volume using an assumed density of 1.0 g/ml | show the serving as approximate |
| `atwaterMismatch` | stated energy disagrees with the macros by >25% | worth a quiet caveat on the detail view; do not hide the food |
| `highConfidence` | lab-analysed (USDA Foundation/SR) or a near-complete OFF record | nothing, or a subtle mark |
| `hasBarcode` | a GTIN exists for this food | show a scan affordance |
| `energyReported` | upstream stated energy, even if zero | an all-zero food with this `true` is a diet soda, not broken data |
| `energyDerived` | energy was computed from the macros because upstream had none, or stated a zero the macros contradict | mark it approximate, the same way `servingEstimated` is |

`energyDerived` fires on about a quarter of USDA records, which arrive with
protein, fat and carbohydrate but no energy field. Shipping those as written
would show a user 0 kcal for tinned anchovies; the Atwater estimate lands at 206
against USDA's published 210. It never fires on a genuine zero-calorie food,
because those have zero macros and so a zero estimate.

`atwaterMismatch` is a flag rather than a correction on purpose: sugar alcohols,
alcohol and unusual fibre produce legitimate mismatches, and silently
substituting a computed value would corrupt correct records.

### `attributionUrl` — a licence obligation, not a nicety

For any food with `source === 'off'`, this URL **must be reachable from the
food's detail view**. Open Food Facts' terms require re-users to credit
contributors with a link to the product they contributed to. A plain "Source:
Open Food Facts" link on the food detail screen satisfies it.

USDA records also carry a link. USDA requires nothing, so that one is courtesy.

The app additionally needs a *Data sources* screen carrying the text in
`manifest.json → sources[].attribution`. That discharges ODbL §4.2. See
`../NOTICE.md` §2.2.

## Search

```ts
search(query: string, opts?: { limit?: number }): SearchHit[]
// SearchHit = { food: Food, score: number }
```

- Tokens are ANDed. `"greek yog"` matches only foods with both.
- The **last** token is treated as a prefix, so results update sensibly while
  typing. Earlier tokens must match a whole term.
- Case, punctuation and diacritics are folded: `"creme"` finds "Crème Fraîche".
- Names, brands and aliases are all searchable; a name match scores highest.
- `score` is comparable **within one result set only**. Do not persist it, do
  not compare across queries, and do not show it.
- There is no typo tolerance in the local index. `"chikcen"` returns nothing.
  That is a deliberate omission — see `search-index-design.md` — and is where
  the long-tail endpoint (`long-tail-contract.md`) earns its place.

Empty and whitespace-only queries return `[]` rather than everything.

## Barcodes

```ts
byBarcode(barcode: string | number): Food | null
```

Pass the scanner output as a string. Non-digits are stripped. Leading zeros are
handled: a GTIN-12 and the GTIN-13 that differs only by a leading zero are
distinct barcodes and both round-trip exactly.

**Several barcodes may resolve to the same `Food`.** One product is often
catalogued under a barcode per region, and dedupe folds those rows into one
(`docs/normalisation.md`, "The product cluster"). The barcodes of the folded
rows are kept and point at the surviving record, so scanning any SKU of a
product reaches it. Consequence for a caller: `byBarcode(x).barcode` is not
necessarily `x` — it is the surviving row's primary barcode. If you need to
record what was actually scanned, keep the scanner's string yourself.

## Versioning and integrity

`manifest.json` carries:

- `schemaVersion` — the reader **refuses** an artefact whose value differs from
  its own. Bumped only on a change an installed client cannot read.
- `indexVersion` — e.g. `2026.08.1`. Appears in every filename, so a new index
  is a new URL and caching can be immutable.
- `artefacts[].files[].sha256` — subresource-integrity-style hash of the
  gzipped file. Verify it after download; a truncated artefact otherwise fails
  as a confusing decode error much later.

Additive format changes bump `formatMinor` instead of `schemaVersion`; readers
skip sections they do not recognise, so an older client keeps working.

## Record ids and ordering

Records are stored in descending order of estimated search likelihood, so
record `0` is the most likely food in the shard. `Food.id` (`shard:sourceId`) is
what you should persist in a user's food log — a numeric record id is **not**
stable across index versions, because re-ranking reorders the file.

Persisting `id` is enough to redisplay a logged food. It is not enough to
guarantee the food still exists in a later index: the budget can push a food
out. Store the nutrient values you logged against alongside the id, so a user's
history never changes retroactively because we rebuilt an index.

## The NDJSON dump

`food-off-<version>.ndjson.gz` is one JSON object per line:

```json
{"sourceId":"3017620422003","source":3,"name":"…","brand":"…","barcode":"3017620422003",
 "alsoBarcodes":[],"basis":"g","per100":{…},"servingGrams":15,"servingLabel":"1 tbsp",
 "aliases":[],
 "flags":{"servingEstimated":false,"atwaterMismatch":false,"highConfidence":true}}
```

`alsoBarcodes` lists the other barcodes for the same product, from rows dedupe
folded into this one. They are published rather than dropped because each is a
product an Open Food Facts contributor filled in, and OFF's terms credit
contributors by a link to the product they contributed to (`NOTICE.md` §2.2).

It exists to satisfy ODbL §4.6 and is the format a third party would consume.
The app does not read it.
