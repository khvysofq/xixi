// 简历速看 · 前端逻辑（构建时与引擎、vendor 一起内联成单文件）
/* global parseResume, docxXmlToText, pdfItemsToText, analyze, summary, ledgerText, ledgerOneLine, professional, professionalText */

var state = { resume: null, match: null, raw: '', fname: '' };

function el(id) { return document.getElementById(id); }
function mk(tag, cls, txt) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
var toastTimer = null;
function toast(msg) {
  var t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
}
function jumpTo(node) {
  try { if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* jsdom/旧内核没有就算了 */ }
}
function status(msg, warn) {
  var s = el('status');
  s.textContent = msg || '';
  s.style.color = warn ? 'var(--bad)' : 'var(--muted)';
}

var KEY_TEXT = 'xixi.resume.text.v1';
var KEY_REQS = 'xixi.resume.reqs.v1';
function save(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function load(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

// ---------- 文件读取（全本机） ----------
function readAsText(file) {
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onload = function () { res(String(fr.result || '')); };
    fr.onerror = function () { rej(new Error('文件读不出来，换个文件再试')); };
    fr.readAsText(file, 'utf-8');
  });
}
function fileBytes(file) {
  // 统一交回当前 realm 的 Uint8Array：跨 realm 的 ArrayBuffer 过不了 JSZip/pdf.js 的类型检查
  function asU8(ab) { return new Uint8Array(ab); }
  if (file.arrayBuffer) return file.arrayBuffer().then(asU8);
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onload = function () { res(asU8(fr.result)); };
    fr.onerror = function () { rej(new Error('文件读不出来，换个文件再试')); };
    fr.readAsArrayBuffer(file);
  });
}
var workerTried = false;
function pdfWorkerSetup() {
  if (workerTried) return;
  workerTried = true;
  try {
    if (window.__PDFJS_WORKER_B64 && window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      var bin = atob(window.__PDFJS_WORKER_B64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([u8], { type: 'text/javascript' }));
    }
  } catch (e) { /* file:// 下 blob worker 可能被拦；pdf.js 会退到假线程 */ }
}
function readPdf(file) {
  if (!window.pdfjsLib) return Promise.reject(new Error('PDF 组件没加载'));
  pdfWorkerSetup();
  return fileBytes(file).then(function (buf) {
    return window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  }).then(function (doc) {
    var pages = [];
    var p = Promise.resolve();
    for (var i = 1; i <= doc.numPages; i++) {
      (function (no) {
        p = p.then(function () {
          return doc.getPage(no).then(function (pg) { return pg.getTextContent(); })
            .then(function (tc) { pages.push(pdfItemsToText(tc.items)); });
        });
      })(i);
    }
    return p.then(function () { return pages.join('\n'); });
  });
}
function readDocx(file) {
  if (!window.JSZip) return Promise.reject(new Error('DOCX 组件没加载'));
  return fileBytes(file).then(function (buf) {
    return window.JSZip.loadAsync(buf);
  }).then(function (zip) {
    var f = zip.file('word/document.xml');
    if (!f) throw new Error('这个 docx 里没有正文，可能加密或损坏');
    return f.async('string');
  }).then(function (xml) { return docxXmlToText(xml); });
}

function handleFile(file) {
  if (!file) return;
  var low = String(file.name || '').toLowerCase();
  status('正在解析 ' + (file.name || '文件') + '…');
  var job;
  if (/\.pdf$/.test(low)) job = readPdf(file);
  else if (/\.docx$/.test(low)) job = readDocx(file);
  else if (/\.doc$/.test(low)) job = Promise.reject(new Error('老版 .doc 打不开：请让候选人另存为 PDF 或 docx 再拖进来'));
  else job = readAsText(file);
  job.then(function (text) {
    if (!text || !/[\u4e00-\u9fa5A-Za-z]{6}/.test(text)) {
      status('这个文件里没提取到文字（多半是扫描版图片 PDF），点「✍ 直接粘贴文字」把内容贴进来', true);
      return;
    }
    ingest(text, file.name || '简历文件');
  })['catch'](function (e) { status('读不出来：' + (e && e.message || e), true); });
}

// ---------- 解析渲染 ----------
function ingest(text, name) {
  state.raw = text;
  state.fname = name || '';
  state.resume = parseResume(text, { now: new Date() });
  save(KEY_TEXT, text);
  renderResume();
  el('card-rs').hidden = false;
  status('解析好了，去下面贴岗位要点');
  var reqs = el('reqs').value.trim();
  if (reqs) doAnalyze(); else jumpTo(el('card-req'));
}

function kvItem(label, val) {
  var d = mk('div');
  d.appendChild(mk('span', null, label + '：'));
  if (val) d.appendChild(document.createTextNode(String(val)));
  else d.appendChild(mk('span', 'miss', '没识别出'));
  return d;
}
function renderResume() {
  var r = state.resume;
  el('rs-file').textContent = state.fname;
  var kv = el('rs-kv');
  kv.innerHTML = '';
  kv.appendChild(kvItem('姓名', r.name));
  kv.appendChild(kvItem('性别', r.gender));
  kv.appendChild(kvItem('年龄', r.age != null ? r.age + ' 岁' : ''));
  kv.appendChild(kvItem('手机', r.phone));
  kv.appendChild(kvItem('邮箱', r.email));
  kv.appendChild(kvItem('现居', r.city));
  kv.appendChild(kvItem('求职意向', r.intent));
  kv.appendChild(kvItem('学历', r.degree));
  kv.appendChild(kvItem('毕业院校', r.school + (r.major ? '（' + r.major + '）' : '')));
  kv.appendChild(kvItem('总经验', r.yearsTotal != null ? r.yearsTotal + ' 年' : ''));
  var jb = el('rs-jobs');
  jb.innerHTML = '';
  if (r.jobs.length) {
    r.jobs.forEach(function (j) {
      var d = mk('div', 'job');
      d.appendChild(mk('span', 't', j.from + '-' + j.to));
      d.appendChild(document.createTextNode((j.company || '公司没识别') + '　' + (j.role || '职位没识别')));
      jb.appendChild(d);
    });
  } else jb.appendChild(mk('div', 'hint', '没识别到带日期的履职段——贴的简历可能缺日期'));
  var sk = el('rs-skills');
  sk.innerHTML = '';
  r.skills.slice(0, 12).forEach(function (s) { sk.appendChild(mk('span', 'chip', s)); });
  var rawPre = el('rs-raw');
  rawPre.textContent = state.raw.length > 5000 ? state.raw.slice(0, 5000) + '\n……（截到 5000 字，解析用的是全文）' : state.raw;
}

// ---------- 匹配分析 ----------
function doAnalyze() {
  if (!state.resume) { toast('先把简历拖进来或贴进来'); return; }
  var reqText = el('reqs').value.trim();
  if (!reqText) { toast('岗位要点还没写'); jumpTo(el('card-req')); return; }
  save(KEY_REQS, reqText);
  var a = analyze(state.resume, reqText, { now: new Date() });
  state.match = a;
  el('card-res').hidden = false;
  el('card-sum').hidden = false;
  el('card-led').hidden = false;
  var sc = el('res-score');
  sc.innerHTML = '';
  sc.appendChild(document.createTextNode(String(a.overall)));
  sc.appendChild(mk('small', null, '%'));
  sc.className = 'big ' + (a.overall >= 75 ? 'ok' : a.overall >= 50 ? 'mid' : 'bad');
  el('res-verdict').textContent = a.verdict;
  var box = el('res-items');
  box.innerHTML = '';
  a.items.forEach(function (x) {
    var d = mk('div', 'item');
    d.appendChild(mk('span', 'sc ' + (x.score >= 75 ? 'ok' : x.score >= 50 ? 'mid' : 'bad'), x.score + (x.weight !== 1 ? ' · 权重' + x.weight : '')));
    d.appendChild(mk('b', null, x.req));
    var bar = mk('div', 'bar');
    var fill = mk('i');
    fill.style.width = Math.max(3, x.score) + '%';
    if (x.score < 50) fill.style.background = 'var(--bad)';
    else if (x.score < 75) fill.style.background = 'var(--warn)';
    bar.appendChild(fill);
    d.appendChild(bar);
    d.appendChild(mk('div', 'ev', x.evidence));
    box.appendChild(d);
  });
  var pro = professional(state.resume, reqText, a);
  el('sum-text').textContent = summary(state.resume, a, pro);
  renderProfessional(pro);
  el('led-text').textContent = ledgerText(state.resume, a);
  el('led-line').textContent = ledgerOneLine(state.resume, a);
  jumpTo(el('card-res'));
}

function renderProfessional(p) {
  state.pro = p;
  el('card-pro').hidden = false;
  el('pro-level').textContent = '级别画像：' + p.levelName;
  el('pro-ind').textContent = p.industry ? '行业：' + p.industry : '行业：通用';
  var vd = el('pro-verdict');
  if (p.level === 'mgmt' && p.gaps.some(function (g) { return g.indexOf('管理') >= 0; })) {
    vd.textContent = '要点命中 ≠ 够负责人量级';
    vd.style.display = '';
    vd.style.color = 'var(--bad)';
  } else vd.style.display = 'none';
  var good = el('pro-good'); good.innerHTML = '';
  if (p.strengths.length) {
    good.appendChild(mk('b', null, '✅ 优点'));
    p.strengths.forEach(function (x) { good.appendChild(mk('div', 'pro-line good', x)); });
  }
  var gap = el('pro-gap'); gap.innerHTML = '';
  if (p.gaps.length) {
    gap.appendChild(mk('b', null, '⚠️ 短板'));
    p.gaps.forEach(function (x) { gap.appendChild(mk('div', 'pro-line gap', x)); });
  } else if (p.strengths.length) gap.appendChild(mk('div', 'hint', '这条要求下没挑出硬短板。'));
  el('pro-hr').textContent = p.hrAdvice;
  el('pro-biz').textContent = p.bizAdvice;
}

// ---------- 复制 ----------
function copyText(text, label) {
  if (!text) { toast('还没内容可复制'); return; }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    toast(ok ? label + '已复制' : '复制失败，长按选中文本手动复制');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast(label + '已复制'); }, fallback);
  } else fallback();
}

// ---------- 事件 ----------
var drop = el('drop');
['dragenter', 'dragover'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); });
});
['dragleave', 'drop'].forEach(function (ev) {
  drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); });
});
drop.addEventListener('drop', function (e) {
  var fs = (e.dataTransfer && e.dataTransfer.files) || [];
  handleFile(fs[0]);
});
drop.addEventListener('click', function () { el('file').click(); });
el('file').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
el('toggle-paste').addEventListener('click', function () {
  var b = el('paste-box');
  b.hidden = !b.hidden;
  if (!b.hidden) el('paste').focus();
});
el('btn-parse-paste').addEventListener('click', function () {
  var t = el('paste').value.trim();
  if (!t) { toast('先粘贴点内容'); return; }
  ingest(t, '粘贴的文字');
});
el('btn-analyze').addEventListener('click', doAnalyze);
el('btn-sample').addEventListener('click', function () {
  el('reqs').value = '30% 3年以上物流调度经验\n本科及以上学历\n熟悉Excel透视表，会用SQL取数优先\n沟通协调、跨部门对接能力强|25\n能承受高强度排班|15\n985/211院校优先';
  save(KEY_REQS, el('reqs').value);
});
el('btn-copy-sum').addEventListener('click', function () { copyText(el('sum-text').textContent, '总结'); });
el('btn-copy-led').addEventListener('click', function () { copyText(el('led-text').textContent, '多行台账'); });
el('btn-copy-line').addEventListener('click', function () { copyText(el('led-line').textContent, '一行台账'); });
el('btn-copy-raw').addEventListener('click', function () { copyText(state.raw, '简历原文'); });
el('btn-copy-pro').addEventListener('click', function () { copyText(state.pro ? professionalText(state.pro) : '', '专业意见'); });

// 进门恢复上次
(function init() {
  var rq = load(KEY_REQS);
  if (rq) el('reqs').value = rq;
  var old = load(KEY_TEXT);
  if (old && old.length > 40) {
    el('paste-box').hidden = false;
    el('paste').value = old;
    ingest(old, '上次贴的内容（自动恢复）');
  }
})();
