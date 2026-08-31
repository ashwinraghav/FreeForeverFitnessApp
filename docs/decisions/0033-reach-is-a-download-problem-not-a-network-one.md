# ADR-0033: Reach is a download-size problem, not a network-architecture one

- **Status:** Accepted
- **Date:** 2026-08-31
- **Supersedes:** rule 3 of [ADR-0030](./0030-bundled-food-index-is-a-cache-not-the-catalogue.md). Rules 1 and 2 of that ADR stand unchanged.
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f), on evidence from the datasets team

## Context

ADR-0030 satisfied "all country products visible everywhere" by letting search fall back to Open
Food Facts' public API, and justified it under ADR-0001 on the grounds that the request goes
browser-direct to OFF and therefore "adds no Firebase egress and no per-user cost". The datasets
team was asked to sanity-check that reasoning. It does not survive.

**OFF's documented policy forbids precisely this use.** From their API documentation:

> "10 req/min/IP address for all search queries" · "15 req/min/IP address for all read product
> queries" · "don't use it for a search-as-you-type feature, you would be blocked very quickly" ·
> "If these limits are reached, we reserve the right to deny you access to the website and the API
> through IP address ban."

Their stated remedy for applications generating heavy traffic is to host a local instance. So the
fallback is not a tight budget to engineer against; it is the named use they refuse.

**Per-IP limits fail worst where this project's first user is.** Mobile carrier NAT places
thousands of subscribers behind one public address — pronounced on Indian networks. Ten searches a
minute would be shared across every user of this app behind that NAT, and the penalty is a ban on
the address. That ban would remove OFF access for everyone behind it, including people who have
never used this app, and including OFF's own website. The failure mode harms third parties and a
charity, not just us.

**And the cost argument was measuring the wrong quantity.** ADR-0001 rule 2 forbids *unbounded
per-user cost*. ADR-0030 rule 3 did not bound the cost; it relocated it onto donated
infrastructure, against that infrastructure's written wishes. *Free to us* and *bounded* are
different properties and only the second is the constraint. The asymmetry ADR-0030 arrived at makes
this plain: it rejected a Cloud Run proxy of our own for being "metered per-user egress" while
accepting unmetered load on a charity. A quota'd endpoint is bounded by construction; an IP-bannable
third-party API is free until it is not.

**The rejected alternative was measured and is cheaper than the accepted one.** ADR-0030 dismissed
"raise the budget to fit all records" at an estimated ~20 MB. Built:

| | records | gzipped |
|---|---|---|
| core | 286,352 | 11.53 MB |
| off | 213,181 | 8.78 MB |
| **all quality-gated records** | **499,533** | **20.31 MB** |

16 MB more than today buys the entire corpus — offline, no third party, no rate limit, no privacy
disclosure, no CSP change, no ban risk.

Finally, the mechanism ADR-0030 needed already existed and was not read.
`packages/datasets/docs/long-tail-contract.md` specifies a Cloud Run endpoint of ours with
`region` documented as "biases ranking; never filters" (already honouring ADR-0030 rule 1), App
Check as the abuse ceiling, and a cost ceiling that ships with the endpoint.

## Decision

**Reach is bought with bytes, not with a runtime dependency on someone else's server.**

1. **Opt-in full or regional packs are the primary mechanism.** 4 MB ships in the app; the
   remaining ~16 MB is an optional download, whole or in regional slices. This satisfies "visible
   everywhere" completely, works offline, costs nothing recurring, and needs no CSP change and no
   privacy disclosure.
2. **The residue goes to our own long-tail endpoint**, per the existing contract — unrecognised
   barcodes, misspellings, records that failed our gates. It is ours, so ADR-0001 rule 2 applies and
   a quota ships with it. This is also what OFF's documentation tells heavy re-users to do.
3. **No client-side dependency on OFF's search API.** Not as a fallback, not debounced, not
   rate-limited on our side.
4. **Barcode lookup against OFF is a separate question, left open.** A scan is a deliberate,
   infrequent action against a 15 req/min endpoint, unlike a keystroke. The NAT objection still
   applies, so this is not approved here — it is merely not decided here.

## Consequences

Delivering ~20 MB of artefacts makes ADR-0031's jsDelivr decision more load-bearing, not less: at
Firebase Hosting's $0.15/GB past 10 GB, a 20 MB optional pack is exactly the payload that must not
be served from Hosting.

Opt-in means a real choice presented to the user, with the size stated. A silent 16 MB download on
a metered connection would be its own free-forever violation.

ADR-0030's framing survives and is strengthened: the bundled index is still a cache rather than the
catalogue, and locale still may rank but never gate. Only the reach mechanism changes.

**The process lesson is the more valuable one.** ADR-0030 was written and committed inside an hour,
citing ADR-0007's arithmetic correctly, and was wrong because it never checked the third party's
terms and never read the contract the owning team had already written. Speed produced a decision
that looked well-grounded — the cost model was cited, the ADR trail was consistent — while the load-
bearing premise was unverified. **An ADR that cites its own repository's precedent fluently is not
thereby correct.** The check that caught this was asking the owning team to attack the reasoning
rather than implement it.

## Alternatives considered

**Keep ADR-0030 rule 3 with client-side rate limiting** (rejected: per-IP limits are not ours to
respect on a shared NAT, and the documentation refuses the use case regardless of our own throttle).

**Self-host Product Opener**, as OFF suggests (rejected: a standing server and index to operate,
where a static file download achieves the same reach; revisit only if the long-tail endpoint's hit
rate makes it cheaper).

**Ship all 20.31 MB to everyone by default** (rejected: 20 MB unrequested on a metered mobile
connection. The pack must be a choice, which is what makes rule 1 acceptable.)
