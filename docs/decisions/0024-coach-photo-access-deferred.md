# ADR-0024: Coach access to progress-photo bytes is deferred to Phase 4

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0015](./0015-public-rules-need-tests.md), [ADR-0017](./0017-no-public-social-feed.md), [ADR-0023](./0023-storage-rules-are-security-surface.md)

## Context

`storage.rules` was first written with a cross-service grant check, so that a coach holding the
`photos` scope could read a client's progress-photo bytes and not only the metadata. The
reasoning for symmetry was sound and is preserved here, because it should be the starting point
when this is revisited:

- The `photos` scope exists so a coach can review physique progress. A scope delivering only a
  pose name and a date delivers nothing.
- The metadata already carries a `blurhash` — a genuinely visual approximation. Serving that
  while withholding the file is a half-measure, not a control.
- Symmetry means one revocation path. Revoking the grant, dropping the scope, or letting it
  expire closes metadata and bytes in a single write; an asymmetric design needs two services
  kept in step by hand, and they drift.
- A user denied a scoped, revocable grant does not stop sharing photos — they send them over
  WhatsApp, which is strictly worse for them.

Two things independent of that reasoning blocked it.

**It cannot be tested.** `@firebase/rules-unit-testing` has a documented defect
([firebase-js-sdk#6803](https://github.com/firebase/firebase-js-sdk/issues/6803)): the Firestore
document a test writes does not land in the store that `firestore.get()` inside Storage rules
reads. Verified against the emulator — every owner-path, upload-validation and default-deny
assertion passed; only the five cross-service cases failed, and no change to our rules can make
them pass.

**The production ceiling is low.** Cross-service Storage rules permit at most **two** Firestore
document lookups per evaluation — far tighter than Firestore's own 10/20 cap. The rule used one
unique path, so it fit, but with no headroom as the model grows.

## Decision

Remove the cross-service grant. `allow get` on progress photos is `isOwner(uid)` only. A
`photos`-scoped coach sees metadata and not bytes — a deliberate, temporary asymmetry, recorded
in `storage.rules` and `SCHEMA.md` so nobody "fixes" it in either direction by accident.

The five coach tests were **deleted rather than skipped**. A skipped test is a standing claim of
coverage that does not exist; a comment in the ruleset is the honest record.

## Consequences

No untestable security control ships. That is the governing reason: a rule guarding photographs
of people's bodies, in a public repository where the rule is readable and the gap inferable, must
be exercised in CI or must not exist. ADR-0015 says rules are public and therefore tested; a rule
that *cannot* be tested fails that standard by construction.

Nothing ships later — coach features are Phase 4 regardless — and the storage suite is green,
so ADR-0015's blocking CI job stays meaningful rather than carrying a known-failing exception.

Cost: the asymmetry is a real product wart if a coach ever asks why they can see that a photo
exists but not the photo.

## Reversal criteria

Revisit at Phase 4, when coach features are actually built. In preference order:

1. **A Cloud Function minting short-lived signed URLs** after checking the grant in Firestore.
   Fully testable, no lookup ceiling, and the grant check lives in code that can be unit-tested
   directly. Costs a function invocation per photo view — bounded, quota-able, and consistent
   with ADR-0016's posture on metered paths.
2. **The cross-service rule**, if firebase-js-sdk#6803 is fixed and the two-document ceiling is
   still comfortable. Reinstate the reasoning above verbatim.
3. **Keep the asymmetry**, if coaches in practice never ask for it.

## Alternatives considered

Shipping the cross-service rule with the five tests skipped and a tracking issue. Rejected — it
is exactly the untested-public-rule failure ADR-0015 exists to prevent, and skipped tests are
read as coverage by everyone who did not write them.

Dropping the `photos` scope from the grant model entirely. Rejected as premature: metadata-only
access is genuinely useful for adherence review, and removing the scope would discard a model
that Phase 4 will want.
