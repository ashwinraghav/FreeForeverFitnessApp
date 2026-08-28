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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const files = readdirSync(dest);
const bytes = files.reduce((n, f) => n + statSync(join(dest, f)).size, 0);
console.log(`sync-datasets: ${files.length} artefacts, ${(bytes / 1024).toFixed(0)} KiB -> public/data/`);
