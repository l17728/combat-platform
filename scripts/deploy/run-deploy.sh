#!/usr/bin/env bash
# Server-side deploy runner. Executed detached (setsid) so it survives SSH drops.
# Output -> /opt/combat/deploy.log ; ends with the DEPLOY_DONE marker.
# The server's system Node is v24, but better-sqlite3@11 has no Node-24 build,
# so we install & run the app under a pinned Node 22 LTS (npmmirror = fast on Aliyun).
set +e
NODE_VER=v22.14.0
NODE_DIR=/opt/node22
NODE_TARBALL="node-${NODE_VER}-linux-x64"

echo "=== ensure Node 22 ($(date -u)) ==="
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  mkdir -p "${NODE_DIR}"
  curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VER}/${NODE_TARBALL}.tar.xz" -o /tmp/node22.tar.xz \
    && tar -xJf /tmp/node22.tar.xz -C "${NODE_DIR}" --strip-components=1 \
    && echo "node22 installed" || echo "NODE22 INSTALL FAILED"
fi
export PATH="${NODE_DIR}/bin:${PATH}"
echo "node: $(node -v 2>/dev/null)  npm: $(npm -v 2>/dev/null)"

cd /opt/combat || { echo "NO /opt/combat"; echo "DEPLOY_DONE FAIL"; exit 1; }
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1

echo "=== npm install ==="
npm install --no-audit --no-fund 2>&1 | tail -10
echo "=== verify better-sqlite3 ==="
node -e "require('better-sqlite3');console.log('better-sqlite3 OK')" 2>&1 || echo "better-sqlite3 FAIL"

pkill -f 'tsx src/server.ts' 2>/dev/null; pkill -f 'vite' 2>/dev/null; sleep 1

# PATH (with node22 first) is exported above; setsid children inherit it.
cd /opt/combat/apps/backend
setsid bash -c "npx tsx src/server.ts > /opt/combat/backend.log 2>&1" < /dev/null &
cd /opt/combat
setsid bash -c "npm run dev --workspace=@combat/frontend -- --host 0.0.0.0 --port 5173 > /opt/combat/frontend.log 2>&1" < /dev/null &

sleep 24
curl -s -o /dev/null -w "backend=%{http_code}\n" http://localhost:3001/api/schema/attackTicket 2>/dev/null || echo "backend=down"
curl -s -o /dev/null -w "frontend=%{http_code}\n" http://localhost:5173/ 2>/dev/null || echo "frontend=down"
echo "--- backend.log tail ---"; tail -8 /opt/combat/backend.log 2>/dev/null
echo "--- frontend.log tail ---"; tail -8 /opt/combat/frontend.log 2>/dev/null
echo "DEPLOY_DONE $(date -u)"
