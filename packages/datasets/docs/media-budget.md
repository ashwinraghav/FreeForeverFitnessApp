# Exercise media: budget, format, and CDN layout

Measured with `node pipeline/build-media.mjs --acknowledge-provenance-risk --limit 12`.

## The budget

| | Value |
|---|---|
| Ceiling per asset | **150 KB** |
| Measured mean per asset | **40.3 KB** (12-exercise sample) |
| Format | animated WebP, 2 frames, 1.2 s each, infinite loop |
| Dimensions | 720 px wide, aspect preserved |
| Encoder | `img2webp -loop 0 -min_size -lossy -q 78 -m 6` |
| Retry if over budget | re-encode once at q62 |
| Projected full catalogue | **~34 MB** for 873 exercises |
| Hard total ceiling | 80 MB; the media build fails past it |

The 150 KB ceiling is the number the project set. Actual output is roughly a
quarter of it, so the ceiling is headroom, not a target. If an asset ever needs
more than 150 KB the answer is fewer pixels or fewer frames, never a bigger
budget — the constants live in `src/media.mjs` so that raising them is a visible,
reviewable change rather than a quiet drift.

## Why an animated WebP and never a video

Constitution rule 3 forbids video hosting, permanently. An animated WebP is not
a video in any sense that matters:

- it is a sequence of still frames in an image container;
- it is served as a plain file from a CDN, with no player, no transcode ladder,
  no adaptive bitrate, no streaming server, no per-view cost;
- the browser decodes it through the image pipeline — `<img src>` works;
- it cannot grow into a video, because the format is not one.

That last point is the real reason. The rule exists because video hosting is the
canonical unbounded per-user cost, and the way projects acquire one is by
starting with "just a short clip". A two-frame image loop has no upgrade path to
that.

Two frames is the whole demonstration: the start and the end position of the
movement. A third frame roughly doubles the bytes and adds nothing the pair does
not already show. The text instructions and form cues carry the detail.

## AVIF

The pipeline emits WebP only. AVIF was considered and is not shipped:

- animated AVIF encoder support is patchy — `avifenc` is not present on a
  default toolchain, and ffmpeg's AV1 encoders target video muxing rather than
  animated stills;
- animated AVIF browser support lags animated WebP, which is effectively
  universal;
- WebP at 40 KB mean is already 3.7x inside budget, so the compression win would
  buy nothing a user notices.

If a working animated-AVIF encoder becomes routinely available, `jsdelivrUrl()`
already takes a format argument and the asset path is format-suffixed, so adding
a second encode is additive. Until then, one format means one thing to test.

## CDN layout (ADR-0007)

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/<basePath>/exercise/<mediaVersion>/<exerciseId>.webp
```

for example

```
https://cdn.jsdelivr.net/gh/thefreeforeverfitnessapp/thefreeforeverfitnessapp@media-v1/packages/datasets/build/media/assets/exercise/v1/Barbell_Squat.webp
```

Built by `jsdelivrUrl()` in `src/media.mjs`. Never construct this string by hand
in the app — a URL scheme that appears in twelve places is a URL scheme that
cannot be changed.

**Immutability.** The path contains both a git tag and a media version, so a
given URL always returns the same bytes and can be cached forever. New or
changed media means a **new** `MEDIA_VERSION` and a new tag; assets under an
existing version are never overwritten. Overwriting a file behind an immutable
CDN path is a cache-poisoning bug that outlives the deploy that caused it.

**Fallback.** `rawGithubUrl()` produces the same asset from
`raw.githubusercontent.com`. ADR-0007 names re-pointing to another host as the
mitigation for depending on a free CDN; keeping both as functions means the
switch is one change.

**Missing media is normal.** Media ships behind the catalogue, and while the
provenance question is open (see below) it may not ship at all. A 404 means "no
demo for this exercise yet" and the app must fall back to the text instructions
without an error state. The catalogue's `media.status` field is `"pending"`
until a build publishes.

## Repository placement — flagged for the integrator

At ~34 MB the full asset set is fine for jsDelivr and fine for GitHub's limits.
It is less fine inside the application repository.

- **Git history is append-only.** A committed blob is in the history
  permanently. Removing it later means rewriting history, which invalidates
  every clone and every open PR.
- **Binary blobs do not delta-compress.** 34 MB of WebP costs ~34 MB of pack,
  not the fraction that 34 MB of text would.
- **Every clone pays it, forever**, including every CI run that does not use a
  shallow or partial clone.
- **The cost compounds with every re-encode, because it does not replace.**
  This is the consequence worth reading twice. Media paths are immutable and
  version-pinned by design (see above) — we must *never* overwrite an asset
  under an existing `MEDIA_VERSION`. So a quality change, a resize, or a
  swapped image set means publishing `v2` **alongside** `v1`, and git keeps
  both. Three re-encodes is ~136 MB in the pack, and the only asset set anyone
  is serving is the last one. The immutability that makes the CDN correct is
  exactly what makes the repository grow.

A separate public `*-media` repository serves identically through jsDelivr,
keeps the app repo cloneable in seconds, and confines that growth to a
repository nobody has to clone to work on the app. That is a deviation from ADR-0007 as
written, which says the media lives in the public repository — so it is flagged
here rather than taken unilaterally. Changing `MEDIA_REPO.repo` in
`src/media.mjs` is the entire change on this side.

## Provenance gate

`pipeline/build-media.mjs` refuses to run without
`--acknowledge-provenance-risk`. That is not ceremony: the licensing of the
upstream demonstration photographs is unresolved (`../NOTICE.md` §3.2). Read
that section before publishing anything from this pipeline.

Every build writes `build/media/provenance.json` recording the source URL and
SHA-256 of every input frame, so that if the answer comes back wrong, the
affected assets can be identified and withdrawn in one pass. The pipeline is
deliberately source-agnostic: replacing the input image set with assets we
commission or generate ourselves is a change to the catalogue's
`upstreamImages`, not a rewrite.
