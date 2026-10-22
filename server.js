// ============================================================
// 智能任务管理系统 - 后端服务器
// Node.js + Express 提供 API，Supabase 存数据
// ============================================================

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// ⭐ Supabase 配置（已全部填好，无需再改）
//    Project URL 与可发布密钥均来自你自己的 Supabase 项目
//    如需改用环境变量：在 Vercel 里配置 SUPABASE_URL / SUPABASE_ANON_KEY
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kjbykpzbgypwnactmnos.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';

// 是否已经填好密钥（没填时服务器照常启动，页面会给出友好提示）
const CONFIGURED =
  /^https?:\/\//i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes('在这里粘贴');
// 创建 Supabase 客户端（未配置时给一个占位 URL，避免启动即崩溃）
const supabase = createClient(
  CONFIGURED ? SUPABASE_URL : 'https://placeholder.supabase.co',
  CONFIGURED ? SUPABASE_ANON_KEY : 'placeholder-anon-key'
);

// 未配置密钥时，所有 /api/tasks 请求直接返回友好错误
app.use('/api/tasks', (req, res, next) => {
  if (CONFIGURED) return next();
  res.status(500).json({
    success: false,
    message: '还没有配置 Supabase 密钥，请检查 server.js 第 21、22 行的 SUPABASE_URL 和 SUPABASE_ANON_KEY'
  });
});

// 中间件：解析 JSON 请求体 + 托管 public 目录下的静态页面
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 字段名自适应
//   不同人建表时「完成状态」字段可能叫 completed 或 is_complete，
//   这里自动探测，两种都能用，前端统一拿到 completed 字段。
// ============================================================
let DONE_COL = null; // 实际使用的字段名
let HAS_DUE_DATE = null; // 是否存在截止日期字段（拓展练习1）

async function detectDoneColumn() {
  if (DONE_COL) return DONE_COL;

  // 依次尝试：能查通的就是它
  for (const col of ['completed', 'is_complete']) {
    const { error } = await supabase.from('tasks').select(col).limit(1);
    if (!error) {
      DONE_COL = col;
      console.log(`✅ 完成状态字段探测结果：${col}`);
      return col;
    }
  }

  // 两个都查不到，兜底用 completed 并让上层报错
  DONE_COL = 'completed';
  console.warn('⚠️  无法探测完成状态字段，可能是表结构不匹配');
  return DONE_COL;
}

// 探测 tasks 表是否有 due_date 字段（拓展练习1：截止日期）
async function detectDueDate() {
  if (HAS_DUE_DATE !== null) return HAS_DUE_DATE;
  const { error } = await supabase.from('tasks').select('due_date').limit(1);
  HAS_DUE_DATE = !error;
  console.log(`✅ due_date 字段探测结果：${HAS_DUE_DATE ? '存在' : '不存在（请执行 拓展练习.sql）'}`);
  return HAS_DUE_DATE;
}

// 把数据库返回的行统一成前端要的格式（completed 字段）
function normalizeTask(row) {
  if (!row) return row;
  const col = DONE_COL || 'completed';
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    completed: row.completed !== undefined ? row.completed : row[col],
    due_date: row.due_date || null,
    created_at: row.created_at
  };
}

// ============================================================
// API 接口
// ============================================================

// 查询任务列表（支持按优先级筛选）
// GET /api/tasks?priority=高
app.get('/api/tasks', async (req, res) => {
  try {
    const { priority } = req.query;
    await detectDoneColumn();

    // 按创建时间倒序（最新的在最上面）
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });

    // 如果有 priority 参数且不是"全部"，就加上筛选条件
    if (priority && priority !== '全部') {
      query = query.eq('priority', priority);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json({ success: true, data: (data || []).map(normalizeTask) });
  } catch (err) {
    console.error('查询任务失败：', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 新增任务
// POST /api/tasks  body: { title: "写作业", priority: "高" }
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, priority, dueDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: '任务标题不能为空' });
    }

    // 按实际字段名写入
    const doneCol = await detectDoneColumn();
    const hasDue = await detectDueDate();

    const newRow = {
      title: title.trim(),
      priority: priority || '中',
      [doneCol]: false
    };
    // 表里有 due_date 字段且前端传了截止日期时才写入
    if (hasDue && dueDate) newRow.due_date = dueDate;

    const { data, error } = await supabase
      .from('tasks')
      .insert([newRow])
      .select();

    if (error) throw error;
    res.json({ success: true, data: normalizeTask(data[0]) });
  } catch (err) {
    console.error('新增任务失败：', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 切换任务完成状态
// PATCH /api/tasks/:id  body: { completed: true }
app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;

    const doneCol = await detectDoneColumn();

    const { data, error } = await supabase
      .from('tasks')
      .update({ [doneCol]: completed })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ success: true, data: normalizeTask(data[0]) });
  } catch (err) {
    console.error('更新任务失败：', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除任务
// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.from('tasks').delete().eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('删除任务失败：', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 健康检查（部署后可用来自测）
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    configured: CONFIGURED,
    supabaseUrlConfigured: /^https?:\/\//i.test(SUPABASE_URL),
    keyConfigured: !SUPABASE_ANON_KEY.includes('在这里粘贴')
  });
});

// 深度诊断：直接测试能否连上 Supabase（排查 fetch failed 用）
app.get('/api/diag', async (req, res) => {
  const result = { url: SUPABASE_URL, steps: [] };

  // 步骤1：用原生 fetch 探测 REST 端点
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    result.steps.push({ step: 'fetch /rest/v1/', http: r.status });
  } catch (e) {
    result.steps.push({
      step: 'fetch /rest/v1/',
      error: e.message,
      cause: e.cause ? String(e.cause.code || e.cause.message) : null,
      causeDetail: e.cause ? String(e.cause) : null
    });
  }

  // 步骤2：通过 supabase-js 查询
  try {
    const { data, error } = await supabase.from('tasks').select('id').limit(1);
    result.steps.push({
      step: 'supabase-js select',
      ok: !error,
      error: error ? error.message : null,
      details: error ? { code: error.code, hint: error.hint, details: error.details } : null,
      rows: data ? data.length : null
    });
  } catch (e) {
    result.steps.push({
      step: 'supabase-js select',
      thrown: e.message,
      cause: e.cause ? String(e.cause) : null
    });
  }

  // 步骤3：环境信息
  result.env = {
    node: process.version,
    hasProxy: !!(process.env.HTTPS_PROXY || process.env.https_proxy),
    proxy: process.env.HTTPS_PROXY || process.env.https_proxy || null,
    noProxy: process.env.NO_PROXY || process.env.no_proxy || null
  };

  res.json(result);
});

// 启动服务器
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 智能任务管理系统已启动：http://localhost:${PORT}`);
    if (!CONFIGURED) {
      console.log('⚠️  还没填 Supabase 密钥，页面可以打开，但添加/查询任务会提示配置缺失。');
      console.log('   请编辑 server.js 第 18、19 行，填入你的 Project URL 和 anon key。');
    } else {
      console.log('🔗 已连接 Supabase，数据库操作可用。');
    }
  });
}

module.exports = app;
