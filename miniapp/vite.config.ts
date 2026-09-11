import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
