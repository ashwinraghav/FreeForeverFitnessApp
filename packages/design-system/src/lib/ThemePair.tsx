import type { ReactNode } from 'react';

/**
 * Renders its children twice, once per theme, side by side.
 *
 * A Storybook-only helper. Deliberately not exported from the package index: it exists
 * so every primitive's story shows both themes at once without twenty-two copies of
 * the same wrapper, and so a palette change is visible in both places in one glance.
 */
export function ThemePair({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
        gap: 'var(--ff-space-16)',
      }}
    >
      {(['dark', 'light'] as const).map((theme) => (
        <div
          key={theme}
          data-theme={theme}
          style={{
            background: 'var(--ff-color-ground)',
            color: 'var(--ff-color-fg-primary)',
            border: 'var(--ff-border-hairline) solid var(--ff-color-hairline)',
            borderRadius: 'var(--ff-radius-lg)',
            padding: 'var(--ff-space-20)',
          }}
        >
          <p
            style={{
              margin: '0 0 var(--ff-space-16)',
              color: 'var(--ff-color-fg-muted)',
              fontSize: 'var(--ff-text-label)',
              letterSpacing: 'var(--ff-tracking-label)',
              textTransform: 'uppercase',
            }}
          >
            {theme}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ff-space-12)', alignItems: 'flex-start' }}>
            {children}
          </div>
        </div>
      ))}
    </div>
  );
}
