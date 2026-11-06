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

---

课程：低代码开发技术（实践） · 练习二
