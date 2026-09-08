# ADR-0031: The food index ships from the repo via jsDelivr, not from Hosting

- **Status:** Accepted (unblocked 2026-09-08 — the repository is public; no consumer yet)
- **Date:** 2026-08-31
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The food index is ~4 MB gzipped and byte-identical for every user.
`apps/web/scripts/sync-datasets.mjs` copies `packages/datasets/build/` into
`apps/web/public/data/`, so it is served by Firebase Hosting as part of the deployed site.

ADR-0007 already priced this traffic pattern for a different payload:

> Firebase Hosting includes 10GB/month of transfer and then charges **$0.15/GB**. Exercise
> demo media is the largest static payload in the app and is identical for every user —
> precisely the traffic pattern that turns egress pricing into an unbounded cost.

The food index is that pattern exactly. At 4 MB per new user, the free 10 GB is consumed by
roughly 2,500 users and every user after that has a marginal cost. Under ADR-0001 that is not
an optimisation opportunity, it is a defect: a per-user cost that grows without bound.

The datasets team independently proposed the opposite resolution — gitignore the artefacts and
publish them as GitHub Release assets — on the sound grounds that 4 MB of binaries per index
release accumulates in git history forever, and that `NOTICE.md` §2.3 already promises release
assets. That proposal was rejected, for a reason the proposal did not have available.

## Decision

**The shipped food index stays committed to the public repository, and is served to clients
through jsDelivr's free CDN** — the same mechanism ADR-0007 established for exercise media.

Committing is the *delivery mechanism*, not a convenience. jsDelivr serves files that exist in
a public repo; gitignoring the artefacts would make the free path impossible and strand the
project on the metered one. This is the second quantified return on ADR-0002's open-source
decision, after ADR-0007.

Supporting constraints that shaped this:

- Sample and fixture builds write to `build/sample/`; only full builds write to `build/`. The
  previous default sent fixture output to `build/`, which is how a 784-record sample came to be
  shipped to a user's phone while the pipeline reported success. **A default that can produce a
  wrong artefact is a defect even when nobody has yet run it wrongly.**
- Artefacts are committed on **index-version bumps only**, never per rebuild. Filenames carry
  the version, so a bump adds a path rather than rewriting a blob.

## Consequences

Git history grows by a few MB per index release. That is the accepted price of a $0 CDN, and it
is bounded by the version-bump rule rather than by rebuild frequency.

**The CSP needs `connect-src https://cdn.jsdelivr.net`** (integrator-owned). Today
`img-src` already permits jsDelivr — which is why ADR-0007's media path can work — but
`connect-src` does not, so `fetch()` of an index shard from the CDN would be blocked. Adding a
third-party origin to `connect-src` is a security-surface change and belongs in the ADR-0023
ownership audit.

A fresh clone works and `sync-datasets.mjs` finds what it expects, because the artefacts are
tracked. This was the datasets team's main objection to their own proposal and it resolves
itself under this decision.

**This decision is not yet executable.** The repository has no git remote: `git remote -v` is
empty. jsDelivr has nothing to serve from, and "fetch the release assets in CI" has nothing to
fetch from either — so neither this ADR nor ADR-0007's media path is live today. Both are
correct plans waiting on the same prerequisite. Firebase Hosting delivery is acceptable at
current scale (single-digit users) but must not be mistaken for the plan.

Whether ADR-0007's exercise media is actually wired into the app is a separate open question:
`jsdelivrUrl()` exists in `packages/datasets/src/media.mjs` and is exported, but no consumer
was found in `apps/web/src`.

## Alternatives considered

**Gitignore the artefacts, publish as GitHub Release assets** (rejected: removes the free CDN
path, breaks fresh clones and CI, and depends on a remote that does not exist. The git-history
concern behind it is real and is addressed by the version-bump rule instead.)

**Keep serving from Firebase Hosting** (rejected under ADR-0001: unbounded per-user egress,
$0.15/GB past 10 GB/month, for a payload identical for every user.)

**Cloudflare R2** (not rejected — remains the documented fallback under ADR-0007 if jsDelivr
becomes unsuitable. Zero egress, but adds an account and a deploy step where jsDelivr adds
neither.)
