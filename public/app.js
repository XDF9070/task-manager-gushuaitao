/* ============================================================
   任务管理 V3.0 · 前端逻辑
   保留原有 API，新增日历/看板/番茄钟/AI助手/数据分析
   ============================================================ */

(() => {
  'use strict';

  // ============================================================
  // 常量
  // ============================================================
  const API = '/api/tasks';
  const API_META = '/api/meta';
  const LS = {
    theme: 'tm_theme',
    remind: 'tm_remind',
    pageSize: 'tm_pageSize',
    cache: 'tm_cache',
    lastRemind: 'tm_lastRemind',
    aiApiBase: 'tm_ai_api_base',
    aiApiKey: 'tm_ai_api_key',
    aiModel: 'tm_ai_model',
    pomFocus: 'tm_pom_focus',
    pomShort: 'tm_pom_short',
    pomLong: 'tm_pom_long',
    pomHistory: 'tm_pom_history'
  };
  const CATS = ['学习', '工作', '健身', '生活'];
  const CAT_COLOR = {
    '学习': '#3b82f6',
    '工作': '#8b5cf6',
    '健身': '#10b981',
    '生活': '#f59e0b',
    '未分类': '#94a3b8'
  };
  const PRI_RANK = { '高': 0, '中': 1, '低': 2 };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  const VIEW_TITLES = {
    dashboard: '仪表盘',
    tasks: '任务管理',
    calendar: '日历视图',
    kanban: '看板',
    pomodoro: '番茄钟',
    ai: 'AI 助手',
    analytics: '数据分析',
    settings: '设置'
  };

  // ============================================================
  // 状态
  // ============================================================
  const state = {
    tasks: [],
    meta: { features: { category: false, completedAt: false, dueDate: true } },
    view: 'dashboard',
    tab: 'all',
    cat: '全部',
    search: '',
    sort: 'due',
    page: 1,
    pageSize: Number(localStorage.getItem(LS.pageSize)) || 10,
    theme: localStorage.getItem(LS.theme) || 'light',
    remind: localStorage.getItem(LS.remind) !== '0',
    editingId: null,
    loading: true,
    offline: false,
    // 日历
    calDate: new Date(),
    calView: 'month',
    // 番茄钟
    pom: {
      mode: 'focus',
      running: false,
      seconds: 25 * 60,
      totalSeconds: 25 * 60,
      timer: null,
      focusCount: Number(localStorage.getItem(LS.pomHistory) || 0)
    },
    // AI
    aiConfig: {
      base: localStorage.getItem(LS.aiApiBase) || '',
      key: localStorage.getItem(LS.aiApiKey) || '',
      model: localStorage.getItem(LS.aiModel) || 'gpt-3.5-turbo'
    }
  };

  // ============================================================
  // 工具函数
  // ============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const icon = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function isoDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return dayStr(d);
  }

  function isOverdue(t) {
    return !t.completed && !!t.due_date && t.due_date < todayStr();
  }
  function isToday(t) {
    return t.due_date === todayStr();
  }

  function dueLabel(t) {
    if (!t.due_date) return '无截止日期';
    const today = todayStr();
    if (t.due_date === today) return '今天';
    const tm = new Date();
    tm.setDate(tm.getDate() + 1);
    if (t.due_date === dayStr(tm)) return '明天';
    const [, m, d] = t.due_date.split('-');
    return `${Number(m)}月${Number(d)}日`;
  }

  // ============================================================
  // Toast
  // ============================================================
  function toast(msg, type = 'ok') {
    const wrap = $('#toastWrap');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconName = type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'check';
    el.innerHTML = `${icon(iconName)}<span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, 2400);
  }

  // ============================================================
  // API
  // ============================================================
  async function api(url, options) {
    const res = await fetch(url, options);
    let json = null;
    try { json = await res.json(); } catch (_) {}
    if (!res.ok || !json || json.success === false) {
      throw new Error((json && json.message) || `请求失败（HTTP ${res.status}）`);
    }
    return json;
  }

  async function loadMeta() {
    try {
      const json = await api(API_META);
      state.meta = json;
    } catch (err) {
      console.warn('能力探测失败：', err.message);
    }
  }

  async function loadTasks(silent = false) {
    try {
      const json = await api(API);
      state.tasks = (json.data || []).map(normalize);
      state.offline = false;
      localStorage.setItem(LS.cache, JSON.stringify(state.tasks));
      state.loading = false;
      renderAll();
      if (!silent) checkReminder();
    } catch (err) {
      state.loading = false;
      const cache = localStorage.getItem(LS.cache);
      if (cache) {
        try {
          state.tasks = JSON.parse(cache).map(normalize);
          state.offline = true;
          renderAll();
          toast('网络异常，当前显示的是本地缓存数据', 'warn');
          return;
        } catch (_) {}
      }
      renderAll();
      toast('加载失败：' + err.message, 'err');
    }
  }

  function normalize(t) {
    return {
      id: t.id,
      title: t.title || '',
      priority: t.priority || '中',
      category: t.category || null,
      completed: !!t.completed,
      due_date: t.due_date || null,
      created_at: t.created_at || null,
      completed_at: t.completed_at || null
    };
  }

  // ============================================================
  // 筛选 / 排序
  // ============================================================
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
    list = byTab(list, state.tab);
    return sortTasks(list);
  }

  // ============================================================
  // 统计
  // ============================================================
  function stats() {
    const all = state.tasks;
    const total = all.length;
    const done = all.filter((t) => t.completed).length;
    const pending = total - done;
    const rate = total ? Math.round((done / total) * 100) : 0;
    const today = todayStr();
    const createdToday = all.filter((t) => isoDay(t.created_at) === today).length;
    const doneToday = all.filter((t) => t.completed && isoDay(t.completed_at || t.created_at) === today).length;
    const overdue = all.filter(isOverdue).length;
    const todayTasks = all.filter(t => !t.completed && isToday(t)).length;
    return { total, done, pending, rate, createdToday, doneToday, overdue, todayTasks };
  }

  // ============================================================
  // 视图切换
  // ============================================================
  function setView(view) {
    state.view = view;
    // 显示/隐藏视图
    const viewIdMap = {
      dashboard: 'viewDashboard',
      tasks: 'viewTasks',
      calendar: 'viewCalendar',
      kanban: 'viewKanban',
      pomodoro: 'viewPomodoro',
      ai: 'viewAI',
      analytics: 'viewAnalytics',
      settings: 'viewSettings'
    };
    Object.entries(viewIdMap).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = key !== view;
    });
    // 导航高亮
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    // 标题
    $('#pageTitle').textContent = VIEW_TITLES[view] || '仪表盘';
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 关闭移动端侧边栏
    closeSidebar();
    // 渲染对应视图
    if (view === 'dashboard') renderDashboard();
    if (view === 'tasks') renderTasksView();
    if (view === 'calendar') renderCalendar();
    if (view === 'kanban') renderKanban();
    if (view === 'analytics') renderAnalytics();
    if (view === 'settings') renderSettings();
  }

  // ============================================================
  // 仪表盘渲染
  // ============================================================
  function renderDashboard() {
    const s = stats();
    // 顶部统计
    $('#statTotal').textContent = s.total;
    $('#statDone').textContent = s.done;
    $('#statPending').textContent = s.pending;
    $('#statRate').textContent = s.rate + '%';
    $('#miniToday').textContent = s.todayTasks;
    $('#miniDone').textContent = s.done;
    $('#miniRate').textContent = s.rate + '%';

    // 环比标签
    setDelta('#deltaTotal', s.createdToday > 0 ? `+${s.createdToday}` : '持平', s.createdToday > 0 ? 'up' : 'flat');
    setDelta('#deltaDone', s.doneToday > 0 ? `+${s.doneToday}` : '持平', s.doneToday > 0 ? 'up' : 'flat');
    setDelta('#deltaPending', s.overdue > 0 ? `逾期 ${s.overdue}` : '无逾期', s.overdue > 0 ? 'down' : 'flat');
    setDelta('#deltaRate', `${s.rate}%`, 'flat');

    // 完成率圆环
    renderRateRing(s.rate);
    // 折线图
    renderLineChart();
    // 饼图
    renderDonut();
    // 今日待办
    renderTodayList();
    // 最近任务
    renderRecentList();
  }

  function setDelta(sel, text, cls) {
    const el = $(sel);
    if (el) {
      el.textContent = text;
      el.className = 'delta ' + cls;
    }
  }

  function renderRateRing(rate) {
    const r = 22, c = 2 * Math.PI * r;
    const off = c - (c * rate) / 100;
    $('#rateRing').innerHTML = `
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--primary)" stroke-width="5"
                stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
                style="transition:stroke-dashoffset .5s ease"/>
      </svg>
      <span class="ring-text">${rate}%</span>`;
  }

  function renderTodayList() {
    const list = state.tasks.filter(t => !t.completed && isToday(t)).slice(0, 5);
    const el = $('#todayList');
    if (!list.length) {
      el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-3);font-size:13px">🎉 今天没有待办任务</div>';
      return;
    }
    el.innerHTML = list.map(t => `
      <div class="today-item">
        <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
        <span class="task-title">${esc(t.title)}</span>
        <span class="cat-pill cat-${esc(t.category || '未分类')}">${esc(t.category || '未分类')}</span>
      </div>`).join('');
  }

  function renderRecentList() {
    const list = sortTasks(state.tasks.slice()).slice(0, 5);
    const el = $('#recentList');
    if (!list.length) {
      el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-3);font-size:13px">还没有任务</div>';
      return;
    }
    el.innerHTML = list.map(t => `
      <div class="recent-item">
        ${t.completed ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--text-3)">○</span>'}
        <span class="task-title" style="${t.completed ? 'text-decoration:line-through;opacity:0.6' : ''}">${esc(t.title)}</span>
        <span class="due">${esc(dueLabel(t))}</span>
      </div>`).join('');
  }

  // ============================================================
  // 折线图
  // ============================================================
  function last7() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ key: dayStr(d), date: d, label: WEEK_SHORT[d.getDay()] });
    }
    return out;
  }

  function renderLineChart() {
    const box = $('#lineChartBox');
    if (!box) return;
    const w = box.clientWidth - 14;
    const h = 178;
    if (w < 60) return;

    const padL = 34, padR = 16, padT = 16, padB = 26;
    const iw = w - padL - padR;
    const ih = h - padT - padB;

    const days = last7();
    const all = state.tasks;
    const data = days.map(d => {
      const totalBefore = all.filter(t => isoDay(t.created_at) <= d.key).length;
      const doneBefore = all.filter(t => {
        if (!t.completed) return false;
        if (isoDay(t.created_at) > d.key) return false;
        return t.completed_at ? isoDay(t.completed_at) <= d.key : true;
      }).length;
      return { label: d.label, key: d.key, value: totalBefore ? Math.round((doneBefore / totalBefore) * 100) : 0, hasData: totalBefore > 0 };
    });

    const x = (i) => padL + (iw / (data.length - 1)) * i;
    const y = (v) => padT + ih - (ih * v) / 100;
    const pts = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.value) }));

    let path = `M ${pts[0].cx} ${pts[0].cy}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.cx + (p2.cx - p0.cx) / 6;
      const c1y = p1.cy + (p2.cy - p0.cy) / 6;
      const c2x = p2.cx - (p3.cx - p1.cx) / 6;
      const c2y = p2.cy - (p3.cy - p1.cy) / 6;
      path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.cx} ${p2.cy}`;
    }
    const area = `${path} L ${pts[pts.length - 1].cx} ${padT + ih} L ${pts[0].cx} ${padT + ih} Z`;

    const gridLines = [0, 25, 50, 75, 100].map(v => `
      <line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}"
            stroke="var(--border)" stroke-width="1" stroke-dasharray="${v === 0 ? '0' : '3 4'}"/>
      <text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end" font-size="9.5" fill="var(--text-3)">${v}%</text>`).join('');

    const xLabels = pts.map(p => `
      <text x="${p.cx}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${p.label}</text>`).join('');

    const dots = pts.filter(p => p.hasData).map(p => `
      <circle cx="${p.cx}" cy="${p.cy}" r="3.4" fill="#fff" stroke="var(--primary)" stroke-width="2"/>`).join('');

    box.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${gridLines}${xLabels}
        ${data.some(d => d.hasData) ? `<path d="${area}" fill="url(#areaGrad)"/><path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.4" stroke-linecap="round"/>` : ''}
        ${dots}
      </svg>
      ${data.some(d => d.hasData) ? '' : '<div class="chart-empty">还没有任务数据</div>'}`;
  }

  // ============================================================
  // 饼图
  // ============================================================
  function renderDonut() {
    const box = $('#donutBox');
    const legend = $('#donutLegend');
    if (!box) return;
    const map = new Map();
    state.tasks.forEach(t => {
      const k = t.category && CATS.includes(t.category) ? t.category : '未分类';
      map.set(k, (map.get(k) || 0) + 1);
    });
    const order = [...CATS, '未分类'];
    const segs = order.filter(k => map.get(k)).map(k => ({ name: k, count: map.get(k), color: CAT_COLOR[k] }));
    const total = state.tasks.length;

    if (!segs.length) {
      box.innerHTML = '<div class="chart-empty" style="position:static">暂无数据</div>';
      legend.innerHTML = '';
      return;
    }

    const r = 40, C = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segs.map(s => {
      const frac = s.count / total;
      const len = C * frac;
      const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}"
        stroke-width="15" stroke-dasharray="${Math.max(len - 1.5, 0.6)} ${C - Math.max(len - 1.5, 0.6)}"
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

    legend.innerHTML = segs.map(s => {
      const pct = Math.round((s.count / total) * 100);
      return `<li><i class="dot" style="background:${s.color}"></i><span>${s.name}</span><span style="margin-left:auto;color:var(--text-3);font-size:12px">${s.count} (${pct}%)</span></li>`;
    }).join('');
  }

  // ============================================================
  // 任务管理视图
  // ============================================================
  function renderTasksView() {
    renderTabs();
    renderList();
  }

  function renderTabs() {
    const base = catFiltered();
    $('#cAll').textContent = base.length;
    $('#cToday').textContent = base.filter(isToday).length;
    $('#cPending').textContent = base.filter(t => !t.completed).length;
    $('#cDone').textContent = base.filter(t => t.completed).length;
    $('#cOverdue').textContent = base.filter(isOverdue).length;
    $$('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $$('#catChips .chip').forEach(b => b.classList.toggle('active', b.dataset.cat === state.cat));
  }

  function taskRow(t) {
    const catCls = t.category ? `cat-${t.category}` : 'cat-未分类';
    const catName = t.category || '未分类';
    const overdue = isOverdue(t);
    return `
      <li class="task ${t.completed ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
        <button class="task-check" data-act="toggle" aria-label="${t.completed ? '标记未完成' : '标记完成'}">
          ${icon('check')}
        </button>
        <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
        <span class="task-title">${esc(t.title)}</span>
        <span class="cat-pill ${catCls}">${catName}</span>
        <span class="due ${isToday(t) ? 'today' : ''}">${icon('calendar')}${dueLabel(t)}</span>
        ${t.completed ? '<span class="done-tag">已完成</span>' : ''}
        <span class="task-acts">
          <button class="icon-btn" data-act="edit" aria-label="编辑">${icon('edit')}</button>
          <button class="icon-btn danger" data-act="del" aria-label="删除">${icon('trash')}</button>
        </span>
      </li>`;
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
    } else {
      empty.hidden = true;
      ul.innerHTML = pageItems.map(taskRow).join('');
    }

    $('#footInfo').textContent = total ? `共 ${total} 个任务` : '共 0 个任务';
    const pager = $('#pager');
    if (maxPage <= 1) {
      pager.innerHTML = '';
    } else {
      const nums = [];
      const win = 2;
      for (let p = 1; p <= maxPage; p++) {
        if (p === 1 || p === maxPage || Math.abs(p - state.page) <= win) nums.push(p);
        else if (nums[nums.length - 1] !== '…') nums.push('…');
      }
      pager.innerHTML = `
        <button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>${icon('left')}</button>
        ${nums.map(p => p === '…' ? '<span style="padding:0 4px">…</span>' :
          `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('')}
        <button class="page-btn" data-page="${state.page + 1}" ${state.page === maxPage ? 'disabled' : ''}>${icon('right')}</button>`;
    }
  }

  // ============================================================
  // 日历视图
  // ============================================================
  function renderCalendar() {
    const d = state.calDate;
    const year = d.getFullYear();
    const month = d.getMonth();
    $('#calTitle').textContent = `${year}年${month + 1}月`;

    if (state.calView === 'month') renderMonthView(year, month);
    else if (state.calView === 'week') renderWeekView(d);
    else renderDayView(d);
  }

  function renderMonthView(year, month) {
    const body = $('#calendarBody');
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    let html = '<div class="cal-grid">';
    WEEK_SHORT.forEach(w => html += `<div class="cal-head-cell">${w}</div>`);

    // 上月尾巴
    for (let i = startWeekday - 1; i >= 0; i--) {
      html += `<div class="cal-cell other-month"><div class="cal-day-num">${prevMonthDays - i}</div></div>`;
    }

    // 本月
    const today = todayStr();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      const isTodayCell = dateStr === today;
      const dayTasks = state.tasks.filter(t => t.due_date === dateStr && !t.completed);
      html += `<div class="cal-cell ${isTodayCell ? 'today' : ''}" data-date="${dateStr}">
        <div class="cal-day-num">${day}</div>
        ${dayTasks.slice(0, 3).map(t => `<div class="cal-task-dot pri-${esc(t.priority)}" data-task-id="${t.id}">${esc(t.title)}</div>`).join('')}
        ${dayTasks.length > 3 ? `<div style="font-size:10px;color:var(--text-3)">+${dayTasks.length - 3} 更多</div>` : ''}
      </div>`;
    }

    // 下月开头
    const totalCells = startWeekday + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      html += `<div class="cal-cell other-month"><div class="cal-day-num">${i}</div></div>`;
    }

    html += '</div>';
    body.innerHTML = html;

    // 点击任务查看详情
    $$('.cal-task-dot', body).forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = Number(el.dataset.taskId);
        const task = state.tasks.find(t => t.id === taskId);
        if (task) showTaskDetail(task);
      });
    });
  }

  function renderWeekView(d) {
    // 简化：显示本周7天
    const body = $('#calendarBody');
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    let html = '<div class="cal-grid">';
    WEEK_SHORT.forEach(w => html += `<div class="cal-head-cell">${w}</div>`);
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const dateStr = dayStr(day);
      const dayTasks = state.tasks.filter(t => t.due_date === dateStr && !t.completed);
      html += `<div class="cal-cell" data-date="${dateStr}" style="min-height:120px">
        <div class="cal-day-num">${day.getMonth() + 1}/${day.getDate()}</div>
        ${dayTasks.map(t => `<div class="cal-task-dot pri-${esc(t.priority)}" data-task-id="${t.id}">${esc(t.title)}</div>`).join('')}
      </div>`;
    }
    html += '</div>';
    body.innerHTML = html;

    $$('.cal-task-dot', body).forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = state.tasks.find(t => t.id === Number(el.dataset.taskId));
        if (task) showTaskDetail(task);
      });
    });
  }

  function renderDayView(d) {
    const body = $('#calendarBody');
    const dateStr = dayStr(d);
    const dayTasks = state.tasks.filter(t => t.due_date === dateStr);
    body.innerHTML = `
      <div style="padding:20px">
        <h3 style="margin-bottom:16px">${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}</h3>
        ${dayTasks.length ? dayTasks.map(t => `
          <div class="kanban-card" style="margin-bottom:8px" data-task-id="${t.id}">
            <div class="kanban-card-title">${esc(t.title)}</div>
            <div class="kanban-card-meta">
              <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
              <span>${esc(t.category || '未分类')}</span>
              ${t.completed ? '<span style="color:var(--success)">已完成</span>' : ''}
            </div>
          </div>`).join('') : '<p style="color:var(--text-3);text-align:center;padding:40px">这一天没有任务</p>'}
      </div>`;

    $$('.kanban-card', body).forEach(el => {
      el.addEventListener('click', () => {
        const task = state.tasks.find(t => t.id === Number(el.dataset.taskId));
        if (task) showTaskDetail(task);
      });
    });
  }

  function showTaskDetail(task) {
    $('#detailBody').innerHTML = `
      <h4 style="margin-bottom:12px">${esc(task.title)}</h4>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
        <div><span style="color:var(--text-2)">优先级：</span><span class="pri ${esc(task.priority)}">${esc(task.priority)}</span></div>
        <div><span style="color:var(--text-2)">分类：</span>${esc(task.category || '未分类')}</div>
        <div><span style="color:var(--text-2)">截止日期：</span>${task.due_date || '无'}</div>
        <div><span style="color:var(--text-2)">状态：</span>${task.completed ? '✅ 已完成' : '⏳ 未完成'}</div>
        <div><span style="color:var(--text-2)">创建时间：</span>${isoDay(task.created_at) || '未知'}</div>
      </div>`;
    $('#detailModal').hidden = false;
  }

  // ============================================================
  // 看板视图
  // ============================================================
  function getKanbanTasks(status) {
    if (status === 'todo') return state.tasks.filter(t => !t.completed && PRI_RANK[t.priority] <= 1);
    if (status === 'doing') return state.tasks.filter(t => !t.completed && t.priority === '低');
    return state.tasks.filter(t => t.completed);
  }

  function renderKanban() {
    const cols = {
      todo: $('#kbTodoCount'),
      doing: $('#kbDoingCount'),
      done: $('#kbDoneCount')
    };
    ['todo', 'doing', 'done'].forEach(status => {
      const list = getKanbanTasks(status);
      const body = $(`[data-drop="${status}"]`);
      cols[status].textContent = list.length;
      body.innerHTML = list.map(t => `
        <div class="kanban-card" draggable="true" data-task-id="${t.id}">
          <div class="kanban-card-title">${esc(t.title)}</div>
          <div class="kanban-card-meta">
            <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
            <span>${esc(t.category || '未分类')}</span>
            ${t.due_date ? `<span>${esc(dueLabel(t))}</span>` : ''}
          </div>
        </div>`).join('');
    });
    bindKanbanDrag();
  }

  function bindKanbanDrag() {
    $$('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.taskId);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => {
        const task = state.tasks.find(t => t.id === Number(card.dataset.taskId));
        if (task) showTaskDetail(task);
      });
    });

    $$('.kanban-col-body').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const taskId = Number(e.dataTransfer.getData('text/plain'));
        const target = col.dataset.drop;
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) return;
        // 拖拽到已完成列 = 标记完成；拖回待办 = 标记未完成
        if (target === 'done' && !task.completed) {
          await toggleTask(task);
        } else if ((target === 'todo' || target === 'doing') && task.completed) {
          await toggleTask(task);
        } else {
          toast('状态已更新');
        }
        renderKanban();
      });
    });
  }

  // ============================================================
  // 番茄钟
  // ============================================================
  function getPomDurations() {
    return {
      focus: (Number(localStorage.getItem(LS.pomFocus)) || 25) * 60,
      short: (Number(localStorage.getItem(LS.pomShort)) || 5) * 60,
      long: (Number(localStorage.getItem(LS.pomLong)) || 15) * 60
    };
  }

  function updatePomDisplay() {
    const m = Math.floor(state.pom.seconds / 60);
    const s = state.pom.seconds % 60;
    $('#pomTime').textContent = `${pad(m)}:${pad(s)}`;
    // 圆环进度
    const total = state.pom.totalSeconds;
    const progress = 1 - (state.pom.seconds / total);
    const circumference = 2 * Math.PI * 118;
    const offset = circumference * (1 - progress);
    const progEl = $('#pomProgress');
    if (progEl) {
      progEl.style.strokeDasharray = circumference;
      progEl.style.strokeDashoffset = offset;
    }
    // 按钮
    $('#pomStart').innerHTML = state.pom.running ? icon('pause') : icon('play');
  }

  function setPomMode(mode) {
    state.pom.mode = mode;
    stopPomTimer();
    const durations = getPomDurations();
    state.pom.seconds = durations[mode];
    state.pom.totalSeconds = durations[mode];
    $$('.pom-mode').forEach(b => b.classList.toggle('active', b.dataset.pmode === mode));
    updatePomDisplay();
  }

  function startPomTimer() {
    if (state.pom.running) {
      stopPomTimer();
      return;
    }
    state.pom.running = true;
    state.pom.timer = setInterval(() => {
      state.pom.seconds--;
      if (state.pom.seconds <= 0) {
        stopPomTimer();
        if (state.pom.mode === 'focus') {
          state.pom.focusCount++;
          localStorage.setItem(LS.pomHistory, String(state.pom.focusCount));
          $('#pomTodayCount').textContent = state.pom.focusCount;
          $('#pomTotalCount').textContent = state.pom.focusCount;
          logPomodoro(Math.round(state.pom.totalSeconds / 60), 'focus');
          toast('专注完成！休息一下吧 ☕');
          setPomMode('short');
        } else {
          logPomodoro(Math.round(state.pom.totalSeconds / 60), state.pom.mode);
          toast('休息结束，继续加油！💪');
          setPomMode('focus');
        }
      }
      updatePomDisplay();
    }, 1000);
    updatePomDisplay();
  }

  function stopPomTimer() {
    state.pom.running = false;
    if (state.pom.timer) {
      clearInterval(state.pom.timer);
      state.pom.timer = null;
    }
    updatePomDisplay();
  }

  function resetPomTimer() {
    stopPomTimer();
    const durations = getPomDurations();
    state.pom.seconds = durations[state.pom.mode];
    state.pom.totalSeconds = durations[state.pom.mode];
    updatePomDisplay();
  }

  // ============================================================
  // AI 助手（后端代理，Key 不暴露在前端）
  // ============================================================
  async function updateAIStatus() {
    const el = $('#aiStatus');
    const backendEl = $('#aiBackendStatus');
    try {
      const res = await fetch('/api/ai/status');
      const data = await res.json();
      if (data.configured) {
        el.textContent = `已连接 · ${data.model}`;
        el.classList.add('connected');
        if (backendEl) backendEl.innerHTML = '<span style="color:var(--success)">✓ 已配置 AI 服务</span>';
      } else {
        el.textContent = '未配置';
        el.classList.remove('connected');
        if (backendEl) backendEl.innerHTML = '<span style="color:var(--warning)">⚠️ 未配置 AI_API_KEY，AI 助手暂不可用</span>';
      }
    } catch (_) {
      el.textContent = '状态未知';
      el.classList.remove('connected');
      if (backendEl) backendEl.textContent = '无法连接后端';
    }
  }

  function addAIMessage(text, isUser = false) {
    const wrap = $('#aiMessages');
    const el = document.createElement('div');
    el.className = `ai-message ${isUser ? 'user' : 'bot'}`;
    el.innerHTML = `
      <div class="ai-msg-avatar">${icon(isUser ? 'user' : 'brain')}</div>
      <div class="ai-msg-bubble"><p>${esc(text)}</p></div>`;
    wrap.appendChild(el);
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendAIMessage() {
    const input = $('#aiInput');
    const text = input.value.trim();
    if (!text) return;
    addAIMessage(text, true);
    input.value = '';

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      const reply = data.reply || data.message || '无法解析，请换个说法试试。';
      addAIMessage(reply);
    } catch (err) {
      addAIMessage('❌ 请求失败：' + err.message);
    }
  }

  // 番茄钟完成时记录到后端（可选，表不存在时静默失败）
  async function logPomodoro(durationMin, type, taskTitle) {
    try {
      await fetch('/api/pomodoro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: durationMin, type, task_title: taskTitle || null })
      });
    } catch (_) { /* 静默失败 */ }
  }

  // ============================================================
  // 数据分析
  // ============================================================
  function renderAnalytics() {
    // 每日完成情况（近30天）
    renderDailyChart();
    // 每周趋势
    renderWeeklyChart();
    // 分类统计
    renderCategoryStats();
    // 月度概览
    renderMonthlyStats();
  }

  function renderDailyChart() {
    const box = $('#dailyChartBox');
    if (!box) return;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayStr(d);
      const done = state.tasks.filter(t => t.completed && isoDay(t.completed_at || t.created_at) === key).length;
      days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, done });
    }
    const max = Math.max(...days.map(d => d.done), 1);
    box.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:100%">
      ${days.map(d => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="${d.label}: ${d.done}个">
        <div style="width:100%;background:var(--gradient);border-radius:2px 2px 0 0;height:${(d.done / max) * 100}%;min-height:${d.done > 0 ? 4 : 1}px"></div>
      </div>`).join('')}
    </div>`;
  }

  function renderWeeklyChart() {
    const box = $('#weeklyChartBox');
    if (!box) return;
    // 最近4周
    const weeks = [];
    for (let w = 3; w >= 0; w--) {
      const end = new Date();
      end.setDate(end.getDate() - w * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      const key = `${start.getMonth() + 1}/${start.getDate()}-${end.getMonth() + 1}/${end.getDate()}`;
      const done = state.tasks.filter(t => {
        if (!t.completed || !t.completed_at) return false;
        const d = new Date(t.completed_at);
        return d >= start && d <= end;
      }).length;
      weeks.push({ label: key, done });
    }
    const max = Math.max(...weeks.map(w => w.done), 1);
    box.innerHTML = `<div style="display:flex;align-items:flex-end;gap:16px;height:100%;padding:0 20px">
      ${weeks.map(w => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px">
        <div style="font-size:12px;font-weight:700">${w.done}</div>
        <div style="width:100%;max-width:40px;background:var(--primary);border-radius:6px 6px 0 0;height:${(w.done / max) * 100}%"></div>
        <div style="font-size:10px;color:var(--text-3)">${w.label}</div>
      </div>`).join('')}
    </div>`;
  }

  function renderCategoryStats() {
    const el = $('#categoryStats');
    if (!el) return;
    const rows = [...CATS, '未分类'].map(c => {
      const list = state.tasks.filter(t => c === '未分类' ? !t.category : t.category === c);
      const done = list.filter(t => t.completed).length;
      const rate = list.length ? Math.round((done / list.length) * 100) : 0;
      return { name: c, total: list.length, done, rate, color: CAT_COLOR[c] };
    }).filter(r => r.total > 0);

    el.innerHTML = rows.map(r => `
      <div class="cat-stat-row">
        <span class="cat-name">${r.name}</span>
        <div class="cat-stat-bar"><i style="width:${r.rate}%;background:${r.color}"></i></div>
        <span class="cat-pct">${r.done}/${r.total} (${r.rate}%)</span>
      </div>`).join('') || '<p style="color:var(--text-3);text-align:center">暂无数据</p>';
  }

  function renderMonthlyStats() {
    const el = $('#monthlyStats');
    if (!el) return;
    const now = new Date();
    const monthTasks = state.tasks.filter(t => {
      const d = new Date(t.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const monthDone = monthTasks.filter(t => t.completed).length;
    const rate = monthTasks.length ? Math.round((monthDone / monthTasks.length) * 100) : 0;
    el.innerHTML = `
      <div class="monthly-stat-item"><b>${monthTasks.length}</b><span>本月新增</span></div>
      <div class="monthly-stat-item"><b>${monthDone}</b><span>本月完成</span></div>
      <div class="monthly-stat-item"><b>${rate}%</b><span>本月完成率</span></div>
      <div class="monthly-stat-item"><b>${state.tasks.filter(isOverdue).length}</b><span>逾期任务</span></div>`;
  }

  // ============================================================
  // 设置
  // ============================================================
  function renderSettings() {
    const f = state.meta.features || {};
    $('#dbState').textContent = `已连接 Supabase · 截止日期 ${f.dueDate ? '✓' : '✕'} · 分类 ${f.category ? '✓' : '✕'} · 完成时间 ${f.completedAt ? '✓' : '✕'}`;
    // 番茄钟设置填充
    $('#pomFocusLen').value = localStorage.getItem(LS.pomFocus) || 25;
    $('#pomShortLen').value = localStorage.getItem(LS.pomShort) || 5;
    $('#pomLongLen').value = localStorage.getItem(LS.pomLong) || 15;
    $('#pageSizeSelect').value = String(state.pageSize);
    syncSwitches();
  }

  // ============================================================
  // 主题
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
    [$('#themeSwitch2')].forEach(el => {
      if (el) el.classList.toggle('on', dark);
    });
    const rs = $('#remindSwitch');
    if (rs) rs.classList.toggle('on', state.remind);
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    if (state.view === 'dashboard') renderLineChart();
  }

  // ============================================================
  // 侧边栏
  // ============================================================
  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#scrim').classList.add('show');
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#scrim').classList.remove('show');
  }

  // ============================================================
  // 弹窗
  // ============================================================
  function openTaskModal(task) {
    state.editingId = task ? task.id : null;
    $('#modalTitle').textContent = task ? '编辑任务' : '新建任务';
    $('#modalSave').textContent = task ? '保存修改' : '添加任务';
    $('#fTitle').value = task ? task.title : '';
    $('#fDue').value = task ? (task.due_date || '') : todayStr();
    const pri = task ? task.priority : '中';
    $$('#fPriority .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === pri));
    const cat = task ? task.category : '';
    $$('#fCategory .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === cat));
    const hasCat = !!(state.meta.features && state.meta.features.category);
    $('#fCategoryField').style.display = hasCat ? '' : 'none';
    $('#fHint').textContent = hasCat ? '' : '数据库未启用分类字段，本次只保存标题、优先级和截止日期。';
    $('#taskModal').hidden = false;
    setTimeout(() => $('#fTitle').focus(), 60);
  }

  function closeTaskModal() {
    $('#taskModal').hidden = true;
    state.editingId = null;
  }

  let confirmResolve = null;
  function openConfirm(name) {
    $('#confirmName').textContent = name;
    $('#confirmModal').hidden = false;
    return new Promise(resolve => { confirmResolve = resolve; });
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
    const priority = ($('#fPriority .seg-btn.active') || {}).dataset?.val || '中';
    const catBtn = $('#fCategory .seg-btn.active');
    const category = catBtn ? catBtn.dataset.val : null;
    const dueDate = $('#fDue').value || '';
    if (!title) { toast('请先填写任务标题', 'warn'); $('#fTitle').focus(); return; }
    const btn = $('#modalSave');
    const isEdit = !!state.editingId;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      if (isEdit) {
        await api(`${API}/${state.editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, priority, category, dueDate: dueDate || null })
        });
        toast('任务已更新');
      } else {
        await api(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, priority, category, dueDate: dueDate || null })
        });
        toast('任务已添加');
      }
      closeTaskModal();
      await loadTasks(true);
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? '保存修改' : '添加任务';
    }
  }

  async function toggleTask(task) {
    const next = !task.completed;
    task.completed = next;
    renderAll();
    try {
      await api(`${API}/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: next })
      });
      toast(next ? '任务已完成，干得漂亮！' : '已恢复为未完成');
      await loadTasks(true);
    } catch (err) {
      task.completed = !next;
      renderAll();
      toast('操作失败：' + err.message, 'err');
    }
  }

  async function removeTask(task) {
    const ok = await openConfirm(task.title);
    if (!ok) return;
    try {
      await api(`${API}/${task.id}`, { method: 'DELETE' });
      toast('任务已删除');
      await loadTasks(true);
    } catch (err) {
      toast('删除失败：' + err.message, 'err');
    }
  }

  // ============================================================
  // 提醒
  // ============================================================
  function checkReminder() {
    if (!state.remind) return;
    const today = todayStr();
    if (localStorage.getItem('tm_lastRemind') === today) return;
    const dueToday = state.tasks.filter(t => !t.completed && isToday(t)).length;
    const overdue = state.tasks.filter(isOverdue).length;
    if (!dueToday && !overdue) return;
    localStorage.setItem('tm_lastRemind', today);
    const msg = [];
    if (dueToday) msg.push(`${dueToday} 个任务今天到期`);
    if (overdue) msg.push(`${overdue} 个任务已逾期`);
    setTimeout(() => toast(`提醒：${msg.join('，')}`, 'warn'), 700);
  }

  // ============================================================
  // 总渲染
  // ============================================================
  function renderAll() {
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'tasks') renderTasksView();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'kanban') renderKanban();
    else if (state.view === 'analytics') renderAnalytics();
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bind() {
    // 导航
    $$('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => setView(btn.dataset.nav));
    });
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#sidebarClose')?.addEventListener('click', closeSidebar);

    // 主题
    $('#themeSwitch').addEventListener('click', toggleTheme);
    $('#themeSwitch2').addEventListener('click', toggleTheme);

    // 新建任务
    $('#btnAddTop').addEventListener('click', () => openTaskModal(null));

    // 标签页
    $('#tabs')?.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      state.tab = b.dataset.tab;
      state.page = 1;
      renderTasksView();
    });

    // 分类筛选
    $('#catChips')?.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      state.page = 1;
      renderTasksView();
    });

    // 搜索
    const searchInput = $('#searchInput');
    searchInput?.addEventListener('input', () => {
      state.search = searchInput.value;
      state.page = 1;
      renderTasksView();
    });
    $('#searchClear')?.addEventListener('click', () => {
      searchInput.value = '';
      state.search = '';
      renderTasksView();
    });

    // 排序
    $('#sortSelect')?.addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.page = 1;
      renderTasksView();
    });

    // 列表事件委托
    $('#taskList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const li = btn.closest('.task');
      const task = state.tasks.find(t => t.id === Number(li.dataset.id));
      if (!task) return;
      const act = btn.dataset.act;
      if (act === 'toggle') toggleTask(task);
      if (act === 'edit') openTaskModal(task);
      if (act === 'del') removeTask(task);
    });

    // 分页
    $('#pager')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.page = Number(b.dataset.page);
      renderTasksView();
    });

    // 弹窗
    $('#modalClose')?.addEventListener('click', closeTaskModal);
    $('#modalCancel')?.addEventListener('click', closeTaskModal);
    $('#modalSave')?.addEventListener('click', saveTask);
    $('#taskModal')?.addEventListener('click', (e) => { if (e.target === $('#taskModal')) closeTaskModal(); });
    $('#confirmOk')?.addEventListener('click', () => closeConfirm(true));
    $('#confirmCancel')?.addEventListener('click', () => closeConfirm(false));
    $('#confirmClose')?.addEventListener('click', () => closeConfirm(false));
    $('#confirmModal')?.addEventListener('click', (e) => { if (e.target === $('#confirmModal')) closeConfirm(false); });
    $('#detailClose')?.addEventListener('click', () => { $('#detailModal').hidden = true; });
    $('#detailModal')?.addEventListener('click', (e) => { if (e.target === $('#detailModal')) $('#detailModal').hidden = true; });

    // 优先级/分类选择
    $('#fPriority')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#fPriority .seg-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    $('#fCategory')?.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const was = b.classList.contains('active');
      $$('#fCategory .seg-btn').forEach(x => x.classList.remove('active'));
      if (!was) b.classList.add('active');
    });
    $('#fTitle')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
    });

    // ESC 关闭弹窗
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#taskModal').hidden) closeTaskModal();
        if (!$('#confirmModal').hidden) closeConfirm(false);
        if (!$('#detailModal').hidden) $('#detailModal').hidden = true;
        closeSidebar();
      }
    });

    // 日历导航
    $('#calPrev')?.addEventListener('click', () => {
      state.calDate.setMonth(state.calDate.getMonth() - 1);
      renderCalendar();
    });
    $('#calNext')?.addEventListener('click', () => {
      state.calDate.setMonth(state.calDate.getMonth() + 1);
      renderCalendar();
    });
    $('#calToday')?.addEventListener('click', () => {
      state.calDate = new Date();
      renderCalendar();
    });
    $$('.cal-views .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.cal-views .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.calView = b.dataset.calView;
        renderCalendar();
      });
    });

    // 番茄钟
    $$('.pom-mode').forEach(b => {
      b.addEventListener('click', () => setPomMode(b.dataset.pmode));
    });
    $('#pomStart')?.addEventListener('click', startPomTimer);
    $('#pomReset')?.addEventListener('click', resetPomTimer);
    $('#pomSettings')?.addEventListener('click', () => setView('settings'));

    // AI 助手
    $('#aiSend')?.addEventListener('click', sendAIMessage);
    $('#aiInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAIMessage();
    });

    // 设置
    $('#remindSwitch')?.addEventListener('click', () => {
      state.remind = !state.remind;
      localStorage.setItem(LS.remind, state.remind ? '1' : '0');
      syncSwitches();
      toast(state.remind ? '已开启每日任务提醒' : '已关闭每日任务提醒');
    });
    $('#pageSizeSelect')?.addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value);
      localStorage.setItem(LS.pageSize, String(state.pageSize));
      state.page = 1;
      toast(`每页显示 ${state.pageSize} 条`);
    });
    $('#dbCheckBtn')?.addEventListener('click', async () => {
      toast('正在重新检测数据库…');
      await loadMeta();
      await loadTasks(true);
      renderSettings();
      toast('检测完成');
    });
    $('#pomSaveSettings')?.addEventListener('click', () => {
      localStorage.setItem(LS.pomFocus, $('#pomFocusLen').value);
      localStorage.setItem(LS.pomShort, $('#pomShortLen').value);
      localStorage.setItem(LS.pomLong, $('#pomLongLen').value);
      resetPomTimer();
      toast('番茄钟设置已保存');
    });

    // 回到页面时刷新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadTasks(true);
    });

    // 定时同步
    setInterval(() => {
      if (document.hidden) return;
      loadTasks(true);
    }, 60000);
  }

  // ============================================================
  // 启动
  // ============================================================
  function renderToday() {
    const d = new Date();
    $('#todayText').textContent =
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  }

  async function init() {
    applyTheme(state.theme);
    renderToday();
    // 初始化番茄钟
    const durations = getPomDurations();
    state.pom.seconds = durations.focus;
    state.pom.totalSeconds = durations.focus;
    $('#pomTodayCount').textContent = state.pom.focusCount;
    $('#pomTotalCount').textContent = state.pom.focusCount;
    updatePomDisplay();
    // AI状态
    updateAIStatus();
    // 绑定事件
    bind();
    // 加载数据
    await loadMeta();
    await loadTasks();
  }

  init();
})();
