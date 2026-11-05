#!/usr/bin/env node
'use strict';

// 假的 `openclaw` CLI：给测试用。按 scene-guide 约定的信封格式回一段固定结果，
// 根据 --prompt 里出现的是 sections 还是 lines 判断是「更多表达」还是「情景对话」。

const args = process.argv.slice(2);
const idx = args.indexOf('--prompt');
const prompt = idx >= 0 ? String(args[idx + 1] || '') : '';

const isGuide = prompt.includes('"sections"');
const text = isGuide
  ? '```json\n{"sections":[{"title":"点单常用","items":[{"zh":"来一杯…, 少冰","en":"I\u0027ll have a \u2026, light ice","note":"light ice = 少冰，不是 less ice"},{"zh":"换燕麦奶","en":"could you make it with oat milk?"}]}],"patterns":[{"en":"Could I get \u2026?","zh":"能给我一个\u2026吗"}]}\n```'
  : 'Here you go: {"title":"咖啡店点单","scene":"Ordering coffee with a customisation","lines":[{"who":"A","en":"Hi, could I get a latte with oat milk?","zh":"嗨，能给我一杯拿铁，换燕麦奶吗？"},{"who":"B","en":"Sure, hot or iced?","zh":"可以，热的还是冰的？"},{"who":"A","en":"Iced, and go easy on the ice.","zh":"冰的，冰少一点。"}],"tips":["go easy on the ice 比 less ice 更像口语"]}';

if (process.env.FAKE_OPENCLAW_FAIL === '1') {
  console.log(JSON.stringify({ ok: false, error: { message: '模型那边挂了' } }));
  process.exit(0);
}
if (process.env.FAKE_OPENCLAW_GARBAGE === '1') {
  console.log('抱歉，我这次说不出 JSON');
  process.exit(0);
}
console.log(JSON.stringify({ ok: true, transport: 'gateway', provider: 'fake', model: 'fake/fast', outputs: [{ text, mediaUrl: null }] }));
