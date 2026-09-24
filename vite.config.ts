import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // index.html already has <link rel="manifest" href="/manifest.json"> pointing to
        // public/manifest.json, so we let the plugin handle only SW generation.
        manifest: false,
        workbox: {
          maximumFileSizeToCacheInBytes: 5_000_000,
          // Precache every built asset so the app works fully offline
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // Critical: if a navigation request can't be satisfied from cache
          // (e.g. a JS chunk was purged between updates), serve the cached shell
          // instead of showing a blank screen.
          navigateFallback: 'index.html',
          // Remove old precache entries from previous versions automatically
          cleanupOutdatedCaches: true,
          // version.json must always come from the network so polling detects real updates.
          // Without this rule the SW would serve the cached (old) version.json indefinitely.
          runtimeCaching: [
            {
              urlPattern: /\/version\.json(\?.*)?$/,
              handler: 'NetworkOnly',
            },
          ],
        },
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
