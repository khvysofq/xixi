#!/usr/bin/env node
'use strict';

// 假的 `openclaw` CLI：给测试用。按 scene-guide 约定的信封格式回一段固定结果，
// 根据 --prompt 里的结构字段判断是「情景对话」「更多表达」还是「选词讲解」。

const args = process.argv.slice(2);
const idx = args.indexOf('--prompt');
const prompt = idx >= 0 ? String(args[idx + 1] || '') : '';

// FAKE_OPENCLAW_THIN=1 时第一次故意只交一类、句式为空（模拟模型偷懒），第二次才给满
let thin = false;
if (process.env.FAKE_OPENCLAW_THIN === '1' && isGuidePrompt(prompt)) {
  const fs = require('node:fs');
  const file = process.env.FAKE_OPENCLAW_TICK || '/tmp/fake-openclaw-tick';
  let n = 0;
  try { n = Number(fs.readFileSync(file, 'utf8')) || 0; } catch { /* 第一次 */ }
  n += 1;
  try { fs.writeFileSync(file, String(n)); } catch { /* 写不了就算了 */ }
  thin = n === 1;
}
function isGuidePrompt(text) { return text.includes('"sections"'); }

const isExplain = prompt.includes('"as_used"');
const isGuide = prompt.includes('"sections"');
let text;
if (thin) {
  text = '{"sections":[{"title":"点单常用","items":[{"zh":"来一杯","en":"I\'ll have a latte","example":{"en":"I\'ll have a latte.","zh":"来个拿铁。"}}]}],"patterns":[]}';
} else if (isExplain) {
  text = '{"phrase":"been meaning","as_used":"have been meaning to do sth","pattern":"have been meaning to do sth","meaning_zh":"一直想做但还没做成","structure_zh":"现在完成进行时：have been + doing，表示从之前持续到现在","why_zh":"不是打算做，是早就想做、一直没腾出手","examples":[{"en":"I\u0027ve been meaning to call him back.","zh":"我一直想给他回电话。"},{"en":"She\u0027s been meaning to try that place.","zh":"她一直想去试试那家店。"},{"en":"We\u0027ve been meaning to fix this for weeks.","zh":"这事我们一直想修，拖了好几周。"}],"caution":"别写成 I am meaning to do"}';
} else if (isGuide) {
  text = '```json\n{"sections":[{"title":"点单常用","items":[{"zh":"来一杯…, 少冰","en":"I\u0027ll have a \u2026, light ice","note":"light ice = 少冰，不是 less ice","example":{"en":"I\u0027ll have a latte, light ice please.","zh":"来个拿铁，少冰。"}},{"zh":"换燕麦奶","en":"could you make it with oat milk?","example":{"en":"Could you make it with oat milk?","zh":"能换成燕麦奶吗？"}}]},{"title":"忌口与调整","items":[{"zh":"我不吃…, 有过敏","en":"I\u0027m allergic to \u2026","example":{"en":"I\u0027m allergic to nuts, actually.","zh":"其实我对坚果过敏。"}}]},{"title":"结账","items":[{"zh":"能刷卡吗","en":"card or cash?","example":{"en":"Card or cash? I\u0027ll take the check.","zh":"刷卡还是现金？买单。"}}]}],"patterns":[{"en":"Could I get \u2026?","zh":"能给我一个\u2026吗"},{"en":"I\u0027ll have \u2026","zh":"我要点\u2026"}]}\n```';
} else {
  text = 'Here you go: {"title":"咖啡店点单","scene":"Ordering coffee with a customisation","lines":[{"who":"A","en":"Hi, could I get a latte with oat milk?","zh":"嗨，能给我一杯拿铁，换燕麦奶吗？"},{"who":"B","en":"Sure, hot or iced?","zh":"可以，热的还是冰的？"},{"who":"A","en":"Iced, and go easy on the ice.","zh":"冰的，冰少一点。"}],"tips":["go easy on the ice 比 less ice 更像口语"]}';
}

if (process.env.FAKE_OPENCLAW_FAIL === '1') {
  console.log(JSON.stringify({ ok: false, error: { message: '模型那边挂了' } }));
  process.exit(0);
}
if (process.env.FAKE_OPENCLAW_GARBAGE === '1') {
  console.log('抱歉，我这次说不出 JSON');
  process.exit(0);
}
console.log(JSON.stringify({ ok: true, transport: 'gateway', provider: 'fake', model: 'fake/fast', outputs: [{ text, mediaUrl: null }] }));
