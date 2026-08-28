import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content Security Policy, served as a header.
 *
 * Dev and production differ, and the difference is only what Vite's dev server
 * needs: it injects an inline module preamble for React Fast Refresh, opens an
 * HMR WebSocket, and uses inline styles. Production allows none of that.
 *
 * This is a header rather than a `<meta>` tag because a meta CSP applies only
 * from the parser position onward — and Vite's preamble is emitted above where
 * the tag sat, so the policy silently failed to cover the one inline script in
 * the document. On a stricter browser the preamble was blocked, the React
 * plugin could not detect it, and the app rendered a blank page with no error.
 * A meta CSP also cannot express frame-ancestors.
 *
 * connect-src is the interesting directive: Google identity and Firestore, and
 * nothing else. No analytics, no ad networks, no third-party font or script
 * CDN. jsDelivr appears in img-src only — it serves exercise media (ADR-0007)
 * and must never serve script.
 */
const cspDirectives = (dev: boolean) => ({
  'default-src': "'self'",
  'script-src': dev ? "'self' 'unsafe-inline'" : "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob: https://cdn.jsdelivr.net",
  'font-src': "'self'",
  'connect-src': dev
    ? "'self' ws: wss:"
    : "'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com",
  'media-src': "'self' blob:",
  'worker-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'none'",
});

const csp = (dev: boolean) =>
  Object.entries(cspDirectives(dev))
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');

export default defineConfig({
  server: {
    headers: { 'Content-Security-Policy': csp(true) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // `prompt`, not `autoUpdate`: a silent swap mid-workout can drop entered
      // sets. The user is told an update is ready and takes it between sessions.
      workbox: {
        // Precache the shell so a cold start in a basement gym works offline.
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // Never cache Firestore or auth traffic — the SDK owns its own
        // offline persistence, and a stale cached response would fight it.
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            // Exercise media from jsDelivr (ADR-0007), immutable and versioned.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-media',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'TheFreeForeverFitnessApp',
        short_name: 'Free Forever',
        description: 'A fitness app that is free forever.',
        theme_color: '#0A1119',
        background_color: '#0A1119',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
      },
    }),
  ],
});
