#!/usr/bin/env bash
# Target-server service starter for combat-v2.
# Registered as systemd service — keeps backend alive across reboots.
set -euo pipefail

export PATH="/opt/node22-v2/bin:${PATH}"
cd /opt/combat-v2/apps/backend
export COMBAT_API=http://localhost:3001

echo "=== combat-v2 backend starting $(date -u) ==="
echo "node: $(node -v)  cwd: $(pwd)"
echo "frontend dist: $(ls ../frontend-v2/dist/index.html 2>/dev/null && echo OK || echo MISSING)"

exec npx tsx src/server.ts
