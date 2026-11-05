#!/usr/bin/env node
// 上线后自检：确认「公网跑的就是磁盘上这份代码」，别让部署时差骗人。
// 用法：node scripts/verify-live.cjs [--base https://xixi.publicrandom.com] [--probe]
//   --probe 额外打一发真实生成（会花模型额度，日常别开）
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const BASE = baseIdx >= 0 ? argv[baseIdx + 1] : 'https://xixi.publicrandom.com';
const PROBE = argv.includes('--probe');
const ROOT = path.resolve(__dirname, '..');

// 会被服务进程“吃进内存”的文件；改这些必须重启
const CODE_FILES = ['server.js', 'lib/scene-guide.js'];
// 静态页面不需要重启，只核对 md5 长度与线上是否一致
const PAGES = ['public/index.html', 'public/tools.json', 'public/tools/scene-english/index.html', 'public/tools/csv-inspect/index.html'];

function newestMtime(files) {
  let newest = 0, name = '';
  for (const f of files) {
    try {
      const t = fs.statSync(path.join(ROOT, f)).mtimeMs;
      if (t > newest) { newest = t; name = f; }
    } catch { /* 文件不存在就别管 */ }
  }
  return { ms: newest, name };
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 下面按原文报错 */ }
  return { status: res.status, json, text };
}

(async () => {
  let fail = 0;
  const say = (ok, label, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!ok) fail = 1;
  };

  // 1) 页面本身：线上和本地字节一致
  for (const p of PAGES) {
    const local = fs.readFileSync(path.join(ROOT, p));
    const url = p === 'public/index.html' ? `${BASE}/` : `${BASE}/${p.replace(/^public\//, '')}`.replace(/\/([^/]+)$/, (m, f) => f.endsWith('.html') ? `/${f}` : m).replace(/\/tools\.json$/, '/tools.json');
    try {
      const res = await fetch(url);
      const remote = Buffer.from(await res.arrayBuffer());
      const same = res.ok && remote.length === local.length && remote.equals(local);
      say(same, `页面 ${p.replace('public/', '')}`, same ? `${local.length}B 一致` : `线上 ${res.status} ${remote.length}B / 本地 ${local.length}B`);
    } catch (e) {
      say(false, `页面 ${p}`, e.message);
    }
  }

  // 2) 接口在不在（旧进程没带路由会回 405/404）
  const h = await getJson(`${BASE}/api/scene-guide/health`, { cache: 'no-store' });
  if (!h.json || !h.json.ok) {
    say(false, '生成接口健康检查', `HTTP ${h.status} ${h.text.slice(0, 120)}`);
    console.log('   → 站上的服务很可能是旧进程。跑：systemctl restart xixi');
    process.exit(1);
  }
  const health = h.json;
  say(true, '生成接口健康检查', `model=${health.model} pid=${health.pid} 已跑 ${health.uptimeSec}s 今日已用 ${health.todayUsed} 次`);

  // 3) 进程比代码旧？这就是这次故障的根因
  const codeNewest = newestMtime(CODE_FILES);
  const startedMs = Date.parse(health.startedAt);
  if (Number.isFinite(startedMs) && codeNewest.ms > startedMs + 1000) {
    const lag = Math.round((codeNewest.ms - startedMs) / 1000);
    say(false, '进程与代码同步', `${codeNewest.name} 比进程新 ${lag}s → 需要 systemctl restart xixi`);
  } else {
    say(true, '进程与代码同步', '线上跑的是最新代码');
  }

  // 4) 一发真实的最小生成（可选，花额度）
  if (PROBE) {
    const t0 = Date.now();
    const r = await getJson(`${BASE}/api/scene-guide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dialogue', scene: '在便利店买水，想用现金支付', fresh: true }),
    });
    const ok = r.status === 200 && r.json && r.json.ok && r.json.data && (r.json.data.lines || []).length >= 4;
    say(ok, '真实生成', ok ? `${r.json.data.lines.length} 句 / ${((Date.now() - t0) / 1000).toFixed(1)}s` : `HTTP ${r.status} ${JSON.stringify(r.json || r.text).slice(0, 200)}`);
  }

  console.log(fail ? '\n自检未通过，按上面的提示处理。' : '\n自检通过。');
  process.exit(fail);
})().catch((e) => {
  console.error('自检脚本崩了：', e.message);
  process.exit(1);
});
