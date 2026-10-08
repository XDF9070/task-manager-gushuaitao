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
// ⭐ Supabase 配置
//    Project URL 已填好（来自你的项目 kjbykpzbzgypwnactmnos）
//    只剩 1 处要填：把下面 SUPABASE_ANON_KEY 引号里换成你的
//    「可发布密钥」（sb_publishable_ 开头的那串，点旁边的复制按钮）
//    获取位置：Supabase → Project Settings → API Keys
//    （旧版 eyJ 开头的 anon key 也能用）
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kjbykpzbzgypwnactmnos.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '在这里粘贴你的_sb_publishable_密钥';

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
    message: '还没有配置 Supabase 密钥，请编辑 server.js 第 18、19 行填入你的 Project URL 和 anon key'
  });
});

// 中间件：解析 JSON 请求体 + 托管 public 目录下的静态页面
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// API 接口
// ============================================================

// 查询任务列表（支持按优先级筛选）
// GET /api/tasks?priority=高
app.get('/api/tasks', async (req, res) => {
  try {
    const { priority } = req.query;

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
    res.json({ success: true, data });
  } catch (err) {
    console.error('查询任务失败：', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 新增任务
// POST /api/tasks  body: { title: "写作业", priority: "高" }
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, priority } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: '任务标题不能为空' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([
        {
          title: title.trim(),
          priority: priority || '中',
          completed: false
        }
      ])
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
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

    const { data, error } = await supabase
      .from('tasks')
      .update({ completed })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
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
