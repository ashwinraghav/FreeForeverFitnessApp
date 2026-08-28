# ADR-0023: Cloud Storage rules are part of the security surface

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f), prompted by a Fable adversarial review

## Context

The first parallel build assigned `firestore.rules` to the domain-model team and Terraform to
the infrastructure team. Cloud Storage belonged to neither. The result was a repository in which
Firestore rules carefully gated progress-photo *metadata* while the photo *bytes* sat in a bucket
with no ruleset anywhere — no `storage.rules`, no `storage` key in `firebase.json`, no bucket
ruleset in Terraform — leaving the console default of roughly
`allow read, write: if request.auth != null`.

Under ADR-0009 every visitor is anonymously signed in within seconds. That default therefore
granted any visitor read, list, overwrite and delete over every other user's progress photos —
the most sensitive data class in a body-image-adjacent product. `SCHEMA.md` documented a design
that depended on a control which did not exist.

This is the second failure mode of the strict file-ownership model in ADR-0018. Ownership
prevents collisions — 206 files across four parallel agents produced zero conflicts — but
anything the ownership map fails to assign belongs to nobody, and nobody reports it missing.
Nothing was done wrong by any team; the map had a hole.

## Decision

Cloud Storage rules are a first-class part of the security surface, held to the same standard as
Firestore rules under ADR-0015: public, therefore tested, with the tests blocking CI.

- `storage.rules` lives at the repository root beside `firestore.rules` and is owned by whoever
  owns the data model.
- The Storage emulator runs in CI alongside the Firestore emulator, and
  `packages/data/test/rules/storage.test.ts` asserts both directions — permitted access succeeds,
  forbidden access fails.
- Metadata and bytes must agree. Where Firestore grants a scope over a document, the
  corresponding Storage rule either grants the matching access or documents in a comment why the
  asymmetry is deliberate.

Additionally, the ownership map in `CLAUDE.md` must enumerate **every** security-relevant
artefact explicitly. A file that no team owns is a defect in the map, not an oversight by a team.

## Consequences

Storage is covered, and the general lesson is captured: strict ownership converts collision risk
into coverage risk, so the map itself needs auditing. Before each fan-out, the integrator now
lists the security-relevant artefacts and confirms each has an owner.

The coach-parity question is forced into the open rather than left implicit: a `photos`-scoped
coach can read photo metadata today, so whether they may read the bytes is now a recorded
decision rather than an accident of which rule file someone happened to write.

Cost: one more emulator in CI, and a slower path for changes touching photos.

## Alternatives considered

Leaving Storage to Terraform alone. Rejected — a ruleset is application logic that changes with
the data model, and it needs tests next to the rules it mirrors, not next to the infrastructure.

Keeping progress photos entirely device-local and never syncing them, which would remove the
attack surface completely. Genuinely attractive and still the default behaviour, but opt-in cloud
backup is a real user need and refusing it would push people to screenshot workarounds that are
worse. Revisit if Storage proves hard to keep correct.
