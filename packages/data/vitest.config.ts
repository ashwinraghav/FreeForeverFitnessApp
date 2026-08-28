import { defineConfig } from 'vitest/config';

// Two projects, because they have different infrastructure requirements.
//
//   unit  — pure schema/helper tests. Run by `pnpm test` everywhere, no emulator.
//   rules — security rules tests. Require the Firestore emulator, so CI runs them
//           under `firebase emulators:exec` as a separate blocking job (ADR-0015).
//
// Keeping them apart means a developer without the emulator running still gets a
// green `pnpm test`, and the rules job cannot be silently skipped by a passing
// unit suite.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'rules',
          include: ['test/rules/**/*.test.ts'],
          environment: 'node',
          // Rules tests share one emulator-backed environment and mutate it.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
