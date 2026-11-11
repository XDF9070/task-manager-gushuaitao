/* ============================================================
   V3.0 接口级集成测试（真实读写 Supabase）
   用法：node scripts/test-v3-api.js [baseUrl]
   说明：只创建/删除本脚本产生的测试数据，不动用户既有的 14 条任务
   ============================================================ */
const BASE = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/$/, '');
const SUP = process.env.SUPABASE_URL || 'https://kjbykpzbgypwnactmnos.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, text, headers: res.headers };
}

const createdTaskIds = [];
const createdCategoryIds = [];
const pomodoroIds = [];

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

(async () => {
  console.log('\n=== 0. 基础连通性 ===');
  const meta = await api('GET', '/api/meta');
  check('GET /api/meta 200', meta.status === 200, `HTTP ${meta.status}`);
  const f = (meta.json && meta.json.features) || {};
  const nine = ['dueDate', 'category', 'completedAt', 'status', 'repeat', 'subtasks', 'pomodoro', 'heatmap', 'categories'];
  const missing = nine.filter((k) => f[k] !== true);
  check('九项 V3 能力全部启用', missing.length === 0, missing.length ? '缺失: ' + missing.join(',') : '9/9');
  const baseCount = meta.json.counts.total;
  console.log(`        基线任务数：${baseCount}`);

  console.log('\n=== 1. 重复任务（daily）===');
  const rep = await api('POST', '/api/tasks', {
    title: `【自测】重复任务-${Date.now()}`,
    priority: '中',
    category: '学习',
    dueDate: todayStr(0),
    repeatType: 'daily',
    repeatUntil: todayStr(5)
  });
  check('创建重复任务成功', rep.status === 200 && rep.json.success, `HTTP ${rep.status}`);
  const repTask = rep.json.data;
  createdTaskIds.push(repTask.id);
  check('返回 series_id', !!repTask.series_id, repTask.series_id || '无');
  check('repeat_type 已保存为 daily', repTask.repeat_type === 'daily', String(repTask.repeat_type));

  const listBefore = await api('GET', '/api/tasks');
  const seriesBefore = listBefore.json.data.filter((t) => t.series_id === repTask.series_id).length;
  check('系列内当前 1 条', seriesBefore === 1, `${seriesBefore} 条`);

  const done = await api('PATCH', `/api/tasks/${repTask.id}`, { status: 'done' });
  check('标记完成成功', done.status === 200 && (done.json.data.status === 'done'),
    `status=${done.json.data && done.json.data.status}`);

  await new Promise((r) => setTimeout(r, 800));
  const listAfter = await api('GET', '/api/tasks');
  const seriesTasks = listAfter.json.data.filter((t) => t.series_id === repTask.series_id);
  check('完成后自动生成下一次', seriesTasks.length === 2, `${seriesTasks.length} 条`);
  const nextTask = seriesTasks.find((t) => String(t.id) !== String(repTask.id));
  if (nextTask) createdTaskIds.push(nextTask.id);
  check('下一次到期日 = 明天', nextTask && nextTask.due_date === todayStr(1), nextTask && nextTask.due_date);
  check('下一次状态为 todo', nextTask && nextTask.status === 'todo', nextTask && nextTask.status);
  check('下一次继承分类', nextTask && nextTask.category === '学习', nextTask && nextTask.category);
  check('下一次继承重复规则', nextTask && nextTask.repeat_type === 'daily', nextTask && nextTask.repeat_type);

  // 幂等：再次标记完成不应重复生成
  await api('PATCH', `/api/tasks/${repTask.id}`, { status: 'done' });
  await new Promise((r) => setTimeout(r, 600));
  const listAgain = await api('GET', '/api/tasks');
  const seriesAgain = listAgain.json.data.filter((t) => t.series_id === repTask.series_id).length;
  check('重复标记不产生堆积', seriesAgain === 2, `${seriesAgain} 条`);

  console.log('\n=== 2. 热力图（task_events 数据源）===');
  const before = await api('GET', '/api/stats/heatmap');
  const todayKey = todayStr(0);
  const todayCount = (before.json.data.days || {})[todayKey] || 0;
  check('热力图包含今天', todayCount >= 1, `今天 ${todayCount} 次完成`);
  check('热力图未降级', before.json.data.degraded === false, String(before.json.data.degraded));
  check('热力图返回 streak/total', typeof before.json.data.streak === 'number' && typeof before.json.data.total === 'number',
    `streak=${before.json.data.streak} total=${before.json.data.total}`);

  console.log('\n=== 3. 子任务 ===');
  const parent = await api('POST', '/api/tasks', {
    title: `【自测】子任务父任务-${Date.now()}`,
    priority: '高',
    category: '工作',
    dueDate: todayStr(0)
  });
  const pid = parent.json.data.id;
  createdTaskIds.push(pid);

  const s1 = await api('POST', `/api/tasks/${pid}/subtasks`, { title: '子任务A' });
  const s2 = await api('POST', `/api/tasks/${pid}/subtasks`, { title: '子任务B' });
  const s3 = await api('POST', `/api/tasks/${pid}/subtasks`, { title: '子任务C' });
  check('新增 3 个子任务', [s1, s2, s3].every((r) => r.status === 200 && r.json.success),
    `HTTP ${[s1, s2, s3].map((r) => r.status).join('/')}`);

  const subList = await api('GET', `/api/tasks/${pid}/subtasks`);
  check('子任务列表返回 3 条', subList.json.data.length === 3, `${subList.json.data.length} 条`);

  const toggle = await api('PATCH', `/api/subtasks/${s2.json.data.id}`, { done: true });
  check('勾选子任务成功', toggle.status === 200 && toggle.json.data.done === true, `done=${toggle.json.data.done}`);

  const taskOne = await api('GET', '/api/tasks');
  const pInList = taskOne.json.data.find((t) => String(t.id) === String(pid));
  const pd = pInList ? pInList.subtask_done : null;
  const pt = pInList ? pInList.subtask_total : null;
  check('列表携带子任务进度 1/3',
    String(pd) === '1' && String(pt) === '3',
    `done=${pd} total=${pt}`);

  const delSub = await api('DELETE', `/api/subtasks/${s3.json.data.id}`);
  check('删除子任务成功', delSub.status === 200 && delSub.json.success, `HTTP ${delSub.status}`);
  const subAfter = await api('GET', `/api/tasks/${pid}/subtasks`);
  check('删除后剩 2 条', subAfter.json.data.length === 2, `${subAfter.json.data.length} 条`);

  console.log('\n=== 4. 番茄钟 ===');
  const ps = await api('GET', '/api/pomodoro/stats');
  const todayBefore = ps.json.data.today;
  const add = await api('POST', '/api/pomodoro', { type: 'focus', duration: 25, taskId: pid });
  check('记录一次专注成功', add.status === 200 && add.json.success, `HTTP ${add.status}`);
  if (add.json.data && add.json.data.id) pomodoroIds.push(add.json.data.id);

  const ps2 = await api('GET', '/api/pomodoro/stats');
  check('今日专注数 +1', ps2.json.data.today === todayBefore + 1,
    `${todayBefore} → ${ps2.json.data.today}`);
  check('今日专注分钟数 >= 25', ps2.json.data.minutesToday >= 25, `${ps2.json.data.minutesToday} 分钟`);
  check('daily 序列可用于图表', Array.isArray(ps2.json.data.daily), `${(ps2.json.data.daily || []).length} 天`);

  console.log('\n=== 5. 分类管理 ===');
  const cname = `自测分类${Date.now() % 100000}`;
  const addCat = await api('POST', '/api/categories', { name: cname, color: '#ff8800' });
  check('新增分类成功', addCat.status === 200 && addCat.json.success, `HTTP ${addCat.status}`);
  const cid = addCat.json.data && addCat.json.data.id;
  if (cid) createdCategoryIds.push(cid);

  const dup = await api('POST', '/api/categories', { name: cname, color: '#ff8800' });
  check('重名分类被拒绝', dup.status === 409 || dup.status === 400, `HTTP ${dup.status}`);

  const catList = await api('GET', '/api/categories');
  check('分类列表包含新分类', catList.json.data.some((c) => c.name === cname), `共 ${catList.json.data.length} 个`);

  const upd = await api('PATCH', `/api/categories/${cid}`, { name: cname + '改', color: '#00aa88' });
  check('修改分类成功', upd.status === 200 && upd.json.data.color === '#00aa88',
    `${upd.json.data && upd.json.data.name} / ${upd.json.data && upd.json.data.color}`);

  const delCat = await api('DELETE', `/api/categories/${cid}`);
  check('删除分类成功', delCat.status === 200 && delCat.json.success, `HTTP ${delCat.status}`);
  const catAfter = await api('GET', '/api/categories');
  check('删除后列表不含该分类', !catAfter.json.data.some((c) => c.id === cid || c.name === cname + '改'),
    `剩 ${catAfter.json.data.length} 个`);

  console.log('\n=== 6. 看板三态流转 ===');
  const kb = await api('POST', '/api/tasks', { title: `【自测】看板-${Date.now()}`, priority: '低', dueDate: todayStr(0), status: 'todo' });
  const kid = kb.json.data.id;
  createdTaskIds.push(kid);
  check('新建为 todo', kb.json.data.status === 'todo', kb.json.data.status);

  const toDoing = await api('PATCH', `/api/tasks/${kid}`, { status: 'doing' });
  check('todo → doing', toDoing.json.data.status === 'doing', toDoing.json.data.status);
  const toDone = await api('PATCH', `/api/tasks/${kid}`, { status: 'done' });
  check('doing → done', toDone.json.data.status === 'done', toDone.json.data.status);
  const toTodo = await api('PATCH', `/api/tasks/${kid}`, { status: 'todo' });
  check('done → todo（恢复）', toTodo.json.data.status === 'todo' && toTodo.json.data.completed === false,
    `status=${toTodo.json.data.status} completed=${toTodo.json.data.completed}`);

  const badStatus = await api('PATCH', `/api/tasks/${kid}`, { status: 'xxx' });
  check('非法状态被拒绝', badStatus.status === 400, `HTTP ${badStatus.status}`);

  console.log('\n=== 7. 备份导出 ===');
  const exp = await api('GET', '/api/export?format=json');
  check('导出 JSON 成功', exp.status === 200, `HTTP ${exp.status}`);
  let backup = null;
  try { backup = JSON.parse(exp.text); } catch { /* noop */ }
  check('备份含 version 3.0', !!backup && backup.version === '3.0', backup && backup.version);
  check('备份含 tasks 数组', !!backup && Array.isArray(backup.tasks) && backup.tasks.length >= baseCount,
    backup ? `${backup.tasks.length} 条` : '');
  check('备份含 subtasks', !!backup && Array.isArray(backup.subtasks));
  check('备份含 categories', !!backup && Array.isArray(backup.categories) && backup.categories.length >= 4,
    backup ? `${backup.categories.length} 个` : '');

  const csv = await fetch(BASE + '/api/export?format=csv');
  const csvBuf = Buffer.from(await csv.arrayBuffer());
  const csvText = csvBuf.toString('utf8');
  check('导出 CSV 成功', csv.status === 200, `HTTP ${csv.status}`);
  check('CSV 带 BOM 防乱码', csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF,
    `前 3 字节 ${[...csvBuf.slice(0, 3)].map((b) => b.toString(16).toUpperCase()).join(' ')}`);
  check('CSV 表头正确', csvText.includes('id,title,priority,category,status'), csvText.slice(1, 50));

  console.log('\n=== 8. 备份导入（merge 判重）===');
  const impTitle = `【自测】导入任务-${Date.now()}`;
  const imp1 = await api('POST', '/api/import', {
    mode: 'merge',
    tasks: [{ title: impTitle, priority: '中', category: '生活', due_date: todayStr(2), completed: false }]
  });
  check('首次导入 inserted=1', imp1.json.data.inserted === 1, JSON.stringify(imp1.json.data));
  const imp2 = await api('POST', '/api/import', {
    mode: 'merge',
    tasks: [{ title: impTitle, priority: '中', category: '生活', due_date: todayStr(2), completed: false }]
  });
  check('重复导入 skipped=1（不覆盖）', imp2.json.data.skipped === 1 && imp2.json.data.inserted === 0,
    JSON.stringify(imp2.json.data));

  const allAfterImport = await api('GET', '/api/tasks');
  const impRow = allAfterImport.json.data.find((t) => t.title === impTitle);
  check('导入的数据真实落库', !!impRow, impRow ? `id=${impRow.id}` : '未找到');
  if (impRow) createdTaskIds.push(impRow.id);

  console.log('\n=== 9. 统计口径 ===');
  const ov = await api('GET', '/api/stats/overview');
  const nowTasks = await api('GET', '/api/tasks');
  check('概览 total 与任务列表一致', ov.json.data.total === nowTasks.json.data.length,
    `${ov.json.data.total} / ${nowTasks.json.data.length}`);
  check('概览含分类完成率', Object.keys(ov.json.data.byCategory).length >= 4,
    `${Object.keys(ov.json.data.byCategory).length} 类`);
  check('近 7 天数组长度 7', ov.json.data.last7.length === 7, `${ov.json.data.last7.length}`);
  check('完成率 0-100', ov.json.data.rate >= 0 && ov.json.data.rate <= 100, `${ov.json.data.rate}%`);

  console.log('\n=== 10. 边界与容错 ===');
  const emptyTitle = await api('POST', '/api/tasks', { title: '   ' });
  check('空标题返回 400', emptyTitle.status === 400, `HTTP ${emptyTitle.status}`);
  const badRepeat = await api('POST', '/api/tasks', { title: 'x', repeatType: 'hourly' });
  check('非法重复规则降级为 none', badRepeat.status === 200 && badRepeat.json.data.repeat_type === 'none',
    String(badRepeat.json.data && badRepeat.json.data.repeat_type));
  if (badRepeat.json.data && badRepeat.json.data.id) createdTaskIds.push(badRepeat.json.data.id);
  const notFound = await api('PATCH', '/api/tasks/99999999', { status: 'done' });
  check('不存在任务返回 404', notFound.status === 404, `HTTP ${notFound.status}`);
  const noSub = await api('GET', '/api/tasks/99999999/subtasks');
  check('不存在任务的子任务返回空数组', noSub.status === 200 && Array.isArray(noSub.json.data) && noSub.json.data.length === 0,
    `HTTP ${noSub.status}`);

  console.log('\n=== 11. 清理测试数据 ===');
  let deleted = 0;
  for (const id of createdTaskIds) {
    const r = await api('DELETE', `/api/tasks/${id}`);
    if (r.status === 200) deleted += 1;
  }
  check('测试任务已全部删除', deleted === createdTaskIds.length, `${deleted}/${createdTaskIds.length} 条`);

  // 事件表按设计会保留已删任务的历史，测试产生的必须自己清掉，否则热力图越跑越高
  if (createdTaskIds.length) {
    const ids = createdTaskIds.join(',');
    await fetch(`${SUP}/rest/v1/task_events?task_id=in.(${ids})`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    });
  }

  // 番茄钟测试记录无删除接口，直接走 Supabase REST 清理
  for (const id of pomodoroIds) {
    await fetch(`${SUP}/rest/v1/pomodoro_sessions?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    });
  }

  const final = await api('GET', '/api/tasks');
  check('任务总数回到基线', final.json.data.length === baseCount, `${final.json.data.length} / 基线 ${baseCount}`);

  console.log('\n──────── 结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项 ────────');
  if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常终止：', e);
  process.exit(1);
});
