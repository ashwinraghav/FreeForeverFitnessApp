import InsightsRoutes from '../features/insights/InsightsRoutes';
import { createLocalInsightsSource } from './insightsSource';

/**
 * The composition root for the Progress tab.
 *
 * `App.tsx` code-splits on this module rather than on `InsightsRoutes` directly, and
 * that indirection is load-bearing in two ways.
 *
 * **Ownership.** `features/insights` is the insights team's, and the reducers are the
 * sync team's. Joining them is neither team's job and neither team's file, so the join
 * lives here, in integrator territory, and both sides stay importable on their own.
 *
 * **Bytes.** Building the source pulls the reducers, and the reducers pull the schema
 * package. Doing it here keeps all of that inside the lazily-loaded Progress chunk
 * instead of the entry bundle that the logging screen waits on — free-forever rule 2
 * counts kilobytes on a basement 3G as a real cost, and the app opens on Train.
 *
 * The source is created once per module load, not per mount, so switching tabs does
 * not re-fold the history. It re-folds when the data underneath it changes; see
 * `insightsSource.ts`.
 */
const source = createLocalInsightsSource();

export default function InsightsScreen() {
  return <InsightsRoutes source={source} />;
}
