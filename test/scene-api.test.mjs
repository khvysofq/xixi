// 真起一个 xixi 服务（用假的 openclaw CLI 当替身），打真实 HTTP 请求验整条链路。
// 每个用例各占一个随机空闲端口，避免和网关/线上服务抢端口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const FAKE = path.join(here, 'fixtures', 'fake-openclaw.cjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function request(base, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    const req = http.request(`${base}${p}`, { method, headers: h }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch { /* 静态页不是 JSON */ }
        resolve({ status: res.statusCode, json, text: out });
      });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}

async function startServer(env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const get = (p, h) => request(base, 'GET', p, undefined, h);
  const post = (p, b, h) => request(base, 'POST', p, b, h);
  const child = spawn(process.execPath, [path.join(siteRoot, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SCENE_GUIDE_BIN: FAKE, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await get('/api/scene-guide/health');
      if (r.status === 200) return { child, get, post, stderr: () => stderr };
    } catch { /* 还没监听 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error('服务没起来：' + stderr);
}

function stop(handle) {
  if (handle && handle.child && handle.child.exitCode === null) handle.child.kill('SIGKILL');
}

test('健康检查暴露当前用的模型与 CLI 路径（不含密钥）', async () => {
  const s = await startServer();
  try {
    const r = await s.get('/api/scene-guide/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.model, '应回模型名');
    assert.equal(r.json.binary, FAKE);
    assert.ok(!/api[_-]?key|token|secret/i.test(r.text), '接口不该回任何密钥字样');
  } finally { stop(s); }
});

test('POST dialogue：走 CLI → 抠 JSON → 归一 → 前端要的字段都在', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '咖啡店点单，想换燕麦奶少冰' }, { 'X-Forwarded-For': '10.0.0.1' });
    assert.equal(r.status, 200, r.text);
    const d = r.json.data;
    assert.equal(d.kind, 'dialogue');
    assert.equal(d.title, '咖啡店点单');
    assert.equal(d.lines.length, 3);
    assert.ok(d.lines[0].en.includes('oat milk'));
    assert.ok(d.lines[0].zh, '每句都要有中文');
    assert.deepEqual(d.tips, ['go easy on the ice 比 less ice 更像口语']);
    assert.equal(d.model, 'fake/fast');
  } finally { stop(s); }
});

test('POST more：分类语料与句式都回来（围栏 JSON 也能解析）', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/scene-guide', {
      mode: 'more', scene: '咖啡店点单',
      dialogue: [{ who: 'A', en: 'Can I get a latte?', zh: '来杯拿铁' }],
    }, { 'X-Forwarded-For': '10.0.0.2' });
    assert.equal(r.status, 200, r.text);
    const g = r.json.data;
    assert.equal(g.kind, 'guide');
    assert.equal(g.sections[0].title, '点单常用');
    assert.ok(g.sections[0].items[0].note.includes('少冰'));
    assert.equal(g.patterns.length, 1);
  } finally { stop(s); }
});

test('同场景 30 分钟内命中缓存；fresh（换一批）绕开缓存', async () => {
  const s = await startServer();
  try {
    const a = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '缓存测试场景' }, { 'X-Forwarded-For': '10.0.0.3' });
    const b = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '缓存测试场景' }, { 'X-Forwarded-For': '10.0.0.3' });
    assert.equal(a.json.data.cached, undefined, '第一次是新生成');
    assert.equal(b.json.data.cached, true, '第二次应直接取缓存');
    assert.deepEqual(b.json.data.lines, a.json.data.lines);
    const c = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '缓存测试场景', fresh: true }, { 'X-Forwarded-For': '10.0.0.3' });
    assert.equal(c.json.data.cached, undefined, '换一批必须重新生成');
  } finally { stop(s); }
});

test('限流：同 IP 超过每窗口次数返回 429 并提示等多久', async () => {
  const s = await startServer({ SCENE_GUIDE_IP_LIMIT: '2', SCENE_GUIDE_IP_WINDOW_MS: '120000' });
  try {
    assert.equal((await s.post('/api/scene-guide', { mode: 'dialogue', scene: '限流测试一' }, { 'X-Forwarded-For': '9.9.9.9' })).status, 200);
    assert.equal((await s.post('/api/scene-guide', { mode: 'dialogue', scene: '限流测试二' }, { 'X-Forwarded-For': '9.9.9.9' })).status, 200);
    const blocked = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '限流测试三' }, { 'X-Forwarded-For': '9.9.9.9' });
    assert.equal(blocked.status, 429, blocked.text);
    assert.match(blocked.json.error, /后再试/);
    const other = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '限流测试四' }, { 'X-Forwarded-For': '8.8.8.8' });
    assert.equal(other.status, 200, '换出口 IP 不该被牵连');
  } finally { stop(s); }
});

test('坏请求都给中文提示，不给 500 页', async () => {
  const s = await startServer();
  try {
    const badMode = await s.post('/api/scene-guide', { mode: 'x', scene: '点餐' }, { 'X-Forwarded-For': '10.0.0.9' });
    assert.equal(badMode.status, 400);
    assert.match(badMode.json.error, /mode/);

    const empty = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '' }, { 'X-Forwarded-For': '10.0.0.9' });
    assert.equal(empty.status, 400);
    assert.match(empty.json.error, /场景/);

    assert.equal((await s.get('/api/scene-guide')).status, 405);
    assert.equal((await s.get('/api/nothing-here')).status, 404);

    const huge = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '超'.repeat(6000) }, { 'X-Forwarded-For': '10.0.0.9' });
    assert.ok([400, 413].includes(huge.status), `超大请求要被挡掉，实际 ${huge.status}`);
  } finally { stop(s); }
});

test('模型侧失败 / 说不出 JSON → 5xx + 可读中文，服务不崩', async () => {
  const s1 = await startServer({ FAKE_OPENCLAW_FAIL: '1' });
  try {
    const r = await s1.post('/api/scene-guide', { mode: 'dialogue', scene: '模型挂了测试' }, { 'X-Forwarded-For': '10.0.1.1' });
    assert.equal(r.status, 502, r.text);
    assert.match(r.json.error, /生成失败/);
    assert.equal((await s1.get('/api/scene-guide/health')).status, 200, '出错后服务要还活着');
  } finally { stop(s1); }

  const s2 = await startServer({ FAKE_OPENCLAW_GARBAGE: '1' });
  try {
    const r = await s2.post('/api/scene-guide', { mode: 'dialogue', scene: '模型不说JSON' }, { 'X-Forwarded-For': '10.0.1.2' });
    assert.equal(r.status, 502, r.text);
    assert.match(r.json.error, /JSON|重试/);
  } finally { stop(s2); }
});

test('静态文件仍可访问：新工具页、首页、注册表（回归）', async () => {
  const s = await startServer();
  try {
    const page = await s.get('/tools/scene-english/');
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('场景英语提示'), '新页面标题应在');
    assert.ok(!/<script[^>]+src=/i.test(page.text), '工具页要单文件，不得有外链脚本');
    assert.equal((await s.get('/')).status, 200);
    const registry = (await s.get('/tools.json')).json;
    assert.ok(registry.tools.some((t) => t.slug === 'scene-english' && t.href === '/tools/scene-english/'));
    assert.ok(fs.existsSync(path.join(siteRoot, 'public', 'tools', 'scene-english', 'index.html')));
  } finally { stop(s); }
});
