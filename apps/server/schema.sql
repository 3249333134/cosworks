CREATE DATABASE IF NOT EXISTS cosworks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cosworks;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  account VARCHAR(32) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(24) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profiles (
  account_id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(24) NOT NULL,
  mbti CHAR(4) NULL,
  mbti_completed_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profile_user FOREIGN KEY(account_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_ip_roles (
  id CHAR(36) PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  ip_theme VARCHAR(80) NOT NULL,
  name VARCHAR(50) NOT NULL,
  persona_tags JSON NOT NULL,
  quote VARCHAR(100) NOT NULL DEFAULT '',
  signature_action VARCHAR(100) NOT NULL DEFAULT '',
  ability VARCHAR(100) NOT NULL DEFAULT '',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  generation_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_roles_account_theme(account_id,ip_theme),
  CONSTRAINT fk_role_user FOREIGN KEY(account_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) PRIMARY KEY,
  code CHAR(6) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  ip_theme VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  owner_account_id CHAR(36) NOT NULL,
  state_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_room_owner FOREIGN KEY(owner_account_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS room_members (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  display_name VARCHAR(24) NOT NULL,
  is_owner TINYINT(1) NOT NULL DEFAULT 0,
  host_role VARCHAR(20) NULL,
  player_role VARCHAR(50) NOT NULL DEFAULT '',
  ip_role_id CHAR(36) NULL,
  team VARCHAR(30) NOT NULL DEFAULT '未分队',
  ready TINYINT(1) NOT NULL DEFAULT 0,
  online TINYINT(1) NOT NULL DEFAULT 1,
  score INT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_room_account(room_id,account_id),
  CONSTRAINT fk_member_room FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_user FOREIGN KEY(account_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_sessions (id CHAR(36) PRIMARY KEY,room_id CHAR(36) NOT NULL,game_id VARCHAR(30) NOT NULL,plan_item_id VARCHAR(80) NULL,state_json JSON NOT NULL,started_at DATETIME NOT NULL,ended_at DATETIME NULL,INDEX idx_session_plan_item(plan_item_id),CONSTRAINT fk_session_room FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS game_events (id CHAR(36) PRIMARY KEY,session_id CHAR(36) NOT NULL,actor_account_id CHAR(36) NULL,event_type VARCHAR(60) NOT NULL,visibility ENUM('public','private','public_after_settle') NOT NULL,payload_json JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX idx_event_session_time(session_id,created_at),CONSTRAINT fk_event_session FOREIGN KEY(session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,CONSTRAINT fk_event_actor FOREIGN KEY(actor_account_id) REFERENCES users(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS game_actions (id BIGINT AUTO_INCREMENT PRIMARY KEY,action_id VARCHAR(80) NOT NULL UNIQUE,room_id CHAR(36) NOT NULL,account_id CHAR(36) NOT NULL,game_id VARCHAR(30) NOT NULL,action VARCHAR(50) NOT NULL,payload_json JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX idx_action_room(room_id));
CREATE TABLE IF NOT EXISTS reviews (id CHAR(36) PRIMARY KEY,room_id CHAR(36) NOT NULL,action_owner_account_id CHAR(36) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',reviewer_account_id CHAR(36) NULL,decision VARCHAR(20) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS review_votes (id BIGINT AUTO_INCREMENT PRIMARY KEY,review_id CHAR(36) NOT NULL,voter_account_id CHAR(36) NOT NULL,vote VARCHAR(20) NOT NULL,UNIQUE KEY uniq_review_vote(review_id,voter_account_id));
CREATE TABLE IF NOT EXISTS generated_content (id CHAR(36) PRIMARY KEY,cache_key VARCHAR(255) NOT NULL UNIQUE,account_id CHAR(36) NULL,game_id VARCHAR(30) NOT NULL,content_json JSON NOT NULL,rules_version INT NOT NULL DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs (id CHAR(36) PRIMARY KEY,room_id CHAR(36) NOT NULL,actor_account_id CHAR(36) NOT NULL,event_type VARCHAR(40) NOT NULL,reason VARCHAR(255) NOT NULL,metadata_json JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX idx_audit_room(room_id));

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
