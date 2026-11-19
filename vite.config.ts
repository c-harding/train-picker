import { defineConfig, type Plugin } from 'vite';

/**
 * The fleet page (/fleet/) is the same app as the main page (main.ts switches to it by
 * the path): the dev server answers /fleet with index.html, and the build writes a copy
 * of index.html to fleet/index.html.
 */
function fleetPage(): Plugin {
  return {
    name: 'fleet-page',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req: { url?: string }, _res: unknown, next: () => void) => {
        const m = req.url?.match(/^\/fleet\/?(\?.*)?$/);
        if (m) req.url = `/${m[1] ?? ''}`;
        next();
      });
    },
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (index?.type === 'asset') this.emitFile({ type: 'asset', fileName: 'fleet/index.html', source: index.source });
    },
  };
}

export default defineConfig({
  // three.js alone is ~550 kB minified, so the default 500 kB warning always fires.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [fleetPage()],
});
