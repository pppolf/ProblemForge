import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

function canonicalDevEntry(origin: string): Plugin {
  const target = new URL(origin);
  const loopbacks = ['localhost', '127.0.0.1', '[::1]'];
  const aliases = new Set(loopbacks.map(host => `${host}${target.port ? `:${target.port}` : ''}`));
  return {
    name: 'problemforge-dev-entry', apply: 'serve',
    configureServer(server) {
      if (target.protocol !== 'http:' || !loopbacks.includes(target.hostname)) return;
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host?.toLowerCase(), path = req.url ?? '/';
        // Redirect browser navigation before it creates a session on a different
        // loopback hostname. API origin and CSRF checks remain authoritative.
        if (host && host !== target.host && aliases.has(host) && ['GET', 'HEAD'].includes(req.method ?? '') && req.headers.accept?.includes('text/html') && path.startsWith('/') && !/^\/api(?:\/|\?|$)/.test(path)) {
          res.writeHead(307, { Location: `${target.origin}${path}`, 'Cache-Control': 'no-store' });
          res.end(); return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'APP_ORIGIN');
  return { plugins: [vue(), canonicalDevEntry(env.APP_ORIGIN ?? 'http://localhost:5180')], server: { proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } } }, build: { manifest: true, chunkSizeWarningLimit: 1500 } };
});
