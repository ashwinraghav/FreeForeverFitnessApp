import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * Unmount between tests.
 *
 * Testing Library auto-registers this only when `globals: true`, and this
 * workspace runs without globals. Without it every `render` in a file stacks up
 * in the same document body, so the second `getByRole` finds two of everything
 * and fails on an ambiguity that has nothing to do with the component. The
 * failure reads as a component bug, which is the expensive kind of wrong.
 *
 * Registered centrally rather than per-file so a new test file inherits it
 * instead of having to know.
 */
afterEach(cleanup);
