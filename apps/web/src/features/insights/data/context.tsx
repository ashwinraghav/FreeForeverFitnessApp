import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { LocalDate } from '@freeforever/data';
import { FALLBACK_UNIT_PREFERENCES } from '../select/constants';
import type { InsightsDataSource, InsightsSnapshot, ProgressPhotoStore } from './ports';

/**
 * Wiring for the one seam.
 *
 * `useSyncExternalStore` rather than an effect-plus-state: the store is already
 * synchronous and already the source of truth, so subscribing to it directly is both
 * correct under concurrent rendering and free of the render-then-fetch shape that
 * would give a future maintainer somewhere obvious to put a network call.
 */

const InsightsContext = createContext<InsightsDataSource | null>(null);
const PhotoContext = createContext<ProgressPhotoStore | null>(null);

/** A source with nothing in it. What the feature runs on until sync provides one. */
export function emptyInsightsSource(
  today: LocalDate,
  units = FALLBACK_UNIT_PREFERENCES,
): InsightsDataSource {
  const snapshot: InsightsSnapshot = {
    trainingVolume: null,
    exerciseProgress: null,
    personalRecords: null,
    adherence: null,
    bodyMetrics: null,
    today,
    timeZone: 'UTC',
    units,
    rebuilding: false,
  };
  return { read: () => snapshot, subscribe: () => () => undefined };
}

/** A store with no photos. Never uploads, never fetches. */
export const emptyPhotoStore: ProgressPhotoStore = {
  list: () => [],
  openLocal: async () => null,
  subscribe: () => () => undefined,
};

/** Build a source from a fixed snapshot. Used by tests and by the fixture harness. */
export function staticInsightsSource(snapshot: InsightsSnapshot): InsightsDataSource {
  return { read: () => snapshot, subscribe: () => () => undefined };
}

export interface InsightsProviderProps {
  readonly source: InsightsDataSource;
  readonly photos?: ProgressPhotoStore;
  readonly children: ReactNode;
}

export function InsightsProvider({ source, photos = emptyPhotoStore, children }: InsightsProviderProps) {
  return (
    <InsightsContext.Provider value={source}>
      <PhotoContext.Provider value={photos}>{children}</PhotoContext.Provider>
    </InsightsContext.Provider>
  );
}

const FALLBACK_TODAY = '1970-01-01' as LocalDate;

export function useInsights(): InsightsSnapshot {
  const source = useContext(InsightsContext);
  const fallback = useMemo(() => emptyInsightsSource(FALLBACK_TODAY), []);
  const active = source ?? fallback;
  return useSyncExternalStore(active.subscribe, active.read, active.read);
}

export function usePhotoStore(): ProgressPhotoStore {
  return useContext(PhotoContext) ?? emptyPhotoStore;
}
