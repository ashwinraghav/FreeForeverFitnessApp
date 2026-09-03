import { fileURLToPath } from 'node:url';
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
        /*
         * The same aliases as the dom project below. `appUpdate.ts` is plain `.ts`, so
         * its unit tests land in this project — and without these the virtual modules
         * fail to resolve here exactly as they did there.
         */
        resolve: {
          alias: {
            'virtual:pwa-register/react': fileURLToPath(
              new URL('./test/stubs/pwa-register.ts', import.meta.url),
            ),
            'virtual:pwa-register': fileURLToPath(
              new URL('./test/stubs/pwa-register-base.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'logic',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        /*
         * `virtual:pwa-register/react` is created by the VitePWA plugin, which
         * is not loaded here — tests have no business building a service
         * worker. Without an alias the import cannot resolve and UpdatePrompt
         * is untestable, which is how the app came to ship prompt-mode
         * registration with nothing that ever prompted.
         */
        resolve: {
          alias: {
            'virtual:pwa-register/react': fileURLToPath(
              new URL('./test/stubs/pwa-register.ts', import.meta.url),
            ),
            // `appUpdate.ts` imports the non-React entry point; the two ids do not
            // alias each other, so it needs its own stub.
            'virtual:pwa-register': fileURLToPath(
              new URL('./test/stubs/pwa-register-base.ts', import.meta.url),
            ),
          },
        },
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
