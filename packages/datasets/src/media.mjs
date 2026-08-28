/**
 * Exercise media: the budget, and how a URL is constructed.
 *
 * Shared by the pipeline (which enforces the budget) and the app (which builds
 * the URLs), so the two cannot drift.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bumped when the media set changes. Never overwrite an existing version's
 * assets: jsDelivr caches immutably by design, and a changed file under an old
 * path is a cache-poisoning bug that will outlive the deploy. New media means a
 * new version and a new path.
 */
export const MEDIA_VERSION = 'v1';

/**
 * Where the media lives. ADR-0007 puts it in the public repository, served by
 * jsDelivr, pinned to a git tag.
 *
 * OPEN QUESTION FOR THE INTEGRATOR: at the measured ~57 KB per asset, the full
 * 873-exercise set is roughly 50 MB. That is fine for jsDelivr and fine for
 * GitHub's limits, but it lands in every `git clone` of the app repository
 * forever, and binary blobs never compress or delete from git history. A
 * separate public `*-media` repository serves identically through jsDelivr and
 * keeps the app repo cloneable in seconds. That is a deviation from ADR-0007 as
 * written, so it is flagged rather than taken: change `repo` below and nothing
 * else moves.
 */
export const MEDIA_REPO = {
  owner: 'thefreeforeverfitnessapp',
  repo: 'thefreeforeverfitnessapp',
  /** Git tag the CDN pins to. Set by the release workflow. */
  tag: `media-${MEDIA_VERSION}`,
  basePath: 'packages/datasets/build/media/assets',
};

/**
 * The budget, in one place, because a download budget that lives in comments is
 * a download budget that has already been exceeded.
 *
 * `maxBytesPerAsset` is 150 KB — the ceiling the project set. Measured output
 * at these settings is ~57 KB for a two-frame 720 px loop, so the ceiling is
 * roughly 2.5x headroom rather than a target to grow into. If a future asset
 * needs more than 150 KB, the answer is fewer pixels, not a bigger budget.
 */
export const MEDIA_BUDGET = {
  maxBytesPerAsset: 150 * 1024,
  widthPx: 720,
  quality: 78,
  /** Used for a single retry when an asset lands over budget at `quality`. */
  fallbackQuality: 62,
  frameDurationMs: 1200,
  /**
   * Two frames: the start and end position. A third frame roughly doubles the
   * bytes and adds nothing a still pair does not already show, and constitution
   * rule 3 means we are never going to grow this into a video.
   */
  maxFrames: 2,
  /** Fails the media build if the whole set exceeds this. */
  maxTotalBytes: 80 * 1024 * 1024,
};

/**
 * The CDN URL for one exercise's demo loop.
 *
 * Immutable by construction: the path contains a git tag and a media version,
 * so a given URL always returns the same bytes and can be cached forever. The
 * app should treat a 404 as "no demo for this exercise yet" and fall back to
 * the text instructions — media ships behind the catalogue, not with it.
 *
 * @param {string} exerciseId
 * @param {'webp'|'avif'} [format]
 */
export function jsdelivrUrl(exerciseId, format = 'webp') {
  const { owner, repo, tag, basePath } = MEDIA_REPO;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${tag}/${basePath}/exercise/${MEDIA_VERSION}/${exerciseId}.${format}`;
}

/**
 * Fallback host, should jsDelivr become unsuitable. ADR-0007 names this as the
 * mitigation; keeping it as a function means re-pointing is a one-line change
 * rather than a search through the app.
 * @param {string} exerciseId
 * @param {'webp'|'avif'} [format]
 */
export function rawGithubUrl(exerciseId, format = 'webp') {
  const { owner, repo, tag, basePath } = MEDIA_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${tag}/${basePath}/exercise/${MEDIA_VERSION}/${exerciseId}.${format}`;
}
