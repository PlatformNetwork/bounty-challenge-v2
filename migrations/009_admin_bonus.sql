-- Migration 009: Admin Bonus System
-- Allows admins to grant temporary bonuses (valid for 24h)

-- ============================================================================
-- ADMIN BONUSES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_bonuses (
    id SERIAL PRIMARY KEY,
    hotkey TEXT NOT NULL,
    github_username TEXT,
    bonus_weight REAL NOT NULL CHECK (bonus_weight > 0 AND bonus_weight <= 1.0),
    reason TEXT,
    granted_by TEXT NOT NULL,  -- Admin who granted the bonus
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_bonuses_hotkey ON admin_bonuses(hotkey);
CREATE INDEX IF NOT EXISTS idx_admin_bonuses_active ON admin_bonuses(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_admin_bonuses_expires ON admin_bonuses(expires_at);

-- ============================================================================
-- VIEW: Active bonuses (not expired and active)
-- ============================================================================
CREATE OR REPLACE VIEW active_admin_bonuses AS
SELECT 
    id,
    hotkey,
    github_username,
    bonus_weight,
    reason,
    granted_by,
    granted_at,
    expires_at,
    EXTRACT(EPOCH FROM (expires_at - NOW())) / 3600 as hours_remaining
FROM admin_bonuses
WHERE active = true 
  AND expires_at > NOW();

-- ============================================================================
-- UPDATE CURRENT WEIGHTS VIEW (include admin bonus)
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
),
admin_bonus AS (
    SELECT 
        hotkey,
        SUM(bonus_weight) as total_admin_bonus
    FROM admin_bonuses
    WHERE active = true AND expires_at > NOW()
    GROUP BY hotkey
)
SELECT 
    u.github_username,
    u.hotkey,
    u.issues_resolved_24h,
    COALESCE(g.total_users, 0)::int as total_issues_24h,
    -- Base weight + star bonus + admin bonus
    LEAST(
        CASE 
            WHEN COALESCE(g.total_net_points, 0) >= 100 THEN
                u.net_points::float / NULLIF(g.total_net_points, 0)::float
            ELSE
                u.net_points * 0.01
        END 
        + COALESCE(sb.star_bonus, 0)
        + COALESCE(ab.total_admin_bonus, 0),
        2.0  -- Cap total weight at 2.0 (including all bonuses)
    ) as weight,
    u.net_points <= 0 as is_penalized
FROM user_net_points u
CROSS JOIN global_stats g
LEFT JOIN star_bonus sb ON LOWER(u.github_username) = sb.github_username
LEFT JOIN admin_bonus ab ON u.hotkey = ab.hotkey
ORDER BY weight DESC;

-- ============================================================================
-- SCHEMA MIGRATION RECORD
-- ============================================================================
INSERT INTO schema_migrations (version, name) VALUES (9, 'admin_bonus')
ON CONFLICT DO NOTHING;
