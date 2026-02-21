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
  const rootAbs = path.resolve(root);
  const rel = String(requestPath || '/')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');

  const joined = path.resolve(rootAbs, rel);

  // Case-insensitive check for Windows
  const rootLower = rootAbs.toLowerCase();
  const joinedLower = joined.toLowerCase();

  const rootWithSep = rootLower.endsWith(path.sep) ? rootLower : rootLower + path.sep;
  if (joinedLower === rootLower) return joined;
  if (joinedLower.startsWith(rootWithSep)) return joined;

  return null;
}


function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const rawUrl = req.url || '/';
    const urlPath = decodeURIComponent(rawUrl.split('?')[0]);

    let filePath = safeJoin(ROOT, urlPath);
    if (!filePath) {
      console.error(`[400] Forbidden/Bad Path: ${urlPath}`);
      return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    // Default to index.html for root or directories
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        console.error(`[404] File Not Found: ${filePath}`);
        return send(res, 404, `404 Not Found: ${urlPath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      console.error(`[500] Read Error: ${filePath}`, err);
      return send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    send(res, 200, data, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
  } catch (e) {
    console.error(`[500] Critical Error:`, e);
    send(res, 500, String(e && e.stack ? e.stack : e), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});


server.listen(PORT, HOST, () => {
  console.log(`Dev server running at http://${HOST}:${PORT}`);
  console.log(`ROOT: ${ROOT}`);
  console.log('Open e.g.:');
  console.log(`  http://${HOST}:${PORT}/index.html`);
});
