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

  // Prevent path traversal (Windows is case-insensitive)
  if (process.platform === 'win32') {
    const rootLower = rootAbs.toLowerCase();
    const joinedLower = joined.toLowerCase();
    const rootWithSep = rootLower.endsWith(path.sep) ? rootLower : rootLower + path.sep;

    if (joinedLower === rootLower) return joined;
    if (joinedLower.startsWith(rootWithSep)) return joined;
    return null;
  }

  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (joined === rootAbs) return joined;
  if (joined.startsWith(rootWithSep)) return joined;
  return null;
}


function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const rawUrl = req.url || '/';
    
    // 详细日志：原始 URL
    console.log(`[REQ] Raw URL: ${rawUrl}`);
    console.log(`[REQ] Raw URL bytes: ${Buffer.from(rawUrl).toString('hex')}`);
    
    // 正确解码 URL（处理中文路径）
    let urlPath;
    try {
      // 先尝试标准 UTF-8 解码
      urlPath = decodeURIComponent(rawUrl.split('?')[0]);
      console.log(`[REQ] Decoded URL path: ${urlPath}`);
    } catch (e) {
      // 如果解码失败，使用原始路径
      urlPath = rawUrl.split('?')[0];
      console.log(`[REQ] Decode failed, using raw: ${urlPath}`);
    }

    let filePath = safeJoin(ROOT, urlPath);
    console.log(`[REQ] ROOT: ${ROOT}`);
    console.log(`[REQ] Resolved file path: ${filePath}`);
    
    if (!filePath) {
      console.log(`[REQ] Bad request - safeJoin returned null`);
      return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    // Directory -> index.html
    const exists = fs.existsSync(filePath);
    console.log(`[REQ] File exists: ${exists}`);
    
    if (exists && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      console.log(`[REQ] Is directory, trying index.html: ${filePath}`);
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error(`[404] ${urlPath} -> ${filePath}`);
        console.error(`[404] Error: ${err.message}`);
        return send(res, 404, `404 Not Found: ${filePath}\nError: ${err.message}`, { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      console.log(`[200] ${urlPath} -> ${filePath}`);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      send(res, 200, data, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
    });
  } catch (e) {
    console.error(`[500] Error: ${e && e.stack ? e.stack : e}`);
    send(res, 500, String(e && e.stack ? e.stack : e), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dev server running at http://${HOST}:${PORT}`);
  console.log('Open e.g.:');
  console.log(`  http://${HOST}:${PORT}/spritesheet切分/`);
  console.log(`  http://${HOST}:${PORT}/spritesheet生成/`);
});
