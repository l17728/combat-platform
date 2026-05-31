#!/bin/bash
# /fighting/dev-frontend.sh — 启 vite dev :5174,proxy /api → dev backend :3500
set -e
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

cd "$(dirname "$0")/apps/frontend-v2"

# vite.config.ts 默认 proxy 到 3001,通过 env 切到 3500
export VITE_API_TARGET="${VITE_API_TARGET:-http://localhost:3500}"
export PORT="${PORT:-5174}"

echo "================================================================"
echo "  /fighting dev frontend(vite)"
echo "  PORT  = $PORT"
echo "  API   = $VITE_API_TARGET (确保 dev backend 已起!)"
echo "================================================================"
echo ""

exec npx vite --port $PORT --host 0.0.0.0
