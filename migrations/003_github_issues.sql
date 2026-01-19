-- Migration 003: GitHub Issues Cache
-- Stores all issues for incremental sync and fast queries

-- ============================================================================
-- GITHUB ISSUES (persistent cache of all issues)
-- ============================================================================
CREATE TABLE IF NOT EXISTS github_issues (
    id SERIAL PRIMARY KEY,
    issue_id BIGINT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    github_username TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL,              -- 'open' | 'closed'
    labels TEXT[] DEFAULT '{}',       -- ['bug', 'valid', 'invalid']
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    issue_url TEXT NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(repo_owner, repo_name, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_state ON github_issues(state);
CREATE INDEX IF NOT EXISTS idx_issues_labels ON github_issues USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_issues_updated ON github_issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_username ON github_issues(LOWER(github_username));
CREATE INDEX IF NOT EXISTS idx_issues_repo ON github_issues(repo_owner, repo_name);

-- ============================================================================
-- GITHUB SYNC STATE (track last sync per repo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS github_sync_state (
    id SERIAL PRIMARY KEY,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_issue_updated_at TIMESTAMPTZ,
    issues_synced INTEGER DEFAULT 0,
    UNIQUE(repo_owner, repo_name)
);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Valid issues (closed with 'valid' label)
CREATE OR REPLACE VIEW valid_issues AS
SELECT * FROM github_issues 
WHERE state = 'closed' AND 'valid' = ANY(labels);

-- Invalid issues (closed with 'invalid' label)
CREATE OR REPLACE VIEW invalid_issues_view AS
SELECT * FROM github_issues 
WHERE state = 'closed' AND 'invalid' = ANY(labels);

-- Pending issues (closed without valid/invalid label)
CREATE OR REPLACE VIEW pending_issues AS
SELECT * FROM github_issues 
WHERE state = 'closed' 
  AND NOT ('valid' = ANY(labels))
  AND NOT ('invalid' = ANY(labels));

-- Open issues
CREATE OR REPLACE VIEW open_issues AS
SELECT * FROM github_issues WHERE state = 'open';

-- ============================================================================
-- SCHEMA MIGRATIONS
-- ============================================================================
INSERT INTO schema_migrations (version, name) VALUES (4, 'github_issues')
ON CONFLICT DO NOTHING;
