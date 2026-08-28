import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The workspace gallery: design-system primitives and the feature components that
 * use them, in one place.
 *
 * That pairing is the point. A primitive viewed alone tells you it is correct; a
 * primitive viewed next to the SetRow built from it tells you whether it reads
 * right — which is the class of problem no contrast assertion catches.
 *
 * `packages/design-system/.storybook/` still exists and still globs only itself,
 * deliberately: that package is Apache-2.0 so it can be consumed standalone
 * (ADR-0003), and a config that needs a sibling app to build would break that.
 * This file is the one that reaches across, and it lives at the root because the
 * root is the only place that legitimately owns both trees (ADR-0018).
 *
 * The presentation half — theme decorators, viewport and a11y setup — is imported
 * from the design system rather than copied, so the two galleries cannot drift.
 */
const config: StorybookConfig = {
  stories: [
    '../packages/design-system/src/**/*.stories.@(ts|tsx)',
    '../apps/web/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  typescript: { reactDocgen: 'react-docgen-typescript' },
};

export default config;
