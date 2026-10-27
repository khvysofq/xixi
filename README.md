# xixi

当前是一个简单的静态 HTTP 服务。

## 启动

```bash
npm start
```

默认监听：

```text
http://0.0.0.0:10801
```

可通过环境变量调整：

```bash
HOST=127.0.0.1 PORT=10801 npm start
```

## 线上部署

访问地址：https://xixi.publicrandom.com/

链路：

```text
浏览器 -> nginx (发布服务器, 443/HTTPS)
       -> frps 127.0.0.1:20001
       -> frp 隧道 (paperclip 主机, frpc)
       -> node server.js 127.0.0.1:10801
```

本机（paperclip）由 systemd 托管，开机自启：

```bash
systemctl status xixi xixi-tunnel
systemctl restart xixi            # 只重启站点
journalctl -u xixi-tunnel -n 50  # 看隧道日志
```

- `xixi.service`：`/usr/bin/node server.js`，工作目录为本仓库，监听 `0.0.0.0:10801`
- `xixi-tunnel.service`：`/usr/local/bin/frpc -c /etc/frp/frpc-xixi.toml`，把本机 10801 映射到发布服务器 20001
- 发布服务器 nginx 站点：`/etc/nginx/sites-available/xixi.publicrandom.com`（改前备份同目录 `.bak-20261027`）

排障顺序：本机 `curl 127.0.0.1:10801` → 发布服务器 `curl 127.0.0.1:20001` → 公网 `curl https://xixi.publicrandom.com/`。

## 工具箱首页

站点首页（`/`）是**工具导航**：一张卡片一个工具，图标 + 名字 + 一句介绍。

清单只看 `public/tools.json`，首页渲染时去读它：

```json
{ "slug": "fee-calc", "name": "派费试算", "desc": "…",
  "href": "/tools/fee-calc/", "icon": "i-scale", "tags": ["运费"] }
```

- 有 `href` → 普通卡片，可点
- 占位（还没做）→ 写 `"state": "soon"` 且**不要写 href**，首页会渲染成虚线卡片 + 「待上线」，不可点（不会留死链）
- `icon` 是首页内联图标精灵里的 id（`i-table` / `i-csv` / `i-scale` / `i-tag` / `i-box` / `i-wish`）；加新图标就在 `public/index.html` 的 `<defs>` 里添一个 `<g id="i-xxx">`
- `tools.json` 读不到时（比如把首页下下来本地打开）会用页面里的内置备份清单，并显示一行提示

新增一个工具的步骤：

1. 在 `tools.json` 里加一条记录（做完了就把 `state: soon` 去掉、补上 `href`）
2. 页面放 `public/tools/<slug>/index.html`（目录请求会自动回退到 index.html）
3. 跑 `npm test`（有个用例专门检查“卡片不能指向不存在的页面、占位不能带 href”）

## 工具页面：派费分类统计

线上入口：https://xixi.publicrandom.com/tools/classify-stats/

页面是一个**全内联的单文件**（SheetJS / ExcelJS / ECharts 已打包在内），拖文件、算账、导出全部在浏览器本地完成，服务端只是发一个静态 HTML，不接收也不处理任何业务数据。

更新这个页面：

```bash
npm run deploy:tool -- --build                   # 重编并拷进 public/tools/classify-stats/index.html
node scripts/deploy-tool.cjs --tool csv-inspect  # 部署其他工具（--list 看可用工具）
```

工具源码在同一个工作区的 `../tools/classify-stats/`（含测试）。`server.js` 每次请求都从磁盘读文件，**换完产物不用重启服务**；改了 `server.js` 才需要 `systemctl restart xixi`。

> 仓库里存的是一份 2.76 MB 的构建产物（方便 clone 即可部署）。它是可再生物，如果不想让仓库变大，可以删掉 `public/tools/classify-stats/index.html` 并把它加进 `.gitignore`，改由 `npm run deploy:tool` 在部署时生成。

## 工具页面：CSV 体检

线上入口：https://xixi.publicrandom.com/tools/csv-inspect/

拖入 CSV/TSV，本地自动识别分隔符（逗号 / Tab / 分号 / 竖线）与编码（UTF-8 / UTF-8-BOM，非 UTF-8 回落 GB18030），给出每列类型判定、数值列合计/最值/平均、文本列高频值、前 100 行预览，以及「清洗后的 CSV（UTF-8 带 BOM）」与「列统计」两个导出。无外部依赖，页面只有 23 KB。

注意：GBK 解码靠浏览器自带的 `TextDecoder('gb18030')`。小 ICU 的 Node（比如本机）没有国标表，这种情况下会直接报错提示“另存为 UTF-8”，不会把乱码当数据算。

## 测试

```bash
npm test     # 5 个用例：注册表与真实页面一致、首页渲染/搜索/兜底、CSV 体检口径与导出
```

测试需要 `jsdom`。xixi 自己不装依赖时会借用同工作区 `../tools/classify-stats/node_modules`（见 `scripts/deps.cjs`）；单独 clone 本仓库时先跑 `npm install --no-save jsdom`。

## 结构

```text
server.js                              Node.js HTTP 服务（静态文件 + 目录 index 回退）
scripts/deploy-tool.cjs                把工具产物拷进站点，并登记到 tools.json
scripts/deps.cjs                       测试依赖解析
public/index.html                      工具箱首页（卡片导航 + 搜索）
public/tools.json                      工具清单（首页唯一数据源）
public/icon.png                        站点图标
public/wish-pool/index.html            原来的「xixi的许愿池」那一页
public/tools/classify-stats/index.html 派费分类统计工具（单文件构建产物）
public/tools/csv-inspect/index.html    CSV 体检工具（无依赖）
test/site.test.mjs                     站点级用例
```
