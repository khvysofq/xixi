import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rp = require('../lib/resume-pro.js');

test('redact：身份证先于电话，姓名电话邮箱年龄全打', () => {
  const t = '张三 13800001111 zs@a.com 35岁 110101199001011234 微信:zhangsan2024 现居上海';
  const r = rp.redact(t);
  assert.ok(!r.includes('13800001111'), r);
  assert.ok(!r.includes('zs@a.com'), r);
  assert.ok(r.includes('【身份证】'), r);
  assert.ok(r.includes('【电话】'), r);
  assert.ok(r.includes('【邮箱】'), r);
  assert.ok(r.includes('【年龄】'), r);
});

test('validateInput：缺要求/简历太短直接拒', () => {
  assert.equal(rp.validateInput({ reqText: '', resumeText: 'x'.repeat(100) }).ok, false);
  assert.equal(rp.validateInput({ reqText: '招商负责人', resumeText: '太短' }).ok, false);
  const v = rp.validateInput({ reqText: '招商负责人', resumeText: '项目经历：筹备期集中签约品牌百余个，引进首店品牌50余个，空置率从8%压到3%，负责零售业态招商调改工作若干记录若干记录' });
  assert.equal(v.ok, true);
});

test('buildPrompt：人设+反模板+JSON 约束都在，简历文本注入', () => {
  const v = rp.validateInput({ reqText: '招商负责人', resumeText: '中海商业环宇城 高级招商经理 32万方项目 62亿销售 代理招商负责人 组员2人 部门4人 龙湖天街 招商主管 空置率8%到3% 签约品牌300+' });
  const p = rp.buildPrompt(v.input);
  assert.ok(p.includes('招商总经理'));
  assert.ok(p.includes('严禁模板话术'));
  assert.ok(p.includes('62亿'), '简历正文注入');
  assert.ok(p.includes('"probes"'), '输出 schema');
});

test('normalize：字段收紧，残缺重罚', () => {
  const d = rp.normalize({ domain: '商业地产招商', level_call: '是将不是帅', biz_view: '点评'.repeat(10), hr_view: '背调'.repeat(10), probes: ['追问1', '追问2', '追问3', '追问4', '追问5', '追问6', '追问7'] }, {});
  assert.equal(d.probes.length, 4 + 2, 'probes 超 6 条截断');
  assert.throws(() => rp.normalize({ biz_view: '', hr_view: 'x', probes: ['a'] }, {}), /没把点评写完整/);
  assert.throws(() => rp.normalize({ biz_view: 'x', hr_view: 'x', probes: [] }, {}), /没给面试追问/);
});

test('handleRequest：非法输入 400，不发模型', async () => {
  await assert.rejects(rp.handleRequest({ reqText: '', resumeText: '' }, '1.2.3.4'), (e) => e.status === 400);
});
