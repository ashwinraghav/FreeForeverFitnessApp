/**
 * This package's own gallery, for standalone use (`pnpm storybook`).
 *
 * The configuration itself lives in src/storybook/preview.tsx so a root-level
 * Storybook can import exactly the same one rather than reimplementing it.
 */
export { default } from '../src/storybook/preview.js';
