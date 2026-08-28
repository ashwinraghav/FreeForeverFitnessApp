import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, split by what they need to run.
 *
 *   logic — pure functions: reducers, ranking, unit maths. Node, fast, no DOM.
 *   dom   — component and interaction tests. jsdom + testing-library.
 *
 * The split exists because most of this app's correctness is arithmetic, and
 * arithmetic tests should not pay jsdom's startup cost. It is not an excuse to
 * skip the DOM tier: a tap-count claim read off a component tree is an argument,
 * not a demonstration, and the two-taps-to-log bar is a product commitment that
 * needs exercising.
 *
 * NOTE on vitest version: keep this package's vitest pinned to the same version
 * as the rest of the workspace. jest-dom extends matchers onto the `expect` it
 * imports from `vitest`; if two vitest versions resolve, the matchers land on an
 * instance the runner never uses and every assertion fails as
 * "Invalid Chai property: toBeInTheDocument". That cost an hour once already.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'logic',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx', 'src/**/*.dom.test.ts'],
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
});
