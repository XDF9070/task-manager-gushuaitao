# task-manager-顾帅涛

低代码开发技术（实践）—— **练习二：智能任务管理系统**。

Node.js + Express 提供 API，**Supabase** 存数据，浏览器页面操作。
部署后多人访问数据共享、不丢失。

## 项目结构

```
task-manager/
├── server.js              # Node.js + Express 服务器（提供 API + 托管页面）
├── package.json           # 项目依赖清单
├── vercel.json            # Vercel 部署配置
├── supabase-setup.sql     # ⭐ 数据库建表 SQL（要去 Supabase 执行）
├── public/
│   └── index.html         # 前端页面（浏览器里看的）
└── README.md
```

## 功能

- 输入框 + 优先级下拉（高/中/低）添加任务
- 任务列表显示标题、优先级、完成状态、创建时间
- 每条任务有「完成/未完成」切换按钮和「删除」按钮
- 按优先级筛选（全部/高/中/低）
- 中文界面，任务按创建时间倒序，已完成任务加删除线
- 额外：任务统计（总任务/已完成/完成率）、30 秒自动刷新（方便多设备看到彼此数据）

## 部署三步走

### 1️⃣ 建数据库表

Supabase 项目 → 左侧 **SQL Editor** → New query → 粘贴 `supabase-setup.sql` 全部内容 → **Run**。
看到 `Success. No rows returned` 即成功。

### 2️⃣ 填密钥

**Project URL 已填好**（`server.js` 第 21 行），只剩 1 处。

在 Supabase → **Project Settings → API Keys**，复制 **可发布密钥**
（`sb_publishable_` 开头；相当于旧版 anon key，⚠️ 不要用 `sb_secret_` 秘密密钥），
替换 `server.js` 第 22 行：

```js
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_你的密钥';
```

> 旧版 `eyJ` 开头的 anon key 也可以用。

### 3️⃣ 部署

推送到 GitHub 后，Vercel → Add New → Project → Import 该仓库 →
Framework 选 **Other** → Deploy。

> 💡 更规范的做法（附录A拓展题）：不把密钥写进代码，改成在
> Vercel 的 **Environment Variables** 里添加 `SUPABASE_URL` 和
> `SUPABASE_ANON_KEY` 两个变量。代码已经支持这种方式，加了环境变量
> 会优先读环境变量。

## 本地运行

```bash
npm install
npm start
```

浏览器打开 <http://localhost:3000>。

自测接口：访问 <http://localhost:3000/api/health>，返回
`{"ok":true,"supabaseUrlConfigured":true,"keyConfigured":true}` 说明密钥填好了。

## 常见问题

| 现象 | 原因 & 解决 |
|---|---|
| 页面能打开但列表一直"加载失败" | Supabase 密钥没填 / 填错。检查 `server.js` 第 22 行 |
| 报错含 `row-level security` | RLS 策略没建。重新执行 `supabase-setup.sql` 的第 3、4 段 |
| 报错含 `relation "tasks" does not exist` | 表没建。执行 `supabase-setup.sql` 的第 1 段 |
| Vercel 部署后 404 | `vercel.json` 或导出方式问题，检查该文件是否已推送 |

## V3.0 升级内容

V3 是**纯增量升级**：不动原有表结构语义、不清空任何数据，未执行迁移时自动降级为旧功能。

### 新增功能

| 功能 | 说明 |
|---|---|
| 九大视图 | 首页 / 今日任务 / 日历中心 / 全部任务 / 我的计划 / 专注中心 / 数据分析 / 分类管理 / 系统设置 |
| 日历中心 | 月 / 周 / 日三种视图，按截止日期落点 |
| 子任务 | 每个任务可拆多条，带完成进度（1/3） |
| 番茄钟 | 25/5/15 分钟三档，记录落库，可关联具体任务 |
| 年度热力图 | 类似 GitHub 贡献图，数据来自 `task_events` 事件表 |
| 重复任务 | 每天 / 每周 / 每月，完成后自动生成下一次，超过终止日期停止 |
| 看板 | 待办 / 进行中 / 已完成三列拖拽，状态真实落库 |
| 数据分析 | 30 天柱状图、每周趋势、分类完成率、月度概览 |
| 备份恢复 | 导出 JSON / CSV（带 BOM 防 Excel 乱码），导入按「标题 + 截止日期」判重，绝不覆盖 |

### 升级步骤（必做一次）

Supabase → SQL Editor → 粘贴 `supabase/migration-v3.sql` → Run。
脚本是幂等的，可重复执行；只会 `create table` / `add column`，不会删除任何数据。

执行后重启服务，控制台出现「✅ 检测到 V3 迁移已完成」即成功。

### 新增接口

```
GET    /api/meta                    能力探测（前端据此隐藏不支持的功能）
GET    /api/tasks/:id/subtasks      子任务列表
POST   /api/tasks/:id/subtasks      新增子任务
PATCH  /api/subtasks/:id            勾选 / 改名
DELETE /api/subtasks/:id            删除子任务
GET    /api/categories              分类列表
POST   /api/categories              新增分类
PATCH  /api/categories/:id          改名 / 改色
DELETE /api/categories/:id          删除分类
POST   /api/pomodoro                记录一次专注
GET    /api/pomodoro/stats          专注统计
GET    /api/stats/heatmap           年度热力图
GET    /api/stats/overview          概览统计
GET    /api/export?format=json|csv  导出备份
POST   /api/import                  导入备份（merge 判重）
```

### 时区说明

数据库存 UTC，统计与热力图按自然日归属。默认按北京时间（UTC+8）分天，
避免 0:00–8:00 完成的任务被算到前一天；如需改时区，设置环境变量
`APP_TZ_OFFSET_MIN`（例如 `0` 表示 UTC）。

### 自动化测试

```bash
PORT=3100 node server.js                 # 先起服务
node scripts/test-ui.js http://127.0.0.1:3100    # 42 项界面测试
node scripts/test-v3-api.js http://127.0.0.1:3100 # 58 项接口测试
```

两个脚本都会自动创建并清理自己的测试数据，不会污染既有任务。

---

课程：低代码开发技术（实践） · 练习二
