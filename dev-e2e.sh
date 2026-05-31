#!/bin/bash
# /fighting/dev-e2e.sh — 跑 Playwright e2e
# 注意:playwright.config.ts 默认 webServer auto-start backend+frontend
# 跑前确保 :3500 和 :5174 都空闲
set -e
export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

cd "$(dirname "$0")/apps/frontend-v2"
# 默认装 playwright browser(首次)
if [ ! -d "/root/.cache/ms-playwright" ]; then
  echo "首次跑,装 playwright browser..."
  npx playwright install chromium
fi
exec npx playwright test --config=playwright.config.ts --reporter=line "$@"
