// 测试依赖解析：xixi 自己不装依赖，优先用自己 node_modules，其次借用
// 同工作区 tools/classify-stats 已经装好的（CI/独立 clone 时请 npm install jsdom xlsx）。
'use strict';

const { createRequire } = require('node:module');
const path = require('node:path');

const siteRoot = process.cwd(); // npm test 一定在 xixi/ 下执行
const bases = [
  siteRoot + path.sep,
  path.resolve(siteRoot, '..', 'tools', 'classify-stats') + path.sep,
];

function reqAny(name) {
  let last;
  for (const base of bases) {
    try {
      return createRequire(base)(name);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`找不到依赖 ${name}（${last && last.code}）。在 xixi/ 下跑：npm install --no-save jsdom xlsx`);
}

const jsdomPkg = reqAny('jsdom');

module.exports = { JSDOM: jsdomPkg.JSDOM, VirtualConsole: jsdomPkg.VirtualConsole, xlsx: reqAny('xlsx') };
