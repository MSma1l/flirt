import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config Vite + Vitest pentru panoul de administrare.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: false,
    restoreMocks: true,
  },
});
