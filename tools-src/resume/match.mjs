// 岗位要点 × 简历 → 匹配度、逐条证据、50~100 字总结、台账纯文字版。
// 全部本地启发式：数字类要求（年限/学历/年龄/985）走硬规则，其余走关键词+同义词+n-gram 命中。

'use strict';
import { DEGREE_RANK } from './extract.mjs';

const STOP = new RegExp('^(的|了|和|与|或|及|能|会|可|需|要|有|无|等|以及|至少|以上|以下|优先|熟悉|掌握|精通|熟练|了解|具备|具有|负责|从事|相关|良好|较强|扎实|一定的|优秀的|基本的|熟练使用|使用|做过|参与|不限|年龄|性别|男|女|全日制|应届|经验|工作经验|工作|岗位|职责|要求|条件|左右|以内|之外|个|名|年|岁)$');

const SYNONYMS = {
  '本科': ['本科', '学士', '一本', '统招本科'],
  '大专': ['大专', '专科'],
  '硕士': ['硕士', '研究生', 'mba'],
  'excel': ['excel', 'vlookup', '透视表', '数据透视', '函数公式'],
  'sql': ['sql', '取数', '查询语句', 'mysql', '数据库'],
  '数据分析': ['数据分析', '报表', '看板', '统计', '透视表', '指标'],
  'office': ['office', 'word', 'excel', 'ppt', 'wps', '办公软件'],
  '英语': ['英语', 'cet', '雅思', '托福', '口语', '英文'],
  '物流': ['物流', '货运', '运输', '干线', '配送', '快递', '仓储'],
  '调度': ['调度', '排线', '派车', '运力', '配载', '车辆安排'],
  '仓储': ['仓储', '仓库', '库存', '出入库', '盘点', 'wms'],
  '招商': ['招商', '签约品牌', '品牌落位', '租赁', '去化'],
  '商业地产': ['商业地产', '购物中心', '商业项目', '综合体', '天街', '万达广场', '写字楼'],
  '承运商': ['承运商', '车队', '供应商', '三方', '物流商'],
  '结算': ['结算', '对账', '账单', '核销'],
  '财务': ['财务', '会计', '出纳', '记账', '凭证', '税务', '发票'],
  '团队管理': ['团队管理', '带团队', '管理', '主管', '组长', '负责人'],
  '司机': ['司机', '驾驶', 'c1', '驾照'],
  '客服': ['客服', '售后', '投诉', '客诉'],
  '销售': ['销售', '业务拓展', 'bd', '客户开发', '签单', '业绩'],
  '采购': ['采购', '询价', '比价'],
  '抗压': ['抗压', '加班', '承受', '高强度'],
};

const SCHOOL_985 = ['清华大学', '北京大学', '复旦大学', '上海交通大学', '浙江大学', '中国科学技术大学', '南京大学', '华中科技大学', '武汉大学', '西安交通大学', '哈尔滨工业大学', '北京理工大学', '同济大学', '北京师范大学', '南开大学', '天津大学', '东南大学', '中山大学', '华南理工大学', '四川大学', '电子科技大学', '湖南大学', '中南大学', '重庆大学', '大连理工大学', '东北大学', '西北工业大学', '北京航空航天大学', '中国农业大学', '中央民族大学', '华东师范大学', '兰州大学', '延边大学', '石河子大学'];
const SCHOOL_211 = ['武汉理工大学', '华中农业大学', '华中师范大学', '西南交通大学', '北京交通大学', '上海大学', '苏州大学', '南京理工大学', '南京航空航天大学', '河海大学', '江南大学', '中国药科大学', '华东理工大学', '东华大学', '北京邮电大学', '北京化工大学', '北京林业大学', '中国传媒大学', '中央财经大学', '上海财经大学', '对外经济贸易大学', '西南财经大学', '合肥工业大学', '福州大学', '郑州大学', '云南大学', '贵州大学', '广西大学', '太原理工大学', '河北工业大学', '南昌大学', '东北林业大学', '暨南大学', '华南师范大学', '首都师范大学', '北京外国语大学', '上海外国语大学', '中国政法大学', '西南大学', '西北大学'];

function expand(token) {
  const low = String(token).toLowerCase();
  const out = new Set([low]);
  for (const [k, list] of Object.entries(SYNONYMS)) {
    if (k === low || list.includes(low)) list.forEach((x) => out.add(x));
    if (low.length >= 3 && (k.includes(low) || list.some((x) => x.length >= 3 && low.includes(x)))) list.forEach((x) => out.add(x));
  }
  return Array.from(out);
}
function ngrams(tok) {
  const out = [];
  if (/[\u4e00-\u9fa5]{4,}/.test(tok)) {
    for (const n of [4, 3, 2]) {
      for (let i = 0; i + n <= tok.length; i++) {
        const g = tok.slice(i, i + n);
        if (!STOP.test(g)) out.push(g);
      }
    }
  }
  return Array.from(new Set(out));
}
function reqShort(x) { return String(x).slice(0, 12); }
function keywordsOf(req) {
  const parts = String(req).toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[，,、;；\/|\s+＋+]/)
    .map((t) => t.replace(/[^0-9a-z\u4e00-\u9fa5#.+]/g, '').trim())
    .filter((t) => t.length >= 2 && !STOP.test(t) && !/^\d+(\.\d+)?$/.test(t));
  return Array.from(new Set(parts)).map((t) => ({ token: t, forms: expand(t), grams: ngrams(t) }));
}
function countIn(hay, forms) {
  let n = 0;
  for (const f of forms) if (f) n += hay.split(f).length - 1;
  return n;
}
function schoolTier(name) {
  if (!name) return '';
  for (const s of SCHOOL_985) if (name.includes(s) || s.includes(name) && name.length >= 4) return '985';
  for (const s of SCHOOL_211) if (name.includes(s) || s.includes(name) && name.length >= 4) return '211';
  if (/985|双一流/.test(name)) return '985';
  return '';
}

function kwScore(reqText, r) {
  const hay = String(r.raw || '').toLowerCase();
  const strongHay = ((r.jobs || []).map((j) => j.role + ' ' + j.desc.join(' ')).join(' ') + ' ' + (r.skills || []).join(' ') + ' ' + (r.intent || '')).toLowerCase();
  const kws = keywordsOf(reqText);
  if (!kws.length) return { score: -1, hit: '', evidence: '' };
  let bestScore = 0, bestSrc = '', bestWord = '';
  for (const k of kws) {
    const strong = countIn(strongHay, k.forms);
    const weak = countIn(hay, k.forms);
    let sc = strong >= 2 ? 100 : strong === 1 ? 85 : weak >= 3 ? 70 : weak >= 1 ? 55 : 0;
    let word = k.token;
    if (sc === 0 && k.grams.length) {
      const gs = countIn(strongHay, k.grams);
      const gw = countIn(hay, k.grams);
      sc = gs >= 2 ? 70 : gs === 1 ? 65 : gw >= 3 ? 50 : gw >= 1 ? 45 : 0;
      { const src = gs ? strongHay : hay; let bg = '', bc = 0;
        for (const g of k.grams) { const c = src.split(g).length - 1; if (c > bc) { bc = c; bg = g; } }
        word = bg || k.token; }
    }
    if (sc > bestScore) {
      bestScore = sc; bestWord = word;
      const src = sc >= 65 ? strongHay : hay;
      const idx = src.indexOf(word);
      bestSrc = idx >= 0 ? src.slice(Math.max(0, idx - 12), idx + word.length + 18).replace(/\n+/g, ' ') : '';
    }
  }
  const hitWords = kws.filter((k) => hay.includes(k.token) || strongHay.includes(k.token)).map((k) => k.token);
  return {
    score: bestScore,
    hit: kws.map((k) => k.token).join('/'),
    evidence: bestScore >= 55
      ? (bestSrc.trim() ? '「' + bestSrc.trim() + '」' : '命中：' + (bestWord || (hitWords[0] || kws[0].token)))
      : '全文没出现：' + (bestWord || (kws[0] ? kws[0].token : reqShort(reqText))),
  };
}

function scoreOne(req, r) {
  const out = { req, score: 0, hit: '', evidence: '' };
  let m = /(\d+(?:\.\d+)?)\s*年[^，,。;；]*?(经验|工作)/.exec(req);
  if (m) {
    const need = Number(m[1]);
    const have = r.yearsTotal == null ? 0 : r.yearsTotal;
    const yearScore = have >= need ? 100 : have >= need * 0.6 ? 55 : have > 0 ? 25 : 0;
    const cleaned = req.replace(/\d+(?:\.\d+)?\s*年(?:以上|及以上)?/g, ' ').replace(/经验|工作|优先|至少|左右|相关/g, ' ').trim();
    out.hit = '年限';
    if (!cleaned) {
      out.score = yearScore;
      out.evidence = '简历合计 ' + (have || '未知') + ' 年经验（要求 ' + need + ' 年）';
    } else {
      const ks = kwScore(cleaned, r);
      out.score = ks.score >= 0 ? Math.min(yearScore, ks.score) : yearScore;
      out.evidence = '年限：合计 ' + (have || '未知') + ' 年（要求 ' + need + '）；' + (ks.evidence || '领域词核对通过');
      out.hit += '+' + ks.hit;
    }
    return out;
  }
  m = /(博士|硕士|研究生|本科|大专|专科|学士)/.exec(req);
  if (m && /学历|学位|本科|大专|硕士|博士|学士|研究生|及以上/.test(req)) {
    const needRank = DEGREE_RANK[m[1]] || 0;
    const have = r.eduRank;
    out.score = have >= needRank ? 100 : have >= needRank - 1 ? 55 : have > 0 ? 20 : 0;
    out.hit = '学历';
    out.evidence = (r.school || '未写明院校') + (r.degree ? '·' + r.degree : '') + '（要求 ' + m[1] + '）';
    return out;
  }
  if (/985|211|双一流|qs\s*前|重点院校|名校/.test(req)) {
    const tier = schoolTier(r.school);
    out.score = tier === '985' ? 100 : tier === '211' ? 75 : r.school ? 30 : 0;
    out.hit = '院校';
    out.evidence = r.school ? r.school + (tier ? '（' + tier + '）' : '（不在 985/211 名单内）') : '未识别到院校';
    return out;
  }
  m = /(\d{2,3})\s*岁.{0,3}(以内|以下)?/.exec(req);
  if (m && /年龄|岁/.test(req)) {
    const cap = Number(m[1]);
    out.score = r.age == null ? 40 : r.age <= cap ? 100 : r.age <= cap + 3 ? 55 : 15;
    out.hit = '年龄';
    out.evidence = '候选人 ' + (r.age == null ? '未写年龄' : r.age + ' 岁') + '（要求 ≤' + cap + '）';
    return out;
  }
  const ks = kwScore(req, r);
  if (ks.score < 0) { out.score = 40; out.evidence = '这条拆不出可核对的词，按中性 40 记'; return out; }
  out.score = ks.score; out.hit = ks.hit; out.evidence = ks.evidence;
  return out;
}

function analyze(resume, reqText, opts) {
  const nowYear = (opts && opts.now ? new Date(opts.now) : new Date()).getFullYear();
  const lines = String(reqText || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const items = lines.map((line) => {
    let weight = 1;
    let req = line;
    let m = /^(\d{1,3})\s*[%％]\s*(.*)$/.exec(line);
    if (m) { weight = Number(m[1]); req = m[2]; }
    else { m = /^(.*?)[|｜]\s*(\d{1,3})\s*[%％]?$/.exec(line); if (m && m[2]) { req = m[1]; weight = Number(m[2]); } }
    const s = scoreOne(req, resume);
    return { req, weight, score: s.score, hit: s.hit, evidence: s.evidence };
  });
  const wsum = items.reduce((a, x) => a + x.weight, 0) || 1;
  const overall = items.length ? Math.round(items.reduce((a, x) => a + x.score * x.weight, 0) / wsum) : 0;
  const verdict = overall >= 75 ? '高匹配' : overall >= 50 ? '中等匹配' : '低匹配';
  return { items, overall, verdict, nowYear };
}

function trimYear(y) { return String(Math.round(y * 10) / 10).replace(/\.0$/, ''); }
function guessDomain(resume) {
  const roles = (resume.jobs || []).map((j) => j.role).join('') + (resume.intent || '');
  if (/调度|运力|物流|运输|配送|仓储|仓管/.test(roles)) return '物流';
  if (/会计|财务|出纳|税务/.test(roles)) return '财务';
  if (/销售|业务|客户/.test(roles)) return '销售';
  if (/工程师|技术|开发|架构/.test(roles)) return '技术';
  if (/运营|策划|内容/.test(roles)) return '运营';
  if (/招商|商业|地产|置业|购物中心|天街|万达|龙湖/.test(roles + resume.school + resume.intent)) return '商业地产招商';
  return '';
}

function summary(resume, match) {
  const parts = [];
  const who = resume.name || '候选人';
  if (resume.yearsTotal != null) parts.push(who + '约' + trimYear(resume.yearsTotal) + '年' + guessDomain(resume) + '经验');
  else parts.push(who);
  if (resume.school) parts.push(resume.school + (resume.degree || '') + (resume.major ? '·' + resume.major : ''));
  const good = match.items.filter((x) => x.score >= 75).map((x) => x.hit || x.req.slice(0, 8)).slice(0, 2);
  if (good.length) parts.push('命中' + good.join('、').slice(0, 24));
  const bad = match.items.filter((x) => x.score <= 40).map((x) => x.req.slice(0, 10)).slice(0, 2);
  if (bad.length) parts.push('但' + bad.join('、') + '未见体现');
  parts.push('综合匹配' + match.overall + '%，' + (match.overall >= 75 ? '建议约面' : match.overall >= 50 ? '可电话初筛' : '不建议投入'));
  let s = parts.join('，').replace(/，+/g, '，') + '。';
  if (s.length > 100) s = s.slice(0, 99) + '。';
  const pad = ['建议对照原简历补齐关键信息', '本段依据简历文本自动汇总', '数据以简历原文为准请人工复核'];
  let pi = 0;
  while (s.length < 50 && pi < pad.length) s = s.replace(/。$/, '') + '，' + pad[pi++] + '。';
  if (s.length < 50) s += '以上为工具初判。';
  if (s.length > 100) s = s.slice(0, 99) + '。';
  return s;
}

function ledgerText(resume, match) {
  const L = [];
  L.push((resume.name || '未识别姓名') + (resume.gender ? ' | ' + resume.gender : '') + (resume.age != null ? ' | ' + resume.age + '岁' : '') + (resume.city ? ' | ' + resume.city : ''));
  L.push('电话：' + (resume.phone || '未写') + (resume.email ? '  邮箱：' + resume.email : ''));
  L.push('学历：' + (resume.degree || '未识别') + (resume.school ? '  毕业院校：' + resume.school : '') + (resume.major ? '（' + resume.major + '）' : '') + (resume.eduPeriod ? ' ' + resume.eduPeriod : ''));
  L.push('总经验：' + (resume.yearsTotal != null ? trimYear(resume.yearsTotal) + ' 年' : '未识别') + (resume.intent ? '  求职意向：' + resume.intent : ''));
  L.push('履职时间：');
  if (resume.jobs.length) resume.jobs.forEach((j, i) => L.push('  ' + (i + 1) + '. ' + j.from + '-' + j.to + '  ' + (j.company || '公司未写明') + '  ' + (j.role || '职位未写明')));
  else L.push('  （没识别到带日期的履职段，检查原简历格式）');
  if (resume.skills.length) L.push('技能：' + resume.skills.slice(0, 8).join('、'));
  if (match) L.push('岗位匹配：' + match.overall + '%（' + match.verdict + '）');
  return L.join('\n');
}

function ledgerOneLine(resume, match) {
  const jobs = resume.jobs.map((j) => j.from + '-' + j.to + ' ' + (j.company || '') + (j.role || '')).join(' / ');
  return [
    resume.name || '', resume.age != null ? resume.age + '岁' : '', (resume.degree || '') + (resume.school ? '/' + resume.school : ''),
    resume.yearsTotal != null ? trimYear(resume.yearsTotal) + '年' : '', jobs,
    resume.skills.slice(0, 6).join('、'), match ? match.overall + '%/' + match.verdict : '',
  ].join('\t');
}

export { analyze, summary, ledgerText, ledgerOneLine, schoolTier, keywordsOf, expand };
