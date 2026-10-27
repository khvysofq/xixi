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

## 结构

```text
server.js          Node.js HTTP 服务
public/index.html  首页：xixi的许愿池
public/icon.png    站点图标与首页图片
```
