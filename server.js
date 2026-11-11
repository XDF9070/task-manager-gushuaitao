// ============================================================
// 智能任务管理系统 V3.0 · 后端服务器
// Node.js + Express + Supabase
//
// 设计原则：
//   1. 完全兼容 V1/V2 的接口与数据（旧前端、旧字段名都能跑）
//   2. 新功能按「能力探测」渐进启用：数据库没迁移时自动降级，不崩溃
//   3. 所有统计/导出都在服务端算，前端只负责展示
// ============================================================

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Supabase 配置（沿用原有硬编码值，环境变量优先级更高）
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kjbykpzbgypwnactmnos.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';

const CONFIGURED =
  /^https?:\/\//i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.includes('在这里粘贴');

const supabase = createClient(
  CONFIGURED ? SUPABASE_URL : 'https://placeholder.supabase.co',
  CONFIGURED ? SUPABASE_ANON_KEY : 'placeholder-anon-key'
);

// ------------------------------------------------------------
// AI 配置（可选，不配也能用其它功能）
// ------------------------------------------------------------
const AI_API_KEY = (process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
const AI_API_BASE = (process.env.AI_API_BASE || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
const AI_MODEL = (process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
const AI_READY = !!AI_API_KEY;

// ------------------------------------------------------------
// 基础中间件
// ------------------------------------------------------------
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => {
  if (CONFIGURED) return next();
  res.status(503).json({
    success: false,
    code: 'NO_DB',
    message: '尚未配置 Supabase，请设置 SUPABASE_URL 与 SUPABASE_ANON_KEY 环境变量'
  });
});

// 统一包装 async 路由，避免每个 try/catch 重复
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, status, code, message, extra) {
  return res.status(status).json(Object.assign({ success: false, code, message }, extra || {}));
}

// ============================================================
// 能力探测：数据库是否已执行 V3 迁移
//   - 列：status / repeat_type / repeat_until / series_id / category / completed_at
//   - 表：subtasks / pomodoro_sessions / task_events / categories
// 结果缓存 30 秒，避免每个请求都探测
// ============================================================
const CAP_COLUMNS = ['status', 'repeat_type', 'repeat_until', 'series_id', 'category', 'completed_at', 'due_date'];
const CAP_TABLES = ['subtasks', 'pomodoro_sessions', 'task_events', 'categories'];

let capCache = { at: 0, data: null };

async function detectCapabilities(force = false) {
  if (!force && capCache.data && Date.now() - capCache.at < 30000) return capCache.data;

  const columns = {};
  const tables = {};

  await Promise.all(CAP_COLUMNS.map(async (col) => {
    const { error } = await supabase.from('tasks').select(col).limit(1);
    columns[col] = !error;
  }));

  await Promise.all(CAP_TABLES.map(async (tbl) => {
    const { error } = await supabase.from(tbl).select('*').limit(1);
    tables[tbl] = !error;
  }));

  const data = { columns, tables, v3: columns.status && tables.subtasks && tables.task_events };
  capCache = { at: Date.now(), data };
  return data;
}

// 完成状态列名自适应（is_complete / completed）
let DONE_COL = null;
async function detectDoneColumn() {
  if (DONE_COL) return DONE_COL;
  for (const col of ['is_complete', 'completed']) {
    const { error } = await supabase.from('tasks').select(col).limit(1);
    if (!error) { DONE_COL = col; return col; }
  }
  DONE_COL = 'is_complete';
  return DONE_COL;
}

// ============================================================
// 工具函数
// ============================================================
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['高', '中', '低'];
const STATUSES = ['todo', 'doing', 'done'];
const REPEATS = ['none', 'daily', 'weekly', 'monthly'];

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// 统一时区分天：数据库存 UTC，统计/热力图按用户所在时区划分自然日。
// 默认北京时间（UTC+8），可用 APP_TZ_OFFSET_MIN 覆盖（例如 0 = UTC）。
const TZ_OFFSET_MIN = process.env.APP_TZ_OFFSET_MIN === undefined
  ? 480
  : Number(process.env.APP_TZ_OFFSET_MIN);

function dayKeyOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}

// 用于构造带时区的 ISO 边界，例如 2026-01-01T00:00:00+08:00
function tzSuffix() {
  const sign = TZ_OFFSET_MIN >= 0 ? '+' : '-';
  const abs = Math.abs(TZ_OFFSET_MIN);
  const p = (n) => String(n).padStart(2, '0');
  return `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

function todayStr() {
  return dayKeyOf(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 月度重复：目标月没有对应日期时取该月最后一天（1/31 → 2/28）
function addMonth(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  const p = (x) => String(x).padStart(2, '0');
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(day)}`;
}

function nextDueDate(due, type) {
  const base = isDate(due) ? due : todayStr();
  if (type === 'daily') return addDays(base, 1);
  if (type === 'weekly') return addDays(base, 7);
  if (type === 'monthly') return addMonth(base);
  return null;
}

// 把数据库行统一成前端契约（保留 V1/V2 字段，新增 V3 字段）
function normalizeTask(row, subMap) {
  if (!row) return null;
  const completed = row.completed !== undefined ? !!row.completed : !!row[DONE_COL || 'is_complete'];
  const sub = subMap && subMap[row.id] ? subMap[row.id] : null;
  const total = sub ? sub.total : 0;
  const done = sub ? sub.done : 0;

  return {
    id: row.id,
    title: row.title,
    priority: row.priority || '中',
    category: row.category || null,
    completed,
    status: row.status || (completed ? 'done' : 'todo'),
    due_date: row.due_date || null,
    created_at: row.created_at,
    completed_at: row.completed_at || null,
    repeat_type: row.repeat_type || 'none',
    repeat_until: row.repeat_until || null,
    series_id: row.series_id || null,
    subtask_total: total,
    subtask_done: done,
    progress: total ? Math.round((done / total) * 100) : (completed ? 100 : 0)
  };
}

// 批量取子任务进度，避免 N+1 查询
async function subtaskProgressMap(taskIds, caps) {
  const map = {};
  if (!caps.tables.subtasks || !taskIds.length) return map;
  const { data, error } = await supabase
    .from('subtasks')
    .select('task_id, done')
    .in('task_id', taskIds);
  if (error || !data) return map;
  data.forEach((s) => {
    if (!map[s.task_id]) map[s.task_id] = { total: 0, done: 0 };
    map[s.task_id].total += 1;
    if (s.done) map[s.task_id].done += 1;
  });
  return map;
}

async function logEvent(taskId, type) {
  const caps = await detectCapabilities();
  if (!caps.tables.task_events) return;
  await supabase.from('task_events').insert([{ task_id: taskId, type }]);
}

// ============================================================
// 任务列表
//   GET /api/tasks?status=&category=&priority=&q=&from=&to=&limit=
//   不带参数时行为与 V1 完全一致（按创建时间倒序返回全部）
// ============================================================
app.get('/api/tasks', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  await detectDoneColumn();

  const { status, category, priority, q } = req.query;
  const from = isDate(req.query.from) ? req.query.from : null;
  const to = isDate(req.query.to) ? req.query.to : null;
  const limit = Math.min(Number(req.query.limit) || 1000, 2000);

  let query = supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(limit);

  if (status && STATUSES.includes(status) && caps.columns.status) {
    query = query.eq('status', status);
  } else if (status === 'done' && !caps.columns.status) {
    query = query.eq(DONE_COL || 'is_complete', true);
  } else if (status === 'todo' && !caps.columns.status) {
    query = query.eq(DONE_COL || 'is_complete', false);
  }

  if (category && caps.columns.category) {
    if (category === '未分类') query = query.is('category', null);
    else query = query.eq('category', category);
  }
  if (priority && priority !== '全部') query = query.eq('priority', priority);
  if (q && String(q).trim()) query = query.ilike('title', `%${String(q).trim()}%`);
  if (from && caps.columns.due_date) query = query.gte('due_date', from);
  if (to && caps.columns.due_date) query = query.lte('due_date', to);

  const { data, error } = await query;
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const ids = (data || []).map((r) => r.id);
  const subMap = await subtaskProgressMap(ids, caps);

  res.json({
    success: true,
    data: (data || []).map((row) => normalizeTask(row, subMap)),
    capabilities: { v3: caps.v3, columns: caps.columns, tables: caps.tables }
  });
}));

// ============================================================
// 新增任务
//   POST /api/tasks
//   body: { title, priority, category, dueDate, repeatType, repeatUntil, status }
// ============================================================
app.post('/api/tasks', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const doneCol = await detectDoneColumn();

  const body = req.body || {};
  const title = cleanText(body.title, 200);
  if (!title) return fail(res, 400, 'INVALID_TITLE', '任务标题不能为空');

  const priority = PRIORITIES.includes(body.priority) ? body.priority : '中';
  const category = body.category ? cleanText(body.category, 20) : null;
  const dueDate = isDate(body.dueDate) ? body.dueDate : null;
  const repeatType = REPEATS.includes(body.repeatType) ? body.repeatType : 'none';
  const repeatUntil = isDate(body.repeatUntil) ? body.repeatUntil : null;
  const status = STATUSES.includes(body.status) ? body.status : 'todo';

  const row = {
    title,
    priority,
    [doneCol]: status === 'done'
  };

  if (caps.columns.category) row.category = category;
  if (caps.columns.due_date && dueDate) row.due_date = dueDate;
  if (caps.columns.status) row.status = status;
  if (caps.columns.repeat_type && repeatType !== 'none') {
    row.repeat_type = repeatType;
    if (caps.columns.repeat_until && repeatUntil) row.repeat_until = repeatUntil;
    row.series_id = caps.columns.series_id ? crypto.randomUUID() : undefined;
  }
  if (caps.columns.completed_at && status === 'done') row.completed_at = new Date().toISOString();

  // 去掉数据库不支持的字段，避免整条插入失败
  Object.keys(row).forEach((k) => { if (row[k] === undefined) delete row[k]; });

  const { data, error } = await supabase.from('tasks').insert([row]).select();
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const created = data[0];
  await logEvent(created.id, 'created');
  res.json({ success: true, data: normalizeTask(created) });
}));

// ============================================================
// 修改任务
//   PATCH /api/tasks/:id
//   支持：title / priority / category / dueDate / repeatType / repeatUntil
//         completed / status
//   兼容 V1：只传 { completed: true } 也能正常工作
// ============================================================
app.patch('/api/tasks/:id', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const doneCol = await detectDoneColumn();
  const id = req.params.id;
  const body = req.body || {};

  // 先读旧值，用于判断完成状态是否发生了变化、以及重复任务的下次日期
  const { data: oldRows, error: readErr } = await supabase
    .from('tasks').select('*').eq('id', id).limit(1);
  if (readErr) return fail(res, 500, 'DB_ERROR', readErr.message);
  if (!oldRows || !oldRows.length) return fail(res, 404, 'NOT_FOUND', '任务不存在');

  const old = oldRows[0];
  const wasDone = old.completed !== undefined ? !!old.completed : !!old[doneCol];

  const patch = {};

  if (body.title !== undefined) {
    const t = cleanText(body.title, 200);
    if (!t) return fail(res, 400, 'INVALID_TITLE', '任务标题不能为空');
    patch.title = t;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) return fail(res, 400, 'INVALID_PRIORITY', '优先级只能是 高/中/低');
    patch.priority = body.priority;
  }
  if (body.category !== undefined && caps.columns.category) {
    patch.category = body.category ? cleanText(body.category, 20) : null;
  }
  if (body.dueDate !== undefined && caps.columns.due_date) {
    patch.due_date = isDate(body.dueDate) ? body.dueDate : null;
  }
  if (body.repeatType !== undefined && caps.columns.repeat_type) {
    if (!REPEATS.includes(body.repeatType)) return fail(res, 400, 'INVALID_REPEAT', '重复规则不合法');
    patch.repeat_type = body.repeatType;
    if (body.repeatType !== 'none' && !old.series_id && caps.columns.series_id) {
      patch.series_id = crypto.randomUUID();
    }
  }
  if (body.repeatUntil !== undefined && caps.columns.repeat_until) {
    patch.repeat_until = isDate(body.repeatUntil) ? body.repeatUntil : null;
  }

  // 完成状态：completed（V1 语义）或 status（V3 语义）二者取一
  let isNowDone = wasDone;
  let explicitStatus = null;

  if (body.completed !== undefined) {
    isNowDone = !!body.completed;
    patch[doneCol] = isNowDone;
    explicitStatus = isNowDone ? 'done' : 'todo';
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return fail(res, 400, 'INVALID_STATUS', '状态不合法');
    explicitStatus = body.status;
    isNowDone = body.status === 'done';
    patch[doneCol] = isNowDone;
  }

  if (caps.columns.status && explicitStatus) patch.status = explicitStatus;
  if (caps.columns.completed_at) {
    if (isNowDone && !wasDone) patch.completed_at = new Date().toISOString();
    if (!isNowDone && wasDone) patch.completed_at = null;
  }

  if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_PATCH', '没有需要修改的字段');

  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select();
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const updated = data[0];

  // 记录状态变化事件（热力图数据源）
  if (isNowDone && !wasDone) {
    await logEvent(updated.id, 'completed');
    await maybeSpawnRepeat(updated, caps, doneCol);
  } else if (!isNowDone && wasDone) {
    await logEvent(updated.id, 'reopened');
  }

  const subMap = await subtaskProgressMap([updated.id], caps);
  res.json({ success: true, data: normalizeTask(updated, subMap) });
}));

// 重复任务：完成后自动生成下一次
async function maybeSpawnRepeat(task, caps, doneCol) {
  if (!caps.columns.repeat_type) return;
  const type = task.repeat_type || 'none';
  if (type === 'none') return;

  const next = nextDueDate(task.due_date, type);
  if (!next) return;

  // 超过重复终止日期就不再生成
  if (task.repeat_until && next > task.repeat_until) return;

  // 同一系列同一天只生成一次，防止重复点击造成堆积
  if (caps.columns.series_id && task.series_id) {
    const { data: exist } = await supabase
      .from('tasks')
      .select('id')
      .eq('series_id', task.series_id)
      .eq('due_date', next)
      .limit(1);
    if (exist && exist.length) return;
  }

  const row = {
    title: task.title,
    priority: task.priority || '中',
    [doneCol]: false
  };
  if (caps.columns.category) row.category = task.category || null;
  if (caps.columns.due_date) row.due_date = next;
  if (caps.columns.status) row.status = 'todo';
  if (caps.columns.repeat_type) row.repeat_type = type;
  if (caps.columns.repeat_until) row.repeat_until = task.repeat_until || null;
  if (caps.columns.series_id) row.series_id = task.series_id || crypto.randomUUID();

  const { data, error } = await supabase.from('tasks').insert([row]).select();
  if (!error && data && data[0]) await logEvent(data[0].id, 'created');
}

// ============================================================
// 删除任务
// ============================================================
app.delete('/api/tasks/:id', wrap(async (req, res) => {
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true });
}));

// ============================================================
// 子任务
// ============================================================
app.get('/api/tasks/:id/subtasks', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.subtasks) return fail(res, 503, 'NO_SUBTASKS_TABLE', '数据库尚未执行 V3 迁移（缺少 subtasks 表）');

  const { data, error } = await supabase
    .from('subtasks')
    .select('*')
    .eq('task_id', req.params.id)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true, data: data || [] });
}));

app.post('/api/tasks/:id/subtasks', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.subtasks) return fail(res, 503, 'NO_SUBTASKS_TABLE', '数据库尚未执行 V3 迁移（缺少 subtasks 表）');

  const title = cleanText((req.body || {}).title, 120);
  if (!title) return fail(res, 400, 'INVALID_TITLE', '子任务内容不能为空');

  const { data: exist } = await supabase
    .from('subtasks').select('sort_order').eq('task_id', req.params.id)
    .order('sort_order', { ascending: false }).limit(1);
  const nextOrder = exist && exist.length ? Number(exist[0].sort_order) + 1 : 0;

  const { data, error } = await supabase
    .from('subtasks')
    .insert([{ task_id: req.params.id, title, sort_order: nextOrder }])
    .select();

  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true, data: data[0] });
}));

app.patch('/api/subtasks/:id', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.subtasks) return fail(res, 503, 'NO_SUBTASKS_TABLE', '数据库尚未执行 V3 迁移（缺少 subtasks 表）');

  const body = req.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const t = cleanText(body.title, 120);
    if (!t) return fail(res, 400, 'INVALID_TITLE', '子任务内容不能为空');
    patch.title = t;
  }
  if (body.done !== undefined) patch.done = !!body.done;
  if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_PATCH', '没有需要修改的字段');

  const { data, error } = await supabase.from('subtasks').update(patch).eq('id', req.params.id).select();
  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  if (!data || !data.length) return fail(res, 404, 'NOT_FOUND', '子任务不存在');
  res.json({ success: true, data: data[0] });
}));

app.delete('/api/subtasks/:id', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.subtasks) return fail(res, 503, 'NO_SUBTASKS_TABLE', '数据库尚未执行 V3 迁移（缺少 subtasks 表）');

  const { error } = await supabase.from('subtasks').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true });
}));

// ============================================================
// 分类管理
// ============================================================
const DEFAULT_CATEGORIES = [
  { name: '学习', color: '#3b82f6', sort_order: 1 },
  { name: '工作', color: '#8b5cf6', sort_order: 2 },
  { name: '健身', color: '#10b981', sort_order: 3 },
  { name: '生活', color: '#f59e0b', sort_order: 4 }
];

app.get('/api/categories', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.categories) {
    return res.json({ success: true, data: DEFAULT_CATEGORIES, fallback: true });
  }
  const { data, error } = await supabase
    .from('categories').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true });
  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true, data: data && data.length ? data : DEFAULT_CATEGORIES, fallback: !data || !data.length });
}));

app.post('/api/categories', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.categories) return fail(res, 503, 'NO_CATEGORIES_TABLE', '数据库尚未执行 V3 迁移（缺少 categories 表）');

  const name = cleanText((req.body || {}).name, 12);
  if (!name) return fail(res, 400, 'INVALID_NAME', '分类名称不能为空（最多 12 字）');
  const color = /^#[0-9a-fA-F]{6}$/.test((req.body || {}).color) ? req.body.color : '#6366f1';

  const { data: exist } = await supabase.from('categories').select('sort_order')
    .order('sort_order', { ascending: false }).limit(1);
  const nextOrder = exist && exist.length ? Number(exist[0].sort_order) + 1 : 1;

  const { data, error } = await supabase.from('categories').insert([{ name, color, sort_order: nextOrder }]).select();
  if (error) {
    if (String(error.message).includes('duplicate')) return fail(res, 409, 'DUPLICATE', '该分类已存在');
    return fail(res, 500, 'DB_ERROR', error.message);
  }
  res.json({ success: true, data: data[0] });
}));

app.patch('/api/categories/:id', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.categories) return fail(res, 503, 'NO_CATEGORIES_TABLE', '数据库尚未执行 V3 迁移');

  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const n = cleanText(body.name, 12);
    if (!n) return fail(res, 400, 'INVALID_NAME', '分类名称不能为空');
    patch.name = n;
  }
  if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) patch.color = body.color;
  if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_PATCH', '没有需要修改的字段');

  // 改名时同步任务上的分类名称，避免任务变成"未分类"
  const { data: before } = await supabase.from('categories').select('name').eq('id', req.params.id).limit(1);

  const { data, error } = await supabase.from('categories').update(patch).eq('id', req.params.id).select();
  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  if (!data || !data.length) return fail(res, 404, 'NOT_FOUND', '分类不存在');

  if (patch.name && before && before.length && before[0].name !== patch.name) {
    await supabase.from('tasks').update({ category: patch.name }).eq('category', before[0].name);
  }
  res.json({ success: true, data: data[0] });
}));

// 删除分类：只删分类本身，任务保留（变成未分类的文本值），绝不删任务
app.delete('/api/categories/:id', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.categories) return fail(res, 503, 'NO_CATEGORIES_TABLE', '数据库尚未执行 V3 迁移');

  const { data: before } = await supabase.from('categories').select('name').eq('id', req.params.id).limit(1);
  const { error } = await supabase.from('categories').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  let cleared = 0;
  if (before && before.length && caps.columns.category) {
    const { data: affected } = await supabase
      .from('tasks').update({ category: null }).eq('category', before[0].name).select('id');
    cleared = affected ? affected.length : 0;
  }
  res.json({ success: true, clearedTasks: cleared });
}));

// ============================================================
// 番茄钟
//   POST /api/pomodoro  { duration, type, taskId }
//   GET  /api/pomodoro/stats?days=30
// ============================================================
app.post('/api/pomodoro', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.pomodoro_sessions) {
    return fail(res, 503, 'NO_POMODORO_TABLE', '数据库尚未执行 V3 迁移（缺少 pomodoro_sessions 表）');
  }

  const body = req.body || {};
  const mode = ['focus', 'short', 'long'].includes(body.type || body.mode) ? (body.type || body.mode) : 'focus';
  const duration = Math.min(Math.max(Number(body.duration) || 25, 1), 180);
  const taskId = body.taskId ? Number(body.taskId) : null;

  const { data, error } = await supabase
    .from('pomodoro_sessions')
    .insert([{ mode, duration_min: duration, task_id: taskId }])
    .select();

  if (error) return fail(res, 500, 'DB_ERROR', error.message);
  res.json({ success: true, data: data[0] });
}));

app.get('/api/pomodoro/stats', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  if (!caps.tables.pomodoro_sessions) {
    return res.json({ success: true, data: { today: 0, total: 0, minutesToday: 0, minutesTotal: 0, daily: [] }, degraded: true });
  }

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('pomodoro_sessions')
    .select('mode, duration_min, finished_at')
    .gte('finished_at', since.toISOString());

  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const today = todayStr();
  const rows = data || [];
  const focuses = rows.filter((r) => r.mode === 'focus');
  const pk = (iso) => dayKeyOf(iso);

  res.json({
    success: true,
    data: {
      today: focuses.filter((r) => pk(r.finished_at) === today).length,
      total: focuses.length,
      minutesToday: focuses.filter((r) => pk(r.finished_at) === today).reduce((a, b) => a + (b.duration_min || 0), 0),
      minutesTotal: focuses.reduce((a, b) => a + (b.duration_min || 0), 0),
      daily: Array.from(
        focuses.reduce((m, r) => {
          const k = pk(r.finished_at);
          m.set(k, (m.get(k) || 0) + 1);
          return m;
        }, new Map())
      ).map(([date, count]) => ({ date, count }))
    }
  });
}));

// ============================================================
// 统计
// ============================================================
// 年度热力图（类似 GitHub 贡献图）
app.get('/api/stats/heatmap', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const year = Number(req.query.year) || Number(todayStr().slice(0, 4));
  // 年度边界按用户时区计算，避免跨年日归属错位
  const start = new Date(`${year}-01-01T00:00:00${tzSuffix()}`).toISOString();
  const end = new Date(`${year + 1}-01-01T00:00:00${tzSuffix()}`).toISOString();

  const days = {};

  if (caps.tables.task_events) {
    const { data, error } = await supabase
      .from('task_events')
      .select('created_at, type')
      .eq('type', 'completed')
      .gte('created_at', start)
      .lt('created_at', end);
    if (error) return fail(res, 500, 'DB_ERROR', error.message);
    (data || []).forEach((r) => {
      const k = dayKeyOf(r.created_at);
      days[k] = (days[k] || 0) + 1;
    });
  } else if (caps.columns.completed_at) {
    // 未迁移时降级：用 tasks.completed_at 统计
    const { data, error } = await supabase
      .from('tasks').select('completed_at').not('completed_at', 'is', null)
      .gte('completed_at', start).lt('completed_at', end);
    if (error) return fail(res, 500, 'DB_ERROR', error.message);
    (data || []).forEach((r) => {
      const k = dayKeyOf(r.completed_at);
      days[k] = (days[k] || 0) + 1;
    });
  }

  const values = Object.values(days);
  const total = values.reduce((a, b) => a + b, 0);
  const max = values.length ? Math.max(...values) : 0;

  // 连续完成天数（从今天往前推算）
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 400; i++) {
    const k = dayKeyOf(cursor);
    if (days[k]) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (i === 0) {
      cursor.setDate(cursor.getDate() - 1); // 今天还没完成，从昨天开始算
    } else {
      break;
    }
  }

  res.json({ success: true, data: { year, days, total, max, streak, degraded: !caps.tables.task_events } });
}));

// 概览：完成率、分类、近 7 天、月度
app.get('/api/stats/overview', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const doneCol = await detectDoneColumn();

  const { data, error } = await supabase.from('tasks').select('*');
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const rows = data || [];
  const isDone = (r) => (r.completed !== undefined ? !!r.completed : !!r[doneCol]);
  const total = rows.length;
  const done = rows.filter(isDone).length;
  const today = todayStr();

  const byCategory = {};
  rows.forEach((r) => {
    const k = r.category || '未分类';
    if (!byCategory[k]) byCategory[k] = { total: 0, done: 0 };
    byCategory[k].total += 1;
    if (isDone(r)) byCategory[k].done += 1;
  });
  Object.values(byCategory).forEach((v) => { v.rate = v.total ? Math.round((v.done / v.total) * 100) : 0; });

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKeyOf(d);
    const n = rows.filter((r) => isDone(r) && dayKeyOf(r.completed_at || r.created_at) === key).length;
    last7.push({ date: key, done: n });
  }

  res.json({
    success: true,
    data: {
      total,
      done,
      pending: total - done,
      rate: total ? Math.round((done / total) * 100) : 0,
      overdue: rows.filter((r) => !isDone(r) && r.due_date && r.due_date < today).length,
      todayDue: rows.filter((r) => !isDone(r) && r.due_date === today).length,
      todayDone: rows.filter((r) => isDone(r) && dayKeyOf(r.completed_at) === today).length,
      byCategory,
      last7
    }
  });
}));

// ============================================================
// 数据备份：导出 JSON / CSV
// ============================================================
app.get('/api/export', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const format = String(req.query.format || 'json').toLowerCase();

  const { data: tasks, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: true });
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  let subtasks = [];
  if (caps.tables.subtasks) {
    const { data } = await supabase.from('subtasks').select('*');
    subtasks = data || [];
  }
  let categories = DEFAULT_CATEGORIES;
  if (caps.tables.categories) {
    const { data } = await supabase.from('categories').select('*');
    if (data && data.length) categories = data;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  if (format === 'csv') {
    const header = ['id', 'title', 'priority', 'category', 'status', 'completed', 'due_date', 'repeat_type', 'created_at', 'completed_at'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    (tasks || []).forEach((r) => {
      lines.push([
        r.id, r.title, r.priority, r.category || '',
        r.status || (r.is_complete || r.completed ? 'done' : 'todo'),
        (r.is_complete !== undefined ? r.is_complete : r.completed) ? '是' : '否',
        r.due_date || '', r.repeat_type || 'none', r.created_at || '', r.completed_at || ''
      ].map(esc).join(','));
    });
    // BOM：Excel 打开中文不乱码
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tasks-${stamp}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n'));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-backup-${stamp}.json"`);
  res.send(JSON.stringify({
    version: '3.0',
    exportedAt: new Date().toISOString(),
    capabilities: { v3: caps.v3 },
    tasks: tasks || [],
    subtasks,
    categories
  }, null, 2));
}));

// ============================================================
// 数据恢复
//   POST /api/import { mode: 'merge', tasks: [...] }
//   merge 模式：按 title + due_date 判重，已存在则跳过，绝不覆盖
// ============================================================
app.post('/api/import', wrap(async (req, res) => {
  const caps = await detectCapabilities();
  const doneCol = await detectDoneColumn();
  const body = req.body || {};

  const list = Array.isArray(body.tasks) ? body.tasks : null;
  if (!list) return fail(res, 400, 'INVALID_BODY', '请求体需要包含 tasks 数组');
  if (list.length > 5000) return fail(res, 400, 'TOO_MANY', '一次最多导入 5000 条');

  const { data: exist, error: readErr } = await supabase.from('tasks').select('title, due_date');
  if (readErr) return fail(res, 500, 'DB_ERROR', readErr.message);
  const seen = new Set((exist || []).map((r) => `${r.title}|${r.due_date || ''}`));

  let inserted = 0;
  let skipped = 0;
  const failed = [];

  for (const item of list) {
    const title = cleanText(item && item.title, 200);
    if (!title) { skipped += 1; continue; }

    const due = isDate(item.due_date || item.dueDate) ? (item.due_date || item.dueDate) : null;
    const key = `${title}|${due || ''}`;
    if (seen.has(key)) { skipped += 1; continue; }

    const priority = PRIORITIES.includes(item.priority) ? item.priority : '中';
    const done = item.completed === true || item.completed === '是' || item.status === 'done'
      || item.is_complete === true;

    const row = { title, priority, [doneCol]: done };
    if (caps.columns.category) row.category = item.category ? cleanText(item.category, 20) : null;
    if (caps.columns.due_date) row.due_date = due;
    if (caps.columns.status) row.status = done ? 'done' : (STATUSES.includes(item.status) ? item.status : 'todo');
    if (caps.columns.completed_at && done) row.completed_at = item.completed_at || new Date().toISOString();
    if (caps.columns.repeat_type) row.repeat_type = REPEATS.includes(item.repeat_type) ? item.repeat_type : 'none';

    const { error } = await supabase.from('tasks').insert([row]);
    if (error) failed.push({ title, message: error.message });
    else { inserted += 1; seen.add(key); }
  }

  res.json({ success: true, data: { inserted, skipped, failed: failed.length, errors: failed.slice(0, 10) } });
}));

// ============================================================
// AI 助手（后端代理，密钥不进前端）
// ============================================================
app.get('/api/ai/status', (req, res) => {
  res.json({ success: true, configured: AI_READY, model: AI_MODEL, base: AI_API_BASE });
});

app.post('/api/ai/chat', wrap(async (req, res) => {
  if (!AI_READY) {
    return fail(res, 503, 'NO_AI_KEY', '服务端未配置 AI_API_KEY，AI 助手暂不可用');
  }

  const message = cleanText((req.body || {}).message, 1000);
  if (!message) return fail(res, 400, 'INVALID_MESSAGE', '请输入内容');

  // 附带当前任务摘要，让回答更贴合实际
  const { data: rows } = await supabase.from('tasks').select('*').limit(200);
  const doneCol = await detectDoneColumn();
  const summary = (rows || []).slice(0, 40).map((r) => {
    const done = r.completed !== undefined ? r.completed : r[doneCol];
    return `- ${r.title}（${r.priority || '中'}${r.due_date ? '，截止 ' + r.due_date : ''}${done ? '，已完成' : ''}）`;
  }).join('\n');

  const sys = [
    '你是任务管理系统的助理，回答要简短、具体、可执行，全部使用中文。',
    '用户的任务清单如下（最多 40 条）：',
    summary || '（暂无任务）'
  ].join('\n');

  try {
    const r = await fetch(`${AI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    const text = await r.text();
    if (!r.ok) {
      const hint = r.status === 401 ? 'API Key 无效或已过期'
        : r.status === 402 ? '账户余额不足'
        : r.status === 429 ? '请求过于频繁'
        : r.status >= 500 ? 'AI 服务端异常'
        : '调用 AI 接口失败';
      console.error(`[ai/chat] 上游 ${r.status}:`, text.slice(0, 300));
      return fail(res, 502, 'AI_UPSTREAM_ERROR', `${hint}（HTTP ${r.status}）`, { detail: text.slice(0, 300) });
    }

    const json = JSON.parse(text);
    const reply = json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : '';
    res.json({ success: true, reply: reply || '（AI 未返回内容）', model: AI_MODEL });
  } catch (err) {
    console.error('[ai/chat] 请求失败：', err.message);
    fail(res, 502, 'AI_NETWORK_ERROR', '无法连接 AI 服务：' + err.message);
  }
}));

// ============================================================
// 元信息 / 健康检查 / 诊断
// ============================================================
app.get('/api/meta', wrap(async (req, res) => {
  const caps = await detectCapabilities();

  const { data: rows, error } = await supabase.from('tasks').select('*');
  if (error) return fail(res, 500, 'DB_ERROR', error.message);

  const doneCol = await detectDoneColumn();
  const isDone = (r) => (r.completed !== undefined ? !!r.completed : !!r[doneCol]);
  const today = todayStr();

  let categories = DEFAULT_CATEGORIES.map((c) => c.name);
  if (caps.tables.categories) {
    const { data: cats } = await supabase.from('categories').select('name').order('sort_order');
    if (cats && cats.length) categories = cats.map((c) => c.name);
  }

  res.json({
    success: true,
    version: '3.0',
    features: {
      dueDate: caps.columns.due_date,
      category: caps.columns.category,
      completedAt: caps.columns.completed_at,
      status: caps.columns.status,
      repeat: caps.columns.repeat_type,
      subtasks: caps.tables.subtasks,
      pomodoro: caps.tables.pomodoro_sessions,
      heatmap: caps.tables.task_events,
      categories: caps.tables.categories,
      ai: AI_READY
    },
    categories,
    counts: {
      total: (rows || []).length,
      done: (rows || []).filter(isDone).length,
      pending: (rows || []).filter((r) => !isDone(r)).length,
      todayDue: (rows || []).filter((r) => !isDone(r) && r.due_date === today).length,
      overdue: (rows || []).filter((r) => !isDone(r) && r.due_date && r.due_date < today).length
    }
  });
}));

app.get('/api/health', async (req, res) => {
  const base = { ok: true, version: '3.0', configured: CONFIGURED, ai: AI_READY };
  if (!CONFIGURED) return res.json({ ...base, database: { reachable: false } });

  try {
    const caps = await detectCapabilities(true);
    const { error } = await supabase.from('tasks').select('id').limit(1);
    res.json({
      ...base,
      database: {
        reachable: !error,
        error: error ? error.message : null,
        features: {
          category: caps.columns.category,
          completedAt: caps.columns.completed_at,
          dueDate: caps.columns.due_date,
          status: caps.columns.status,
          repeat: caps.columns.repeat_type,
          subtasks: caps.tables.subtasks,
          pomodoro: caps.tables.pomodoro_sessions,
          taskEvents: caps.tables.task_events,
          categories: caps.tables.categories
        },
        migratedV3: caps.v3
      }
    });
  } catch (err) {
    res.status(500).json({ ...base, ok: false, database: { reachable: false, error: err.message } });
  }
});

// 深度诊断（排查连接问题用，保留自 V1）
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
    result.steps.push({ step: 'supabase-js select', ok: !error, error: error ? error.message : null, rows: data ? data.length : null });
  } catch (e) {
    result.steps.push({ step: 'supabase-js select', thrown: e.message });
  }

  result.capabilities = await detectCapabilities(true);
  result.env = { node: process.version, hasProxy: !!(process.env.HTTPS_PROXY || process.env.https_proxy) };
  res.json(result);
});

// ============================================================
// 统一错误处理
// ============================================================
app.use((err, req, res, next) => {
  console.error('[unhandled]', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, code: 'INTERNAL', message: '服务器内部错误：' + (err && err.message) });
});

// ============================================================
// 启动
// ============================================================
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`✅ 智能任务管理系统 V3.0 已启动：http://localhost:${PORT}`);
    if (!CONFIGURED) {
      console.log('⚠️  未配置 Supabase，接口会返回 503');
    } else {
      const caps = await detectCapabilities(true);
      console.log('🔗 Supabase 已连接');
      console.log(caps.v3 ? '✅ 检测到 V3 迁移已完成' : '⚠️  尚未执行 V3 迁移（supabase/migration-v3.sql），新功能将自动降级');
    }
    console.log(AI_READY ? `🤖 AI 已配置：${AI_MODEL}` : 'ℹ️  未配置 AI_API_KEY，AI 助手不可用（其它功能正常）');
  });
}

module.exports = app;
