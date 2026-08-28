import type { AggregateId } from './aggregates.js';
import type {
  BodyMetricId,
  ExerciseId,
  FoodItemId,
  HabitId,
  MacroTargetId,
  PersonalRecordId,
  ProgressPhotoId,
  RecipeId,
  RoutineId,
  UserId,
  WorkoutId,
} from './common/ids.js';
import { coachGrantId } from './common/ids.js';
import type { LocalDate } from './common/time.js';

/**
 * The collection layout, as code.
 *
 * Two reasons this is a module rather than a comment in SCHEMA.md. Every path is
 * built in exactly one place, so a typo is a compile error rather than a document
 * quietly written somewhere nothing reads. And `firestore.rules` matches these
 * literal segment names — the constants below and the `match` statements in the rules
 * file are the same list, and the rules tests walk it.
 *
 * There is no catch-all rule under `/users/{uid}`. A collection that is not in this
 * list is denied by default, which means adding one requires a rules change and its
 * tests (ADR-0015). That friction is the point.
 */

export const COLLECTIONS = {
  users: 'users',
  workouts: 'workouts',
  routines: 'routines',
  exercises: 'exercises',
  personalRecords: 'personalRecords',
  bodyMetrics: 'bodyMetrics',
  progressPhotos: 'progressPhotos',
  foods: 'foods',
  recipes: 'recipes',
  nutritionDays: 'nutritionDays',
  macroTargets: 'macroTargets',
  habits: 'habits',
  habitDays: 'habitDays',
  aggregates: 'aggregates',
  coachGrants: 'coachGrants',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Every per-user subcollection. Used by the export path and the rules tests. */
export const USER_SUBCOLLECTIONS = [
  COLLECTIONS.workouts,
  COLLECTIONS.routines,
  COLLECTIONS.exercises,
  COLLECTIONS.personalRecords,
  COLLECTIONS.bodyMetrics,
  COLLECTIONS.progressPhotos,
  COLLECTIONS.foods,
  COLLECTIONS.recipes,
  COLLECTIONS.nutritionDays,
  COLLECTIONS.macroTargets,
  COLLECTIONS.habits,
  COLLECTIONS.habitDays,
  COLLECTIONS.aggregates,
] as const;

export type UserSubcollection = (typeof USER_SUBCOLLECTIONS)[number];

const userRoot = (uid: UserId): string => `${COLLECTIONS.users}/${uid}`;

export const paths = {
  /** The profile document. Also the parent of everything the user owns. */
  profile: (uid: UserId): string => userRoot(uid),

  userCollection: (uid: UserId, collection: UserSubcollection): string =>
    `${userRoot(uid)}/${collection}`,

  workouts: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.workouts}`,
  workout: (uid: UserId, id: WorkoutId): string => `${userRoot(uid)}/${COLLECTIONS.workouts}/${id}`,

  routines: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.routines}`,
  routine: (uid: UserId, id: RoutineId): string => `${userRoot(uid)}/${COLLECTIONS.routines}/${id}`,

  exercises: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.exercises}`,
  exercise: (uid: UserId, id: ExerciseId): string =>
    `${userRoot(uid)}/${COLLECTIONS.exercises}/${id}`,

  personalRecords: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.personalRecords}`,
  /** Id is `exerciseKey(ref)` — derived, so a PR check is a cache hit, not a query. */
  personalRecord: (uid: UserId, id: PersonalRecordId): string =>
    `${userRoot(uid)}/${COLLECTIONS.personalRecords}/${id}`,

  bodyMetrics: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.bodyMetrics}`,
  /** Id is the local date, which makes a same-day re-weigh an update, not a duplicate. */
  bodyMetric: (uid: UserId, id: BodyMetricId | LocalDate): string =>
    `${userRoot(uid)}/${COLLECTIONS.bodyMetrics}/${id}`,

  progressPhotos: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.progressPhotos}`,
  progressPhoto: (uid: UserId, id: ProgressPhotoId): string =>
    `${userRoot(uid)}/${COLLECTIONS.progressPhotos}/${id}`,

  foods: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.foods}`,
  food: (uid: UserId, id: FoodItemId): string => `${userRoot(uid)}/${COLLECTIONS.foods}/${id}`,

  recipes: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.recipes}`,
  recipe: (uid: UserId, id: RecipeId): string => `${userRoot(uid)}/${COLLECTIONS.recipes}/${id}`,

  nutritionDays: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.nutritionDays}`,
  /** Id is the local date. One document is one day. */
  nutritionDay: (uid: UserId, date: LocalDate): string =>
    `${userRoot(uid)}/${COLLECTIONS.nutritionDays}/${date}`,

  macroTargets: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.macroTargets}`,
  macroTarget: (uid: UserId, id: MacroTargetId): string =>
    `${userRoot(uid)}/${COLLECTIONS.macroTargets}/${id}`,

  habits: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.habits}`,
  habit: (uid: UserId, id: HabitId): string => `${userRoot(uid)}/${COLLECTIONS.habits}/${id}`,

  habitDays: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.habitDays}`,
  habitDay: (uid: UserId, date: LocalDate): string =>
    `${userRoot(uid)}/${COLLECTIONS.habitDays}/${date}`,

  aggregates: (uid: UserId): string => `${userRoot(uid)}/${COLLECTIONS.aggregates}`,
  aggregate: (uid: UserId, id: AggregateId): string =>
    `${userRoot(uid)}/${COLLECTIONS.aggregates}/${id}`,

  /** Top level, so a coach can list the clients who granted them access. */
  coachGrants: (): string => COLLECTIONS.coachGrants,
  coachGrant: (ownerUid: UserId, coachUid: UserId): string =>
    `${COLLECTIONS.coachGrants}/${coachGrantId(ownerUid, coachUid)}`,
} as const;
