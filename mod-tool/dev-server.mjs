import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../tools-common/dev-server-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const PROJECT_ROOT = path.resolve(__dirname, '..');

const server = createDevServer({
  root: ROOT,
  host: HOST,
  port: PORT,
  cors: true,
  mounts: [
    { urlPrefix: '/tools-common', dir: path.join(PROJECT_ROOT, 'tools-common') },
    { urlPrefix: '/static', dir: path.join(PROJECT_ROOT, 'static') }
  ],
  notFoundBody: (filePath, urlPath) => `404 Not Found: ${urlPath}`,
  examples: ['/index.html']
});


server.listen();
