#!/usr/bin/env bash
set -eu

REPO_URL=https://github.com/3249333134/cosworks.git
APP_DIR=/opt/cosworks/current
ENV_FILE=/opt/cosworks/shared/.env.production

echo "==> 0. 环境诊断"
docker --version || { echo "!!! docker 未安装"; exit 1; }
docker compose version || { echo "!!! docker compose 未安装"; exit 1; }

echo ""
echo "==> 1. 准备目录 + 环境变量"
mkdir -p /opt/cosworks/shared /opt/cosworks/current
if [ ! -f "$ENV_FILE" ]; then
  echo "!!! 缺少 $ENV_FILE"
  echo "    cp .env.remote-dev.example $ENV_FILE && 编辑 MySQL/Redis/AI key"
  exit 1
fi
echo "    OK"

echo ""
echo "==> 2. 下载最新代码 (github tarball)"
TARBALL=/tmp/cosworks-main.tar.gz
rm -rf "$APP_DIR"
wget -qO "$TARBALL" https://codeload.github.com/3249333134/cosworks/tar.gz/refs/heads/main
mkdir -p "$APP_DIR"
tar --strip-components=1 -xzf "$TARBALL" -C "$APP_DIR"
rm -f "$TARBALL"
echo "    OK 源码已解压到 $APP_DIR"

echo ""
echo "==> 3. Docker network + gateway 连接"
docker network inspect cosworks-net >/dev/null 2>&1 || docker network create cosworks-net
for svc in peach-blossom-promise mysql-server redis-server; do
  docker network connect cosworks-net "$svc" 2>/dev/null || true
done
echo "    peach-blossom-promise 已连 cosworks-net"

echo ""
echo "==> 4. 构建并启动"
cd "$APP_DIR"
docker compose --env-file "$ENV_FILE" -f compose.production.yml down 2>/dev/null || true
docker compose --env-file "$ENV_FILE" -f compose.production.yml build --no-cache
docker compose --env-file "$ENV_FILE" -f compose.production.yml up -d

echo ""
echo "==> 5. 等 30s 然后健康检查"
sleep 30
docker compose -f compose.production.yml ps
echo ""
echo -n "    api health : "; curl -sS -m 5 http://127.0.0.1:5000/api/health || echo FAIL
echo -n "    web (内部)  : "; docker exec cosworks-web wget -qO- http://127.0.0.1/ | head -c 80 2>/dev/null || echo FAIL
echo -n "    gateway :80 : "; curl -sS -m 5 http://127.0.0.1:80 -o /dev/null -w "%{http_code}\n" || echo FAIL

echo ""
echo "========================================"
echo " 访问地址: http://47.115.220.98"
echo "========================================"