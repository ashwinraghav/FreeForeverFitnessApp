import type { Decorator, Preview } from '@storybook/react';

import '../../dist/tokens.css';
import '../styles/primitives.css';

/**
 * The shared Storybook preview for TheFreeForeverFitnessApp.
 *
 * Importing this gives a gallery the token stylesheets, the theme toolbar and the
 * a11y defaults in one line - so a second Storybook (a root-level one globbing both
 * this package and `apps/web`) does not have to reimplement a theme switcher or
 * remember which stylesheets to load, and cannot drift from this one:
 *
 *   // .storybook/preview.ts
 *   export { default } from '@freeforever/design-system/storybook';
 *
 * The glob, the framework and the dependencies stay with whoever owns that config.
 * This is only the presentation contract, which is design-system vocabulary.
 */

/**
 * Stamps `data-theme` on a wrapper rather than on <html>, which is what lets a single
 * story render both themes side by side (see ThemePair) while the toolbar still works.
 */
export const withTheme: Decorator = (Story, context) => {
  const theme = context.globals['theme'] === 'light' ? 'light' : 'dark';
  return (
    <div
      data-theme={theme}
      style={{
        background: 'var(--ff-color-ground)',
        color: 'var(--ff-color-fg-primary)',
        padding: 'var(--ff-space-24)',
        minHeight: '100vh',
        fontFamily: 'var(--ff-font-sans)',
      }}
    >
      <Story />
    </div>
  );
};

/** Dark is the default because ADR-0013 is dark-first. */
export const themeGlobalType = {
  description: 'Colour theme',
  defaultValue: 'dark',
  toolbar: {
    title: 'Theme',
    icon: 'circlehollow',
    items: [
      { value: 'dark', title: 'Dark (primary)' },
      { value: 'light', title: 'Light' },
    ],
    dynamicTitle: true,
  },
} as const;

/** Addons this preview assumes. A root config should include at least these. */
export const recommendedAddons = ['@storybook/addon-essentials', '@storybook/addon-a11y'];

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: { theme: themeGlobalType },
  parameters: {
    controls: { expanded: true },
    // The theme decorator paints the ground colour; Storybook's own backgrounds
    // control would fight it and show the wrong surface behind a component.
    backgrounds: { disable: true },
    // Contrast is asserted in CI (test/contrast.test.ts); the addon catches what a
    // token palette cannot guarantee on its own - names, roles, labelling.
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
};

export default preview;
