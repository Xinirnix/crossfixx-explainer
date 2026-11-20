import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths, so the build works under /crossfixx-explainer/ on GitHub Pages
  build: { chunkSizeWarningLimit: 800 }, // three.js is one ~550 kB chunk
});
