// 场景英语提示页的界面用例：mock 掉 /api/scene-guide，验证渲染、讲解（含类似表达）、缓存、报错都不撒谎。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');

const PAGE = path.resolve(import.meta.dirname, '..', 'public', 'tools', 'scene-english', 'index.html');

const DIALOGUE = {
  kind: 'dialogue',
  title: '和朋友聊炖肉',
  scene: 'Chatting with a friend about braising meat',
  lines: [
    { who: 'A', en: 'I’ve been trying to get the braised beef right.', zh: '我最近一直在琢磨红烧牛腩。' },
    { who: 'B', en: 'Pat it dry first, then sear it.', zh: '先把表面吸干，再煎。' },
    { who: 'A', en: 'Go easy on the spices?', zh: '香料少放点？' },
  ],
  tips: ['sear 是高温快煎，不是 fry'],
};

const GUIDE = {
  kind: 'guide',
  sections: [
    { title: '预处理', items: [
      { zh: '吸干水分', en: 'pat dry', note: '煎肉不溅油的关键', example: { en: 'Pat the steak dry before it hits the pan.', zh: '下锅前先把牛排表面吸干。' } },
      { zh: '焯水', en: 'blanch', note: '', example: { en: 'Blanch the ribs first.', zh: '排骨先焯水。' } },
    ] },
    { title: '火候', items: [{ zh: '小火微沸', en: 'simmer', note: '别大火猛滚', example: { en: 'Let it simmer for an hour.', zh: '小火炖一个小时。' } }] },
  ],
  patterns: [
    { en: 'Do you have any tips for…?', zh: '你有什么窍门吗？' },
    { en: 'How long do you simmer it for?', zh: '你小火炖多久？' },
  ],
};

const EXPLAIN = {
  kind: 'explain',
  phrase: 'been meaning',
  asUsed: 'have been meaning to do sth',
  pattern: 'have been meaning to do sth',
  meaning: '一直想做（但还没做成）',
  structure: '现在完成进行时：have been + doing',
  why: '强调从过去一直拖到现在，不是「打算」',
  examples: [
    { en: "I've been meaning to call him back.", zh: '我一直想给他回电话。' },
    { en: "She's been meaning to try that place.", zh: '她一直想去那家店。' },
  ],
  similar: [
    { en: 'I want to get that off my chest.', zh: '我想把这事说出来痛快痛快。', note: '更直接，没有拖了很久的意思' },
    { en: "It's been on my mind for weeks.", zh: '这事我心里憋了好几周了。', note: '近结构，语气更轻' },
  ],
  caution: '别写成 I am meaning to do',
  category: '职场闲聊',
  sentence: "Hey, you got a minute? I've been meaning to vent about work.",
  scene: '跟同事吐槽工作',
};

async function boot(opts = {}) {
  const calls = [];
  const spk = { queue: [], canceled: 0 };
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
      window.fetch = (url, init) => {
        // 页面进门的健康探测（GET /api/scene-guide/health）不计入“生成次数”
        if (!init) {
          health.hits += 1;
          if (!health.ok) return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) });
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, model: 'fake', startedAt: new Date().toISOString() }) });
        }
        const body = init && init.body ? JSON.parse(init.body) : {};
        calls.push({ url, body });
        if (opts.fail === 405) return Promise.resolve({ ok: false, status: 405, text: 'Method Not Allowed', json: async () => { throw new Error('no json'); } });
        if (opts.fail) return Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: '生成超时了，请点重试' }) });
        if (body.mode === 'explain') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: EXPLAIN }) });
        const data = body.mode === 'more' ? GUIDE : DIALOGUE;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
      };
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.alert = () => {};
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      window.speechSynthesis = {
        speak(u) {
          spk.queue.push(u);
          setTimeout(() => { if (u.onend) u.onend(); }, 3);
        },
        cancel() { spk.canceled += 1; },
        getVoices() { return []; },
      };
    },
  });
  const { window } = dom;
  // 等页面自己绑完事件（示例 chips 渲染出来就算绑好了），否则点击会被吞掉
  for (let i = 0; i < 100; i++) {
    if (window.sceneEnglish && window.document.querySelectorAll('#examples .chip').length) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!window.sceneEnglish || !window.document.querySelectorAll('#examples .chip').length) {
    throw new Error('页面没完成初始化（事件未绑定）');
  }
  return { dom, window, calls, health, spk };
}

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function generate(window, calls, scene) {
  window.document.getElementById('scene').value = scene;
  window.document.getElementById('go').click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.dialogue; i++) await wait(20);
  return calls;
}

test('页面骨架：输入框、示例 chips（只留 2 个）、生成按钮都在', async () => {
  const { window } = await boot();
  const doc = window.document;
  assert.ok(doc.getElementById('scene'), '要有场景输入框');
  assert.equal(doc.querySelectorAll('#examples .chip').length, 2, '推荐场景只留 2 个，界面别太乱');
  assert.equal(doc.getElementById('more'), null, '「更多表达」独立模块已按主人要求去掉');
  assert.equal(doc.getElementById('guide-card'), null, '语料面板也应该没了');
  assert.ok(doc.querySelector('footer.foot').textContent.includes('不要把运单'), '要写清楚别放业务数据');
});

test('生成对话：中英对照气泡、你说/对方标注、教练提示都渲染出来', async () => {
  const { window, calls } = await boot({});
  await generate(window, calls, '和朋友聊炖肉');
  const doc = window.document;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/scene-guide');
  assert.equal(calls[0].body.mode, 'dialogue');
  assert.equal(calls[0].body.scene, '和朋友聊炖肉');
  assert.equal(doc.getElementById('dialogue-card').classList.contains('hidden'), false);
  assert.match(doc.getElementById('d-title').textContent, /和朋友聊炖肉/);
  const turns = [...doc.querySelectorAll('#talk .turn')];
  assert.equal(turns.length, 3, '三句话要三个气泡');
  assert.ok(turns[0].classList.contains('A'), 'A 是自己');
  assert.match(turns[0].querySelector('.who').textContent, /你（A）/);
  assert.match(turns[1].querySelector('.en').textContent, /Pat it dry/);
  assert.match(turns[1].querySelector('.zh').textContent, /吸干/);
  assert.equal(doc.querySelectorAll('#tips-box li').length, 1, '教练提示要显示');
  assert.match(doc.getElementById('status').textContent, /问用法/, '生成完的提示要指向选词讲解');
});

test('讲解自带「也能这么说」：3~4 条类似表达贴在用法下面，还能选中继续问', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '跟同事吐槽工作');
  await window.sceneEnglish.explain('been meaning', EXPLAIN.sentence, '');
  await wait(40);
  const doc = window.document;
  const simBox = [...doc.querySelectorAll('#x-body .xex')].find((b) => /也能这么说/.test(b.textContent));
  assert.ok(simBox, '讲解卡里要有「也能这么说」段');
  const lines = simBox.querySelectorAll('.ex');
  assert.equal(lines.length, 2, 'fixture 给 2 条就渲染 2 条');
  assert.match(lines[0].querySelector('.en').textContent, /off my chest/);
  assert.match(lines[0].querySelector('.zh').textContent, /更直接/, 'note 要拼在中文后面');
  // 讲解卡里的英文也允许选中再问（选词逻辑不挑位置，只认 .en）
  const en = lines[1].querySelector('.en');
  const range = doc.createRange();
  range.setStart(en.firstChild, 0);
  range.setEnd(en.firstChild, 8);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  window.sceneEnglish.onSelectionMaybe();
  const pick = doc.getElementById('pick');
  assert.ok(pick && pick.classList.contains('show'), '讲解里的类似表达选中后也要能再问');
  sel.removeAllRanges();
});


test('同场景重复点「生成」走本地缓存，不再花钱；「换一批」才重新请求', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '缓存测试场景');
  assert.equal(calls.length, 1);
  window.document.getElementById('go').click();
  await wait(60);
  assert.equal(calls.length, 1, '同场景本地已有结果，不该再打接口');
  assert.match(window.document.getElementById('status').textContent, /之前生成过/);

  window.document.getElementById('redo').click();
  for (let i = 0; i < 100 && calls.length < 2; i++) await wait(20);
  assert.equal(calls.length, 2, '换一批要真的重新生成');
  assert.equal(calls[1].body.fresh, true, '要带上 fresh 标记');
});

test('接口报错时给中文提示，不把用户晾着', async () => {
  const { window, calls } = await boot({ fail: true });
  await generate(window, calls, '会失败的场景');
  const st = window.document.getElementById('status');
  assert.match(st.textContent, /生成超时/, '要把服务端的中文错误显示出来');
  assert.equal(st.className.includes('err'), true, '要标成错误态');
  assert.equal(window.document.getElementById('go').disabled, false, '按钮要恢复可点');
});

test('隐藏中文只影响显示，复制/下载出来的文本仍然中英齐全', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '复制测试场景');
  const trans = window.document.getElementById('trans');
  trans.click();
  assert.equal(window.document.body.classList.contains('notrans'), true);
  trans.click();
  assert.equal(window.document.body.classList.contains('notrans'), false);

  const txt = window.sceneEnglish.dialogueText();
  assert.match(txt, /# 和朋友聊炖肉/);
  assert.match(txt, /A（你）: I’ve been trying/);
  assert.match(txt, /我最近一直在琢磨/);
  assert.match(txt, /教练提示/);

  await window.sceneEnglish.explain('been meaning', EXPLAIN.sentence, '');
  await wait(40);
  const g = window.sceneEnglish.explainText();
  assert.match(g, /【have been meaning to do sth】在这个句子里/);
  assert.match(g, /也能这么说：I want to get that off my chest\. \|? ?/);
  assert.match(g, /也能这么说：It's been on my mind for weeks\. /);
});

test('历史记录写进 localStorage，点一条能直接调回上次的结果', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '历史测试场景');
  const saved = JSON.parse(window.localStorage.getItem('xixi.scene-english.v1'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].scene, '历史测试场景');
  assert.ok(saved[0].dialogue.lines.length === 3, '对话要存下来');

  // 模拟“换了个场景”后再点历史：先清掉当前渲染与状态
  window.sceneEnglish.state.dialogue = null;
  window.document.getElementById('talk').innerHTML = '';
  window.document.getElementById('dialogue-card').classList.add('hidden');
  window.document.getElementById('history').children[0].click();
  await wait(40);
  assert.equal(window.document.querySelectorAll('#talk .turn').length, 3, '点历史应直接回显，不重新生成');
  assert.equal(calls.length, 1, '调历史不应再打接口');
});

test('进门先探一次接口：服务不在就当场说，不等主人打完字才报错', async () => {
  const { window, calls, health } = await boot({});
  await wait(60);
  assert.equal(health.hits, 1, '页面加载应探测一次 /health');
  assert.equal(calls.length, 0, '探测不该算成生成请求');
  assert.doesNotMatch(window.document.getElementById('status').textContent, /连不上/, '服务在就别吓人');

  const down = await boot({ healthOk: false });
  await wait(60);
  assert.match(down.window.document.getElementById('status').textContent, /连不上/, '服务连不上要立刻提示');
  assert.equal(down.calls.length, 0, '提示本身不烧额度');
  down.dom.window.close();
});

test('打到旧进程（HTTP 405）：说清是接口没生效，并给「重试」按钮', async () => {
  const { window, calls } = await boot({ fail: 405 });
  window.document.getElementById('scene').value = '旧接口场景';
  window.document.getElementById('go').click();
  for (let i = 0; i < 100 && !/没生效/.test(window.document.getElementById('status').textContent); i++) await wait(20);
  const st = window.document.getElementById('status');
  assert.match(st.textContent, /生成接口没生效（HTTP 405）/, '要直说是旧服务');
  assert.match(st.textContent, /重试/, '要给重试出路');
  assert.equal(st.className, 'status err');

  const retry = window.document.getElementById('retry');
  assert.ok(retry, '重试按钮要在');
  retry.click();
  for (let i = 0; i < 100 && calls.length < 2; i++) await wait(20);
  assert.equal(calls.length, 2, '点重试要真的重发同一笔请求');
  assert.equal(calls[1].body.scene, '旧接口场景', '重试保留原场景');
});

test('生成失败时也给出「重试」，点一下接着上次场景继续', async () => {
  const { window, calls } = await boot({ fail: true });
  window.document.getElementById('scene').value = '超时场景';
  window.document.getElementById('go').click();
  for (let i = 0; i < 100 && !window.document.getElementById('retry'); i++) await wait(20);
  assert.match(window.document.getElementById('status').textContent, /生成超时了/);
  window.document.getElementById('retry').click();
  for (let i = 0; i < 100 && calls.length < 2; i++) await wait(20);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.scene, '超时场景');
});

/* ---------- 选词讲解 ---------- */

// 在第一个气泡的英文里选中一段文字，模拟用户拖选/长按（按内容找位置，不硬写偏移）
function selectInFirstBubble(window, want) {
  const en = window.document.querySelector('#talk .turn .en');
  const node = en.firstChild;
  const text = String(node.nodeValue);
  const from = text.indexOf(want);
  assert.ok(from >= 0, `第一句里要有「${want}」才能测选词，实际：${text}`);
  const range = window.document.createRange();
  range.setStart(node, from);
  range.setEnd(node, from + want.length);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return String(sel.toString());
}

test('选中对话里的词 →「讲解」按钮出现 → 点开给出本句用法', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '跟同事吐槽工作');
  const picked = selectInFirstBubble(window, 'been trying');
  window.sceneEnglish.onSelectionMaybe();
  const pill = window.document.getElementById('pick');
  assert.ok(pill, '讲解按钮要已创建');
  assert.ok(pill.classList.contains('show'), '选中句子里的词要浮出按钮');
  assert.match(pill.textContent, /讲解/, `按钮文案要说明干什么：${pill.textContent}`);
  assert.equal(picked, 'been trying', '选区应落在英文句内');

  pill.click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.explain; i++) await wait(20);
  const doc = window.document;
  assert.equal(doc.getElementById('explain-card').classList.contains('hidden'), false, '讲解卡要出现');
  assert.match(doc.getElementById('x-title').textContent, /have been meaning to do sth/, '标题用补全后的搭配');
  assert.match(doc.querySelector('#x-body .xp').textContent, /have been meaning to do sth/, '结构式做成醒目标签');
  assert.match(doc.getElementById('x-body').textContent, /现在完成进行时/, '语法结构');
  assert.match(doc.getElementById('x-body').textContent, /一直想做/, '在本句里的意思');
  assert.equal(doc.querySelectorAll('#x-body .xex .ex').length, 4, '2 条例句 + 2 条类似表达（都在 .xex 里）');
  assert.equal(doc.querySelectorAll('#x-body mark').length, 1, '原句里要把选中的词标出来');

  const last = calls[calls.length - 1];
  assert.equal(last.body.mode, 'explain', '请求走 explain');
  assert.equal(last.body.phrase, picked.trim());
  assert.match(last.body.sentence, /braised beef/, '整句要带过去（不是只带选中的词）');
  assert.match(window.sceneEnglish.explainText(), /用法：have been meaning to do sth/);
});

test('同一个词问第二次走本地缓存，不再花钱', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '缓存讲解场景');
  selectInFirstBubble(window, 'been trying');
  window.sceneEnglish.onSelectionMaybe();
  window.document.getElementById('pick').click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.explain; i++) await wait(20);
  const before = calls.filter((c) => c.body.mode === 'explain').length;
  assert.equal(before, 1);

  await window.sceneEnglish.explain(calls[calls.length - 1].body.phrase, calls[calls.length - 1].body.sentence, '');
  await wait(40);
  const after = calls.filter((c) => c.body.mode === 'explain').length;
  assert.equal(after, before, '第二次不该再打接口');
  assert.match(window.document.getElementById('x-status').textContent, /之前问过/);
  assert.ok(window.document.getElementById('x-body').textContent.length > 20, '缓存的内容照样渲染');
});

test('选的不是句子（比如顶部说明文字）不要浮出讲解按钮', async () => {
  const { window } = await boot();
  const sub = window.document.querySelector('.sub');
  const range = window.document.createRange();
  range.setStart(sub.firstChild, 0);
  range.setEnd(sub.firstChild, 6);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  window.sceneEnglish.onSelectionMaybe();
  const pill = window.document.getElementById('pick');
  assert.ok(!pill || !pill.classList.contains('show'), '非句子区域不该冒按钮');


  // 选中太长（>60 字）也不冒，避免把整段话当词去问
  await generate(window, [], '长选区场景');
  const en = window.document.querySelector('#talk .turn .en');
  const r2 = window.document.createRange();
  r2.setStart(en.firstChild, 0);
  r2.setEnd(en.firstChild, String(en.firstChild.nodeValue).length);
  const sel2 = window.getSelection();
  sel2.removeAllRanges();
  sel2.addRange(r2);
  window.sceneEnglish.onSelectionMaybe();
  const pill2 = window.document.getElementById('pick');
  const whole = String(sel2.toString());
  if (whole.length > 60) {
    assert.ok(!pill2.classList.contains('show'), '整句太长不该冒讲解按钮');
  } else {
    assert.ok(pill2.classList.contains('show'), '短句（≤60 字）应该冒按钮');
  }
});

test('讲解失败时把服务的中文错误显示在讲解卡里，不静默', async () => {
  const { window } = await boot({ fail: true });
  const d = await window.sceneEnglish.explain('simmer', 'Let it simmer for an hour.', '小火炖');
  assert.equal(d, null);
  const st = window.document.getElementById('x-status');
  assert.equal(st.className, 'status err');
  assert.match(st.textContent, /生成超时/, '要把服务端说的中文原样给主人看');
});

/* ---------- 生词本 ---------- */

async function explainOnce(window) {
  await window.sceneEnglish.explain('been meaning', "Hey, you got a minute? I've been meaning to vent about work.", '');
  await wait(40);
}

test('讲解过的词自动进生词本，按模型给的分类归组', async () => {
  const { window } = await boot();
  await generate(window, [], '跟同事吐槽工作');
  await explainOnce(window);
  const book = window.sceneEnglish.loadBook();
  assert.equal(book.length, 1, '讲解一次收一个');
  assert.equal(book[0].cat, '职场闲聊', '分类用讲解时模型给的');
  assert.equal(book[0].asUsed, 'have been meaning to do sth');
  assert.ok(book[0].examples.length >= 1, '例句要带进本里');

  window.document.getElementById('book-btn').click();
  const doc = window.document;
  assert.equal(doc.getElementById('book-card').classList.contains('hidden'), false);
  assert.match(doc.getElementById('book-n').textContent, /\(1\)/, '按钮上要显示条数');
  assert.match(doc.querySelector('#book-body summary').textContent, /职场闲聊/);
  assert.match(doc.querySelector('#book-body .item .term').textContent, /have been meaning to do sth/);
  assert.match(doc.getElementById('x-status').textContent, /已收进生词本/, '讲解完要告诉主人收哪了');

  // 同一个词再讲一次不重复收
  await explainOnce(window);
  assert.equal(window.sceneEnglish.loadBook().length, 1, '同词去重');
});

test('生词本能改分类、新建分类、标掌握、搜索筛选', async () => {
  const { window } = await boot();
  await generate(window, [], '跟同事吐槽工作');
  await explainOnce(window);
  const doc = window.document;
  doc.getElementById('book-btn').click();

  // 新建分类：选「＋ 新分类…」→ 输入 → 回车
  let sel = doc.querySelector('#book-body select');
  sel.value = '__new';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const inp = doc.querySelector('#book-body input.txt');
  assert.ok(inp, '要出现新分类输入框');
  inp.value = '拖延症自救';
  inp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(20);
  assert.equal(window.sceneEnglish.loadBook()[0].cat, '拖延症自救');
  assert.match(doc.querySelector('#book-body summary').textContent, /拖延症自救/);

  // 标掌握 + 筛选
  doc.querySelector('#book-body .acts button').click();
  await wait(20);
  assert.equal(window.sceneEnglish.loadBook()[0].got, true);
  doc.getElementById('book-f').value = 'new';
  doc.getElementById('book-f').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(doc.getElementById('book-body').textContent, /这个筛选/, '已掌握的在“没掌握”筛选下要空');
  doc.getElementById('book-f').value = 'got';
  doc.getElementById('book-f').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(doc.querySelector('#book-body summary').textContent, /拖延症自救/);

  // 搜索
  doc.getElementById('book-f').value = 'all';
  doc.getElementById('book-f').dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.getElementById('book-q').value = 'meaning';
  doc.getElementById('book-q').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('#book-body .item').length, 1);
  doc.getElementById('book-q').value = '完全不沾边的词';
  doc.getElementById('book-q').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('#book-body .item').length, 0, '搜不到要空着');
});

test('生词本导出：txt 分组带例句，CSV 给 Excel 留 BOM，Anki 两列制表符', async () => {
  const { window } = await boot();
  await generate(window, [], '跟同事吐槽工作');
  await explainOnce(window);
  const txt = window.sceneEnglish.bookText();
  assert.match(txt, /也能说：I want to get that off my chest\./, 'txt 导出要带类似表达');
  assert.match(txt, /## 职场闲聊/);
  assert.match(txt, /have been meaning to do sth/);
  assert.match(txt, /例句：I've been meaning to call him back\./);

  const csv = window.sceneEnglish.bookCsv();
  assert.ok(csv.charCodeAt(0) === 0xfeff, 'CSV 要有 BOM，Excel 打开中文才不乱');
  assert.match(csv.split('\n')[0], /分类,词条,用法结构/);
  assert.match(csv.split('\n')[0], /类似说法/, 'CSV 要有类似表达这一列');
  assert.match(csv, /off my chest/);
  assert.match(csv, /职场闲聊,have been meaning to do sth/);

  const anki = window.sceneEnglish.bookAnki();
  const cols = anki.split('\n')[0].split('\t');
  assert.equal(cols.length, 2, 'Anki 导入要正好两列');
  assert.match(cols[0], /have been meaning to do sth/);
  assert.match(cols[1], /一直想做/);
  assert.match(cols[1], /也能说：I want to get that off my chest\. \/ It's been on my mind/, 'Anki 背面要带类似说法');
});

test('模型没给分类时按场景关键词兜底归类', async () => {
  const { window } = await boot();
  await generate(window, [], '在咖啡店点单');
  const d = await window.sceneEnglish.explain('light ice', 'Could I get a latte, light ice?', '');
  await wait(30);
  assert.equal(d.category, '职场闲聊', 'mock 固定给职场闲聊');
  // 直接测兜底函数
  assert.equal(window.sceneEnglish.guessCat('在机场值机，行李超重'), '出行住宿');
  assert.equal(window.sceneEnglish.guessCat('和朋友聊怎么把肉煮入味'), '吃喝');
  assert.equal(window.sceneEnglish.guessCat('随便一个场景'), '其他');
});

/* ---------- 练一练（生词本小游戏） ---------- */

function addW(window, phrase, asUsed, meaning, sentence, scene) {
  return window.sceneEnglish.addBookEntry({
    kind: 'explain', phrase, asUsed, pattern: asUsed, meaning,
    structure: '', why: '', examples: [{ en: sentence, zh: meaning }],
    caution: '', category: '测试分类', sentence, scene: scene || '测试场景',
  });
}
function stock(window) {
  addW(window, 'vent about', 'vent about sth', '跟人吐槽某事', "I've been meaning to vent about work.", '吐槽工作');
  addW(window, 'blanch', 'blanch sth with sth', '用…焯水', 'I always blanch it with ginger slices.', '做肉');
  addW(window, 'simmer', 'let sth simmer', '小火慢炖', 'Let it simmer for an hour.', '做肉');
  addW(window, 'pat', 'pat sth dry', '把表面吸干', 'Pat the steak dry before it hits the pan.', '做肉');
  addW(window, 'got a sec', 'got a sec', '有空吗', 'Hey, you got a sec?', '拦人说话');
}

test('填空练一练：挖掉的必须是词本里的原词，全答对能一路练到结算', async () => {
  const { window } = await boot();
  stock(window);
  const SE = window.sceneEnglish;
  SE.startQuiz('cloze');
  await wait(30);
  const doc = window.document;
  assert.equal(SE.quizState().q.length, 5, '5 个词出 5 题');
  assert.equal(SE.quizState().q.every((q) => q.type === 'cloze'), true);

  const q0 = SE.quizState().q[SE.quizState().i];
  const sentText = doc.querySelector('.q-sent').textContent;
  assert.equal(sentText.toLowerCase().includes(q0.answer.toLowerCase()), false, '题干里不能泄答案');
  assert.ok(doc.getElementById('q-blank'), '要有空');

  // 💡 首字母提示
  [...doc.querySelectorAll('#g-body .row button')].find((b) => /首字母/.test(b.textContent)).click();
  const blankTxt = doc.getElementById('q-blank').textContent;
  assert.equal(blankTxt.split(' ')[0][0], q0.answer[0], `首字母提示要对上答案：${blankTxt}`);
  assert.match(blankTxt, /_/, '提示应该是下划线样式');

  // 大小写不敏感判对，一路清完全部题
  let guard = 0;
  while (SE.quizState().i < SE.quizState().q.length && guard++ < 30) {
    const q = SE.quizState().q[SE.quizState().i];
    doc.getElementById('q-in').value = q.answer.toUpperCase();
    doc.getElementById('q-check').click();
    await wait(10);
    doc.getElementById('q-next').click();
    await wait(10);
  }
  assert.match(doc.getElementById('g-body').textContent, /练完了/, '要出结算屏');
  assert.match(doc.getElementById('g-body').textContent, /答对 5 题/);
  assert.equal(SE.quizState().right, 5);
});

test('答错的词会再出一次，错的词进「只练错的」', async () => {
  const { window } = await boot();
  stock(window);
  const SE = window.sceneEnglish;
  SE.startQuiz('cloze');
  await wait(20);
  const doc = window.document;
  const q = SE.quizState().q[0];
  doc.getElementById('q-in').value = '完全不搭的答案';
  doc.getElementById('q-check').click();
  await wait(20);
  assert.match(doc.getElementById('g-fb').textContent, new RegExp('答案是：' + q.answer.slice(0, 4)), '要公布答案');
  assert.equal(SE.quizState().q.length, 6, '错的词追加到队尾再考一次');
  assert.equal(Object.keys(SE.quizState().wrongKeys).length, 1);
  doc.getElementById('q-next').click();
  await wait(10);
  // 只练错的：应该只剩那个错词相关的题
  SE.startQuiz('cloze', true);
  await wait(20);
  assert.ok(SE.quizState().q.length >= 1);
  const keys = SE.quizState().q.map((x) => x.x.key);
  assert.equal(keys.every((k) => k === q.x.key), true, '只练错的就只考错的词');
});

test('选择练一练：四个选项、点对加分、点错标红且正确项标绿', async () => {
  const { window } = await boot();
  stock(window);
  const SE = window.sceneEnglish;
  SE.startQuiz('mc');
  await wait(20);
  const doc = window.document;
  const st = SE.quizState();
  assert.equal(st.q.every((q) => q.type === 'mc'), true);
  assert.equal(doc.querySelectorAll('.q-opt').length, 4, '四个选项');
  const q = st.q[st.i];
  const correct = [...doc.querySelectorAll('.q-opt')].find((b) => b.textContent === q.x.asUsed);
  const wrongBtn = [...doc.querySelectorAll('.q-opt')].find((b) => b !== correct);
  wrongBtn.click();
  await wait(20);
  assert.equal(wrongBtn.classList.contains('wrongpick'), true, '选错的要标红');
  assert.equal(correct.classList.contains('right'), true, '正确项要标绿');
  assert.match(doc.getElementById('g-fb').textContent, /正确是：/);
  doc.getElementById('q-next').click();
  await wait(10);
  const q2 = SE.quizState().q[SE.quizState().i];
  [...doc.querySelectorAll('.q-opt')].find((b) => b.textContent === q2.x.asUsed).click();
  await wait(20);
  assert.match(doc.getElementById('g-fb').textContent, /✅/);
  assert.equal(SE.quizState().right, 1);
});

test('词太少不给开局，用中文说明要几个词', async () => {
  const { window } = await boot();
  const SE = window.sceneEnglish;
  addW(window, 'vent about', 'vent about sth', '跟人吐槽某事', "I've been meaning to vent about work.");
  SE.startQuiz('cloze');
  await wait(20);
  assert.equal(window.document.getElementById('g-status').className.includes('err'), true);
  assert.match(window.document.getElementById('g-status').textContent, /至少要有 2 个词/);
});

test('判分宽容度：大小写、标点、空格都不算错', async () => {
  const { window } = await boot();
  const SE = window.sceneEnglish;
  assert.equal(SE.qNorm('  Got a SEC? '), SE.qNorm('got a sec'), '大小写和首尾标点');
  assert.equal(SE.qNorm("pat the steak's dry"), SE.qNorm('pat the steaks dry'), '撇号不算差异');
  assert.equal(SE.clozeOk({ sentence: 'Let it simmer for an hour.', phrase: 'simmer' }), true);
  assert.equal(SE.clozeOk({ sentence: 'Let it simmer for an hour.', phrase: '不存在' }), false, '句子对不上就不出填空题');
});

/* ---------- 连续播放整段对话 ---------- */

test('▶ 连续播放整段对话：一句接一句、你说和对方说音高不同，播完自动停', async () => {
  const { window, calls, spk } = await boot();
  await generate(window, calls, '和朋友聊炖肉');
  const doc = window.document;
  doc.getElementById('play-all').click();
  await wait(1300);
  assert.equal(spk.queue.length, 3, '三句按顺序连着播');
  assert.match(spk.queue[0].text, /braised beef/);
  assert.match(spk.queue[1].text, /Pat it dry/);
  const pA = spk.queue[0].pitch, pB = spk.queue[1].pitch;
  assert.ok(pA !== pB && pA < 1 && pB > 1, '你说低、对方高，听起来是两个人');
  assert.equal(window.sceneEnglish.playState().on, false, '播完要自动停');
  assert.match(doc.getElementById('play-all').textContent, /▶/, '按钮回到可播状态');
  assert.match(doc.getElementById('play-note').textContent, /播完了/);
  assert.equal(doc.querySelectorAll('.turn.playing').length, 0, '高亮要清干净');
});

test('播放中途点停：立刻停住，不再往下播', async () => {
  const { window, calls, spk } = await boot();
  await generate(window, calls, '和朋友聊炖肉');
  const doc = window.document;
  doc.getElementById('play-all').click();
  await wait(120);
  doc.getElementById('play-all').click();
  assert.equal(window.sceneEnglish.playState().on, false, '停了');
  const n = spk.queue.length;
  assert.ok(n >= 1, '至少播出了一句');
  await wait(700);
  assert.ok(spk.queue.length <= n + 1, '停住后不该继续一句一句往外播');
  assert.match(doc.getElementById('play-note').textContent, /已停/);
});

test('换场景/重新生成时自动停止播放并复位高亮', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '和朋友聊炖肉');
  window.document.getElementById('play-all').click();
  await wait(60);
  await generate(window, calls, '换个场景聊周末');
  assert.equal(window.sceneEnglish.playState().on, false, '新对话来了要停掉旧的连播');
});

test('护眼配色上线：柔和绿 + 自动深色模式，旧砖红清除', () => {
  const src = fs.readFileSync(PAGE, 'utf8');
  assert.match(src, /--bg: #e9efe6/, '背景是淡护眼绿');
  assert.match(src, /--accent: #3f7d5c/, '主色是沉稳绿');
  assert.match(src, /prefers-color-scheme: dark/, '手机深色模式要自动跟随');
  assert.ok(!src.includes('#d84f2b'), '旧砖红主色不能残留');
  assert.ok(!src.includes('#7c5cff'), '填空的紫色也换进主色体系');
});
