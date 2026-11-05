#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const sceneGuide = require('./lib/scene-guide.js');

const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 10801);
const host = process.env.HOST || '0.0.0.0';
const API_PATH = '/api/scene-guide';
const MAX_BODY_BYTES = 12000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function contentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 不要 destroy：先干脆地回 413，否者客户端只看到 socket hang up
        tooBig = true;
        chunks.length = 0;
        return;
      }
      if (!tooBig) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) reject(Object.assign(new Error('请求体太大了（最多 ' + MAX_BODY_BYTES + ' 字节）'), { status: 413 }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// 站点前面是 frp + nginx，取最左的 X-Forwarded-For 当限流键（可以被伪造，只用来限速）
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function handleApi(req, res, pathname) {
  if (pathname === `${API_PATH}/health`) {
    sendJson(res, 200, { ok: true, model: sceneGuide.CONFIG.model, binary: sceneGuide.CONFIG.bin });
    return;
  }
  if (pathname !== API_PATH) {
    sendJson(res, 404, { ok: false, error: '没有这个接口' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '这个接口用 POST 调用' });
    return;
  }
  let body;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : null;
  } catch (e) {
    sendJson(res, e.status === 413 ? 413 : 400, { ok: false, error: e.status === 413 ? e.message : '请求体不是合法 JSON' });
    return;
  }
  try {
    const data = await sceneGuide.handleRequest(body, clientIp(req));
    sendJson(res, 200, { ok: true, data });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[scene-guide] ${new Date().toISOString()} ${e.message}`);
    sendJson(res, status, { ok: false, error: e.message || '生成失败' });
  }
}

function resolveStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  // 目录请求（带或不带尾斜杠）由 sendFile 回退到该目录下的 index.html
  const cleaned = decoded.replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  const relative = cleaned === '' || cleaned === '/' ? 'index.html' : cleaned;
  const resolved = path.normalize(path.join(publicDir, relative));
  const isInside = resolved === publicDir || resolved.startsWith(publicDir + path.sep);
  return isInside ? resolved : null;
}

async function sendFile(req, res, filePath) {
  let target = filePath;
  try {
    const info = await fs.stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    throw Object.assign(new Error('Not Found'), { code: 'ENOENT' });
  }
  const data = await fs.readFile(target);
  res.writeHead(200, {
    'Content-Type': contentType(target),
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, requestUrl.pathname);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    const filePath = resolveStaticPath(requestUrl.pathname);

    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    await sendFile(req, res, filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`xixi HTTP server listening on http://${host}:${port}`);
});
