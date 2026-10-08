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

---

课程：低代码开发技术（实践） · 练习二
