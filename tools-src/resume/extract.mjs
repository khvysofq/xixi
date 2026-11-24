// 简历纯文本 → 结构化字段。零依赖、零 DOM，Node 直测。
// 输入是 pdf/docx/txt 已转好的纯文本；解析全部本地完成，数据不出浏览器。

'use strict';

function normalizeText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200f\ufeff\u2028\u2029]/g, '')
    .replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uff21-\uff3a]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uff41-\uff5a]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\uff3a]/g, ':')
    .replace(/[：]/g, ':')
    .replace(/[\u3000]/g, ' ');
}

const DEGREE_RANK = { 中专: 1, 高中: 1, 专科: 2, 大专: 2, 本科: 3, 学士: 3, 硕士: 4, 研究生: 4, MBA: 4, 博士: 5 };
const SCHOOL_RE = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9（）()·]{1,19}?(?:大学|学院|学校|University|College|Institute))/;
const D = '(19\\d{2}|20\\d{2})(?:\\s*[年./-]\\s*(\\d{1,2}))?\\s*月?';
const SEP = '\\s*(?:-|–|—|~|～|至|到)\\s*';
const RANGE_RE = new RegExp(D + SEP + '(?:(19\\d{2}|20\\d{2})(?:\\s*[年./-]\\s*(\\d{1,2}))?\\s*月?|至今|今)', 'g');
const SOLO_ROLE = /(会计|出纳|审计|调度|销售|客服|司机|仓管|库管|站长|店长|教师|护士|设计|人事|行政|策划|监理|预算|统计|实习生|专员|主管|经理|总监|顾问|分析师|工程师|助理|运营)(?=[\s]|$)/;
const COMPANY_RE = /([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,24}(?:股份有限公司|有限公司|集团|公司|事务所|事业部|银行|医院|大学|学院|学校|商行|商贸|中心|科技|物流|快递|厂))/g;
const ROLE_RE = /([\u4e00-\u9fa5A-Za-z]{2,16}?(?:工程师|架构师|分析师|专员|主管|经理|总监|总裁|助理|顾问|会计|出纳|运营|调度|销售|客服|文员|司机|仓管|库管|站长|店长|教师|护士|设计|人事|行政|策划|监理|预算|统计|组长|班长|合伙人|实习生))/;

function monthNum(y, m) { return Number(y) * 12 + (m ? Number(m) : 1); }

// 从一行里找日期区间；返回 [{from:{y,m}, to:{y,m}|null=至今}]
function findRanges(line) {
  const out = [];
  RANGE_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_RE.exec(line))) {
    const from = { y: Number(m[1]), m: m[2] ? Number(m[2]) : 1 };
    let to = null;
    if (m[3]) to = { y: Number(m[3]), m: m[4] ? Number(m[4]) : 12 };
    else if (!/至今|今$/.test(m[0])) to = { y: from.y, m: 12 };
    if (to && to.y < from.y) to = { y: from.y, m: 12 };
    out.push({ from, to });
  }
  return out;
}

function parseResume(text, opts) {
  const now = (opts && opts.now) || new Date();
  const flat = normalizeText(text);
  const lines = flat.split('\n').map((s) => s.trim()).filter(Boolean);
  const r = {
    name: '', gender: '', age: null, phone: '', email: '', city: '',
    intent: '', degree: '', school: '', major: '', eduPeriod: '', eduRank: 0,
    jobs: [], yearsTotal: null, skills: [], certs: [], lines,
    raw: flat,
  };
  // 姓名：显式「姓名:」或前 5 行里 2-4 个汉字且不含关键词
  let m = /姓名[:：]?\s*([^\s,，、|]{2,4})/.exec(flat);
  if (m) r.name = m[1];
  else {
    for (const line of lines.slice(0, 6)) {
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(line) && !/简历|求职|意向/.test(line)) { r.name = line; break; }
    }
  }
  m = /(男|女)/.exec(lines.slice(0, 8).join(' ')); if (m) r.gender = m[1];
  m = /年龄[:：]?\s*(\d{1,2})/.exec(flat) || /(\d{1,2})\s*岁/.exec(flat); if (m) r.age = Number(m[1]);
  if (!r.age) { m = /((?:19|20)\d{2})[年./-]\d{1,2}[月]?出生|出生[:：]?\s*((?:19|20)\d{2})/.exec(flat); if (m) r.age = now.getFullYear() - Number(m[1] || m[2]); }
  m = /1[3-9]\d{9}/.exec(flat.replace(/\s/g, '')); if (m) r.phone = m[0];
  m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(flat); if (m) r.email = m[0];
  m = /(求职意向|期望职位|期望岗位|意向岗位|求职岗位|应聘岗位|期望|意向|求职)[城市岗位方向]?[:：是为]?\s*([\u4e00-\u9fa5A-Za-z]{2,14})/.exec(flat);
  if (m && !/意向|求职|期望/.test(m[2])) r.intent = m[2];
  m = /现居|所在城市[:：]?\s*([\u4e00-\u9fa5]{2,10})/.exec(flat); if (m) r.city = m[1];

  // 教育
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sc = SCHOOL_RE.exec(line);
    const dg = /(博士|硕士|研究生|学士|本科|大专|专科|中专|高中|MBA)/.exec(line);
    if (sc && (dg || /教育|学历|Education/i.test(line + ' ' + (lines[i - 1] || '')))) {
      r.school = sc[1].trim();
      if (dg) { r.degree = dg[1]; r.eduRank = DEGREE_RANK[dg[1]] || 0; }
      const mj = /([\u4e00-\u9fa5]{2,12}(?:工程|管理|技术|计算机|科学|会计|金融|经济|贸易|物流|运输|设计|营销|医学|教育|法学|文学|语言|统计|控制|电子|机械|建筑|学))/g;
      if (mj) { const rest = line.replace(r.school, ''); let mm, best = ''; while ((mm = mj.exec(rest))) if (mm[1].length > best.length) best = mm[1]; r.major = best; }
      const rg = findRanges(line);
      if (rg.length) {
        const a = rg[0];
        r.eduPeriod = a.from.y + '.' + String(a.from.m).padStart(2, '0') + '-' + (a.to ? a.to.y + '.' + String(a.to.m).padStart(2, '0') : '至今');
      }
      break;
    }
  }

  // 工作经历
  const DATE_ONLY_RE = /^\d{4}\s*[.\/-]\s*\d{1,2}\s*[-–—~至到]+\s*(?:至今|今|\d{4}\s*[.\/-]\s*\d{1,2})\s*(?:[（(][^）)]*[）)])?$/;
  const wl = [];
  for (const line of lines) {
    if (DATE_ONLY_RE.test(line) && wl.length) {
      const prev = wl[wl.length - 1];
      if (!/\d{4}/.test(prev) && prev.length <= 40 && !/[:：]/.test(prev)) { wl[wl.length - 1] = prev + ' ' + line; continue; }
    }
    wl.push(line);
  }
  let inWork = false, inEdu = false;
  for (let i = 0; i < wl.length; i++) {
    const line = wl[i];
    if (/工作经历|工作经验|职业经历|Employment|Work Experience/i.test(line) && line.length < 20) { inWork = true; inEdu = false; continue; }
    if (/教育|学历|Education/i.test(line) && line.length < 16) { inEdu = true; inWork = false; continue; }
    if (/技能|证书|项目经历|荣誉|其他|自我评价/.test(line) && line.length < 16) { inWork = false; inEdu = false; continue; }
    if (inEdu) continue;
    const rg = findRanges(line);
    if (!rg.length) continue;
    if (/^[-\d\s.~至到年月日:：()（）至今今—–]+$/.test(line)) continue;
    if (/大学|学院|学校/.test(line) && /学士|本科|硕士|研究生|博士|大专|专科/.test(line)) continue;
    const ctx = line + ' ' + (wl[i + 1] || '') + ' ' + (wl[i + 2] || '');
    COMPANY_RE.lastIndex = 0;
    let co = COMPANY_RE.exec(line);
    if (!co) {
      const di = line.search(/\d{4}\s*[.\/-]\s*\d{1,2}/);
      const head = (di > 0 ? line.slice(0, di) : line).replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim();
      if (head.length >= 2 && head.length <= 30 && !/职责|部门|汇报|薪|业绩|学历|院校|所在|负责/.test(head)) co = [head, head];
    }
    if (!co) { COMPANY_RE.lastIndex = 0; co = COMPANY_RE.exec(ctx); }
    let ro = ROLE_RE.exec(line);
    if (!ro) { const so = SOLO_ROLE.exec(line); if (so) ro = [so[0], so[0]]; }
    if (!ro) ro = ROLE_RE.exec(ctx);
    let coName = co ? co[1].trim() : '';
    if (!coName && !ro && !inWork) continue;
    if (!ro && !coName) continue;
    const a = rg[0];
    const durM = /[（(]\s*(\d+(?:[.,]\d+)?)\s*年\s*(\d+)?\s*个?月?\s*[）)]/.exec(line);
    r.jobs.push({
      from: a.from.y + '.' + String(a.from.m).padStart(2, '0'),
      to: a.to ? a.to.y + '.' + String(a.to.m).padStart(2, '0') : '至今',
      company: coName, role: ro ? ro[1].trim() : '',
      dur: durM ? Number(durM[1].replace(',', '.')) + (durM[2] ? Number(durM[2]) / 12 : 0) : null,
      desc: [],
    });
  }
  // 每段描述：下一段之前的 bullet
  for (let j = 0; j < r.jobs.length; j++) {
    const startLine = wl.findIndex((l) => l.includes(r.jobs[j].from));
    const endLine = j + 1 < r.jobs.length ? wl.findIndex((l) => l.includes(r.jobs[j + 1].from)) : wl.length;
    for (let i = Math.max(0, startLine); i < endLine; i++) {
      const l = wl[i];
      if (i === startLine) continue;
      const zm = /^职责业绩\s*[:：]\s*(.{8,})$/.exec(l);
      if (zm) { r.jobs[j].desc.push(zm[1]); continue; }
      if (/^【[^】]{2,14}】/.test(l) && l.length > 12) { r.jobs[j].desc.push(l); continue; }
      if (/^[-•·*●▪\d.、\s]*(负责|参与|完成|协助|主导|搭建|优化|管理|处理|对接|输出)/.test(l) && l.length > 8) r.jobs[j].desc.push(l);
    }
  }

  // 总年限：每段自带「（3年6个月）」就先信显式时长
  if (r.jobs.length && r.jobs.every((j) => j.dur)) {
    r.yearsTotal = Math.round(r.jobs.reduce((a, j) => a + j.dur, 0) * 10) / 10;
  }
  if (r.jobs.length && r.yearsTotal == null) {
    const spans = r.jobs.map((j) => {
      const [fy, fm] = j.from.split('.').map(Number);
      const ty = j.to === '至今' ? now.getFullYear() : Number(j.to.split('.')[0]);
      const tm = j.to === '至今' ? now.getMonth() + 1 : Number(j.to.split('.')[1] || 12);
      return [monthNum(fy, fm), monthNum(ty, tm)];
    }).sort((a, b) => a[0] - b[0]);
    let total = 0, cur = null;
    for (const s of spans) {
      if (!cur) cur = s.slice();
      else if (s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else { total += cur[1] - cur[0]; cur = s.slice(); }
    }
    if (cur) total += cur[1] - cur[0];
    r.yearsTotal = Math.round((total / 12) * 10) / 10;
  }
  if (r.yearsTotal == null) {
    m = /(\d{1,2}(?:\.\d)?)\s*年.{0,4}(经验|工作)/.exec(flat);
    if (m) r.yearsTotal = Number(m[1]);
  }

  // 技能与证书
  const skillLines = lines.filter((l) => /技能|熟练|熟悉|掌握|精通|证书|资格|Skills|CET|证书/i.test(l) && l.length < 200);
  const stop = /^(熟练|熟悉|掌握|精通|持有|获得|取得|通过|具备|了解|会|能|使用|会用|可|的|用|以及|等|持有)$/;
  for (const l of skillLines) {
    for (const part of l.split(/[、,，;；/|\s]+/)) {
      const t = part.replace(/^[-•·*●▪\d.、\s]+/, '').replace(/[:：]/g, '').trim();
      if (!t || stop.test(t) || t.length > 24 || /^(技能证书|专业技能|职业技能|技能|证书|资格|证书名称|Skills)$/i.test(t)) continue;
      if (/[A-Za-z]/.test(t) || /[\u4e00-\u9fa5]{2,}/.test(t)) r.skills.push(t);
    }
  }
  const engHay = skillLines.join(' ');
  const eng = new Set((engHay.match(/\b[A-Za-z][A-Za-z0-9+#.-]{1,18}\b/g) || []).map((x) => x.replace(/[.,;:)）]+$/, '')).filter(Boolean));
  const KNOWN = ['excel', 'word', 'ppt', 'powerpoint', 'sql', 'python', 'java', 'photoshop', 'autocad', 'solidworks', 'sap', 'oracle', 'visio', 'xmind', 'matlab', 'tableau', 'cadr', 'c1', 'b2', 'cet-4', 'cet-6', 'cam350', 'uml', 'linux', 'vlookup', 'wps', 'tms', 'erp', 'crm', 'oa'];
  const flatLow0 = flat.toLowerCase();
  for (const k of KNOWN) if (flatLow0.includes(k)) eng.add(k);
  for (const e of Array.from(eng)) {
    const low = String(e).toLowerCase().replace(/[.,;:]+$/, '');
    if (!low || low.includes('@') || /\.(com|cn|net|org)$/.test(low)) continue;
    if (!/^[a-z][a-z0-9+#.-]{0,18}$/.test(low)) continue;
    if (!r.skills.some((s2) => s2.toLowerCase() === low)) r.skills.push(low);
  }
  r.skills = Array.from(new Set(r.skills)).slice(0, 30);
  m = /(C1|B2|A1|驾照|驾驶证|会计证|初级|中级|高级|PMP|CPA|CFA|教师资格证|建造师|安全员)/.exec(flat);
  if (m) r.certs.push(m[1]);

  return r;
}

// docx 的 word/document.xml → 纯文本（浏览器里 JSZip 取出 XML 后调用；纯函数可 Node 直测）
function docxXmlToText(xml) {
  return String(xml)
    .replace(/<w:tab[^>]*\/>/g, '  ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\n{3,}/g, '\n\n');
}

// pdf.js getTextContent 的 items → 行文本（同样纯函数）
function pdfItemsToText(items) {
  const out = [];
  let lastY = null;
  for (const it of items || []) {
    if (!it.str) continue;
    const y = it.transform ? Math.round(it.transform[5]) : 0;
    if (lastY !== null && Math.abs(y - lastY) > 4) out.push('\n');
    out.push(it.str);
    lastY = y;
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

export { normalizeText, parseResume, docxXmlToText, pdfItemsToText, DEGREE_RANK };
