import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

/**
 * Shared harness for the rules suite.
 *
 * The rules under test are read from the repository's real `firestore.rules` — not
 * a copy — so a rule that is edited without a test is a test that starts failing.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = resolve(here, '../../../../firestore.rules');
export const RULES_SOURCE = readFileSync(RULES_PATH, 'utf8');

export const PROJECT_ID = 'freeforever-rules-test';

/** The user under test, a second unrelated user, and a coach. */
export const OWNER = 'ownerUidAAAAAAAAAAAAAAAAAAAA';
export const OTHER = 'otherUidBBBBBBBBBBBBBBBBBBBB';
export const COACH = 'coachUidCCCCCCCCCCCCCCCCCCCC';

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  const host = process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8080';
  const [hostname, port] = host.split(':');
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES_SOURCE,
      host: hostname ?? '127.0.0.1',
      port: Number(port ?? 8080),
    },
  });
}

/**
 * A signed-in context whose token says the account is anonymous.
 *
 * ADR-0009 promises an anonymous user the same rights as a linked one, so every
 * permission assertion in this suite is run through both this and
 * {@link linkedContext}. If a rule ever starts reading the sign-in provider, one of
 * the two runs fails.
 */
export function anonymousContext(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } });
}

export function linkedContext(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid, {
    email: `${uid}@example.test`,
    email_verified: true,
    firebase: { sign_in_provider: 'password' },
  });
}

// ---------------------------------------------------------------------------
// Document factories. Each returns a payload that the rules must ACCEPT, so that
// a test asserting rejection can change exactly one thing and attribute the
// failure to it.
// ---------------------------------------------------------------------------

const SERVER_TIMES = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

export const A_DATE = '2026-08-28';
export const AN_INSTANT = 1_787_000_000_000;

export function profileDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id: uid,
    ...SERVER_TIMES(),
    units: {
      trainingLoad: 'kg',
      bodyMass: 'kg',
      bodyLength: 'cm',
      distance: 'km',
      energy: 'kcal',
      barbellIncrementKg: 2.5,
      dumbbellIncrementKg: 2,
    },
    theme: 'dark',
    defaultRestSec: 120,
    auth: { isAnonymous: true, linkedProviders: [] },
    consent: { analytics: false, hostedAi: false },
    ...overrides,
  };
}

export function workoutDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    status: 'in_progress',
    title: 'Push A',
    startedAt: AN_INSTANT,
    localDate: A_DATE,
    tzOffsetMinutes: 60,
    exercises: [
      {
        id: 'we1',
        sortKey: 'V',
        exercise: {
          source: 'catalogue',
          exerciseId: 'bench_press',
          name: 'Bench Press',
          loadKind: 'external',
          effortKind: 'reps',
          muscles: [{ muscle: 'chest', fraction: 1 }],
          unilateral: false,
        },
        sets: [
          {
            id: 's1',
            sortKey: 'V',
            type: 'working',
            state: 'pending',
            load: { kind: 'external', weightKg: 60 },
            effort: { kind: 'reps', reps: 8 },
          },
        ],
      },
    ],
    totals: {
      exerciseCount: 1,
      setCount: 1,
      workingSetCount: 1,
      completedSetCount: 0,
      failedSetCount: 0,
      volumeKg: 0,
      volumeKgByMuscle: {},
      durationSec: 0,
    },
    ...overrides,
  };
}

export function routineDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    name: 'Upper/Lower',
    status: 'draft',
    days: [],
    weeks: [],
    ...overrides,
  };
}

export function exerciseDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    name: 'Trap Bar Deadlift',
    searchName: 'trap bar deadlift',
    source: 'custom',
    equipment: 'trap_bar',
    mechanic: 'compound',
    force: 'pull',
    movementPattern: 'hinge',
    loadKind: 'external',
    effortKind: 'reps',
    muscles: [{ muscle: 'quads', fraction: 1 }],
    unilateral: false,
    ...overrides,
  };
}

export function bodyMetricDoc(uid: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id: date,
    ...SERVER_TIMES(),
    localDate: date,
    tzOffsetMinutes: 60,
    measuredAt: AN_INSTANT,
    weightKg: 82.4,
    ...overrides,
  };
}

export function progressPhotoDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    localDate: A_DATE,
    tzOffsetMinutes: 60,
    takenAt: AN_INSTANT,
    pose: 'front_relaxed',
    storagePath: `users/${uid}/photos/${id}.jpg`,
    widthPx: 1080,
    heightPx: 1920,
    byteSize: 240_000,
    ...overrides,
  };
}

export function nutritionDayDoc(uid: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id: date,
    ...SERVER_TIMES(),
    localDate: date,
    tzOffsetMinutes: 60,
    meals: [],
    totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    entryCount: 0,
    waterMl: 0,
    ...overrides,
  };
}

export function foodDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    name: 'Skyr, plain',
    searchName: 'skyr plain',
    source: 'custom',
    nutrientsPer100g: { energyKcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2 },
    servings: [{ name: 'pot', gramsPerServing: 170 }],
    ...overrides,
  };
}

export function macroTargetDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    effectiveFrom: A_DATE,
    status: 'active',
    values: { energyKcal: 2600, proteinG: 180, carbsG: 280, fatG: 80 },
    source: 'manual',
    ...overrides,
  };
}

export function habitDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    name: 'Ten thousand steps',
    kind: 'count',
    cadence: 'daily',
    targetValue: 10_000,
    ...overrides,
  };
}

export function personalRecordDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    exercise: {
      source: 'catalogue',
      exerciseId: 'bench_press',
      name: 'Bench Press',
      loadKind: 'external',
      effortKind: 'reps',
      muscles: [{ muscle: 'chest', fraction: 1 }],
      unilateral: false,
    },
    current: {},
    repMaxKgByReps: {},
    history: [],
    ...overrides,
  };
}

export function aggregateDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    sv: 1,
    uid,
    id,
    ...SERVER_TIMES(),
    version: 1,
    sequenceByKind: { workout: 0 },
    computedAt: serverTimestamp(),
    state: { kind: 'training_volume', weeks: [], monthlyVolumeKg: {} },
    ...overrides,
  };
}

export function grantDoc(
  ownerUid: string,
  coachUid: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    sv: 1,
    id: `${ownerUid}__${coachUid}`,
    ownerUid,
    coachUid,
    status: 'active',
    scopes: ['profile', 'training'],
    ...SERVER_TIMES(),
    ...overrides,
  };
}

/** A concrete past timestamp, for asserting that client-chosen times are rejected. */
export function clientTimestamp(): Timestamp {
  return Timestamp.fromMillis(AN_INSTANT);
}
