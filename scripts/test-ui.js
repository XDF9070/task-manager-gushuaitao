/* ============================================================
   V3.0 UI 冒烟测试（未迁移 / 已迁移都能跑）
   用法：node scripts/test-ui.js [baseUrl]
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/13525/WorkBuddy/2026-10-08-17-18-48/repair-assistant/node_modules/playwright-core');

const BASE = process.argv[2] || 'http://localhost:3100';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOT, { recursive: true });

let pass = 0, fail = 0;
const errors = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); errors.push(name); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log('\n=== 1. 页面加载 ===');
  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  check('首页返回 200', resp.status() === 200, `HTTP ${resp.status()}`);

  await page.waitForTimeout(1200);
  const bodyText = await page.locator('body').innerText();
  check('页面不是白屏', bodyText.length > 120, `${bodyText.length} 字符`);

  const title = await page.title();
  check('标题为智能任务管理系统 V3.0', title.includes('V3.0'), title);

  console.log('\n=== 2. 首页数据 ===');
  const apiData = await (await fetch(`${BASE}/api/tasks`)).json();

  const todayTotal = await page.locator('#statTodayTotal').innerText();
  check('今日任务指标已渲染', /^\d+$/.test(todayTotal), `今日任务 ${todayTotal} 项`);

  const weekDone = await page.locator('#statWeekDone').innerText();
  check('本周完成指标已渲染', /^\d+$/.test(weekDone), `本周完成 ${weekDone} 项`);

  const streak = await page.locator('#statStreak').innerText();
  check('连续打卡指标已渲染', /^\d+$/.test(streak), `连续打卡 ${streak} 天`);

  const focusHours = await page.locator('#statFocusHours').innerText();
  check('专注时长指标已渲染', /^\d+(\.\d+)?$/.test(focusHours), `专注 ${focusHours} h`);

  const dashRows = await page.locator('#dashTaskList .dash-task-item').count();
  check('我的任务列表已渲染', dashRows > 0, `${dashRows} 条（接口共 ${apiData.data.length} 条）`);

  const miniCalCells = await page.locator('#miniCal .mini-cal-day').count();
  check('迷你日历渲染 6 周', miniCalCells === 42, `${miniCalCells} 格`);

  const calHeads = await page.locator('#miniCal .mini-cal-week span').allInnerTexts();
  check('迷你日历以周一开头', calHeads[0] === '一' && calHeads[6] === '日', calHeads.join(' '));

  const miniPomTime = await page.locator('#miniPomTime').innerText();
  check('迷你番茄钟显示时间', /^\d{2}:\d{2}$/.test(miniPomTime), miniPomTime);

  const dashLineSvg = await page.locator('#lineChartBox svg').count();
  check('完成趋势图已渲染', dashLineSvg === 1);

  const syncText = await page.locator('#dashSyncState').innerText();
  check('数据同步状态已显示', syncText.includes('Supabase'), syncText);

  await page.screenshot({ path: path.join(SHOT, 'v3-01-dashboard.png'), fullPage: true });

  console.log('\n=== 3. 九个视图切换 ===');
  const views = ['today', 'calendar', 'tasks', 'kanban', 'plan', 'pomodoro', 'analytics', 'categories', 'settings', 'ai', 'dashboard'];
  for (const v of views) {
    await page.locator(`.nav-item[data-nav="${v}"]`).click();
    await page.waitForTimeout(260);
    const visible = await page.locator('section.view:not([hidden])').count();
    check(`切换到「${v}」正常`, visible === 1, `可见视图 ${visible} 个`);
  }

  console.log('\n=== 4. 新建任务 ===');
  await page.locator('.nav-item[data-nav="tasks"]').click();
  await page.waitForTimeout(300);
  await page.locator('#btnAddTop').click();
  await page.waitForTimeout(400);

  const testTitle = 'V3测试-自动化-' + Date.now().toString().slice(-5);
  await page.locator('#fTitle').fill(testTitle);
  await page.locator('#fPriority .seg-btn[data-val="高"]').click();
  const catBtns = await page.locator('#fCategory .seg-btn').count();
  if (catBtns > 0) await page.locator('#fCategory .seg-btn').first().click();
  const p2 = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const localToday = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  await page.locator('#fDue').fill(localToday);
  await page.locator('#modalSave').click();

  // 保存后列表是异步刷新的，轮询等待而不是固定 sleep，避免机器繁忙时误判
  let listHit = true;
  try {
    await page.waitForFunction(
      (t) => (document.querySelector('#taskList') || {}).innerText?.includes(t),
      testTitle,
      { timeout: 8000 }
    );
  } catch {
    listHit = false;
  }

  const listText = await page.locator('#taskList').innerText();
  const activeTabs = await page.locator('[data-tab].active').allInnerTexts().catch(() => []);
  const rowsShown = await page.locator('#taskList .task').count();
  check('新任务出现在列表', listHit,
    listHit ? '' : `当前筛选=${JSON.stringify(activeTabs)} 显示${rowsShown}条 列表开头=${listText.slice(0, 80).replace(/\n/g, ' | ')}`);

  const after = await (await fetch(`${BASE}/api/tasks`)).json();
  const created = after.data.find((t) => t.title === testTitle);
  check('新任务已写入数据库', !!created, created ? `id=${created.id}` : '未找到');

  // 轮询等待任务达到期望状态，避免线上冷启动时固定等待不够
  const waitTask = async (id, expectDone, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const j = await (await fetch(`${BASE}/api/tasks`)).json();
      const t = j.data.find((x) => x.id === id);
      if (t && t.completed === expectDone) return t;
      await new Promise((r) => setTimeout(r, 500));
    }
    const j = await (await fetch(`${BASE}/api/tasks`)).json();
    return j.data.find((x) => x.id === id);
  };

  console.log('\n=== 5. 完成与恢复 ===');
  if (created) {
    const row = page.locator(`.task[data-id="${created.id}"]`).first();
    await row.locator('[data-act="toggle"]').click();
    const t1 = await waitTask(created.id, true);
    check('标记完成已保存', t1 && t1.completed === true, `completed=${t1 && t1.completed}`);

    const row2 = page.locator(`.task[data-id="${created.id}"]`).first();
    await row2.locator('[data-act="toggle"]').click();
    const t2 = await waitTask(created.id, false);
    check('恢复未完成已保存', t2 && t2.completed === false, `completed=${t2 && t2.completed}`);
  }

  console.log('\n=== 6. 搜索 ===');
  await page.locator('#searchInput').fill('V3测试');
  await page.waitForTimeout(400);
  const searchText = await page.locator('#taskList').innerText();
  check('搜索能匹配到任务', searchText.includes('V3测试'));
  await page.locator('#searchInput').fill('');
  await page.waitForTimeout(300);

  console.log('\n=== 7. 看板模式 ===');
  await page.locator('#taskMode .seg-btn[data-mode="kanban"]').click();
  await page.waitForTimeout(500);
  const kanbanCards = await page.locator('.kanban-card').count();
  check('看板已渲染卡片', kanbanCards > 0, `${kanbanCards} 张卡片`);
  const cols = await page.locator('.kanban-column').count();
  check('看板三列齐全', cols === 3);
  await page.screenshot({ path: path.join(SHOT, 'v3-02-kanban.png'), fullPage: true });
  await page.locator('#taskMode .seg-btn[data-mode="list"]').click();
  await page.waitForTimeout(300);

  console.log('\n=== 8. 详情弹窗 ===');
  if (created) {
    await page.locator(`.task[data-id="${created.id}"] .task-title`).first().click();
    await page.waitForTimeout(900);
    const detailVisible = await page.locator('#detailModal').isVisible();
    check('详情弹窗可打开', detailVisible);
    const detailText = await page.locator('#detailBody').innerText();
    check('详情显示任务标题', detailText.includes(testTitle));
    await page.locator('#detailClose').click();
    await page.waitForTimeout(300);
  }

  console.log('\n=== 9. 日历 / 计划 / 分类 / 设置 ===');
  await page.locator('.nav-item[data-nav="calendar"]').click();
  await page.waitForTimeout(500);
  const calCells = await page.locator('#calendarBody .cal-cell').count();
  check('日历月视图渲染', calCells >= 28, `${calCells} 个格子`);
  for (const v of ['week', 'day', 'month']) {
    await page.locator(`.cal-views .seg-btn[data-cal-view="${v}"]`).click();
    await page.waitForTimeout(300);
    const html = await page.locator('#calendarBody').innerHTML();
    check(`日历${v}视图有内容`, html.length > 100, `${html.length} 字符`);
  }
  await page.screenshot({ path: path.join(SHOT, 'v3-03-calendar.png'), fullPage: true });

  await page.locator('.nav-item[data-nav="plan"]').click();
  await page.waitForTimeout(400);
  const planHtml = await page.locator('#planBody').innerText();
  check('我的计划有内容', planHtml.length > 10, `${planHtml.length} 字符`);

  await page.locator('.nav-item[data-nav="categories"]').click();
  await page.waitForTimeout(400);
  const catItems = await page.locator('.cat-manage-item').count();
  check('分类列表渲染', catItems >= 4, `${catItems} 个分类`);
  await page.screenshot({ path: path.join(SHOT, 'v3-04-categories.png'), fullPage: true });

  await page.locator('.nav-item[data-nav="settings"]').click();
  await page.waitForTimeout(400);
  const featItems = await page.locator('.feature-item').count();
  check('功能状态网格渲染', featItems >= 9, `${featItems} 项`);
  const onCount = await page.locator('.feature-item:not(.off)').count();
  console.log(`        已启用功能 ${onCount} 项 / 共 ${featItems} 项`);
  await page.screenshot({ path: path.join(SHOT, 'v3-05-settings.png'), fullPage: true });

  console.log('\n=== 10. 番茄钟 ===');
  await page.locator('.nav-item[data-nav="pomodoro"]').click();
  await page.waitForTimeout(400);
  const pomTime = await page.locator('#pomTime').innerText();
  check('番茄钟初始 25:00', pomTime === '25:00', pomTime);
  await page.locator('#pomStart').click();
  await page.waitForTimeout(2200);
  const pomTime2 = await page.locator('#pomTime').innerText();
  check('番茄钟开始倒计时', pomTime2 !== pomTime, pomTime2);
  await page.locator('#pomStart').click();
  await page.locator('#pomReset').click();
  await page.screenshot({ path: path.join(SHOT, 'v3-06-pomodoro.png'), fullPage: true });

  console.log('\n=== 11. 数据分析 ===');
  await page.locator('.nav-item[data-nav="analytics"]').click();
  await page.waitForTimeout(600);
  const dailyBars = await page.locator('#dailyChartBox > div > div').count();
  check('每日柱状图渲染', dailyBars === 30, `${dailyBars} 根`);
  const catRows = await page.locator('#categoryStats .cat-stat-row').count();
  check('分类完成率渲染', catRows >= 1, `${catRows} 行`);
  await page.screenshot({ path: path.join(SHOT, 'v3-07-analytics.png'), fullPage: true });

  console.log('\n=== 12. 移动端 ===');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  // 移动端侧边栏默认收起，先展开菜单再点导航
  await page.locator('#menuBtn').click();
  await page.waitForTimeout(450);
  const sidebarOpen = await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'));
  check('移动端菜单可展开', sidebarOpen);
  await page.screenshot({ path: path.join(SHOT, 'v3-09-mobile-menu.png') });

  await page.locator('.nav-item[data-nav="dashboard"]').click();
  await page.waitForTimeout(800);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check('移动端无横向溢出', scrollW <= 400, `页面宽度 ${scrollW}px`);
  await page.screenshot({ path: path.join(SHOT, 'v3-08-mobile.png'), fullPage: true });

  console.log('\n=== 13. AI 助手对话 ===');
  // 上一节把视口改成了 390px 且侧边栏收起，这里先还原桌面视口再点导航
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  await page.locator('.nav-item[data-nav="ai"]').click();
  await page.waitForTimeout(600);
  const badge = await page.locator('#aiStatus').innerText();
  check('AI 状态显示已连接', badge.includes('已连接'), badge);

  await page.locator('#aiInput').fill('用一句话说明你能帮我做什么');
  await page.locator('#aiSend').click();
  let aiReplied = true;
  try {
    await page.waitForFunction(() => {
      const list = document.querySelectorAll('#aiMessages .ai-message.bot');
      if (!list.length) return false;
      const t = list[list.length - 1].innerText.trim();
      return t && !t.includes('思考中') && !t.includes('❌');
    }, null, { timeout: 45000 });
  } catch { aiReplied = false; }
  const lastBubble = await page.locator('#aiMessages .ai-message.bot').last().innerText().catch(() => '');
  check('AI 能返回回答', aiReplied, aiReplied ? lastBubble.slice(0, 40).replace(/\n/g, ' ') : '45 秒内无回答');

  const bubbleHtml = await page.locator('#aiMessages .ai-message.bot').last().innerHTML().catch(() => '');
  check('回复已渲染 Markdown（无裸露星号）', !bubbleHtml.includes('**'));

  console.log('\n=== 14. 清理测试数据 ===');
  if (created) {
    const del = await fetch(`${BASE}/api/tasks/${created.id}`, { method: 'DELETE' });
    check('测试任务已清理', del.ok);

    // 事件表按设计保留已删任务的历史，测试自己产生的事件要清掉，否则热力图会虚高
    const SUP = process.env.SUPABASE_URL || 'https://kjbykpzbgypwnactmnos.supabase.co';
    const KEY = process.env.SUPABASE_KEY || 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';
    const clean = await fetch(`${SUP}/rest/v1/task_events?task_id=eq.${created.id}`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    });
    check('测试事件已清理', clean.ok, `HTTP ${clean.status}`);

    const all = await (await fetch(`${BASE}/api/tasks`)).json();
    const strays = all.data.filter((t) => String(t.title).startsWith('V3测试-自动化-'));
    for (const s of strays) {
      await fetch(`${BASE}/api/tasks/${s.id}`, { method: 'DELETE' });
      await fetch(`${SUP}/rest/v1/task_events?task_id=eq.${s.id}`, {
        method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
      });
    }
    if (strays.length) console.log(`        另外清理了 ${strays.length} 条历史残留测试任务`);
  }

  console.log('\n=== 15. 控制台错误 ===');
  const realErrors = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
  check('没有前端报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  console.log(`\n──────── 结果：通过 ${pass} 项，失败 ${fail} 项 ────────`);
  if (errors.length) console.log('失败项：' + errors.join('、'));

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本异常：', e.message);
  process.exit(1);
});
