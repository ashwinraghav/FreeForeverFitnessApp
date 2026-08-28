import { defineConfig } from 'vitest/config';

// The sync suite, split the same way the package's main config splits unit from
// rules, and for the same reason (ADR-0015: a suite that needs infrastructure
// must fail loudly without it, not be skipped silently):
//
//   sync-unit — pure logic: reducers, merges, calendar maths, the App Check
//               guard. No emulator, runs everywhere.
//   sync-emu  — the engine, writes, conflicts, linking and export against the
//               real emulators and the repository's real rules:
//
//     firebase emulators:exec --only firestore,auth "pnpm --filter @freeforever/data test:sync:emu"
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'sync-unit',
          include: ['src/sync/__tests__/**/*.test.ts'],
          exclude: ['src/sync/__tests__/**/*.emu.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'sync-emu',
          include: ['src/sync/__tests__/**/*.emu.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
