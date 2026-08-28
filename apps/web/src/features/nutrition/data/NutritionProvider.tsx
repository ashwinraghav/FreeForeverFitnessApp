import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FoodCatalogue } from './catalogue.js';
import { createLocalStore, type NutritionStore } from './store.js';
import { today, tzOffsetMinutes } from './dates.js';
import type { LocalDate, NutritionState } from './types.js';

/**
 * Feature-wide state.
 *
 * Two things live here and nothing else: the nutrition documents, and the food
 * index. Both are device-local. There is no loading spinner over the day view
 * waiting on a network call, because there is no network call — the day is read
 * from local state and the index is bytes the service worker already cached.
 */

export type CatalogueStatus = 'idle' | 'loading' | 'ready' | 'error';

interface NutritionContextValue {
  state: NutritionState;
  /** Apply a pure reducer and persist. The only way state changes. */
  mutate: (fn: (state: NutritionState) => NutritionState) => void;
  store: NutritionStore;

  catalogue: FoodCatalogue | null;
  catalogueStatus: CatalogueStatus;
  catalogueError: string | null;
  /** Load records + search for both shards. Idempotent. */
  ensureSearchIndex: () => Promise<void>;
  /** Load the barcode tables. Called when the scanner opens, not before. */
  ensureBarcodeIndex: () => Promise<void>;

  /** The day being viewed. Not necessarily today. */
  selectedDate: LocalDate;
  setSelectedDate: (date: LocalDate) => void;
  tzOffsetMinutes: number;
}

const NutritionContext = createContext<NutritionContextValue | null>(null);

export function NutritionProvider({
  children,
  store: providedStore,
}: {
  children: ReactNode;
  /** Injected by tests and by Storybook. Defaults to the localStorage adapter. */
  store?: NutritionStore;
}) {
  const storeRef = useRef<NutritionStore>(providedStore ?? createLocalStore());
  const store = storeRef.current;

  const [state, setState] = useState<NutritionState>(() => store.load());
  const [selectedDate, setSelectedDate] = useState<LocalDate>(() => today());
  const [catalogue, setCatalogue] = useState<FoodCatalogue | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueStatus>('idle');
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  const mutate = useCallback(
    (fn: (current: NutritionState) => NutritionState) => {
      setState((current) => {
        const next = fn(current);
        // Persist synchronously with the state change rather than in an effect:
        // an effect can be skipped if the tab is backgrounded between render
        // and commit, and a lost food entry is the failure mode that loses
        // trust fastest.
        if (next !== current) store.save(next);
        return next;
      });
    },
    [store],
  );

  const openCatalogue = useCallback(async (): Promise<FoodCatalogue | null> => {
    if (catalogue !== null) return catalogue;
    setCatalogueStatus('loading');
    try {
      const opened = await FoodCatalogue.open();
      setCatalogue(opened);
      return opened;
    } catch (error) {
      setCatalogueStatus('error');
      setCatalogueError(error instanceof Error ? error.message : 'index unavailable');
      return null;
    }
  }, [catalogue]);

  const ensureSearchIndex = useCallback(async () => {
    const opened = await openCatalogue();
    if (opened === null) return;
    try {
      await opened.loadForSearch();
      setCatalogueStatus('ready');
      setCatalogueError(null);
    } catch (error) {
      setCatalogueStatus('error');
      setCatalogueError(error instanceof Error ? error.message : 'index unavailable');
    }
  }, [openCatalogue]);

  const ensureBarcodeIndex = useCallback(async () => {
    const opened = await openCatalogue();
    if (opened === null) return;
    try {
      await opened.loadForBarcodes();
      setCatalogueStatus('ready');
      setCatalogueError(null);
    } catch (error) {
      setCatalogueStatus('error');
      setCatalogueError(error instanceof Error ? error.message : 'index unavailable');
    }
  }, [openCatalogue]);

  // The day rolls over while the app is open often enough to matter — someone
  // logging a late dinner at 23:59 must not add it to yesterday at 00:01.
  useEffect(() => {
    const timer = setInterval(() => {
      setSelectedDate((current) => (current === today() ? current : current));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const value = useMemo<NutritionContextValue>(
    () => ({
      state,
      mutate,
      store,
      catalogue,
      catalogueStatus,
      catalogueError,
      ensureSearchIndex,
      ensureBarcodeIndex,
      selectedDate,
      setSelectedDate,
      tzOffsetMinutes: tzOffsetMinutes(new Date()),
    }),
    [
      state,
      mutate,
      store,
      catalogue,
      catalogueStatus,
      catalogueError,
      ensureSearchIndex,
      ensureBarcodeIndex,
      selectedDate,
    ],
  );

  return <NutritionContext.Provider value={value}>{children}</NutritionContext.Provider>;
}

export function useNutrition(): NutritionContextValue {
  const value = useContext(NutritionContext);
  if (value === null) throw new Error('useNutrition must be used inside <NutritionProvider>');
  return value;
}
