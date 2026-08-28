import type {
  AdherenceAggregate,
  ExerciseProgressAggregate,
  LocalDate,
  MuscleGroup,
  PersonalRecordsAggregate,
  PhotoPose,
  TrainingVolumeAggregate,
  UnitPreferences,
} from '@freeforever/data';
import type { BodyMetricsAggregate } from './proposed';

/**
 * The seam. Every number this feature draws arrives through here, and nothing else.
 *
 * ADR-0005 makes a Firestore query inside `features/insights` a build failure, and
 * this interface is how that is enforced structurally rather than remembered:
 *
 * **The port has no query surface.** `read()` takes no arguments. There is no id to
 * pass, no date range, no `where`, no `limit` — nothing a caller could reach for that
 * an implementer could later satisfy by going to the network. It hands back whole
 * materialised aggregates, already folded by the sync team's reducers, already in
 * memory. Every window, filter and sort in this feature is a pure function over that
 * object (see `../select`), so "narrow the range" is an array slice and can never
 * quietly become a billed read.
 *
 * A field is `null` when its aggregate has not been materialised yet — a cold device,
 * a version bump mid-rebuild, or (for `bodyMetrics`) a reducer that does not exist in
 * the contract yet. Null is a first-class state that every view renders as an empty
 * state; it is never a reason to go and fetch.
 */
export interface InsightsSnapshot {
  readonly trainingVolume: TrainingVolumeAggregate | null;
  readonly exerciseProgress: ExerciseProgressAggregate | null;
  readonly personalRecords: PersonalRecordsAggregate | null;
  readonly adherence: AdherenceAggregate | null;
  /** Proposed contract — see `./proposed`. Null until the reducer lands. */
  readonly bodyMetrics: BodyMetricsAggregate | null;
  /**
   * The user's local calendar day, supplied rather than read from a clock so every
   * selector stays pure and every chart is reproducible in a test.
   */
  readonly today: LocalDate;
  /** IANA zone the aggregates were bucketed in. Display only. */
  readonly timeZone: string;
  readonly units: UnitPreferences;
  /** True while a rebuild is in flight; views hold the previous render, dimmed. */
  readonly rebuilding: boolean;
}

/**
 * Read-only, synchronous, cache-backed. `read()` must never touch the network and
 * must never be async — an await here is where a Firestore round trip would hide.
 */
export interface InsightsDataSource {
  read(): InsightsSnapshot;
  /** Fires when the local fold changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * Progress photos.
 *
 * Device-local by default. `bytesLocation` is the whole reason this is a separate
 * port: metadata and pixels are not the same asset and do not travel together.
 * ADR-0024 leaves a `photos`-scoped coach seeing metadata and not bytes, so every
 * surface here is built to render from metadata alone and treat pixels as a bonus.
 */
export interface ProgressPhotoRef {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly pose: PhotoPose;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Tiny placeholder so the gallery lays out before — and without — any image. */
  readonly blurhash?: string;
  readonly weightKg?: number;
  /**
   * `device` — pixels are on this device only, the default.
   * `cloud` — the user explicitly opted this photo into sync.
   * `absent` — metadata is visible but the pixels are not reachable from here.
   */
  readonly bytesLocation: 'device' | 'cloud' | 'absent';
}

export interface ProgressPhotoStore {
  list(): readonly ProgressPhotoRef[];
  /**
   * An object URL for the pixels, or null when they are not on this device. Never
   * uploads, never downloads-on-view, and never signs a URL: opting a photo into the
   * cloud is a separate, explicit action that lives outside this feature.
   */
  openLocal(id: string): Promise<string | null>;
  subscribe(listener: () => void): () => void;
}

/** Short labels. Long enough to be unambiguous, short enough for a bar tip. */
export const MUSCLE_LABELS: Readonly<Record<MuscleGroup, string>> = {
  chest: 'Chest',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  lats: 'Lats',
  upper_back: 'Upper back',
  traps: 'Traps',
  lower_back: 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  neck: 'Neck',
  full_body: 'Full body',
};
