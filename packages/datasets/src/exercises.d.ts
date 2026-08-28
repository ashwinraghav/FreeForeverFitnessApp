/**
 * Types for `@freeforever/datasets/exercises`.
 *
 * ⚠ Loading a catalogue costs 213 KB gzipped / 1.66 MB parsed. It is async so
 * that it can be lazy-loaded; see the module header and the README.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Exercise } from './index.d.ts';

export type { Exercise } from './index.d.ts';

export interface ExerciseSearchHit {
  exercise: Exercise;
  score: number;
}

export interface ExerciseSource {
  /** `bytes` wins, then `url`, then the artefact packaged with this module (Node only). */
  bytes?: Uint8Array;
  url?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export declare const CATALOGUE_SIZE: {
  gzipBytes: number;
  parsedBytes: number;
  exercises: number;
};

export declare function openExerciseCatalogue(source?: ExerciseSource): Promise<ExerciseCatalogue>;

export declare class ExerciseCatalogue {
  constructor(data: unknown);
  readonly schemaVersion: number;
  readonly builtAt: string;
  readonly exercises: Exercise[];
  readonly length: number;
  /** Every muscle name that can appear. Assert your enum covers all of them. */
  readonly muscles: string[];
  /** Every equipment name that can appear. */
  readonly equipment: string[];
  /** `front-delts` -> `shoulders`, etc. Empty for muscles that are their own group. */
  readonly muscleGroups: Record<string, string>;
  readonly source: { repo: string; url: string; licence: string; licenceUrl: string };
  readonly coaching: { generator: string; authored: boolean };

  get(id: string): Exercise | null;
  all(): Exercise[];
  /** Tokens ANDed, last token treated as a prefix. Matches names and aliases. */
  search(query: string, opts?: { limit?: number }): ExerciseSearchHit[];
  /** `muscle` matches primary or secondary, and a group name matches its heads. */
  filter(where?: {
    muscle?: string;
    equipment?: string;
    category?: string;
    mechanic?: string;
  }): Exercise[];

  /**
   * Muscle names your map does not cover. Assert this is empty in CI: the day
   * free-exercise-db is rebuilt with a new name, the assertion fails instead of
   * the app silently shipping an empty muscle split.
   */
  unmappedMuscleNames(known: Iterable<string>): string[];
  unmappedEquipmentNames(known: Iterable<string>): string[];
}
