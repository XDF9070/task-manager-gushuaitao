/* ============================================================
   智能任务管理系统 v2 · 前端逻辑
   数据全部来自 /api/tasks（Supabase），没有任何演示数字
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
    lastRemind: 'tm_lastRemind'
  };
  const CATS = ['学习', '工作', '健身', '生活'];
  const CAT_COLOR = {
    '学习': '#4a86ff',
    '工作': '#a78bfa',
    '健身': '#34d399',
    '生活': '#fbbf24',
    '未分类': '#c4cfdf'
  };
  const PRI_RANK = { '高': 0, '中': 1, '低': 2 };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const MIGRATION_SQL = `-- 智能任务管理系统 v2 · 安全增量迁移（不清空任何数据）
alter table public.tasks add column if not exists category text;
alter table public.tasks add column if not exists completed_at timestamptz;
update public.tasks set completed_at = created_at
 where completed_at is null and completed is true;
create index if not exists tasks_category_idx on public.tasks (category);`;

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
    pageSize: Number(localStorage.getItem(LS.pageSize)) || 6,
    theme: localStorage.getItem(LS.theme) || 'light',
    remind: localStorage.getItem(LS.remind) !== '0',
    editingId: null,
    loading: true,
    offline: false
  };

  // ============================================================
  // 小工具
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

  // ISO 时间 → 本地 YYYY-MM-DD
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
  // 提示条
  // ============================================================
  const toastWrap = $('#toastWrap');
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const iconName = type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'check';
    el.innerHTML = `${icon(iconName)}<span>${esc(msg)}</span>`;
    toastWrap.appendChild(el);
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
    try { json = await res.json(); } catch (_) { /* 非 JSON */ }
    if (!res.ok || !json || json.success === false) {
      throw new Error((json && json.message) || `请求失败（HTTP ${res.status}）`);
    }
    return json;
  }

  async function loadMeta() {
    try {
      const json = await api(API_META);
      state.meta = json;
      renderBanner();
      renderDbState();
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
      render();
      if (!silent) checkReminder();
    } catch (err) {
      state.loading = false;
      // 断网兜底：用上次缓存，至少页面不空
      const cache = localStorage.getItem(LS.cache);
      if (cache) {
        try {
          state.tasks = JSON.parse(cache).map(normalize);
          state.offline = true;
          render();
          toast('网络异常，当前显示的是本地缓存数据', 'warn');
          return;
        } catch (_) { /* ignore */ }
      }
      render();
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
  // 筛选 / 排序 / 分页
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

    // 昨日完成率（用于完成率环比）
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yd = dayStr(y);
    const totalBefore = all.filter((t) => isoDay(t.created_at) <= yd).length;
    const doneBefore = all.filter((t) => {
      const c = isoDay(t.created_at);
      if (c > yd) return false;
      if (!t.completed) return false;
      return t.completed_at ? isoDay(t.completed_at) <= yd : true;
    }).length;
    const rateBefore = totalBefore ? Math.round((doneBefore / totalBefore) * 100) : 0;

    return { total, done, pending, rate, createdToday, doneToday, overdue, rateDiff: rate - rateBefore };
  }

function renderStats() {
    const s = stats();
    $('#statTotal').textContent = s.total;
    $('#statDone').textContent = s.done;
    $('#statPending').textContent = s.pending;
    $('#statRate').textContent = s.rate + '%';

    // 总任务数：今日新增
    const dTotal = $('#deltaTotal');
    dTotal.className = 'delta ' + (s.createdToday > 0 ? 'up' : 'flat');
    dTotal.textContent = s.createdToday > 0 ? `+${s.createdToday}` : '持平';

    // 已完成：今日完成
    const dDone = $('#deltaDone');
    dDone.className = 'delta ' + (s.doneToday > 0 ? 'up' : 'flat');
    dDone.textContent = s.doneToday > 0 ? `+${s.doneToday}` : '持平';

    // 未完成：逾期数量
    const dPending = $('#deltaPending');
    if (s.overdue > 0) {
      dPending.className = 'delta down';
      dPending.textContent = `逾期 ${s.overdue}`;
    } else {
      dPending.className = 'delta flat';
      dPending.textContent = '无逾期';
    }

    // 完成率：与昨日环比
    const dRate = $('#deltaRate');
    if (s.rateDiff > 0) {
      dRate.className = 'delta up';
      dRate.textContent = `+${s.rateDiff}%`;
    } else if (s.rateDiff < 0) {
      dRate.className = 'delta down';
      dRate.textContent = `${s.rateDiff}%`;
    } else {
      dRate.className = 'delta flat';
      dRate.textContent = '持平';
    }

    // 完成率圆环
    const r = 22, c = 2 * Math.PI * r;
    const off = c - (c * s.rate) / 100;
    $('#rateRing').innerHTML = `
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="5"/>
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="5"
                stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
                style="transition:stroke-dashoffset .5s ease"/>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#5b92ff"/><stop offset="100%" stop-color="#22c58b"/>
          </linearGradient>
        </defs>
      </svg>
      <span class="ring-text">${s.rate}%</span>`;
  }

  // ============================================================
  // 折线图：最近 7 天累计完成率
  // ============================================================
  function last7() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ key: dayStr(d), date: d, label: WEEK[d.getDay()] });
    }
    return out;
  }

  function lineSeries() {
    const days = last7();
    const all = state.tasks;
    return days.map((d) => {
      const totalBefore = all.filter((t) => isoDay(t.created_at) <= d.key).length;
      const doneBefore = all.filter((t) => {
        if (!t.completed) return false;
        if (isoDay(t.created_at) > d.key) return false;
        if (t.completed_at) return isoDay(t.completed_at) <= d.key;
        return true; // 没有完成时间的老任务：按已完成计入
      }).length;
      return {
        label: d.label,
        full: d.label,
        key: d.key,
        value: totalBefore ? Math.round((doneBefore / totalBefore) * 100) : 0,
        hasData: totalBefore > 0
      };
    });
  }

  function renderLineChart() {
    const box = $('#lineChartBox');
    const tip = $('#lineTip');
    const w = box.clientWidth - 14;
    const h = 178;
    if (w < 60) return;

    const padL = 34, padR = 16, padT = 16, padB = 26;
    const iw = w - padL - padR;
    const ih = h - padT - padB;

    const data = lineSeries();
    const hasAny = data.some((d) => d.hasData);
    const x = (i) => padL + (iw / (data.length - 1)) * i;
    const y = (v) => padT + ih - (ih * v) / 100;

    const pts = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.value) }));

    // 平滑曲线（Catmull-Rom → 三次贝塞尔）
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

    const gridLines = [0, 25, 50, 75, 100].map((v) => `
      <line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}"
            stroke="var(--border)" stroke-width="1" stroke-dasharray="${v === 0 ? '0' : '3 4'}"/>
      <text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end"
            font-size="9.5" fill="var(--text-3)">${v}%</text>`).join('');

    const xLabels = pts.map((p) => `
      <text x="${p.cx}" y="${h - 8}" text-anchor="middle"
            font-size="10" fill="var(--text-3)">${p.label}</text>`).join('');

    const dots = pts.filter((p) => p.hasData).map((p) => `
      <circle cx="${p.cx}" cy="${p.cy}" r="3.4" fill="#fff" stroke="#2f6df6" stroke-width="2"/>`).join('');

    const last = pts[pts.length - 1];
    const bubbleW = 44;
    const bx = Math.min(Math.max(last.cx - bubbleW / 2, padL - 6), w - padR - bubbleW + 6);
    const bubble = hasAny ? `
      <rect x="${bx}" y="${last.cy - 26}" width="${bubbleW}" height="19" rx="6" fill="#2f6df6"/>
      <text x="${bx + bubbleW / 2}" y="${last.cy - 12.5}" text-anchor="middle"
            font-size="10.5" font-weight="700" fill="#fff">${last.value}%</text>` : '';

    const hotspots = pts.map((p, i) => `
      <rect class="hs" data-i="${i}" x="${p.cx - iw / (data.length - 1) / 2}" y="${padT}"
            width="${iw / (data.length - 1)}" height="${ih}" fill="transparent" style="cursor:pointer"/>`).join('');

    box.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="最近 7 天任务完成率">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2f6df6" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#2f6df6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${gridLines}
        ${xLabels}
        ${hasAny ? `<path d="${area}" fill="url(#areaGrad)"/>
        <path d="${path}" fill="none" stroke="#2f6df6" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${dots}
        ${bubble}
        ${hotspots}
      </svg>
      ${hasAny ? '' : '<div class="chart-empty">还没有任务数据，添加任务后这里会自动变化</div>'}
      <div class="chart-tip" id="lineTip" hidden></div>`;

    // hover 提示
    $$('.hs', box).forEach((r) => {
      r.addEventListener('mouseenter', () => {
        const d = pts[Number(r.dataset.i)];
        if (!d.hasData) return;
        const t = $('#lineTip', box);
        t.hidden = false;
        t.textContent = `${d.full} · ${d.value}%`;
        t.style.left = d.cx + 'px';
        t.style.top = d.cy + 'px';
      });
      r.addEventListener('mouseleave', () => {
        const t = $('#lineTip', box);
        if (t) t.hidden = true;
      });
    });
    if (tip) tip.hidden = true;
    $('#lineSub').textContent = '最近 7 天 · 累计完成率';
  }

  // ============================================================
  // 饼图：任务分类占比
  // ============================================================
  function catStats() {
    const map = new Map();
    state.tasks.forEach((t) => {
      const k = t.category && CATS.includes(t.category) ? t.category : '未分类';
      map.set(k, (map.get(k) || 0) + 1);
    });
    const order = [...CATS, '未分类'];
    return order
      .filter((k) => map.get(k))
      .map((k) => ({ name: k, count: map.get(k), color: CAT_COLOR[k] }));
  }

  function renderDonut() {
    const box = $('#donutBox');
    const legend = $('#donutLegend');
    const segs = catStats();
    const total = state.tasks.length;

    if (!segs.length) {
      box.innerHTML = `<div class="chart-empty" style="position:static">暂无数据</div>`;
      legend.innerHTML = '';
      return;
    }

    const r = 40, C = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segs.map((s) => {
      const frac = s.count / total;
      const len = C * frac;
      const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}"
        stroke-width="15" stroke-dasharray="${Math.max(len - 1.5, 0.6)} ${C - Math.max(len - 1.5, 0.6)}"
        stroke-dashoffset="${-offset}" stroke-linecap="butt"/>`;
      offset += len;
      return el;
    }).join('');

    box.innerHTML = `
      <svg viewBox="0 0 120 120" role="img" aria-label="任务分类占比">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="15"/>
        <g transform="rotate(-90 60 60)">${arcs}</g>
      </svg>
      <div class="donut-center"><b>${total}</b><span>总任务</span></div>`;

    legend.innerHTML = segs.map((s) => {
      const pct = Math.round((s.count / total) * 100);
      return `<li>
        <i class="dot" style="background:${s.color}"></i>
        <span class="lg-name">${s.name}</span>
        <span class="lg-val">${s.count} (${pct}%)</span>
      </li>`;
    }).join('');
  }

  // ============================================================
  // 任务列表
  // ============================================================
  function renderTabs() {
    const base = catFiltered();
    $('#cAll').textContent = base.length;
    $('#cToday').textContent = base.filter(isToday).length;
    $('#cPending').textContent = base.filter((t) => !t.completed).length;
    $('#cDone').textContent = base.filter((t) => t.completed).length;
    $('#cOverdue').textContent = base.filter(isOverdue).length;
    $('#listCount').textContent = state.tasks.length;

    $$('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    $$('#catChips .chip').forEach((b) => b.classList.toggle('active', b.dataset.cat === state.cat));
  }

  function taskRow(t) {
    const catCls = t.category ? `cat-${t.category}` : 'cat-未分类';
    const catName = t.category || '未分类';
    const overdue = isOverdue(t);
    return `
      <li class="task ${t.completed ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
        <button class="task-check" data-act="toggle" aria-label="${t.completed ? '标记未完成' : '标记完成'}" aria-pressed="${t.completed}">
          ${icon('check')}
        </button>
        <span class="pri ${esc(t.priority)}">${esc(t.priority)}优先级</span>
        <span class="task-title" title="${esc(t.title)}">${esc(t.title)}</span>
        <span class="cat-pill ${catCls}">${catName}</span>
        <span class="due ${isToday(t) ? 'today' : ''}">${icon('calendar')}${dueLabel(t)}</span>
        ${t.completed ? '<span class="done-tag">已完成</span>' : ''}
        <span class="task-acts">
          <button class="icon-btn" data-act="edit" aria-label="编辑任务">${icon('edit')}</button>
          <button class="icon-btn danger" data-act="del" aria-label="删除任务">${icon('trash')}</button>
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
      const kw = state.search.trim();
      if (kw) {
        $('#emptyTitle').textContent = '没有找到匹配的任务';
        $('#emptyText').textContent = `没有包含「${kw}」的任务，换个关键词试试。`;
      } else if (state.tab === 'overdue') {
        $('#emptyTitle').textContent = '没有逾期任务';
        $('#emptyText').textContent = '节奏很好，继续保持。';
      } else if (state.tab === 'today') {
        $('#emptyTitle').textContent = '今天没有到期任务';
        $('#emptyText').textContent = '可以添加一条，或者提前处理后面的任务。';
      } else if (state.tab === 'done') {
        $('#emptyTitle').textContent = '还没有完成的任务';
        $('#emptyText').textContent = '完成第一条任务后，这里会记录下来。';
      } else if (state.cat !== '全部') {
        $('#emptyTitle').textContent = `「${state.cat}」下没有任务`;
        $('#emptyText').textContent = '新建任务时选择这个分类即可。';
      } else {
        $('#emptyTitle').textContent = '还没有任务';
        $('#emptyText').textContent = '点「新建任务」添加第一条，开始规划今天。';
      }
    } else {
      empty.hidden = true;
      ul.innerHTML = pageItems.map(taskRow).join('');
    }

    // 底部信息 + 分页
    $('#footInfo').textContent = total
      ? `共 ${total} 个任务 · 当前第 ${start + 1}-${Math.min(start + state.pageSize, total)} 条${state.offline ? ' · 离线缓存' : ''}`
      : '共 0 个任务';

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
        <button class="page-btn" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="上一页">${icon('left')}</button>
        ${nums.map((p) => p === '…'
          ? '<span class="page-btn" style="border:0;background:transparent;cursor:default">…</span>'
          : `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('')}
        <button class="page-btn" data-page="${state.page + 1}" ${state.page === maxPage ? 'disabled' : ''} aria-label="下一页">${icon('right')}</button>`;
    }
  }

  // ============================================================
  // 分类管理视图
  // ============================================================
  function renderCatCards() {
    const grid = $('#catGrid');
    if (!grid) return;
    const total = state.tasks.length || 1;
    const rows = [...CATS, '未分类']
      .filter((c) => c !== '未分类' || state.tasks.some((t) => !t.category))
      .map((c) => {
        const list = c === '未分类' ? state.tasks.filter((t) => !t.category)
          : state.tasks.filter((t) => t.category === c);
        const done = list.filter((t) => t.completed).length;
        const rate = list.length ? Math.round((done / list.length) * 100) : 0;
        return { name: c, total: list.length, done, rate, pct: Math.round((list.length / total) * 100) };
      });

    grid.innerHTML = rows.map((r) => `
      <div class="cat-card">
        <div class="cat-card-head">
          <i class="cat-dot" style="background:${CAT_COLOR[r.name]}"></i>
          <b>${r.name}</b>
          <span class="cat-total">占 ${r.pct}%</span>
        </div>
        <div class="cat-bar"><i style="width:${r.rate}%;background:${CAT_COLOR[r.name]}"></i></div>
        <div class="cat-meta">
          <span>${r.total} 个任务 · 完成 ${r.done}（${r.rate}%）</span>
          <button data-cat-jump="${r.name}">查看任务 →</button>
        </div>
      </div>`).join('');

    // 批量归类：仅在数据库支持分类、且存在未分类任务时出现
    const uncat = state.tasks.filter((t) => !t.category).length;
    const canCat = !!(state.meta.features && state.meta.features.category);
    const bar = $('#bulkBar');
    if (bar) {
      bar.hidden = !(canCat && uncat > 0);
      $('#bulkCount').textContent = uncat;
    }
  }

  async function bulkCategorize() {
    const cat = $('#bulkCat').value;
    const targets = state.tasks.filter((t) => !t.category);
    if (!targets.length) return;
    const btn = $('#bulkApply');
    btn.disabled = true;
    btn.textContent = '归类中…';
    let ok = 0, fail = 0;
    for (const t of targets) {
      try {
        await api(`${API}/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: cat })
        });
        ok++;
      } catch (_) { fail++; }
    }
    btn.disabled = false;
    btn.textContent = '一键归类';
    await loadTasks(true);
    if (fail) toast(`已归类 ${ok} 个，${fail} 个失败`, 'warn');
    else toast(`已把 ${ok} 个任务归入「${cat}」`);
  }

  // ============================================================
  // 设置视图
  // ============================================================
  function renderDbState() {
    const el = $('#dbState');
    if (!el) return;
    const f = state.meta.features || {};
    const parts = [
      `截止日期 ${f.dueDate ? '✓' : '✕'}`,
      `分类 ${f.category ? '✓' : '✕'}`,
      `完成时间 ${f.completedAt ? '✓' : '✕'}`
    ];
    el.textContent = `已连接 Supabase · ${parts.join(' · ')}`;
  }

  function renderBanner() {
    const need = state.meta.features && !state.meta.features.category;
    $('#dbBanner').hidden = !need;
  }

  // ============================================================
  // 总渲染
  // ============================================================
  function render() {
    renderStats();
    renderTabs();
    renderList();
    renderLineChart();
    renderDonut();
    renderCatCards();
  }

  // ============================================================
  // 视图切换
  // ============================================================
  const NAV_MAP = {
    overview: { view: 'dashboard', tab: 'all' },
    all: { view: 'dashboard', tab: 'all' },
    today: { view: 'dashboard', tab: 'today' },
    pending: { view: 'dashboard', tab: 'pending' },
    done: { view: 'dashboard', tab: 'done' },
    overdue: { view: 'dashboard', tab: 'overdue' },
    categories: { view: 'categories' },
    settings: { view: 'settings' }
  };

  function setView(navKey) {
    const cfg = NAV_MAP[navKey] || NAV_MAP.overview;
    state.view = cfg.view;
    if (cfg.tab) { state.tab = cfg.tab; state.page = 1; }

    $('#viewDashboard').hidden = cfg.view !== 'dashboard';
    $('#viewCategories').hidden = cfg.view !== 'categories';
    $('#viewSettings').hidden = cfg.view !== 'settings';

    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === navKey));
    closeSidebar();

    if (cfg.view === 'dashboard') {
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (cfg.view === 'categories') {
      renderCatCards();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      renderDbState();
      syncSwitches();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // ============================================================
  // 弹窗
  // ============================================================
  const taskModal = $('#taskModal');
  const confirmModal = $('#confirmModal');
  let confirmResolve = null;

  function openTaskModal(task) {
    state.editingId = task ? task.id : null;
    $('#modalTitle').textContent = task ? '编辑任务' : '新建任务';
    $('#modalSave').textContent = task ? '保存修改' : '添加任务';
    $('#fTitle').value = task ? task.title : '';
    $('#fDue').value = task ? (task.due_date || '') : todayStr();

    const pri = task ? task.priority : '中';
    $$('#fPriority .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === pri));

    const cat = task ? task.category : '';
    $$('#fCategory .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === cat));

    const hasCat = !!(state.meta.features && state.meta.features.category);
    $('#fCategory').closest('.field').style.display = hasCat ? '' : 'none';
    $('#fHint').textContent = hasCat
      ? ''
      : '数据库还没有启用分类字段：本次保存只记录标题、优先级和截止日期，执行迁移后可保存分类。';

    taskModal.hidden = false;
    setTimeout(() => $('#fTitle').focus(), 60);
  }

  function closeTaskModal() {
    taskModal.hidden = true;
    state.editingId = null;
  }

  function openConfirm(name) {
    $('#confirmName').textContent = name;
    confirmModal.hidden = false;
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(val) {
    confirmModal.hidden = true;
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

    if (!title) {
      toast('请先填写任务标题', 'warn');
      $('#fTitle').focus();
      return;
    }

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
      state.page = 1;
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
    task.completed = next; // 乐观更新
    render();
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
      render();
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
    if (localStorage.getItem(LS.lastRemind) === today) return;

    const dueToday = state.tasks.filter((t) => !t.completed && isToday(t)).length;
    const overdue = state.tasks.filter(isOverdue).length;
    if (!dueToday && !overdue) return;

    localStorage.setItem(LS.lastRemind, today);

    const msg = [];
    if (dueToday) msg.push(`${dueToday} 个任务今天到期`);
    if (overdue) msg.push(`${overdue} 个任务已逾期`);
    const text = msg.join('，');

    setTimeout(() => toast(`提醒：${text}`, 'warn'), 700);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('今日任务提醒', {
          body: `${text}。打开系统看看吧！`,
          icon: '/favicon.ico',
          tag: 'tm-daily'
        });
      } catch (_) { /* Safari 旧版用不了构造函数 */ }
    }
  }

  function syncNotifyState() {
    const el = $('#notifyState');
    if (!el) return;
    if (!('Notification' in window)) {
      el.textContent = '当前浏览器不支持系统通知';
      $('#notifyBtn').disabled = true;
      return;
    }
    const p = Notification.permission;
    el.textContent = p === 'granted' ? '已开启浏览器通知'
      : p === 'denied' ? '已被浏览器拒绝，需在地址栏左侧重新允许'
        : '未开启浏览器通知';
    $('#notifyBtn').textContent = p === 'granted' ? '已开启' : '开启通知';
    $('#notifyBtn').disabled = p === 'granted';
  }

  // ============================================================
  // 主题
  // ============================================================
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(LS.theme, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c1322' : '#f4f8ff');
    const tIcon = $('#themeIcon use');
    if (tIcon) tIcon.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    syncSwitches();
  }

  function syncSwitches() {
    const dark = state.theme === 'dark';
    [$('#themeSwitch'), $('#themeSwitch2')].forEach((el) => {
      if (!el) return;
      el.classList.toggle('on', dark);
      el.setAttribute('aria-checked', String(dark));
    });
    const rs = $('#remindSwitch');
    if (rs) {
      rs.classList.toggle('on', state.remind);
      rs.setAttribute('aria-checked', String(state.remind));
    }
    syncNotifyState();
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    renderLineChart();
  }

  // ============================================================
  // 侧边栏（移动端）
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
  // 事件绑定
  // ============================================================
  function bind() {
    // 导航
    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.nav));
    });
    $('#menuBtn').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);

    // 主题
    $('#themeSwitch').addEventListener('click', toggleTheme);
    $('#themeSwitch2').addEventListener('click', toggleTheme);

    // 新建任务
    $('#btnAdd').addEventListener('click', () => openTaskModal(null));

    // 快捷入口
    $$('.quick-tile').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.quick;
        if (k === 'add') openTaskModal(null);
        if (k === 'today') setView('today');
        if (k === 'stats') {
          setView('dashboard');
          setTimeout(() => $('#lineChartBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        }
        if (k === 'settings') setView('settings');
      });
    });

    // 标签页
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      state.tab = b.dataset.tab;
      state.page = 1;
      render();
    });

    // 分类筛选
    $('#catChips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      state.page = 1;
      render();
    });

    // 搜索
    const searchInput = $('#searchInput');
    const searchClear = $('#searchClear');
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value;
      state.page = 1;
      searchClear.hidden = !state.search;
      render();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.search = '';
      searchClear.hidden = true;
      state.page = 1;
      render();
      searchInput.focus();
    });

    // 排序
    $('#sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.page = 1;
      render();
    });

    // 列表事件委托
    $('#taskList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const li = btn.closest('.task');
      const id = Number(li.dataset.id);
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return;
      const act = btn.dataset.act;
      if (act === 'toggle') toggleTask(task);
      if (act === 'edit') openTaskModal(task);
      if (act === 'del') removeTask(task);
    });

    // 分页
    $('#pager').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      const p = Number(b.dataset.page);
      const max = Math.max(1, Math.ceil(visibleTasks().length / state.pageSize));
      if (p < 1 || p > max) return;
      state.page = p;
      render();
      $('#taskList').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // 分类卡片跳转
    $('#catGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat-jump]');
      if (!b) return;
      state.cat = b.dataset.catJump;
      state.tab = 'all';
      state.page = 1;
      setView('overview');
    });

    // 批量归类
    $('#bulkApply').addEventListener('click', bulkCategorize);

    // 弹窗
    $('#modalClose').addEventListener('click', closeTaskModal);
    $('#modalCancel').addEventListener('click', closeTaskModal);
    $('#modalSave').addEventListener('click', saveTask);
    taskModal.addEventListener('click', (e) => { if (e.target === taskModal) closeTaskModal(); });

    $('#fPriority').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#fPriority .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    $('#fCategory').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const was = b.classList.contains('active');
      $$('#fCategory .seg-btn').forEach((x) => x.classList.remove('active'));
      if (!was) b.classList.add('active');
    });
    $('#fTitle').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
    });

    $('#confirmOk').addEventListener('click', () => closeConfirm(true));
    $('#confirmCancel').addEventListener('click', () => closeConfirm(false));
    $('#confirmClose').addEventListener('click', () => closeConfirm(false));
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirm(false); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!taskModal.hidden) closeTaskModal();
        if (!confirmModal.hidden) closeConfirm(false);
        closeSidebar();
      }
    });

    // 设置项
    $('#remindSwitch').addEventListener('click', () => {
      state.remind = !state.remind;
      localStorage.setItem(LS.remind, state.remind ? '1' : '0');
      syncSwitches();
      toast(state.remind ? '已开启每日任务提醒' : '已关闭每日任务提醒');
    });
    $('#notifyBtn').addEventListener('click', async () => {
      if (!('Notification' in window)) return;
      const p = await Notification.requestPermission();
      syncNotifyState();
      if (p === 'granted') toast('系统通知已开启，到期任务会提醒你');
      else toast('没有获得通知权限，仅显示页面内提醒', 'warn');
    });
    $('#pageSizeSelect').addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value);
      localStorage.setItem(LS.pageSize, String(state.pageSize));
      state.page = 1;
      render();
      toast(`每页显示 ${state.pageSize} 条`);
    });
    $('#dbCheckBtn').addEventListener('click', async () => {
      toast('正在重新检测数据库…');
      await loadMeta();
      await loadTasks(true);
      toast('检测完成');
    });

    // 复制迁移 SQL
    const copySql = async () => {
      try {
        await navigator.clipboard.writeText(MIGRATION_SQL);
        toast('迁移 SQL 已复制，去 Supabase → SQL Editor 粘贴执行');
      } catch (_) {
        window.prompt('复制下面的 SQL 到 Supabase SQL Editor 执行：', MIGRATION_SQL);
      }
    };
    $('#copySqlBtn').addEventListener('click', copySql);
    $('#copySqlBtn2').addEventListener('click', copySql);

    // 窗口尺寸变化：重画图表
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (state.view === 'dashboard') { renderLineChart(); }
      }, 160);
    });

    // 定时同步（只在页面可见、没开弹窗时）
    setInterval(() => {
      if (document.hidden || !taskModal.hidden || !confirmModal.hidden) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
      loadTasks(true);
    }, 60000);

    // 回到页面时刷新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadTasks(true);
    });
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
    $('#pageSizeSelect').value = String(state.pageSize);
    syncSwitches();
    bind();

    await loadMeta();
    await loadTasks();
  }

  init();
})();
