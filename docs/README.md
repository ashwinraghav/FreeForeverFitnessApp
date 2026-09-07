# docs

Everything that is not code. Public deliberately — the reasoning is the part most projects
keep to themselves, and it is the part that makes the rest reviewable.

## Where to start

**If you want to know why something is the way it is:** [`decisions/`](decisions/) —
34 architecture decision records, each with the context, the alternatives that were
rejected, and what the choice costs. Most "why not just…" questions are answered in one.

Records are **immutable once accepted**. A choice that turned out wrong is superseded by a
new record, with the failed reasoning left readable, rather than edited to look correct.
[ADR-0030](decisions/0030-bundled-food-index-is-a-cache-not-the-catalogue.md) and
[ADR-0033](decisions/0033-reach-is-a-download-problem-not-a-network-one.md) are a worked example: the second
supersedes one rule of the first, and the first still carries the argument that failed.

**If you want to know whether the economics hold up:**
[`strategy/`](strategy/) — the business plan, the cost model, and the execution plan.
[`strategy/costs/`](strategy/costs/) is where the monthly cloud bill is meant to land
([ADR-0020](decisions/0020-publish-monthly-costs.md)); it is still empty, which is listed
in the README's open items rather than quietly left.

**If you want to know how the code got written:**
[`agent-log/`](agent-log/) is where the AI agent transcripts are meant to be published
after a redaction pass ([ADR-0019](decisions/0019-publish-redacted-agent-log.md)). Also
still empty. Both of these are promises this project has not yet kept.

## Writing a decision record

```bash
pnpm adr "Title in the imperative"
```

A record earns its place if somebody six months from now would otherwise redo the
argument. Write down what was rejected and why — that is the half that stops the decision
being relitigated, and the half most records omit.
