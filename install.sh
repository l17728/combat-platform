#!/bin/bash
# combat-platform 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/l17728/combat-platform/saas/install.sh | bash
#   或: wget -qO- https://raw.githubusercontent.com/l17728/combat-platform/saas/install.sh | bash
#   或: ./install.sh [版本号]  (本地运行)
#
# 环境要求: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
#           root 权限
set -e

VERSION="${1:-v3.3.1}"
INSTALL_DIR="${COMBAT_HOME:-/opt/combat-v2}"
NODE_MAJOR=22
REPO="l17728/combat-platform"
BRANCH="saas"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 0. 前置检查 ──────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || error "请使用 root 用户运行此脚本"

info "Combat Platform ${VERSION} 一键安装"
info "安装目录: ${INSTALL_DIR}"
echo ""

# ── 1. 安装 Node.js 22 ─────────────────────────────────────
install_node() {
  if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1)" = "v${NODE_MAJOR}" ]; then
    info "Node.js $(node -v) 已安装"
    return
  fi
  info "安装 Node.js ${NODE_MAJOR}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1 || yum install -y nodejs >/dev/null 2>&1
  info "Node.js $(node -v) 安装完成"
}

# ── 2. 下载源码 ─────────────────────────────────────────────
download_source() {
  info "下载源码 ${VERSION}..."
  
  if command -v git &>/dev/null; then
    if [ -d "${INSTALL_DIR}/.git" ]; then
      cd "${INSTALL_DIR}"
      git fetch origin "${BRANCH}" --depth 1 >/dev/null 2>&1
      git checkout "${BRANCH}" >/dev/null 2>&1
      git pull origin "${BRANCH}" >/dev/null 2>&1 || true
    else
      git clone --branch "${BRANCH}" --depth 1 \
        "https://github.com/${REPO}.git" "${INSTALL_DIR}" 2>/dev/null || true
    fi
  fi

  if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    warn "git clone 失败，尝试下载 tar.gz..."
    mkdir -p "${INSTALL_DIR}"
    curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${VERSION}.tar.gz" \
      | tar xz --strip-components=1 -C "${INSTALL_DIR}" 2>/dev/null || \
    curl -fsSL "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz" \
      | tar xz --strip-components=1 -C "${INSTALL_DIR}" 2>/dev/null || \
      error "下载源码失败，请检查网络连接"
  fi

  [ -f "${INSTALL_DIR}/package.json" ] || error "源码下载不完整"
  info "源码下载完成"
}

# ── 3. 构建前端 ─────────────────────────────────────────────
build_frontend() {
  info "构建前端..."
  cd "${INSTALL_DIR}"
  
  npm install --no-audit --no-fund 2>&1 | tail -1
  
  npm run build --workspace=@combat/shared 2>&1 | tail -1
  npm run build --workspace=@combat/frontend-v2 2>&1 | grep -E "built|error" | head -1
  
  info "前端构建完成"
}

# ── 4. 创建数据目录 ─────────────────────────────────────────
setup_dirs() {
  mkdir -p "${INSTALL_DIR}/data"
  mkdir -p "${INSTALL_DIR}/data/uploads"
  mkdir -p "${INSTALL_DIR}/apps/backend/data"
  
  [ -f "${INSTALL_DIR}/data/combat.sqlite" ] || info "首次安装，数据库将在启动时自动初始化"
}

# ── 5. 配置 systemd ─────────────────────────────────────────
setup_systemd() {
  NODE_BIN=$(command -v node)
  
  cat > /etc/systemd/system/combat-v2.service << SVC
[Unit]
Description=Combat Platform v${VERSION}
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/apps/backend
Environment=PATH=$(dirname "$NODE_BIN"):$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=COMBAT_API=http://localhost:3001
Environment=COMBAT_DB_PATH=${INSTALL_DIR}/data/combat.sqlite
Environment=COMBAT_UPLOAD_DIR=${INSTALL_DIR}/data/uploads
Environment=NODE_ENV=production
Environment=SAAS_MODE=1
Environment=HERMES_ENABLE_WRITE=1
ExecStart=${NODE_BIN} ${INSTALL_DIR}/apps/backend/dist/server.js
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/backend.log
StandardError=append:${INSTALL_DIR}/backend.log

[Install]
WantedBy=multi-user.target
SVC

  systemctl daemon-reload
  systemctl enable combat-v2 >/dev/null 2>&1
  info "systemd 服务配置完成"
}

# ── 6. 启动服务 ─────────────────────────────────────────────
start_service() {
  info "启动服务..."
  systemctl restart combat-v2
  sleep 5
  
  if systemctl is-active --quiet combat-v2; then
    info "服务已启动"
  else
    warn "服务可能未正常启动，请检查: journalctl -u combat-v2 -n 50"
  fi
}

# ── 7. 验证 ─────────────────────────────────────────────────
verify() {
  echo ""
  echo "================================================================"
  echo "  验证安装"
  echo "================================================================"
  
  HEALTH=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "FAIL")
  if echo "$HEALTH" | grep -q '"ok"'; then
    VER=$(echo "$HEALTH" | grep -oP '"version"\s*:\s*"[^"]*"' | head -1)
    info "API 健康检查通过 ${VER}"
  else
    warn "API 未响应，请等待几秒后手动检查: curl http://localhost:3001/api/health"
  fi
}

# ── 执行 ─────────────────────────────────────────────────────
echo "================================================================"
echo "  Combat Platform ${VERSION} 一键安装"
echo "  系统: $(uname -srm)"
echo "================================================================"
echo ""

install_node
download_source
build_frontend
setup_dirs
setup_systemd
start_service
verify

echo ""
echo "================================================================"
echo -e "  ${GREEN}✓ 安装完成${NC}"
echo "================================================================"
echo ""
echo "  访问地址:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP'):3001"
echo "  默认账号:  admin / a12345678"
echo "  数据目录:  ${INSTALL_DIR}/data/"
echo "  日志查看:  tail -f ${INSTALL_DIR}/backend.log"
echo "  服务管理:  systemctl {start|stop|restart|status} combat-v2"
echo ""
echo "  ⚠ 首次登录请立即修改默认密码！"
echo ""
