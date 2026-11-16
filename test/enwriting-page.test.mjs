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

const PROFILE = {
  kind: 'profile',
  portrait: '你叙事基本全靠一般现在时，句子常年 8 词上下。',
  weaknesses: [
    { name: '时态单一：只会用现在时', evidence: '3 篇里 2 篇通篇现在时，时态错误 5 次', how: '先练叙事三件套' },
    { name: '句型单一：几乎全简单句', evidence: '平均每句 7.8 词，简单句 82%', how: '从合并短句练起' },
  ],
  lessons: [
    { title: '动词改成过去式再讲故事', stage: '第 1 步', teach: '叙述发生过的事，主干动词一律过去式', examples: [{ wrong: 'Last winter I go to a shop.', right: 'Last winter I went to a shop.' }], drill: '把 I walk home and I feel tired. 改成过去时' },
    { title: '两个短句拼一个 because 从句', stage: '第 2 步', teach: '有因果就合并，句子有长短节奏', examples: [{ wrong: 'I liked it. The soup was hot.', right: 'I liked it because the soup was hot.' }], drill: '合并 He opened the door. It was cold.' },
  ],
  nextFocus: '下次写满 5 句再点批改，先只练过去时',
};

const WHYMOCK = {
  kind: 'why',
  answer: '「It helps」省了 It 是口语老话——劝慰时常把主语藏掉，像我们的「管用就行」。',
  rule: '口语宽慰人，It 常可省',
  examples: [{ en: 'Try the back streets. Faster.', zh: '绕后街吧，快点。' }],
};
const WORDMOCK = {
  kind: 'word', word: 'x', pos: 'n.',
  simpleDef: 'a choice you make after thinking about it',
  zh: '决定；决策',
  collocations: [
    { pattern: 'verb + decision', items: [
      { en: 'make a decision', zh: '做决定', eg: 'Take your time - make a decision today.' },
      { en: 'reach a decision', zh: '达成决定', eg: 'The panel reached a decision.' }] },
    { pattern: 'adjective + decision', items: [{ en: 'tough decision', zh: '艰难的决定', eg: 'It was a tough decision.' }] },
  ],
  warn: '中文说下决定，英文只配 make',
};
const BTMOCK = {
  kind: 'bt', score: 74, src: 't',
  comment: '你在逐句翻中文的壳，先练事件做主语。',
  gaps: [
    { mine: 'we were stopped by the storm', orig: 'the storm kept us indoors', kind: '表达', note: '英文爱用事件做主语' },
  ],
  chunks: [
    { text: 'keep somebody indoors', zh: '困在屋里', type: '动词句', eg: 'The heat kept us indoors.', note: '天气万能动词框' },
    { text: 'for once', zh: '难得地', type: '词组', eg: 'For once, he told the truth.', note: '句首一放就有味道' },
  ],
};

const RECMOCK = {
  kind: 'rec', expr: 'x',
  rec: [
    { en: 'What I remember most is not ___. It is ___.', zh: '我记得最清楚的不是…而是…', example: { en: 'What I remember most is not the score. It is my dad shouting.', zh: '不是比分，是我爸的喊声。' }, note: '同构句式，留白更长' },
    { en: 'The part that sticks is ___', zh: '留下来的部分是…', example: { en: 'The part that sticks is how quiet the cabin was.', zh: '留在心里的是机舱的安静。' }, note: '更短，收尾只剩一个画面时用' },
    { en: 'Looking back, what stayed with me was ___', zh: '回头看留在我身上的是…', example: { en: 'Looking back, what stayed with me was the smell.', zh: '留下来的是那股气味。' }, note: '写旧事重提更沉' },
  ],
};

const MODEL = {
  kind: 'model', title: 'The Deadline That Moved', words: 312,
  paras: [
    { en: 'It started on a rainy Thursday, when my manager dropped a one-line message. The delay was four hours.', zh: '事情始于一个雨天的周四，经理甩来一行消息。延误了四个小时。' },
    { en: 'That night I walked home under my umbrella and made a simple list in my head.', zh: '那晚我打着伞走回家，脑子里列了张清单。' },
  ],
  memorable: [{ en: 'I made a simple list in my head.', zh: '慌乱的解药是把情绪拆成步骤' }],
};

const ASK = {
  kind: 'ask',
  answer: 'fully 是副词，修饰不了名词 consideration；名词要用形容词 careful。再加上这个修饰语得挂在名词上，要用 that 引出从句。',
  verdict: 'confirmed',
  revisedFix: '',
  examples: [{ en: 'The proposal that needs careful consideration came from the intern.', zh: '带 that 的从句稳稳挂住名词。' }],
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
      if (opts.seedLog) window.localStorage.setItem('xixi.en-writing.log.v1', JSON.stringify(opts.seedLog));
      if (opts.seedProfile) window.localStorage.setItem('xixi.en-writing.profile.v1', JSON.stringify(opts.seedProfile));
      window.confirm = () => true;
      window.fetch = (url, init) => {
        if (!init) {
          health.hits += 1;
          if (!health.ok) return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) });
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, model: 'fake' }) });
        }
        const body = init && init.body ? JSON.parse(init.body) : {};
        calls.push({ url, body });
        if (opts.fail) return Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: '生成超时了，点重试再试一次' }) });
        const data = body.mode === 'topic' ? TOPIC : body.mode === 'tips' ? TIPS : body.mode === 'profile' ? PROFILE
          : body.mode === 'ask' ? ASK : body.mode === 'model' ? MODEL : body.mode === 'why' ? WHYMOCK : body.mode === 'rec' ? RECMOCK
          : body.mode === 'word' ? WORDMOCK : body.mode === 'bt' ? BTMOCK : CORRECT;
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


/* ---------- 学习画像（跨篇台账） ---------- */

const logEntry = (text, kinds, quotes) => ({ at: Date.now() - Math.random() * 86400000 * 20, topic: 'T', wordCount: 30, kinds, quotes: quotes || [], text });

test('每次批改自动落台账：错误类型计数、高频原句、节选截 400 字', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, (ESSAY + ' ').repeat(8));   // 超 400 字部分不该整个存
  doc.getElementById('fix-btn').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => window.enWriting.logRead().length === 1);
  const e = window.enWriting.logRead()[0];
  assert.deepEqual({ ...e.kinds }, { '中式英语': 1, '语法': 1 });  // 页面 realm 的对象要先转回宿主再 deep 比
  assert.equal(e.text.length, 400, '节选截 400');
  assert.ok(e.quotes.length === 2 && e.at > 0);
});

test('台账不足 3 篇：点画像只提醒，不打接口不花钱', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  window.enWriting.logPush({ wordCount: 10, errors: [{ quote: 'a', fix: 'b', kind: '语法' }] });
  doc.getElementById('pro-btn').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 1, '只有自动抽题那一次');
  assert.match(doc.getElementById('status').textContent, /只有 1 篇|3 篇/);
});

test('攒满 3 篇后：本地算出句长/简单句率再交给模型，画像渲染出薄弱环节与台阶', async () => {
  const { window, doc, calls } = await boot({
    seedLog: [
      logEntry('I go to school. I like it. The class is fun. I am happy.', { 时态: 2, 语法: 1 }),
      logEntry('He open door. It rain today. We play ball. He is my friend.', { 时态: 3, 拼写: 1 }),
      logEntry('I very like the food. It is good. I eat it fast. My heart filled with joy.', { 中式英语: 1, 表达生硬: 2, 时态: 1 }),
    ],
  });
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('pro-btn').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'profile');
  const st = calls[1].body.stats;
  assert.equal(st.n, 3);
  assert.equal(st.kindTotals['时态'], 6, '跨篇累计');
  assert.ok(st.avgSentenceWords > 0 && st.avgSentenceWords < 12, '短句为主要算出来');
  assert.ok(st.simpleRate > 0.5, '简单句率高');
  assert.equal(st.samples.length, 3);
  await waitFor(() => !doc.getElementById('pro-card').classList.contains('hidden'));
  const html = doc.getElementById('pro-body').innerHTML;
  assert.ok(html.includes('时态单一') && html.includes('证据：3 篇里 2 篇'), '薄弱点+数字证据');
  assert.ok(html.includes('第 1 步') && html.includes('第 2 步'), '台阶感');
  assert.ok(html.includes('I walked home') === false && html.includes('练一句'), 'drill 留白给学生');
  assert.ok(doc.getElementById('pro-body').textContent.includes('下次只练这一件'));
  assert.ok(doc.getElementById('pro-body').textContent.includes('全文没离开这台设备'), '隐私说明要在');
});

test('画像会存一份：重开页面直接看上次诊断，不用重新花钱', async () => {
  const { window, doc } = await boot({ seedProfile: PROFILE });
  await waitFor(() => !doc.getElementById('pro-card').classList.contains('hidden'));
  assert.ok(doc.getElementById('pro-body').textContent.includes('叙事基本全靠一般现在时'));
});

test('清空台账：画像卡收起，提示重新攒', async () => {
  const { window, doc, calls } = await boot({ seedLog: [logEntry('a b c.', { 语法: 1 }), logEntry('d e f.', { 语法: 1 }), logEntry('g h i.', { 语法: 1 })] });
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('pro-btn').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => !doc.getElementById('pro-card').classList.contains('hidden'));
  doc.getElementById('pro-clear').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(window.localStorage.getItem('xixi.en-writing.log.v1'), null);
  assert.ok(doc.getElementById('pro-card').classList.contains('hidden'));
  assert.match(doc.getElementById('status').textContent, /清空|三篇/);
});

test('画像接口挂了：中文报错 + 台账还在（下次能重来）', async () => {
  const { window, doc, calls } = await boot({ fail: true, seedLog: [logEntry('a b c.', { 语法: 1 }), logEntry('d e f.', { 语法: 1 }), logEntry('g h i.', { 语法: 1 })] });
  for (let i = 0; i < 200; i++) { if (calls.length >= 1) break; await new Promise((r) => setTimeout(r, 10)); }
  doc.getElementById('pro-btn').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => doc.getElementById('status').textContent.includes('超时'));
  assert.equal(window.enWriting.logRead().length, 3, '失败不能把台账弄丢');
});


/* ---------- 对某条修改意见的追问 ---------- */

async function openAsk() {
  const b = await boot();
  await waitFor(() => b.doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(b.window, ESSAY);
  b.doc.getElementById('fix-btn').click();
  await waitFor(() => b.calls.length === 2);
  await waitFor(() => b.doc.querySelectorAll('#fb-errors .err-item').length === 2);
  return b;
}

test('每条修改意见旁有「❓ 这条为什么」，点开展开提问面板', async () => {
  const { doc } = await openAsk();
  const first = doc.querySelector('#fb-errors .err-item');
  const qbtn = first.querySelector('button');
  assert.ok(qbtn.textContent.includes('这条为什么'));
  qbtn.click();
  const box = first.querySelector('.ask-box');
  assert.equal(box.style.display, 'block');
  assert.equal(box.querySelectorAll('.qrow button').length, 2, '两个预设问题：再讲讲 / 不服');
  assert.ok(box.querySelector('input'));
});

test('提问送模型：带上这条改法和上下文；答案与例句渲染出来', async () => {
  const { window, doc, calls } = await openAsk();
  const item = doc.querySelector('#fb-errors .err-item');
  item.querySelector('button').click();               // 展开 ❓ 面板
  const box = item.querySelector('.ask-box');
  box.querySelector('.ask-go').click();               // 空输入提交应无动作
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!box.textContent.includes('fully'), '没填问题不该提交');
  box.querySelector('input').value = '为什么加 that';
  box.querySelector('.ask-go').click();
  await waitFor(() => calls.length === 3);
  const req = calls[2].body;
  assert.equal(req.mode, 'ask');
  assert.equal(req.quote, 'I very like the meal');
  assert.equal(req.fix, 'I really liked the meal');
  assert.equal(req.question, '为什么加 that');
  assert.ok(req.essay.includes('noodle place'), '整篇上下文带上');
  await waitFor(() => box.textContent.includes('fully 是副词'));
  assert.ok(box.textContent.includes('came from the intern'), '对照例句');
  assert.ok(!box.textContent.includes('教练认账'), 'confirmed 不出认账章');
});

test('预设「我觉得原句可以这么写」一键就问，答案缓存：同问题不再花钱', async () => {
  const { window, doc, calls } = await openAsk();
  const item = doc.querySelector('#fb-errors .err-item');
  item.querySelector('button').click();
  const box = item.querySelector('.ask-box');
  box.querySelectorAll('.qrow button')[1].click();   // 预设：不服
  await waitFor(() => calls.length === 3);
  assert.match(calls[2].body.question, /原句可以这么写/);
  await waitFor(() => box.textContent.includes('fully 是副词'));
  box.querySelector('input').value = '';
  box.querySelectorAll('.qrow button')[1].click();   // 再点一次同问题
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls.length, 3, '缓存命中不该再打接口');
  assert.equal(window.enWriting.logRead().length, 1, '只有批改那 1 条，追问不添台账');
});

test('教练认账时盖绿章并显示调整后的意见', async () => {
  const { doc } = await openAsk();
  const box = doc.querySelector('#fb-errors .err-item .ask-box');
  window_enWritingRenderAsk(doc, box);
  function window_enWritingRenderAsk(d, b) {
    d.defaultView.enWriting.renderAsk(b, { kind: 'ask', answer: '你说得对，这句其实成立。', verdict: 'revised', revisedFix: '原句可保留', examples: [] });
  }
  assert.ok(box.textContent.includes('教练认账'));
  assert.ok(box.textContent.includes('原句可保留'));
});

test('追问失败：说明白「没答上」，面板不吞错误', async () => {
  const { window, doc } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  typeEssay(window, ESSAY);
  doc.getElementById('fix-btn').click();
  await waitFor(() => doc.querySelectorAll('#fb-errors .err-item').length === 2);
  // 让后续请求都失败
  window.fetch = () => Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: '模型那边挂了' }) });
  const item = doc.querySelector('#fb-errors .err-item');
  item.querySelector('button').click();
  const box = item.querySelector('.ask-box');
  box.querySelector('input').value = '这条到底为什么？理由充分吗';
  box.querySelector('.ask-go').click();
  await waitFor(() => box.textContent.includes('没答上'));
  assert.ok(box.textContent.includes('模型那边挂了'));
});


/* ---------- 中文梗概 → 高质量范本 ---------- */

const SYN = '第一次独立出差赶飞机，航班落地后延误了四个小时，同机舱一位老人把橙子分给每个人，回去以后我把这事讲给同事听，明白了一个道理';

test('📜 看范本：点开卡片；梗概不足 30 字先拦住，不打接口', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('mdl-btn').click();
  assert.ok(!doc.getElementById('mdl-card').classList.contains('hidden'));
  doc.getElementById('mdl-in').value = '飞机延误了';
  doc.getElementById('mdl-go').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 1, '太短不该花钱');
  assert.match(doc.getElementById('mdl-status').textContent, /30 字/);
});

test('生成范本：梗概带过去，标题/词数/中英逐段/可背句都渲染', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('mdl-btn').click();
  doc.getElementById('mdl-in').value = SYN;
  doc.getElementById('mdl-go').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'model');
  assert.equal(calls[1].body.synopsis, SYN);
  await waitFor(() => doc.getElementById('mdl-out').textContent.includes('rainy Thursday'));
  assert.ok(doc.getElementById('mdl-out').textContent.includes('312 词'), '实际词数要说出来');
  assert.ok(doc.getElementById('mdl-out').textContent.includes('事情始于'), '中文对照');
  assert.ok(doc.getElementById('mdl-out').textContent.includes('最值得背'));
  assert.ok(!doc.getElementById('mdl-copyrow').classList.contains('hidden'));
});

test('同一梗概再生成：用本机缓存，不重复花钱', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('mdl-btn').click();
  doc.getElementById('mdl-in').value = SYN;
  doc.getElementById('mdl-go').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => doc.getElementById('mdl-out').textContent.includes('rainy Thursday'));
  doc.getElementById('mdl-go').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 2, '第二次不该打接口');
  assert.match(doc.getElementById('mdl-status').textContent, /本机存的/);
});

test('范本全文复制文本：英文单语与中英对照两种排法', async () => {
  const { window, doc } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  window.enWriting.renderModel(MODEL);
  const en = window.enWriting.modelText(false);
  assert.ok(en.includes('# The Deadline') && en.includes('rainy Thursday') && !en.includes('事情始于'));
  const bi = window.enWriting.modelText(true);
  assert.ok(bi.includes('事情始于') && bi.includes('最值得背'));
});

test('范本生成失败：状态区中文报错，按钮恢复可点', async () => {
  const { window, doc } = await boot({ fail: true });
  for (let i = 0; i < 200; i++) { if (window.enWriting) break; await new Promise((r) => setTimeout(r, 10)); }
  await waitFor(() => doc.getElementById('mdl-card'));
  doc.getElementById('mdl-btn').click();
  doc.getElementById('mdl-in').value = SYN;
  doc.getElementById('mdl-go').click();
  await waitFor(() => doc.getElementById('mdl-status').textContent.includes('超时'));
  assert.equal(doc.getElementById('mdl-go').disabled, false);
});


/* ---------- 范本句级提问 + 表达收藏 ---------- */

async function showModel() {
  const b = await boot();
  await waitFor(() => b.doc.getElementById('t-en').textContent === TOPIC.en);
  b.doc.getElementById('mdl-btn').click();
  b.doc.getElementById('mdl-in').value = SYN;
  b.doc.getElementById('mdl-go').click();
  await waitFor(() => b.calls.length === 2);
  await waitFor(() => b.doc.querySelectorAll('#mdl-out .sent-row').length === 3);
  return b;
}

test('范本逐句成行：每句带 ❓ 和 ⭐；⭐ 入收藏去重，计数说话', async () => {
  const { window, doc } = await showModel();
  assert.equal(doc.querySelectorAll('#mdl-out .sent-row').length, 3, '两段落拆成三句');
  const first = doc.querySelector('#mdl-out .sent-row');
  const stars = first.querySelectorAll('button');
  assert.equal(stars[1].textContent, '⭐');
  stars[1].click();
  assert.equal(stars[1].textContent, '✓ 已收藏');
  assert.equal(window.enWriting.favRead().length, 1);
  stars[1].click();
  assert.equal(stars[1].textContent, '✓ 已在库', '同一句不收两遍');
  assert.equal(window.enWriting.favRead().length, 1);
  assert.equal(doc.getElementById('fav-n').textContent, '1', '入口计数实时');
  // memorable 句也能收
  doc.querySelectorAll('#mdl-out .hl button')[0].click();
  assert.equal(window.enWriting.favRead().length, 2);
});

test('点 ❓ 问「为什么这么用」：mode=why 带原句；答案+口诀渲染；再问吃缓存', async () => {
  const { window, doc, calls } = await showModel();
  const row = doc.querySelector('#mdl-out .sent-row');
  row.querySelector('button').click();                       // 展开提问
  const wbox = row.parentElement.querySelector('.ask-box');
  wbox.querySelectorAll('.qrow button')[0].click();          // 预设：为什么这么用
  await waitFor(() => calls.length === 3);
  assert.equal(calls[2].body.mode, 'why');
  assert.ok(calls[2].body.sentence.includes('rainy Thursday'), '把哪句发给了模型');
  assert.equal(calls[2].body.question, '为什么这么用');
  await waitFor(() => wbox.textContent.includes('口语老话'));
  assert.ok(wbox.textContent.includes('口诀：'), '口诀单独一行');
  assert.ok(wbox.textContent.includes('Try the back streets'), '迁移例句');
  wbox.querySelectorAll('.qrow button')[0].click();          // 同问题再点
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 3, '缓存命中不再花钱');
});

test('📚 收藏面板：自主编辑笔记分类落盘；✕ 删除生效', async () => {
  const { window, doc } = await showModel();
  doc.querySelectorAll('#mdl-out .sent-row button')[1].click();   // 收藏第一句
  doc.getElementById('fav-btn').click();
  assert.ok(!doc.getElementById('fav-card').classList.contains('hidden'));
  const item = doc.querySelector('#fav-list .fav-item');
  assert.ok(item.textContent.includes('rainy Thursday'));
  const inputs = item.querySelectorAll('input');
  inputs[0].value = '开会前暖场能用'; inputs[0].dispatchEvent(new window.Event('blur', { bubbles: true }));
  inputs[1].value = '开头'; inputs[1].dispatchEvent(new window.Event('blur', { bubbles: true }));
  const saved = window.enWriting.favRead()[0];
  assert.equal(saved.note, '开会前暖场能用');
  assert.equal(saved.cat, '开头');
  assert.ok(window.enWriting.favText().includes('## 开头'), '复制文本按分类分组');
  item.querySelectorAll('button')[item.querySelectorAll('button').length - 1].click();  // ✕ 删除
  assert.equal(window.enWriting.favRead().length, 0);
});

test('🔁 同类推荐：每条带真实例句与差异说明；推荐里的句子也能收', async () => {
  const { window, doc, calls } = await showModel();
  doc.querySelectorAll('#mdl-out .sent-row button')[1].click();
  doc.getElementById('fav-btn').click();
  const item = doc.querySelector('#fav-list .fav-item');
  const recBtn = [...item.querySelectorAll('button')].find((b) => b.textContent.includes('同类'));
  recBtn.click();
  await waitFor(() => calls.length === 3);
  assert.equal(calls[2].body.mode, 'rec');
  assert.ok(calls[2].body.expr.includes('rainy Thursday'), '围绕收藏那句推');
  await waitFor(() => item.textContent.includes('The part that sticks'));
  assert.ok(item.textContent.includes('例：'), '每条有真实例句');
  assert.ok(item.textContent.includes('差异：'), '说清和原句差在哪');
  const grab = [...item.querySelectorAll('button')].find((b) => b.textContent.includes('也收这条'));
  grab.click();
  assert.equal(window.enWriting.favRead().length, 2);
  recBtn.click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 3, '同类推荐缓存：不重复花钱');
});

test('why 失败：没答上直说，按钮恢复', async () => {
  const { window, doc } = await boot({ fail: true });
  for (let i = 0; i < 200; i++) { if (window.enWriting) break; await new Promise((r) => setTimeout(r, 10)); }
  doc.getElementById('mdl-btn').click();
  doc.getElementById('mdl-in').value = SYN;
  doc.getElementById('mdl-go').click();
  await new Promise((r) => setTimeout(r, 100));               // 范本失败，手动塞一份渲染
  window.enWriting.renderModel(MODEL);
  const row = doc.querySelector('#mdl-out .sent-row');
  row.querySelector('button').click();
  const wbox = row.parentElement.querySelector('.ask-box');
  wbox.querySelectorAll('.qrow button')[0].click();
  await waitFor(() => wbox.textContent.includes('没答上'));
});

/* ---------- 划词收藏 ---------- */

function pickBtn(pick, label) {
  return [...pick.querySelectorAll('button')].find((b) => b.textContent.includes(label));
}

function fakeSelect(window, node, text) {
  let shown = null;
  window.getSelection = () => ({
    rangeCount: 1,
    anchorNode: node,
    toString: () => text,
    removeAllRanges() {},
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 120, top: 300, bottom: 322, width: 80 }) }),
  });
  return shown;
}

test('选中范例句里的短语 → 浮出 ⭐ 按钮 → 点它入库存原句', async () => {
  const { window, doc } = await showModel();
  const txtNode = doc.querySelector('#mdl-out .sent-row .txt').firstChild;
  fakeSelect(window, txtNode, 'on a rainy Thursday');
  window.enWriting.onSelMaybe();
  const pick = doc.querySelector('.pick');
  assert.ok(pick && pick.classList.contains('show'), '浮动收藏按钮出现');
  assert.ok(pick.textContent.includes('on a rainy'), '🔍 按钮上写查的是啥（超长截断）');
  pickBtn(pick, '⭐').click();
  const favs = window.enWriting.favRead();
  assert.equal(favs.length, 1);
  assert.equal(favs[0].en, 'on a rainy Thursday', '存的是选中的短语，不是整句');
  assert.ok(favs[0].ctx.startsWith('It started on a rainy Thursday'), '自动带上原句语境');
  assert.ok(favs[0].from.includes('范本'), '记来源');
  assert.ok(!pick.classList.contains('show'), '点完收起');
  assert.equal(doc.getElementById('fav-n').textContent, '1');
});

test('同一短语再选再收：去重；重复显示原句的逻辑不再触发', async () => {
  const { window, doc } = await showModel();
  const txtNode = doc.querySelector('#mdl-out .sent-row .txt').firstChild;
  fakeSelect(window, txtNode, 'made a simple list');
  window.enWriting.onSelMaybe();
  pickBtn(doc.querySelector('.pick'), '⭐').click();
  fakeSelect(window, txtNode, 'made  a  simple  list');   // 空白不同也算同一句
  window.enWriting.onSelMaybe();
  pickBtn(doc.querySelector('.pick'), '⭐').click();
  assert.equal(window.enWriting.favRead().length, 1, '同短语去重');
});

test('解析/推荐区也认；正文区外不弹；纯中文不弹', async () => {
  const { window, doc } = await showModel();
  // 提问解析里的短语
  const row = doc.querySelector('#mdl-out .sent-row');
  row.querySelector('button').click();
  const wbox = row.parentElement.querySelector('.ask-box');
  wbox.querySelectorAll('.qrow button')[0].click();
  await waitFor(() => wbox.textContent.includes('口语老话'));
  const ansNode = wbox.querySelector('.ask-a').firstChild;
  fakeSelect(window, ansNode, 'being peeled');
  window.enWriting.onSelMaybe();
  assert.ok(doc.querySelector('.pick').classList.contains('show'), '解析文字里可选');
  pickBtn(doc.querySelector('.pick'), '⭐').click();
  assert.equal(window.enWriting.favRead()[0].en, 'being peeled');
  // 正文区外（顶部标语）不弹
  window.enWriting.hidePick();
  fakeSelect(window, doc.getElementById('mdl-in'), 'write it anyway');
  window.enWriting.onSelMaybe();
  assert.ok(!doc.querySelector('.pick').classList.contains('show'), '区外不弹');
  // 纯中文不弹
  fakeSelect(window, doc.querySelector('#mdl-out .sent-row .txt').firstChild, '下雨的周四');
  window.enWriting.onSelMaybe();
  assert.ok(!doc.querySelector('.pick').classList.contains('show'), '没英文不弹');
});

test('收藏卡片显示短语的原句（方向：短语≠原句才显示）', async () => {
  const { window, doc } = await showModel();
  const txtNode = doc.querySelector('#mdl-out .sent-row .txt').firstChild;
  fakeSelect(window, txtNode, 'at Gate 27');
  window.enWriting.onSelMaybe();
  pickBtn(doc.querySelector('.pick'), '⭐').click();
  doc.getElementById('fav-btn').click();
  const item = doc.querySelector('#fav-list .fav-item');
  assert.ok(item.textContent.includes('原句：It started'), '短语收藏带原句');
  assert.ok(window.enWriting.favText().includes('原句：'), '复制文本也带');
});

/* ---------- 词义解释 ---------- */

test('划词条升级：⭐收藏 + 📖词义 两个按钮；点词义 mode=word 带选中短语与原句', async () => {
  const { window, doc, calls } = await showModel();
  const txtNode = doc.querySelector('#mdl-out .sent-row .txt').firstChild;
  fakeSelect(window, txtNode, 'made a simple list');
  window.enWriting.onSelMaybe();
  const pick = doc.querySelector('.pick');
  const btns = [...pick.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(btns.some((x) => x.includes('🔍')) && btns.some((x) => x.includes('🧾')) && btns.some((x) => x.includes('⭐')), '查询/语法/收藏三键');
  pickBtn(pick, '🔍').click();
  await waitFor(() => calls.length === 3);
  assert.equal(calls[2].body.mode, 'word');
  assert.equal(calls[2].body.word, 'made a simple list');
  assert.ok(calls[2].body.sentence.includes('It started on a rainy Thursday'), '带选中时所在原句');
  await waitFor(() => doc.getElementById('word-body').textContent.includes('make a decision'));
  const wb = doc.getElementById('word-body');
  assert.ok(wb.textContent.includes('a choice you make'), '简单英文释义');
  assert.ok(wb.textContent.includes('verb + decision'), 'Ozdic 式分组');
  assert.ok(wb.textContent.includes('只配 make'), '中国学习者坑');
});

test('词义独立查询 + 缓存：同词二查不花钱；搭配行 ⭐ 直接进收藏', async () => {
  const { window, doc, calls } = await showModel();
  doc.getElementById('word-in').value = 'decision';
  doc.getElementById('word-go').click();
  await waitFor(() => calls.length === 3);
  assert.equal(calls[2].body.word, 'decision');
  await waitFor(() => doc.getElementById('word-body').textContent.includes('tough decision'));
  doc.getElementById('word-in').value = 'DECISION';   // 大小写归一吃缓存
  doc.getElementById('word-go').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 3, '同词不重查');
  const star = doc.querySelector('#word-body .wd-item button');
  star.click();
  const favs = window.enWriting.favRead();
  assert.equal(favs.length, 1);
  assert.equal(favs[0].en, 'make a decision');
  assert.ok(favs[0].from.includes('词义'), '来源标了查的词');
  assert.ok(favs[0].ctx.includes('Take your time'), '例句进语境');
});

test('词义失败：没查上直说 + 重试按钮', async () => {
  const { window, doc } = await boot({ fail: true });
  for (let i = 0; i < 200; i++) { if (window.enWriting) break; await new Promise((r) => setTimeout(r, 10)); }
  await window.enWriting.wordAsk('decision');
  const wb = doc.getElementById('word-body');
  assert.ok(wb.textContent.includes('没查上'), wb.textContent.slice(0, 80));
  assert.ok([...wb.querySelectorAll('button')].some((b) => b.textContent === '重试'));
});

/* ---------- 回译 ---------- */

test('🔁 回译：随机经典篇 → 中文提示 + 原文藏好；写够才提交，mode=bt 带 orig/mine', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('bt-btn').click();
  assert.ok(!doc.getElementById('bt-card').classList.contains('hidden'));
  doc.getElementById('bt-rand').click();
  assert.ok(!doc.getElementById('bt-stage').classList.contains('hidden'), '材料摆出来了');
  const zhText = doc.getElementById('bt-zh').textContent;
  assert.ok(zhText.length > 30, '中文提示到位');
  doc.getElementById('bt-mine').value = 'too short';
  doc.getElementById('bt-go').click();
  assert.ok(doc.getElementById('bt-status').textContent.includes('40'), '写太少不给比');
  assert.equal(calls.length, 1, '没浪费钱');
  doc.getElementById('bt-mine').value = 'Last month a heavy rain made us stay at home all the weekend, we were very bored but nobody said it.';
  doc.getElementById('bt-go').click();
  await waitFor(() => calls.length === 2);
  assert.equal(calls[1].body.mode, 'bt');
  assert.ok(calls[1].body.orig.length > 60 && /[A-Za-z]/.test(calls[1].body.orig), '原文（标准答案）发给模型了');
  assert.equal(calls[1].body.mine.length, 'Last month a heavy rain made us stay at home all the weekend, we were very bored but nobody said it.'.length);
  assert.ok(calls[1].body.zh.includes('去年') || calls[1].body.zh.length > 20, '中文提示也带上');
});

test('回译结果：得分/差异/语块三芯片 + 逐处差异 + 语块卡片；⭐ 收语块进收藏', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('bt-btn').click();
  doc.getElementById('bt-rand').click();
  doc.getElementById('bt-mine').value = 'Last month a heavy rain made us stay at home all the weekend, we were very bored but nobody said it out.';
  doc.getElementById('bt-go').click();
  await waitFor(() => doc.querySelectorAll('#bt-out .bt-chunk').length === 2);
  const out = doc.getElementById('bt-out');
  assert.ok(out.textContent.includes('回译得分 74'), '分数芯片');
  assert.ok(out.textContent.includes('表达差异 1 处') && out.textContent.includes('可背语块 2 个'));
  assert.ok(out.textContent.includes('× we were stopped by the storm'), '你写的');
  assert.ok(out.textContent.includes('√ the storm kept us indoors'), '原文对照');
  const chunk0 = doc.querySelector('#bt-out .bt-chunk');
  assert.ok(chunk0.textContent.includes('keep somebody indoors') && chunk0.textContent.includes('动词句') && chunk0.textContent.includes('The heat kept us indoors'));
  chunk0.querySelector('button').click();
  assert.equal(window.enWriting.favRead()[0].en, 'keep somebody indoors');
  assert.ok(window.enWriting.favRead()[0].from.includes('回译'));
});

test('回译缓存：同原文同译文再点不重跑；偷看原文可收回', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('bt-btn').click();
  doc.getElementById('bt-rand').click();
  const src = window.enWriting.btSel();
  const mine = 'Last month a heavy rain made us stay at home all the weekend; nobody complained about it at all.';
  await window.enWriting.btGo ? null : null;
  doc.getElementById('bt-mine').value = mine;
  doc.getElementById('bt-go').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => doc.querySelectorAll('#bt-out .bt-chunk').length === 2);   // 等首答落缓存
  doc.getElementById('bt-mine').value = mine;
  doc.getElementById('bt-go').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 2, '同译文吃缓存');
  const peek = doc.getElementById('bt-peek');
  peek.click();
  assert.equal(doc.getElementById('bt-zh').textContent, window.enWriting.btSel().orig, '偷看到原文');
  peek.click();
  assert.ok(!/[A-Za-z]/.test(doc.getElementById('bt-zh').textContent), '收回又变回中文');
});

test('范本段可作回译材料；自己贴的校验后也能开场', async () => {
  const { window, doc, calls } = await showModel();
  doc.getElementById('bt-btn').click();
  const sel = doc.getElementById('bt-model-sel');
  assert.ok(sel.options.length >= 3, '范本够长的段进了下拉: ' + sel.options.length);
  sel.value = '1';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(window.enWriting.btSel().orig.includes('That night I walked home'), '第二段成为标准答案');
  doc.getElementById('bt-paste-btn').click();
  doc.getElementById('bt-paste-en').value = '太短';
  doc.getElementById('bt-paste-ok').click();
  assert.ok(doc.getElementById('bt-status').classList.contains('err'), '原文太短拒了');
  doc.getElementById('bt-paste-zh').value = '周五下午我们按时交付了，没有欢呼也没有通宵。';
  doc.getElementById('bt-paste-en').value = 'Two weeks later we shipped it on an ordinary Friday afternoon, no shouting, no all-nighter, which felt like its own kind of victory.';
  doc.getElementById('bt-paste-ok').click();
  assert.equal(window.enWriting.btSel().src, '自己贴的');
});

/* ---------- 布局调整 + 全局查询条（主人 2026-11-16 06:26） ---------- */

test('进门就是回译：第一张卡是回译、材料自动备好；照主题写降为附加', async () => {
  const { window, doc } = await boot();
  const cards = [...doc.querySelectorAll('section.card')];
  assert.equal(cards[0].id, 'bt-card', '回译卡排第一');
  assert.ok(!cards[0].classList.contains('hidden'), '默认就摊开');
  await waitFor(() => doc.getElementById('bt-zh').textContent.length > 30);
  assert.ok(!doc.getElementById('bt-stage').classList.contains('hidden'), '一篇材料已备好');
  assert.ok(doc.getElementById('main-card').textContent.includes('附加'), '主题写作标成附加');
  assert.ok(doc.getElementById('fav-btn') && doc.getElementById('word-btn'), '收藏/查询台入口在全局');
});

test('任意模块划词三键齐：tips 里选短语点 🧾 → mode=why 带整句，查询台出语法解答', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  doc.getElementById('tips-btn').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => doc.getElementById('tips-body').textContent.includes('out of nowhere'));
  const tipsEn = doc.querySelector('#tips-body .ph');
  fakeSelect(window, tipsEn.firstChild, 'out of nowhere');
  window.enWriting.onSelMaybe();
  const pick = doc.querySelector('.pick');
  assert.ok(pick.classList.contains('show'), '表达帮助里也能划词');
  assert.equal([...pick.querySelectorAll('button')].length, 3);
  pickBtn(pick, '🧾').click();
  await waitFor(() => calls.length === 3);
  assert.equal(calls[2].body.mode, 'why');
  assert.equal(calls[2].body.question, '为什么这里要这么用？');
  assert.ok(calls[2].body.sentence.length >= 10, '把选中处所在整句发过去了');
  await waitFor(() => doc.getElementById('grammar-body').textContent.includes('口语老话'));
  assert.ok(doc.getElementById('grammar-body').textContent.includes('口诀'), '口诀照给');
  assert.ok(doc.getElementById('grammar-body').textContent.includes('Try the back streets'), '换场景例句');
});

test('语法查询吃缓存：同句同问二点不花钱；自己作文 textarea 里划不弹', async () => {
  const { window, doc, calls } = await boot();
  await waitFor(() => doc.getElementById('t-en').textContent === TOPIC.en);
  const tagNode = doc.getElementById('t-en');
  fakeSelect(window, tagNode.firstChild, 'did not go as planned');
  window.enWriting.onSelMaybe();
  pickBtn(doc.querySelector('.pick'), '🧾').click();
  await waitFor(() => calls.length === 2);
  await waitFor(() => doc.getElementById('grammar-body').textContent.includes('口语老话'));   // 等首答落缓存
  fakeSelect(window, tagNode.firstChild, 'did not go as planned');
  window.enWriting.onSelMaybe();
  pickBtn(doc.querySelector('.pick'), '🧾').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.length, 2, '缓存命中不再花钱');
  const essay = doc.getElementById('essay');
  fakeSelect(window, essay, 'my own sentence here');
  window.enWriting.onSelMaybe();
  assert.ok(!doc.querySelector('.pick').classList.contains('show'), '输入框里不弹');
});
