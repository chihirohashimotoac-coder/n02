/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// n02 is served straight from the repo root on GitHub Pages (no /dist branch, no
// Pages build step) - vite's HTML root lives under web/ so `vite build`'s output
// (index.html, assets/, manifest, sw.js) never collides with this source template.
// scripts/deploy-to-root.mjs copies web/dist/* onto the repo root after build.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      filename: 'sw.js',
      includeAssets: ['n02-icon.svg'],
      manifest: {
        name: 'n02 Checkout Arena',
        short_name: 'n02',
        description:
          '2人で競えるスティールダーツ用 01スコアラー・チェックアウト練習・Pentathlon（JDA / n01・i-Pentathlon）',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f5f4ef',
        theme_color: '#0d503a',
        icons: [{ src: 'n02-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // webp is in here for the award posters: they are the fallback the presentation lands on
        // when a movie cannot play, so they have to be available on a first offline run. The
        // movies themselves are deliberately NOT precached - 2.7MB is far too much to hold up a
        // service-worker install for something the poster already covers.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,webp}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: './index.html',
        // ...and the navigation fallback must not swallow them: an award asset request is not a
        // navigation, and answering it with index.html would break the <video> rather than let it
        // fall back cleanly.
        navigateFallbackDenylist: [/\/awards\//],
        runtimeCaching: [
          {
            // Award movies: cached the first time they are actually fetched (the idle warm-up on
            // entering a mode, or the overlay itself), then served from the cache offline. Opaque
            // range requests are what a <video> issues, so the range plugin is what makes seeking
            // and replay work from the cache.
            urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/awards/') && url.pathname.endsWith('.mp4'),
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'n02-award-movies-v1',
              rangeRequests: true,
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    fs: { allow: ['..'] },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['../src/test/setup.ts'],
    css: false,
    include: ['../src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['../e2e/**', '../node_modules/**'],
    restoreMocks: true,
  },
});
