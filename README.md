<div align="center">

# bουηtү chαllεηgε

**GitHub Issue Reward System for Cortex on Bittensor**

[![CI](https://github.com/PlatformNetwork/bounty-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/PlatformNetwork/bounty-challenge/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/PlatformNetwork/bounty-challenge)](https://github.com/PlatformNetwork/bounty-challenge/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/PlatformNetwork/bounty-challenge)](https://github.com/PlatformNetwork/bounty-challenge/stargazers)
[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org/)
[![Bittensor](https://img.shields.io/badge/bittensor-subnet-green.svg)](https://bittensor.com/)

![Bounty Challenge Banner](assets/banner.jpg)

</div>

Bounty Challenge is a decentralized issue reward system on the Bittensor network. Miners earn TAO rewards by discovering and reporting valid issues. Issues must be closed with the `valid` label by project maintainers to qualify for rewards.

> **IMPORTANT**: To receive rewards, you MUST submit issues in **this repository** ([PlatformNetwork/bounty-challenge](https://github.com/PlatformNetwork/bounty-challenge/issues)). Issues submitted directly to other repositories will **NOT** be counted for rewards.

## Quick Links

- [Getting Started](docs/miner/getting-started.md) - Installation and first registration
- [Registration Guide](docs/miner/registration.md) - Link your GitHub account
- [Scoring & Rewards](docs/reference/scoring.md) - Weight calculation formulas
- [API Reference](docs/reference/api-reference.md) - Endpoints and payloads
- [Validator Setup](docs/validator/setup.md) - Run a validator

## Features

- **Centralized Bug Bounty**: All issues tracked in this repository
- **Adaptive Rewards**: Dynamic weight calculation based on daily activity
- **Cryptographic Registration**: sr25519 signature-based hotkey linking
- **Real-Time Leaderboard**: Track miner standings and valid issues
- **PostgreSQL Backend**: Production-ready storage via Platform integration
- **GitHub Label Protection**: Automated label protection via GitHub Actions

## System Overview

### Core Components

```mermaid
flowchart LR
    Miner["🧑‍💻 Miner"] -->|"create issue"| GitHub["📋 GitHub Issues"]
    Validator["✅ Validator"] -->|"scan"| GitHub
    Validator -->|"submit weights"| Platform["🌐 Platform"]
```

### Registration Flow

```mermaid
flowchart LR
    A["1. Run CLI"] --> B["2. Enter key"] --> C["3. GitHub user"] --> D["4. Sign"] --> E["5. Verified"]
```

### Reward Flow

```mermaid
flowchart LR
    A["Create Issue"] --> B["Review"] --> C{Valid?}
    C -->|Yes| D["✅ Reward"]
    C -->|No| E["❌ No reward"]
```

## Reward System

Bounty Challenge uses a **point-based reward system**.

### Point System

Each resolved issue gives you points based on the repository:

| Repository | Points per Issue | Issues for 100% |
|------------|-----------------|-----------------|
| **CortexLM/cortex** | 5 points | 20 issues |
| **PlatformNetwork/term-challenge** | 1 point | 100 issues |
| **CortexLM/vgrep** | 1 point | 100 issues |

### Weight Calculation

Your weight is calculated from your total points:

$$W_{user} = \min\left(\frac{points}{100}, 1.0\right) + W_{stars}$$

Where:
- **100 points = 100% weight** (maximum)
- $W_{stars}$ = star bonus (see below)

**Examples:**

| Miner | Issues | Repository | Points | Weight |
|-------|--------|------------|--------|--------|
| A | 7 | cortex | 7 × 5 = 35 | 35% |
| B | 7 | vgrep | 7 × 1 = 7 | 7% |
| C | 20 | cortex | 20 × 5 = 100 | 100% |
| D | 100 | term-challenge | 100 × 1 = 100 | 100% |

See [Scoring Documentation](docs/reference/scoring.md) for complete specifications.

### Penalty System

> **WARNING**: Invalid issues (closed without `valid` label) count against you!

| Rule | Description |
|------|-------------|
| **Ratio 1:1** | 1 invalid issue allowed per valid issue |
| **Penalty** | If `invalid > valid`, weight = 0 |
| **Recovery** | Submit valid issues to return balance >= 0 |

**Formula:**
```
balance = valid_issues - invalid_issues
weight = balance >= 0 ? normal_weight : 0
```

**Example:** (assuming cortex issues = 5 points each)

| Miner | Valid | Invalid | Balance | Points | Weight |
|-------|-------|---------|---------|--------|--------|
| A | 5 | 3 | +2 | 25 pts | 25% |
| B | 3 | 5 | -2 | - | 0% (penalized) |

### Star Bonus

Earn extra credits by starring our repositories!

| Requirement | Bonus |
|-------------|-------|
| **Minimum** | 2 valid issues resolved |
| **Bonus** | +0.25 weight per starred repo |
| **Maximum** | +1.25 (5 repos × 0.25) |

**Repositories to star:**

| Repository | URL |
|------------|-----|
| CortexLM/vgrep | https://github.com/CortexLM/vgrep |
| CortexLM/cortex | https://github.com/CortexLM/cortex |
| PlatformNetwork/platform | https://github.com/PlatformNetwork/platform |
| PlatformNetwork/term-challenge | https://github.com/PlatformNetwork/term-challenge |
| PlatformNetwork/bounty-challenge | https://github.com/PlatformNetwork/bounty-challenge |

**Example:**
- Miner with 5 valid issues + 3 starred repos = base weight + 0.75 bonus
- Miner with 1 valid issue + 5 starred repos = base weight only (need 2+ valid issues first)

## Target Repositories

Analyze these projects to find bugs, security issues, and improvements:

| Repository | Description | Points | For 100% Weight | URL |
|------------|-------------|--------|-----------------|-----|
| **CortexLM/cortex** | Cortex CLI and core | **5 points** | 20 issues | https://github.com/CortexLM/cortex |
| **PlatformNetwork/term-challenge** | Terminal Bench Challenge | **1 point** | 100 issues | https://github.com/PlatformNetwork/term-challenge |
| **CortexLM/vgrep** | Visual grep tool | **1 point** | 100 issues | https://github.com/CortexLM/vgrep |

> **Note:** 100 points = 100% weight. A valid issue in cortex gives 5x more points than vgrep/term-challenge!

> **Important:** Analyze the repositories above for bugs, then submit your issue reports to **this repository** ([PlatformNetwork/bounty-challenge](https://github.com/PlatformNetwork/bounty-challenge/issues)) to receive rewards.

## Quick Start for Miners

### Prerequisites

- **Bittensor Wallet** (miner hotkey with secret key)
- **GitHub Account** 
- **Rust** 1.70+ (to build the CLI)

### Installation

```bash
# Clone and build
git clone https://github.com/PlatformNetwork/bounty-challenge.git
cd bounty-challenge
cargo build --release

# Add to PATH
export PATH="$PWD/target/release:$PATH"

# Verify installation
bounty --version
```

### Register Your GitHub Account

Run the interactive registration wizard:

```bash
bounty
```

Or explicitly:

```bash
bounty wizard
```

The wizard will:
1. Ask for your miner **secret key** (64-char hex or 12+ word mnemonic)
2. Derive your **hotkey** (SS58 format)
3. Ask for your **GitHub username**
4. Sign the registration with sr25519
5. Submit to the platform

### Create Valid Issues

> **WARNING**: Issues must be created in **this repository** to be eligible for rewards!

Go to the bounty-challenge repository and create issues:

| Repository | URL |
|------------|-----|
| **PlatformNetwork/bounty-challenge** | https://github.com/PlatformNetwork/bounty-challenge/issues |

You can report issues about any target project (see Target Repositories above) but they must be submitted HERE to count for rewards.

Valid issue types:

| Type | Description |
|------|-------------|
| **Bug Reports** | Reproduction steps, expected vs actual behavior |
| **Security Issues** | Vulnerabilities (follow responsible disclosure) |
| **Feature Requests** | Use cases and proposed solutions |
| **Documentation** | Gaps, errors, or improvements |

### Wait for Validation

Maintainers will review your issue:
- ✅ **Valid**: Closed with `valid` label → Reward auto-credited
- ❌ **Invalid**: Closed without label → No reward

**Note:** Only maintainers can add/remove the `valid` label. This is enforced via GitHub Actions.

### Check Your Status

```bash
bounty status --hotkey YOUR_HOTKEY
```

### View Leaderboard

```bash
bounty leaderboard
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `bounty` | Interactive registration wizard (default) |
| `bounty wizard` | Same as above |
| `bounty status -h <hotkey>` | Check your status and rewards |
| `bounty leaderboard` | View current standings |
| `bounty config` | Show challenge configuration |
| `bounty server` | Run in server mode (subnet operators) |
| `bounty validate` | Run as validator (auto-scan) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATFORM_URL` | `https://chain.platform.network` | Platform server URL |
| `DATABASE_URL` | - | PostgreSQL connection (server mode) |
| `GITHUB_TOKEN` | - | GitHub API token (increases rate limits) |
| `MINER_HOTKEY` | - | Your miner hotkey (SS58) |

## Where to Submit Issues

> **IMPORTANT**: All issues must be submitted to this repository to receive rewards.

| Repository | URL | Status |
|------------|-----|--------|
| **PlatformNetwork/bounty-challenge** | https://github.com/PlatformNetwork/bounty-challenge/issues | ✅ Rewards eligible |
| Other repositories | - | ❌ Not counted |

Report bugs, security issues, or feature requests about any target project in the bounty-challenge repo.

## Anti-Abuse Mechanisms

| Mechanism | Description |
|-----------|-------------|
| **Valid Label Required** | Only issues closed with `valid` label count |
| **Signature Verification** | sr25519 signature proves hotkey ownership |
| **Author Verification** | GitHub username must match issue author |
| **First Reporter Wins** | Each issue can only be claimed once |
| **Adaptive Weights** | High activity reduces per-issue reward |
| **Maintainer Gatekeeping** | Only project members can validate issues |
| **Label Protection** | GitHub Actions prevent unauthorized label changes |

## API Reference

### Bridge API Endpoints

All requests go through the platform bridge:

```
https://chain.platform.network/api/v1/bridge/bounty-challenge/
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/register` | POST | Register GitHub username with hotkey |
| `/status/{hotkey}` | GET | Get miner status and rewards |
| `/leaderboard` | GET | Get current standings |
| `/stats` | GET | Get challenge statistics |

### Direct Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/config` | GET | Challenge configuration |
| `/get_weights` | GET | Calculate current weights |

See [API Reference](docs/reference/api-reference.md) for complete documentation.

## Project Structure

```
bounty-challenge/
├── src/
│   ├── main.rs              # Server entry point
│   ├── lib.rs               # Library exports
│   ├── challenge.rs         # Challenge implementation
│   ├── github.rs            # GitHub API client
│   ├── pg_storage.rs        # PostgreSQL storage
│   ├── storage.rs           # SQLite storage (CLI)
│   ├── server.rs            # HTTP server & routes
│   ├── discovery.rs         # Auto-scan for valid issues
│   └── bin/bounty/          # CLI application
│       ├── main.rs          # CLI entry point
│       ├── client.rs        # Bridge API client
│       ├── wizard/          # Registration wizard
│       └── commands/        # CLI commands
├── migrations/
│   ├── 001_initial.sql      # SQLite schema
│   └── 002_rewards_schema.sql # PostgreSQL schema
├── docs/
│   ├── miner/               # Miner guides
│   ├── reference/           # API references
│   └── validator/           # Validator guides
├── .github/workflows/
│   └── protect-valid-label.yml # Label protection
├── config.toml              # Configuration
└── assets/
    └── banner.jpg           # Banner image
```

## Documentation

- **For Miners:**
  - [Getting Started](docs/miner/getting-started.md)
  - [Registration Guide](docs/miner/registration.md)

- **For Validators:**
  - [Setup Guide](docs/validator/setup.md)

- **Reference:**
  - [Scoring & Rewards](docs/reference/scoring.md)
  - [API Reference](docs/reference/api-reference.md)

## Development

### Building

```bash
# Debug build
cargo build

# Release build
cargo build --release

# Run tests
cargo test

# Run with logging
RUST_LOG=info cargo run
```

### Code Quality

```bash
# Format code
cargo fmt

# Run linter
cargo clippy

# Check without building
cargo check
```

## Platform Integration

When deployed as a Platform challenge module:

```mermaid
flowchart LR
    subgraph Miners
        Miner["🧑‍💻 Miner<br/>(CLI/wizard)"]
    end
    
    subgraph Platform["Platform Server<br/>chain.platform.network"]
        API["API Gateway"]
        DB[("PostgreSQL")]
        Bounty["Bounty Challenge<br/>(container)"]
        
        API --> DB
        Bounty --> DB
    end
    
    Miner -->|"register/status"| API
    API -->|"route"| Bounty
```

## Acknowledgments

- [Cortex Foundation](https://github.com/CortexLM) for the Cortex ecosystem
- [Platform Network](https://github.com/PlatformNetwork) for the challenge SDK
- [Bittensor](https://bittensor.com/) for the decentralized AI network

## License

Apache-2.0
