-- Run against the application database before starting the updated server.
-- Re-running this migration preserves existing avatar colors.
SET @avatar_column_exists = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='user_profiles' AND column_name='avatar_color');
SET @avatar_ddl = IF(@avatar_column_exists=0,
  'ALTER TABLE user_profiles ADD COLUMN avatar_color CHAR(7) NULL', 'SELECT 1');
PREPARE avatar_statement FROM @avatar_ddl;
EXECUTE avatar_statement;
DEALLOCATE PREPARE avatar_statement;

SET @avatar_column_exists = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND table_name='user_ip_roles' AND column_name='avatar_color');
SET @avatar_ddl = IF(@avatar_column_exists=0,
  'ALTER TABLE user_ip_roles ADD COLUMN avatar_color CHAR(7) NULL', 'SELECT 1');
PREPARE avatar_statement FROM @avatar_ddl;
EXECUTE avatar_statement;
DEALLOCATE PREPARE avatar_statement;

