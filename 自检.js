// ============================================================
// 一键自检脚本 —— 在你的电脑上运行，验证 Supabase 是否真的通了
// 用法：在 task-manager 文件夹里打开终端，执行
//       node 自检.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kjbykpzbgypwnactmnos.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tDjMLtzqakxonusEJECDTA_kVNPPg41';

const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => console.log('  ❌ ' + m);

async function main() {
  console.log('\n🔍 开始自检（共 5 项）\n');

  // ---------- 1. 网络能否连上 Supabase ----------
  console.log('【1/5】连接 Supabase 服务器…');
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/', {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(15000)
    });
    ok(`连上了（HTTP ${r.status}）`);
  } catch (e) {
    bad('连不上：' + e.message);
    console.log('\n  👉 说明：你的网络访问不了 supabase.co。');
    console.log('     国内网络可能需要代理/加速，或者换个网络再试。');
    console.log('     （如果浏览器能打开 supabase.com 控制台，通常就没问题，多试几次）\n');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------- 2. 表是否存在 ----------
  console.log('\n【2/5】检查 tasks 数据表…');
  let tableExists = true;
  try {
    const { error } = await supabase.from('tasks').select('id').limit(1);
    if (error) {
      tableExists = false;
      bad('查不到 tasks 表：' + error.message);
      console.log('\n  👉 说明：建表 SQL 还没执行。');
      console.log('     去 Supabase → 左侧 SQL Editor → New query');
      console.log('     把 supabase-setup.sql 全部粘贴进去 → 点 Run');
      console.log('     看到 "Success. No rows returned" 就成了。\n');
    } else {
      ok('tasks 表存在');
    }
  } catch (e) {
    tableExists = false;
    bad(e.message);
  }
  if (!tableExists) process.exit(1);

  // ---------- 3. 读权限（RLS 策略）----------
  console.log('\n【3/5】测试读取权限（RLS 策略）…');
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    ok(`读取成功，当前有 ${data.length} 条任务`);
    if (data.length > 0) {
      console.log('     最近一条：' + JSON.stringify(data[0]));
    }
  } catch (e) {
    bad('读取失败：' + e.message);
    console.log('\n  👉 如果报错含 "row-level security" 或 "permission denied"，');
    console.log('     说明 RLS 策略没建。重新执行 supabase-setup.sql 的第 3、4 段。\n');
    process.exit(1);
  }

  // ---------- 4. 写权限（添加任务）----------
  console.log('\n【4/5】测试写入权限（添加一条测试任务）…');
  let testId = null;
  try {
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ title: '【自检】这条任务可以删除', priority: '低', completed: false }])
      .select();
    if (error) throw error;
    testId = data[0].id;
    ok('写入成功，新任务 id = ' + testId);
  } catch (e) {
    bad('写入失败：' + e.message);
    console.log('\n  👉 说明 insert 策略没建。重新执行 supabase-setup.sql 的第 4 段。\n');
    process.exit(1);
  }

  // ---------- 5. 更新 + 删除权限 ----------
  console.log('\n【5/5】测试更新与删除权限…');
  try {
    const { error: e1 } = await supabase
      .from('tasks').update({ completed: true }).eq('id', testId);
    if (e1) throw new Error('更新失败：' + e1.message);
    ok('更新成功（已标记为完成）');

    const { error: e2 } = await supabase.from('tasks').delete().eq('id', testId);
    if (e2) throw new Error('删除失败：' + e2.message);
    ok('删除成功（测试数据已清理）');
  } catch (e) {
    bad(e.message);
    console.log('\n  👉 重新执行 supabase-setup.sql，确保 4 条策略都建好了。\n');
    process.exit(1);
  }

  // ---------- 全部通过 ----------
  console.log('\n' + '='.repeat(50));
  console.log('🎉 全部通过！数据库已完全打通，可以开始用了。');
  console.log('='.repeat(50));
  console.log('\n下一步：');
  console.log('  1. 执行 npm start');
  console.log('  2. 浏览器打开 http://localhost:3000');
  console.log('  3. 添加任务、刷新页面，数据还在就对了\n');
}

main().catch(e => {
  console.error('\n💥 自检过程出错：', e.message, '\n');
  process.exit(1);
});
