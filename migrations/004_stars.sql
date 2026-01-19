-- Migration 004: Star Bonus System
-- Gives 0.25 score per star on target repos (requires >= 2 resolved issues)

-- ============================================================================
-- GITHUB STARS (track which users starred which repos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS github_stars (
    id SERIAL PRIMARY KEY,
    github_username TEXT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    starred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(github_username, repo_owner, repo_name)
);

CREATE INDEX IF NOT EXISTS idx_stars_username ON github_stars(LOWER(github_username));
CREATE INDEX IF NOT EXISTS idx_stars_repo ON github_stars(repo_owner, repo_name);

-- ============================================================================
-- STAR TARGET REPOS (repos to watch for stars)
-- ============================================================================
CREATE TABLE IF NOT EXISTS star_target_repos (
    id SERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    UNIQUE(owner, repo)
);

-- Insert target repos for star tracking
INSERT INTO star_target_repos (owner, repo) VALUES 
    ('CortexLM', 'vgrep'),
    ('CortexLM', 'cortex'),
    ('PlatformNetwork', 'platform'),
    ('PlatformNetwork', 'term-challenge'),
    ('PlatformNetwork', 'bounty-challenge')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STAR BONUS VIEW (calculate star bonus per user)
-- ============================================================================
CREATE OR REPLACE VIEW user_star_bonus AS
WITH user_resolved_count AS (
    SELECT 
        LOWER(github_username) as github_username,
        COUNT(*) as resolved_count
    FROM resolved_issues
    GROUP BY LOWER(github_username)
),
user_star_count AS (
    SELECT 
        LOWER(github_username) as github_username,
        COUNT(*) as star_count
    FROM github_stars
    GROUP BY LOWER(github_username)
)
SELECT 
    COALESCE(r.github_username, s.github_username) as github_username,
    COALESCE(r.resolved_count, 0) as resolved_count,
    COALESCE(s.star_count, 0) as star_count,
    CASE 
        WHEN COALESCE(r.resolved_count, 0) >= 2 THEN COALESCE(s.star_count, 0) * 0.25
        ELSE 0
    END as star_bonus
FROM user_resolved_count r
FULL OUTER JOIN user_star_count s ON r.github_username = s.github_username;

-- ============================================================================
-- UPDATE CURRENT WEIGHTS VIEW (add star bonus)
-- ============================================================================
CREATE OR REPLACE VIEW current_weights AS
WITH recent_issues AS (
    SELECT 
        github_username,
        hotkey,
        COUNT(*) as issues_resolved_24h
    FROM resolved_issues
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
      AND hotkey IS NOT NULL
    GROUP BY github_username, hotkey
),
total_stats AS (
    SELECT COUNT(*) as total_issues_24h 
    FROM resolved_issues 
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
),
star_bonus AS (
    SELECT github_username, star_bonus
    FROM user_star_bonus
    WHERE star_bonus > 0
)
SELECT 
    r.github_username,
    r.hotkey,
    r.issues_resolved_24h::INTEGER,
    t.total_issues_24h::INTEGER,
    -- Base weight + star bonus (0.25 per star if >= 2 resolved issues)
    LEAST(
        r.issues_resolved_24h * 
        CASE 
            WHEN t.total_issues_24h > 100 THEN 0.01 * (100.0 / t.total_issues_24h)
            ELSE 0.01
        END,
        LEAST(t.total_issues_24h / 250.0, 1.0)
    ) + COALESCE(sb.star_bonus, 0) as weight,
    false as is_penalized
FROM recent_issues r
CROSS JOIN total_stats t
LEFT JOIN star_bonus sb ON LOWER(r.github_username) = sb.github_username
ORDER BY weight DESC;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (4, 'stars_bonus')
ON CONFLICT DO NOTHING;
