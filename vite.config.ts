import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  build: { sourcemap: process.env.COVERAGE === '1' },
  plugins: [
    {
      name: 'local-demo-loader',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/__dev/demo') return next();
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scoretrackrr local demo</title><pre id="status">Preparing local examples…</pre><script type="module">
            import { loadLocalDemo } from '/src/lib/development/demo.ts';
            try { await loadLocalDemo(); location.replace('/matches/'); }
            catch (error) { document.getElementById('status').textContent = 'Local demo failed: ' + error.message; }
          </script></html>`);
        });
      },
    },
    tailwindcss(),
    sveltekit({ adapter: adapter() }),
  ],
});
