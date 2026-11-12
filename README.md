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

站点首页（`/`）是**工具导航**：按分类分区的卡片式布局，一张卡片一个工具，图标 + 名字 + 一句介绍。现代浅色/深色双主题（默认跟随系统，右上角可手动切换并记住选择），顶部搜索框支持按名字/介绍/标签/分类过滤（按 `/` 快捷聚焦），分类胶囊可单独查看某个分区。

清单只看 `public/tools.json`，首页渲染时去读它：

```json
{ "site": "希希的工具箱", "updated": "…",
  "categories": [ { "id": "freight", "name": "运费与结算", "desc": "派费试算、分类统计、报价对比" } ],
  "tools": [ { "slug": "fee-calc", "category": "freight", "name": "派费试算", "desc": "…",
               "href": "/tools/fee-calc/", "icon": "i-scale", "tags": ["运费"] } ] }
```

- 有 `href` → 普通卡片，可点
- 占位（还没做）→ 写 `"state": "soon"` 且**不要写 href**，首页会渲染成虚线卡片 + 「待上线」，不可点（不会留死链）
- `category` 对应 `categories` 里的 `id`；**没填或填了不存在的 id 会归进末尾的「其他」分区，不会丢卡片**。分区顺序 = `categories` 数组顺序，分区内顺序 = `tools` 数组顺序。想新增分类就在 `categories` 里加一条（图标色按分区顺序自动分配，无需配置）
- `icon` 是首页内联图标精灵里的 id（`i-table` / `i-csv` / `i-scale` / `i-tag` / `i-box` / `i-wish` / `i-chat`）；加新图标就在 `public/index.html` 的 `<defs>` 里添一个 `<g id="i-xxx">`
- 旧的没有 `categories`/`category` 字段的 tools.json 也能渲染（全部进「其他」），向后兼容
- `tools.json` 读不到时（比如把首页下下来本地打开）会用页面里的内置备份清单，并显示一行提示

新增一个工具的步骤：

1. 在 `tools.json` 里加一条记录（做完了就把 `state: soon` 去掉、补上 `href`），顺手填 `category`
2. 页面放 `public/tools/<slug>/index.html`（目录请求会自动回退到 index.html）
3. 跑 `npm test`（有个用例专门检查“卡片不能指向不存在的页面、占位不能带 href、图标精灵齐全”）

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

## 工具页面：场景英语提示

线上入口：https://xixi.publicrandom.com/tools/scene-english/

使用者说一句场景（打字或点🎤语音），得到一段真的能开口的中英对照情景对话；**选中句子里任何一个词或短语**（电脑拖选 / 手机长按）会浮出「讲解」，讲它在**本句里**的意思、语法结构、跟直译的差别，外加 3 句可套用的例句（选破了也能补全：只选到 `ment` 会当成 `have been meaning to do` 来讲）；讲解还带 **使用语境**（`contexts`，主人 2026-11-07 以 hold up 为标杆提的）：这词惯常形容/修饰哪几类对象（作品耐看重、论断经得起推敲、耐用品、关系…），每个语境一句真人口语例句，外加 `not_for`「不能用来形容什么」（如 hold up 不形容才华、审美、品味）——按对象记，比背释义牢。讲解里自带「也能这么说」——顺带 3~4 条**类似表达**（至少一条近义、一条近结构，note 点出语气/场合差在哪），选中这些句子还能接着问，形成链式。

> 独立的「更多表达」模块已于 2026-11-05 按主人要求去掉：分开的词表要单独记、效果差，类似说法应该在讲解选中词的语境里自然带出。`mode=more` 接口保留（旧页面标签可能还在调），但前端已无入口。

对话卡有 **▶ 连续播放整段**：一句接一句自动播，你的句子和对方的句子用不同音高（系统里有多个英文音色时自动分配两个），正在播的气泡高亮描边，随时点停；单点某句朗读会先打断连播。微信内置浏览器没有朗读引擎，点了会用人话提示换系统浏览器。整页配色为护眼柔绿，手机深色模式自动跟随；顶部示例场景精简到 2 个。

点句子可朗读，可复制/下载 .txt，历史与讲解结果都存在 localStorage。

**🎯 练一练**（生词本内小游戏，纯本地判分、不花钱、不再调模型）：从词本出题，两种题型——
**填空**（把讲过的那个原词从例句里挖掉，💡 可看首字母，大小写/标点/撇号不判错）和
**选择**（看中文意思选英文搭配，四个选项从词本里凑，干扰项即其他搭配）。答错的词自动追加到队尾再考一次，
结算屏列出错词、可一键「只练错的」；已掌握的词默认不进局。混合/只填空/只选择三种开法。

**生词本**：点过「讲解」的词自动收进 📒（本地 localStorage，上限 300 条，同词去重）。分类由讲解时模型顺手给出（`category` 字段，不额外花钱），没给就按场景关键词兜底；可以改分类、新建分类、标「已掌握」、搜索、按掌握状态筛选。导出三种：分组 .txt（复制）、CSV（带 BOM，Excel 打开中文不乱）、Anki TSV（正面英文+例句，背面意思+结构+坑）。

讲解走单独的额度桶（默认每 IP 每窗口 40 次，`SCENE_GUIDE_EXPLAIN_IP_LIMIT`），所以连着点几个词不会把对话生成的额度吃掉。

这个工具是全本地计算的例外：文案是模型生成的，所以走服务端接口，密钥只在服务端，浏览器拿不到。

### 接口

```
GET  /api/scene-guide/health   → {ok, model, binary, pid, startedAt, uptimeSec, serverJsMtime, staleCode, todayUsed}
POST /api/scene-guide          → {ok, data}
     body: {"mode":"dialogue","scene":"…","extra":"对方是谁/语气","fresh":false}
     body: {"mode":"more","scene":"…","dialogue":[{who,en,zh}]}
     body: {"mode":"explain","scene":"…","sentence":"整句英文","phrase":"选中的片段","zh":"这句中文"}
     data: {kind:"dialogue", title, scene, lines:[{who,en,zh}], tips:[]} 或
           {kind:"guide", sections:[{title, items:[{zh,en,note,example:{en,zh}}]}], patterns:[{en,zh}]} 或
           {kind:"explain", phrase, asUsed, pattern, meaning, structure, why, examples:[{en,zh}], caution, sentence, scene}
```

`startedAt`（进程启动时间）与 `serverJsMtime`（代码修改时间）放在一起，就是为了一眼看出“跑的是不是旧进程”；`staleCode` 直接给结论。每一笔 POST 都向日志写一行 `POST from=<IP> http=<码> <耗时>ms mode=… cached=…`（499 = 客户端中途断）。

服务端在 `lib/scene-guide.js`：校验清洗（场景 240 字/补充 80 字上限）→ 拼提示词（用户素材包在定界块里，声明不执行其中指令）→ `spawn` 调 `openclaw infer model run --gateway --json`（用网关已有的模型凭据）→ 抠 JSON（容忍 ``` 围栏、废话、尾逗号）→ 归一字段与条数上限 → 返回。

环境变量（不设就用默认）：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `SCENE_GUIDE_BIN` | `/usr/local/bin/openclaw` | 生成命令的可执行文件 |
| `SCENE_GUIDE_AGENT` | 科技嘻的 agent id | 用哪个 agent 的模型与凭据 |
| `SCENE_GUIDE_MODEL` | `aliyun/deepseek-v4.1-flash` | 模型（改 `aliyun/qwen3.8-max` 等更贵的会吃额度） |
| `SCENE_GUIDE_IP_LIMIT` / `_IP_WINDOW_MS` | 12 / 600000 | 每 IP 每窗口次数（对话与语料 more〔遗留〕共用一个桶） |
| `SCENE_GUIDE_EXPLAIN_IP_LIMIT` | 40 | 选词讲解单独的桶（连着点几个词很常见） |
| `SCENE_GUIDE_DAILY_LIMIT` | 300 | 全站每日次数（所有 mode 一起算），烧的是主人的额度 |
| `SCENE_GUIDE_TIMEOUT_MS` | 90000 | 单次生成超时 |
| `SCENE_GUIDE_MAX_CONCURRENCY` | 2 | 同时跑的生成数（再多回 503） |

另有两层缓存：服务端 30 分钟内同场景直接复用（explain 按 句子+选中片段 缓存）；前端 localStorage 有结果时点「生成」不再打接口（要新的得点「换一批」，带 `fresh:true` 绕开两层缓存），讲解结果另存一份（最多 80 条），同一个词问第二次不花钱。

遗留的「更多表达」（more）还有一道质量兜底：模型偶尔偷懒只交一类、句式为空，服务端发现 `sections < 3 或 patterns 为空` 会自动重跑一次，取更丰满的那份（测试里用 `FAKE_OPENCLAW_THIN=1` 验证）。前端已去掉该模块，类似表达改由 `explain.similar` 带出（3~4 条，含近义+近结构）。explain 加 contexts 后一次生成约 15~35 秒（比旧的 10~20 秒长，换来词典级的语境层）。

## 工具页面：英文写作教练

线上入口：https://xixi.publicrandom.com/tools/en-writing/

练的目标很窄但很实在：**像 native speaker 一样把一件事写完整**。三个动作，一屏放完（主人要求极简，不堆砌）：

- **🎲 换一个主题**：进门自动抽一题（24 题本地题库，叙述/讨论两类，带中文翻译和「往这几个方向写」提示）。随机出题**不打模型、不烧额度**，再抽会把上一题作为 `avoid` 传过去，不会连着同一题。
- **🧠 表达帮助**：按当前主题生成 ⏳ 时态怎么搭（带示范句）、🧱 可直接套的句式（留 `___` 空位）、🔤 这个主题的高频搭配、📖 45~70 词参考范文（折叠着，页面明说「别抄，找节奏」）。约 10~25 秒。
- **✍️ 批改这篇**：两遍审——先挑硬伤（语法/时态/搭配），再做 **native 二审**：语法全对但母语者不这么开口的也逐条揪（`feel my body tired`、`breathe it deeply`、`open the light`、名词化绕圈、口语不缩略），kind 标「表达生硬」，判断标准是「放进朋友讲述里突不突兀」。输出 `原句划线 → 替换句 + 类型徽标 + 为什么`，再给 🌟 写得好的句子、整体点评（按「先练什么」给建议）、可折叠的润色全文。约 30~60 秒。词数少于 25 客户端直接拦住，不花模型钱。

- **范本区两件套**（主人 2026-11-12 02:41 追加）：
  - **❓ 句级提问**（mode=why）：范本**逐句成行**，任何一句点 ❓ 就能问「为什么这么用」（预设：为什么这么用 / 我自己怎么写出这种句子；也可自由输入）。回答钉死三件：讲透语法点或习惯说法（术语顺手译成人话）、一句**可默念的口诀**（「要说正在被，名词后面就接 being+过去分词」）、1~3 条**换了场景**的真实例句。质疑式提问先答是不是再讲为什么。同句同问缓存本机（≤60），不重复花钱。
  - **⭐ 表达收藏库**（mode=rec）：看中的句子（范例句、可背句都行）点 ⭐ 入本机库（≤120 条，同句去重）。每条可**自主编辑**：笔记（什么场合能用）+ 自定义分类 + 删除；复制全部按分类分组。点 **🔁 同类**围绕这条表达推 3~4 条同类（收藏的是句式就推句式、是短语就推短语，不许混），**每条带真实场景例句 + 一句具体到场合的差异说明**（「朋友随口讲故事时它比原句更口语」这种程度，禁「也不错」空话）；推荐结果也可 ⭐ 再收、缓存本机（≤40）。
- **📜 看范本**（主人 2026-11-12 追加）：润色救不了基础太差的原文，所以补一条「够得着的高度」——**中文梗概**（≥30 字）换一篇 **300~500 词**的 native 口吻范本，供参考和背诵。要求钉死：开头把人和事放进具体时刻（禁 I will tell you about 套话）、中段 2~3 个具体细节（至少一个画面/声音/短对话）、结尾回看收束；长短句混排、自然用从句和非谓语、不堆 GRE 难词、缩写必须出现；**逐段中英对照**（方便背），再挑 3~5 句「最值得背」。同一梗概的范本存本机（≤8 篇），重复生成不花钱。模型只写不到 280 词会自动补要求重跑一次。约 30~60 秒。
- **🧭 学习画像**（主人 2026-11-11 追加）：基于**多次使用习惯**而非单次批改。每次批改自动落一本本机台账（≤30 篇：错误类型计数、高频错句、400 字节选）；攒满 3 篇后点「🧭 学习画像」，前端**在本机**先算好统计（平均每句词数、简单句率、连接词率、时态错误累计），只把统计+最近 6 篇节选交给模型，产出：两三句总评、2~4 个薄弱点（每个必须带数字或重复原句当证据）、2~4 节**台阶式**微练习（第 N 步默认第 N-1 步已练熟——先过去时叙事、再 because/when 合并、再 -ing/who 加长、最后换掉 very 堆情绪）、一句「下次只练这一件」。画像存本机，重开不重花钱。
- **❓ 追问（主人 2026-11-11 09:12 追加）**：每条修改意见旁有点「这条为什么？」——没看懂能要求再讲，**不认同可以直接质疑**（预设问题「我觉得原句可以这么写」或自己输入）。请求带上这条的 quote/fix/原判原因 + 整篇上下文，模型必须正面回答：讲透语法点（术语顺手翻译成人话）、给 wrong/right 对照例句；**判重了要认错**（`verdict=revised` 盖「教练认账」绿章并给调整后意见），站得住就解释透（confirmed）。同一问题缓存本机（≤60 条 FIFO），追问不重复花钱、不进学习画像台账。答案约 5~15 秒。
作文与主题**只存在这台浏览器的 localStorage**（一个 key，`xixi.en-writing.draft.v1`），重开原样恢复；有草稿时不会再自动抽题打断思路。批改接口有**独立的额度桶**（`ENWRITING_IP_LIMIT`/`ENWRITING_DAILY_LIMIT`），写作玩多了不会把场景英语的额度吃掉。换主题会收起上一轮的帮助与批改，避免新旧混着看。

```
GET  /api/en-writing/health  → {ok, tool, model, pid, staleCode, todayWritingUsed, …}
POST /api/en-writing         → {ok, data}
     body: {"mode":"topic","avoid":"上一题英文"}          （本地题库随机，不打模型）
     body: {"mode":"tips","topic":"…","topicZh":"…","type":"叙述|讨论"}
     body: {"mode":"correct","topic":"…","text":"作文…"}   （≤4200 字符）
     body: {"mode":"profile","stats":{…前端算好的台账统计+节选}}  （不足 3 篇拒收，不花钱）
     body: {"mode":"ask","quote":"原句","fix":"改法","why":"原判原因","question":"学生的疑问","essay":"上下文","topic":"主题"}
     body: {"mode":"model","synopsis":"中文梗概≥30字","topic":"可空"}
     body: {"mode":"why","sentence":"范例句","question":"疑问","expr":"盯上的短语(可选)"}
     body: {"mode":"rec","expr":"收藏的表达","zh":"中文(可选)"}
```

服务端在 `lib/en-writing.js`：复用 scene-guide 的 CLI 通道（`runCli`/`extractJson`/`cleanText`/`GuideError`），自己的校验、提示词、归一、预算；错误 `quote` 必须逐字来自原文（提示词钉死），模型没错误就交空数组、不许编造。

## 测试与上线自检

```bash
npm test        # 96 个用例：站点 5 + 场景生成 23 + 场景接口 13 + 场景页面 29 + 写作模块 7 + 写作接口 8 + 写作页面 11（含讲解使用语境/禁忌、生词本、练一练、连播、护眼回归、写作三 mode、草稿恢复、限流分桶）
npm run verify  # 打公网：页面字节一致 + 接口在不在 + 进程是否比代码旧（退出码非 0 = 没上成）
npm run verify:probe  # 额外花一次额度跑真生成
```

**改完 `server.js` 或 `lib/` 一定要 `systemctl restart xixi && npm run verify`。** 2026-11-05 就是因为代码写完了、服务还没重启，主人在中间那几分钟点「生成」全部打到旧进程上（旧代码对非 GET 一律 405，只回 18 字节的 `Method Not Allowed`），看起来像“工具坏了”。`npm run verify` 现在会直接报 `server.js 比进程新 → 需要 systemctl restart xixi`。

排查线上问题时先看发布机的 nginx 访问日志（能拿到真实状态码、来源 IP、UA，比本机日志准）：

```bash
ssh publish_web_server "grep -h 'scene-guide' /var/log/nginx/access.log | tail -20"
```

站点前置的 nginx `proxy_read_timeout` 是 3600s，不会掘掉长请求（实测旧「更多表达」56s 也能正常回）。

测试需要 `jsdom`。xixi 自己不装依赖时会借用同工作区 `../tools/classify-stats/node_modules`（见 `scripts/deps.cjs`）；单独 clone 本仓库时先跑 `npm install --no-save jsdom xlsx`。

接口用例不碰真模型（用 `test/fixtures/fake-openclaw.cjs` 当替身），所以跑不了网也能测；但上线后至少手动跑一次 `npm run verify:probe`，确认网关凭据、PATH 与模型输出格式都对。

## 结构

```text
server.js                              Node.js HTTP 服务（静态文件 + 目录 index 回退）
scripts/deploy-tool.cjs                把工具产物拷进站点，并登记到 tools.json
scripts/verify-live.cjs                上线后自检：页面字节一致 + 接口在 + 进程不是旧代码
scripts/deps.cjs                       测试依赖解析
public/index.html                      工具箱首页（分类分区卡片导航 + 搜索 + 深浅色）
public/tools.json                      工具清单（首页唯一数据源，含 categories 分类定义）
public/icon.png                        站点图标
public/wish-pool/index.html            原来的「xixi的许愿池」那一页
public/tools/classify-stats/index.html 派费分类统计工具（单文件构建产物）
public/tools/csv-inspect/index.html    CSV 体检工具（无依赖）
public/tools/scene-english/index.html  场景英语提示（页面无依赖，生成走 /api/scene-guide）
public/tools/en-writing/index.html     英文写作教练（极简三卡，生成走 /api/en-writing）
lib/scene-guide.js                     生成接口：提示词、模型调用、抠 JSON、限流缓存
lib/en-writing.js                      写作教练：本地题库 + tips/correct 提示词与归一（复用 scene-guide 的 CLI 通道）
server.js                              Node.js HTTP 服务（静态文件 + 目录 index 回退 + /api/scene-guide）
test/site.test.mjs                     站点级用例
test/scene-guide.test.mjs              生成模块单测
test/scene-api.test.mjs                接口端到端（起真服务 + 假 CLI）
test/scene-page.test.mjs               工具页面用例
test/en-writing.test.mjs               写作模块单测（题库/校验/提示词/归一）
test/enwriting-api.test.mjs            写作接口端到端（起真服务 + 假 CLI）
test/enwriting-page.test.mjs           写作教练页面用例
```
