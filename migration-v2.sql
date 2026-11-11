-- ============================================================
-- 智能任务管理系统 v2 · 数据库安全增量迁移
-- 作用：只「新增」两个可选字段，不改动、不清空任何已有数据
-- 使用方法：Supabase 控制台 → SQL Editor → New query → 粘贴 → Run
-- ============================================================

-- 1) 任务分类（学习 / 工作 / 健身 / 生活）
--    IF NOT EXISTS 保证重复执行也不会报错
alter table public.tasks add column if not exists category text;

-- 2) 任务完成时间（用于「任务完成情况」折线图精确统计）
alter table public.tasks add column if not exists completed_at timestamptz;

-- 3) 回填历史数据：已完成的老任务没有完成时间，用创建时间兜底
--    你的表完成状态字段可能叫 completed，也可能叫 is_complete，
--    下面自动判断，只更新 completed_at 为空的行，其它字段一律不动
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'completed'
  ) then
    update public.tasks set completed_at = created_at
     where completed_at is null and completed is true;

  elsif exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_complete'
  ) then
    update public.tasks set completed_at = created_at
     where completed_at is null and is_complete is true;
  end if;
end $$;

-- 4) 分类索引（按分类筛选更快，数据量大时才明显）
create index if not exists tasks_category_idx on public.tasks (category);

-- ============================================================
-- 完成。执行后不需要重启服务，后端会自动探测到新字段。
-- 历史任务的分类为空，页面显示为「未分类」；
-- 到「分类管理」用「一键归类」或逐条编辑补上即可，不会被强制改写。
-- ============================================================
