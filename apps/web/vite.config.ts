import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
