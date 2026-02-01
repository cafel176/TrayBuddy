import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function safeJoin(root, requestPath) {
  // Remove leading slash so path.resolve doesn't treat it as absolute
  const rel = requestPath.replace(/^\/+/, '');
  const joined = path.resolve(root, rel);
  // Prevent path traversal
  if (!joined.startsWith(root)) return null;
  return joined;
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const rawUrl = req.url || '/';
    const urlPath = decodeURIComponent(rawUrl.split('?')[0]);

    let filePath = safeJoin(ROOT, urlPath);
    if (!filePath) return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });

    // Directory -> index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        return send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      send(res, 200, data, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
    });
  } catch (e) {
    send(res, 500, String(e && e.stack ? e.stack : e), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dev server running at http://${HOST}:${PORT}`);
  console.log('Open e.g.:');
  console.log(`  http://${HOST}:${PORT}/spritesheet切分/`);
  console.log(`  http://${HOST}:${PORT}/spritesheet生成/`);
});
