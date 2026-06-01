#!/bin/bash
# /fighting/dev-deploy.sh — 同机部署 /fighting → /opt/combat-v2 → systemctl restart
#
# 不依赖 SSH / .env.deploy / 密码,直接 rsync(本机 root 已有权限)。
#
# 用法:
#   ./dev-deploy.sh                    # 跑全套测试 → build → 备份 db → rsync → restart → verify
#   ./dev-deploy.sh --skip-test        # 跳过测试
#   ./dev-deploy.sh --skip-test --skip-build  # 仅 rsync + restart(改了 schema/config 的小改)
#   ./dev-deploy.sh --dry-run          # 看会做什么,不真做

set -e

export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

cd "$(dirname "$0")"

SKIP_TEST=0
SKIP_BUILD=0
DRY=""
for a in "$@"; do
  case $a in
    --skip-test)  SKIP_TEST=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --dry-run)    DRY="--dry-run -v" ;;
  esac
done

if [ -n "$(git status --porcelain | grep -vE 'dev-combat|node_modules|test-results|backups')" ]; then
  echo "⚠ 有未 commit 改动(下面),建议先 git commit 再 deploy 以便回滚:"
  git status --short | grep -vE 'dev-combat|node_modules|test-results|backups' | head -10
  echo ""
  read -p "继续 deploy? [y/N]: " yn
  [[ "$yn" =~ ^[YyJj] ]] || { echo "已取消"; exit 1; }
fi

if [ $SKIP_TEST -eq 0 ]; then
  echo "================================================================"
  echo "  1/5 跑后端测试(--skip-test 可跳过)"
  echo "================================================================"
  npm run reset:schemas 2>&1 | tail -1
  npm run test:backend 2>&1 | tail -5
fi

if [ $SKIP_BUILD -eq 0 ]; then
  echo ""
  echo "================================================================"
  echo "  2/5 build (shared dist + backend dist + frontend dist)"
  echo "================================================================"
  npm run build --workspace=@combat/shared 2>&1 | tail -2
  npm run build --workspace=@combat/backend 2>&1 | tail -3 || echo "(backend build 可能无 build script,跳过)"
  npm run build --workspace=@combat/frontend-v2 2>&1 | tail -3
fi

TS=$(date +%Y%m%d%H%M%S)
BACKUP="/opt/combat-v2/data/combat.sqlite.pre-deploy-$TS"
if [ -f /opt/combat-v2/data/combat.sqlite ]; then
  echo ""
  echo "================================================================"
  echo "  3/5 备份生产 db → $BACKUP"
  echo "================================================================"
  cp /opt/combat-v2/data/combat.sqlite "$BACKUP"
  ls -lh "$BACKUP"
fi

echo ""
echo "================================================================"
echo "  4/5 rsync /fighting → /opt/combat-v2 $DRY"
echo "================================================================"
rsync -a --delete $DRY \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='data/' \
  --exclude='backups/' \
  --exclude='test-results/' \
  --exclude='playwright-report/' \
  --exclude='.playwright-cache' \
  --exclude='dev-*.sh' \
  --exclude='dev-deploy.sh' \
  --exclude='DEV_README.md' \
  --exclude='*.log' \
  --exclude='2026-*-this-session*' \
  /fighting/ /opt/combat-v2/

if [ -n "$DRY" ]; then
  echo ""
  echo "(--dry-run: 未真执行 rsync, 未 restart)"
  exit 0
fi

echo ""
echo "================================================================"
echo "  5/5 prod npm install + systemctl restart combat-v2"
echo "================================================================"
cd /opt/combat-v2
npm install --no-audit --no-fund 2>&1 | tail -3

systemctl restart combat-v2
sleep 4
systemctl is-active combat-v2

echo ""
echo "================================================================"
echo "  Verify"
echo "================================================================"
curl -s -o /dev/null -w "  /api/health = HTTP %{http_code}\n" http://localhost:3001/api/health

echo ""
echo "✓ Deploy done — http://124.156.193.122:3001"
echo "  备份: $BACKUP (回滚: cp \$BACKUP /opt/combat-v2/data/combat.sqlite && systemctl restart combat-v2)"
