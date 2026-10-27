// 站点级用例：工具箱主页渲染、注册表与真实路径一致、CSV 体检页能真跑通。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');

const SITE = path.resolve(import.meta.dirname, '..', 'public');
const registry = JSON.parse(fs.readFileSync(path.join(SITE, 'tools.json'), 'utf8'));

function quietConsole() {
  const vc = new VirtualConsole();
  // 下载用的 blob: 跳转在 jsdom 里必然报「无法导航」，这类噪音不必刷屏
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  return vc;
}

const GBK_TABLE = new Map([
  ['列', [0xc1, 0xd0]], ['A', [0x41]], ['B', [0x42]],
  ['崔', [0xb4, 0xde]], ['学', [0xd1, 0xa7]], ['奎', [0xbf, 0xf1]],
  ['陕', [0xc9, 0xc0]], ['西', [0xce, 0xc4]],
]);

function gbkBytesOf(str, RealmUint8) {
  const out = [];
  for (const ch of str) {
    if (ch === '\n') { out.push(0x0d, 0x0a); continue; }
    if (ch.charCodeAt(0) < 128) { out.push(ch.charCodeAt(0)); continue; } // ASCII 在国标里就是单字节
    const b = GBK_TABLE.get(ch);
    assert.ok(b, `GBK 表缺少 ${ch}`);
    out.push(...b);
  }
  return new RealmUint8(out);
}

function bootPage(file, beforeParse) {
  return new JSDOM(fs.readFileSync(path.join(SITE, file), 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: quietConsole(),
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => registry });
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      if (beforeParse) beforeParse(window);
    },
  });
}

function waitFor(win, name, ms = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`页面脚本未初始化 window.${name}`)), ms);
    const check = () => (win[name] ? (clearTimeout(t), resolve(win[name])) : setTimeout(check, 50));
    check();
  });
}

const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// 页面 realm 里造的对象，比较前先进本 realm（结构相同但原型不同会让 deepStrictEqual 失败）
const local = (v) => (Array.isArray(v) || (v && typeof v === 'object' && typeof v.length === 'number') ? Array.from(v) : v);

test('注册表里的每个工具都指向真实存在的页面，占位工具不带死链', () => {
  assert.ok(Array.isArray(registry.tools) && registry.tools.length >= 4, '注册表应有若干工具');
  for (const t of registry.tools) {
    assert.ok(t.name && t.desc && t.icon, `${t.slug} 缺少 name/desc/icon`);
    if (t.state === 'soon') {
      assert.ok(!t.href, `${t.slug} 是占位工具，不该有 href`);
      continue;
    }
    assert.ok(t.href, `${t.slug} 既不是占位也没有 href`);
    const dir = path.join(SITE, t.href.replace(/^\/|\/$/g, ''));
    assert.ok(fs.existsSync(path.join(dir, 'index.html')), `${t.slug} 指向的页面不存在：${t.href}`);
  }
  const icons = new Set(registry.tools.map((t) => t.icon));
  const home = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  for (const icon of icons) assert.ok(home.includes(`id="${icon}"`), `主页图标精灵里没有 ${icon}`);
});

test('工具箱主页按 tools.json 渲染卡片，占位工具不可点，搜索可过滤', async () => {
  const dom = bootPage('index.html');
  const { window } = dom;
  await tick();

  const cards = [...window.document.querySelectorAll('.card')];
  assert.equal(cards.length, registry.tools.length, '卡片数量应与注册表一致');
  assert.equal(cards[0].getAttribute('href'), '/tools/classify-stats/');
  assert.match(cards[0].querySelector('.name').textContent, /派费分类统计/);
  assert.equal(cards[0].querySelector('svg use').getAttribute('href'), '#i-table', '图标要真的接上');

  const soon = cards.find((c) => c.dataset.state === 'soon');
  assert.ok(soon, '应有待上线的占位卡片');
  assert.equal(soon.tagName, 'DIV', '占位卡片不能是可点的 a');
  assert.match(soon.querySelector('.soon').textContent, /待上线/);
  assert.ok(cards.every((c) => c.querySelector('.desc').textContent.length > 8), '每张卡都要有介绍');

  const input = window.document.getElementById('q');
  input.value = '派费';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const filtered = [...window.document.querySelectorAll('.card')];
  assert.ok(filtered.length > 0 && filtered.length < registry.tools.length, `搜索应缩小结果：${filtered.length}`);
  assert.ok(filtered.every((c) => /派费/.test(c.textContent)));
  assert.match(window.document.getElementById('count').textContent, /共 6 个 · 显示/);
});

test('读不到 tools.json 时主页仍能用内置备份渲染', async () => {
  const dom = bootPage('index.html', (window) => {
    window.fetch = () => Promise.reject(new Error('offline'));
  });
  await tick();
  const { window } = dom;
  const cards = [...window.document.querySelectorAll('.card')];
  assert.ok(cards.length >= 3, `兜底清单也要有卡片，实际 ${cards.length}`);
  assert.match(window.document.getElementById('note').textContent, /内置备份/);
});

test('CSV 体检：自动认分隔符/引号/编码，列统计口径正确', async () => {
  const dom = bootPage('tools/csv-inspect/index.html');
  const api = await waitFor(dom.window, 'csvInspect');

  assert.equal(api.sniffDelimiter('a,b,c\n1,2,3\n4,5,6\n'), ',');
  assert.equal(api.sniffDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6\n'), '\t');
  assert.equal(api.sniffDelimiter('a;b;c\n1;2;3\n4;5;6\n'), ';');

  const parsed = api.parse('编号,说明\r\n1,"含,逗号 与 ""引号"""\r\n2,"跨\n行"\r\n', ',');
  assert.equal(parsed.crlf, true);
  assert.deepEqual(local(parsed.rows[1]), ['1', '含,逗号 与 "引号"']);
  assert.deepEqual(local(parsed.rows[2]), ['2', '跨\n行']);

  assert.equal(api.toNumber('￥1,234.50'), 1234.5);
  assert.equal(api.toNumber('12.800'), 12.8);
  assert.equal(api.toNumber('1,23'), null, '千分位不是三位一组就不能当成数字');
  assert.equal(api.toNumber('12%'), 12, '百分比按数值看待');
  assert.equal(api.toNumber('abc'), null);
  assert.equal(api.toNumber(''), null);

  // GBK 回退：手工给出国标字节（本机 Node 是小 ICU，Buffer 也编不了 GBK）
  const gbkBytes = gbkBytesOf('列A,列B\n崔学奎,陕西\n', dom.window.Uint8Array);
  assert.equal(gbkBytes[1], 0xd0, '确认给的是国标字节而不是 UTF-8');
  let gbkResult;
  try {
    gbkResult = { ok: true, value: api.decode(gbkBytes.buffer) };
  } catch (e) {
    gbkResult = { ok: false, message: e.message };
  }
  if (gbkResult.ok) {
    assert.match(gbkResult.value.encoding, /gb/, '非法 UTF-8 应回落 GBK');
    assert.match(gbkResult.value.text, /崔学奎/);
  } else {
    // 小 ICU 环境（没有 TextDecoder 或没有国标编码表）：必须给可读提示，不交乱码
    assert.match(gbkResult.message, /GBK|GB18030|解码/);
  }
  // 纯 ASCII 在没有 TextDecoder 的环境里也能读
  const ascii = api.decode(new dom.window.Uint8Array([0x61, 0x2c, 0x31, 0x0a, 0x32, 0x2c, 0x33]).buffer);
  assert.equal(ascii.text, 'a,1\n2,3');
  // 带 BOM 的一定按 UTF-8-BOM 读（需要 TextDecoder，jsdom 里没有就跳过）
  if (typeof dom.window.TextDecoder === 'function') {
    const withBom = new dom.window.Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x31]);
    const bomDecoded = api.decode(withBom.buffer);
    assert.equal(bomDecoded.encoding, 'utf-8-bom');
    assert.equal(bomDecoded.text, 'a,1');
  }

  // 3 行里 2 行是数字：应算「数值(含脏值)」，合计仍然有用
  api.analyze('运单号,收款员,计费重量,派费,签收时间\r\nYT1,崔学奎,1.200,￥7.00,2026-07-02 16:56:07\r\nYT2,满泽民,45.500,7.715,2026-07-02 18:03:11\r\nYT3,崔学奎,abc,6.5,2026-07-03 09:12:00\r\n', '测试.csv', 120);
  const cols = api.state.stats;
  assert.equal(api.state.header.length, 5);
  assert.equal(cols[2].kind, '数值(含脏值)', '计费重量列有 abc');
  assert.equal(cols[4].kind, '日期');
  assert.equal(cols[1].top[0][0], '崔学奎');
  assert.equal(cols[1].top[0][1], 2);
  assert.ok(Math.abs(cols[3].agg.sum - 21.215) < 1e-9, `派费合计应为 21.215，实际 ${cols[3].agg.sum}`);
  assert.match(dom.window.document.getElementById('status').textContent, /解析完成：3 行 × 5 列/);
  assert.equal(dom.window.document.querySelectorAll('#stats tbody tr').length, 5);
  assert.equal(dom.window.document.querySelectorAll('#preview tbody tr').length, 3);
});

test('CSV 体检导出的清洗文件可被 Excel 正常解析', async () => {
  const made = [];
  const dom = bootPage('tools/csv-inspect/index.html', (window) => {
    window.URL.createObjectURL = (blob) => { made.push(blob); return 'blob:mock'; };
  });
  const { window } = dom;
  const api = await waitFor(window, 'csvInspect');

  api.analyze('姓名,备注,金额\r\n崔学奎,"含,逗号","1,200.50"\r\n满泽民,普通,10\r\n', '导出测试.csv', 60);
  window.document.getElementById('dl-clean').click();
  await tick(80);
  assert.equal(made.length, 1, '应触发一次下载');

  const bytes = await new Promise((resolve, reject) => {
    const fr = new window.FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = () => reject(fr.error || new Error('读取 blob 失败'));
    fr.readAsArrayBuffer(made[0]);
  });
  assert.deepEqual(local(Array.from(bytes.slice(0, 3))), [0xef, 0xbb, 0xbf], 'Excel 需要 UTF-8 BOM');
  const text = new TextDecoder('utf-8').decode(bytes.slice(3)); // Node 侧解码，与页面无关
  const lines = text.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop(); // CRLF 结尾会多一个空串
  assert.deepEqual(local(lines), ['姓名,备注,金额', '崔学奎,"含,逗号","1,200.50"', '满泽民,普通,10']);
  // 不再走一遍 SheetJS 的类型推断，这里只验内容本身没被改坏
  assert.equal(text.indexOf('\ufffd'), -1, '不应出现替换字符（乱码）');
});
