// 英文写作教练页面用例：mock 掉 /api/en-writing，验证 自动出题→表达帮助→批改 的流程、草稿本地恢复、报错不撒谎。
// 注意：这页进门就会自动抽一题（不打模型的本地接口），所以 calls[0] 永远是 topic。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');

const PAGE = path.resolve(import.meta.dirname, '..', 'public', 'tools', 'en-writing', 'index.html');

const TOPIC = { kind: 'topic', en: 'Tell the story of a trip that did not go as planned.', zh: '讲一次计划赶不上变化的出行', type: '叙述', hint: '计划是什么、哪里崩了、你怎么应对', total: 24 };

const TIPS = {
  kind: 'tips',
  tenses: [
    { name: '一般过去时', why: '讲已经发生的事，全文主线', example: 'I ordered a latte and waited.' },
    { name: '现在完成时', why: '把过去的事接到现在的感受', example: 'That trip taught me more than planned.' },
  ],
  moves: [
    { en: 'It started when ___.', zh: '开头把事拉进一个具体时刻' },
    { en: 'The part I still remember is ___.', zh: '挑一个细节放大' },
    { en: 'Looking back, ___.', zh: '收尾回看' },
  ],
  phrases: [
    { en: 'out of nowhere', zh: '毫无征兆地' },
    { en: 'give it a shot', zh: '试一试' },
  ],
  sample: { en: 'It started when my train simply stopped in the middle of nowhere. Looking back, that delay gave me the best hour of the trip.', zh: '这事始于火车毫无征兆地停在荒野。回头看，那次晚点给了我最好的一小时。' },
};

const CORRECT = {
  kind: 'correct',
  errors: [
    { quote: 'I very like the meal', fix: 'I really liked the meal', why: 'like 不能被 very 修饰', kind: '中式英语' },
    { quote: 'After I finished ate', fix: 'after I finished eating', why: 'finish 后接动名词', kind: '语法' },
  ],
  rewrite: 'Last Friday I tried the new noodle place. I really liked the meal, so after I finished eating I ordered another bowl to go.',
  comment: '叙事线完整；主要问题是时态和 very 直译。',
  highlight: [{ en: 'so after I finished eating I ordered another bowl to go', zh: '顺承节奏很 native' }],
  wordCount: 35,
};

const ESSAY = 'Last Friday my coworker and I tried the new noodle place downstairs. I very like the meal, especially the beef noodles. After I finished ate, I ordered another bowl to go.';

async function boot(opts = {}) {
  const calls = [];
  const health = { hits: 0, ok: opts.healthOk !== false };
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.seed) window.localStorage.setItem('xixi.en-writing.draft.v1', JSON.stringify(opts.seed));
      window.fetch = (url, init) => {
        if (!init) {
          health.hits += 1;
          if (!health.ok) return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) });
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, model: 'fake' }) });
        }
        const body = init && init.body ? JSON.parse(init.body) : {};
        calls.push({ url, body });
        if (opts.fail) return Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: '生成超时了，点重试再试一次' }) });
        const data = body.mode === 'topic' ? TOPIC : body.mode === 'tips' ? TIPS : CORRECT;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
      };
      window.alert = () => {};
    },
  });
  const { window } = dom;
  // 等 boot 跑完：健康探测 + 自动抽题都发出请求后，监听器才绑上
  for (let i = 0; i < 200; i++) {
    if (health.hits >= 1 && (calls.length >= 1 || !health.ok)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!window.enWriting) throw new Error('页面没完成初始化');
  return { dom, window, calls, health, doc: window.document };
}

const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timeout');
};

const typeEssay = (win, text) => {
  const ta = win.document.getElementById('essay');
  ta.value = text;
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
};

test('进门自动抽题：健康探测一次 + 立刻拿一个主题，不用先点骰子', async () => {
  const { doc, calls, health } = await boot();
  assert.equal(health.hits, 1);
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  assert.equal(calls[0].body.mode, 'topic');
  assert.equal(doc.getElementById('t-zh').textContent, TOPIC.zh);
  assert.match(doc.getElementById('t-hint').textContent, /计划是什么/, '方向提示要显示');
  assert.equal(doc.getElementById('t-type').textContent, '叙述');
});

test('服务不可达：明说连不上，不白屏也不假装正常', async () => {
  const { doc } = await boot({ healthOk: false });
  await waitFor(() => /连不上写作服务/.test(doc.getElementById('t-status').textContent));
  assert.ok(doc.getElementById('dice'), '按钮还在');
});

test('🎲 再抽：把当前主题作为 avoid 传过去，不会连着同一题', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('dice').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'topic');
  assert.equal(calls[1].body.avoid, TOPIC.en);
});

test('🧠 表达帮助：按时态/句式/搭配/范文渲染，主题带给模型', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('tips-btn').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'tips');
  assert.equal(calls[1].body.topic, TOPIC.en);
  await waitFor(() => !doc.getElementById('tips-card').classList.contains('hidden'));
  const html = doc.getElementById('tips-body').innerHTML;
  assert.ok(html.includes('一般过去时') && html.includes('I ordered a latte'), '时态+例句');
  assert.ok(html.includes('Looking back, ___.') && html.includes('收尾回看'), '句式框架');
  assert.ok(html.includes('out of nowhere') && html.includes('毫无征兆地'), '高频搭配');
  assert.ok(html.includes('参考范文'), '范文折叠块');
  assert.match(doc.getElementById('tips-body').textContent, /别抄，找节奏/, '范文要劝人别背');
});

test('✍️ 批改：太短客户端就拦住（不花模型钱），够长才提交', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, 'I very like it.');
  doc.getElementById('fix-btn').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 1, '字数不够不该打接口');
  assert.match(doc.getElementById('status').textContent, /25 词|别怕错/);

  typeEssay(window, ESSAY);
  doc.getElementById('fix-btn').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'correct');
  assert.equal(calls[1].body.text, ESSAY.trim() || ESSAY);
  assert.equal(calls[1].body.topic, TOPIC.en);
  await waitFor(() => !doc.getElementById('fb-card').classList.contains('hidden'));
  const rows = [...doc.querySelectorAll('#fb-errors .err-item')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].innerHTML, /I very like the meal/, '原句划出来');
  assert.match(rows[0].innerHTML, /I really liked the meal/, '给替换句');
  assert.ok(rows[0].textContent.includes('中式英语'), '错误类型徽标');
});

test('批改反馈：润色全文、点评、亮点、标题带词数；无硬伤时不编造错误', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, ESSAY);
  doc.getElementById('fix-btn').click();
  await waitFor(() => doc.getElementById('fb-rewrite').textContent.includes('ordered another bowl'));
  assert.equal(doc.getElementById('fb-rewrite').textContent, CORRECT.rewrite, '润色不丢内容');
  assert.ok(doc.getElementById('fb-comment').textContent.includes('时态'));
  assert.ok(doc.getElementById('fb-highlights').textContent.includes('so after I finished eating'), '亮点句');
  assert.equal(doc.getElementById('fb-title').textContent, '批改结果 · 35 词');
  const clean = { ...CORRECT, errors: [], wordCount: 30 };
  window.enWriting.renderFeedback(clean);
  assert.match(doc.getElementById('fb-errors').textContent, /没挑出硬伤/, '没问题就直说');
});

test('词数实时统计走本地：不打接口', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => calls.length === 1);
  typeEssay(window, "I don't like waiting, but the trip was fun!");
  assert.match(doc.getElementById('counter').textContent, /^9 words/, "don't 只算一个词");
  assert.equal(calls.length, 1, '统计词数不该发请求');
});

test('草稿存本机一个 key（主题+文本），重开页面原样恢复', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, ESSAY);
  await new Promise((r) => setTimeout(r, 500)); // debounce 400ms
  const saved = JSON.parse(window.localStorage.getItem('xixi.en-writing.draft.v1'));
  assert.equal(saved.text, ESSAY);
  assert.equal(saved.topic.en, TOPIC.en);
  assert.ok(saved.at > 0, '带时间戳');

  const b = await boot({ seed: saved });
  await waitFor(() => b.doc.getElementById('essay').value === ESSAY);
  assert.equal(b.doc.getElementById('t-en').textContent, TOPIC.en, '主题也恢复');
  assert.equal(b.calls.length, 0, '有草稿就不该再自动抽题打断思路');
  assert.match(b.doc.getElementById('counter').textContent, /^31 words/);
});

test('接口挂了：中文错误 + 重试按钮，主题区不留假数据', async () => {
  const { doc, calls } = await boot({ fail: true });
  await waitFor(() => calls.length === 1);
  await waitFor(() => doc.getElementById('status').textContent.includes('超时'));
  assert.equal(doc.getElementById('t-en').textContent, '…', '没拿到就不编');
  assert.ok(doc.getElementById('status').querySelector('button'), '要有重试按钮');
  doc.getElementById('status').querySelector('button').click();
  await waitFor(() => calls.length === 2);
});

test('换主题会收起上一轮的 tips 和批改，避免新旧混着看', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, ESSAY);
  doc.getElementById('fix-btn').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => !doc.getElementById('fb-card').classList.contains('hidden'));
  window.enWriting.renderTopic({ ...TOPIC, en: 'A different topic entirely.' });
  assert.ok(doc.getElementById('fb-card').classList.contains('hidden'), '批改卡该收起');
  assert.ok(doc.getElementById('tips-card').classList.contains('hidden'), 'tips 卡该收起');
});

test('视觉红线：极简、和场景英语同一套柔绿；无填空紫/砖红/玻璃拟态', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /--accent: #3f7d5c/);
  assert.doesNotMatch(html, /#7c5cff|#d84f2b/i);
  assert.doesNotMatch(html, /backdrop-filter|linear-gradient/);
  assert.match(html, /prefers-color-scheme: dark/);
});
