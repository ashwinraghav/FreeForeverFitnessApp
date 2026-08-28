# Why the search index is shaped the way it is

ADR-0006 fixes the budget at ~4 MB gzipped for the whole index. Search structure
is where that budget is won or lost, so the choice was measured rather than
argued. Reproduce any number here with:

```
node pipeline/report-index.mjs --input raw
```

## The requirement

Someone is holding a phone one-handed, mid-workout, typing into a search box.
They type `chick`, then `chicken b`, then `chicken brea`. Each keystroke must
return results, offline, without a network round trip, in under a frame.

That means:

- **prefix matching on the token being typed** — non-negotiable, it is how
  incremental search feels responsive;
- **multi-token AND** — `greek yog` must find Greek yogurt;
- **brand and alias matching** — people type `db curl` and `ohp`;
- **no substring matching in the middle of a word**, and **no typo tolerance**.
  Those two are what we bought the budget with. See below.

## What we ship: an inverted index over a front-coded, prefix-searchable term dictionary

- **Term dictionary.** Every unique token, sorted by UTF-8 byte order, stored in
  blocks of 16. Each block stores its first term whole and the following 15 as
  `(shared prefix length, suffix)`. A separate block index holds each block's
  byte offset and first term uncompressed, so a prefix lookup is a binary search
  over ~1/16th of the terms followed by a short linear walk.
- **Postings.** Per term: the document frequency, then ascending document ids as
  varint deltas. The field the term came from (name / brand / alias) is packed
  into the low two bits of each delta, which costs nothing and lets the reader
  weight a name match above a brand match without a second structure.
- **Prefix query.** Binary search to the first block that could contain the
  prefix, then walk terms forward until one no longer starts with it, unioning
  postings. Capped at 64 expanded terms so a one-letter query cannot walk the
  whole dictionary.

## The measurements

Measured on 4,717 records (482 USDA + 4,235 Open Food Facts), identical tokens
for every structure, gzip level 9.

| Structure | Keys | Wire (gz) | vs ours | Dictionary in memory | vs ours |
|---|---:|---:|---:|---:|---:|
| **inverted, front-coded** (shipped) | 2,763 | **45,718 B** | 1.00x | **19,655 B** | 1.00x |
| inverted, plain dictionary | 2,763 | 46,043 B | 1.01x | 20,232 B | 1.03x |
| trigram | 3,444 | 137,083 B | **3.00x** | 210,438 B | **10.71x** |
| suffix terms (trie/FST equivalent) | 9,415 | 136,225 B | **2.98x** | 232,703 B | **11.84x** |

### Trigram: rejected on size

A trigram index is the standard answer for substring and typo-tolerant search,
and it would give us both. It costs **3x on the wire and nearly 11x in memory**,
because every token contributes one posting per character rather than one
posting total. Applied to the whole budget that is the difference between
~100,000 foods and ~33,000 — a worse product for every user, in exchange for
handling misspellings.

### Suffix terms: rejected for the same reason

Indexing every suffix of every term is how you get mid-word matching out of a
prefix structure (and is effectively what a suffix trie or FST costs). Same
~3x wire, ~12x memory. A trie's real advantage — traversal without decompressing
— does not apply here, because we gunzip the artefact once at load and query the
plain bytes afterwards.

### Front-coding: kept, but be honest about why

Front-coding is worth **1% on the wire and 3% in memory** versus storing terms
whole. That is close to nothing, because gzip already exploits the redundancy in
a sorted term list.

It stays for a different reason: the block structure it implies is what makes
prefix range scans possible at all. The block index gives a binary search
target; the fixed block size bounds the linear walk; the per-term postings
lengths let the reader skip terms it did not match without decoding them. The
size saving is a rounding error and the doc should not pretend otherwise, but
the structure is load-bearing.

## What we deliberately gave up

**Typo tolerance.** `chikcen` returns nothing. The options were a trigram index
(3x the budget), or a bounded edit-distance walk over the term dictionary at
query time. The second is cheap in bytes and was left out of v1 only because it
is a query-side change that needs no format support — it can be added later
without a `schemaVersion` bump. Until then, a query that finds nothing locally
is exactly the signal that should reach the long-tail endpoint
(`long-tail-contract.md`), which can spell-correct server-side without costing
every user 8 MB.

**Mid-word substring matching.** Searching `ogurt` finds nothing. In a food
search this is close to free to give up: people type the beginnings of words.

**Phrase and proximity ranking.** Tokens are ANDed with no notion of adjacency,
so `"cream cheese"` and `"cheese cream"` rank identically. Food names are short
enough that this rarely shows.

## Where the bytes actually go

Same 4,717-record sample, sections measured individually:

| Section | Gzipped | Share |
|---|---:|---:|
| `records/NAME` | 47,574 B | 24.8% |
| `records/NUTRIENTS` | 43,252 B | 22.6% |
| `search/*` (postings + dictionary + block index) | 45,228 B | 23.6% |
| `records/SOURCE_IDS` | 18,321 B | 9.6% |
| `barcodes/*` | 15,924 B | 8.3% |
| `records/SERVING` | 8,235 B | 4.3% |
| brand + serving-label dictionaries and refs | 9,669 B | 5.0% |
| `records/FLAGS` + `records/SOURCE_CODES` | 655 B | 0.3% |
| **total** | **191,538 B** | |

Three things follow. **Names dominate at ~25%**, so the biggest remaining size
win is shortening display names, not cleverness in the index. The **search index
is 23.6% of the total**, which is why the 3x structures were never affordable:
trigram would have added ~90 KB to a 191 KB artefact, close to half the record
budget, for typo tolerance. And `SOURCE_IDS` costs 9.6% — nearly ten percent of
the download is upstream identifiers, kept because Open Food Facts attribution
requires the barcode on every record (`../NOTICE.md` §2.2). That is the price of
compliance, and it is worth stating rather than discovering later.

`records/NUTRIENTS` is stored columnar rather than as a packed struct per
record. Putting all 4,717 energy values next to each other, then all the protein
values, lets gzip see runs of similar magnitudes; interleaved, it sees a
repeating 16-byte pattern with no local redundancy. Worth ~35% of that section.

`records/SOURCE_CODES` compresses 4,717 bytes to 175 (0.1% of the artefact) —
one byte per record for the data source, nearly free because the rank ordering
groups sources together.
That column exists so that the flag byte keeps all eight bits for flags.

## Sizing

| | Marginal cost/record | Records in its budget share |
|---|---:|---:|
| core shard (1.2 MB) | 47.7 B gz | ~26,000 |
| off shard (2.8 MB) | 38.6 B gz | ~76,000 |
| **total (4 MB)** | | **~102,000 foods** |

Treat that as a **lower bound**. The fit is over a few thousand records; real
corpora repeat brand names and category words far more, so marginal cost falls
with scale. The core-shard figure is the weaker of the two — it is fitted over
only 482 USDA records and produces a slightly negative fixed term, which is the
regression telling you it has too little to work with. Re-run the report against
a full USDA extract before treating the core number as anything but indicative.

The build does not rely on these projections: `fitToBudget` in
`build-food-index.mjs` binary-searches the actual encoded size and drops the
lowest-ranked tail until the artefacts genuinely fit.
