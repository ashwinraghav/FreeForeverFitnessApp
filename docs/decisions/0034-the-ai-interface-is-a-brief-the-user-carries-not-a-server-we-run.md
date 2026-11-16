# ADR-0034: The AI interface is a brief the user carries, not a server we run

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decided by:** Project owner, with Claude Opus 5
- **Relates to:** [ADR-0016](./0016-ai-proxy-quotas-byok.md) (unchanged — this is a third path beside the proxy and BYO-key), [ADR-0005](./0005-firestore-is-a-sync-engine.md), [ADR-0001](./0001-free-forever-constitution.md) rules 2, 5 and 7

## Context

The owner asked for a way to let people interrogate their own data with AI, with **no
recurring cost and nothing for us to operate**. MCP was the obvious candidate and the
obvious objection was auth.

The objection is correct and it is not the strongest one. **A hosted MCP server would
have nothing to serve.** `apps/web/src/shell/exportData.ts` states the position
plainly: there is no synced copy, and everything this app knows lives in
`localStorage` on one device. Sync exists as a design in `packages/data/src/sync` and
is not wired to anything.

So a remote MCP server is not "MCP plus auth". It is cloud sync, accounts, and the
whole authorization ladder the MCP specification requires of HTTP transports —
OAuth 2.1, protected resource metadata, authorization server metadata, dynamic client
registration, PKCE — built before the first `tools/call` could return a single set.
That is a standing service with a per-user cost, which rule 2 forbids without a
ceiling, in order to serve data the user is already holding in their hand. (The
specification exempts stdio transports from all of it and tells them to take
credentials from the environment; on a local transport the filesystem *is* the
authorization. That difference is the whole finding.)

The alternative already in the product was the JSON export, and the owner's read of it
was right: it is enormous and mostly noise. Measured, by the size test in
`brief.test.ts`:

| | export (pretty JSON) | brief | |
|---|---|---|---|
| one week, 56 sets | 49,698 B | 2,045 B | 24x |
| three weeks, 168 sets | 148,756 B | 3,534 B | 42x |
| a full store, 840 sets | 743,140 B | 12,462 B | **60x** |

A set costs ~630 bytes in the export and 11 in the brief. The 630 is not whitespace:
it is `id`, `sortKey`, `loadKind`, `effortKind`, `state`, `performedAt` and four nulls
per set, all of which exist so two devices can merge a session without losing a set,
and none of which mean anything to a reader. Because `MAX_LOCAL_HISTORY` caps the
store at 60 sessions, 12 KB is not a typical brief — it is the **ceiling**.

## Decision

**The data goes to the AI. The AI does not come to the data.**

1. **A brief ships beside the export, never instead of it.** A compact, self-describing
   text summary — sessions, bests, weekly volume, consistency, recent food — composed
   from the same locally materialised aggregates the Progress tab draws, so it can
   never become a second opinion about the user's own training. `downloadLocalData()`
   is untouched and remains what rule 7 promises; the brief is deliberately lossy and
   is not an export.
2. **Handoff is the user's tap, and it degrades.** Share sheet with a file, then share
   sheet with text, then clipboard, then a download. The UI reports which one actually
   happened. A dismissed share sheet is a first-class outcome and stops the ladder —
   falling through to a download would be the app doing the thing the user just
   declined.
3. **`/brief` renders the whole thing as a page before anything leaves.** This is the
   consent surface, the manual fallback in a locked-down webview, and — at no extra
   cost — the version of "connect the app to an AI" that works *today*: any agent
   already driving the browser can read a page.
4. **No hosted MCP server, and no cloud sync built in order to have one.** Revisit only
   if sync ships for its own reasons.
5. **WebMCP is a follow-up, not a foundation.** `document.modelContext.registerTool`
   needs no server and would expose the same `buildBrief()` as a tool in about forty
   lines. It stays unbuilt for now: Chrome 149–156 origin trial, the surface moved from
   `navigator` to `document` mid-trial, and as of the mid-2026 audits no mainstream
   agent client calls page-declared tools. Cheap to add behind feature detection once
   one does.

## Consequences

There is no AI in the app and no key, quota, proxy or endpoint to operate, so this
feature cannot decay into a cost. Rule 5 holds because the third-party call belongs to
the user and their assistant, not to us — and rule 1 needs no zero-cost fallback here
because *this is the zero-cost path*; there is no metered version to degrade from.

The honest cost is a privacy boundary the app did not have before: this is the one
feature that sends a lifter's training to a company whose terms are not ours. It is
therefore always an explicit tap, the copy says so before the button, the page shows
exactly what would leave, and nothing is ever sent automatically. The More screen's
"nothing is uploaded" line is now "nothing is uploaded unless you send it somewhere
yourself", because the old sentence stopped being true.

Two smaller ones. The brief cannot be reached from the shell's main chunk: it folds
through `@freeforever/data/sync`, whose barrel still drags in the whole Firebase SDK
(132 kB gzipped, documented in `data/localAggregates.ts`), so `brief/sources` is
imported dynamically and `/brief` is a lazy route. And the brief is a **published
format**: once people build habits and prompts around it, changing the notation is a
breaking change to something outside this repository, which is why it explains itself
in every copy rather than relying on a spec nobody will read.

## Alternatives considered

**A hosted remote MCP server** (rejected: nothing to serve without sync, and then a
standing per-user cost plus the OAuth 2.1/DCR ladder — the largest possible build for
the smallest possible product).

**A local MCP bundle (`.mcpb`) reading a folder of briefs** (deferred, and the strongest
of the deferred options: one-click into a desktop client, no hosting, no auth because
the filesystem is the authorization, and it makes the data *queryable* rather than
pasted. Paired with `showDirectoryPicker()` the app could keep that folder current.
Desktop Chromium only — Safari and Firefox never shipped the local-disk pickers — so it
serves the smallest slice of a phone-first product. Revisit on demand.)

**In-app chat with a BYO key** (already permitted by ADR-0016 and not built here. The
brief is its context payload, so this ADR brings that closer rather than foreclosing
it.)

**An on-device model in the browser** — Chrome's Prompt API, or WebLLM (rejected: the
Prompt API needs 22 GB free disk and a ~4 GB model download and supports **neither
Android nor iOS**, which inverts this app's user; WebLLM moves the download bill to us,
which ADR-0033 already settled).

**Making the JSON export less noisy instead** (rejected: the noise is `sortKey`,
`loadKind` and `performedAt`, which are exactly what makes the export a complete and
re-importable copy. Rule 7 wants that file fat. Two artefacts for two jobs is correct.)
