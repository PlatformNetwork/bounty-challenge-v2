# src/bin/bounty/ — Bounty CLI Application

## Overview

The `bounty` binary is a Clap-based CLI tool for miners to interact with the Bounty Challenge system. It provides interactive registration, status checking, leaderboard viewing, and server/validator modes.

## File Map

| File | Purpose |
|------|---------|
| `main.rs` | CLI entry point — defines `Cli` struct and `Commands` enum via Clap derive |
| `client.rs` | HTTP client for the Bridge API (`/api/v1/bridge/bounty-challenge/...`) |
| `style.rs` | ANSI terminal styling helpers (`style_cyan`, `print_success`, `print_error`, etc.) |
| `wizard/mod.rs` | Registration wizard module |
| `wizard/register_wizard.rs` | Interactive flow: GitHub OAuth → sr25519 signing → registration |
| `commands/mod.rs` | Command module re-exports |
| `commands/server.rs` | `bounty server` — starts the full HTTP server |
| `commands/validate.rs` | `bounty validate` — validator mode |
| `commands/leaderboard.rs` | `bounty leaderboard` — display current standings |
| `commands/status.rs` | `bounty status` — check miner status by hotkey |
| `commands/config.rs` | `bounty config` — show challenge configuration |
| `commands/info.rs` | `bounty info` — system information for bug reports |

## CLI Commands

```
bounty                    # Default: runs registration wizard
bounty wizard             # Interactive registration (aliases: w, register, r)
bounty server             # Run HTTP server (aliases: s)
bounty validate           # Run as validator (aliases: v)
bounty leaderboard        # View leaderboard (aliases: lb)
bounty status -k <hotkey> # Check miner status (aliases: st)
bounty config             # Show configuration
bounty info               # System info (aliases: i)
```

## Adding a New CLI Command

1. Add a variant to the `Commands` enum in `main.rs` with `#[command(...)]` attributes
2. Create `commands/<name>.rs` with `pub async fn run(...) -> anyhow::Result<()>`
3. Add `pub mod <name>;` to `commands/mod.rs`
4. Add the match arm in `main()` to dispatch to your handler
5. Use `style.rs` helpers for consistent terminal output

## Key Dependencies

- `clap` 4.5 with derive feature for CLI parsing
- `dialoguer` 0.11 for interactive prompts (password input, confirmations)
- `indicatif` 0.17 for progress bars/spinners
- `colored` 2.1 / `console` 0.15 for terminal colors
- `reqwest` for HTTP calls to the platform bridge API

## Environment Variables

| Variable | Used By | Default |
|----------|---------|---------|
| `PLATFORM_URL` | `--rpc` flag | `https://chain.platform.network` |
| `MINER_HOTKEY` | `status --hotkey` | — |
| `VALIDATOR_HOTKEY` | `validate --hotkey` | — |
| `CHALLENGE_HOST` | `server --host` | `0.0.0.0` |
| `CHALLENGE_PORT` | `server --port` | `8080` |
| `DATABASE_URL` | `server --database-url` | — |

## Conventions

- All command handlers return `anyhow::Result<()>`
- Use `print_success()`, `print_error()`, `print_warning()` from `style.rs`
- The wizard is the default command when no subcommand is specified
- Bridge API client (`client.rs`) routes through platform-server with 30s timeout
