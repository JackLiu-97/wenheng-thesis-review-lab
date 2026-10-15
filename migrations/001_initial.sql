-- 文衡 MySQL 数据库结构（兼容 MySQL 5.7+）。
-- 时间统一以 ISO-8601 字符串保存；JSON 内容以 LONGTEXT 保存，由程序校验与解析。
-- MySQL 5.7 不执行 CHECK 约束，取值范围与跨表一致性（如证据必须属于同一次解析）由程序保证。
CREATE TABLE schema_migrations (
 version INT NOT NULL PRIMARY KEY,
 checksum CHAR(64) NOT NULL,
 applied_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_meta (
 meta_key VARCHAR(100) NOT NULL PRIMARY KEY,
 meta_value LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 username VARCHAR(64) NOT NULL,
 username_normalized VARCHAR(64) NOT NULL,
 phone VARCHAR(32) NOT NULL DEFAULT '',
 password_hash VARCHAR(255) NOT NULL,
 password_salt VARCHAR(255) NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 UNIQUE KEY users_username (username_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 user_id VARCHAR(64) NOT NULL,
 expires_at BIGINT NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 KEY sessions_user (user_id),
 CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE papers (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 owner_id VARCHAR(64) NULL,
 title TEXT NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 updated_at VARCHAR(32) NOT NULL,
 KEY papers_owner (owner_id, created_at),
 CONSTRAINT papers_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE paper_versions (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 paper_id VARCHAR(64) NOT NULL,
 version_no INT NOT NULL,
 original_filename VARCHAR(512) NOT NULL,
 storage_path TEXT NOT NULL,
 sha256 CHAR(64) NULL,
 size_bytes BIGINT NULL,
 metadata_json LONGTEXT NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 UNIQUE KEY paper_versions_number (paper_id, version_no),
 KEY paper_versions_sha256 (sha256),
 CONSTRAINT paper_versions_paper_fk FOREIGN KEY (paper_id) REFERENCES papers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE parse_results (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 paper_version_id VARCHAR(64) NOT NULL,
 parser VARCHAR(64) NOT NULL,
 parser_version VARCHAR(64) NULL,
 status VARCHAR(16) NOT NULL,
 page_count INT NOT NULL,
 page_sizes_json LONGTEXT NOT NULL,
 coordinate_system_json LONGTEXT NOT NULL,
 artifact_path TEXT NULL,
 error TEXT NULL,
 created_at VARCHAR(32) NOT NULL,
 KEY parse_version (paper_version_id),
 CONSTRAINT parse_results_version_fk FOREIGN KEY (paper_version_id) REFERENCES paper_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_blocks (
 id VARCHAR(255) NOT NULL PRIMARY KEY,
 parse_result_id VARCHAR(64) NOT NULL,
 source_block_id VARCHAR(160) NOT NULL,
 sequence_no INT NOT NULL,
 page_no INT NOT NULL,
 block_type VARCHAR(32) NOT NULL,
 text LONGTEXT NOT NULL,
 bbox_json TEXT NULL,
 UNIQUE KEY document_blocks_source (parse_result_id, source_block_id),
 CONSTRAINT document_blocks_parse_fk FOREIGN KEY (parse_result_id) REFERENCES parse_results(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE standard_versions (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 standard_key VARCHAR(64) NOT NULL,
 version INT NOT NULL,
 name VARCHAR(255) NOT NULL,
 rubric_json LONGTEXT NOT NULL,
 degree_profiles_json LONGTEXT NOT NULL,
 discipline_profiles_json LONGTEXT NOT NULL,
 scoring_rules_json LONGTEXT NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 UNIQUE KEY standard_versions_key (standard_key, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE prompt_versions (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 owner_id VARCHAR(64) NULL,
 -- 系统模板（owner_id 为空）与各账号的版本号分别唯一。
 owner_key VARCHAR(64) GENERATED ALWAYS AS (IFNULL(owner_id, '')) STORED,
 dimension_code VARCHAR(8) NOT NULL,
 version INT NOT NULL,
 text LONGTEXT NOT NULL,
 note VARCHAR(1000) NOT NULL,
 kind VARCHAR(16) NULL,
 created_at VARCHAR(32) NOT NULL,
 UNIQUE KEY prompt_owner_version (owner_key, dimension_code, version),
 CONSTRAINT prompt_versions_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_tasks (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 owner_id VARCHAR(64) NULL,
 paper_version_id VARCHAR(64) NULL,
 parent_run_id VARCHAR(64) NULL,
 provider VARCHAR(32) NOT NULL,
 model VARCHAR(128) NULL,
 status VARCHAR(16) NOT NULL,
 stage VARCHAR(32) NOT NULL,
 request_snapshot_json LONGTEXT NOT NULL,
 checkpoint_json LONGTEXT NULL,
 error TEXT NULL,
 message TEXT NOT NULL,
 progress INT NOT NULL DEFAULT 0,
 created_at VARCHAR(32) NOT NULL,
 started_at VARCHAR(32) NULL,
 finished_at VARCHAR(32) NULL,
 stage_started_at VARCHAR(32) NULL,
 dismissed_at VARCHAR(32) NULL,
 KEY tasks_owner_status (owner_id, status, created_at),
 KEY tasks_status (status, created_at),
 CONSTRAINT review_tasks_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id),
 CONSTRAINT review_tasks_version_fk FOREIGN KEY (paper_version_id) REFERENCES paper_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_attempts (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 task_id VARCHAR(64) NOT NULL,
 stage VARCHAR(32) NOT NULL,
 attempt_no INT NOT NULL,
 status VARCHAR(16) NOT NULL,
 input_path TEXT NOT NULL,
 output_path TEXT NULL,
 error TEXT NULL,
 started_at VARCHAR(32) NOT NULL,
 finished_at VARCHAR(32) NULL,
 UNIQUE KEY review_attempts_number (task_id, stage, attempt_no),
 KEY review_attempts_stage (stage, status, started_at),
 CONSTRAINT review_attempts_task_fk FOREIGN KEY (task_id) REFERENCES review_tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_runs (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 task_id VARCHAR(64) NOT NULL,
 parse_result_id VARCHAR(64) NOT NULL,
 result_schema_version INT NOT NULL,
 overall_summary LONGTEXT NULL,
 strengths_json LONGTEXT NOT NULL,
 limitations_json LONGTEXT NOT NULL,
 revision_plan_json LONGTEXT NOT NULL,
 recommendation_reason LONGTEXT NULL,
 total_score DOUBLE NULL,
 grade VARCHAR(32) NULL,
 recommendation VARCHAR(64) NULL,
 assessment_status VARCHAR(16) NOT NULL,
 compliance_json LONGTEXT NULL,
 created_at VARCHAR(32) NOT NULL,
 UNIQUE KEY review_runs_task (task_id),
 CONSTRAINT review_runs_task_fk FOREIGN KEY (task_id) REFERENCES review_tasks(id),
 CONSTRAINT review_runs_parse_fk FOREIGN KEY (parse_result_id) REFERENCES parse_results(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- review_tasks 与 review_runs 互相引用，表都建好后再补外键。
ALTER TABLE review_tasks ADD CONSTRAINT review_tasks_parent_fk FOREIGN KEY (parent_run_id) REFERENCES review_runs(id);

CREATE TABLE dimension_reviews (
 id VARCHAR(128) NOT NULL PRIMARY KEY,
 run_id VARCHAR(64) NOT NULL,
 dimension_code VARCHAR(8) NOT NULL,
 summary LONGTEXT NOT NULL,
 assessment_status VARCHAR(16) NOT NULL,
 score DOUBLE NULL,
 weight DOUBLE NULL,
 score_reason LONGTEXT NULL,
 criteria_json LONGTEXT NOT NULL,
 UNIQUE KEY dimension_reviews_run (run_id, dimension_code),
 CONSTRAINT dimension_reviews_run_fk FOREIGN KEY (run_id) REFERENCES review_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_issues (
 id VARCHAR(128) NOT NULL PRIMARY KEY,
 dimension_review_id VARCHAR(128) NOT NULL,
 criterion_code VARCHAR(16) NULL,
 severity VARCHAR(16) NOT NULL,
 title TEXT NOT NULL,
 detail LONGTEXT NOT NULL,
 suggestion LONGTEXT NOT NULL,
 evidence_status VARCHAR(16) NOT NULL,
 sequence_no INT NOT NULL,
 KEY issues_dimension (dimension_review_id, sequence_no),
 CONSTRAINT review_issues_dimension_fk FOREIGN KEY (dimension_review_id) REFERENCES dimension_reviews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE issue_evidence (
 issue_id VARCHAR(128) NOT NULL,
 block_id VARCHAR(255) NOT NULL,
 sequence_no INT NOT NULL,
 PRIMARY KEY (issue_id, block_id),
 CONSTRAINT issue_evidence_issue_fk FOREIGN KEY (issue_id) REFERENCES review_issues(id),
 CONSTRAINT issue_evidence_block_fk FOREIGN KEY (block_id) REFERENCES document_blocks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE report_files (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 -- 生成顺序，用于取每条评审的最新报告。
 seq BIGINT NOT NULL AUTO_INCREMENT,
 run_id VARCHAR(64) NOT NULL,
 template_version VARCHAR(32) NOT NULL,
 status VARCHAR(16) NOT NULL,
 storage_path TEXT NULL,
 sha256 CHAR(64) NULL,
 generated_at VARCHAR(32) NULL,
 error TEXT NULL,
 UNIQUE KEY report_files_seq (seq),
 UNIQUE KEY report_files_template (run_id, template_version),
 CONSTRAINT report_files_run_fk FOREIGN KEY (run_id) REFERENCES review_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 task_id VARCHAR(64) NOT NULL,
 created_at VARCHAR(32) NOT NULL,
 stage VARCHAR(32) NULL,
 level VARCHAR(16) NOT NULL,
 message TEXT NOT NULL,
 KEY task_events_task (task_id, id),
 CONSTRAINT task_events_task_fk FOREIGN KEY (task_id) REFERENCES review_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
