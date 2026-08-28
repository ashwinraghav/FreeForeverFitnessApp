# ADR-0028: Account linking merges rather than refuses, and leaves orphans alone

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Sync team (Claude Fable 5), ratified by the project owner with Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0009](./0009-anonymous-first-auth.md), [ADR-0025](./0025-conflict-resolution-per-data-class.md)

## Context

ADR-0009 starts every user anonymous so they can log a set within ten seconds of a cold
install. The bill for that arrives at linking: the user eventually attaches a real
credential, and sometimes that credential already belongs to an account with its own
training history.

The data at stake is not a preference. It is months of someone's logged training, and
there is no honest "pick one" — both halves happened.

## Decision

**Merge, into the credentialed account.** Direction is fixed rather than chosen: the
credentialed uid is the durable identity the user can sign into from another device, while
the anonymous uid dies with this device's storage.

The ordering is the entire safety argument, and it is deliberate:

1. **Export first, while still anonymous.** The full backup is written to a device-local
   journal *before any auth call*. From that moment the data exists in three places — the
   anonymous account's server documents, the local cache, and the journal.
2. **Try `linkWithCredential`.** The happy path is not a migration at all: the credential
   attaches to the existing anonymous account, same uid, no documents move, so nothing can
   be lost. This is the case ADR-0009 was chosen to make common.
3. **On `credential-already-in-use`, sign in to the target and import the journal through
   the ordinary write layer**, so every collision resolves under ADR-0025's per-class
   policies and every write is server-acknowledged.

`dataIntact: false` is unreachable by construction, not by care: nothing in the flow ever
deletes the source documents, and the export precedes the first auth call. A crash between
the account switch and the end of the import is recovered by `resumePendingLink()` on next
launch — **safe because import is idempotent**, by the same argument as ADR-0025: random
ids collide with themselves, date-keyed documents union, records join.

**Orphaned anonymous accounts are deliberately not deleted.** Once signed in as the target,
the device can no longer act as the anonymous user, and a half-failed deletion is worse
than an orphan. Cleanup is a server-side job — a scheduled deletion of anonymous accounts
and their subtrees after a period of inactivity — which nothing client-side can do and
which infra does not yet have.

## Consequences

No linking path loses training history, and the failure cases were enumerated and tested
rather than reasoned: target account already populated, link failing mid-flow, the same
person linking from two devices, an anonymous account abandoned and returned to.

Two honest limitations. Original `createdAt` values cannot survive a uid change, because
the rules correctly force `createdAt == request.time` on create — the user-facing truths
(`startedAt`, `localDate`, `performedAt`) all survive, and only the sync-plumbing timestamp
resets. And a user who clears storage before ever linking has an unrecoverable anonymous
credential; that data is orphaned on the server with no way for anyone to reach it. ADR-0009
priced that in.

**The outstanding work this ADR creates:** the scheduled orphan-cleanup job. Until it
exists, abandoned anonymous accounts accumulate. They are small and cost little, but the
cost is not zero and it grows monotonically, which is exactly the shape constitution rule 2
exists to catch.

## Alternatives considered

Refusing the link and asking the user to choose an account. Rejected — it strands whichever
half of the history they are not holding, and presents an impossible question.

Merging into the anonymous account instead. Rejected — it makes the durable identity the
disposable one.

Deleting the anonymous account after a successful merge. Rejected — the client cannot do it
safely once it has switched identity, and a partial deletion is worse than none.
