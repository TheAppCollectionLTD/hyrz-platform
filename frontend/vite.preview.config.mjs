// Preview-only dev launcher: runs hyrz's own vite.config.js with Emergent preview host settings. Not used by hyrz itself.
import { readFileSync } from 'node:fs';
import { createServer } from '/app/client/node_modules/vite/dist/node/index.js';

for (const line of readFileSync('/app/frontend/.env', 'utf8').split('\n')) {
  const m = line.match(/^(VITE_[A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const server = await createServer({
  root: '/app/client',
  configFile: '/app/client/vite.config.js',
  server: { host: '0.0.0.0', port: 3000, strictPort: true, allowedHosts: true, hmr: { clientPort: 443, protocol: 'wss' } },
});
await server.listen();
server.printUrls();
