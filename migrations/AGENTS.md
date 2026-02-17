# migrations/ — PostgreSQL Schema Migrations

## Overview

Sequential SQL migrations applied by `PgStorage::run_migrations()` in `src/pg_storage.rs`. Each migration file is numbered and applied in order. The `schema_migrations` table tracks which migrations have been applied.

## Migration Files

| File | Purpose |
|------|---------|
| `001_schema.sql` | Base schema (registrations, target_repos, resolved_issues, reward_snapshots, daily_stats, current_weights view) |
| `002_penalty.sql` | Penalty tracking for invalid issues |
| `003_github_issues.sql` | Cached GitHub issues table for sync |
| `004_stars.sql` | Star tracking (star_repos, stars tables) |
| `005_repo_multipliers.sql` | Repository weight multipliers |
| `006_project_tags.sql` | Project tagging system |
| `007_fix_weights.sql` | Weight calculation fixes |
| `008_cleanup.sql` | Data cleanup migration |
| `009_admin_bonus.sql` | Admin bonus points |
| `010_cleanup_false_invalids.sql` | Remove false invalid records |
| `011_fix_negative_weight.sql` | Fix negative weight edge case |
| `012_remove_weight_cap.sql` | Remove weight cap for proportional scoring |
| `013_duplicate_issues.sql` | Duplicate issue tracking |
| `014_dynamic_penalty.sql` | Dynamic penalty calculation |
| `015_fix_24h_consistency.sql` | Fix 24-hour window consistency |
| `016_unified_penalty.sql` | Unified penalty system |
| `017_duplicate_use_created_at.sql` | Use created_at for duplicate detection |
| `018_separate_penalties.sql` | Separate penalty logic for invalid vs duplicate |

## Key Tables

| Table | Purpose |
|-------|---------|
| `github_registrations` | 1:1 mapping of GitHub username ↔ hotkey |
| `resolved_issues` | Valid issues credited to miners |
| `invalid_issues` | Invalid issues for penalty tracking |
| `github_issues` | Cached issue data from GitHub sync |
| `target_repos` | Repositories monitored for issues |
| `star_repos` | Repositories monitored for stars |
| `stars` | Star records (username, repo) |
| `reward_snapshots` | Historical weight snapshots |
| `daily_stats` | Aggregated daily statistics |
| `schema_migrations` | Migration version tracking |

## Rules

1. **NEVER modify existing migration files** — they may have already been applied to production databases
2. **Always create a new numbered file** — use the next sequential number (e.g., `019_my_change.sql`)
3. **Use `IF NOT EXISTS` / `IF EXISTS`** — migrations must be idempotent where possible
4. **Use `ON CONFLICT DO NOTHING`** — for seed data inserts
5. **Test migrations locally** — run against a fresh PostgreSQL instance before committing
6. **Document the migration** — add a comment at the top explaining what it does and why
