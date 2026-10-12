-- 专项审查结果（专业培养要求、文题一致性、政治方向），与六维度评分分开保存；旧记录为 NULL。
ALTER TABLE review_runs ADD COLUMN compliance_json TEXT CHECK (compliance_json IS NULL OR json_valid(compliance_json));
