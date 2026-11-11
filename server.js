#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const sceneGuide = require('./lib/scene-guide.js');
const enWriting = require('./lib/en-writing.js');

const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 10801);
const host = process.env.HOST || '0.0.0.0';
const API_PATH = '/api/scene-guide';
const WRITE_PATH = '/api/en-writing';
const MAX_BODY_BYTES = 12000;
const BOOT_AT = new Date(); // 健在哪个代码版本上跑的，靠这个时间跟文件 mtime 对

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

async function apiHealth(req, res, pathname) {
  if (pathname !== `${API_PATH}/health` && pathname !== `${WRITE_PATH}/health`) {
    sendJson(res, 404, { ok: false, error: '没有这个健康检查接口' });
    return;
  }
  // 不回任何密钥，只用来判断「接口在不在、跑的是新代码还是旧进程」
  let codeMtime = null;
  try {
    const info = await fs.stat(path.join(__dirname, 'server.js'));
    codeMtime = info.mtime.toISOString();
  } catch { /* 读不到就算了 */ }
  sendJson(res, 200, {
    ok: true,
    tool: pathname.startsWith(WRITE_PATH) ? 'en-writing' : 'scene-guide',
    model: sceneGuide.CONFIG.model,
    binary: sceneGuide.CONFIG.bin,
    pid: process.pid,
    startedAt: BOOT_AT.toISOString(),
    uptimeSec: Math.round(process.uptime()),
    serverJsMtime: codeMtime,
    staleCode: !!(codeMtime && new Date(codeMtime) > new Date(BOOT_AT.getTime() + 1000)),
    todayUsed: sceneGuide.budgetUsed(),
    todayWritingUsed: enWriting.budgetUsed(),
  });
}

const GEN_APIS = {
  [API_PATH]: { tag: 'scene-guide', mod: sceneGuide },
  [WRITE_PATH]: { tag: 'en-writing', mod: enWriting },
};

async function handleApi(req, res, pathname) {
  if (pathname.endsWith('/health') && GEN_APIS[pathname.slice(0, pathname.lastIndexOf('/health'))]) {
    await apiHealth(req, res, pathname);
    return;
  }
  const api = GEN_APIS[pathname];
  if (!api) {
    sendJson(res, 404, { ok: false, error: '没有这个接口' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '这个接口用 POST 调用' });
    return;
  }
  let body;
  const t0 = Date.now();
  const ip = clientIp(req);
  let logged = false;
  const logIt = (status, note) => {
    if (logged) return;
    logged = true;
    const line = `[${api.tag}] ${new Date().toISOString()} POST from=${ip} http=${status} ${Date.now() - t0}ms${note ? ' ' + note : ''}`;
    (status >= 500 || status === 429 ? console.error : console.log)(line);
  };
  res.on('close', () => { if (!res.writableEnded) logIt(499, 'client aborted before response'); });
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : null;
  } catch (e) {
    const status = e.status === 413 ? 413 : 400;
    logIt(status, e.message);
    sendJson(res, status, { ok: false, error: e.status === 413 ? e.message : '请求体不是合法 JSON' });
    return;
  }
  try {
    const data = await api.mod.handleRequest(body, ip);
    logIt(200, `mode=${data.kind || (body && body.mode)} cached=${!!data.cached}`);
    sendJson(res, 200, { ok: true, data });
  } catch (e) {
    const status = e.status || 500;
    logIt(status, (e.message || '生成失败').slice(0, 160));
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
