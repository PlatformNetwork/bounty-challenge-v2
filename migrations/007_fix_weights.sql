-- Migration 007: Fix weight calculation
-- Weight = (SUM of multipliers in 24h) * 0.01, capped at 1.0 per user
-- Penalized users (invalid > valid) get 0 weight

-- ============================================================================
-- UPDATE CURRENT WEIGHTS VIEW (correct formula)
-- ============================================================================
DROP VIEW IF EXISTS current_weights CASCADE;

CREATE OR REPLACE VIEW current_weights AS
WITH recent_issues AS (
    SELECT 
        r.github_username,
        r.hotkey,
        SUM(r.multiplier) as total_points,
        COUNT(*) as issues_resolved_24h
    FROM resolved_issues r
    WHERE r.resolved_at >= NOW() - INTERVAL '24 hours'
      AND r.hotkey IS NOT NULL
    GROUP BY r.github_username, r.hotkey
),
total_stats AS (
    SELECT 
        SUM(multiplier) as total_points_24h,
        COUNT(*) as total_issues_24h 
    FROM resolved_issues 
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
),
penalty_status AS (
    SELECT hotkey, is_penalized, valid_count, invalid_count
    FROM user_balance
),
star_bonus AS (
    SELECT github_username, star_bonus
    FROM user_star_bonus
    WHERE star_bonus > 0
)
SELECT 
    r.github_username,
    r.hotkey,
    r.issues_resolved_24h,
    COALESCE(t.total_issues_24h, 0) as total_issues_24h,
    -- Weight = points * 0.01, capped at 1.0 per user
    -- If penalized (invalid > valid), weight = 0
    CASE 
        WHEN COALESCE(p.is_penalized, false) = true THEN 0.0
        ELSE LEAST(r.total_points * 0.01 + COALESCE(sb.star_bonus, 0), 1.0)
    END as weight,
    COALESCE(p.is_penalized, false) as is_penalized
FROM recent_issues r
CROSS JOIN total_stats t
LEFT JOIN penalty_status p ON r.hotkey = p.hotkey
LEFT JOIN star_bonus sb ON LOWER(r.github_username) = sb.github_username
ORDER BY weight DESC;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (7, 'fix_weights')
ON CONFLICT DO NOTHING;
