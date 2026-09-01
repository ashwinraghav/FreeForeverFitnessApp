# Additive index packs — design note

**Status: design only. Nothing here is implemented.** Requested by the integrator
to be reviewed before code, because the failure mode is a barcode table pointing
at the wrong record, and that logs the wrong food.

Required by [ADR-0033](../../../docs/decisions/0033-reach-is-a-download-problem-not-a-network-one.md):
4 MB ships in the app, the remaining ~16 MB is an optional download, whole or in
regional slices. Reach is bought with bytes rather than with a runtime dependency
on Open Food Facts' API.

## The measurement this rests on

| | records | gzipped |
|---|---|---|
| base pack (today's shipped index) | 96,000 | 4.00 MB |
| all quality-gated records | 499,533 | 20.31 MB |

So the remainder is ~403,000 records and ~16.3 MB. A user who has the base must
not re-download the 4 MB they already hold, which is the whole problem: today
`--budget-mb 24` produces a 20 MB artefact that *contains* the 4 MB one.

## The hard part is record numbering, not packaging

`docs/food-index-format.md` already says the numeric record id is **not stable
across index versions**, and that `Food.id` (`shard:sourceId`) is what a caller
must persist. Packs make that sharper, because within one index version there are
now two artefacts that must agree.

Three sections are keyed by record number, and all three are per-artefact today:

| Section | Contains | Keyed by |
|---|---|---|
| `NAME`, `NUTRIENTS`, `SERVING`, `FLAGS`, … | one entry per record, in record order | position |
| `POSTINGS` | delta-varint doc ids per term | record number |
| `BARCODES` | sorted GTIN → record number | record number |

A remainder pack numbered from 0 would collide with the base on every one of
those. So the numbering has to be decided once, for the whole corpus, and then
partitioned.

### Recommendation: global numbering, contiguous ranges, base first

Rank the whole corpus once. Assign record numbers 0…N-1 in rank order. The base
pack is exactly `[0, B)` and the remainder is `[B, N)`.

Why this shape rather than an id map:

- **Rank order stays record order.** The reader's popularity prior reads `doc`
  directly (`0.5 * (1 - log1p(doc)/log1p(length))`), so any renumbering that is
  not rank order silently corrupts ranking. A contiguous split preserves it in
  both packs.
- **Postings and barcodes need no translation.** A remainder posting for doc
  412,000 means the same thing whichever pack the reader loaded, so merging two
  loaded packs is concatenation plus a sort, not a remap.
- **A missing pack degrades to a gap, not a wrong answer.** With only the base
  loaded, doc 412,000 is simply absent. That is the honest failure. An id map
  would make the same situation resolve to *a* record, which is the bug class we
  must not build.

The reader change is then: `length` becomes the highest loaded doc + 1 rather
than the record count, and `get(doc)` returns `null` for a doc in an unloaded
range. `search()` already tolerates absent docs — `for (const h of hits) { const
food = this.get(h.doc); if (food) out.push(...) }` skips them.

**One consequence to accept deliberately:** the prior's `logSpan` must be
computed from the *corpus* length, not the loaded length, or the same food scores
differently depending on which packs a user has. That is a one-line change and it
needs `manifest.corpusLength`.

## Version skew: base at N, remainder at N-1

This is the case that must fail closed, and it is why record ids cannot be the
identity across versions.

A rebuild re-ranks, so record 412,000 in version N is a different food from
record 412,000 in version N-1. Mixing them would show the user the wrong food
with the right-looking numbers — silent and unfalsifiable from inside the app.

**Rule: packs are only loadable together when their `indexVersion` matches
exactly.** Not "compatible", not "same schemaVersion" — identical. On a mismatch
the reader loads the base alone and reports the remainder as unavailable, and the
app offers a re-download. This makes an optional pack a cache that can be
invalidated, which is what it is.

The manifest needs, per pack: `indexVersion`, `docRange: [lo, hi)`,
`corpusLength`, and the existing `sha256` per file. `verify-index.mjs` should
assert the ranges of a version's packs are contiguous, non-overlapping, and cover
`[0, corpusLength)`.

## Does the container format need a version bump?

**`SCHEMA_VERSION`: no. `FORMAT_MINOR`: yes.**

The reader refuses an artefact whose `schemaVersion` differs, and nothing about
an existing single-pack artefact changes — a base-only build is byte-identical to
today's. What changes is additive: a `docRange` in the manifest and a reader that
can hold more than one artefact per shard. Old readers skip sections they do not
recognise, and an old reader handed only a base pack works unchanged. That is
exactly what `FORMAT_MINOR` is for.

The one thing that would force a `SCHEMA_VERSION` bump is changing how `POSTINGS`
encodes doc deltas, and the contiguous-range design specifically avoids that.

## Licence constraint, which is not negotiable

Packs partition **within** a shard, never across one. `food-core` and `food-off`
stay separate artefacts with separate licences at every pack level, and a
regional pack is `food-off-in-<version>`, never a merged `food-in-<version>`
(`NOTICE.md` §2.4). Each OFF pack ships its own `NOTICE.txt` and its own NDJSON
parallel distribution, because each is independently a Derivative Database under
ODbL §4.4.

This also means the ODbL publication obligation scales with the number of packs
published, not with the number of records. Worth knowing before choosing how many
regional slices to cut.

## What I would not do

- **Delta packs against a previous version.** Tempting for update size, and it
  makes the skew problem combinatorial instead of a single equality check.
- **An id translation table.** It turns a missing pack from a gap into a wrong
  answer.
- **Per-locale *base* packs that omit regions.** Forbidden by ADR-0030 rule 1 and
  unnecessary once the full pack exists. Regional packs are additive slices of
  the remainder, never a base that is missing things.

## Open question for the integrator

Delivery is blocked on the repository having a git remote, since jsDelivr serves
from the public repo (ADR-0007, ADR-0031). Until then this stays a design note.
The sizes above are the ones to price the CDN decision against: **20.31 MB per
index version** if the full remainder is published as one pack.
