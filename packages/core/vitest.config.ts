import { configDefaults, defineConfig } from 'vitest/config';

/**
 * This package had no vitest config at all, and it needed one.
 *
 * `tsc -b` emits the compiled tests alongside the compiled source, so after any
 * typecheck `dist/` holds a `.test.js` for every `.test.ts`. Vitest then collected both
 * copies and ran the whole suite twice — 16 files became 32, 959 tests became 964 and
 * climbing as `dist` filled in.
 *
 * Nobody noticed locally, because `pnpm test` on its own leaves a stale or absent
 * `dist`. CI runs `pnpm typecheck` immediately before `pnpm test`, so there it was a
 * fresh, complete second copy every time — twice the work, and assertions running
 * against build output rather than source. It surfaced as a timeout rather than as a
 * duplicate, which is why it took a CI run to see.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
