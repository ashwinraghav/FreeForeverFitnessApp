import type { Decorator, Preview } from '@storybook/react';

import '../dist/tokens.css';
import '../src/styles/primitives.css';

/**
 * The theme toolbar stamps `data-theme` on a wrapper rather than on <html>, which is
 * what lets a single story render both themes side by side (see ThemePair).
 */
const withTheme: Decorator = (Story, context) => {
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

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
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
    },
  },
  parameters: {
    controls: { expanded: true },
    backgrounds: { disable: true },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
};

export default preview;
