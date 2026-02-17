# src/ — Bounty Challenge Core Library & Server

## Overview

This directory contains the core Rust library and the `bounty-server` binary. The library (`lib.rs`) re-exports all public modules. The server (`main.rs`) starts the Axum HTTP server and spawns background sync tasks.

## Module Map

| File | Purpose | Key Types |
|------|---------|-----------|
| `lib.rs` | Library root — re-exports public API | — |
| `main.rs` | `bounty-server` binary entry point | — |
| `server.rs` | Axum router + all HTTP handlers | `AppState`, `create_router()`, `run_server()` |
| `challenge.rs` | Core challenge logic (evaluate, validate, config) | `BountyChallenge`, `ClaimSubmission`, `RegisterSubmission` |
| `pg_storage.rs` | PostgreSQL data access layer (~2300 lines) | `PgStorage`, `CurrentWeight`, `LeaderboardEntry` |
| `auth.rs` | SS58 hotkey validation + sr25519 signature verification | `verify_signature()`, `is_valid_ss58_hotkey()` |
| `github.rs` | GitHub REST API client (issues, stargazers, rate limits) | `GitHubClient`, `GitHubIssue`, `RateLimitInfo` |
| `gh_cli.rs` | `gh` CLI wrapper for reliable sync | `GhCli`, `GhIssue`, `sync_repo_with_gh()` |
| `github_oauth.rs` | GitHub Device Flow OAuth (CLI registration) | `GitHubDeviceAuth`, `DeviceCodeResponse` |
| `config.rs` | TOML config loader | `Config`, `RewardsConfig`, `GitHubConfig` |
| `metagraph.rs` | Bittensor metagraph hotkey cache | `MetagraphCache`, `MinerInfo` |

## Adding a New Endpoint

1. Define request/response structs in `server.rs` with `#[derive(Debug, Deserialize)]` / `#[derive(Debug, Serialize)]`
2. Write the handler function: `async fn my_handler(State(state): State<Arc<AppState>>, ...) -> Json<...>`
3. Add **two** routes in `create_router()`: `.route("/my_endpoint", get(my_handler))` and `.route("/api/v1/my_endpoint", get(my_handler))`
4. Update `docs/reference/api-reference.md`

## Adding a Storage Method

1. Add the method to `impl PgStorage` in `pg_storage.rs`
2. Use parameterized queries: `client.query("SELECT ... WHERE x = $1", &[&value]).await?`
3. Wrap with timeout: use the existing `DB_QUERY_TIMEOUT_SECS` constant pattern
4. If schema changes are needed, create a new migration in `migrations/`

## Key Constants

| Constant | File | Value | Meaning |
|----------|------|-------|---------|
| `MAX_POINTS_FOR_FULL_WEIGHT` | `pg_storage.rs` | 50.0 | Points for 100% weight |
| `WEIGHT_PER_POINT` | `pg_storage.rs` | 0.02 | Weight per point (2%) |
| `DB_POOL_MAX_SIZE` | `pg_storage.rs` | 20 | Max PostgreSQL connections |
| `DB_QUERY_TIMEOUT_SECS` | `pg_storage.rs` | 30 | Query timeout in seconds |
| `SYNC_INTERVAL_SECS` | `main.rs` | 300 | GitHub sync interval (5 min) |
| `RATE_LIMIT_THRESHOLD` | `github.rs` | 100 | GitHub API low-rate warning |

## Testing

- Unit tests live in `#[cfg(test)] mod tests` at the bottom of each file
- `auth.rs` has tests for SS58 validation and timestamp checking
- Run: `cargo test --workspace -- --skip live --skip integration`
- Tests requiring PostgreSQL or GitHub API are marked `live` or `integration`

## Conventions

- All async functions return `anyhow::Result<T>` or `Result<T, ChallengeError>`
- Shared state is `Arc<AppState>` containing `Arc<BountyChallenge>` and `Arc<PgStorage>`
- Logging uses `tracing` macros — never `println!` in library code
- GitHub tokens: `EXTRA_GITHUB_TOKEN` takes priority over `GITHUB_TOKEN`
