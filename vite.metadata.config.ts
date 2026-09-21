import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

// Отдельное приложение «Pulsar Метаданные» (electron/metadata-main.ts).
// Разработка: npm run meta:dev. Сборка: npm run meta:build, пакет — electron-builder.metadata.json.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // public/ Pulsar (студия, шаблоны, шрифты титров) модулю метаданных не нужен.
  publicDir: false,
  build: {
    outDir: 'dist-metadata',
    rollupOptions: { input: 'metadata.html' },
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/metadata-main.ts',
        onstart(args) {
          args.startup();
        },
        vite: {
          build: {
            outDir: 'dist-metadata-electron',
            rollupOptions: {
              external: ['ffmpeg-static', 'exiftool-vendored', 'exiftool-vendored.exe'],
            },
          },
        },
      },
      {
        // Тот же preload, что у Pulsar: лишние методы без обработчиков в main просто не вызываются.
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-metadata-electron',
          },
        },
      },
    ]),
    renderer(),
  ],
});
