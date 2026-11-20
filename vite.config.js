import { defineConfig } from 'vite';

export default defineConfig({
  build: { chunkSizeWarningLimit: 800 }, // three.js is one ~550 kB chunk
});
