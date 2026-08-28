# ADR-0018: Monorepo file ownership as the parallel-agent boundary

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The failure mode of parallel agents is not capability, it is collision — two agents editing the same file, or building against assumptions that quietly diverged.

## Decision

pnpm workspaces, with package boundaries drawn as an explicit **file-ownership map**. Each team writes only inside directories it owns. Shared files — root config, route manifests — are edited only by the integrator. Contracts (design tokens, domain types, security rules) are frozen before any feature work fans out.

## Consequences

Six teams can work simultaneously without conflicts. Cost: cross-cutting changes need an integration pass and cannot be made unilaterally, which is slower but is what keeps the codebase coherent.

## Alternatives considered

A single agent working sequentially — coherent but far slower. Free-for-all parallelism — fast until the first merge conflict cascade.
