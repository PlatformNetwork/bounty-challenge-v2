# Registration Guide

This guide explains how to register your GitHub account with your miner hotkey.

## Overview

Registration links your GitHub username to your Bittensor hotkey. This allows the system to:
1. Verify that issues you create belong to you
2. Credit rewards to your hotkey
3. Prevent impersonation

## Registration via Platform Bridge API

Send a signed POST request to the registration endpoint:

```
POST https://chain.platform.network/api/v1/bridge/bounty-challenge/register
```

### Request Body

```json
{
  "hotkey": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "github_username": "johndoe",
  "signature": "0x...",
  "timestamp": 1705590000
}
```

### Signature Message Format

```
register_github:{github_username_lowercase}:{timestamp}
```

The signature must be an **sr25519** signature using the secret key corresponding to your hotkey.

## Code Examples

### Python

```python
import requests
import time
from substrateinterface import Keypair

# Create keypair from seed
keypair = Keypair.create_from_mnemonic("your mnemonic here")

# Prepare registration
timestamp = int(time.time())
message = f"register_github:johndoe:{timestamp}"
signature = keypair.sign(message.encode()).hex()

# Register
response = requests.post(
    "https://chain.platform.network/api/v1/bridge/bounty-challenge/register",
    json={
        "hotkey": keypair.ss58_address,
        "github_username": "johndoe",
        "signature": f"0x{signature}",
        "timestamp": timestamp
    }
)

print(response.json())
```

### JavaScript

```javascript
const { Keyring } = require('@polkadot/keyring');
const { u8aToHex } = require('@polkadot/util');

async function register(mnemonic, githubUsername) {
    const keyring = new Keyring({ type: 'sr25519' });
    const pair = keyring.addFromMnemonic(mnemonic);
    
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `register_github:${githubUsername.toLowerCase()}:${timestamp}`;
    const signature = pair.sign(message);
    
    const response = await fetch(
        'https://chain.platform.network/api/v1/bridge/bounty-challenge/register',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hotkey: pair.address,
                github_username: githubUsername,
                signature: u8aToHex(signature),
                timestamp: timestamp
            })
        }
    );
    
    console.log(await response.json());
}
```

## Secret Key Formats

The following key formats are supported by standard Substrate libraries:

### 64-Character Hex Seed

```
a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd
```

This is a 32-byte seed encoded as hexadecimal.

### 12+ Word Mnemonic

```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
```

Standard BIP-39 mnemonic phrase.

### SURI Format (Testing Only)

```
//Alice
//Bob
```

Substrate URI format, useful for testing with well-known keys.

## Signature Verification

### How It Works

1. **Message Creation**: `register_github:{username}:{timestamp}`
2. **Signing**: sr25519 signature using your secret key
3. **Verification**: The Platform bridge verifies the signature matches the claimed hotkey

### Security

- **Timestamp**: Must be within 5 minutes (prevents replay attacks)
- **Username**: Lowercase for consistency
- **One-to-one mapping**: Each hotkey maps to one GitHub username, and vice versa

## Changing Registration

### Change GitHub Username

To link a different GitHub username:
1. Send a new registration request with the same hotkey
2. Enter the new GitHub username
3. The old link is replaced

### Change Hotkey

To link your GitHub to a different hotkey:
1. Contact support (username can only link to one hotkey)
2. Or create a new GitHub account

## Troubleshooting

### "Invalid signature" Error

- **Cause**: Signature doesn't match the claimed hotkey
- **Fix**: Ensure you're using the correct secret key

### "Timestamp expired" Error

- **Cause**: Request took too long or system clock is wrong
- **Fix**: Check your system clock and try again

### "Username already registered" Error

- **Cause**: This GitHub username is linked to another hotkey
- **Fix**: Use a different GitHub account or contact support

### "Hotkey already registered" Error

- **Cause**: This hotkey is linked to another GitHub username
- **Fix**: Send a new registration request to update the linked username
