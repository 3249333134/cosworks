#!/usr/bin/env bash
# cosworks 一键部署脚本 — 在 47.115.220.98 上执行
set -eu

REPO_URL=https://github.com/3249333134/cosworks.git
APP_DIR=/opt/cosworks/current
ENV_FILE=/opt/cosworks/shared/.env.production

echo "==> 确保目录存在"
mkdir -p /opt/cosworks/shared
mkdir -p /opt/cosworks/current

echo "==> 检查 .env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "!!! 缺少 $ENV_FILE — 请先从 /opt/cosworks/shared/.env.remote-dev.example 拷贝并修改"
  echo "    MySQL / Redis / AI 密钥等必填"
  exit 1
fi

echo "==> 拉取最新代码"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> 构建并启动 Docker Compose"
docker network inspect cosworks-net >/dev/null 2>&1 || docker network create cosworks-net
cd "$APP_DIR"
docker compose --env-file "$ENV_FILE" -f compose.production.yml build --no-cache
docker compose --env-file "$ENV_FILE" -f compose.production.yml up -d

echo "==> 等容器就绪"
sleep 5
docker compose -f compose.production.yml ps

echo ""
echo "==> 尝试让外网端口 5173 访问 web"
# 如果服务器有独立 nginx 网关，把 cosworks-web 暴露到 5173
# 简单方案：直接 publish 5173，跳过 nginx
curl -sS -m 5 http://127.0.0.1:80 || echo "web 容器内 80 端口暂无响应"

echo ""
echo "==> 完成。浏览器访问: http://47.115.220.98:5173"
echo "    如果端口不通，检查安全组放行 5173"
