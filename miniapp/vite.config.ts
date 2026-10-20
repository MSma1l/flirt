import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Bibliotecile de bază, într-un chunk `vendor` separat: se schimbă rar, deci
 * un deploy obișnuit (doar codul aplicației) nu invalidează cache-ul lor din
 * WebView-ul Telegram. `scheduler` e dependența internă a `react-dom`.
 * Leaflet NU e aici: îl folosește doar ecranul unui eveniment, care e leneș.
 */
const VENDOR_PACKAGES = [
  'react',
  'react-dom',
  'scheduler',
  'react-router',
  '@tanstack/query-core',
  '@tanstack/react-query',
  'i18next',
  'react-i18next',
  'axios',
  'zustand',
];
const VENDOR_RE = new RegExp(
  `[\\\\/]node_modules[\\\\/](${VENDOR_PACKAGES.map((p) => p.replace('/', '[\\\\/]')).join('|')})[\\\\/]`,
);

/**
 * Config Vite + Vitest pentru Telegram Mini App.
 *
 * Alias-urile oglindesc `paths` din tsconfig.json. Ele sunt mecanismul prin
 * care logica pură din aplicația Expo (`mobile/src/features/feed/*`,
 * `mobile/src/i18n/*`, `mobile/theme/colors.ts`) e REUTILIZATĂ direct, fără
 * copiere: `@/services/api` din fișierele Expo ajunge la clientul HTTP de aici.
 *
 * ATENȚIE la ordine: `@/services/api` trebuie să stea ÎNAINTEA lui `@/`,
 * altfel prefixul generic câștigă.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/services\/api$/, replacement: here('./src/api/client.ts') },
      { find: /^@theme\//, replacement: here('../mobile/theme/') },
      { find: /^@mobile\//, replacement: here('../mobile/src/') },
      { find: /^@\//, replacement: here('./src/') },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (VENDOR_RE.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5175,
    // Fișierele reutilizate stau în `mobile/`, adică în afara rădăcinii Vite.
    fs: { allow: [here('..')] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: false,
    restoreMocks: true,
  },
});
