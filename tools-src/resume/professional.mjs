// 专业意见引擎：岗位要求 → 级别画像（执行层/中层/管理层）× 简历管理/横向信号 × 行业核心能力词典。
// 全本地规则，不上传数据。输出优缺点（带简历证据）+ 人力视角 + 业务线视角。

'use strict';

const LEVEL_WORDS = {
  mgmt: ['负责人', '总监', '总经理', '副总', '操盘', '带头人', '项目总'],
  mid: ['经理', '主管', '组长', '队长', '首席'],
  exec: ['专员', '助理', '文员', '实习', '基础', '干事'],
};
const LEVEL_NAME = { mgmt: '管理层岗', mid: '中层骨干岗', exec: '执行层岗' };

const INDUSTRY = {
  '商业地产招商': {
    core: [
      ['首店', '签约品牌', '品牌资源', '落位'],
      ['筹备期', '开业招商', '调改'],
      ['空置率', '出租率', '去化'],
      ['销售额', '坪效', '租金', '销售'],
      ['业态', '品牌'],
    ],
    coreNames: ['品牌资源与首店引入', '筹备期/调改操盘', '出租率经营意识', '销售与租金数据能力', '业态规划'],
    mgmtNeed: '独立带招商条线、团队搭建与考核',
    crossNeed: '跨部门（工程/运营/推广）与多项目协同',
  },
  '物流': {
    core: [['干线', '运力', '排线', '调度'], ['成本', '时效', '准点'], ['承运商', '车队', '供应商'], ['仓储', '库存', '盘点'], ['报表', '结算']],
    coreNames: ['运力调度', '成本时效管控', '承运商管理', '仓储作业', '对账结算'],
    mgmtNeed: '车队/站点团队管理',
    crossNeed: '与仓、客服、商务跨部门协同',
  },
  '财务': {
    core: [['账务', '凭证', '报表'], ['税务', '申报', '发票'], ['对账', '结算'], ['预算', '资金'], ['审计', '内控']],
    coreNames: ['核算与报表', '税务申报', '资金结算', '预算管控', '审计内控'],
    mgmtNeed: '财务团队分工与复核把关',
    crossNeed: '与业务、银行、税务、审计对接',
  },
  '销售': {
    core: [['客户开发', '签单', '业绩'], ['渠道', '大客户'], ['回款'], ['方案', '投标'], ['复购', '续约']],
    coreNames: ['获客签单', '渠道经营', '回款意识', '方案能力', '客户关系维护'],
    mgmtNeed: '销售团队带教与指标拆解',
    crossNeed: '与交付、产品、财务协同',
  },
};

function detectIndustry(resume, reqText) {
  const hay = String(reqText) + ' ' + (resume.intent || '') + ' ' + resume.jobs.map((j) => j.role + ' ' + j.desc.join(' ')).join(' ');
  if (/招商|购物中心|商业地产|业态|铺位|租赁|天街|大悦城|万达/.test(hay)) return '商业地产招商';
  if (/物流|调度|运力|仓储|干线|快递|货运|供应链/.test(hay)) return '物流';
  if (/财务|会计|税务|资金|审计|出纳/.test(hay)) return '财务';
  if (/销售|业务拓展|大客户|bd/i.test(hay)) return '销售';
  return '';
}

function detectReqLevel(reqText) {
  for (const w of LEVEL_WORDS.mgmt) if (reqText.includes(w)) return 'mgmt';
  for (const w of LEVEL_WORDS.mid) if (reqText.includes(w)) return 'mid';
  for (const w of LEVEL_WORDS.exec) if (reqText.includes(w)) return 'exec';
  return 'mid';
}

function mgmtSignals(resume) {
  const jobText = resume.jobs.map((j) => j.role + ' ' + j.desc.join(' ')).join('\n');
  const sig = { teamMax: 0, acting: false, formalLeadTitle: false, leadWords: [], subNum: null, evidence: [] };
  const m1 = /下属人数[:：]?\s*(\d+)/.exec(resume.raw);
  if (m1) sig.subNum = Number(m1[1]);
  const numRe = /(?:组员|团队成员|部门成员|带团队|管理)\D{0,4}?(\d+)\s*人/g;
  let m;
  while ((m = numRe.exec(jobText))) {
    sig.teamMax = Math.max(sig.teamMax, Number(m[1]));
    sig.evidence.push(m[0]);
  }
  if (/代理|暂代|acting/i.test(jobText)) sig.acting = true;
  if (/负责人|总监|总经理|操盘|带头人/.test(resume.jobs.map((j) => j.role).join(''))) sig.formalLeadTitle = true;
  if (/组长|统筹|带领|主导/.test(jobText)) sig.leadWords.push('组长/统筹/主导');
  return sig;
}

function crossSignals(resume) {
  const text = resume.jobs.map((j) => j.desc.join(' ')).join(' ') + ' ' + resume.raw;
  const hits = [];
  for (const re of [/跨部门/g, /协同/g, /对接/g, /大区|华东区|区域内|多项目|区内.{0,6}(苏州|南京|济南|宁波|城市)/g, /统筹/g, /汇报对象/g]) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function coreHits(resume, industry) {
  const dict = INDUSTRY[industry];
  if (!dict) return { hitNames: [], missNames: [] };
  const text = resume.jobs.map((j) => j.role + ' ' + j.desc.join(' ')).join(' ') + ' ' + resume.skills.join(' ') + ' ' + resume.raw;
  const hitNames = [], missNames = [];
  dict.core.forEach((group, i) => {
    const found = group.find((g) => text.includes(g));
    if (found) hitNames.push(dict.coreNames[i] + '（证据：「' + found + '」）');
    else missNames.push(dict.coreNames[i]);
  });
  return { hitNames, missNames };
}

function professional(resume, reqText, match) {
  const level = detectReqLevel(reqText);
  const industry = detectIndustry(resume, reqText);
  const dict = INDUSTRY[industry] || null;
  const sig = mgmtSignals(resume);
  const cross = crossSignals(resume);
  const core = coreHits(resume, industry);
  const strengths = [], gaps = [];

  // 年限与级别匹配
  const yrs = resume.yearsTotal;
  if (yrs != null) {
    if (level === 'mgmt' && yrs >= 6) strengths.push('年限底盘够（' + yrs + ' 年），撑得起' + (dict ? dict.mgmtNeed.split('、')[0] : '管理岗') + '的时间门槛');
    else if (level === 'mgmt') gaps.push('总年限 ' + yrs + ' 年，冲管理层偏薄，先补操盘案例');
    else if (level === 'exec' && yrs > 8) strengths.push('经验充足，执行层岗位上手即战');
  }
  // 行业核心能力
  if (dict) {
    core.hitNames.slice(0, 3).forEach((h) => strengths.push(industry + '核心项在线：' + h));
    if (core.missNames.length) gaps.push('行业硬指标没看到：' + core.missNames.join('、'));
  }
  // 管理要求（人力最看这条）
  if (level === 'mgmt') {
    if (sig.formalLeadTitle && sig.teamMax >= 8) strengths.push('正式负责人 title 且带过 ' + sig.teamMax + ' 人，管理半径达标');
    else if (sig.teamMax > 0 || sig.formalLeadTitle || sig.leadWords.length) {
      const ev = sig.evidence.slice(0, 2).join('；') || sig.leadWords.join('');
      gaps.push('管理信号偏弱：最高 title 到' + (resume.jobs.map((j) => j.role).sort((a, b) => b.length - a.length)[0] || '经理') +
        '为止，管理经历是' + (sig.acting ? '「代理」性质的' : '') + '小组规模（约 ' + sig.teamMax + ' 人，证据：' + ev + '），没到独立搭团队、定编定岗的负责人量级');
    } else gaps.push('全文没有团队管理信号，而这条要求明确要' + (dict ? dict.mgmtNeed : '带团队'));
    const strongCross = cross.some((x) => /跨部门|多项目|大区/.test(x));
    if (strongCross && cross.length >= 2) strengths.push('横向协同有硬证据：' + cross.slice(0, 3).join('、'));
    else if (cross.length) gaps.push('横向沟通证据偏执行层：只有「' + cross.slice(0, 2).join('、') + '」这类区域协同支持，看不到与工程/运营/推广等条线跨部门操盘、多利益方平衡的案例');
    else gaps.push('横向沟通无证据：看不到跨部门/多项目协同经历（' + (dict ? dict.crossNeed : '跨部门协同') + '是负责人岗的生死线）');
  } else if (level === 'mid') {
    if (sig.teamMax > 0 || /组长|主管|统筹/.test(resume.jobs.map((j) => j.role + j.desc.join('')).join(''))) strengths.push('中坚岗要的小带队/统筹能力已具备（' + (sig.evidence[0] || '组长、统筹') + '）');
    if (yrs != null && yrs >= 5) strengths.push('同层级经验 ' + yrs + ' 年，属于该岗成熟区间');
  } else {
    if (yrs != null && yrs > 6) gaps.push('候选人资历高于执行岗要求，注意留任风险与薪资预期');
  }
  // 匹配度兜底
  if (match.overall >= 75 && !gaps.length) strengths.push('要点逐条基本全中，纸面无硬伤');

  const hrAdvice = level === 'mgmt'
    ? (gaps.some((g) => g.includes('管理'))
      ? '人力视角：按' + LEVEL_NAME[level] + '的标尺，管理幅度与正式任命经历是短板，若硬面，深挖「独立带过几个人、招过谁、开过谁」；若按高级经理岗用，则是优等生。'
      : '人力视角：管理层画像齐整，可约面，谈薪时确认现职级与授权范围。')
    : '人力视角：级别对位，无越级/低配风险，' + (match.overall >= 60 ? '可推进。' : '先电话核缺口。');
  const bizAdvice = dict
    ? '业务线视角：' + industry + '这条线，' + (strengths.filter((x) => x.includes(industry)).length ? '看家的' + strengths.filter((x) => x.includes(industry)).length + '项能力有真案例撑着' : '纸面行业动作偏少') +
      (level === 'mgmt' && gaps.some((g) => g.includes('管理')) ? '；但负责人要的不是个人业绩，是排兵布阵——他目前是“将”不是“帅”，给到高级经理是即战力，给到负责人要冒带教成本。' : '；按此级别配置可以直接接盘子。')
    : '业务线视角：未识别到行业专属词典，按通用级别画像给意见，建议补充岗位要点细化。';

  return { level, levelName: LEVEL_NAME[level], industry, strengths, gaps, hrAdvice, bizAdvice, sig, cross };
}

function professionalText(p) {
  const L = [];
  L.push('【专业意见】岗位画像：' + p.levelName + (p.industry ? ' · ' + p.industry : ''));
  if (p.strengths.length) L.push('优点：\n' + p.strengths.map((x, i) => ' ' + (i + 1) + '. ' + x).join('\n'));
  if (p.gaps.length) L.push('短板：\n' + p.gaps.map((x, i) => ' ' + (i + 1) + '. ' + x).join('\n'));
  L.push(p.hrAdvice);
  L.push(p.bizAdvice);
  return L.join('\n');
}

export { professional, professionalText, detectReqLevel, detectIndustry, mgmtSignals };
