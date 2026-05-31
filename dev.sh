#!/bin/bash
# /fighting/dev.sh — 启动 dev backend(完全独立,不触生产 db)
set -e
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

cd "$(dirname "$0")"
mkdir -p data

export COMBAT_DB_PATH="/fighting/data/dev-combat.sqlite"
export PORT="${PORT:-3500}"
export NODE_ENV=development

echo "================================================================"
echo "  /fighting dev backend"
echo "  PORT  = $PORT       (生产在 :3001 不冲突)"
echo "  DB    = $COMBAT_DB_PATH"
echo "  PROD  = /opt/combat-v2/data/combat.sqlite (不动)"
echo "================================================================"
echo ""

exec npm run dev:backend
