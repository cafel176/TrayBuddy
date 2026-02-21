import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../tools-common/dev-server-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4175);

const PROJECT_ROOT = path.resolve(__dirname, '..');

const server = createDevServer({
  root: ROOT,
  host: HOST,
  port: PORT,
  verbose: true,
  mounts: [
    { urlPrefix: '/tools-common', dir: path.join(PROJECT_ROOT, 'tools-common') },
    { urlPrefix: '/static', dir: path.join(PROJECT_ROOT, 'static') }
  ],
  notFoundBody: (filePath, urlPath, err) => `404 Not Found: ${filePath}\nError: ${err && err.message ? err.message : err}`,
  examples: [
    '/WebM与MOV互转/',
    '/二次元背景生成器/',
    '/视频去背景/',
    '/图片循环视频/'
  ]
});


server.listen();
