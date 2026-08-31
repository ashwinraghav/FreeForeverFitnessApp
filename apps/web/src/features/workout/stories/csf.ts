/**
 * Minimal Component Story Format types.
 *
 * Declared locally rather than imported from `@storybook/react`, because `apps/web`
 * has no Storybook dependency — adding one is app config and belongs to the
 * integrator (ADR-0018). CSF3 is a plain-object format, so the stories beside this
 * file are valid Storybook entries with or without the package; these types just keep
 * them from being untyped in the meantime.
 *
 * The root `.storybook/main.ts` already globs `apps/web/src/**` , so only the
 * devDependency is missing. Delete this file when `@storybook/react` is available
 * here and import the real `Meta` and `StoryObj` instead.
 *
 * **This is the second copy of this shim** — nutrition has one too. Two identical
 * files is the cost of not reaching across a team boundary to import one, and it goes
 * away the moment the real types are installed. Flagged to the integrator rather than
 * consolidated into a shared path, which is not this team's to create.
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
