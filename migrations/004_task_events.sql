-- 任务实时日志：记录阶段切换、进度消息、模型调用与错误，供任务列表展开查看。
CREATE TABLE task_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id TEXT NOT NULL REFERENCES review_tasks(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 stage TEXT,
 level TEXT NOT NULL CHECK (level IN ('info','success','warning','error')),
 message TEXT NOT NULL
);
CREATE INDEX task_events_task ON task_events(task_id,id);
-- 用户可从任务列表中移除已失败的任务；记录与尝试仍保留。
ALTER TABLE review_tasks ADD COLUMN dismissed_at TEXT;
