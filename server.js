// ============================================================
// 智能任务管理系统 - 后端服务器 v3
// Node.js + Express 提供 API，Supabase 存数据
//
// v3 升级说明（安全增量，不破坏原有功能）：
//   1. 保留 v2 全部接口和字段自适应逻辑
//   2. 新增 /api/ai/chat 代理（AI Key 在服务端环境变量）
//   3. 新增 /api/pomodoro 番茄钟专注记录（可选表，不存在时优雅降级）
//   4. 数据库密钥只存在于服务端，前端永远拿不到
// ============================================================

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Supabase 配置（连接方式与 v1 完全一致，环境变量优先）
//   Vercel 里配置了 SUPABASE_URL / SUPABASE_ANON_KEY 就用环境变量，
//   否则回退到这里的默认值（保证老部署不会因为缺变量而挂掉）
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kjbykpzbgypwnactmnos.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';

const CONFIGURED =
  /^https?:\/\//i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes('在这里粘贴');

const supabase = createClient(
  CONFIGURED ? SUPABASE_URL : 'https://placeholder.supabase.co',
  CONFIGURED ? SUPABASE_ANON_KEY : 'placeholder-anon-key'
);

const PRIORITIES = ['高', '中', '低'];
const CATEGORIES = ['学习', '工作', '健身', '生活'];

// 未配置密钥时，所有 /api/tasks 请求直接返回友好错误
app.use('/api/tasks', (req, res, next) => {
  if (CONFIGURED) return next();
  res.status(500).json({
    success: false,
    message: '还没有配置 Supabase 密钥，请检查 server.js 里的 SUPABASE_URL 和 SUPABASE_ANON_KEY'
  });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // 页面本身不缓存，避免升级后用户还看到旧版本
    if (/\.(html|css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// ============================================================
// 表结构探测（字段名自适应）
//   doneCol        completed / is_complete 两种叫法都兼容
//   hasDueDate     是否存在 due_date
//   hasCategory    是否存在 category（v2 新增，需执行 migration-v2.sql）
//   hasCompletedAt 是否存在 completed_at（v2 新增，用于折线图精确统计）
// ============================================================
const caps = {
  doneCol: null,
  hasDueDate: null,
  hasCategory: null,
  hasCompletedAt: null,
  detectedAt: 0
};

// 探测结果缓存有效期：用户在 Supabase 里执行完迁移后，最迟 20 秒自动生效，
// 写操作还会额外强制重探一次，避免"刚加完字段但缓存仍是旧值"导致分类写不进去。
const CAPS_TTL = 20 * 1000;

async function columnExists(col) {
  const { error } = await supabase.from('tasks').select(col).limit(1);
  return !error;
}

async function detectCaps(force = false) {
  if (!force && caps.hasCategory !== null && Date.now() - caps.detectedAt < CAPS_TTL) {
    return caps;
  }

  if (force || !caps.doneCol) {
    caps.doneCol = 'completed';
    for (const col of ['completed', 'is_complete']) {
      if (await columnExists(col)) { caps.doneCol = col; break; }
    }
    console.log(`✅ 完成状态字段：${caps.doneCol}`);
  }

  caps.hasDueDate = await columnExists('due_date');
  caps.hasCategory = await columnExists('category');
  caps.hasCompletedAt = await columnExists('completed_at');
  caps.detectedAt = Date.now();

  console.log(
    `✅ 表结构：due_date=${caps.hasDueDate ? '有' : '无'} ` +
    `category=${caps.hasCategory ? '有' : '无'} ` +
    `completed_at=${caps.hasCompletedAt ? '有' : '无'}`
  );
  return caps;
}

// 把数据库返回的行统一成前端要的格式（老字段保持原样）
function normalizeTask(row) {
  if (!row) return row;
  const col = caps.doneCol || 'completed';
  return {
    id: row.id,
    title: row.title,
    priority: row.priority || '中',
    category: row.category || null,
    completed: row.completed !== undefined ? !!row.completed : !!row[col],
    due_date: row.due_date || null,
    created_at: row.created_at || null,
    completed_at: row.completed_at || null
  };
}

// 统一错误返回
function fail(res, err, action) {
  console.error(`${action}失败：`, err.message);
  const missingCol = err.code === '42703';
  res.status(500).json({
    success: false,
    message: missingCol
      ? `数据库缺少字段（${err.message}），请先在 Supabase SQL Editor 执行 migration-v2.sql`
      : err.message
  });
}

// ============================================================
// API 接口
// ============================================================

// 能力探测：前端据此决定是否显示"数据库升级"提示
app.get('/api/meta', async (req, res) => {
  try {
    await detectCaps();
    res.json({
      success: true,
      version: '3.0',
      configured: CONFIGURED,
      features: {
        category: !!caps.hasCategory,
        completedAt: !!caps.hasCompletedAt,
        dueDate: !!caps.hasDueDate
      },
      categories: CATEGORIES,
      priorities: PRIORITIES
    });
  } catch (err) {
    fail(res, err, '探测表结构');
  }
});

// 查询任务列表（保留 ?priority= 兼容旧前端）
// GET /api/tasks?priority=高
app.get('/api/tasks', async (req, res) => {
  try {
    const { priority } = req.query;
    await detectCaps();

    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });

    if (priority && priority !== '全部') {
      query = query.eq('priority', priority);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: (data || []).map(normalizeTask) });
  } catch (err) {
    fail(res, err, '查询任务');
  }
});

// 新增任务
// POST /api/tasks  body: { title, priority?, category?, dueDate? }
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, priority, category, dueDate } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: '任务标题不能为空' });
    }
    if (String(title).trim().length > 200) {
      return res.status(400).json({ success: false, message: '任务标题不能超过 200 个字' });
    }
    if (priority && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: '优先级只能是 高 / 中 / 低' });
    }

    let c = await detectCaps();
    // 带了分类但缓存说没这字段 → 强制重探（迁移刚执行完的场景）
    if (category && !c.hasCategory) c = await detectCaps(true);

    const newRow = {
      title: String(title).trim(),
      priority: priority || '中',
      [c.doneCol]: false
    };
    if (c.hasDueDate && dueDate) newRow.due_date = dueDate;
    if (c.hasCategory && category) newRow.category = category;

    const { data, error } = await supabase.from('tasks').insert([newRow]).select();
    if (error) throw error;

    res.json({ success: true, data: normalizeTask(data[0]) });
  } catch (err) {
    fail(res, err, '新增任务');
  }
});

// 更新任务（完成状态 + 完整编辑共用）
// PATCH /api/tasks/:id  body 可含: completed, title, priority, category, dueDate
app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    let c = await detectCaps();
    if (body.category !== undefined && !c.hasCategory) c = await detectCaps(true);

    const patch = {};

    if (body.completed !== undefined) {
      patch[c.doneCol] = !!body.completed;
      if (c.hasCompletedAt) {
        patch.completed_at = body.completed ? new Date().toISOString() : null;
      }
    }
    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) return res.status(400).json({ success: false, message: '任务标题不能为空' });
      if (t.length > 200) return res.status(400).json({ success: false, message: '任务标题不能超过 200 个字' });
      patch.title = t;
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) {
        return res.status(400).json({ success: false, message: '优先级只能是 高 / 中 / 低' });
      }
      patch.priority = body.priority;
    }
    if (body.category !== undefined && c.hasCategory) {
      patch.category = body.category || null;
    }
    if (body.dueDate !== undefined && c.hasDueDate) {
      patch.due_date = body.dueDate || null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: '没有需要更新的字段' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select();

    if (error) throw error;
    if (!data || !data.length) {
      return res.status(404).json({ success: false, message: '任务不存在或已被删除' });
    }

    res.json({ success: true, data: normalizeTask(data[0]) });
  } catch (err) {
    fail(res, err, '更新任务');
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
    fail(res, err, '删除任务');
  }
});

// 健康检查（部署后可用来自测）
app.get('/api/health', async (req, res) => {
  const base = {
    ok: true,
    version: '2.0',
    configured: CONFIGURED,
    supabaseUrlConfigured: /^https?:\/\//i.test(SUPABASE_URL),
    keyConfigured: !SUPABASE_ANON_KEY.includes('在这里粘贴')
  };
  if (!CONFIGURED) return res.json(base);
  try {
    await detectCaps();
    base.database = {
      reachable: true,
      features: {
        category: !!caps.hasCategory,
        completedAt: !!caps.hasCompletedAt,
        dueDate: !!caps.hasDueDate
      }
    };
    res.json(base);
  } catch (err) {
    res.status(500).json({ ...base, ok: false, message: err.message });
  }
});

// 深度诊断：直接测试能否连上 Supabase（排查 fetch failed 用）
app.get('/api/diag', async (req, res) => {
  const result = { url: SUPABASE_URL, steps: [] };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    result.steps.push({ step: 'fetch /rest/v1/', http: r.status });
  } catch (e) {
    result.steps.push({
      step: 'fetch /rest/v1/',
      error: e.message,
      cause: e.cause ? String(e.cause.code || e.cause.message) : null
    });
  }

  try {
    const { data, error } = await supabase.from('tasks').select('id').limit(1);
    result.steps.push({
      step: 'supabase-js select',
      ok: !error,
      error: error ? error.message : null,
      rows: data ? data.length : null
    });
  } catch (e) {
    result.steps.push({ step: 'supabase-js select', thrown: e.message });
  }

  result.env = {
    node: process.version,
    hasProxy: !!(process.env.HTTPS_PROXY || process.env.https_proxy)
  };

  res.json(result);
});

// ============================================================
// AI 助手代理（Key 存在服务端环境变量，前端永不接触）
//   Vercel 环境变量：AI_API_BASE（默认 https://api.openai.com/v1）
//                    AI_API_KEY（sk-...）
//                    AI_MODEL（默认 gpt-3.5-turbo）
// ============================================================
const AI_API_BASE = process.env.AI_API_BASE || 'https://api.deepseek.com/v1';
const AI_API_KEY = process.env.AI_API_KEY || 'sk-050cf2e99c694444ba800af662969677';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

app.post('/api/ai/chat', async (req, res) => {
  if (!AI_API_KEY) {
    return res.json({
      success: false,
      message: 'AI 未配置。请在 Vercel 环境变量中设置 AI_API_KEY。',
      reply: '⚠️ 后端尚未配置 AI API Key。请联系管理员在 Vercel 项目设置中添加 AI_API_KEY 环境变量后重启部署。'
    });
  }
  try {
    const userMessage = (req.body && req.body.message) || '';
    if (!userMessage.trim()) {
      return res.status(400).json({ success: false, message: '消息不能为空' });
    }

    const aiRes = await fetch(`${AI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是一个任务管理助手。用户会用自然语言描述任务，你需要提取任务标题、优先级（高/中/低）、截止日期（YYYY-MM-DD格式）和分类（学习/工作/健身/生活）。以JSON格式返回：{"title":"任务标题","priority":"中","due_date":"2026-11-12","category":"学习"}。如果没有提到日期就填null，没有分类就填null。也可以用自然语言回复用户的问题。'
          },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3
      })
    });

    const data = await aiRes.json();
    if (!aiRes.ok) {
      throw new Error(data.error?.message || `AI 请求失败（HTTP ${aiRes.status}）`);
    }

    const reply = data.choices?.[0]?.message?.content || '无法解析，请换个说法试试。';
    res.json({ success: true, reply });
  } catch (err) {
    console.error('AI 请求失败：', err.message);
    res.status(500).json({ success: false, message: err.message, reply: '❌ AI 请求失败：' + err.message });
  }
});

// AI 配置状态查询（前端用来显示是否已连接）
app.get('/api/ai/status', (req, res) => {
  res.json({
    configured: !!AI_API_KEY,
    model: AI_MODEL,
    base: AI_API_BASE
  });
});

// ============================================================
// 番茄钟专注记录（可选，表不存在时优雅降级）
//   需要先在 Supabase 执行 migration-v3.sql 建表
// ============================================================
app.get('/api/pomodoro', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pomodoro_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    // 表不存在时返回空列表，不报错
    res.json({ success: true, data: [], warning: '番茄钟记录表未创建，请执行 migration-v3.sql' });
  }
});

app.post('/api/pomodoro', async (req, res) => {
  try {
    const { duration, type, task_title } = req.body || {};
    if (!duration || duration < 1) {
      return res.status(400).json({ success: false, message: '专注时长无效' });
    }
    const { data, error } = await supabase
      .from('pomodoro_sessions')
      .insert([{
        duration: duration,
        type: type || 'focus',
        task_title: task_title || null
      }])
      .select();
    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, warning: '番茄钟记录表未创建，请执行 migration-v3.sql' });
  }
});

// 启动服务器
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 智能任务管理系统 v2 已启动：http://localhost:${PORT}`);
    if (!CONFIGURED) {
      console.log('⚠️  还没填 Supabase 密钥，页面可以打开，但任务功能会提示配置缺失。');
    } else {
      console.log('🔗 已连接 Supabase，数据库操作可用。');
    }
  });
}

module.exports = app;
