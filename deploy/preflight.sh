#!/usr/bin/env sh
set -eu

echo "[preflight] docker"
docker version --format '{{.Server.Version}}'
echo "[preflight] disk"
df -h / /opt 2>/dev/null || df -h /
echo "[preflight] required containers"
docker inspect mysql-server --format 'mysql={{.State.Status}}'
docker inspect redis-server --format 'redis={{.State.Status}}'
echo "[preflight] ports"
ss -lnt | grep -E ':(80|3306|6379) ' || true
echo "[preflight] complete"
