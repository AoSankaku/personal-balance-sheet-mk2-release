import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

function i18nYamlHmrPlugin(): Plugin {
  return {
    name: 'i18n-yaml-hmr',
    handleHotUpdate({ file, server }) {
      const normalized = file.replaceAll('\\', '/');
      if (normalized.includes('/src/i18n/locales/') && normalized.match(/\.ya?ml$/)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    i18nYamlHmrPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@balance-sheet/shared': path.resolve(__dirname, '../shared/types.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
