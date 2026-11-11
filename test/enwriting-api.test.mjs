// /api/en-writing 端到端：真起 xixi 服务 + 假 openclaw CLI，走真实 HTTP。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const FAKE = path.join(here, 'fixtures', 'fake-openclaw.cjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
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
      const r = await get('/api/en-writing/health');
      if (r.status === 200) return { child, get, post, stderr: () => stderr };
    } catch { /* 还没监听 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error('服务没起来：' + stderr);
}

function stop(h) { if (h?.child?.exitCode === null) h.child.kill('SIGKILL'); }

const ESSAY = 'Last Friday my coworker and I tried the new noodle place downstairs. I very like the meal, especially the beef noodles. After I finished ate, I ordered another bowl to go. I still think about it now.';

test('写作接口健康检查：新 tool 字段、不含密钥、额度独立计数', async () => {
  const s = await startServer();
  try {
    const r = await s.get('/api/en-writing/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.tool, 'en-writing');
    assert.ok(r.json.model && r.json.pid, '要能看出跑在哪个进程/模型');
    assert.equal(typeof r.json.todayWritingUsed, 'number', '写作额度单独可见');
    assert.ok(!/api[_-]?key|token|secret/i.test(r.text));
  } finally { stop(s); }
});

test('POST topic：本地随机出题，不打模型、不烧额度', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/en-writing', { mode: 'topic' });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.kind, 'topic');
    assert.ok(r.json.data.en && r.json.data.zh && ['叙述', '讨论'].includes(r.json.data.type));
    assert.ok(r.json.data.total >= 20);
    const h = await s.get('/api/en-writing/health');
    assert.equal(h.json.todayWritingUsed, 0, '点主题不该花模型额度');
  } finally { stop(s); }
});

test('POST tips：假 CLI → 时态/句式/搭配/范文四组齐活', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/en-writing', { mode: 'tips', topic: 'Tell the story of a trip that did not go as planned.', topicZh: '讲一次计划赶不上变化的出行', type: '叙述' });
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.equal(d.kind, 'tips');
    assert.ok(d.tenses.length >= 2 && d.tenses[0].example, '时态建议要带例句');
    assert.ok(d.moves.length >= 3 && d.phrases.length >= 3);
    assert.match(d.sample.en, /train/, '范文贴着主题');
  } finally { stop(s); }
});

test('POST correct：围栏 JSON 也能抠出来，错误/润色/点评/亮点都在', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/en-writing', { mode: 'correct', topic: 'Describe a meal you still remember.', text: ESSAY });
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.equal(d.errors.length, 3, '含语法对但别扭的表达生硬类');
    assert.equal(d.errors[0].kind, '中式英语');
    assert.ok(d.errors.some((e) => e.kind === '表达生硬'), 'native 二审要产出');
    assert.ok(d.rewrite && d.comment, '润色和点评要有');
    assert.equal(d.highlight.length, 1);
    assert.ok(d.wordCount > 30);
  } finally { stop(s); }
});

test('坏请求全给中文提示：太短、没主题、未知 mode、GET、乱路径', async () => {
  const s = await startServer();
  try {
    const short = await s.post('/api/en-writing', { mode: 'correct', topic: 'A trip gone wrong', text: 'hi' });
    assert.equal(short.status, 400);
    assert.match(short.json.error, /60 个字符/);
    const noTopic = await s.post('/api/en-writing', { mode: 'tips' });
    assert.equal(noTopic.status, 400);
    const badMode = await s.post('/api/en-writing', { mode: 'translate' });
    assert.equal(badMode.status, 400);
    const get = await s.get('/api/en-writing');
    assert.equal(get.status, 405);
    const none = await s.post('/api/no-such-tool', {});
    assert.equal(none.status, 404);
  } finally { stop(s); }
});

test('限流独立成桶：写作额度用完不挡场景英语，主题永远能点', async () => {
  const s = await startServer({ ENWRITING_IP_LIMIT: '2' });
  try {
    const a = await s.post('/api/en-writing', { mode: 'tips', topic: 'A broken elevator', type: '叙述' });
    const b = await s.post('/api/en-writing', { mode: 'tips', topic: 'A kind stranger', type: '叙述' });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const c = await s.post('/api/en-writing', { mode: 'tips', topic: 'A loud neighbor', type: '叙述' });
    assert.equal(c.status, 429);
    assert.match(c.json.error, /秒后再试/);
    const topicStillOk = await s.post('/api/en-writing', { mode: 'topic' });
    assert.equal(topicStillOk.status, 200, '被限流了也还能换题——随机主题不花钱');
    const sceneStillOk = await s.post('/api/scene-guide', { mode: 'dialogue', scene: '和朋友聊周末' });
    assert.equal(sceneStillOk.status, 200, '写作限流不该吃掉场景英语的桶');
  } finally { stop(s); }
});

test('模型侧失败 → 5xx 中文错误，服务不崩', async () => {
  const s = await startServer();
  try {
    const envFail = await s.post('/api/en-writing', { mode: 'correct', topic: 'A trip gone wrong', text: ESSAY });
    assert.equal(envFail.status, 200, '先证明通路正常');
    const s2 = await startServer({ FAKE_OPENCLAW_FAIL: '1' });
    try {
      const bad = await s2.post('/api/en-writing', { mode: 'tips', topic: 'A trip gone wrong', type: '叙述' });
      assert.ok(bad.status >= 500, `模型挂了要 5xx，实际 ${bad.status}`);
      assert.match(bad.json.error, /.+/, '要给可读中文');
      const stillAlive = await s2.get('/api/en-writing/health');
      assert.equal(stillAlive.status, 200, '失败之后服务还得活着');
    } finally { stop(s2); }
  } finally { stop(s); }
});

test('POST profile：拿本地台账统计出画像与台阶练习', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/en-writing', {
      mode: 'profile',
      stats: { n: 6, span: '近 3 周', kindTotals: { 时态: 9, 语法: 4 }, avgSentenceWords: 7.8, simpleRate: 0.82, connectiveRate: 0.1, tenses: '一般现在时', topQuotes: ['I very like it'], samples: ['Last winter I go to a small shop. It is cold.'] },
    });
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.equal(d.kind, 'profile');
    assert.ok(d.portrait && d.weaknesses.length >= 2, '画像至少点出两个薄弱点');
    assert.ok(d.weaknesses.every((w) => w.evidence), '薄弱点必须带证据');
    assert.equal(d.lessons.length, 2);
    assert.match(d.lessons[1].stage, /2/, '台阶感保留');
    assert.ok(d.nextFocus, '收尾给下一步');
    const h = await s.get('/api/en-writing/health');
    assert.ok(h.json.todayWritingUsed >= 1, '画像记进写作额度');
  } finally { stop(s); }
});

test('POST profile：台账不足 3 篇不花钱、给中文解释', async () => {
  const s = await startServer();
  try {
    const r = await s.post('/api/en-writing', { mode: 'profile', stats: { n: 2, samples: ['a'] } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /3 篇/);
    const h = await s.get('/api/en-writing/health');
    assert.equal(h.json.todayWritingUsed, 0, '被拒的请求不该烧额度');
  } finally { stop(s); }
});

test('模型 JSON 崩一次：服务端自动带警示重跑，用户仍拿到 200', async () => {
  const tick = '/tmp/fake-badjson-' + process.pid + '-' + Math.random().toString(36).slice(2);
  try { require('node:fs').unlinkSync(tick); } catch { /* 干净起步 */ }
  const s = await startServer({ FAKE_BADJSON: '1', FAKE_OPENCLAW_TICK: tick });
  try {
    const r = await s.post('/api/en-writing', {
      mode: 'profile',
      stats: { n: 4, kindTotals: { 时态: 7 }, samples: ['I go to a park. The sun is bright.'], avgSentenceWords: 7.5 },
    });
    assert.equal(r.status, 200, '第一次崩了不该把用户晾着');
    assert.ok(r.json.data.weaknesses.length >= 1);
    const h = await s.get('/api/en-writing/health');
    assert.equal(h.json.todayWritingUsed, 1, '重跑两次 CLI 也只算一次请求');
  } finally { stop(s); try { require('node:fs').unlinkSync(tick); } catch { /* ok */ } }
});

test('静态页面可访问：/tools/en-writing/ 出极简写作页（回归）', async () => {
  const s = await startServer();
  try {
    const r = await s.get('/tools/en-writing/');
    assert.equal(r.status, 200);
    assert.match(r.text, /英文写作教练/);
    assert.match(r.text, /api\/en-writing/);
  } finally { stop(s); }
});
