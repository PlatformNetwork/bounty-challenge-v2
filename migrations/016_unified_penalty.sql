-- Migration 016: Unified Penalty Formula
--
-- Changes penalty calculation from:
--   invalid_penalty = max(0, invalid - valid)
--   duplicate_penalty = duplicate × 0.5
--   net_points = valid + stars - invalid_penalty - duplicate_penalty
--
-- To unified formula:
--   total_bad = invalid_count + duplicate_count
--   penalty = max(0, total_bad - valid_count)
--   net_points = valid + stars - penalty
--
-- This allows users with many valid issues to "absorb" some invalid/duplicate
-- issues without being penalized.

-- ============================================================================
-- DROP AND RECREATE USER_BALANCE VIEW
-- ============================================================================
DROP VIEW IF EXISTS user_balance CASCADE;

CREATE OR REPLACE VIEW user_balance AS
WITH valid_counts_24h AS (
    SELECT
        hotkey,
        github_username,
        COUNT(*) as valid_count
    FROM resolved_issues
    WHERE hotkey IS NOT NULL
      AND resolved_at >= NOW() - INTERVAL '24 hours'
    GROUP BY hotkey, github_username
),
invalid_counts_24h AS (
    SELECT
        hotkey,
        github_username,
        COUNT(*) as invalid_count
    FROM invalid_issues
    WHERE hotkey IS NOT NULL
      AND recorded_at >= NOW() - INTERVAL '24 hours'
    GROUP BY hotkey, github_username
),
duplicate_counts_24h AS (
    SELECT
        hotkey,
        github_username,
        COUNT(*) as duplicate_count
    FROM duplicate_issues
    WHERE hotkey IS NOT NULL
      AND recorded_at >= NOW() - INTERVAL '24 hours'
    GROUP BY hotkey, github_username
)
SELECT
    COALESCE(v.hotkey, i.hotkey, d.hotkey) as hotkey,
    COALESCE(v.github_username, i.github_username, d.github_username) as github_username,
    COALESCE(v.valid_count, 0) as valid_count,
    COALESCE(i.invalid_count, 0) as invalid_count,
    COALESCE(d.duplicate_count, 0) as duplicate_count,
    -- Unified penalty: max(0, (invalid + duplicate) - valid)
    COALESCE(v.valid_count, 0) - GREATEST(0, (COALESCE(i.invalid_count, 0) + COALESCE(d.duplicate_count, 0)) - COALESCE(v.valid_count, 0)) as balance,
    CASE
        WHEN COALESCE(v.valid_count, 0) - GREATEST(0, (COALESCE(i.invalid_count, 0) + COALESCE(d.duplicate_count, 0)) - COALESCE(v.valid_count, 0)) < 0 THEN true
        ELSE false
    END as is_penalized
FROM valid_counts_24h v
FULL OUTER JOIN invalid_counts_24h i ON v.hotkey = i.hotkey
FULL OUTER JOIN duplicate_counts_24h d ON COALESCE(v.hotkey, i.hotkey) = d.hotkey;

-- ============================================================================
-- DROP AND RECREATE CURRENT_WEIGHTS VIEW
-- ============================================================================
DROP VIEW IF EXISTS current_weights CASCADE;

CREATE OR REPLACE VIEW current_weights AS
WITH recent_valid AS (
    SELECT
        github_username,
        hotkey,
        COUNT(*) as issues_resolved_24h,
        COUNT(*) as valid_count
    FROM resolved_issues
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
      AND hotkey IS NOT NULL
    GROUP BY github_username, hotkey
),
recent_invalid AS (
    SELECT
        hotkey,
        COUNT(*) as invalid_count
    FROM invalid_issues
    WHERE recorded_at >= NOW() - INTERVAL '24 hours'
      AND hotkey IS NOT NULL
    GROUP BY hotkey
),
recent_duplicate AS (
    SELECT
        hotkey,
        COUNT(*) as duplicate_count
    FROM duplicate_issues
    WHERE recorded_at >= NOW() - INTERVAL '24 hours'
      AND hotkey IS NOT NULL
    GROUP BY hotkey
),
user_stars AS (
    SELECT
        LOWER(github_username) as github_username,
        COUNT(*) * 0.25 as star_points
    FROM github_stars
    GROUP BY LOWER(github_username)
),
total_stats AS (
    SELECT COUNT(*) as total_issues_24h
    FROM resolved_issues
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
),
admin_bonus AS (
    SELECT
        hotkey,
        SUM(bonus_weight) as total_admin_bonus
    FROM admin_bonuses
    WHERE active = true AND expires_at > NOW()
    GROUP BY hotkey
),
user_net_points AS (
    SELECT
        v.github_username,
        v.hotkey,
        v.issues_resolved_24h,
        v.valid_count,
        COALESCE(i.invalid_count, 0) as invalid_count,
        COALESCE(d.duplicate_count, 0) as duplicate_count,
        COALESCE(s.star_points, 0) as star_points,
        -- Unified penalty: max(0, (invalid + duplicate) - valid)
        GREATEST(0, (COALESCE(i.invalid_count, 0) + COALESCE(d.duplicate_count, 0)) - v.valid_count) as penalty,
        -- Net points = valid + stars - penalty
        v.valid_count + COALESCE(s.star_points, 0)
            - GREATEST(0, (COALESCE(i.invalid_count, 0) + COALESCE(d.duplicate_count, 0)) - v.valid_count) as net_points
    FROM recent_valid v
    LEFT JOIN recent_invalid i ON v.hotkey = i.hotkey
    LEFT JOIN recent_duplicate d ON v.hotkey = d.hotkey
    LEFT JOIN user_stars s ON LOWER(v.github_username) = s.github_username
)
SELECT
    u.github_username,
    u.hotkey,
    u.issues_resolved_24h,
    COALESCE(t.total_issues_24h, 0) as total_issues_24h,
    CASE
        WHEN u.net_points <= 0 THEN GREATEST(0, COALESCE(ab.total_admin_bonus, 0))
        ELSE u.net_points * 0.02 + COALESCE(ab.total_admin_bonus, 0)
    END as weight,
    u.net_points <= 0 as is_penalized
FROM user_net_points u
CROSS JOIN total_stats t
LEFT JOIN admin_bonus ab ON u.hotkey = ab.hotkey
ORDER BY weight DESC;

-- ============================================================================
-- RECORD MIGRATION
-- ============================================================================
INSERT INTO schema_migrations (version, name) VALUES (16, 'unified_penalty')
ON CONFLICT DO NOTHING;
