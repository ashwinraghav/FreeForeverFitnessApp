import type { AggregateId, AggregateReducer } from '../../aggregates.js';
import { adherenceReducer } from './adherence.js';
import { exerciseProgressReducer } from './exerciseProgress.js';
import { nutritionReducer } from './nutrition.js';
import { personalRecordsReducer } from './personalRecords.js';
import { trainingVolumeReducer } from './trainingVolume.js';

/** Every reducer, keyed by aggregate id. The engine iterates this and nothing else. */
export const REDUCERS: { readonly [K in AggregateId]: AggregateReducer<K> } = {
  training_volume: trainingVolumeReducer,
  exercise_progress: exerciseProgressReducer,
  personal_records: personalRecordsReducer,
  adherence: adherenceReducer,
  nutrition: nutritionReducer,
};
