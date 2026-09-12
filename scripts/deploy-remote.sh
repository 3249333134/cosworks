#!/usr/bin/env bash
# cosworks 一键部署脚本 — 在 47.115.220.98 上执行
set -eu

REPO_URL=https://github.com/3249333134/cosworks.git
APP_DIR=/opt/cosworks/current
ENV_FILE=/opt/cosworks/shared/.env.production
PUBLIC_PORT=${PUBLIC_PORT:-5173}

echo "==> 0. 环境诊断"
echo "    docker:     $(docker --version 2>/dev/null || echo 'MISSING')"
echo "    compose:    $(docker compose version 2>/dev/null || echo 'MISSING')"
echo "    public ip:  $(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo "==> 1. 准备目录"
mkdir -p /opt/cosworks/shared /opt/cosworks/current

echo ""
echo "==> 2. 检查环境变量 $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  echo "!!! 缺少 $ENV_FILE"
  echo "    请从 .env.remote-dev.example 拷贝并填写 MySQL/Redis/AI 密钥"
  echo "    然后重新运行本脚本"
  exit 1
fi
echo "    OK"

echo ""
echo "==> 3. 拉取最新代码"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo ""
echo "==> 4. 确保 docker network"
docker network inspect cosworks-net >/dev/null 2>&1 || docker network create cosworks-net
# 把已有服务（MySQL/Redis/gateway）也连上
for svc in mysql-server redis-server peach-blossom-promise; do
  docker network connect cosworks-net "$svc" 2>/dev/null && echo "    connected $svc" || true
done

echo ""
echo "==> 5. 构建并启动 (port $PUBLIC_PORT)"
cd "$APP_DIR"
cat > /tmp/cosworks-compose.yml <<EOF
services:
  api:
    container_name: cosworks-api
    build:
      context: .
      dockerfile: Dockerfile.server
    restart: always
    env_file: $ENV_FILE
    networks: [cosworks-net]
    expose: ["5000"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:5000/api/health"]
      interval: 20s
      timeout: 5s
      retries: 5

  web:
    container_name: cosworks-web
    build:
      context: .
      dockerfile: Dockerfile.web
    restart: always
    depends_on:
      api:
        condition: service_healthy
    networks: [cosworks-net]
    ports: ["$PUBLIC_PORT:80"]

networks:
  cosworks-net:
    external: true
EOF
docker compose -f /tmp/cosworks-compose.yml down 2>/dev/null || true
docker compose -f /tmp/cosworks-compose.yml build --no-cache
docker compose -f /tmp/cosworks-compose.yml up -d

echo ""
echo "==> 6. 等容器就绪 (15s)"
sleep 15
docker compose -f /tmp/cosworks-compose.yml ps

echo ""
echo "==> 7. 健康检查"
echo -n "    api health:  "; curl -sS -m 5 http://127.0.0.1:5000/api/health || echo "FAIL"
echo -n "    web :80:     "; curl -sS -m 5 http://127.0.0.1:80 -o /dev/null -w "%{http_code}\n" || echo "FAIL"
echo -n "    public :$PUBLIC_PORT: "; curl -sS -m 5 http://127.0.0.1:$PUBLIC_PORT -o /dev/null -w "%{http_code}\n" || echo "FAIL"

echo ""
echo "========================================"
echo " 访问地址: http://47.115.220.98:$PUBLIC_PORT"
echo " 注意: 不要用 https:// — 服务器没配 TLS 证书"
echo " 如果不通 → 阿里云安全组放行 $PUBLIC_PORT/TCP"
echo "========================================"
