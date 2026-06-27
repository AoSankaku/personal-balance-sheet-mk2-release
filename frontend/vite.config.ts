import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

const VERSION_SOURCE = path.resolve(__dirname, 'src/lib/version.ts');
const VERSION_PATTERN = /export const VERSION = (["'])([^"']+)\1;/;

function readAppVersion() {
  const source = readFileSync(VERSION_SOURCE, 'utf8');
  const match = source.match(VERSION_PATTERN);
  if (!match) throw new Error('VERSION export was not found');
  return match[2];
}

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

function versionAssetPlugin(): Plugin {
  return {
    name: 'balance-sheet-version-asset',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ version: readAppVersion() }));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: readAppVersion() }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    i18nYamlHmrPlugin(),
    versionAssetPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
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
