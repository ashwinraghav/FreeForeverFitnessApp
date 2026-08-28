/**
 * `@freeforever/data/sync` — the sync engine (ADR-0005, ADR-0009).
 *
 * Firebase client initialisation with the persistent local cache, App Check
 * enforcement, the write boundary with per-class conflict policies, locally
 * materialised aggregates, anonymous→linked account upgrade, and export/import.
 *
 * Start with `SYNC.md` in this directory for the consistency model and the
 * reasoning behind every policy.
 */

export * from './appCheck.js';
export * from './contribution.js';
export * from './engine.js';
export * from './export.js';
export * from './firebase.js';
export * from './kv.js';
export * from './linking.js';
export * from './merge.js';
export * from './week.js';
export * from './writes.js';
export { REDUCERS } from './reducers/registry.js';
export {
  applyEvent,
  freshRecord,
  rebuildRecord,
  statesEqual,
  type AggregateRecord,
  type ApplyOutcome,
} from './runner.js';
