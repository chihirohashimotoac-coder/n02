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
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: './index.html',
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
