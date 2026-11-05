// 真起一个 xixi 服务（用假的 openclaw CLI 当替身），打真实 HTTP 请求验整条链路。
// 每个用例各占一个随机空闲端口，避免和网关/线上服务抢端口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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
  let stdout = '';
  child.stderr.on('data', (b) => { stderr += b; });
  child.stdout.on('data', (b) => { stdout += b; });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await get('/api/scene-guide/health');
      if (r.status === 200) return { child, get, post, stderr: () => stderr, logs: () => stdout + stderr };
    } catch { /* 还没监听 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error('服务没起来：' + stderr);
}

function stop(handle) {
  if (handle && handle.child && handle.child.exitCode === null) handle.child.kill('SIGKILL');
}

test('健康检查暴露当前用的模型与 CLI 路径（不含密钥），并能说清“跑的是不是新代码”', async () => {
  const s = await startServer();
  try {
    const r = await s.get('/api/scene-guide/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.model, '应回模型名');
    assert.equal(r.json.binary, FAKE);
    assert.ok(!/api[_-]?key|token|secret/i.test(r.text), '接口不该回任何密钥字样');
    // 部署时差排查靠这几个字段：进程启动时间 vs 文件 mtime
    assert.ok(Number.isFinite(Date.parse(r.json.startedAt)), '要回进程启动时间');
    assert.ok(Number.isFinite(Date.parse(r.json.serverJsMtime)), '要回 server.js 的 mtime');
    assert.equal(typeof r.json.staleCode, 'boolean', '要直接给出“代码比进程新”的结论');
    assert.equal(typeof r.json.pid, 'number');
    assert.ok(r.json.uptimeSec >= 0);
    assert.equal(r.json.todayUsed, 0, '刚起来的进程今天还没烧过额度');
  } finally { stop(s); }
});

test('POST explain：选中句子中的一个词 → 回到本句用法（含补全与例句）', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/scene-guide', {
      mode: 'explain', scene: '跟同事吐槽工作',
      sentence: "Hey, you got a minute? I've been meaning to vent about work.",
      phrase: 'ment', zh: '我一直想找人说说工作上的烦心事',
    }, { 'X-Forwarded-For': '10.0.0.30' });
    assert.equal(r.status, 200, r.text);
    const d = r.json.data;
    assert.equal(d.kind, 'explain');
    assert.equal(d.phrase, 'ment', '回显用户真的选了啥');
    assert.equal(d.asUsed, 'have been meaning to do sth', '选破了要自动补全成完整搭配');
    assert.match(d.pattern, /have been meaning to do/);
    assert.match(d.meaning, /想做/);
    assert.equal(d.examples.length, 3, '给 3 句能直接套的');
    assert.ok(d.examples[0].en && d.examples[0].zh);
    assert.equal(d.sentence, "Hey, you got a minute? I've been meaning to vent about work.", '原句要回给页面做高亮');
    assert.match(d.caution, /I am meaning/);
  } finally { stop(s); }
});

test('explain 走单独的宽桶：连着问好几个词不会把生成额度吃掉', async () => {
  const s = await startServer({ SCENE_GUIDE_IP_LIMIT: '1', SCENE_GUIDE_EXPLAIN_IP_LIMIT: '4' });
  try {
    const base = { mode: 'explain', scene: '点餐', sentence: 'Go easy on the ice.' };
    for (const phrase of ['easy', 'go easy on', 'ice', 'the']) {
      const r = await s.post('/api/scene-guide', { ...base, phrase }, { 'X-Forwarded-For': '10.0.0.31' });
      assert.equal(r.status, 200, `${phrase} 应允许：${r.text}`);
    }
    const fifth = await s.post('/api/scene-guide', { ...base, phrase: 'on' }, { 'X-Forwarded-For': '10.0.0.31' });
    assert.equal(fifth.status, 429);
    assert.match(fifth.json.error, /讲解/);
    const gen1 = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '点餐生成一' }, { 'X-Forwarded-For': '10.0.0.31' });
    assert.equal(gen1.status, 200, '对话桶还有一次额度');
    const gen2 = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '点餐生成二' }, { 'X-Forwarded-For': '10.0.0.31' });
    assert.equal(gen2.status, 429, '对话桶（1 次/窗口）已满，和讲解互不影响');
    assert.doesNotMatch(gen2.json.error, /讲解/, '这一下撞的是生成桶');
  } finally { stop(s); }
});

test('模型偷懒只给一类、句式为空时，服务端自动重跑一次取更丰满的', async () => {
  const tick = path.join(os.tmpdir(), `fake-tick-${process.pid}-${Date.now()}`);
  const s = await startServer({ FAKE_OPENCLAW_THIN: '1', FAKE_OPENCLAW_TICK: tick });
  try {
    const r = await s.post('/api/scene-guide', {
      mode: 'more', scene: '咖啡店点单偷懒测试',
      dialogue: [{ who: 'A', en: 'Can I get a latte?', zh: '来杯拿铁' }],
    }, { 'X-Forwarded-For': '10.0.0.40' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.data.sections.length >= 3, `分类不该只有一类，实际 ${r.json.data.sections.length}`);
    assert.ok(r.json.data.patterns.length >= 1, '句式不能空着');
    assert.equal(fs.readFileSync(tick, 'utf8'), '2', '应该真的重跑了一次');
  } finally { stop(s); try { fs.unlinkSync(tick); } catch {} }
});

test('缺 sentence 或 phrase 的 explain 请求给 400，不花模型钱', async () => {
  const s = await startServer();
  try {
    const a = await s.post('/api/scene-guide', { mode: 'explain', scene: '点餐', phrase: 'ice' }, { 'X-Forwarded-For': '10.0.0.32' });
    assert.equal(a.status, 400);
    assert.match(a.json.error, /整句/);
    const b = await s.post('/api/scene-guide', { mode: 'explain', scene: '点餐', sentence: 'Go easy on the ice.' }, { 'X-Forwarded-For': '10.0.0.32' });
    assert.equal(b.status, 400);
    assert.match(b.json.error, /选中/);
  } finally { stop(s); }
});

test('每一笔生成都留下行：成功也记、限流也记，下次主人报障不用猜', async () => {
  const s = await startServer({ SCENE_GUIDE_IP_LIMIT: '2', SCENE_GUIDE_DAILY_LIMIT: '50' });
  try {
    const ok = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '记录日志用的场景' });
    assert.equal(ok.status, 200);
    await s.post('/api/scene-guide', { mode: 'dialogue', scene: '第二个场景' });
    const third = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '第三个场景' });
    assert.equal(third.status, 429, '第三条要撞限流');
    const logs = s.logs();
    assert.match(logs, /POST from=.*http=200 \d+ms mode=dialogue/, '成功要有一行');
    assert.match(logs, /http=429/, '限流要有一行');
    assert.match(logs, /127\.0\.0\.1|::1|unknown/, '要看得出是谁的请求');
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
    assert.equal(g.sections.length, 3, '按新口径给 3 类');
    assert.equal(g.patterns.length, 2);
    assert.ok(g.sections[0].items[0].example.en, '每条要带例句');
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
