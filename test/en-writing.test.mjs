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
