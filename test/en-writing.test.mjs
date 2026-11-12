// 英文写作教练的生成模块单测：题库、校验、提示词、归一。不调模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ew = require(path.join('..', 'lib', 'en-writing.js'));

test('本地题库：够大、字段齐、只分叙述/讨论两类', () => {
  assert.ok(ew.TOPICS.length >= 20, `题库至少 20 个，实际 ${ew.TOPICS.length}`);
  ew.TOPICS.forEach((t) => {
    assert.ok(t.en && t.zh && t.hint, '每条都要有英文题面、中文和方向提示');
    assert.ok(['叙述', '讨论'].includes(t.type), `type 只能是叙述/讨论：${t.type}`);
  });
});

test('随机主题避开上一个，不会连着给同一题', () => {
  const first = ew.TOPICS[0].en;
  for (let i = 0; i < 50; i++) {
    const t = ew.pickTopic(first);
    assert.notEqual(t.en, first, 'avoid 的那条不该再出现');
  }
  assert.ok(ew.pickTopic(null).en, '不传 avoid 也能出题');
});

test('校验：模式白名单、主题必填、作文有下限上限', () => {
  assert.equal(ew.validateInput({ mode: 'nonsense' }).ok, false);
  assert.equal(ew.validateInput({ mode: 'topic' }).ok, true, 'topic 不需要参数');
  assert.equal(ew.validateInput({ mode: 'tips' }).ok, false, '没主题不给生成 tips');
  const bad = ew.validateInput({ mode: 'correct', topic: 'A trip gone wrong', text: 'too short' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /60 个字符/, '太短要说清门槛');
  const huge = ew.validateInput({ mode: 'correct', topic: 'A trip gone wrong', text: 'x'.repeat(ew.CONFIG.maxText + 10) });
  assert.equal(huge.ok, false);
  assert.match(huge.error, /太长/);
  const ok = ew.validateInput({ mode: 'correct', topic: 'A trip gone wrong', text: 'I '.repeat(80) });
  assert.equal(ok.ok, true);
});

test('tips 提示词：结构钉死、贴着主题、范文不许抄', () => {
  const p = ew.buildTipsPrompt({ topic: 'Describe a meal you still remember.', topicZh: '描述一顿你至今记得的饭', type: '叙述' });
  assert.match(p, /"tenses"/);
  assert.match(p, /"moves"/);
  assert.match(p, /"phrases"/);
  assert.match(p, /"sample"/);
  assert.match(p, /2~3/, '时态条数写死');
  assert.match(p, /贴着给定主题/, '不许给通用词表');
  assert.match(p, /<<<英文主题/, '用户素材进定界块');
});

test('correct 提示词：quote 必须逐字来自原文、rewrite 不添油加醋、要给正反馈', () => {
  const p = ew.buildCorrectPrompt({ topic: 'T', text: 'I very like the meal.' });
  assert.match(p, /"errors"/);
  assert.match(p, /"rewrite"/);
  assert.match(p, /"highlight"/);
  assert.match(p, /必须逐字来自原文/);
  assert.match(p, /不要新增原文没有的内容/);
  assert.match(p, /最多 12 条|最多 12/);
  assert.match(p, /I very like the meal\./, '原文要作为素材进 prompt');
  assert.match(p, /表达生硬/, 'kind 枚举里有生硬类');
  assert.match(p, /母语者在这个场合真会这么开口吗/, '要有 native 二审动作');
  assert.match(p, /open the light/, '给直译搭配当反例');
  assert.match(p, /播客或朋友/, '判断标准要具体');
  assert.match(p, /才许交空数组/, '没硬伤不等于没问题');
});

test('normalizeTips：各组封顶、残条丢弃、全空报错', () => {
  const fat = {
    tenses: [{ name: 'a', example: 'x' }, { name: 'b', example: 'y' }, { name: 'c', example: 'z' }, { name: 'd', example: 'w' }],
    moves: Array.from({ length: 8 }, (_, i) => ({ en: 'm' + i, zh: '' })).concat([{ en: '', zh: '没英文' }]),
    phrases: Array.from({ length: 9 }, (_, i) => ({ en: 'p' + i, zh: '' })),
    sample: { en: 'ok', zh: '好' },
  };
  const out = ew.normalizeTips(fat, { topic: 'T' });
  assert.equal(out.tenses.length, 3);
  assert.equal(out.moves.length, 6, 'moves 截 6');
  assert.equal(out.phrases.length, 7, 'phrases 截 7');
  assert.equal(out.sample.en, 'ok');
  assert.throws(() => ew.normalizeTips({}, { topic: 'T' }), /没整理出/);
});

test('normalizeCorrect：错误截 12、缺 quote 或 fix 的丢弃、词数自己算', () => {
  const many = {
    errors: [{ quote: 'q0', fix: 'f0', why: 'native 不这么说', kind: '表达生硬' },
      ...Array.from({ length: 15 }, (_, i) => ({ quote: 'q' + (i + 1), fix: 'f' + (i + 1), why: 'w', kind: '语法' }))
        .concat([{ quote: '', fix: '没原句也算错账' }])],
    rewrite: 'Clean text.',
    comment: '不错',
    highlight: [{ en: 'nice bit', zh: '顺' }, { en: '', zh: '空的' }],
  };
  const out = ew.normalizeCorrect(many, { topic: 'T', text: 'I like a cat and a dog and a fish.' });
  assert.equal(out.errors.length, 12);
  assert.equal(out.errors[0].kind, '表达生硬', '生硬类的 kind 不能丢');
  assert.equal(out.highlight.length, 1, '空 highlight 丢弃');
  assert.equal(out.wordCount, 10, '词数按原文算（\S+ 计）');
  assert.throws(() => ew.normalizeCorrect({}, { topic: 'T', text: 'a b c' }), /没批改/);
});

/* ---------- 学习画像（跨篇台账） ---------- */

test('validateStats：少于 3 篇直接拒收，样本/句数/长度都有上限', () => {
  assert.equal(ew.validateStats(null).ok, false);
  assert.equal(ew.validateStats({ n: 2, samples: ['x'] }).ok, false, '样本太少不诊断');
  assert.match(ew.validateStats({ n: 2 }).error, /3 篇/);
  assert.equal(ew.validateStats({ n: 3 }).ok, false, '有 n 但没内容也不行');
  const fat = {
    n: 999, kindTotals: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['k' + i, i + 1])),
    samples: Array.from({ length: 20 }, () => 's'.repeat(500)),
    topQuotes: Array.from({ length: 30 }, (_, i) => 'q' + i),
    avgSentenceWords: 5000, simpleRate: 7,
  };
  const out = ew.validateStats(fat).stats;
  assert.equal(out.n, 200);
  assert.equal(Object.keys(out.kindTotals).length, 10);
  assert.equal(out.samples.length, 6);
  assert.ok(out.samples[0].length <= 400, '单篇节选截 400');
  assert.equal(out.topQuotes.length, 12);
  assert.equal(out.avgSentenceWords, 999);
  assert.equal(out.simpleRate, 1, '比率封顶 1');
});

test('profile 提示词：查句型单一和时态单一，讲台阶不并列，证据要能指出来', () => {
  const p = ew.buildProfilePrompt({ stats: { n: 6, kindTotals: { 时态: 9 }, samples: ['Last winter I go to a shop.'] } });
  assert.match(p, /多次批改/, '是跨篇画像不是单篇批改');
  assert.match(p, /只会写简单句|句型单一/);
  assert.match(p, /长短句结合|从句|非谓语|名词化/, '把 native 表达手段列全');
  assert.match(p, /一般过去时.*过去进行时.*现在完成时|叙事三件套/s, '时态循序渐进，不许甩十六时态');
  assert.match(p, /台阶/, 'lessons 要排成递进');
  assert.match(p, /数字|频次/, 'evidence 必须拿台账数据说话');
  assert.match(p, /多读多练/, '禁止说空话（作为反例出现）');
  assert.match(p, /<<<本地统计/, '素材进定界块');
});

test('normalizeProfile：weak 截 4 且没证据的丢、lesson 截 4、全空报错', () => {
  const fat = {
    portrait: 'p',
    weaknesses: Array.from({ length: 6 }, (_, i) => ({ name: 'w' + i, evidence: 'e', how: 'h' }))
      .concat([{ name: '空口白话', evidence: '', how: '' }]),
    lessons: Array.from({ length: 6 }, (_, i) => ({ title: 'l' + i, examples: [{ wrong: 'a', right: 'b' }, { wrong: '', right: '' }, { right: 'keep' }], drill: 'd' })),
    next_focus: 'focus',
  };
  const out = ew.normalizeProfile(fat);
  assert.equal(out.weaknesses.length, 4);
  assert.ok(!out.weaknesses.some((w) => w.name === '空口白话'));
  assert.equal(out.lessons.length, 4);
  assert.equal(out.lessons[0].examples.length, 2, 'wrong/right 都空的丢');
  assert.equal(out.nextFocus, 'focus');
  assert.throws(() => ew.normalizeProfile({}), /没诊断出名堂/);
});

test('ask 校验：改法上下文与疑问都得带上，长度封顶', () => {
  const base = { mode: 'ask', topic: 'Describe a decision at work.', quote: 'needed fully considersation', fix: 'that needs careful consideration' };
  assert.equal(ew.validateInput(base).ok, false, '没问题不问');
  assert.match(ew.validateInput(base).error, /疑问/);
  assert.equal(ew.validateInput({ ...base, question: '为什么' , quote: '' }).ok, false, '不指明哪条不给问');
  const ok = ew.validateInput({ ...base, question: '我原句哪里散架了？consideration 不就是考虑吗', why: '定语从句缺关系词', kind: '语法', essay: 'x'.repeat(5000) });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.essay.length, 2000, '上下文截 2000');
});

test('ask 提示词：正面回应质疑、允许承认改错了、不许复读', () => {
  const p = ew.buildAskPrompt({ quote: 'needed fully considersation', fix: 'that needs careful consideration', why: '定语从句缺关系词，consideration 也拼错', kind: '语法', question: '我觉得原句能看懂啊？', essay: 'The plan needed fully considersation by the board.', topic: 'T' });
  assert.match(p, /没看懂、或者不服/);
  assert.match(p, /verdict/, 'confirmed/revised 二选一');
  assert.match(p, /嘴硬|承认/, '判重了要认');
  assert.match(p, /换个角度再讲/, '不许复读结论');
  assert.match(p, /术语出现就顺手翻译成人话/);
  assert.match(p, /The plan needed fully considersation/, '上下文进素材块');
});

test('normalizeAsk：answer 必填、只有 revised 才留修订意见、例句截 2', () => {
  const out = ew.normalizeAsk({
    answer: '因为 fully 修饰不了名词。',
    verdict: 'revised',
    revisedFix: '原句可保留，但拼写改成 consideration',
    examples: [{ en: 'a', zh: '甲' }, { en: 'b', zh: '乙' }, { en: 'c', zh: '丙' }],
  });
  assert.equal(out.verdict, 'revised');
  assert.ok(out.revisedFix.includes('拼写'));
  assert.equal(out.examples.length, 2);
  const keep = ew.normalizeAsk({ answer: 'x', verdict: 'confirmed', revisedFix: '不该出现', examples: [] });
  assert.equal(keep.verdict, 'confirmed');
  assert.equal(keep.revisedFix, '', '确认时不留修订');
  assert.throws(() => ew.normalizeAsk({ verdict: 'confirmed' }), /没答上话/);
});

test('model 校验：梗概太短拒收（范本不能靠编），长度封顶', () => {
  assert.equal(ew.validateInput({ mode: 'model', synopsis: '我出差延误了' }).ok, false);
  assert.match(ew.validateInput({ mode: 'model', synopsis: '我出差延误了' }).error, /30 字/);
  const ok = ew.validateInput({ mode: 'model', topic: 'A trip gone wrong', synopsis: '第一次独立出差赶飞机，结果航班在落地后延误四小时，同机舱一位老人把橙子分给大家，回去后我把事情讲给同事听' });
  assert.equal(ok.ok, true);
  const long = ew.validateInput({ mode: 'model', synopsis: '字'.repeat(1200) });
  assert.equal(long.input.synopsis.length, 900, '梗概截 900 字');
});

test('model 提示词：300~500 词、母语者讲亲历、不堆难词、覆盖情节点', () => {
  const p = ew.buildModelPrompt({ synopsis: '航班延误，老人分橙子', topic: 'A trip gone wrong' });
  assert.match(p, /300~500 词/);
  assert.match(p, /I will tell you about/, '点名禁套话开头（作为不许出现的例子）');
  assert.match(p, /长短句|5 词短句.*25 词|定语.*状语.*非谓语/s);
  assert.match(p, /GRE/, '禁难词');
  assert.match(p, /缩写/, 'must use contractions');
  assert.match(p, /不新增改变走向的大情节/);
  assert.match(p, /memorable/, '可背诵句要单列');
  assert.match(p, /中文故事梗概/, '梗概进定界块');
});

test('normalizeModel：段≤8、词数服务端自己数、memorable≤5、全空报错', () => {
  const many = {
    title: 'T',
    paras: Array.from({ length: 12 }, (_, i) => ({ en: 'word '.repeat(30) + i, zh: '中' + i })).concat([{ en: '', zh: '空段' }]),
    memorable: Array.from({ length: 8 }, (_, i) => ({ en: 'm' + i, zh: '' })),
  };
  const out = ew.normalizeModel(many, { synopsis: 's' });
  assert.equal(out.paras.length, 8);
  assert.equal(out.words, 248, '词数=各段合计');
  assert.equal(out.memorable.length, 5);
  assert.equal(out.kind, 'model');
  assert.throws(() => ew.normalizeModel({ paras: [] }, { synopsis: 's' }), /没写出范本/);
});

test('why 校验：范本原句必带、疑问要写清，不依赖主题', () => {
  assert.equal(ew.validateInput({ mode: 'why', sentence: 'Too short', question: '为什么这么用？' }).ok, false, '句子太短不给问');
  assert.equal(ew.validateInput({ mode: 'why', sentence: 'He just said, Have some. It helps.', question: '啊' }).ok, false);
  const ok = ew.validateInput({ mode: 'why', sentence: 'He just said, Have some. It helps.', question: 'It helps 为什么省主语？' });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.topic, '', 'why 不需要主题');
});

test('rec 校验：收藏表达至少 3 字符才有的推', () => {
  assert.equal(ew.validateInput({ mode: 'rec', expr: 'a' }).ok, false);
  const ok = ew.validateInput({ mode: 'rec', expr: 'What I remember most is not ___. It is ___.', zh: '我记得最清楚的不是…而是…' });
  assert.equal(ok.ok, true);
});

test('why 提示词：质疑先答是不是、口语人话翻译、例句换场景', () => {
  const p = ew.buildWhyPrompt({ sentence: 'Have some. It helps.', question: '省略主语不是错吗？', expr: 'It helps', topic: '' });
  assert.match(p, /先正面回答是\/不是/);
  assert.match(p, /术语出现就顺手翻译成人话/);
  assert.match(p, /不许照抄范例句充数/);
  assert.match(p, /一句话口诀/);
});

test('normalizeWhy：answer 必填、例句截 3、空例句丢', () => {
  const out = ew.normalizeWhy({ answer: '省主语是老话。', rule: '口语 It 常可省', examples: [{ en: 'a' }, { en: '' }, { en: 'c' }, { en: 'd' }] });
  assert.equal(out.examples.length, 3);
  assert.equal(out.rule, '口语 It 常可省');
  assert.throws(() => ew.normalizeWhy({ rule: 'x' }), /没答上话/);
});

test('normalizeRec：必须带 example.en、上限 4、全不合格报错', () => {
  const out = ew.normalizeRec({ rec: [
    { en: 'a', example: { en: 'ex a' }, note: 'n' },
    { en: 'b', example: { en: '' } },
    { en: '', example: { en: 'x' } },
    ...Array.from({ length: 5 }, (_, i) => ({ en: 'e' + i, example: { en: 'ex' + i } })),
  ] });
  assert.equal(out.rec.length, 4);
  assert.ok(!out.rec.some((r) => r.en === 'b'));
  assert.throws(() => ew.normalizeRec({ rec: [{ en: 'x' }] }), /没推出同类/);
});
