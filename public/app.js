/* ============================================================
   智能任务管理系统 V3.0 · 前端逻辑
   ------------------------------------------------------------
   视图：首页 / 今日任务 / 日历中心 / 全部任务（列表 + 看板）
        我的计划 / 专注中心 / 数据分析 / 分类管理 / 系统设置 / AI 助手
   所有数据来自后端 API（Supabase），前端不做假数据
   ============================================================ */

(() => {
  'use strict';

  // ============================================================
  // 常量
  // ============================================================
  const API = {
    tasks: '/api/tasks',
    categories: '/api/categories',
    meta: '/api/meta',
    pomodoro: '/api/pomodoro',
    pomStats: '/api/pomodoro/stats',
    heatmap: '/api/stats/heatmap',
    overview: '/api/stats/overview',
    export: '/api/export',
    import: '/api/import',
    aiStatus: '/api/ai/status',
    aiChat: '/api/ai/chat'
  };

  const LS = {
    theme: 'tm_theme',
    remind: 'tm_remind',
    pageSize: 'tm_pageSize',
    cache: 'tm_cache',
    lastRemind: 'tm_lastRemind',
    pomFocus: 'tm_pom_focus',
    pomShort: 'tm_pom_short',
    pomLong: 'tm_pom_long',
    taskMode: 'tm_task_mode'
  };

  const FALLBACK_CATS = [
    { name: '学习', color: '#3b82f6' },
    { name: '工作', color: '#8b5cf6' },
    { name: '健身', color: '#10b981' },
    { name: '生活', color: '#f59e0b' }
  ];

  const PRI_RANK = { '高': 0, '中': 1, '低': 2 };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  const REPEAT_LABEL = { none: '', daily: '每天', weekly: '每周', monthly: '每月' };
  const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成' };

  const VIEW_TITLES = {
    dashboard: '首页',
    today: '今日任务',
    calendar: '日历中心',
    tasks: '全部任务',
    plan: '我的计划',
    pomodoro: '专注中心',
    analytics: '数据分析',
    categories: '分类管理',
    settings: '系统设置',
    ai: 'AI 助手'
  };

  // ============================================================
  // 状态
  // ============================================================
  const state = {
    tasks: [],
    categories: FALLBACK_CATS.slice(),
    meta: { features: {} },
    heat: null,
    pomStats: { today: 0, total: 0, minutesToday: 0, daily: [] },
    aiInfo: { configured: false },
    view: 'dashboard',
    tab: 'all',
    cat: '全部',
    search: '',
    sort: 'due',
    page: 1,
    pageSize: Number(localStorage.getItem(LS.pageSize)) || 10,
    theme: localStorage.getItem(LS.theme) || 'light',
    remind: localStorage.getItem(LS.remind) !== '0',
    taskMode: localStorage.getItem(LS.taskMode) || 'list',
    planTab: 'upcoming',
    calDate: new Date(),
    calView: 'month',
    editingId: null,
    detailTaskId: null,
    offline: false,
    pom: {
      mode: 'focus',
      running: false,
      seconds: 25 * 60,
      totalSeconds: 25 * 60,
      timer: null
    }
  };

  // ============================================================
  // 基础工具
  // ============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const icon = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;
  const pad = (n) => String(n).padStart(2, '0');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 后端返回的是 UTC 时间戳，必须按浏览器本地时区换算成自然日
  const isoDay = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : dayStr(d);
  };

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return dayStr(d);
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  }

  function dueLabel(t) {
    if (!t.due_date) return '无截止日期';
    const today = todayStr();
    if (t.due_date === today) return '今天';
    if (t.due_date === addDays(today, 1)) return '明天';
    if (t.due_date === addDays(today, -1)) return '昨天';
    const [, m, d] = t.due_date.split('-');
    return `${Number(m)}月${Number(d)}日`;
  }

  const isOverdue = (t) => !t.completed && !!t.due_date && t.due_date < todayStr();
  const isToday = (t) => t.due_date === todayStr();

  function relTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    if (min < 1440) return `${Math.floor(min / 60)} 小时前`;
    if (min < 10080) return `${Math.floor(min / 1440)} 天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // ============================================================
  // Toast
  // ============================================================
  function toast(msg, type = 'ok') {
    const wrap = $('#toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const ic = type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'check';
    el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  // ============================================================
  // API
  // ============================================================
  async function api(url, options) {
    const res = await fetch(url, options);
    let json = null;
    try { json = await res.json(); } catch (_) {}
    if (!res.ok || !json || json.success === false) {
      const err = new Error((json && json.message) || `请求失败（HTTP ${res.status}）`);
      err.code = json && json.code;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  const postJSON = (url, body) => api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const patchJSON = (url, body) => api(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  // ============================================================
  // 数据加载
  // ============================================================
  function normalizeTask(t) {
    return {
      id: t.id,
      title: t.title || '',
      priority: t.priority || '中',
      category: t.category || null,
      completed: !!t.completed,
      status: t.status || (t.completed ? 'done' : 'todo'),
      due_date: t.due_date || null,
      created_at: t.created_at || null,
      completed_at: t.completed_at || null,
      repeat_type: t.repeat_type || 'none',
      repeat_until: t.repeat_until || null,
      series_id: t.series_id || null,
      subtask_total: t.subtask_total || 0,
      subtask_done: t.subtask_done || 0,
      progress: t.progress || 0
    };
  }

  async function loadTasks(silent = false) {
    try {
      const json = await api(API.tasks);
      state.tasks = (json.data || []).map(normalizeTask);
      state.offline = false;
      localStorage.setItem(LS.cache, JSON.stringify(state.tasks));
      if (!silent) renderCurrentView();
    } catch (err) {
      // 断网时用本地缓存兜底显示，但明确告知
      const cache = localStorage.getItem(LS.cache);
      if (cache) {
        try {
          state.tasks = JSON.parse(cache).map(normalizeTask);
          state.offline = true;
          if (!silent) renderCurrentView();
          toast('网络异常，当前显示本地缓存', 'warn');
          return;
        } catch (_) {}
      }
      if (!silent) toast('加载失败：' + err.message, 'err');
    }
  }

  async function loadCategories() {
    try {
      const json = await api(API.categories);
      state.categories = (json.data && json.data.length ? json.data : FALLBACK_CATS)
        .map((c) => ({ id: c.id, name: c.name, color: c.color || '#6366f1' }));
    } catch (_) {
      state.categories = FALLBACK_CATS.slice();
    }
  }

  async function loadMeta() {
    try {
      const json = await api(API.meta);
      state.meta = json;
      if (json.categories && json.categories.length) {
        // 后端返回的是名称列表，颜色沿用已有配置
        const map = new Map(state.categories.map((c) => [c.name, c.color]));
        state.categories = json.categories.map((n) => ({ name: n, color: map.get(n) || '#6366f1' }));
      }
    } catch (_) {}
  }

  async function loadPomodoroStats() {
    try {
      const json = await api(API.pomStats + '?days=30');
      state.pomStats = json.data || state.pomStats;
    } catch (_) {}
    renderPomodoroStats();
  }

  async function loadHeatmap() {
    try {
      const json = await api(`${API.heatmap}?year=${new Date().getFullYear()}`);
      state.heat = json.data;
    } catch (_) {
      state.heat = null;
    }
  }

  // ============================================================
  // 筛选 / 排序 / 统计
  // ============================================================
  function catColor(name) {
    const c = state.categories.find((x) => x.name === name);
    return c ? c.color : '#94a3b8';
  }

  function byTab(list, tab) {
    switch (tab) {
      case 'today': return list.filter(isToday);
      case 'pending': return list.filter((t) => !t.completed);
      case 'done': return list.filter((t) => t.completed);
      case 'overdue': return list.filter(isOverdue);
      default: return list;
    }
  }

  function sortTasks(list) {
    const arr = list.slice();
    const noDue = '9999-12-31';
    switch (state.sort) {
      case 'priority':
        arr.sort((a, b) => (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9)
          || (a.due_date || noDue).localeCompare(b.due_date || noDue));
        break;
      case 'created':
        arr.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        break;
      case 'title':
        arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
        break;
      default:
        arr.sort((a, b) => (a.due_date || noDue).localeCompare(b.due_date || noDue)
          || (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9));
    }
    return arr;
  }

  function catFiltered() {
    if (state.cat === '全部') return state.tasks;
    if (state.cat === '未分类') return state.tasks.filter((t) => !t.category);
    return state.tasks.filter((t) => t.category === state.cat);
  }

  function visibleTasks() {
    let list = catFiltered();
    const kw = state.search.trim().toLowerCase();
    if (kw) list = list.filter((t) => t.title.toLowerCase().includes(kw));
    return sortTasks(byTab(list, state.tab));
  }

  function stats() {
    const all = state.tasks;
    const total = all.length;
    const done = all.filter((t) => t.completed).length;
    const today = todayStr();
    return {
      total,
      done,
      pending: total - done,
      rate: total ? Math.round((done / total) * 100) : 0,
      doneToday: all.filter((t) => t.completed && isoDay(t.completed_at || t.created_at) === today).length,
      createdToday: all.filter((t) => isoDay(t.created_at) === today).length,
      overdue: all.filter(isOverdue).length,
      todayTasks: all.filter((t) => !t.completed && isToday(t)).length
    };
  }

  // ============================================================
  // 视图切换
  // ============================================================
  function setView(view) {
    state.view = view;
    const map = {
      dashboard: 'viewDashboard', today: 'viewToday', calendar: 'viewCalendar',
      tasks: 'viewTasks', plan: 'viewPlan', pomodoro: 'viewPomodoro',
      analytics: 'viewAnalytics', categories: 'viewCategories',
      settings: 'viewSettings', ai: 'viewAI'
    };
    Object.entries(map).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = k !== view;
    });
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
    $('#pageTitle').textContent = VIEW_TITLES[view] || '首页';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
    renderCurrentView();
  }

  function renderCurrentView() {
    const v = state.view;
    if (v === 'dashboard') renderDashboard();
    else if (v === 'today') renderTodayView();
    else if (v === 'calendar') renderCalendar();
    else if (v === 'tasks') renderTasksView();
    else if (v === 'plan') renderPlan();
    else if (v === 'pomodoro') renderPomodoroStats();
    else if (v === 'analytics') renderAnalytics();
    else if (v === 'categories') renderCategories();
    else if (v === 'settings') renderSettings();
    else if (v === 'ai') updateAIStatus();
    updateNavBadges();
  }

  function updateNavBadges() {
    const badge = $('#todayBadge');
    if (!badge) return;
    const n = state.tasks.filter((t) => !t.completed && isToday(t)).length;
    badge.textContent = n;
    badge.style.display = n > 0 ? '' : 'none';
  }

  // ============================================================
  // 首页
  // ============================================================
  function renderDashboard() {
    const s = stats();
    $('#statTotal').textContent = s.total;
    $('#statDone').textContent = s.done;
    $('#statPending').textContent = s.pending;
    $('#statRate').textContent = s.rate + '%';
    $('#miniToday').textContent = s.todayTasks;
    $('#miniDone').textContent = s.done;
    $('#miniRate').textContent = s.rate + '%';

    setDelta('#deltaTotal', s.createdToday > 0 ? `今日 +${s.createdToday}` : '今日 0', s.createdToday > 0 ? 'up' : 'flat');
    setDelta('#deltaDone', s.doneToday > 0 ? `今日 +${s.doneToday}` : '今日 0', s.doneToday > 0 ? 'up' : 'flat');
    setDelta('#deltaPending', s.overdue > 0 ? `逾期 ${s.overdue}` : '无逾期', s.overdue > 0 ? 'down' : 'flat');
    setDelta('#deltaRate', `${s.rate}%`, 'flat');

    renderRateRing(s.rate);
    renderLineChart();
    renderDonut();
    renderTodayList();
    renderRecentList();
    renderHeatmapInto($('#heatmap'), $('#heatStats'), $('#heatLegend'));

    const h = new Date().getHours();
    const greet = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    $('#welcomeTitle').textContent = `${greet}，顾帅涛！👋`;
    $('#welcomeSub').textContent = s.todayTasks
      ? `今天还有 ${s.todayTasks} 项待办${s.overdue ? `，另有 ${s.overdue} 项已逾期` : ''}`
      : '今天的任务都完成了，享受这份轻松吧';
  }

  function setDelta(sel, text, cls) {
    const el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.className = 'delta ' + cls;
  }

  function renderRateRing(rate) {
    const el = $('#rateRing');
    if (!el) return;
    const r = 22, c = 2 * Math.PI * r;
    el.innerHTML = `
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--primary)" stroke-width="5"
                stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c - (c * rate) / 100}"
                style="transition:stroke-dashoffset .5s ease"/>
      </svg>
      <span class="ring-text">${rate}%</span>`;
  }

  function renderTodayList() {
    const el = $('#todayList');
    if (!el) return;
    const list = sortTasks(state.tasks.filter((t) => !t.completed && (isToday(t) || isOverdue(t)))).slice(0, 5);
    if (!list.length) {
      el.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text-3);font-size:13px">🎉 今天没有待办任务</div>';
      return;
    }
    el.innerHTML = list.map((t) => `
      <div class="today-item" data-open="${t.id}" style="cursor:pointer">
        <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
        <span class="task-title">${esc(t.title)}</span>
        ${isOverdue(t) ? '<span style="color:var(--danger);font-size:11px">已逾期</span>' : ''}
        <span class="cat-pill" style="background:${catColor(t.category)}18;color:${catColor(t.category)}">${esc(t.category || '未分类')}</span>
      </div>`).join('');
  }

  function renderRecentList() {
    const el = $('#recentList');
    if (!el) return;
    const list = state.tasks.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
    if (!list.length) {
      el.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text-3);font-size:13px">还没有任务</div>';
      return;
    }
    el.innerHTML = list.map((t) => `
      <div class="recent-item" data-open="${t.id}" style="cursor:pointer">
        ${t.completed ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--text-3)">○</span>'}
        <span class="task-title" style="${t.completed ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}</span>
        <span class="due">${esc(dueLabel(t))}</span>
      </div>`).join('');
  }

  // ---------- 7 天趋势（完成数量） ----------
  function last7() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ key: dayStr(d), label: WEEK_SHORT[d.getDay()] });
    }
    return out;
  }

  function renderLineChart() {
    const box = $('#lineChartBox');
    if (!box) return;
    // 先清空，避免上一张固定宽度的 SVG 把容器撑开、导致测量结果越来越大
    box.innerHTML = '';
    const w = box.clientWidth - 8;
    const h = 178;
    if (w < 80) return;

    const padL = 30, padR = 14, padT = 16, padB = 26;
    const iw = w - padL - padR;
    const ih = h - padT - padB;

    const days = last7();
    const data = days.map((d) => ({
      label: d.label,
      key: d.key,
      value: state.tasks.filter((t) => t.completed
        && isoDay(t.completed_at || t.created_at) === d.key).length
    }));

    const max = Math.max(...data.map((d) => d.value), 1);
    const x = (i) => padL + (iw / (data.length - 1)) * i;
    const y = (v) => padT + ih - (ih * v) / max;

    const pts = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.value) }));

    let path = `M ${pts[0].cx} ${pts[0].cy}`;
    pts.slice(1).forEach((p) => { path += ` L ${p.cx} ${p.cy}`; });
    const area = `${path} L ${pts[pts.length - 1].cx} ${padT + ih} L ${pts[0].cx} ${padT + ih} Z`;

    const grid = [0, 0.5, 1].map((f) => {
      const v = Math.round(max * f);
      return `<line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="${f === 0 ? '0' : '3 4'}"/>
        <text x="${padL - 7}" y="${y(v) + 3.5}" text-anchor="end" font-size="9.5" fill="var(--text-3)">${v}</text>`;
    }).join('');

    const labels = pts.map((p) =>
      `<text x="${p.cx}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${p.label}</text>`).join('');

    const dots = pts.map((p) =>
      `<circle cx="${p.cx}" cy="${p.cy}" r="3.4" fill="#fff" stroke="var(--primary)" stroke-width="2"><title>${p.key}：${p.value} 个</title></circle>`).join('');

    box.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid}${labels}
        <path d="${area}" fill="url(#areaGrad)"/>
        <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>`;
  }

  // ---------- 分类环形图 ----------
  function renderDonut() {
    const box = $('#donutBox');
    const legend = $('#donutLegend');
    if (!box || !legend) return;

    const map = new Map();
    state.tasks.forEach((t) => {
      const k = t.category || '未分类';
      map.set(k, (map.get(k) || 0) + 1);
    });
    const segs = Array.from(map.entries()).map(([name, count]) => ({
      name, count, color: name === '未分类' ? '#94a3b8' : catColor(name)
    })).sort((a, b) => b.count - a.count);
    const total = state.tasks.length;

    if (!segs.length) {
      box.innerHTML = '<div class="chart-empty" style="position:static">暂无数据</div>';
      legend.innerHTML = '';
      return;
    }

    const r = 40, C = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segs.map((s) => {
      const len = C * (s.count / total);
      const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="15"
        stroke-dasharray="${Math.max(len - 1.5, 0.6)} ${C - Math.max(len - 1.5, 0.6)}"
        stroke-dashoffset="${-offset}"/>`;
      offset += len;
      return el;
    }).join('');

    box.innerHTML = `
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="15"/>
        <g transform="rotate(-90 60 60)">${arcs}</g>
      </svg>
      <div class="donut-center"><b>${total}</b><span>总任务</span></div>`;

    legend.innerHTML = segs.map((s) => {
      const pct = Math.round((s.count / total) * 100);
      return `<li><i class="dot" style="background:${s.color}"></i><span>${esc(s.name)}</span>
        <span style="margin-left:auto;color:var(--text-3);font-size:12px">${s.count}（${pct}%）</span></li>`;
    }).join('');
  }

  // ---------- 热力图 ----------
  function renderHeatmapInto(container, statsEl, legendEl) {
    if (!container) return;

    // 从今天往前 52 周，起点对齐到周日
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay());

    const days = (state.heat && state.heat.days) || {};
    const max = Math.max(...Object.values(days), 1);

    const cells = [];
    const cursor = new Date(start);
    let count = 0, activeDays = 0;

    while (cursor <= end) {
      const key = dayStr(cursor);
      const n = days[key] || 0;
      if (n > 0) { count += n; activeDays += 1; }
      let lvl = 0;
      if (n > 0) {
        const ratio = n / max;
        lvl = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
      }
      cells.push(`<div class="heat-cell ${lvl ? 'l' + lvl : ''}" title="${key}：完成 ${n} 个任务"></div>`);
      cursor.setDate(cursor.getDate() + 1);
    }

    container.innerHTML = cells.join('');

    if (statsEl) {
      const streak = state.heat ? state.heat.streak : 0;
      statsEl.innerHTML = `
        <span><b>${count}</b> 年度完成</span>
        <span><b>${activeDays}</b> 活跃天数</span>
        <span><b>${streak}</b> 连续天数</span>
        <span><b>${state.meta.features && state.meta.features.heatmap === false ? '降级' : '精确'}</b> 统计方式</span>`;
    }
    if (legendEl) {
      legendEl.innerHTML = `少 <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i>
        <i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i>
        <i style="background:var(--heat-4)"></i> 多`;
    }
  }

  // ============================================================
  // 今日任务
  // ============================================================
  function renderTodayView() {
    const all = state.tasks;
    const dueToday = sortTasks(all.filter((t) => !t.completed && isToday(t)));
    const overdue = sortTasks(all.filter(isOverdue));
    const doneToday = all.filter((t) => t.completed && isoDay(t.completed_at || t.created_at) === todayStr());
    const totalDue = dueToday.length + overdue.length + doneToday.length;
    const rate = totalDue ? Math.round((doneToday.length / totalDue) * 100) : 0;

    $('#todaySummary').innerHTML = `
      <div class="summary-card primary">
        <span class="summary-label">今日待办</span>
        <div class="summary-value">${dueToday.length}</div>
      </div>
      <div class="summary-card danger">
        <span class="summary-label">已逾期</span>
        <div class="summary-value">${overdue.length}</div>
      </div>
      <div class="summary-card success">
        <span class="summary-label">今日已完成</span>
        <div class="summary-value">${doneToday.length}</div>
      </div>
      <div class="summary-card">
        <span class="summary-label">今日完成率</span>
        <div class="summary-value">${rate}%</div>
      </div>`;

    fillList('#todayDueList', '#todayDueEmpty', dueToday);
    fillList('#todayOverdueList', '#todayOverdueEmpty', overdue);
    fillList('#todayDoneList', '#todayDoneEmpty', doneToday);

    $('#todayDueSub').textContent = `${dueToday.length} 项`;
    $('#todayDoneSub').textContent = `${doneToday.length} 项`;
  }

  function fillList(listSel, emptySel, items) {
    const ul = $(listSel);
    const empty = $(emptySel);
    if (!ul || !empty) return;
    if (!items.length) {
      ul.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    ul.innerHTML = items.map(taskRow).join('');
  }

  // ============================================================
  // 任务行（列表复用）
  // ============================================================
  function taskRow(t) {
    const cat = t.category || '未分类';
    const color = t.category ? catColor(t.category) : '#94a3b8';
    const overdue = isOverdue(t);
    const repeat = t.repeat_type && t.repeat_type !== 'none'
      ? `<span class="repeat-tag">${icon('repeat')}${REPEAT_LABEL[t.repeat_type]}</span>` : '';
    const sub = t.subtask_total
      ? `<span class="sub-progress">${icon('subtask')}${t.subtask_done}/${t.subtask_total}</span>` : '';

    return `
      <li class="task ${t.completed ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
        <button class="task-check" data-act="toggle" aria-label="${t.completed ? '标记未完成' : '标记完成'}">${icon('check')}</button>
        <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
        <span class="task-title" data-act="open">${esc(t.title)}</span>
        <span class="cat-pill" style="background:${color}18;color:${color}">${esc(cat)}</span>
        ${repeat}
        ${sub}
        <span class="due ${isToday(t) ? 'today' : ''}">${icon('calendar')}${dueLabel(t)}</span>
        ${t.completed ? '<span class="done-tag">已完成</span>' : ''}
        <span class="task-acts">
          <button class="icon-btn" data-act="edit" aria-label="编辑">${icon('edit')}</button>
          <button class="icon-btn danger" data-act="del" aria-label="删除">${icon('trash')}</button>
        </span>
      </li>`;
  }

  // ============================================================
  // 全部任务（列表 / 看板）
  // ============================================================
  function renderTasksView() {
    // 模式切换
    const isKanban = state.taskMode === 'kanban';
    $('#listMode').hidden = isKanban;
    $('#kanbanMode').hidden = !isKanban;
    $$('#taskMode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.taskMode));

    renderCatChips();
    if (isKanban) renderKanban();
    else { renderTabs(); renderList(); }
  }

  function renderCatChips() {
    const el = $('#catChips');
    if (!el) return;
    const names = ['全部', ...state.categories.map((c) => c.name), '未分类'];
    el.innerHTML = names.map((n) => {
      const color = n === '全部' ? '' : n === '未分类' ? '#94a3b8' : catColor(n);
      const style = color ? `style="--chip-color:${color}"` : '';
      return `<button class="chip ${state.cat === n ? 'active' : ''}" data-cat="${esc(n)}" ${style}>${esc(n)}</button>`;
    }).join('');
  }

  function renderTabs() {
    const base = catFiltered();
    $('#cAll').textContent = base.length;
    $('#cToday').textContent = base.filter(isToday).length;
    $('#cPending').textContent = base.filter((t) => !t.completed).length;
    $('#cDone').textContent = base.filter((t) => t.completed).length;
    $('#cOverdue').textContent = base.filter(isOverdue).length;
    $$('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  }

  function renderList() {
    const list = visibleTasks();
    const total = list.length;
    const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > maxPage) state.page = maxPage;
    const start = (state.page - 1) * state.pageSize;
    const pageItems = list.slice(start, start + state.pageSize);

    const ul = $('#taskList');
    const empty = $('#emptyState');

    if (!pageItems.length) {
      ul.innerHTML = '';
      empty.hidden = false;
      const kw = state.search.trim();
      $('#emptyTitle').textContent = kw ? `没有匹配「${kw}」的任务` : '这里还没有任务';
      $('#emptyText').textContent = kw ? '换个关键词试试，或清空搜索。' : '点「新建任务」添加第一条。';
    } else {
      empty.hidden = true;
      ul.innerHTML = pageItems.map(taskRow).join('');
    }

    $('#footInfo').textContent = `共 ${total} 个任务`;
    const pager = $('#pager');
    if (maxPage <= 1) { pager.innerHTML = ''; return; }

    const nums = [];
    for (let p = 1; p <= maxPage; p++) {
      if (p === 1 || p === maxPage || Math.abs(p - state.page) <= 1) nums.push(p);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    pager.innerHTML = `
      <button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>${icon('left')}</button>
      ${nums.map((p) => (p === '…' ? '<span style="padding:0 4px">…</span>'
        : `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`)).join('')}
      <button class="page-btn" data-page="${state.page + 1}" ${state.page === maxPage ? 'disabled' : ''}>${icon('right')}</button>`;
  }

  // ---------- 看板 ----------
  function statusOf(t) {
    if (t.status) return t.status;
    return t.completed ? 'done' : 'todo';
  }

  function renderKanban() {
    const cols = { todo: [], doing: [], done: [] };
    catFiltered().forEach((t) => {
      const st = statusOf(t);
      (cols[st] || cols.todo).push(t);
    });

    ['todo', 'doing', 'done'].forEach((st) => {
      const body = $(`[data-drop="${st}"]`);
      if (!body) return;
      const items = sortTasks(cols[st]);
      body.innerHTML = items.length ? items.map((t) => {
        const color = t.category ? catColor(t.category) : '#94a3b8';
        const sub = t.subtask_total
          ? `<span class="sub-progress">${t.subtask_done}/${t.subtask_total}</span>` : '';
        const repeat = t.repeat_type && t.repeat_type !== 'none'
          ? `<span class="repeat-tag">${icon('repeat')}${REPEAT_LABEL[t.repeat_type]}</span>` : '';
        return `
          <div class="kanban-card" draggable="true" data-task-id="${t.id}">
            <div class="kanban-card-title">${esc(t.title)}</div>
            <div class="kanban-card-meta">
              <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
              <span style="color:${color}">${esc(t.category || '未分类')}</span>
              ${t.due_date ? `<span>${esc(dueLabel(t))}</span>` : ''}
              ${sub}${repeat}
            </div>
          </div>`;
      }).join('') : '<div class="kanban-empty">暂无任务</div>';
    });

    $('#kbTodoCount').textContent = cols.todo.length;
    $('#kbDoingCount').textContent = cols.doing.length;
    $('#kbDoneCount').textContent = cols.done.length;

    bindKanbanDrag();
  }

  function bindKanbanDrag() {
    $$('.kanban-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.taskId);
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => openDetail(Number(card.dataset.taskId)));
    });

    $$('.kanban-col-body').forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const target = col.dataset.drop;
        const task = state.tasks.find((t) => t.id === id);
        if (!task || statusOf(task) === target) return;

        // 未迁移时数据库没有 status 字段，只能表达"完成/未完成"
        if (!state.meta.features || !state.meta.features.status) {
          if (target === 'done' || task.completed) {
            await toggleTask(task);
          } else {
            toast('数据库未启用看板状态，请先执行 V3 迁移 SQL', 'warn');
          }
          return;
        }

        try {
          await patchJSON(`${API.tasks}/${task.id}`, { status: target });
          task.status = target;
          task.completed = target === 'done';
          toast(`已移动到「${STATUS_LABEL[target]}」`);
          await loadTasks(true);
          renderKanban();
        } catch (err) {
          toast('移动失败：' + err.message, 'err');
        }
      });
    });
  }

  // ============================================================
  // 日历中心
  // ============================================================
  function renderCalendar() {
    const d = state.calDate;
    const year = d.getFullYear();
    const month = d.getMonth();
    $('#calTitle').textContent = state.calView === 'day'
      ? `${year}年${month + 1}月${d.getDate()}日`
      : `${year}年${month + 1}月`;

    if (state.calView === 'month') renderMonthView(year, month);
    else if (state.calView === 'week') renderWeekView(d);
    else renderDayView(d);
  }

  function taskDots(list, limit) {
    const shown = list.slice(0, limit);
    return shown.map((t) => `
      <div class="cal-task-dot pri-${esc(t.priority)}" data-task-id="${t.id}" title="${esc(t.title)}">
        ${esc(t.title)}
      </div>`).join('') +
      (list.length > limit ? `<div style="font-size:10px;color:var(--text-3)">+${list.length - limit} 更多</div>` : '');
  }

  function renderMonthView(year, month) {
    const body = $('#calendarBody');
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const prevDays = new Date(year, month, 0).getDate();
    const today = todayStr();

    let html = '<div class="cal-grid">';
    WEEK_SHORT.forEach((w) => { html += `<div class="cal-head-cell">${w}</div>`; });

    for (let i = startWeekday - 1; i >= 0; i--) {
      html += `<div class="cal-cell other-month"><div class="cal-day-num">${prevDays - i}</div></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      const list = state.tasks.filter((t) => t.due_date === dateStr && !t.completed);
      html += `<div class="cal-cell ${dateStr === today ? 'today' : ''}" data-date="${dateStr}">
        <div class="cal-day-num">${day}</div>
        ${taskDots(sortTasks(list), 3)}
      </div>`;
    }

    const total = startWeekday + daysInMonth;
    const rest = (7 - (total % 7)) % 7;
    for (let i = 1; i <= rest; i++) {
      html += `<div class="cal-cell other-month"><div class="cal-day-num">${i}</div></div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    bindCalTaskClick(body);
  }

  function renderWeekView(d) {
    const body = $('#calendarBody');
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    const today = todayStr();

    let html = '<div class="cal-grid">';
    WEEK_SHORT.forEach((w) => { html += `<div class="cal-head-cell">${w}</div>`; });
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = dayStr(day);
      const list = state.tasks.filter((t) => t.due_date === key && !t.completed);
      html += `<div class="cal-cell ${key === today ? 'today' : ''}" data-date="${key}" style="min-height:130px">
        <div class="cal-day-num">${day.getMonth() + 1}/${day.getDate()}</div>
        ${taskDots(sortTasks(list), 5)}
      </div>`;
    }
    html += '</div>';
    body.innerHTML = html;
    bindCalTaskClick(body);
  }

  function renderDayView(d) {
    const body = $('#calendarBody');
    const key = dayStr(d);
    const list = sortTasks(state.tasks.filter((t) => t.due_date === key));

    body.innerHTML = `
      <div style="padding:8px 4px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <h3>${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}</h3>
          <span class="card-sub">${list.length} 个任务</span>
        </div>
        <ul class="task-list">${list.length ? list.map(taskRow).join('') : ''}</ul>
        ${list.length ? '' : '<div class="empty-state"><h3>这一天没有任务</h3><p>点击「新建任务」安排在当天。</p></div>'}
      </div>`;
  }

  function bindCalTaskClick(root) {
    $$('.cal-task-dot', root).forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(Number(el.dataset.taskId));
      });
    });
  }

  // ============================================================
  // 我的计划
  // ============================================================
  function renderPlan() {
    const body = $('#planBody');
    const hint = $('#planHint');
    $$('#planTabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.plan === state.planTab));
    if (!body) return;

    if (state.planTab === 'repeat') {
      const list = sortTasks(state.tasks.filter((t) => t.repeat_type && t.repeat_type !== 'none'));
      hint.textContent = `${list.length} 个重复任务`;
      body.innerHTML = list.length
        ? `<div class="plan-group">
            <div class="plan-group-head"><h4>重复任务系列</h4><span class="plan-badge">完成后自动生成下一次</span></div>
            <ul class="task-list">${list.map(taskRow).join('')}</ul>
          </div>`
        : emptyPlan('还没有重复任务', '新建任务时把「重复」设为每天 / 每周 / 每月即可。');
      return;
    }

    if (state.planTab === 'nodate') {
      const list = sortTasks(state.tasks.filter((t) => !t.due_date && !t.completed));
      hint.textContent = `${list.length} 个待安排任务`;
      body.innerHTML = list.length
        ? `<div class="plan-group">
            <div class="plan-group-head"><h4>待安排日期</h4><span class="plan-badge">建议尽快定下时间</span></div>
            <ul class="task-list">${list.map(taskRow).join('')}</ul>
          </div>`
        : emptyPlan('没有待安排的任务', '所有任务都有明确的截止日期。');
      return;
    }

    // 未来安排：按日期分组
    const today = todayStr();
    const overdue = sortTasks(state.tasks.filter(isOverdue));
    const upcoming = state.tasks.filter((t) => !t.completed && t.due_date && t.due_date >= today);
    const groups = new Map();
    upcoming.forEach((t) => {
      if (!groups.has(t.due_date)) groups.set(t.due_date, []);
      groups.get(t.due_date).push(t);
    });

    const keys = Array.from(groups.keys()).sort();
    hint.textContent = `${upcoming.length} 个待完成，分布在 ${keys.length} 天`;

    let html = '';
    if (overdue.length) {
      html += `<div class="plan-group overdue">
        <div class="plan-group-head"><h4>已逾期</h4><span class="plan-date">先处理这些</span><span class="plan-badge">${overdue.length} 项</span></div>
        <ul class="task-list">${overdue.map(taskRow).join('')}</ul>
      </div>`;
    }
    keys.forEach((k) => {
      const list = sortTasks(groups.get(k));
      const label = k === today ? '今天' : k === addDays(today, 1) ? '明天' : WEEK[new Date(k + 'T00:00:00').getDay()];
      html += `<div class="plan-group">
        <div class="plan-group-head">
          <h4>${label}</h4>
          <span class="plan-date">${fmtDate(k)}</span>
          <span class="plan-badge">${list.length} 项</span>
        </div>
        <ul class="task-list">${list.map(taskRow).join('')}</ul>
      </div>`;
    });

    body.innerHTML = html || emptyPlan('近期没有安排', '去「全部任务」里给任务加上截止日期吧。');
  }

  function emptyPlan(title, desc) {
    return `<div class="card"><div class="empty-state">
      <svg class="icon empty-icon"><use href="#i-target"/></svg>
      <h3>${esc(title)}</h3><p>${esc(desc)}</p>
    </div></div>`;
  }

  // ============================================================
  // 专注中心（番茄钟）
  // ============================================================
  function pomDurations() {
    return {
      focus: (Number(localStorage.getItem(LS.pomFocus)) || 25) * 60,
      short: (Number(localStorage.getItem(LS.pomShort)) || 5) * 60,
      long: (Number(localStorage.getItem(LS.pomLong)) || 15) * 60
    };
  }

  function updatePomDisplay() {
    const m = Math.floor(state.pom.seconds / 60);
    const s = state.pom.seconds % 60;
    const timeEl = $('#pomTime');
    if (timeEl) timeEl.textContent = `${pad(m)}:${pad(s)}`;

    const circumference = 2 * Math.PI * 118;
    const progress = 1 - state.pom.seconds / state.pom.totalSeconds;
    const ring = $('#pomProgress');
    if (ring) {
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = circumference * (1 - progress);
    }
    const btn = $('#pomStart');
    if (btn) btn.innerHTML = state.pom.running ? icon('pause') : icon('play');
  }

  function setPomMode(mode) {
    state.pom.mode = mode;
    stopPomTimer();
    const d = pomDurations();
    state.pom.seconds = d[mode];
    state.pom.totalSeconds = d[mode];
    $$('.pom-mode').forEach((b) => b.classList.toggle('active', b.dataset.pmode === mode));
    updatePomDisplay();
  }

  function startPomTimer() {
    if (state.pom.running) { stopPomTimer(); return; }
    state.pom.running = true;
    state.pom.timer = setInterval(() => {
      state.pom.seconds -= 1;
      if (state.pom.seconds <= 0) {
        stopPomTimer();
        const minutes = Math.round(state.pom.totalSeconds / 60);
        if (state.pom.mode === 'focus') {
          logPomodoro(minutes);
          toast(`专注 ${minutes} 分钟完成，休息一下吧 ☕`);
          setPomMode('short');
        } else {
          toast('休息结束，继续加油 💪');
          setPomMode('focus');
        }
      }
      updatePomDisplay();
    }, 1000);
    updatePomDisplay();
  }

  function stopPomTimer() {
    state.pom.running = false;
    if (state.pom.timer) { clearInterval(state.pom.timer); state.pom.timer = null; }
    updatePomDisplay();
  }

  function resetPomTimer() {
    stopPomTimer();
    const d = pomDurations();
    state.pom.seconds = d[state.pom.mode];
    state.pom.totalSeconds = d[state.pom.mode];
    updatePomDisplay();
  }

  async function logPomodoro(minutes) {
    try {
      await postJSON(API.pomodoro, {
        duration: minutes,
        type: state.pom.mode,
        taskId: state.detailTaskId || null
      });
      await loadPomodoroStats();
    } catch (err) {
      if (err.code === 'NO_POMODORO_TABLE') {
        toast('专注记录未保存：数据库需执行 V3 迁移', 'warn');
      } else {
        toast('专注记录保存失败：' + err.message, 'err');
      }
    }
  }

  function renderPomodoroStats() {
    const s = state.pomStats || {};
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#pomTodayCount', s.today || 0);
    set('#pomTotalCount', s.total || 0);
    set('#pomMinutesToday', s.minutesToday || 0);

    const hint = $('#pomSyncHint');
    if (hint) hint.textContent = (state.meta.features && state.meta.features.pomodoro === false)
      ? '未启用云端记录（需执行 V3 迁移）' : '已同步到数据库';

    const list = $('#pomHistory');
    if (!list) return;
    const daily = (s.daily || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    list.innerHTML = daily.length
      ? daily.map((d) => `
          <li class="pom-history-item">
            <span class="ph-dot"></span>
            <span class="ph-mode">${fmtDate(d.date)}</span>
            <span class="ph-min">专注 ${d.count} 次</span>
            <span class="ph-time">${d.date === todayStr() ? '今天' : ''}</span>
          </li>`).join('')
      : '<li class="pom-history-item" style="color:var(--text-3)">还没有专注记录，完成一次专注后会自动保存</li>';
  }

  // ============================================================
  // 数据分析
  // ============================================================
  function renderAnalytics() {
    renderDailyChart();
    renderWeeklyChart();
    renderCategoryStats();
    renderMonthlyStats();
    renderHeatmapInto($('#heatmap2'), $('#heatStats2'), $('#heatLegend2'));
  }

  function renderDailyChart() {
    const box = $('#dailyChartBox');
    if (!box) return;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayStr(d);
      days.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        done: state.tasks.filter((t) => t.completed
          && isoDay(t.completed_at || t.created_at) === key).length
      });
    }
    const max = Math.max(...days.map((d) => d.done), 1);
    $('#dailySub').textContent = `总计 ${days.reduce((a, b) => a + b.done, 0)} 个`;

    box.innerHTML = `<div style="display:flex;align-items:flex-end;gap:3px;height:100%;padding-top:8px">
      ${days.map((d) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" title="${d.label}：${d.done} 个">
        <div style="width:100%;background:var(--gradient);border-radius:3px 3px 0 0;height:${(d.done / max) * 100}%;min-height:${d.done > 0 ? 4 : 1}px"></div>
      </div>`).join('')}
    </div>`;
  }

  function renderWeeklyChart() {
    const box = $('#weeklyChartBox');
    if (!box) return;
    const weeks = [];
    for (let w = 5; w >= 0; w--) {
      const end = new Date();
      end.setDate(end.getDate() - w * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const done = state.tasks.filter((t) => {
        if (!t.completed) return false;
        const d = new Date(t.completed_at || t.created_at);
        return d >= start && d <= end;
      }).length;
      weeks.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, done });
    }
    const max = Math.max(...weeks.map((w) => w.done), 1);

    box.innerHTML = `<div style="display:flex;align-items:flex-end;gap:14px;height:100%;padding:12px 10px 0">
      ${weeks.map((w) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:6px">
        <div style="font-size:12px;font-weight:700">${w.done}</div>
        <div style="width:100%;max-width:40px;background:var(--primary);border-radius:6px 6px 0 0;height:${(w.done / max) * 88}%;min-height:${w.done > 0 ? 4 : 2}px"></div>
        <div style="font-size:10px;color:var(--text-3)">${w.label}</div>
      </div>`).join('')}
    </div>`;
  }

  function renderCategoryStats() {
    const el = $('#categoryStats');
    if (!el) return;
    const map = new Map();
    state.tasks.forEach((t) => {
      const k = t.category || '未分类';
      if (!map.has(k)) map.set(k, { total: 0, done: 0 });
      const o = map.get(k);
      o.total += 1;
      if (t.completed) o.done += 1;
    });

    const rows = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, rate: v.total ? Math.round((v.done / v.total) * 100) : 0,
        color: name === '未分类' ? '#94a3b8' : catColor(name) }))
      .sort((a, b) => b.total - a.total);

    el.innerHTML = rows.length ? rows.map((r) => `
      <div class="cat-stat-row">
        <span class="cat-name">${esc(r.name)}</span>
        <div class="cat-stat-bar"><i style="width:${r.rate}%;background:${r.color}"></i></div>
        <span class="cat-pct">${r.done}/${r.total}（${r.rate}%）</span>
      </div>`).join('') : '<p style="color:var(--text-3);text-align:center;padding:20px">暂无数据</p>';
  }

  function renderMonthlyStats() {
    const el = $('#monthlyStats');
    if (!el) return;
    const now = new Date();
    const monthTasks = state.tasks.filter((t) => {
      const d = new Date(t.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const monthDone = monthTasks.filter((t) => t.completed).length;
    const rate = monthTasks.length ? Math.round((monthDone / monthTasks.length) * 100) : 0;

    el.innerHTML = `
      <div class="monthly-stat-item"><b>${monthTasks.length}</b><span>本月新增</span></div>
      <div class="monthly-stat-item"><b>${monthDone}</b><span>本月完成</span></div>
      <div class="monthly-stat-item"><b>${rate}%</b><span>本月完成率</span></div>
      <div class="monthly-stat-item"><b>${state.tasks.filter(isOverdue).length}</b><span>当前逾期</span></div>`;
  }

  // ============================================================
  // 分类管理
  // ============================================================
  function renderCategories() {
    const list = $('#catManageList');
    if (!list) return;

    const countOf = (name) => state.tasks.filter((t) => name === '未分类' ? !t.category : t.category === name).length;

    list.innerHTML = state.categories.map((c) => {
      const n = countOf(c.name);
      return `
        <li class="cat-manage-item" data-cat-id="${c.id || ''}" data-cat-name="${esc(c.name)}">
          <span class="cat-color-dot" style="background:${c.color}"></span>
          <span class="cat-name-text">${esc(c.name)}</span>
          <span class="cat-count">${n} 个任务</span>
          <span class="cat-acts">
            <button class="icon-btn" data-cat-act="edit" aria-label="重命名">${icon('edit')}</button>
            <button class="icon-btn danger" data-cat-act="del" aria-label="删除">${icon('trash')}</button>
          </span>
        </li>`;
    }).join('') || '<li class="cat-manage-item" style="color:var(--text-3)">暂无分类</li>';

    const un = countOf('未分类');
    $('#catCountHint').textContent = `${state.categories.length} 个分类 · 未分类 ${un} 个任务`;

    const banner = $('#catBanner');
    if (banner) banner.hidden = !!(state.meta.features && state.meta.features.categories);
  }

  // 行内编辑名称
  function startCatEdit(li) {
    const name = li.dataset.catName;
    const id = li.dataset.catId;
    if (!id) { toast('内置分类需要先执行 V3 迁移才能修改', 'warn'); return; }

    const original = li.innerHTML;
    li.innerHTML = `
      <input type="text" class="input-text" id="catEditInput" value="${esc(name)}" maxlength="12" style="max-width:220px">
      <button class="btn-secondary" data-cat-act="save">保存</button>
      <button class="btn-secondary" data-cat-act="cancel">取消</button>`;

    const input = $('#catEditInput', li);
    input.focus();
    input.select();

    const cancel = () => { li.innerHTML = original; };
    $('[data-cat-act="cancel"]', li).addEventListener('click', cancel);
    $('[data-cat-act="save"]', li).addEventListener('click', async () => {
      const v = input.value.trim();
      if (!v) { toast('分类名称不能为空', 'warn'); return; }
      try {
        await patchJSON(`${API.categories}/${id}`, { name: v });
        toast('分类已更新');
        await Promise.all([loadCategories(), loadTasks(true), loadMeta()]);
        renderCategories();
      } catch (err) {
        toast('更新失败：' + err.message, 'err');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('[data-cat-act="save"]', li).click();
      if (e.key === 'Escape') cancel();
    });
  }

  async function deleteCategory(li) {
    const id = li.dataset.catId;
    const name = li.dataset.catName;
    if (!id) { toast('内置分类需要先执行 V3 迁移才能删除', 'warn'); return; }

    const ok = await openConfirm(`分类「${name}」`);
    if (!ok) return;

    try {
      await api(`${API.categories}/${id}`, { method: 'DELETE' });
      toast('分类已删除，相关任务变为未分类');
      await Promise.all([loadCategories(), loadTasks(true), loadMeta()]);
      renderCategories();
    } catch (err) {
      toast('删除失败：' + err.message, 'err');
    }
  }

  // ============================================================
  // 设置
  // ============================================================
  function renderSettings() {
    const f = (state.meta.features) || {};
    const items = [
      ['dueDate', '截止日期'], ['category', '分类'], ['completedAt', '完成时间'],
      ['status', '看板状态'], ['repeat', '重复任务'], ['subtasks', '子任务'],
      ['pomodoro', '专注记录'], ['heatmap', '热力图'], ['categories', '分类管理']
    ];
    $('#featureGrid').innerHTML = items.map(([k, label]) => `
      <div class="feature-item ${f[k] ? '' : 'off'}"><span class="fi-dot"></span>${label}</div>`).join('');

    $('#dbState').textContent = state.offline
      ? '连接异常，当前显示本地缓存'
      : `已连接 Supabase · ${state.tasks.length} 条任务`;

    const banner = $('#dbBanner');
    if (banner) banner.hidden = !!(f.status && f.subtasks && f.heatmap && f.pomodoro);

    $('#pomFocusLen').value = localStorage.getItem(LS.pomFocus) || 25;
    $('#pomShortLen').value = localStorage.getItem(LS.pomShort) || 5;
    $('#pomLongLen').value = localStorage.getItem(LS.pomLong) || 15;
    $('#pageSizeSelect').value = String(state.pageSize);
    syncSwitches();
  }

  // ============================================================
  // 主题 / 侧边栏 / 弹窗
  // ============================================================
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(LS.theme, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f4f6fb');
    const tIcon = $('#themeIcon use');
    if (tIcon) tIcon.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    syncSwitches();
  }

  function syncSwitches() {
    const dark = state.theme === 'dark';
    const t = $('#themeSwitch2');
    if (t) t.classList.toggle('on', dark);
    const r = $('#remindSwitch');
    if (r) r.classList.toggle('on', state.remind);
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    if (state.view === 'dashboard') renderLineChart();
  }

  const openSidebar = () => {
    $('#sidebar').classList.add('open');
    $('#scrim').classList.add('show');
  };
  const closeSidebar = () => {
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
  };

  // ---------- 任务弹窗 ----------
  function renderCategoryOptions(selected) {
    const el = $('#fCategory');
    if (!el) return;
    el.innerHTML = state.categories.map((c) =>
      `<button class="seg-btn ${c.name === selected ? 'active' : ''}" data-val="${esc(c.name)}">${esc(c.name)}</button>`
    ).join('');
    $('#fCategoryField').style.display = (state.meta.features && state.meta.features.category) ? '' : 'none';
  }

  function openTaskModal(task) {
    state.editingId = task ? task.id : null;
    $('#modalTitle').textContent = task ? '编辑任务' : '新建任务';
    $('#modalSave').textContent = task ? '保存修改' : '添加任务';
    $('#fTitle').value = task ? task.title : '';
    $('#fDue').value = task ? (task.due_date || '') : todayStr();

    const pri = task ? task.priority : '中';
    $$('#fPriority .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === pri));

    renderCategoryOptions(task ? (task.category || '') : (state.categories[0] ? state.categories[0].name : ''));

    const repeat = task ? (task.repeat_type || 'none') : 'none';
    $$('#fRepeat .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === repeat));
    $('#fRepeatUntil').value = task ? (task.repeat_until || '') : '';
    $('#fRepeatUntilField').hidden = repeat === 'none';
    $('#fRepeatField').style.display = (state.meta.features && state.meta.features.repeat) ? '' : 'none';

    // 子任务：编辑已有任务时可直接管理，新建时提示先保存
    const subField = $('#fSubtaskField');
    const supported = state.meta.features && state.meta.features.subtasks;
    subField.hidden = !supported || !task;
    if (task && supported) loadSubtaskEditor(task.id);

    const hasCat = state.meta.features && state.meta.features.category;
    $('#fHint').textContent = hasCat ? '' : '数据库未启用分类字段，本次只保存标题、优先级和截止日期。';

    $('#taskModal').hidden = false;
    setTimeout(() => $('#fTitle').focus(), 60);
  }

  function closeTaskModal() {
    $('#taskModal').hidden = true;
    state.editingId = null;
    $('#fSubtaskEditor').innerHTML = '';
  }

  // ---------- 子任务编辑器 ----------
  async function loadSubtaskEditor(taskId) {
    const box = $('#fSubtaskEditor');
    if (!box) return;
    box.innerHTML = '<span class="field-tip">加载中…</span>';
    try {
      const json = await api(`${API.tasks}/${taskId}/subtasks`);
      renderSubtaskEditor(json.data || []);
    } catch (err) {
      box.innerHTML = `<span class="field-tip">子任务加载失败：${esc(err.message)}</span>`;
    }
  }

  function renderSubtaskEditor(list) {
    const box = $('#fSubtaskEditor');
    const prog = $('#fSubtaskProgress');
    if (!box) return;

    box.innerHTML = list.length ? list.map((s) => `
      <div class="subtask-item ${s.done ? 'done' : ''}" data-sub-id="${s.id}">
        <div class="subtask-check" data-sub-act="toggle">${icon('check')}</div>
        <span class="subtask-title">${esc(s.title)}</span>
        <button class="subtask-del" data-sub-act="del" aria-label="删除">×</button>
      </div>`).join('') : '<span class="field-tip">还没有子任务</span>';

    if (prog) {
      const done = list.filter((s) => s.done).length;
      prog.textContent = list.length ? `${done}/${list.length} 已完成` : '';
    }

    $$('[data-sub-act]', box).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.subtask-item');
        const id = row.dataset.subId;
        if (btn.dataset.subAct === 'toggle') {
          const nextDone = !row.classList.contains('done');
          try {
            await patchJSON(`/api/subtasks/${id}`, { done: nextDone });
            row.classList.toggle('done', nextDone);
            const items = $$('.subtask-item', box);
            const done = items.filter((x) => x.classList.contains('done')).length;
            if (prog) prog.textContent = `${done}/${items.length} 已完成`;
            await loadTasks(true);
          } catch (err) { toast('更新失败：' + err.message, 'err'); }
        }
        if (btn.dataset.subAct === 'del') {
          try {
            await api(`/api/subtasks/${id}`, { method: 'DELETE' });
            row.remove();
            const items = $$('.subtask-item', box);
            const done = items.filter((x) => x.classList.contains('done')).length;
            if (prog) prog.textContent = items.length ? `${done}/${items.length} 已完成` : '';
            await loadTasks(true);
          } catch (err) { toast('删除失败：' + err.message, 'err'); }
        }
      });
    });
  }

  async function addSubtaskFromEditor() {
    const input = $('#fSubtaskInput');
    const title = input.value.trim();
    if (!title) return;
    if (!state.editingId) { toast('请先保存任务再添加子任务', 'warn'); return; }

    try {
      await postJSON(`${API.tasks}/${state.editingId}/subtasks`, { title });
      input.value = '';
      await loadSubtaskEditor(state.editingId);
      await loadTasks(true);
    } catch (err) {
      toast('添加失败：' + err.message, 'err');
    }
  }

  // ---------- 详情弹窗 ----------
  async function openDetail(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    state.detailTaskId = id;

    const color = task.category ? catColor(task.category) : '#94a3b8';
    const repeat = task.repeat_type && task.repeat_type !== 'none'
      ? `<span class="repeat-tag">${icon('repeat')}${REPEAT_LABEL[task.repeat_type]}</span>` : '';

    $('#detailBody').innerHTML = `
      <h4 style="margin-bottom:10px;font-size:17px">${esc(task.title)}</h4>
      <div style="display:flex;flex-direction:column;gap:9px;font-size:14px">
        <div><span style="color:var(--text-2)">优先级：</span><span class="pri ${esc(task.priority)}">${esc(task.priority)}</span> ${repeat}</div>
        <div><span style="color:var(--text-2)">分类：</span><span style="color:${color}">${esc(task.category || '未分类')}</span></div>
        <div><span style="color:var(--text-2)">截止日期：</span>${task.due_date ? fmtDate(task.due_date) : '无'}</div>
        <div><span style="color:var(--text-2)">状态：</span>${STATUS_LABEL[statusOf(task)] || '待办'}</div>
        <div><span style="color:var(--text-2)">创建时间：</span>${task.created_at ? relTime(task.created_at) : '未知'}</div>
        ${task.completed_at ? `<div><span style="color:var(--text-2)">完成时间：</span>${relTime(task.completed_at)}</div>` : ''}
      </div>
      <div id="detailSubtasks"></div>`;

    $('#detailToggle').textContent = task.completed ? '标记未完成' : '标记完成';
    $('#detailModal').hidden = false;

    const supported = state.meta.features && state.meta.features.subtasks;
    if (supported) {
      try {
        const json = await api(`${API.tasks}/${id}/subtasks`);
        renderDetailSubtasks(json.data || []);
      } catch (err) {
        $('#detailSubtasks').innerHTML = `<p class="field-tip">子任务不可用：${esc(err.message)}</p>`;
      }
    } else {
      $('#detailSubtasks').innerHTML = '';
    }
  }

  function renderDetailSubtasks(list) {
    const box = $('#detailSubtasks');
    if (!box) return;
    const done = list.filter((s) => s.done).length;
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;

    box.innerHTML = `
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <b style="font-size:13px">子任务</b>
          <span class="field-tip">${list.length ? `${done}/${list.length} · ${pct}%` : '暂无'}</span>
        </div>
        ${list.length ? `<div class="progress-wrap"><div class="progress-bar"><i class="progress-fill" style="width:${pct}%"></i></div></div>` : ''}
        <div class="subtask-editor" id="detailSubList">
          ${list.map((s) => `
            <div class="subtask-item ${s.done ? 'done' : ''}" data-sub-id="${s.id}">
              <div class="subtask-check" data-sub-act="toggle">${icon('check')}</div>
              <span class="subtask-title">${esc(s.title)}</span>
              <button class="subtask-del" data-sub-act="del">×</button>
            </div>`).join('')}
        </div>
        <div class="subtask-add-row" style="margin-top:8px">
          <input type="text" id="detailSubInput" placeholder="添加子任务，回车确认" maxlength="120">
          <button class="btn-secondary" id="detailSubAdd">添加</button>
        </div>
      </div>`;

    const refresh = async () => {
      const json = await api(`${API.tasks}/${state.detailTaskId}/subtasks`);
      renderDetailSubtasks(json.data || []);
      await loadTasks(true);
    };

    $$('[data-sub-act]', box).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.subtask-item');
        const sid = row.dataset.subId;
        try {
          if (btn.dataset.subAct === 'toggle') {
            await patchJSON(`/api/subtasks/${sid}`, { done: !row.classList.contains('done') });
          } else {
            await api(`/api/subtasks/${sid}`, { method: 'DELETE' });
          }
          await refresh();
        } catch (err) { toast('操作失败：' + err.message, 'err'); }
      });
    });

    const add = async () => {
      const input = $('#detailSubInput');
      const title = input.value.trim();
      if (!title) return;
      try {
        await postJSON(`${API.tasks}/${state.detailTaskId}/subtasks`, { title });
        await refresh();
      } catch (err) { toast('添加失败：' + err.message, 'err'); }
    };
    const addBtn = $('#detailSubAdd');
    const addInput = $('#detailSubInput');
    if (addBtn) addBtn.addEventListener('click', add);
    if (addInput) addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  }

  // ---------- 确认框 ----------
  let confirmResolve = null;
  function openConfirm(name) {
    $('#confirmName').textContent = name;
    $('#confirmModal').hidden = false;
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(val) {
    $('#confirmModal').hidden = true;
    if (confirmResolve) { confirmResolve(val); confirmResolve = null; }
  }

  // ============================================================
  // 增删改
  // ============================================================
  async function saveTask() {
    const title = $('#fTitle').value.trim();
    if (!title) { toast('请先填写任务标题', 'warn'); $('#fTitle').focus(); return; }

    const priority = ($('#fPriority .seg-btn.active') || {}).dataset?.val || '中';
    const catBtn = $('#fCategory .seg-btn.active');
    const category = catBtn ? catBtn.dataset.val : null;
    const dueDate = $('#fDue').value || '';
    const repeatType = ($('#fRepeat .seg-btn.active') || {}).dataset?.val || 'none';
    const repeatUntil = $('#fRepeatUntil').value || null;

    const btn = $('#modalSave');
    const isEdit = !!state.editingId;
    btn.disabled = true;
    btn.textContent = '保存中…';

    let savedId = state.editingId;

    try {
      if (isEdit) {
        await patchJSON(`${API.tasks}/${state.editingId}`, {
          title, priority, category, dueDate: dueDate || null, repeatType, repeatUntil
        });
        toast('任务已更新');
      } else {
        const json = await postJSON(API.tasks, {
          title, priority, category, dueDate: dueDate || null, repeatType, repeatUntil
        });
        savedId = json.data && json.data.id;
        toast('任务已添加');
      }
      closeTaskModal();
      await loadTasks(true);

      // 新建的任务可能因为排序落到后面几页，自动跳到它所在的页，避免"加了却看不到"
      if (savedId && state.view === 'tasks' && state.taskMode === 'list') {
        const idx = visibleTasks().findIndex((t) => t.id === savedId);
        if (idx >= 0) state.page = Math.floor(idx / state.pageSize) + 1;
      }
      renderCurrentView();
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? '保存修改' : '添加任务';
    }
  }

  async function toggleTask(task) {
    const next = !task.completed;
    const old = task.completed;
    task.completed = next;
    task.status = next ? 'done' : 'todo';
    renderCurrentView();

    try {
      const json = await patchJSON(`${API.tasks}/${task.id}`, { completed: next });
      const updated = json.data || {};
      toast(next ? '任务已完成，干得漂亮！' : '已恢复为未完成');
      if (next && updated.repeat_type && updated.repeat_type !== 'none') {
        toast(`已生成下一次「${REPEAT_LABEL[updated.repeat_type]}」任务`);
      }
      await loadTasks(true);
      renderCurrentView();
    } catch (err) {
      task.completed = old;
      renderCurrentView();
      toast('操作失败：' + err.message, 'err');
    }
  }

  async function removeTask(task) {
    const ok = await openConfirm(task.title);
    if (!ok) return;
    try {
      await api(`${API.tasks}/${task.id}`, { method: 'DELETE' });
      toast('任务已删除');
      await loadTasks(true);
      renderCurrentView();
    } catch (err) {
      toast('删除失败：' + err.message, 'err');
    }
  }

  // ============================================================
  // 备份
  // ============================================================
  function download(url) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function importBackup(file) {
    const hint = $('#backupHint');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const tasks = Array.isArray(json) ? json : json.tasks;
      if (!Array.isArray(tasks)) throw new Error('文件里没有 tasks 数组');

      if (hint) hint.textContent = `正在导入 ${tasks.length} 条，请稍候…`;
      const res = await postJSON(API.import, { mode: 'merge', tasks });
      const d = res.data || {};
      if (hint) {
        hint.textContent = `导入完成：新增 ${d.inserted || 0} 条，跳过重复 ${d.skipped || 0} 条${d.failed ? `，失败 ${d.failed} 条` : ''}`;
      }
      toast(`导入完成：新增 ${d.inserted || 0} 条`);
      await loadTasks(true);
      renderSettings();
    } catch (err) {
      if (hint) hint.textContent = '导入失败：' + err.message;
      toast('导入失败：' + err.message, 'err');
    }
  }

  // ============================================================
  // AI
  // ============================================================
  async function updateAIStatus() {
    const el = $('#aiStatus');
    const backend = $('#aiBackendStatus');
    try {
      const res = await fetch(API.aiStatus);
      const data = await res.json();
      state.aiInfo = data;
      if (data.configured) {
        if (el) { el.textContent = `已连接 · ${data.model}`; el.classList.add('connected'); }
        if (backend) backend.innerHTML = '<span style="color:var(--success)">✓ 已配置 AI 服务</span>';
      } else {
        if (el) { el.textContent = '未配置'; el.classList.remove('connected'); }
        if (backend) backend.innerHTML = '<span style="color:var(--warning)">⚠️ 服务端未配置 AI_API_KEY，AI 助手暂不可用</span>';
      }
    } catch (_) {
      if (el) { el.textContent = '状态未知'; el.classList.remove('connected'); }
      if (backend) backend.textContent = '无法连接后端';
    }
  }

  function addAIMessage(text, isUser = false) {
    const wrap = $('#aiMessages');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `ai-message ${isUser ? 'user' : 'bot'}`;
    el.innerHTML = `
      <div class="ai-msg-avatar">${icon(isUser ? 'user' : 'brain')}</div>
      <div class="ai-msg-bubble"><p>${esc(text).replace(/\n/g, '<br>')}</p></div>`;
    wrap.appendChild(el);
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendAIMessage() {
    const input = $('#aiInput');
    const text = input.value.trim();
    if (!text) return;
    addAIMessage(text, true);
    input.value = '';

    addAIMessage('思考中…');
    const wrap = $('#aiMessages');
    const last = wrap.lastElementChild;

    try {
      const res = await postJSON(API.aiChat, { message: text });
      if (last) last.remove();
      addAIMessage(res.reply || '（无内容）');
    } catch (err) {
      if (last) last.remove();
      addAIMessage('❌ ' + err.message);
    }
  }

  // ============================================================
  // 提醒
  // ============================================================
  function checkReminder() {
    if (!state.remind) return;
    const today = todayStr();
    if (localStorage.getItem(LS.lastRemind) === today) return;
    const dueToday = state.tasks.filter((t) => !t.completed && isToday(t)).length;
    const overdue = state.tasks.filter(isOverdue).length;
    if (!dueToday && !overdue) return;
    localStorage.setItem(LS.lastRemind, today);
    const parts = [];
    if (dueToday) parts.push(`${dueToday} 个任务今天到期`);
    if (overdue) parts.push(`${overdue} 个任务已逾期`);
    setTimeout(() => toast(`提醒：${parts.join('，')}`, 'warn'), 800);
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bind() {
    // 导航
    $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.nav)));
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#sidebarClose')?.addEventListener('click', closeSidebar);

    // 主题
    $('#themeSwitch')?.addEventListener('click', toggleTheme);
    $('#themeSwitch2')?.addEventListener('click', toggleTheme);

    // 新建
    $('#btnAddTop')?.addEventListener('click', () => openTaskModal(null));

    // 首页快捷入口
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));

    // 首页今日/最近列表点击
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[data-open]');
      if (item) openDetail(Number(item.dataset.open));
    });

    // 任务标签页 / 分类 / 搜索 / 排序 / 模式
    $('#tabs')?.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      state.tab = b.dataset.tab;
      state.page = 1;
      renderTasksView();
    });

    $('#catChips')?.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      state.page = 1;
      renderTasksView();
    });

    const search = $('#searchInput');
    search?.addEventListener('input', () => {
      state.search = search.value;
      state.page = 1;
      const clear = $('#searchClear');
      if (clear) clear.hidden = !search.value;
      renderTasksView();
    });
    $('#searchClear')?.addEventListener('click', () => {
      search.value = '';
      state.search = '';
      $('#searchClear').hidden = true;
      renderTasksView();
    });

    $('#sortSelect')?.addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.page = 1;
      renderTasksView();
    });

    $('#taskMode')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      state.taskMode = b.dataset.mode;
      localStorage.setItem(LS.taskMode, state.taskMode);
      renderTasksView();
    });

    // 任务列表事件委托（列表 + 今日 + 计划 + 详情共用）
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.task [data-act]');
      if (!btn) return;
      const li = btn.closest('.task');
      if (!li) return;
      const task = state.tasks.find((t) => t.id === Number(li.dataset.id));
      if (!task) return;
      const act = btn.dataset.act;
      if (act === 'toggle') toggleTask(task);
      if (act === 'edit') openTaskModal(task);
      if (act === 'del') removeTask(task);
      if (act === 'open') openDetail(task.id);
    });

    // 分页
    $('#pager')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.page = Number(b.dataset.page);
      renderList();
    });

    // 任务弹窗
    $('#modalClose')?.addEventListener('click', closeTaskModal);
    $('#modalCancel')?.addEventListener('click', closeTaskModal);
    $('#modalSave')?.addEventListener('click', saveTask);
    $('#taskModal')?.addEventListener('click', (e) => { if (e.target === $('#taskModal')) closeTaskModal(); });

    $('#fPriority')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#fPriority .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });

    $('#fCategory')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const was = b.classList.contains('active');
      $$('#fCategory .seg-btn').forEach((x) => x.classList.remove('active'));
      if (!was) b.classList.add('active');
    });

    $('#fRepeat')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#fRepeat .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('#fRepeatUntilField').hidden = b.dataset.val === 'none';
    });

    $('#fSubtaskAdd')?.addEventListener('click', addSubtaskFromEditor);
    $('#fSubtaskInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addSubtaskFromEditor(); }
    });

    $('#fTitle')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
    });

    // 详情弹窗
    $('#detailClose')?.addEventListener('click', () => { $('#detailModal').hidden = true; state.detailTaskId = null; });
    $('#detailModal')?.addEventListener('click', (e) => {
      if (e.target === $('#detailModal')) { $('#detailModal').hidden = true; state.detailTaskId = null; }
    });
    $('#detailEdit')?.addEventListener('click', () => {
      const t = state.tasks.find((x) => x.id === state.detailTaskId);
      $('#detailModal').hidden = true;
      if (t) openTaskModal(t);
    });
    $('#detailToggle')?.addEventListener('click', async () => {
      const t = state.tasks.find((x) => x.id === state.detailTaskId);
      if (!t) return;
      $('#detailModal').hidden = true;
      await toggleTask(t);
    });

    // 确认框
    $('#confirmOk')?.addEventListener('click', () => closeConfirm(true));
    $('#confirmCancel')?.addEventListener('click', () => closeConfirm(false));
    $('#confirmModal')?.addEventListener('click', (e) => { if (e.target === $('#confirmModal')) closeConfirm(false); });

    // ESC
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#taskModal').hidden) closeTaskModal();
      if (!$('#confirmModal').hidden) closeConfirm(false);
      if (!$('#detailModal').hidden) { $('#detailModal').hidden = true; state.detailTaskId = null; }
      closeSidebar();
    });

    // 日历
    $('#calPrev')?.addEventListener('click', () => {
      if (state.calView === 'month') state.calDate.setMonth(state.calDate.getMonth() - 1);
      else if (state.calView === 'week') state.calDate.setDate(state.calDate.getDate() - 7);
      else state.calDate.setDate(state.calDate.getDate() - 1);
      renderCalendar();
    });
    $('#calNext')?.addEventListener('click', () => {
      if (state.calView === 'month') state.calDate.setMonth(state.calDate.getMonth() + 1);
      else if (state.calView === 'week') state.calDate.setDate(state.calDate.getDate() + 7);
      else state.calDate.setDate(state.calDate.getDate() + 1);
      renderCalendar();
    });
    $('#calToday')?.addEventListener('click', () => {
      state.calDate = new Date();
      renderCalendar();
    });
    $$('.cal-views .seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $$('.cal-views .seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.calView = b.dataset.calView;
        renderCalendar();
      });
    });

    // 我的计划
    $('#planTabs')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      state.planTab = b.dataset.plan;
      renderPlan();
    });

    // 番茄钟
    $$('.pom-mode').forEach((b) => b.addEventListener('click', () => setPomMode(b.dataset.pmode)));
    $('#pomStart')?.addEventListener('click', startPomTimer);
    $('#pomReset')?.addEventListener('click', resetPomTimer);
    $('#pomSettings')?.addEventListener('click', () => setView('settings'));

    // 分类管理
    $('#addCatBtn')?.addEventListener('click', async () => {
      const name = $('#newCatName').value.trim();
      const color = $('#newCatColor').value;
      if (!name) { toast('请输入分类名称', 'warn'); return; }
      try {
        await postJSON(API.categories, { name, color });
        $('#newCatName').value = '';
        toast('分类已添加');
        await Promise.all([loadCategories(), loadMeta()]);
        renderCategories();
        renderCatChips();
      } catch (err) {
        toast('添加失败：' + err.message, 'err');
      }
    });
    $('#catManageList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat-act]');
      if (!btn) return;
      const li = btn.closest('.cat-manage-item');
      if (btn.dataset.catAct === 'edit') startCatEdit(li);
      if (btn.dataset.catAct === 'del') deleteCategory(li);
    });
    $('#copySqlBtn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText('supabase/migration-v3.sql');
      toast('路径已复制：supabase/migration-v3.sql');
    });

    // AI
    $('#aiSend')?.addEventListener('click', sendAIMessage);
    $('#aiInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAIMessage(); });

    // 设置
    $('#remindSwitch')?.addEventListener('click', () => {
      state.remind = !state.remind;
      localStorage.setItem(LS.remind, state.remind ? '1' : '0');
      syncSwitches();
      toast(state.remind ? '已开启每日提醒' : '已关闭每日提醒');
    });
    $('#pageSizeSelect')?.addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value);
      localStorage.setItem(LS.pageSize, String(state.pageSize));
      state.page = 1;
      toast(`每页 ${state.pageSize} 条`);
    });
    $('#pomSaveSettings')?.addEventListener('click', () => {
      localStorage.setItem(LS.pomFocus, $('#pomFocusLen').value);
      localStorage.setItem(LS.pomShort, $('#pomShortLen').value);
      localStorage.setItem(LS.pomLong, $('#pomLongLen').value);
      resetPomTimer();
      toast('专注时长已保存');
    });
    $('#dbCheckBtn')?.addEventListener('click', async () => {
      toast('正在重新检测…');
      await Promise.all([loadMeta(), loadTasks(true), loadCategories()]);
      renderSettings();
      toast('检测完成');
    });
    $('#exportJsonBtn')?.addEventListener('click', () => download(`${API.export}?format=json`));
    $('#exportCsvBtn')?.addEventListener('click', () => download(`${API.export}?format=csv`));
    $('#importBtn')?.addEventListener('click', () => $('#importFile').click());
    $('#importFile')?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importBackup(f);
      e.target.value = '';
    });

    // 窗口尺寸变化时重绘图表
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (state.view === 'dashboard') { renderLineChart(); renderHeatmapInto($('#heatmap'), $('#heatStats'), $('#heatLegend')); }
        if (state.view === 'analytics') renderAnalytics();
      }, 220);
    });

    // 回到页面刷新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadTasks(true);
    });

    // 定时同步（1 分钟）
    setInterval(() => {
      if (document.hidden) return;
      loadTasks(true);
    }, 60000);
  }

  // ============================================================
  // 启动
  // ============================================================
  function renderTodayText() {
    const d = new Date();
    $('#todayText').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  }

  async function init() {
    applyTheme(state.theme);
    renderTodayText();

    const d = pomDurations();
    state.pom.seconds = d.focus;
    state.pom.totalSeconds = d.focus;
    updatePomDisplay();

    bind();

    await loadMeta();
    await loadCategories();
    await loadTasks();
    await Promise.all([loadPomodoroStats(), loadHeatmap()]);

    renderCurrentView();
    updateAIStatus();
    checkReminder();
  }

  init();
})();
