# Bounty Challenge - Agent Guide

## Project Purpose

Bounty Challenge is a decentralized issue reward system on the Bittensor network. Miners earn TAO rewards by discovering and reporting valid GitHub issues in the `PlatformNetwork/bounty-challenge` repository. Validators sync issues from GitHub, verify validity (closed + `valid` label), and submit on-chain weights proportional to each miner's contribution.

## Architecture Overview

```
bounty-challenge/
├── src/
│   ├── main.rs              # bounty-server binary: HTTP server + background sync tasks
│   ├── lib.rs               # Library re-exports for all modules
│   ├── server.rs            # Axum HTTP routes (health, register, evaluate, leaderboard, etc.)
│   ├── challenge.rs         # Core challenge logic: evaluate claims, validate submissions
│   ├── pg_storage.rs        # PostgreSQL data layer (deadpool-postgres connection pool)
│   ├── auth.rs              # SS58/sr25519 signature verification (sp-core)
│   ├── github.rs            # GitHub REST API client (reqwest-based)
│   ├── gh_cli.rs            # GitHub CLI (`gh`) wrapper for reliable issue sync
│   ├── github_oauth.rs      # GitHub Device Flow OAuth for CLI registration
│   ├── config.rs            # TOML config loader (config.toml)
│   ├── metagraph.rs         # Bittensor metagraph cache (hotkey verification)
│   └── bin/
│       ├── bounty/          # CLI application (bounty binary)
│       │   ├── main.rs      # CLI entry point (clap-based)
│       │   ├── client.rs    # Bridge API client (routes through platform-server)
│       │   ├── style.rs     # Terminal ANSI styling utilities
│       │   ├── wizard/      # Interactive registration wizard
│       │   └── commands/    # CLI subcommands (server, validate, leaderboard, status, config, info)
│       └── bounty-health-server.rs  # Minimal health-only server for validator mode
├── migrations/              # PostgreSQL migrations (001-018), applied sequentially
├── config.toml              # Default configuration (github repos, server, rewards)
├── Dockerfile               # Multi-stage build with cargo-chef (rust:1.92.0 → debian:12-slim)
├── docker/                  # Docker entrypoint and MOTD
├── docs/                    # User-facing documentation (miner, validator, API, scoring)
└── examples/                # Shell scripts and test utilities
```

### Data Flow

1. **Registration**: Miner signs `register_github:<username>:<timestamp>` with sr25519 key → POST `/register`
2. **Issue Sync**: Background task runs every 5 min, uses `gh` CLI (preferred) or GitHub REST API to fetch all issues
3. **Validation**: Issues closed with `valid` label are credited; issues with `invalid`/`duplicate` labels incur penalties
4. **Weight Calculation**: `points × 0.02` where points = valid_issues + (0.25 × starred_repos) − penalties
5. **Platform Integration**: GET `/get_weights` returns normalized weights for on-chain submission

### Binaries

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `bounty-server` | `src/main.rs` | Full HTTP server with background sync |
| `bounty` | `src/bin/bounty/main.rs` | CLI tool for miners |
| `bounty-health-server` | `src/bin/bounty-health-server.rs` | Minimal health endpoint for validators |

## Tech Stack

- **Language**: Rust (edition 2021, MSRV implied by `sp-core` v31)
- **Async Runtime**: Tokio (full features)
- **HTTP Server**: Axum 0.7 + Tower-HTTP (CORS)
- **HTTP Client**: Reqwest 0.12 (JSON feature)
- **Database**: PostgreSQL via `tokio-postgres` 0.7 + `deadpool-postgres` 0.14
- **Cryptography**: `sp-core` 31.0 (sr25519 signatures, SS58 encoding)
- **CLI**: Clap 4.5 (derive), Dialoguer 0.11, Indicatif 0.17
- **Serialization**: Serde + serde_json, TOML
- **Logging**: Tracing + tracing-subscriber (env-filter)
- **Error Handling**: anyhow 1.0 + thiserror 2.0
- **Platform SDK**: `platform-challenge-sdk` and `platform-core` from PlatformNetwork/platform.git
- **Container**: Docker multi-stage with cargo-chef, Debian 12 slim runtime
- **CI**: GitHub Actions (rust-toolchain, rust-cache, cargo-nextest, cargo-llvm-cov)

## CRITICAL RULES

1. **Never use bare `unwrap()` in production code.** Use `unwrap_or_else`, `?` operator, or `anyhow::Result`. The only exception is test code (`#[cfg(test)]`). Bare `unwrap()` in `src/` (non-test) will cause CI failure via clippy.

2. **All SQL queries MUST use parameterized statements.** Never interpolate user input into SQL strings. Use `$1, $2, ...` placeholders with `tokio-postgres` query parameters. See `src/pg_storage.rs` for the pattern.

3. **All user-facing endpoints MUST validate timestamps within 5-minute window.** Registration, sync triggers, and invalid issue reports require `timestamp <= now && (now - timestamp) < 300`. Future timestamps are rejected to prevent replay attacks. See `src/auth.rs::is_timestamp_valid()`.

4. **All signature verification MUST use sr25519 via `sp_core`.** Hotkeys are SS58-encoded sr25519 public keys. Signatures are 64-byte hex (with optional `0x` prefix). Never accept other key types. See `src/auth.rs::verify_signature()`.

5. **Clippy must pass with these exact flags**: `cargo clippy --all-targets --workspace -- -W clippy::all -D warnings -A clippy::too_many_arguments -A clippy::type_complexity -A clippy::large_enum_variant -A clippy::should_implement_trait`. Do NOT add new `-A` allowances without justification.

6. **Database pool is capped at 20 connections with 30s query timeout.** See constants `DB_POOL_MAX_SIZE` and `DB_QUERY_TIMEOUT_SECS` in `src/pg_storage.rs`. Never increase pool size without load testing. All DB operations are async.

7. **GitHub username ↔ hotkey mapping is 1:1 and immutable.** Each GitHub username maps to exactly one hotkey and vice versa. Re-registration with a different pair is rejected. This is enforced in `register_handler()` in `src/server.rs`.

8. **Weight normalization must sum to exactly 1.0.** The `get_weights_handler` in `src/server.rs` normalizes all weights so they sum to 1.0 before returning. Penalized users (is_penalized=true) and zero-weight users are excluded from weights.

9. **Migrations are append-only.** Never modify existing migration files in `migrations/`. Always create a new numbered migration file (e.g., `019_*.sql`). Migrations are applied sequentially by `PgStorage::run_migrations()`.

10. **Environment variables override config.toml.** `DATABASE_URL`, `GITHUB_TOKEN`/`EXTRA_GITHUB_TOKEN`, `GITHUB_CLIENT_ID`, `CHALLENGE_HOST`, `CHALLENGE_PORT`, and `PLATFORM_URL` take precedence over `config.toml` values.

## DO / DON'T

### DO
- Use `tracing::{info, warn, error, debug}` for all logging (never `println!` in library code)
- Use `Result<T, anyhow::Error>` for fallible functions in binaries; `thiserror` for library error types
- Add `#[cfg(test)] mod tests` in the same file for unit tests
- Skip `live` and `integration` tests in local/CI runs: `cargo test -- --skip live --skip integration`
- Use `Arc<PgStorage>` and `Arc<BountyChallenge>` for shared state across async tasks
- Follow existing patterns in `src/server.rs` when adding new endpoints: define request/response structs with Serialize/Deserialize, add route in `create_router()`
- Run `cargo fmt --all` before committing

### DON'T
- Don't add new dependencies without checking if existing ones cover the use case
- Don't use `std::sync::Mutex` — use `parking_lot::RwLock` or `tokio::sync::Mutex` for async contexts
- Don't hardcode secrets, repository names, or API URLs — use config.toml or environment variables
- Don't modify the `platform-challenge-sdk` or `platform-core` dependency revisions without coordinating with the platform team
- Don't create endpoints without both direct (`/endpoint`) and bridge (`/api/v1/endpoint`) routes
- Don't use `CorsLayer::permissive()` on new services — it's intentional here because this is a public API
- Don't write migrations that drop tables or columns in production — use soft deletes

## Build & Test Commands

```bash
# Format
cargo fmt --all              # Auto-format all code
cargo fmt --check            # Check formatting (CI mode)

# Lint
cargo clippy --all-targets --workspace -- -W clippy::all -D warnings \
  -A clippy::too_many_arguments \
  -A clippy::type_complexity \
  -A clippy::large_enum_variant \
  -A clippy::should_implement_trait

# Test (skip tests requiring live services)
cargo test --workspace -- --skip live --skip integration

# Test with coverage (CI main branch)
cargo llvm-cov nextest --workspace --json --output-path coverage.json \
  -E 'not (test(/live/) | test(/integration/))'

# Build
cargo build                  # Debug build
cargo build --release        # Release build

# Docker
docker build -t bounty-challenge .

# Run server locally (requires PostgreSQL)
DATABASE_URL=postgres://user:pass@localhost/bounty cargo run --bin bounty-server

# Run CLI
cargo run --bin bounty -- --help
cargo run --bin bounty -- wizard
cargo run --bin bounty -- leaderboard
```

## Git Hooks

Located in `.githooks/` — activated via `git config core.hooksPath .githooks`.

| Hook | What It Does |
|------|-------------|
| `pre-commit` | Runs `cargo fmt --all` and stages formatted files. Skippable with `SKIP_GIT_HOOKS=1`. |
| `pre-push` | Full quality gate: `cargo fmt --check` → `cargo check --all-targets` → `cargo clippy` (with project flags) → `cargo test` (skipping live/integration). Skippable with `SKIP_GIT_HOOKS=1`. |

To install: `bash .githooks/install.sh` or `git config core.hooksPath .githooks`

To bypass: `SKIP_GIT_HOOKS=1 git commit ...` or `git commit --no-verify`

## Key Configuration

### config.toml
- `[github]` — OAuth client ID, target repositories
- `[server]` — Host/port bindings (default 0.0.0.0:8080)
- `[rewards]` — `max_points_for_full_weight=50`, `weight_per_point=0.02`, `valid_label="valid"`

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (server) | PostgreSQL connection string |
| `GITHUB_TOKEN` / `EXTRA_GITHUB_TOKEN` | Recommended | GitHub API auth (higher rate limits) |
| `GITHUB_CLIENT_ID` | For OAuth | GitHub OAuth App client ID |
| `PLATFORM_URL` | For CLI | Platform RPC endpoint |
| `CHALLENGE_HOST` | No | Server bind host (default: 0.0.0.0) |
| `CHALLENGE_PORT` | No | Server bind port (default: 8080) |

## Database

PostgreSQL with 18 sequential migrations in `migrations/`. Key tables:
- `github_registrations` — hotkey ↔ GitHub username (1:1)
- `resolved_issues` — valid issues credited to miners
- `invalid_issues` — invalid issues for penalty tracking
- `github_issues` — cached issue data from GitHub sync
- `target_repos` — repositories monitored for issues
- `star_repos` / `stars` — star tracking for bonus points
- `schema_migrations` — migration version tracking
