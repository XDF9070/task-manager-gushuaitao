-- ============================================================
-- 第十一课 拓展练习4：RLS 策略改成"登录用户只能看自己的任务"
-- ⚠️ 选做进阶题：执行前需先开启 Supabase Auth（邮箱注册登录），
--    否则匿名访问会被全部拦截、现有页面将查不到任何数据！
-- 建议课上问过老师、或做完登录功能后再执行。
-- ============================================================

-- 第 1 步：Supabase 控制台 → Authentication → 登录方式 → 启用 Email
-- 第 2 步：给 tasks 表加"所属用户"字段
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- 第 3 步：把已有数据归给某个测试用户（可选，把邮箱换成你的）
-- UPDATE tasks SET user_id = (SELECT id FROM auth.users WHERE email = '你的邮箱@example.com');

-- 第 4 步：删掉旧的"所有人可读写"策略，换成按用户隔离
DROP POLICY IF EXISTS "任何人可读" ON tasks;
DROP POLICY IF EXISTS "任何人可写" ON tasks;
DROP POLICY IF EXISTS "公开访问" ON tasks;

CREATE POLICY "用户只能看自己的任务" ON tasks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "用户只能添加自己的任务" ON tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "用户只能改自己的任务" ON tasks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "用户只能删自己的任务" ON tasks
  FOR DELETE USING (auth.uid() = user_id);

-- 第 5 步（代码侧）：前端用 supabase-js 的 signInWithOtp/signUp 登录，
--   请求头带上用户的 access_token，后端插入时写入 user_id。
--   这需要新增登录页面，工作量较大，适合作为独立小项目。
