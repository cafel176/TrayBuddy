import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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

function decodeUrlPath(rawUrl, verbose) {
  const rawPath = String(rawUrl || '/').split('?')[0];
  try {
    return decodeURIComponent(rawPath);
  } catch (e) {
    if (verbose) {
      console.log(`[REQ] Decode failed, using raw: ${rawPath}`);
    }
    return rawPath;
  }
}

function resolveMount(urlPath, mounts) {
  if (!Array.isArray(mounts) || mounts.length === 0) return null;

  for (const mount of mounts) {
    if (!mount || !mount.urlPrefix || !mount.dir) continue;
    const basePrefix = mount.urlPrefix.startsWith('/') ? mount.urlPrefix : `/${mount.urlPrefix}`;
    const prefix = basePrefix.endsWith('/') ? basePrefix : `${basePrefix}/`;

    if (urlPath === basePrefix) {
      return { dir: mount.dir, requestPath: '/', prefix: basePrefix };
    }

    if (urlPath.startsWith(prefix)) {
      const rest = urlPath.slice(prefix.length);
      return { dir: mount.dir, requestPath: `/${rest}`, prefix: basePrefix };
    }
  }

  return null;
}

export function createDevServer(options) {

  const {
    root,
    host = '127.0.0.1',
    port = 4173,
    cors = false,
    ping = null,
    verbose = false,
    examples = [],
    mounts = [],
    notFoundBody,
    badRequestBody,
    errorBody
  } = options || {};


  const server = http.createServer(async (req, res) => {
    try {
      const rawUrl = req.url || '/';

      if (verbose) {
        console.log(`[REQ] Raw URL: ${rawUrl}`);
        console.log(`[REQ] Raw URL bytes: ${Buffer.from(rawUrl).toString('hex')}`);
      }

      const urlPath = decodeUrlPath(rawUrl, verbose);

      if (ping && urlPath === ping.path) {
        return send(res, 200, ping.response || 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      const mount = resolveMount(urlPath, mounts);
      const activeRoot = mount ? mount.dir : root;
      const requestPath = mount ? mount.requestPath : urlPath;

      if (verbose && mount) {
        console.log(`[REQ] Mount ${mount.prefix} -> ${activeRoot}`);
      }

      let filePath = safeJoin(activeRoot, requestPath);
      if (verbose) {
        console.log(`[REQ] ROOT: ${activeRoot}`);
        console.log(`[REQ] Resolved file path: ${filePath}`);
      }


      if (!filePath) {
        if (verbose) console.log('[REQ] Bad request - safeJoin returned null');
        const body = typeof badRequestBody === 'function'
          ? badRequestBody(urlPath)
          : 'Bad Request';
        return send(res, 400, body, { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (stat && stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        if (verbose) console.log(`[REQ] Is directory, trying index.html: ${filePath}`);
      }

      let data;
      try {
        data = await fs.promises.readFile(filePath);
      } catch (err) {
        if (verbose) console.error(`[404] ${urlPath} -> ${filePath}`);
        const body = typeof notFoundBody === 'function'
          ? notFoundBody(filePath, urlPath, err)
          : '404 Not Found';
        return send(res, 404, body, { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      };
      if (cors) headers['Access-Control-Allow-Origin'] = '*';
      send(res, 200, data, headers);
    } catch (e) {
      if (verbose) console.error('[500] Error:', e && e.stack ? e.stack : e);
      const body = typeof errorBody === 'function'
        ? errorBody(e)
        : String(e && e.stack ? e.stack : e);
      send(res, 500, body, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  });

  return {
    server,
    listen() {
      server.listen(port, host, () => {
        console.log(`Dev server running at http://${host}:${port}`);
        console.log(`ROOT: ${path.resolve(root)}`);
        if (examples && examples.length) {
          console.log('Open e.g.:');
          examples.forEach(example => console.log(`  http://${host}:${port}${example}`));
        }
      });
    }
  };
}
