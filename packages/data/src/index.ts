/**
 * `@freeforever/data` — the domain contract.
 *
 * Types, Zod schemas, the Firestore collection layout, and the aggregate reducer
 * interface. Every other package compiles against this one and nothing here depends
 * on a UI, a framework, or the Firebase SDK at runtime.
 *
 * Start with SCHEMA.md for the layout and the cost reasoning behind it.
 */

export * from './common/envelope.js';
export * from './common/ids.js';
export * from './common/sortKey.js';
export * from './common/time.js';
export * from './common/units.js';

export * from './schemas/body.js';
export * from './schemas/exercise.js';
export * from './schemas/grants.js';
export * from './schemas/habits.js';
export * from './schemas/nutrition.js';
export * from './schemas/profile.js';
export * from './schemas/records.js';
export * from './schemas/routine.js';
export * from './schemas/workout.js';

export * from './aggregates.js';
export * from './collections.js';
