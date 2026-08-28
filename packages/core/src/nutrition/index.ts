/**
 * Nutrition domain logic. Pure, deterministic, dependency-free.
 *
 * No network, no model, no clock. Every function here is a function of its
 * arguments — which is what makes the whole nutrition feature cost nothing to
 * run and work in a basement gym with no signal (ADR-0001 rule 1, ADR-0006).
 *
 * Read the modules in this order:
 *
 *   types.ts       the canonical shapes and units
 *   nutrients.ts   arithmetic over a nutrient profile; absent ≠ zero
 *   portions.ts    servings, densities, unit conversion — grams are canonical
 *   energy.ts      Mifflin-St Jeor and the activity ladder
 *   safety.ts      the floors a prescribed intake may not go below
 *   targets.ts     energy target and macro split, with every clamp reported
 *   variation.ts   per-day calorie cycling that preserves the weekly total
 *   day.ts         day roll-up and the ring's arithmetic
 *   recipe.ts      recipe folding, including cooked mass
 *   format.ts      the one-way door to display strings
 */

export * from './types.js';
export * from './nutrients.js';
export * from './portions.js';
export * from './energy.js';
export * from './safety.js';
export * from './targets.js';
export * from './variation.js';
export * from './day.js';
export * from './recipe.js';
export * from './format.js';
