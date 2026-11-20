import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Multi-page site: the landing page is ./index.html, and every top-level
// folder that holds an index.html (crossfixx/, ...) is one explainer page.
// New explainers are picked up automatically; see "Adding an explainer" in the README.
const root = __dirname;
const skip = new Set(['node_modules', 'dist', 'src', 'public', 'docs', '.git', '.github']);
const pages = { main: resolve(root, 'index.html') };
for (const d of readdirSync(root, { withFileTypes: true })) {
  if (d.isDirectory() && !skip.has(d.name) && existsSync(resolve(root, d.name, 'index.html'))) {
    pages[d.name] = resolve(root, d.name, 'index.html');
  }
}

export default defineConfig({
  base: './', // relative asset paths, so the build works under /crossfixx-explainer/ on GitHub Pages
  build: {
    chunkSizeWarningLimit: 800, // three.js is one ~550 kB chunk
    rollupOptions: { input: pages },
  },
});
