// 简历速看端到端：粘贴/TXT拖入/DOCX/PDF(stub) → 匹配 → 总结 50~100 字 → 台账两版 → 复制；含恢复上次与防呆提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TextDecoder, TextEncoder } from 'node:util';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('../scripts/deps.cjs');

const PAGE = path.resolve(import.meta.dirname, '..', 'public', 'tools', 'resume-check', 'index.html');

const RESUME_TXT = `张伟
男，29岁
电话：13800000000
求职意向：物流调度专员
现居：广州

教育背景
2014.09-2018.06  武汉理工大学  交通运输工程  本科（学士）

工作经历
2018.07-2021.03  广州风信物流有限公司  调度专员
- 负责珠三角干线车辆调度与承运商对接
2021.04-至今  顺丰同城物流集团  高级运力运营
- 负责城配运力排班与成本优化

技能证书
熟悉Excel（透视表、VLOOKUP），会用SQL取数，英语CET-6，C1驾照`;

function boot(opts = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(w) {
      if (opts.seedText) w.localStorage.setItem('xixi.resume.text.v1', opts.seedText);
      if (opts.seedReqs) w.localStorage.setItem('xixi.resume.reqs.v1', opts.seedReqs);
      w.scrollTo = () => {};
      // jsdom 缺这几个真实浏览器全局：TextDecoder 与 setImmediate（JSZip 3 的异步调度用得上）
      const nodeTimers = require('node:timers');
      w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
      if (!w.setImmediate) w.setImmediate = nodeTimers.setImmediate;
      if (!w.clearImmediate) w.clearImmediate = nodeTimers.clearImmediate;
      w.__clip = {};
      try {
        Object.defineProperty(w.navigator, 'clipboard', {
          value: { writeText: (t) => { w.__clip.text = t; return Promise.resolve(); } },
          configurable: true,
        });
      } catch (e) { /* 有些 jsdom 版本锁了 navigator */ }
      if (false) {
        w.pdfjsLib = {
          GlobalWorkerOptions: {},
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 1,
              getPage: async () => ({
                getTextContent: async () => ({
                  items: [
                    { str: '李静', transform: [1, 0, 0, 1, 60, 780] },
                    { str: '女 26岁 电话：13900000000', transform: [1, 0, 0, 1, 60, 760] },
                    { str: '求职意向：客服主管', transform: [1, 0, 0, 1, 60, 745] },
                    { str: '教育背景 2016.09-2020.06 湖南大学 工商管理 本科', transform: [1, 0, 0, 1, 60, 725] },
                    { str: '工作经历 2020.07-至今 北京宏远快递有限公司 客服主管', transform: [1, 0, 0, 1, 60, 705] },
                    { str: '- 负责工单处理与客户投诉对接', transform: [1, 0, 0, 1, 60, 690] },
                  ],
                }),
              }),
            }),
          }),
        };
      }
    },
  });
  return dom;
}
async function tick(n = 8) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 10)); }
function dropFile(w, name, bytesOrText, mime) {
  const u8 = new w.Uint8Array(typeof bytesOrText === 'string' ? Array.from(Buffer.from(bytesOrText, 'utf8')) : bytesOrText);
  const f = new w.File([u8], name, { type: mime || 'application/octet-stream' });
  const ev = new w.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [f] };
  w.document.getElementById('drop').dispatchEvent(ev);
}
const el = (w, id) => w.document.getElementById(id);

test('拖入 TXT → 解析全字段 → 自动出匹配/总结/台账（要点先备好的场景）', async () => {
  const dom = boot(); const w = dom.window;
  await tick(2);
  el(w, 'reqs').value = '本科及以上学历\n3年以上物流调度经验\n熟悉Excel透视表，会用SQL取数';
  dropFile(w, 'zhangwei.txt', RESUME_TXT, 'text/plain');
  await tick();
  assert.equal(el(w, 'card-rs').hidden, false, '识别结果卡要出来');
  const kv = el(w, 'rs-kv').textContent;
  assert.ok(kv.includes('张伟') && kv.includes('29') && kv.includes('武汉理工大学') && kv.includes('交通运输'), kv);
  assert.ok(kv.includes('8.3 年') || kv.includes('8.2 年'), '总经验：' + kv);
  assert.equal(el(w, 'rs-jobs').querySelectorAll('.job').length, 2, '两段履职');
  // reqs 已有 → 解析完自动分析
  assert.equal(el(w, 'card-res').hidden, false, '自动出匹配');
  const score = Number(el(w, 'res-score').textContent.replace('%', ''));
  assert.ok(score >= 70, '物流岗对物流人 score=' + score);
  const sum = el(w, 'sum-text').textContent;
  assert.ok(sum.length >= 50 && sum.length <= 100, '总结 ' + sum.length + ' 字：' + sum);
  const led = el(w, 'led-text').textContent;
  assert.ok(led.includes('武汉理工大学') && led.includes('2018.07-2021.03') && led.includes('2021.04-至今'), led);
  assert.ok(el(w, 'led-line').textContent.split('\t').length >= 6, '一行版 6+ 个 tab 字段');
  assert.ok(el(w, 'led-line').textContent.includes('张伟'));
  dom.window.close();
});

test('粘贴文字 → 点分析；逐条证据渲染；复制一行版走 clipboard', async () => {
  const dom = boot(); const w = dom.window;
  await tick(2);
  el(w, 'paste').value = RESUME_TXT;
  el(w, 'btn-parse-paste').click();
  await tick();
  el(w, 'reqs').value = '本科及以上\n英语口语流利';
  el(w, 'btn-analyze').click();
  await tick();
  assert.equal(el(w, 'card-res').hidden, false);
  const items = el(w, 'res-items').querySelectorAll('.item');
  assert.equal(items.length, 2, '一条要点一行');
  assert.ok(items[1].textContent.includes('没出现') || items[1].textContent.includes('英语'), '缺口要点要有交代：' + items[1].textContent);
  el(w, 'btn-copy-line').click();
  await tick(3);
  assert.ok((w.__clip.text || '').includes('\t'), 'stub 的 clipboard 要吃到一行版');
  assert.ok((w.__clip.text || '').startsWith('张伟'));
  dom.window.close();
});

test('DOCX：用页面内 JSZip 造一个真 docx 拖进来', async () => {
  const dom = boot(); const w = dom.window;
  await tick(2);
  const paras = RESUME_TXT.split('\n').map((l) => '<w:p><w:r><w:t>' + l.replace(/&/g, '&amp;') + '</w:t></w:r></w:p>').join('');
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras + '</w:body></w:document>';
  const JSZipNode = require('../vendor/jszip.min.js');
  const zip = new JSZipNode();
  zip.file('word/document.xml', xml);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  w.__zipBytes = new Uint8Array(buf);
  dropFile(w, 'chen.docx', w.__zipBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await tick(10);
  assert.equal(el(w, 'card-rs').hidden, false, 'docx 要解析出结果');
  assert.ok(el(w, 'rs-kv').textContent.includes('张伟'), el(w, 'rs-kv').textContent);
  dom.window.close();
});

test('PDF：pdf.js 打桩喂 items，pdfItemsToText 通道走通', async () => {
  const dom = boot(); const w = dom.window;
  w.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: '李静', transform: [1, 0, 0, 1, 60, 780] },
              { str: '女 26岁 电话：13900000000', transform: [1, 0, 0, 1, 60, 760] },
              { str: '求职意向：客服主管', transform: [1, 0, 0, 1, 60, 745] },
              { str: '教育背景 2016.09-2020.06 湖南大学 工商管理 本科', transform: [1, 0, 0, 1, 60, 725] },
              { str: '工作经历 2020.07-至今 北京宏远快递有限公司 客服主管', transform: [1, 0, 0, 1, 60, 705] },
              { str: '- 负责工单处理与客户投诉对接', transform: [1, 0, 0, 1, 60, 690] },
            ],
          }),
        }),
      }),
    }),
  };
  await tick(2);
  dropFile(w, 'li.pdf', 'fake-pdf-bytes', 'application/pdf');
  await tick(10);
  assert.equal(el(w, 'card-rs').hidden, false);
  const kv = el(w, 'rs-kv').textContent;
  assert.ok(kv.includes('李静') && kv.includes('湖南大学'), kv);
  assert.ok(kv.includes('6.4 年') || kv.includes('6 年') || Number((/总经验：(\d+)/.exec(kv) || [])[1]) >= 6, '2020.07至今≈6.4年：' + kv);
  dom.window.close();
});

test('防呆：扫描版空文字、老 .doc、没简历就点分析', async () => {
  const dom = boot(); const w = dom.window;
  await tick(2);
  el(w, 'btn-analyze').click();
  assert.ok(el(w, 'toast').textContent.includes('简历'), '先拦一道：' + el(w, 'toast').textContent);
  dropFile(w, 'old.doc', 'whatever', 'application/msword');
  await tick(4);
  assert.ok(el(w, 'status').textContent.includes('另存'), el(w, 'status').textContent);
  dropFile(w, 'imglike.txt', String.fromCharCode(0, 1, 2, 0, 1), 'text/plain');
  await tick(4);
  assert.ok(el(w, 'status').textContent.includes('没提取到文字'), el(w, 'status').textContent);
  assert.equal(el(w, 'card-rs').hidden, true, '认不出就不许装出结果');
  dom.window.close();
});

test('重开页面自动恢复上次的简历和要点', async () => {
  const dom = boot({ seedText: RESUME_TXT, seedReqs: '本科及以上' });
  const w = dom.window;
  await tick(6);
  assert.equal(el(w, 'paste-box').hidden, false, '粘贴框打开并回填');
  assert.ok(el(w, 'paste').value.includes('张伟'));
  assert.equal(el(w, 'card-res').hidden, false, '有简历有要点 → 结果直接摆好');
  dom.window.close();
});

test('示例按钮：带权重要渲染出权重标记，整体结论有芯片', async () => {
  const dom = boot(); const w = dom.window;
  await tick(2);
  el(w, 'btn-sample').click();
  assert.ok(el(w, 'reqs').value.includes('30%'), '示例自带权重写法');
  el(w, 'paste').value = RESUME_TXT;
  el(w, 'btn-parse-paste').click();
  await tick(10);
  assert.ok(el(w, 'res-items').textContent.includes('权重30'), '加权条目要标出来');
  assert.ok(/高匹配|中等匹配|低匹配/.test(el(w, 'res-verdict').textContent), el(w, 'res-verdict').textContent);
  dom.window.close();
});
