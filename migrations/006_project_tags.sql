-- Migration 006: Tag-based project multiplier system
-- All issues are in bounty-challenge repo, tags identify the target project

-- ============================================================================
-- PROJECT TAGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_tags (
    tag TEXT PRIMARY KEY,
    multiplier REAL NOT NULL DEFAULT 1.0,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert project tags with multipliers
INSERT INTO project_tags (tag, multiplier, description) VALUES
    ('cortex', 1.0, 'CortexLM/cortex - Cortex CLI and core'),
    ('vgrep', 0.25, 'CortexLM/vgrep - Visual grep tool'),
    ('term-challenge', 0.5, 'PlatformNetwork/term-challenge'),
    ('bounty-challenge', 0.5, 'PlatformNetwork/bounty-challenge')
ON CONFLICT (tag) DO UPDATE SET 
    multiplier = EXCLUDED.multiplier,
    description = EXCLUDED.description;

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (6, 'project_tags')
ON CONFLICT DO NOTHING;
