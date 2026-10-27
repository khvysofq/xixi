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

## 工具页面：派费分类统计

线上入口：https://xixi.publicrandom.com/tools/classify-stats/ （首页有入口卡片）

页面是一个**全内联的单文件**（SheetJS / ExcelJS / ECharts 已打包在内），拖文件、算账、导出全部在浏览器本地完成，服务端只是发一个静态 HTML，不接收也不处理任何业务数据。

更新这个页面：

```bash
npm run deploy:tool -- --build   # 重编工具并拷进 public/tools/classify-stats/index.html
```

工具源码在同一个工作区的 `../tools/classify-stats/`（含测试）。`server.js` 每次请求都从磁盘读文件，**换完产物不用重启服务**；改了 `server.js` 才需要 `systemctl restart xixi`。

> 仓库里存的是一份 2.76 MB 的构建产物（方便 clone 即可部署）。它是可再生物，如果不想让仓库变大，可以删掉 `public/tools/classify-stats/index.html` 并把它加进 `.gitignore`，改由 `npm run deploy:tool` 在部署时生成。

## 结构

```text
server.js                              Node.js HTTP 服务（静态文件 + 目录 index 回退）
scripts/deploy-tool.cjs                把分类统计工具产物拷进站点
public/index.html                      首页：xixi的许愿池 + 工具入口
public/icon.png                        站点图标与首页图片
public/tools/classify-stats/index.html 派费分类统计工具（单文件构建产物）
```
