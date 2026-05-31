#!/bin/bash
# /fighting/dev-with-snapshot.sh — 从生产 db 拷副本,再起 dev backend(副本可读写,不影响生产)
set -e
PROD_DB="/opt/combat-v2/data/combat.sqlite"
DEV_DB="/fighting/data/dev-combat.sqlite"

mkdir -p /fighting/data
if [ -f "$PROD_DB" ]; then
  echo "复制生产 db 快照 → $DEV_DB ..."
  cp -f "$PROD_DB" "$DEV_DB"
  ls -lh "$DEV_DB"
  echo "✓ 副本就绪(后续 dev backend 写副本,生产 db 不受影响)"
  echo ""
else
  echo "⚠ 生产 db $PROD_DB 不存在,将启动空 db dev backend"
fi

exec "$(dirname "$0")/dev.sh"
