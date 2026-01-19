-- Migration 007: Fix weight calculation
-- Weight = (valid_points - invalid_count) * 0.01, capped at 1.0 per user
-- Each valid issue = +multiplier points (cortex=5, vgrep=1, etc.)
-- Each invalid issue = -1 point

-- ============================================================================
-- UPDATE CURRENT WEIGHTS VIEW (correct formula with penalties)
-- ============================================================================
DROP VIEW IF EXISTS current_weights CASCADE;

CREATE OR REPLACE VIEW current_weights AS
WITH recent_valid AS (
    SELECT 
        r.github_username,
        r.hotkey,
        SUM(r.multiplier) as valid_points,
        COUNT(*) as issues_resolved_24h
    FROM resolved_issues r
    WHERE r.resolved_at >= NOW() - INTERVAL '24 hours'
      AND r.hotkey IS NOT NULL
    GROUP BY r.github_username, r.hotkey
),
recent_invalid AS (
    SELECT 
        i.github_username,
        i.hotkey,
        COUNT(*) as invalid_count
    FROM invalid_issues i
    WHERE i.recorded_at >= NOW() - INTERVAL '24 hours'
      AND i.hotkey IS NOT NULL
    GROUP BY i.github_username, i.hotkey
),
total_stats AS (
    SELECT 
        SUM(multiplier) as total_points_24h,
        COUNT(*) as total_issues_24h 
    FROM resolved_issues 
    WHERE resolved_at >= NOW() - INTERVAL '24 hours'
),
star_bonus AS (
    SELECT github_username, star_bonus
    FROM user_star_bonus
    WHERE star_bonus > 0
)
SELECT 
    COALESCE(v.github_username, inv.github_username) as github_username,
    COALESCE(v.hotkey, inv.hotkey) as hotkey,
    COALESCE(v.issues_resolved_24h, 0) as issues_resolved_24h,
    COALESCE(t.total_issues_24h, 0) as total_issues_24h,
    -- Weight = (valid_points - invalid_count) * 0.01, min 0, max 1.0
    -- Each invalid issue costs 1 point
    GREATEST(
        LEAST(
            (COALESCE(v.valid_points, 0) - COALESCE(inv.invalid_count, 0)) * 0.01 
            + COALESCE(sb.star_bonus, 0), 
            1.0
        ),
        0.0
    ) as weight,
    -- User is "penalized" if net points < 0
    (COALESCE(v.valid_points, 0) - COALESCE(inv.invalid_count, 0)) < 0 as is_penalized
FROM recent_valid v
FULL OUTER JOIN recent_invalid inv ON v.hotkey = inv.hotkey
CROSS JOIN total_stats t
LEFT JOIN star_bonus sb ON LOWER(COALESCE(v.github_username, inv.github_username)) = sb.github_username
WHERE COALESCE(v.hotkey, inv.hotkey) IS NOT NULL
ORDER BY weight DESC;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (7, 'fix_weights')
ON CONFLICT DO NOTHING;
