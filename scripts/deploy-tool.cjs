#!/usr/bin/env node
'use strict';

// 把分类统计工具的单文件产物放进站点。
// 用法：node scripts/deploy-tool.cjs [--build]
// 注意：server.js 每次请求都从磁盘读文件，换完产物不用重启服务就生效。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const scriptsDir = __dirname;
const siteRoot = path.resolve(scriptsDir, '..');          // xixi/
const workspaceRoot = path.resolve(siteRoot, '..');       // 工作区根
const site = path.join(siteRoot, 'public');
const toolDir = path.join(workspaceRoot, 'tools', 'classify-stats');
const bundle = path.join(toolDir, 'dist', '派费分类统计工具.html');
const target = path.join(site, 'tools', 'classify-stats', 'index.html');

if (!fs.existsSync(toolDir)) {
  console.error(`找不到工具源码：${toolDir}\n这个脚本假设 xixi/ 与 tools/classify-stats/ 在同一个工作区里。`);
  process.exit(1);
}

if (process.argv.includes('--build')) {
  execFileSync(process.execPath, [path.join(toolDir, 'build.mjs')], { stdio: 'inherit' });
}

if (!fs.existsSync(bundle)) {
  console.error(`找不到产物：${bundle}\n先跑 npm run deploy:tool -- --build`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(bundle, target);

const size = fs.statSync(target).size;
const hash = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
console.log(`已部署 ${path.relative(siteRoot, target)}（${(size / 1048576).toFixed(2)} MB，md5 ${hash(fs.readFileSync(target))}）`);
console.log('访问路径：/tools/classify-stats/');
