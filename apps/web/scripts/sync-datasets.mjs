#!/usr/bin/env node
/**
 * Copy the built food/exercise index artefacts into the app's served public
 * directory. Runs before `dev` and `build`.
 *
 * Why a copy rather than a symlink: symlinks behave differently across
 * platforms and CI checkouts, and a broken one fails silently at runtime as a
 * 404 on a file the app needs to function. A copy is boring and observable.
 *
 * `public/data/` is generated and gitignored — the artefacts are committed once
 * in packages/datasets/build, and duplicating binaries into a second tracked
 * location would bloat the repo for no benefit (ADR-0007 keeps binary weight
 * deliberate).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../packages/datasets/build');
const dest = join(here, '../public/data');

if (!existsSync(src)) {
  console.error(
    `sync-datasets: no build output at ${src}\n` +
      `  Run the datasets build first: pnpm --filter @freeforever/datasets build`,
  );
  process.exit(1);
}

/**
 * Copy only what the client actually requests, driven by the manifest rather
 * than by a filename pattern.
 *
 * This used to be a recursive copy of the whole build directory, which shipped
 * 3.4 MB of `food-off-<version>.ndjson.gz` to every deploy — 45% of the data
 * payload — that no client ever fetches. That file is the ODbL §4.6 parallel
 * distribution (NOTICE.md §2.2) and it must keep being *offered*, but its
 * publication channel is the repository and the GitHub Release, not the app's
 * origin.
 *
 * Manifest-driven rather than an ignore-list on purpose: a new artefact role
 * has to be added here deliberately before it can reach a deploy. An
 * ignore-list fails open, and this directory is the one place where failing
 * open means shipping bytes to every user.
 */
const CLIENT_ROLES = new Set(['records', 'search', 'barcodes']);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

/** @type {string[]} */
const wanted = ['manifest.json'];

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
for (const artefact of manifest.artefacts ?? []) {
  for (const file of artefact.files ?? []) {
    if (CLIENT_ROLES.has(file.role)) wanted.push(file.file);
  }
}

// Exercise media travels under its own manifest (ADR-0007) and is not listed in
// the food index manifest.
for (const f of readdirSync(src)) if (f.startsWith('exercises.')) wanted.push(f);

// Licence notices ride along regardless of size. The app renders ODbL
// attribution in the UI, so these are belt-and-braces — but a kilobyte is not a
// sensible thing to weigh against any doubt about shipping a database without
// its notice.
for (const f of readdirSync(src)) if (f.endsWith('.NOTICE.txt')) wanted.push(f);

const skipped = readdirSync(src).filter((f) => !wanted.includes(f) && statSync(join(src, f)).isFile());

for (const f of wanted) {
  if (!existsSync(join(src, f))) {
    console.error(`sync-datasets: manifest names ${f}, which does not exist in ${src}`);
    process.exit(1);
  }
  copyFileSync(join(src, f), join(dest, f));
}

const files = readdirSync(dest);
const bytes = files.reduce((n, f) => n + statSync(join(dest, f)).size, 0);
console.log(`sync-datasets: ${files.length} artefacts, ${(bytes / 1024).toFixed(0)} KiB -> public/data/`);
if (skipped.length > 0) {
  const skippedBytes = skipped.reduce((n, f) => n + statSync(join(src, f)).size, 0);
  console.log(
    `sync-datasets: not deployed (${(skippedBytes / 1024).toFixed(0)} KiB): ${skipped.join(', ')}`,
  );
}
