import type { StorybookConfig } from '@storybook/react-vite';

import { recommendedAddons } from '../src/storybook/preview.js';

/**
 * This package's standalone gallery.
 *
 * The glob covers this package only, deliberately: reaching into `apps/web` from here
 * would make an Apache-2.0 package that is meant to be consumable on its own
 * (ADR-0003) fail to build unless a particular sibling app happens to exist.
 *
 * Feature stories belong to a Storybook that owns both trees - see README,
 * "Where Storybook lives".
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: recommendedAddons,
  framework: { name: '@storybook/react-vite', options: {} },
  typescript: { reactDocgen: 'react-docgen-typescript' },
};

export default config;
