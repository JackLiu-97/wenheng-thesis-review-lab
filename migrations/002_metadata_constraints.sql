-- Null metadata is intentional for legacy records; new submissions are validated by the API.
CREATE TRIGGER paper_degree_insert BEFORE INSERT ON paper_versions
WHEN json_extract(NEW.metadata_json,'$.degree_type') IS NOT NULL AND json_extract(NEW.metadata_json,'$.degree_type') NOT IN ('academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
CREATE TRIGGER paper_degree_update BEFORE UPDATE OF metadata_json ON paper_versions
WHEN json_extract(NEW.metadata_json,'$.degree_type') IS NOT NULL AND json_extract(NEW.metadata_json,'$.degree_type') NOT IN ('academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
CREATE TRIGGER task_degree_insert BEFORE INSERT ON review_tasks
WHEN json_extract(NEW.request_snapshot_json,'$.metadata.degree_type') IS NOT NULL AND json_extract(NEW.request_snapshot_json,'$.metadata.degree_type') NOT IN ('academic_master','professional_master','academic_doctor','professional_doctor')
BEGIN SELECT RAISE(ABORT,'invalid degree_type'); END;
CREATE TRIGGER task_snapshot_immutable BEFORE UPDATE OF request_snapshot_json ON review_tasks
WHEN NEW.request_snapshot_json != OLD.request_snapshot_json
BEGIN SELECT RAISE(ABORT,'submitted snapshot is immutable'); END;
CREATE TRIGGER evidence_same_parse_update BEFORE UPDATE ON issue_evidence BEGIN
 SELECT CASE WHEN (SELECT parse_result_id FROM document_blocks WHERE id=NEW.block_id) != (SELECT r.parse_result_id FROM review_runs r JOIN dimension_reviews d ON d.run_id=r.id JOIN review_issues i ON i.dimension_review_id=d.id WHERE i.id=NEW.issue_id) THEN RAISE(ABORT,'evidence belongs to another document') END;
END;
