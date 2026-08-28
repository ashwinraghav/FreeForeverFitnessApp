# Normalisation, dedupe and ranking

How raw upstream rows become the records in `food-index-format.md`.

## Per 100 g is the only basis

Everything is stored per 100 g, or per 100 ml when `basis === 'ml'`. Nothing is
stored per serving. Getting this wrong is the failure mode a user actually
notices — a 4x error in a logged meal — and the two upstreams disagree about it
in opposite directions.

| Source | What it gives | What we do |
|---|---|---|
| USDA Foundation, SR Legacy | `foodNutrients`, already per 100 g | take it |
| USDA Branded | `foodNutrients` per 100 g **and** `labelNutrients` per serving | prefer the per-100 g array; convert the label only when the array is absent, using the stated `servingSize` |
| Open Food Facts | `nutriments` with both `_100g` and `_serving` suffixes | take `_100g`; never `_serving`, and never the unsuffixed key, which is whatever unit a contributor typed |

Two unit traps, both handled in `pipeline/sources/off.mjs`:

- **OFF states sodium in grams per 100 g**, not milligrams. Missing this is a
  1000x error on a nutrient people actively track. There is a test pinning it.
- **When sodium is absent, OFF often has salt.** Sodium = salt ÷ 2.5.

Energy falls back kcal → kJ ÷ 4.184 → nothing.

## Servings

`servingGrams` is grams in one stated serving; `servingLabel` is the household
measure ("1 cup", "1 breast"), cleaned of parenthetical repetition and dropped
if longer than 32 characters, because it renders in a 48 px row on a phone.

Volumes are converted with an assumed density of 1.0 g/ml and the record is
flagged `servingEstimated`. That flag reaches the client on purpose: "240 g
(approx.)" for a cup of oil is honest, and silently claiming 240 g is not.

Units understood: g, mg, kg, oz, lb, ml, cl, dl, l, fl oz. Anything else yields
no serving, which is better than a wrong one.

## Validation: what gets dropped

A record is dropped when:

- any value is negative or non-finite;
- energy exceeds 902 kcal/100 g — pure fat is 900, so anything above is a unit
  error;
- a single macro exceeds 100 g/100 g, or the three macros sum above 105 g;
- saturated fat exceeds total fat by more than 0.5 g;
- sodium exceeds 40,000 mg/100 g — table salt itself is ~38,758;
- **energy was never reported and all macros are zero.**

(A record with macros but no energy is not dropped — see the next section.)

That last rule is the subtle one. "Bread, white, commercial" with only a sodium
value and no energy field is missing data, and shipping it means a user logs
bread and sees 0 kcal. "Zero-calorie soda" with an explicitly stated 0 kcal is a
real food people log every day. The stored numbers are identical; only the
presence of the upstream energy field distinguishes them, which is why the
`ENERGY_REPORTED` flag exists.

This rule was not designed up front. `verify-index.mjs` failed the build on
sixteen records, and looking at what they actually were is what produced the
distinction.

### Deriving energy that upstream left out

A record with macros but no energy field is not a zero-calorie food; it is an
incomplete record. 137 of 500 USDA rows in the sample are like this, and shipping
them as written means a user logs tinned anchovies and sees 0 kcal.

So when energy is zero and the Atwater estimate is not, we compute it and set
`energyDerived`. For those anchovies the estimate is 206 kcal against USDA's
published 210 — far closer to the truth than zero. The same rule fires on a
stated zero that the macros contradict, which Open Food Facts contributors
produce regularly by filling in macros and leaving the energy field alone.

It cannot misfire on a genuine zero-calorie food: diet soda and black coffee
have zero macros, so the estimate is zero and nothing changes.

### Atwater cross-check

`4·protein + 4·(carb − fibre) + 9·fat + 2·fibre` is compared to the stated
energy. More than 25% apart sets `atwaterMismatch`.

The record is **flagged, never corrected**. Sugar alcohols, alcohol and unusual
fibre all produce legitimate mismatches, so substituting the computed value
would corrupt correct records in order to make a report look tidy.

## Storage precision

| Field | Stored as | Resolution | Ceiling |
|---|---|---|---|
| `kcal` | u16 | 1 kcal | 65,535 |
| macros, fibre, sugar | u16 centigrams | 0.01 g | 655.35 g |
| `sodiumMg` | u16 | 1 mg | 65,535 mg |
| `satFatG` | u8 half-grams | 0.5 g | 127.5 g |

Saturated fat gets a single byte because the highest real value is coconut oil
at ~87 g and 0.5 g resolution is beyond what any label states. Columns are
stored contiguously (all energies, then all proteins) rather than as a struct
per record, which is worth ~35% of the section after gzip.

## Dedupe

USDA Branded and Open Food Facts both catalogue US grocery barcodes, so they
overlap heavily. Two "Cheerios" rows in a search result mid-workout is a
decision the user has to make and should not have to.

Records arrive already ranked, so the first record to claim a key is the keeper.

1. **Cross-shard, by GTIN.** If a barcode appears in the core shard, the OFF
   record for it is **suppressed** — dropped, not merged. See below.
2. **Within a shard, by GTIN.** The loser's aliases and popularity fold into the
   keeper, and a serving size is taken if the keeper lacks one.
3. **Within a shard, by fingerprint.** Barcodeless records collide on
   `brand + name` (folded, deduplicated, sorted tokens — so "Yogurt, Greek,
   Plain" and "Plain Greek Yogurt" match) plus a coarse nutrient bucket
   (10 kcal, 1 g macros). The nutrient part stops "Chicken breast, raw" and
   "Chicken breast, roasted" merging when the names happen to fingerprint alike.

**Why suppression rather than merging across shards.** Copying an OFF field
value into a core record would make the public-domain shard a derivative of an
ODbL database, and the whole shard would inherit share-alike. Deciding *not* to
copy carries no licence consequence. `absorb()` throws if it is ever called
across the shard boundary, and `verify-index.mjs` fails the build if an
OFF-sourced record appears in the core shard. See `../NOTICE.md` §2.4.

## Ranking

The index is a budget, not a corpus. Ranking decides what fits, and record order
*is* rank order — so record 0 is the most likely food, and the reader gets a
free tie-break from "lower id wins" with no score stored in the file.

| Signal | Weight | Source |
|---|---:|---|
| source prior | 0.40 | Foundation 1.0, SR Legacy 0.92, USDA Branded 0.35, OFF 0.30 |
| popularity | 0.30 | OFF `unique_scans_n`, log-normalised |
| completeness | 0.15 | has energy, has macros, has a serving, minus a penalty for `atwaterMismatch` |
| name quality | 0.10 | shorter is better; penalties for comma chains, long names, embedded UPCs |
| locale fit | 0.05 | `countries_tags` matching the build locale |

Generic whole foods dominate real searches — "chicken breast", "banana", "olive
oil" — which is why the source prior is the heaviest weight and Foundation sits
at the top. Branded products are numerous, long-named, and mostly reached by
barcode scan rather than by typing, so they earn their place through popularity.

Popularity is log-normalised because scan counts are Zipf-distributed: linear
normalisation would collapse everything below the top hundred to zero.

Ties break on the upstream id, so two builds over identical input produce
byte-identical artefacts. Without that the integrity hashes would be build
timestamps rather than checks.

### What ranking deliberately does not use

**Our own users' search queries.** Aggregated query logs would be the single
best signal available, and collecting them would mean building a telemetry
pipeline over what people eat. Constitution rule 6 rules out data collection
that exists to improve our product rather than the user's experience, and food
logs are about as sensitive as personal data gets. Every signal in the table is
either a public upstream statistic or computable from the record itself.

### The known bias

Locale fit is a single parameter defaulting to `us`, and both upstreams are
US-heavy, so v1 ships a US-weighted index. That is a stated bias, not an
oversight: it is what `contribution-loop.md` exists to correct, and keeping it
as one parameter means a per-region build matrix is a build change rather than a
redesign.

## Fitting the budget

`fitToBudget()` encodes, gzips, and binary-searches the record count until the
artefacts fit. Not an estimate: compressed size is not linear in record count,
because the term dictionary and brand table amortise as the corpus grows, so a
bytes-per-record estimate overshoots on small builds and undershoots on large
ones. Six encode passes takes seconds and gets it exact.

The budget is split 30% core / 70% OFF. Core is the smaller corpus and must be
present before the app is usable at all; the OFF shard is the branded long tail
and can be fetched on first barcode scan.
