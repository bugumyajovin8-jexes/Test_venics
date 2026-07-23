import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Precache CODE only (JS/CSS/HTML). Do NOT precache images: logo.png (~0.6MB)
          // and v.png (~1.3MB) would otherwise be downloaded up front on the very first
          // load, competing for bandwidth with the app bundle and slowing the boot. They
          // are large logos that aren't needed until the login screen renders.
          globPatterns: ['**/*.{js,css,html,woff,woff2}'],
          // Fetch images on demand instead, and cache them after the first view (offline-
          // ready from then on). So the login logo only downloads once login appears.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => /\.(?:png|jpe?g|svg|webp|gif|ico)$/i.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'venics-images',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: true
        },
        manifest: {
          name: 'Venics Sales',
          short_name: 'Venics',
          description: 'Venics Sales POS System',
          theme_color: '#2563eb',
          background_color: '#f9fafb',
          display: 'standalone',
          icons: [
            {
              src: '/logo.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: '/logo.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
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
