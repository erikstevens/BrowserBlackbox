import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const bundledMainWorkspacePackages = [
  '@browser-blackbox/domain',
  '@browser-blackbox/runtime-browser',
  '@browser-blackbox/persistence',
];
const runtimeExternalPackages = [
  'playwright',
  'playwright-core',
  /^playwright\/.+/,
  /^playwright-core\/.+/,
  /^chromium-bidi\/.+/,
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledMainWorkspacePackages })],
    build: {
      rollupOptions: {
        external: runtimeExternalPackages,
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
