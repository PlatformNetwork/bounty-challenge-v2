-- Migration 007: Fix weight calculation
-- Each point = 0.01 weight
-- Each invalid issue = -1 point
-- SUM of all weights must not exceed 1.0
-- If total >= 1.0, normalize so that sum = 1.0

-- ============================================================================
-- UPDATE CURRENT WEIGHTS VIEW (correct formula with normalization)
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
user_net_points AS (
    SELECT 
        COALESCE(v.github_username, inv.github_username) as github_username,
        COALESCE(v.hotkey, inv.hotkey) as hotkey,
        COALESCE(v.issues_resolved_24h, 0) as issues_resolved_24h,
        GREATEST(COALESCE(v.valid_points, 0) - COALESCE(inv.invalid_count, 0), 0) as net_points
    FROM recent_valid v
    FULL OUTER JOIN recent_invalid inv ON v.hotkey = inv.hotkey
    WHERE COALESCE(v.hotkey, inv.hotkey) IS NOT NULL
),
global_stats AS (
    SELECT 
        SUM(net_points) as total_net_points,
        COUNT(*) as total_users
    FROM user_net_points
),
star_bonus AS (
    SELECT github_username, star_bonus
    FROM user_star_bonus
    WHERE star_bonus > 0
)
SELECT 
    u.github_username,
    u.hotkey,
    u.issues_resolved_24h,
    COALESCE(g.total_users, 0)::int as total_issues_24h,
    -- If total_net_points >= 100, normalize so sum = 1.0
    -- Otherwise, weight = net_points * 0.01 (sum < 1.0, rest goes to burn)
    CASE 
        WHEN COALESCE(g.total_net_points, 0) >= 100 THEN
            u.net_points::float / NULLIF(g.total_net_points, 0)::float + COALESCE(sb.star_bonus, 0)
        ELSE
            u.net_points * 0.01 + COALESCE(sb.star_bonus, 0)
    END as weight,
    u.net_points <= 0 as is_penalized
FROM user_net_points u
CROSS JOIN global_stats g
LEFT JOIN star_bonus sb ON LOWER(u.github_username) = sb.github_username
ORDER BY weight DESC;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (7, 'fix_weights')
ON CONFLICT DO NOTHING;
