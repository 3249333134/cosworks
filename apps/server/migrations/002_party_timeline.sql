SET @add_plan_item = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='game_sessions' AND column_name='plan_item_id'),
  'SELECT 1',
  'ALTER TABLE game_sessions ADD COLUMN plan_item_id VARCHAR(80) NULL AFTER game_id'
);
PREPARE timeline_statement FROM @add_plan_item;
EXECUTE timeline_statement;
DEALLOCATE PREPARE timeline_statement;

SET @add_plan_index = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='game_sessions' AND index_name='idx_session_plan_item'),
  'SELECT 1',
  'CREATE INDEX idx_session_plan_item ON game_sessions(plan_item_id)'
);
PREPARE timeline_statement FROM @add_plan_index;
EXECUTE timeline_statement;
DEALLOCATE PREPARE timeline_statement;

CREATE TABLE IF NOT EXISTS game_events (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  actor_account_id CHAR(36) NULL,
  event_type VARCHAR(60) NOT NULL,
  visibility ENUM('public','private','public_after_settle') NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_session_time(session_id,created_at),
  CONSTRAINT fk_event_session FOREIGN KEY(session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_actor FOREIGN KEY(actor_account_id) REFERENCES users(id) ON DELETE SET NULL
);
