#!/usr/bin/env bash
# Target-server runner for combat-v2 backend + frontend.
set +e

NODE_VER=v22.14.0
NODE_DIR=/opt/node22-v2
NODE_TARBALL="node-${NODE_VER}-linux-x64"

echo "=== ensure Node 22 ($(date -u)) ==="
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  mkdir -p "${NODE_DIR}"
  curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VER}/${NODE_TARBALL}.tar.xz" -o /tmp/node22-v2.tar.xz \
    && tar -xJf /tmp/node22-v2.tar.xz -C "${NODE_DIR}" --strip-components=1 \
    && echo "node22 installed" || echo "NODE22 INSTALL FAILED"
fi
export PATH="${NODE_DIR}/bin:${PATH}"
echo "node: $(node -v 2>/dev/null)  npm: $(npm -v 2>/dev/null)"

cd /opt/combat-v2 || { echo "NO /opt/combat-v2"; echo "DEPLOY_DONE FAIL"; exit 1; }
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1

echo "=== npm install ==="
npm install --no-audit --no-fund 2>&1 | tail -10
echo "=== verify better-sqlite3 ==="
node -e "require('better-sqlite3');console.log('better-sqlite3 OK')" 2>&1 || echo "better-sqlite3 FAIL"

echo "=== build frontend-v2 ==="
cd /opt/combat-v2/apps/frontend-v2
npm run build 2>&1 | tail -5
echo "frontend dist:"
ls -la dist/ 2>/dev/null || echo "NO DIST"

echo "=== install serve (static file server) ==="
npm install -g serve 2>&1 | tail -3

pkill -f 'tsx src/server.ts' 2>/dev/null
pkill -f 'serve.*combat-v2' 2>/dev/null
sleep 1

echo "=== start backend ==="
cd /opt/combat-v2/apps/backend
export COMBAT_API=http://localhost:3001
setsid bash -c "npx tsx src/server.ts > /opt/combat-v2/backend.log 2>&1" < /dev/null &
cd /opt/combat-v2

echo "=== start frontend (serve :80) ==="
setsid bash -c "npx serve -s /opt/combat-v2/apps/frontend-v2/dist -l 80 > /opt/combat-v2/frontend.log 2>&1" < /dev/null &

sleep 10
curl -s -o /dev/null -w "backend=%{http_code}\n" http://localhost:3001/api/schema/attackTicket 2>/dev/null || echo "backend=down"
curl -s -o /dev/null -w "frontend=%{http_code}\n" http://localhost:80/ 2>/dev/null || echo "frontend=down"
echo "--- backend.log tail ---"
tail -5 /opt/combat-v2/backend.log 2>/dev/null
echo "--- frontend.log tail ---"
tail -5 /opt/combat-v2/frontend.log 2>/dev/null
echo "DEPLOY_DONE $(date -u)"
