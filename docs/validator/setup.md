# Validator Setup Guide

This guide explains how to run a Bounty Challenge validator using the WASM module.

## Overview

Bounty Challenge runs as a WASM module inside the Platform Network validator runtime. Validators:
1. **Load the WASM module**: The compiled `.wasm` binary is loaded by the validator runtime
2. **Provide host storage**: Key/value storage is provided via host functions
3. **Route HTTP requests**: The validator bridges HTTP requests to the WASM module's `handle_route()` function
4. **Submit weights**: The validator calls `get_weights()` to obtain weight assignments for on-chain submission

## Prerequisites

- **Platform Validator**: A running [Platform Network](https://github.com/PlatformNetwork/platform-v2) validator node
- **Bittensor Wallet**: Validator hotkey registered on the subnet
- **WASM Module**: The compiled `bounty_challenge.wasm` binary

## Building the WASM Module

```bash
# Clone repository
git clone https://github.com/PlatformNetwork/bounty-challenge.git
cd bounty-challenge

# Install WASM target (one-time)
rustup target add wasm32-unknown-unknown

# Build release
cargo build --release --target wasm32-unknown-unknown

# Output: target/wasm32-unknown-unknown/release/bounty_challenge.wasm
```

## Deploying the Module

### 1. Copy the WASM Binary

Copy the compiled module to your Platform validator's challenge directory:

```bash
cp target/wasm32-unknown-unknown/release/bounty_challenge.wasm \
   /path/to/platform-validator/challenges/
```

### 2. Configure the Validator

Add the bounty challenge to your Platform validator configuration. Refer to the [Platform Network documentation](https://github.com/PlatformNetwork/platform-v2) for details on loading WASM challenge modules.

### 3. Verify Loading

Once the validator starts, it will:
1. Load `bounty_challenge.wasm` into the WASM runtime
2. Call `name()` → returns `"bounty-challenge"`
3. Call `version()` → returns `"2.0.0"`
4. Register the module's HTTP routes via `routes()`

## Architecture

```
┌──────────────────────────────────────────────┐
│              Platform Validator               │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐   │
│  │ WASM Runtime  │───▶│ bounty_challenge  │   │
│  │              │    │     .wasm         │   │
│  └──────┬───────┘    └───────────────────┘   │
│         │                                    │
│  ┌──────▼───────┐                            │
│  │ Host Storage  │  (key/value pairs)        │
│  └──────────────┘                            │
│                                              │
│  ┌──────────────┐                            │
│  │ HTTP Bridge   │  (routes requests to WASM)│
│  └──────────────┘                            │
└──────────────────────────────────────────────┘
```

### Host Functions

The WASM module communicates with the validator via host functions:

| Function | Purpose |
|----------|---------|
| `host_storage_get(key)` | Read a value from persistent storage |
| `host_storage_set(key, value)` | Write a value to persistent storage |
| `host_consensus_get_epoch()` | Get the current consensus epoch |
| `host_consensus_get_submission_count()` | Get total submission count |

### Storage Keys

The module uses these key patterns in host storage:

| Key Pattern | Description |
|-------------|-------------|
| `user:<hotkey>` | User registration data |
| `github:<username>` | GitHub username → hotkey mapping |
| `issue:<owner>/<repo>:<number>` | Claimed issue records |
| `balance:<hotkey>` | User balance (valid/invalid counts) |
| `leaderboard` | Serialized leaderboard entries |
| `registered_hotkeys` | List of all registered hotkeys |
| `synced_issues` | Consensus-agreed issue data |
| `timeout_config` | Timeout configuration |

## Consensus

Validators participate in consensus for:

### Issue Sync Consensus
Multiple validators propose synced issue data via `/sync/propose`. When a majority agrees, the data is stored.

### Issue Validity Consensus
Validators propose issue validity via `/issue/propose`. Majority vote determines if an issue is valid or invalid.

## API Routes

The WASM module exposes these routes through the validator's HTTP bridge:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leaderboard` | No | Current standings |
| GET | `/stats` | No | Challenge statistics |
| GET | `/status/:hotkey` | No | Hotkey status and balance |
| POST | `/register` | Yes | Register GitHub username with hotkey |
| POST | `/claim` | Yes | Claim bounty for resolved issues |
| GET | `/issues` | No | List all synced issues |
| GET | `/issues/pending` | No | List pending issues |
| GET | `/hotkey/:hotkey` | No | Detailed hotkey information |
| POST | `/invalid` | Yes | Record an invalid issue |
| POST | `/sync/propose` | Yes | Propose synced issue data |
| GET | `/sync/consensus` | No | Check sync consensus status |
| POST | `/issue/propose` | Yes | Propose issue validity |
| POST | `/issue/consensus` | No | Check issue validity consensus |
| GET | `/config/timeout` | No | Get timeout configuration |
| POST | `/config/timeout` | Yes | Update timeout configuration |
| GET | `/get_weights` | No | Normalized weight assignments |

All routes are accessed via the Platform bridge:
```
https://chain.platform.network/api/v1/bridge/bounty-challenge/<path>
```

## Monitoring

### Check Module Status

Query the stats endpoint through the bridge:

```bash
curl https://chain.platform.network/api/v1/bridge/bounty-challenge/stats
```

### Check Leaderboard

```bash
curl https://chain.platform.network/api/v1/bridge/bounty-challenge/leaderboard
```

### Check Weights

```bash
curl https://chain.platform.network/api/v1/bridge/bounty-challenge/get_weights
```

## Troubleshooting

### Module fails to load

- **Cause**: WASM binary not found or incompatible
- **Fix**: Rebuild with `cargo build --release --target wasm32-unknown-unknown` and verify the `.wasm` file exists

### No issues appearing

- **Cause**: No validators have proposed sync data yet
- **Fix**: Ensure validators are submitting issue data via `/sync/propose`

### Consensus not reached

- **Cause**: Not enough validators have proposed matching data
- **Fix**: Wait for more validators to submit proposals; majority agreement is required

## Security

### WASM Sandbox

The module runs in a sandboxed WASM environment:
- No direct filesystem access
- No direct network access
- All I/O goes through host functions
- Memory is isolated per module

### Authentication

Routes marked as `requires_auth: true` require the request to include a valid `auth_hotkey` verified by the Platform validator bridge.
