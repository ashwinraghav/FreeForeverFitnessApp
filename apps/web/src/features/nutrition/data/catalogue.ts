import {
  FoodIndex,
  FoodIndexSet,
  openIndexFromUrls,
  type Food,
  type SearchHit,
} from '@freeforever/datasets';

/**
 * Loading and querying the on-device food index.
 *
 * The entire justification for ADR-0006 lives in this file: search is the
 * highest-frequency read in the product, and it answers from bytes already on
 * the device. There is no request here, and there is no code path that adds
 * one. If this file ever grows a `fetch` to a query endpoint, the free-forever
 * promise has a recurring per-user cost in it.
 *
 * Loading is staged, because the first search must not wait on bytes it does
 * not need:
 *
 *   1. `core` records + search — USDA, a few hundred KB, on first open.
 *   2. `off` records + search — Open Food Facts, on first search or idle.
 *   3. barcode tables for both — only when the scanner opens.
 *
 * Everything is fetched from versioned, immutable URLs, so the service worker
 * can cache them permanently and a new index is a new URL rather than a
 * revalidation (`packages/datasets/docs/food-index-format.md`).
 */

/** Where `apps/web/scripts/sync-datasets.mjs` puts the artefacts. */
const DATA_BASE = '/data';

export interface ManifestFile {
  role: 'records' | 'search' | 'barcodes' | string;
  file: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
}

export interface ManifestArtefact {
  shard: string;
  licence: string;
  files: ManifestFile[];
}

export interface IndexManifest {
  schemaVersion: number;
  indexVersion: string;
  builtAt: string;
  locale: string;
  shards: Record<string, { shipped: number; gzipBytes: number }>;
  artefacts: ManifestArtefact[];
  sources?: { name: string; licence: string; attribution: string; url?: string }[];
}

export type ShardName = 'core' | 'off';

function urlsFor(manifest: IndexManifest, shard: ShardName, roles: readonly string[]) {
  const artefact = manifest.artefacts.find((a) => a.shard === shard);
  if (!artefact) throw new Error(`manifest declares no "${shard}" shard`);
  const out: { records: string; search?: string; barcodes?: string } = { records: '' };
  for (const role of roles) {
    const file = artefact.files.find((f) => f.role === role);
    if (!file) continue;
    const url = `${DATA_BASE}/${file.file}`;
    if (role === 'records') out.records = url;
    if (role === 'search') out.search = url;
    if (role === 'barcodes') out.barcodes = url;
  }
  if (!out.records) throw new Error(`manifest declares no records file for "${shard}"`);
  return out;
}

/**
 * The app's view of the food index: two shards, queried as one list, loaded in
 * stages.
 *
 * The shards stay separate artefacts because `core` is public domain and `off`
 * carries ODbL share-alike; `FoodIndexSet` unions them in memory on the device,
 * which creates no published database and so triggers no obligation
 * (`packages/datasets/NOTICE.md` §2.4). Nothing here may persist a merged copy.
 */
export class FoodCatalogue {
  #manifest: IndexManifest;
  #shards = new Map<ShardName, FoodIndex>();
  #set: FoodIndexSet | null = null;
  #loading = new Map<string, Promise<void>>();

  private constructor(manifest: IndexManifest) {
    this.#manifest = manifest;
  }

  get manifest(): IndexManifest {
    return this.#manifest;
  }

  get indexVersion(): string {
    return this.#manifest.indexVersion;
  }

  /** Shards currently resident. Surfaced so the UI can say what it is searching. */
  get loadedShards(): ShardName[] {
    return [...this.#shards.keys()];
  }

  /** True once the barcode tables are resident and `byBarcode` can answer. */
  get barcodesReady(): boolean {
    return this.#barcodesLoaded;
  }
  #barcodesLoaded = false;

  static async open(fetchImpl: typeof fetch = fetch): Promise<FoodCatalogue> {
    const res = await fetchImpl(`${DATA_BASE}/manifest.json`);
    if (!res.ok) throw new Error(`food index manifest unavailable: ${res.status}`);
    const manifest = (await res.json()) as IndexManifest;
    return new FoodCatalogue(manifest);
  }

  /**
   * Load one shard's records and search dictionary. Idempotent and safe to call
   * concurrently — the in-flight promise is shared, so two components mounting
   * at once do not fetch the artefacts twice.
   */
  async loadShard(shard: ShardName, opts: { barcodes?: boolean } = {}): Promise<void> {
    const key = `${shard}:${opts.barcodes === true ? 'full' : 'search'}`;
    const existing = this.#loading.get(key);
    if (existing) return existing;

    const roles = opts.barcodes === true
      ? (['records', 'search', 'barcodes'] as const)
      : (['records', 'search'] as const);

    const task = (async () => {
      const index = await openIndexFromUrls(urlsFor(this.#manifest, shard, roles));
      this.#shards.set(shard, index);
      this.#set = new FoodIndexSet([...this.#shards.values()]);
      if (opts.barcodes === true) this.#barcodesLoaded = true;
    })();

    this.#loading.set(key, task);
    try {
      await task;
    } catch (error) {
      // Drop the memo so a transient failure can be retried rather than
      // permanently poisoning the shard.
      this.#loading.delete(key);
      throw error;
    }
  }

  /** Everything needed to search. Awaited by the search screen on mount. */
  async loadForSearch(): Promise<void> {
    await this.loadShard('core');
    // OFF is the bigger shard and mostly branded products; core answers a whole
    // food query on its own, so it must not be blocked behind this.
    await this.loadShard('off');
  }

  /** Barcode tables for both shards. Awaited only when the scanner opens. */
  async loadForBarcodes(): Promise<void> {
    await Promise.all([
      this.loadShard('core', { barcodes: true }),
      this.loadShard('off', { barcodes: true }),
    ]);
  }

  search(query: string, opts?: { limit?: number }): SearchHit[] {
    return this.#set?.search(query, opts) ?? [];
  }

  byBarcode(barcode: string): Food | null {
    return this.#set?.byBarcode(barcode) ?? null;
  }

  /** Resolve a persisted `shard:sourceId`. Null when the index no longer has it. */
  getById(id: string): Food | null {
    return this.#set?.getById(id) ?? null;
  }
}
