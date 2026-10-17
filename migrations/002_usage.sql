-- 每次模型调用的实际用量与费用（由服务商返回的 usage 计算，调用当时按价格表计价并保存）。
ALTER TABLE review_attempts
 ADD COLUMN input_tokens INT NULL,
 ADD COLUMN cache_hit_tokens INT NULL,
 ADD COLUMN output_tokens INT NULL,
 ADD COLUMN reasoning_tokens INT NULL,
 ADD COLUMN cost_usd DECIMAL(12,6) NULL,
 ADD COLUMN price_tier VARCHAR(16) NULL,
 ADD COLUMN usage_json TEXT NULL;
