// 简历速看 → 单文件 HTML：引擎 + app + jszip + pdf.js(+worker base64) 全内联，离线双击可用。
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const xixi = path.join(root, '..', '..');
const vendor = (f) => fs.readFileSync(path.join(xixi, 'vendor', f), 'utf8');
const tag = (code) => `<script>\n${code}\n</script>`;

function moduleToClassic(src) {
  return src
    .replace(/^\s*import\s+[^;]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s*\([^)]*\);?\s*$/gm, '')
    .replace(/^export\s+(async\s+function|function|const|let|var|class)/gm, '$1')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
}

const engine = moduleToClassic(fs.readFileSync(path.join(root, 'extract.mjs'), 'utf8'))
  + '\n' + moduleToClassic(fs.readFileSync(path.join(root, 'match.mjs'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const workerB64 = fs.readFileSync(path.join(xixi, 'vendor', 'pdf.worker.min.js')).toString('base64');
if (Buffer.from(workerB64, 'base64').toString('base64') !== workerB64) { console.error('worker base64 往返不一致'); process.exit(1); }

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// 必须用函数形式替换：vendor 代码里有 $& 等符号会被字符串替换展开
const out = html
  .replace('<script src="vendor/jszip.min.js"></script>', () => tag(vendor('jszip.min.js')))
  .replace('<script src="vendor/pdf.min.js"></script>', () => tag(vendor('pdf.min.js')))
  .replace('<script src="vendor/pdf.worker.b64.js"></script>', () => tag('window.__PDFJS_WORKER_B64="' + workerB64 + '";'))
  .replace('<script type="module" src="app.js"></script>', () => tag('(function(){\n"use strict";\n/* engine:extract+match */\n' + engine + '\n/* app */\n' + app + '\n})()'));

if (/<script[^>]+src=/.test(out) || /type="module"/.test(out)) {
  console.error('⚠ 产物里仍有外部引用，离线双击会白屏'); process.exit(1);
}
for (const lib of ['jszip.min.js', 'pdf.min.js']) {
  if (!out.includes(vendor(lib))) { console.error('⚠ ' + lib + ' 内联时被改变了'); process.exit(1); }
}

const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, '简历速看.html'), out);
const pub = path.join(xixi, 'public', 'tools', 'resume-check');
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, 'index.html'), out);
console.log('已生成 dist/简历速看.html 与 public/tools/resume-check/index.html，共 ' + (Buffer.byteLength(out) / 1024 / 1024).toFixed(2) + ' MB');
