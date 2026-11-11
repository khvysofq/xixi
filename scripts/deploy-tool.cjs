#!/usr/bin/env node
'use strict';

// 把工作区里某个工具的单文件产物部署到站点，并登记到工具箱首页。
// 用法：
//   node scripts/deploy-tool.cjs                      # 默认部署派费分类统计
//   node scripts/deploy-tool.cjs --tool csv-inspect   # 部署指定工具
//   加 --build 会先在工具目录里跑一次构建
//
// 注意：server.js 每次请求都从磁盘读文件，换完产物/改完 tools.json 不用重启服务。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const siteRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(siteRoot, '..');
const publicDir = path.join(siteRoot, 'public');
const registryFile = path.join(publicDir, 'tools.json');

const TOOLS = {
  'classify-stats': {
    dir: path.join(workspaceRoot, 'tools', 'classify-stats'),
    source: path.join('dist', '派费分类统计工具.html'),
    build: 'build.mjs',
  },
  'csv-inspect': {
    // 这个工具没有外部依赖也没有构建步骤，源文件就是站点上的页面
    dir: siteRoot,
    source: path.join('public', 'tools', 'csv-inspect', 'index.html'),
  },
  'scene-english': {
    // 页面本身零依赖；生成靠站点的 /api/scene-guide（服务端调网关，密钥不进浏览器）
    dir: siteRoot,
    source: path.join('public', 'tools', 'scene-english', 'index.html'),
  },
  'en-writing': {
    // 极简写作教练：主题本地随机，tips/批改走站点 /api/en-writing
    dir: siteRoot,
    source: path.join('public', 'tools', 'en-writing', 'index.html'),
  },
};

const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
const name = args.includes('--list') ? null : (get('--tool') || 'classify-stats');

if (args.includes('--list')) {
  console.log('可部署工具：', Object.keys(TOOLS).join(', '));
  process.exit(0);
}

if (!TOOLS[name]) {
  console.error(`不认识的工具「${name}」。可用：${Object.keys(TOOLS).join(', ')}`);
  process.exit(1);
}

const tool = TOOLS[name];
if (args.includes('--build') && tool.build) {
  execFileSync(process.execPath, [path.join(tool.dir, tool.build)], { stdio: 'inherit' });
}

const sourceFile = path.join(tool.dir, tool.source);
if (!fs.existsSync(tool.dir)) {
  console.error(`找不到工具目录：${tool.dir}`);
  console.error('如果这是新工具，先在 scripts/deploy-tool.cjs 的 TOOLS 里登记它。');
  process.exit(1);
}
if (!fs.existsSync(sourceFile)) {
  console.error(`找不到产物：${sourceFile}\n加上 --build 先构建一次。`);
  process.exit(1);
}

const target = path.join(publicDir, 'tools', name, 'index.html');
if (path.resolve(target) === path.resolve(sourceFile)) {
  console.log('源文件就是站点页面，跳过拷贝，只做检查与登记。');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target);
}

// 产物里不该再有外链脚本或 ES module，否则站点上一断网/换环境就白屏
const html = fs.readFileSync(target, 'utf8');
if (/<script[^>]+\bsrc=/i.test(html) || /type="module"/i.test(html)) {
  console.warn('⚠ 产物里仍有外部引用或 module 脚本，请检查构建');
}

// 登记：没有这条记录就按下面的默认文案补一条，有就只核对路径
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
const entry = registry.tools.find((t) => t.slug === name);
const href = `/tools/${name}/`;
if (!entry) {
  registry.tools.push({ slug: name, name, desc: '（记得补一句人话介绍）', href, icon: 'i-box', tags: ['本地计算'] });
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log(`已在 tools.json 新增 ${name}，记得把 name/desc/icon 改成正式文案。`);
} else if (entry.href !== href) {
  entry.href = href;
  delete entry.state;
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log('已更新 tools.json 里的路径。');
}

const bytes = fs.readFileSync(target);
const hash = crypto.createHash('md5').update(bytes).digest('hex').slice(0, 12);
console.log(`已部署 ${path.relative(siteRoot, target)}（${(bytes.length / 1048576).toFixed(2)} MB，md5 ${hash}）`);
console.log(`访问路径：${href}`);
