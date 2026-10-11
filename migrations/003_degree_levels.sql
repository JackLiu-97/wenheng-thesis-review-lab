-- 学位拆分为学位层次（学士/硕士/博士）与学位类型（学术/专业）；degree_type 仍为二者组合，新增学士两类。
DROP TRIGGER paper_degree_insert;
DROP TRIGGER paper_degree_update;
DROP TRIGGER task_degree_insert;
CREATE TRIGGER paper_degree_insert BEFORE INSERT ON paper_versions
WHEN json_extract(NEW.metadata_json,'$.degree_type') IS NOT NULL AND json_extract(NEW.metadata_json,'$.degree_type') NOT IN ('academic_bachelor','professional_bachelor','academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
CREATE TRIGGER paper_degree_update BEFORE UPDATE OF metadata_json ON paper_versions
WHEN json_extract(NEW.metadata_json,'$.degree_type') IS NOT NULL AND json_extract(NEW.metadata_json,'$.degree_type') NOT IN ('academic_bachelor','professional_bachelor','academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
CREATE TRIGGER task_degree_insert BEFORE INSERT ON review_tasks
WHEN json_extract(NEW.request_snapshot_json,'$.metadata.degree_type') IS NOT NULL AND json_extract(NEW.request_snapshot_json,'$.metadata.degree_type') NOT IN ('academic_bachelor','professional_bachelor','academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
-- 实时进度：记录当前阶段开始时间，用于计算阶段耗时与预计剩余时间。
ALTER TABLE review_tasks ADD COLUMN stage_started_at TEXT;
