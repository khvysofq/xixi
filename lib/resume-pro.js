'use strict';

// 简历深度专业意见（/api/resume-pro）
// 规则引擎只能给模板级判断；这一路把「脱敏后的简历 + 岗位要求」交给主人自己网关里配置的模型，
// 人设钉死为「同职能资深操盘者（平级或高一级）+ 该条线猎头 HRD」，要求具体到行内口径，禁模板话术。
// 浏览器端先脱敏（姓名/电话/邮箱/年龄），服务端再兜底清洗一遍；不走任何第三方新服务，凭据仍是网关里的。

const sg = require('./scene-guide.js');

const { GuideError, runCli, extractJson, cleanText, createBudget } = sg;

const CONFIG = {
  bin: sg.CONFIG.bin,
  agentId: process.env.RESUME_PRO_AGENT || sg.CONFIG.agentId,
  model: process.env.RESUME_PRO_MODEL || 'sudo-ai/best',
  timeoutMs: Number(process.env.RESUME_PRO_TIMEOUT_MS || 150000),
  maxConcurrent: Number(process.env.RESUME_PRO_MAX_CONCURRENCY || 1),
  ipLimit: Number(process.env.RESUME_PRO_IP_LIMIT || 6),
  ipWindowMs: Number(process.env.RESUME_PRO_IP_WINDOW_MS || 10 * 60 * 1000),
  dailyLimit: Number(process.env.RESUME_PRO_DAILY_LIMIT || 60),
  cacheMs: Number(process.env.RESUME_PRO_CACHE_MS || 30 * 60 * 1000),
};

const budget = createBudget(CONFIG);
const cache = new Map();
let running = 0;

/* ---------- 脱敏兜底（前端已做第一遍，这里防直连 API 的调用） ---------- */

function redact(text) {
  return String(text ?? '')
    .replace(/\b\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '【身份证】')
    .replace(/1[3-9]\d{9}/g, '【电话】')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '【邮箱】')
    .replace(/微信[:：]?\s*\w{5,20}/g, '【微信】')
    .replace(/\d{2,3}\s*岁/g, '【年龄】')
    .replace(/(?:现居|居住地|所在地)[:：]?\s*[\u4e00-\u9fa5]{2,8}(?:市)?/g, '【所在地】');
}

/* ---------- 输入校验 ---------- */

function validateInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体必须是 JSON 对象' };
  const reqText = cleanText(body.reqText, 1500);
  if (reqText.length < 2) return { ok: false, error: '岗位要求没内容' };
  const resumeText = redact(cleanText(body.resumeText, 12000));
  if (resumeText.length < 40) return { ok: false, error: '简历正文太短，不像一份简历' };
  const rule = cleanText(body.rule, 1200);
  return { ok: true, input: { reqText, resumeText, rule } };
}

/* ---------- 提示词：内行评审，反模板 ---------- */

function buildPrompt(input) {
  return `你是一个人，不是评估系统。你的履历：商业地产/零售消费领域 15 年以上操盘手，现任集团招商总经理，亲自管过 10 万㎡ 级购物中心的筹备期开业和存量调改，签字批过几百份品牌租约，也面试过几百个招商条线的负责人；同时你干了多年这条线的猎头合伙人，市面上头部项目该职能的真实任期、水分和价码你都见过。现在有人递来一份候选人简历，要你以内行身份给用人方一句掏心窝的判断。

【目标岗位要求】
${input.reqText}

【本地规则引擎初判】（只是关键词层面的参考，你的判断如果更准，直接推翻它）
${input.rule || '无'}

【简历文本】（姓名/电话/邮箱/年龄已脱敏）
------
${input.resumeText}
------

硬性要求（违反任何一条即视为不合格）：
1. 严禁模板话术。「沟通能力强」「抗压能力待验证」「建议进一步考察」「具备一定管理经验」这种套在任何人都成立的话，一个字都不许出现。
2. 每个判断必须挂靠简历里的具体事实（公司/项目/数字/职务），并且用行内口径拆解，不是复述：例如「销售额 62 亿」要会问含不含超市等主力店、是不是全场口径、「首店 50 余个」要看品牌能级和一年存活率、「筹备期招商」看的是开业率、开业后一年掉铺率和调改动作，「空置率压到 3%」要看是几万方分母、接盘时什么行情。简历里数字经不起这样过的，就点名说疑点。
3. 先判断这个人实际属于哪个具体职能领域和目标岗位的真实量级，然后站在该领域【与目标岗位平级或高一级】的从业者角度挑剔：距离目标岗位还差哪几件硬事——操盘盘子体量（万方数、单店还是多项目）、是否正式任命独立带团队定编定岗、手里品牌资源是跟公司平台走的还是跟他自己走的、有没有跨工程/运营/推广/财务条线博弈的实录。哪几件事他确实已经过硬，也说清楚。
4. 岗位要求与简历明显错位（要求负责人而简历是中层，或反之），直接点破，并给出「按什么岗用他最划算、给什么薪酬带宽不吃亏」的可操作建议。
5. hr_view 从用人决策出发：任命与数字的背调要点（具体到该核哪份材料、找谁核）、每段任期长短透露的稳定性轨迹、大厂光环与个人贡献的区分、这个级别市场的薪酬倒挂风险。
6. probes 给 4~6 个验真伪的面试追问：每条都要具体到答得出来的人一定真做过——问数字口径、问决策链、问失败案例细节（如某品牌为什么没落位、掉铺怎么补）；禁止「你如何看管理能力」这类空话。
7. 语气像一个严格但在帮用人方省钱的老师傅，短句直给，不堆形容词。全部中文。

只输出一个 JSON 对象，不要任何其他文字：
{"domain":"候选人所属职能领域，≤12字","level_call":"一句话级别定性，≤60字","biz_view":"业务线内行点评，250~500字","hr_view":"人力/背调视角点评，120~300字","probes":["追问1","追问2","追问3","追问4"]}`;
}

/* ---------- 结果规整 ---------- */

function normalize(json, input) {
  const d = json && typeof json === 'object' ? json : {};
  const probes = (Array.isArray(d.probes) ? d.probes : []).slice(0, 6)
    .map((x) => cleanText(typeof x === 'string' ? x : x && x.text, 200)).filter(Boolean);
  const out = {
    domain: cleanText(d.domain, 40),
    levelCall: cleanText(d.level_call || d.levelCall, 120),
    biz: cleanText(d.biz_view || d.bizView, 1400),
    hr: cleanText(d.hr_view || d.hrView, 900),
    probes,
  };
  if (!out.biz || !out.hr) throw new GuideError(502, '模型这次没把点评写完整，重试一次');
  if (!out.probes.length) throw new GuideError(502, '模型这次没给面试追问，重试一次');
  return out;
}

/* ---------- 对外入口 ---------- */

let dayCheck = '';

async function handleRequest(body, ip) {
  const checked = validateInput(body);
  if (!checked.ok) throw new GuideError(400, checked.error);
  const input = checked.input;

  const verdict = budget.take(ip || 'unknown', 'main');
  if (!verdict.allowed) throw new GuideError(verdict.status, verdict.error);

  const key = input.reqText.toLowerCase().slice(0, 300) + '|' + input.resumeText.slice(0, 300);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CONFIG.cacheMs) return { ...hit.data, cached: true };

  if (running >= CONFIG.maxConcurrent) throw new GuideError(503, '深度点评同一时间只能跑一份，稍等半分钟再点');
  running += 1;
  try {
    let stdout = await runCli(buildPrompt(input), CONFIG);
    let envelope;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new GuideError(502, `生成服务返回读不懂：${String(stdout).slice(0, 200)}`);
    }
    if (!envelope.ok) throw new GuideError(502, `生成失败：${JSON.stringify(envelope.error || envelope).slice(0, 240)}`);
    const text = (envelope.outputs || []).map((o) => o.text).filter(Boolean).join('\n');
    if (!text.trim()) throw new GuideError(502, '模型这次什么都没说，重试一次');
    let data;
    try {
      data = normalize(extractJson(text), input);
    } catch (e) {
      // 输出截断或残缺时补跑一次，提示词里收紧字数
      const stdout2 = await runCli(buildPrompt(input) + '\n\n（上一次输出残缺。这次必须严格是单个完整 JSON，biz_view 控制在 300~400 字，probes 恰好 4 条。）', CONFIG);
      const env2 = JSON.parse(stdout2);
      if (!env2.ok) throw e;
      data = normalize(extractJson((env2.outputs || []).map((o) => o.text).filter(Boolean).join('\n')), input);
    }
    data.model = envelope.model || CONFIG.model;
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 60) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return data;
  } finally {
    running -= 1;
    dayCheck = new Date().toISOString().slice(0, 10);
  }
}

module.exports = {
  CONFIG,
  redact,
  validateInput,
  buildPrompt,
  normalize,
  handleRequest,
  budgetUsed: () => budget.peekDay(),
  _internals: { cache, runningCounter: () => running },
};
