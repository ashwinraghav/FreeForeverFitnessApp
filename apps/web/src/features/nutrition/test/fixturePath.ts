/**
 * Absolute path to the committed dataset artefacts, for tests that read them.
 *
 * Derived from `import.meta.url` rather than `process.cwd()`. `apps/web` is a
 * browser bundle and must not have `@types/node` in its tsconfig: that would
 * make every Node global look available to autocomplete in code that will never
 * run in Node, and someone would eventually reach for `Buffer` or `fs` in a
 * component and find out at runtime.
 *
 * The `/@fs` strip is the load-bearing part. Under the jsdom project Vite
 * rewrites module URLs with a `/@fs` prefix, and a path built naively from
 * `import.meta.url` misses every file. That failure is silent and expensive: a
 * fetch stub returns 404, the index comes up empty, and a test asserting "this
 * barcode is not in the catalogue" passes without anything ever having loaded.
 */
const resolved = new URL(
  '../../../../../../packages/datasets/build/',
  import.meta.url,
).pathname.replace(/^\/@fs/u, '');

/**
 * The trailing slash is re-added deliberately: the two Vitest projects disagree
 * about whether `URL.pathname` keeps it (the node project does, the jsdom one
 * does not), and losing it silently concatenates the directory into the
 * filename — `.../buildmanifest.json`.
 */
export const DATASETS_BUILD_DIR = resolved.endsWith('/') ? resolved : `${resolved}/`;
