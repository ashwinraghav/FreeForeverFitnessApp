import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGGREGATE_IDS } from '../../src/aggregates.js';
import { COLLECTIONS, USER_SUBCOLLECTIONS } from '../../src/collections.js';
import { COACH_SCOPES, GRANT_STATUSES } from '../../src/schemas/grants.js';
import { EQUIPMENT, EFFORT_KINDS, FORCE_VECTORS, LOAD_KINDS, MECHANICS, MOVEMENT_PATTERNS } from '../../src/schemas/exercise.js';
import { BODY_FAT_METHODS, PHOTO_POSES } from '../../src/schemas/body.js';
import { HABIT_CADENCES, HABIT_KINDS } from '../../src/schemas/habits.js';
import { ROUTINE_STATUSES } from '../../src/schemas/routine.js';
import { WORKOUT_STATUSES } from '../../src/schemas/workout.js';
import { SCHEMA_VERSION } from '../../src/common/envelope.js';

/**
 * `firestore.rules` cannot import TypeScript, so its enumerations are a hand copy of
 * the ones in this package. A hand copy drifts. This test is the thing that stops it
 * drifting silently — a value added to an enum here and not there would otherwise
 * fail at runtime as an unexplained PERMISSION_DENIED, in production, on a write the
 * user has already made.
 */

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, '../../../../firestore.rules'), 'utf8');

function rulesList(functionName: string): string[] {
  const match = RULES.match(
    new RegExp(`function\\s+${functionName}\\s*\\(\\)\\s*\\{\\s*return\\s*(\\[[^\\]]*\\])\\s*;`, 's'),
  );
  if (match?.[1] === undefined) {
    throw new Error(`firestore.rules has no function ${functionName}()`);
  }
  return [...match[1].matchAll(/'([^']*)'/g)].map((found) => found[1] as string);
}

const MIRRORED: readonly [string, readonly string[]][] = [
  ['workoutStatuses', WORKOUT_STATUSES],
  ['routineStatuses', ROUTINE_STATUSES],
  ['equipment', EQUIPMENT],
  ['mechanics', MECHANICS],
  ['forceVectors', FORCE_VECTORS],
  ['movementPatterns', MOVEMENT_PATTERNS],
  ['loadKinds', LOAD_KINDS],
  ['effortKinds', EFFORT_KINDS],
  ['photoPoses', PHOTO_POSES],
  ['bodyFatMethods', BODY_FAT_METHODS],
  ['habitKinds', HABIT_KINDS],
  ['habitCadences', HABIT_CADENCES],
  ['aggregateIds', AGGREGATE_IDS],
  ['coachScopes', COACH_SCOPES],
  ['grantStatuses', GRANT_STATUSES],
];

describe('firestore.rules mirrors the domain enums', () => {
  it.each(MIRRORED)('%s', (functionName, expected) => {
    expect(rulesList(functionName)).toEqual([...expected]);
  });
});

describe('firestore.rules mirrors the collection layout', () => {
  it('declares a match block for every user subcollection', () => {
    for (const name of USER_SUBCOLLECTIONS) {
      expect(RULES, `no match block for ${name}`).toContain(`match /users/{uid}/${name}/`);
    }
  });

  it('declares a match block for the profile and for coach grants', () => {
    expect(RULES).toContain('match /users/{uid} {');
    expect(RULES).toContain(`match /${COLLECTIONS.coachGrants}/{grantId} {`);
  });

  it('has no catch-all under a user, so a new collection cannot ship without a rule', () => {
    expect(RULES).not.toMatch(/match \/users\/\{uid\}\/\{[a-zA-Z]+=\*\*\}/);
  });
});

describe('firestore.rules mirrors the schema version', () => {
  it('gates writes at the version this package emits', () => {
    const match = RULES.match(/function\s+maxSchemaVersion\(\)\s*\{\s*return\s+(\d+)\s*;/);
    expect(match?.[1]).toBeDefined();
    expect(Number(match?.[1])).toBe(SCHEMA_VERSION);
  });
});
