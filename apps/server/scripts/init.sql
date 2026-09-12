-- 入戏局 MySQL 初始化脚本
-- 在远端服务器执行：mysql -u root -pxumin999 < init.sql

CREATE DATABASE IF NOT EXISTS cosworks DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cosworks;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  account VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户资料表（MBTI 等）
CREATE TABLE IF NOT EXISTS user_profiles (
  account_id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(80) NOT NULL,
  mbti VARCHAR(8) NULL,
  mbti_completed_at DATETIME NULL,
  CONSTRAINT fk_profile_user FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户 IP 角色表
CREATE TABLE IF NOT EXISTS user_ip_roles (
  id CHAR(36) PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  ip_theme VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  persona_tags JSON NULL,
  quote TEXT NULL,
  signature_action VARCHAR(255) NULL,
  ability VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_account_ip (account_id, ip_theme, name),
  CONSTRAINT fk_role_user FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 房间表
CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  ip_theme VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  owner_account_id CHAR(36) NOT NULL,
  state_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_room_code (code),
  CONSTRAINT fk_room_owner FOREIGN KEY (owner_account_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 房间成员表
CREATE TABLE IF NOT EXISTS room_members (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  is_owner TINYINT(1) NOT NULL DEFAULT 0,
  host_role VARCHAR(20) NULL,
  player_role VARCHAR(80) NOT NULL DEFAULT '',
  ip_role_id CHAR(36) NULL,
  team VARCHAR(30) NOT NULL DEFAULT '未分队',
  ready TINYINT(1) NOT NULL DEFAULT 0,
  online TINYINT(1) NOT NULL DEFAULT 0,
  score INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_member_room_account (room_id, account_id),
  CONSTRAINT fk_member_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_account FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 游戏场次表
CREATE TABLE IF NOT EXISTS game_sessions (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  game_id VARCHAR(30) NOT NULL,
  plan_item_id VARCHAR(80) NULL,
  state_json JSON NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  INDEX idx_session_room_time (room_id, started_at),
  INDEX idx_session_plan_item (plan_item_id),
  CONSTRAINT fk_session_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 游戏事件表（ensureTimelineSchema 会自动创建，此处兜底）
CREATE TABLE IF NOT EXISTS game_events (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  actor_account_id CHAR(36) NULL,
  event_type VARCHAR(60) NOT NULL,
  visibility ENUM('public','private','public_after_settle') NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_session_time (session_id, created_at),
  CONSTRAINT fk_event_session FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_actor FOREIGN KEY (actor_account_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI 生成内容缓存表
CREATE TABLE IF NOT EXISTS generated_content (
  id CHAR(36) PRIMARY KEY,
  cache_key VARCHAR(255) NOT NULL UNIQUE,
  account_id CHAR(36) NULL,
  game_id VARCHAR(30) NOT NULL,
  content_json JSON NOT NULL,
  rules_version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_generated_prefix (cache_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 游戏动作去重表
CREATE TABLE IF NOT EXISTS game_actions (
  action_id CHAR(80) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  game_id VARCHAR(30) NOT NULL,
  action VARCHAR(60) NOT NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action_room_account (room_id, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  actor_account_id CHAR(36) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  reason TEXT NOT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_room_time (room_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 资源表（图片等，ensureTimelineSchema 会自动补齐字段，此处兜底）
CREATE TABLE IF NOT EXISTS assets (
  id CHAR(36) PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  room_id CHAR(36) NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size BIGINT UNSIGNED NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  thumb_size BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data_url MEDIUMTEXT NULL,
  image_path VARCHAR(512) NULL,
  thumb_path VARCHAR(512) NULL,
  used_in_session_id CHAR(36) NULL,
  used_at DATETIME(3) NULL,
  INDEX idx_asset_account (account_id),
  INDEX idx_asset_room (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
