#!/bin/bash
set -e

# Display MOTD
cat /etc/motd

echo ""
echo "=============================================="
echo "  Bounty Challenge Container"
echo "=============================================="
echo ""

# Check if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    echo "[MODE] Server mode detected (DATABASE_URL set)"
    echo "[INFO] Starting bounty-server on ${CHALLENGE_HOST:-0.0.0.0}:${CHALLENGE_PORT:-8080}"
    echo ""
    
    exec /usr/local/bin/bounty-server
else
    echo "[MODE] Validator mode (no DATABASE_URL)"
    echo "[INFO] Starting health-only server for platform orchestration"
    echo "[INFO] Set DATABASE_URL to enable full server mode"
    echo ""
    
    # Start health-only server for validator mode
    exec /usr/local/bin/bounty-health-server
fi
