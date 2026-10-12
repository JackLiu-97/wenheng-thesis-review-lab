-- 相同 PDF（按 SHA-256）复用已有解析结果：按文件指纹查找已完成的解析。
CREATE INDEX paper_versions_sha256 ON paper_versions(sha256);
