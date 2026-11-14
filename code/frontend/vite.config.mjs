import { defineConfig } from 'vite';
import { frontendRoot, generateWorkspace } from './tools/build-workspace.mjs';
import path from 'node:path';

function workspaceSources() {
  return {
    name: 'studypilot-workspace',
    async buildStart() {
      await generateWorkspace();
    },
    configureServer(server) {
      let queue = Promise.resolve();
      const sourceRoot = path.join(frontendRoot, 'src') + path.sep;
      server.watcher.on('change', (file) => {
        if (!file.startsWith(sourceRoot) || !/\.(js|css|html)$/.test(file)) return;
        queue = queue
          .then(() => generateWorkspace())
          .then(() => server.ws.send({ type: 'full-reload' }))
          .catch((error) => server.config.logger.error(error.stack || error.message));
      });
    },
  };
}

const proxy = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } };

export default defineConfig({
  root: frontendRoot,
  plugins: [workspaceSources()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
});
