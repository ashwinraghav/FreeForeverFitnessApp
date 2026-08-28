/**
 * Pure domain logic — Apache-2.0 so it can be reused (ADR-0003).
 *
 * Everything here is deterministic and dependency-free: no Firebase, no React,
 * no I/O. This is where progressive overload, TDEE, e1RM and plate maths live,
 * and it is the reason those features cost nothing to run (ADR-0001 rule 1).
 * If a function here needs the network, it belongs somewhere else.
 */
// Both subtrees are re-exported here so consumers import `@freeforever/core`
// rather than deep-importing a path. Integrator-owned: two feature teams add to
// this package, and a shared barrel is exactly the file parallel work collides
// in (ADR-0018).
export * from './training/index.js';
export * from './nutrition/index.js';
