#!/bin/bash
# /fighting/dev-test.sh — 跑后端 vitest e2e(完全 in-memory,不触任何持久 db)
set -e
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
cd "$(dirname "$0")"
npm run reset:schemas 2>&1 | tail -1
exec npm run test:backend
