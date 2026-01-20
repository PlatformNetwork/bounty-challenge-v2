-- Migration 008: Add deleted_at column for stale issue cleanup
-- Issues that no longer exist on GitHub will be marked with deleted_at timestamp

-- Add deleted_at column to github_issues
ALTER TABLE github_issues ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_issues_deleted ON github_issues(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issues_synced ON github_issues(synced_at);

-- Update views to exclude deleted issues

-- Valid issues (exclude deleted)
DROP VIEW IF EXISTS valid_issues CASCADE;
CREATE OR REPLACE VIEW valid_issues AS
SELECT * FROM github_issues 
WHERE 'valid' = ANY(labels) AND deleted_at IS NULL;

-- Invalid issues view (exclude deleted)
DROP VIEW IF EXISTS invalid_issues_view CASCADE;
CREATE OR REPLACE VIEW invalid_issues_view AS
SELECT * FROM github_issues 
WHERE state = 'closed' AND 'invalid' = ANY(labels) AND deleted_at IS NULL;

-- Pending issues (exclude deleted)
DROP VIEW IF EXISTS pending_issues CASCADE;
CREATE OR REPLACE VIEW pending_issues AS
SELECT * FROM github_issues 
WHERE state = 'closed' 
  AND NOT ('valid' = ANY(labels))
  AND NOT ('invalid' = ANY(labels))
  AND deleted_at IS NULL;

-- Open issues (exclude deleted)
DROP VIEW IF EXISTS open_issues CASCADE;
CREATE OR REPLACE VIEW open_issues AS
SELECT * FROM github_issues WHERE state = 'open' AND deleted_at IS NULL;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (8, 'cleanup')
ON CONFLICT DO NOTHING;
