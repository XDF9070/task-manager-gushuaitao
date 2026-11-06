-- ============================================================
-- 智能任务管理系统 v2 · 数据库安全增量迁移
-- 作用：只「新增」两个可选字段，不改动、不清空任何已有数据
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴 → Run
-- 执行顺序：本文件必须是唯一需要手动执行的脚本
-- ============================================================

-- 1) 任务分类（学习 / 工作 / 健身 / 生活）
--    IF NOT EXISTS 保证重复执行也不会报错
alter table public.tasks add column if not exists category text;

-- 2) 任务完成时间（用于"任务完成情况"折线图精确统计）
alter table public.tasks add column if not exists completed_at timestamptz;

-- 3) 回填历史数据：已完成的老任务没有完成时间，
--    用创建时间兜底，避免折线图把老任务算错
--    （只更新 completed_at 为空的已完成任务，不触碰其它字段）
update public.tasks
   set completed_at = created_at
 where completed_at is null
   and completed is true;

-- 如果你当初把完成状态字段建成了 is_complete，改用下面这句：
-- update public.tasks set completed_at = created_at
--  where completed_at is null and is_complete is true;

-- 4) 分类索引（按分类筛选更快，数据量大时才明显）
create index if not exists tasks_category_idx on public.tasks (category);

-- ============================================================
-- 完成。执行后不需要重启服务，后端会自动探测到新字段。
-- 关于历史任务：老数据的分类为空，页面会显示为「未分类」，
-- 你在界面上编辑任意任务即可补上分类，不会被强制改写。
-- ============================================================
