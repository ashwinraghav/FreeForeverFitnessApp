/**
 * Minimal Component Story Format types.
 *
 * Declared locally rather than imported from `@storybook/react`, because
 * `apps/web` has no Storybook dependency — adding one is app config and belongs
 * to the integrator (ADR-0018). CSF3 is a plain-object format, so the stories
 * beside this file are valid Storybook entries with or without the package;
 * these types just keep them from being untyped in the meantime.
 *
 * TWO THINGS ARE STILL NEEDED before these render in the gallery, and both are
 * outside this team:
 *
 *   1. `packages/design-system/.storybook/main.ts` globs only
 *      `../src/**\/*.stories.@(ts|tsx)`. It needs to include the app's feature
 *      directories, or the app needs its own Storybook instance.
 *   2. `apps/web` needs the Storybook devDependencies.
 *
 * Delete this file when `@storybook/react` is available here and import the
 * real `Meta` and `StoryObj` instead.
 */

export interface Meta<TArgs> {
  title: string;
  component?: unknown;
  args?: Partial<TArgs>;
  parameters?: Record<string, unknown>;
}

export interface StoryObj<TArgs> {
  name?: string;
  args?: Partial<TArgs>;
  parameters?: Record<string, unknown>;
  render?: (args: TArgs) => unknown;
}
