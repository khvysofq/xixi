// 场景英语提示页的界面用例：mock 掉 /api/scene-guide，验证渲染、更多、缓存、报错都不撒谎。
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
      { zh: '吸干水分', en: 'pat dry', note: '煎肉不溅油的关键' },
      { zh: '焯水', en: 'blanch', note: '' },
    ] },
    { title: '火候', items: [{ zh: '小火微沸', en: 'simmer', note: '别大火猛滚' }] },
  ],
  patterns: [
    { en: 'Do you have any tips for…?', zh: '你有什么窍门吗？' },
    { en: 'How long do you simmer it for?', zh: '你小火炖多久？' },
  ],
};

async function boot(opts = {}) {
  const calls = [];
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
        const body = init && init.body ? JSON.parse(init.body) : {};
        calls.push({ url, body });
        if (opts.fail) return Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, error: '生成超时了，请点重试' }) });
        const data = body.mode === 'more' ? GUIDE : DIALOGUE;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
      };
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
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
  return { dom, window, calls };
}

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function generate(window, calls, scene) {
  window.document.getElementById('scene').value = scene;
  window.document.getElementById('go').click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.dialogue; i++) await wait(20);
  return calls;
}

test('页面骨架：输入框、示例 chips、生成按钮都在，更多按钮初始隐藏', async () => {
  const { window } = await boot();
  const doc = window.document;
  assert.ok(doc.getElementById('scene'), '要有场景输入框');
  assert.ok(doc.querySelectorAll('#examples .chip').length >= 5, '要有可直接点的场景示例');
  assert.equal(doc.getElementById('more').classList.contains('hidden'), true, '没生成前不该给「更多」');
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
  assert.equal(doc.getElementById('more').classList.contains('hidden'), false, '生成后要能点更多');
});

test('点「更多表达」：分类语料 + 句式渲染，note 跟在英文后面', async () => {
  const { window, calls } = await boot();
  await generate(window, calls, '和朋友聊炖肉');
  window.document.getElementById('more').click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.guide; i++) await wait(20);
  const more = calls.find((c) => c.body.mode === 'more');
  assert.ok(more, '应发起 more 请求');
  assert.equal(more.body.dialogue.length, 3, '要把已生成的对话带给模型当素材');
  const doc = window.document;
  assert.equal(doc.getElementById('guide-card').classList.contains('hidden'), false);
  assert.equal(doc.querySelectorAll('#sections details.sec').length, 2, '两个分类');
  assert.match(doc.querySelector('#sections summary').textContent, /预处理/);
  assert.equal(doc.querySelectorAll('#sections table.v tr').length, 3, '共 3 条词条');
  assert.match(doc.querySelector('#sections td.en .note').textContent, /溅油/);
  assert.equal(doc.querySelectorAll('#patterns .pat').length, 2, '两条句式');
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

  window.document.getElementById('more').click();
  for (let i = 0; i < 100 && !window.sceneEnglish.state.guide; i++) await wait(20);
  const g = window.sceneEnglish.guideText();
  assert.match(g, /## 预处理/);
  assert.match(g, /吸干水分 — pat dry（煎肉不溅油的关键）/);
  assert.match(g, /## 可直接套用的句式/);
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
