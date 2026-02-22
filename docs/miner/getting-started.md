# Getting Started

This guide will help you set up and start earning rewards with Bounty Challenge.

## Prerequisites

- **Bittensor Wallet**: You need a miner hotkey with its secret key
- **GitHub Account**: Any GitHub account

## How It Works

Bounty Challenge runs as a WASM module inside the Platform Network validator runtime. You interact with it through the Platform bridge API — there is no separate server or CLI to install.

```
You (Miner) ──▶ Platform Bridge API ──▶ Validator WASM Runtime ──▶ bounty_challenge.wasm
```

## Quick Start

### 1. Register Your GitHub Account

Register your GitHub username with your Bittensor hotkey by sending a signed request to the Platform bridge:

```bash
curl -X POST https://chain.platform.network/api/v1/bridge/bounty-challenge/register \
  -H "Content-Type: application/json" \
  -d '{
    "hotkey": "YOUR_SS58_HOTKEY",
    "github_username": "YOUR_GITHUB_USERNAME",
    "signature": "0x...",
    "timestamp": 1705590000
  }'
```

The signature must be an sr25519 signature of the message:
```
register_github:{github_username_lowercase}:{timestamp}
```

See the [Registration Guide](registration.md) for detailed instructions and code examples.

### 2. Create Issues in bounty-challenge

> **IMPORTANT**: Issues must be submitted to this repository to receive rewards!

Go to the bounty-challenge repository:

- **PlatformNetwork/bounty-challenge**: https://github.com/PlatformNetwork/bounty-challenge/issues

Create quality issues (bug reports, feature requests, security issues, documentation improvements). Each valid issue earns you **1 point**.

### 3. Wait for Validation

Maintainers will review your issue:
- ✅ Valid issue → Closed with `valid` label → **+1 point**
- ❌ Invalid issue → Marked with `invalid` label → **penalty**
- ⏳ Closed without labels → No reward or penalty

### 4. Check Your Status

```bash
curl https://chain.platform.network/api/v1/bridge/bounty-challenge/status/YOUR_HOTKEY
```

### 5. View Leaderboard

```bash
curl https://chain.platform.network/api/v1/bridge/bounty-challenge/leaderboard
```

## Reward System

| Source | Points | Description |
|--------|--------|-------------|
| **Valid Issue** | 1 point | Issue closed with `valid` label |
| **Starred Repo** | 0.25 points | Each starred target repository |

Weight calculation: `net_points × 0.02` (normalized across all miners).

## Next Steps

- Read the [Registration Guide](registration.md) for detailed registration info
- Check the [Scoring Documentation](../reference/scoring.md) to understand rewards
- Review the [API Reference](../reference/api-reference.md) for programmatic access

## Common Issues

### Registration Failed

- Verify your secret key is correct
- Ensure the timestamp is within 5 minutes of current time
- Check that your GitHub username is valid

### Issues Not Counting

- Issues must be in the **PlatformNetwork/bounty-challenge** repository
- Issues must be closed with the `valid` label by a maintainer
- Your GitHub username must match the issue author
