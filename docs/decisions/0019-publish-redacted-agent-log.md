# ADR-0019: Publish agent transcripts through a redaction pass

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The AI agent transcripts that produced this project are genuinely interesting and fit the openness commitment in ADR-0002. They also pick up absolute paths, environment variables and occasionally tokens.

## Decision

`docs/agent-log/` is written by a redaction script — home-directory paths rewritten, secret-pattern scan, and a manual gate before the first publish. Never a raw dump.

## Consequences

The full reasoning behind the project is inspectable. Cost: a redaction step that must be maintained and must fail closed.

## Alternatives considered

Publishing raw transcripts (rejected: leaks). Not publishing (rejected: it is one of the more interesting artefacts here).
