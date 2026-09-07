<!--
Unsolicited pull requests are closed without review. If there is no accepted issue for
this, please open one first — CONTRIBUTING.md explains why.
-->

Closes #

## What this changes, and why

<!-- The why. The diff already says what. -->

## AI assistance

<!--
Required, and it is not a trick question. This codebase was largely written by an AI
agent; the policy is about accountability, not about tooling.

If you used a tool, add a trailer to the commit:
    Assisted-by: <tool and version>
-->

- [ ] No AI tool was involved
- [ ] An AI tool helped, it is disclosed with an `Assisted-by:` trailer, **and I have read
      every line and can explain it without going back to the model**

## Checks

- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] Tests ship with this change, not in a follow-up
- [ ] If this touches the UI, I opened a **real browser at 412px and at 200% text**
      — jsdom has no layout engine, so the suite is green at every viewport because it
      cannot see one
- [ ] If a test here asserts a negative, the positive case is proved in the same file
- [ ] If this adds a per-user cost, the quota ships in this pull request
- [ ] If this decides something arguable, an ADR is included (`pnpm adr "Title"`)

## Anything a reviewer should be suspicious of

<!--
Optional and genuinely welcome. "I am not sure the timezone handling is right" saves
everyone an afternoon. Nobody is marked down for saying it.
-->
