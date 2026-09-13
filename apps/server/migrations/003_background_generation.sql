-- Apply before starting the updated server. Existing roles and sessions remain usable.
ALTER TABLE user_ip_roles ADD COLUMN generation_json JSON NULL, ADD COLUMN version INT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS background_jobs (
  id CHAR(36) PRIMARY KEY,
  job_key VARCHAR(255) NOT NULL UNIQUE,
  kind VARCHAR(20) NOT NULL,
  account_id CHAR(36) NULL,
  payload JSON NOT NULL,
  status VARCHAR(20) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  run_at BIGINT NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token CHAR(36) NULL,
  error VARCHAR(255) NULL,
  INDEX idx_jobs_ready(status,run_at,lease_until)
);
