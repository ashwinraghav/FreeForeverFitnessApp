# ADR-0005: Firestore is a sync engine, never a query engine

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

Firestore bills per document read ($0.03/100k). An analytics screen that queries Firestore to render a chart bills for every document, on every render, forever — the exact unbounded per-user cost ADR-0001 rule 2 forbids.

## Decision

The client is the source of truth during a session. Firestore provides offline persistence, the write queue and multi-device sync. Reads for the workout loop come from the local cache. Analytics read from **locally materialised aggregates computed on write**. A Firestore query inside `features/insights` is a build failure, not a code review comment.

## Consequences

Aggregates must be recomputed on schema change and repaired if they drift, which is real complexity that Team C owns. In exchange, request volume decouples from usage: a viral week costs approximately nothing.

## Alternatives considered

Querying Firestore directly with aggressive client caching. Rejected — cache invalidation bugs turn into surprise bills, and the failure is silent.
