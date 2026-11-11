# 智能任务管理系统 · 顾帅涛

低代码开发技术（实践）—— **练习二：智能任务管理系统**（v2 升级版）。

Node.js + Express 提供 API，**Supabase** 存数据，浏览器页面操作。
部署后多人访问数据共享、不丢失。

线上地址：<https://gushuaitao.de5.net/>

## 项目结构

```
task-manager/
├── server.js              # Node.js + Express 后端（API + 托管静态页面）
├── package.json           # 依赖清单
├── vercel.json            # Vercel 部署配置
├── supabase-setup.sql     # 首次建表 SQL（已执行过，勿重复执行第 5 段示例数据）
├── migration-v2.sql       # ⭐ v2 增量迁移（只加两个可选字段，不动老数据）
├── public/
│   ├── index.html         # 页面结构 + 图标库
│   ├── styles.css         # 浅蓝白主题 / 深色主题 / 响应式
│   └── app.js             # 前端逻辑（增删改查、筛选、图表、分页、提醒）
└── README.md
```

## 功能（v2）

**数据统计（全部来自数据库真实数据，无演示数字）**

- 总任务数 / 已完成 / 未完成 / 完成率 四张统计卡，带今日新增、今日完成、逾期数、环比
- 折线图：最近 7 天累计完成率
- 饼图：学习 / 工作 / 健身 / 生活 / 未分类 的任务占比

**任务管理**

- 添加、编辑、删除（删除前二次确认）、标记完成
- 优先级（高 / 中 / 低）、分类（学习 / 工作 / 健身 / 生活）、截止日期
- 搜索（标题模糊匹配）、排序（截止日期 / 优先级 / 创建时间 / 标题）
- 筛选：全部 / 今日 / 待完成 / 已完成 / 已逾期 + 分类筛选
- 分页（每页 5 / 6 / 10 / 20 条，可在设置里改）

**体验**

- 深色模式（偏好存本机）、每日任务提醒（页面内 + 浏览器通知）
- 全部操作有提示条；移动端抽屉式侧边栏；电脑 / 平板 / 手机自适应
- 断网时回退到本地缓存，不会白屏

## 数据库说明（重要）

v2 只做了**增量迁移**，完全不改动已有字段和数据：

```sql
alter table public.tasks add column if not exists category text;
alter table public.tasks add column if not exists completed_at timestamptz;
-- 回填历史完成时间（自动识别完成状态字段叫 completed 还是 is_complete）
```

完整脚本见 `migration-v2.sql`，也可直接在页面顶部的提示条点「复制迁移 SQL」。

- 没执行迁移时：增删改查、统计、折线图都正常，只有「分类」存不进去（页面顶部会有提示）
- 执行迁移后：分类、饼图、按分类筛选、批量归类全部可用
- 迁移执行完**不用重启、不用重新部署**：服务端探测结果缓存 20 秒，过期后自动识别新字段，写分类时还会强制重探一次
- 老任务的「完成时间」为空不影响折线图：前端按「创建当天即完成」处理，不会出现断层
- 密钥只存在于服务端，前端代码里没有任何数据库密钥

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks` | 任务列表（兼容旧的 `?priority=高` 参数） |
| POST | `/api/tasks` | 新增 `{ title, priority, category, dueDate }` |
| PATCH | `/api/tasks/:id` | 更新任意字段 `{ completed, title, priority, category, dueDate }` |
| DELETE | `/api/tasks/:id` | 删除 |
| GET | `/api/meta` | 能力探测（数据库当前支持哪些字段） |
| GET | `/api/health` | 健康检查 |

## 本地运行

```bash
npm install
npm start
```

浏览器打开 <http://localhost:3000>（端口可用 `PORT=3210 npm start` 改）。

## 部署

推送到 GitHub（`XDF9070/task-manager-gushuaitao`）后，Vercel 会自动构建部署；
也可在 Vercel → Add New → Project → Import 该仓库，Framework 选 **Other**。

> 💡 更规范的做法：不把密钥写进代码，在 Vercel 的 **Environment Variables**
> 里添加 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`。代码已支持，有环境变量时优先读环境变量。

## 常见问题

| 现象 | 原因 & 解决 |
|---|---|
| 页面能打开但列表一直"加载失败" | Supabase 密钥没填 / 填错，检查 `server.js` 的 `SUPABASE_ANON_KEY` |
| 报错含 `row-level security` | RLS 策略没建，重新执行 `supabase-setup.sql` 第 3、4 段 |
| 报错含 `relation "tasks" does not exist` | 表没建，执行 `supabase-setup.sql` 第 1 段 |
| 顶部提示"分类功能待启用" | 还没执行 `migration-v2.sql`，复制页面上的 SQL 到 Supabase SQL Editor 跑一次 |
| 老任务都显示"未分类" | 迁移不会猜分类。在「分类管理」里选「按标题智能识别」再点「一键归类」，识别不出的会保持原样 |

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
| AI 助手 | 后端代理调用 DeepSeek，自动带上当前任务清单，能给出排期建议；密钥只存在于服务端 |

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

### AI 助手配置

后端默认使用 DeepSeek（`deepseek-chat`），开箱即用。要换密钥或模型，在 Vercel
环境变量里设置 `AI_API_KEY`（或 `DEEPSEEK_API_KEY`）、`AI_MODEL`、`AI_API_BASE`
即可，环境变量优先级高于代码里的默认值，前端无需改动。

> 注意：默认密钥写在仓库里，仓库保持私有；若日后公开或转交他人，请先更换密钥。

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
