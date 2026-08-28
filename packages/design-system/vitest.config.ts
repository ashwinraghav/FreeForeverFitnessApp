import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The vitest version here must match every other package in the workspace.
 *
 * `@testing-library/jest-dom/vitest` does `import { expect } from 'vitest'` and
 * declares no vitest peer dependency, so pnpm cannot pin it per consumer - it
 * resolves through the hoisted store at node_modules/.pnpm/node_modules/vitest,
 * which holds exactly one version. If that is not the version running the suite,
 * `expect.extend` succeeds against an `expect` the tests never touch and every
 * jest-dom matcher fails with "Invalid Chai property: toBeInTheDocument", while
 * jsdom, render() and getByRole() all keep working - which makes it look like a
 * setup-file problem when it is not.
 */

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
