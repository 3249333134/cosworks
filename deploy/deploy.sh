#!/usr/bin/env sh
set -eu

APP_DIR=/opt/cosworks/current
ENV_FILE=/opt/cosworks/shared/.env.production

test -f "$ENV_FILE" || { echo "Missing $ENV_FILE"; exit 1; }
docker network inspect cosworks-net >/dev/null 2>&1 || docker network create cosworks-net
docker network connect cosworks-net mysql-server 2>/dev/null || true
docker network connect cosworks-net redis-server 2>/dev/null || true
docker network connect cosworks-net peach-blossom-promise 2>/dev/null || true

cd "$APP_DIR"
docker compose --env-file "$ENV_FILE" -f compose.production.yml build
docker compose --env-file "$ENV_FILE" -f compose.production.yml up -d
docker compose -f compose.production.yml ps

if docker inspect peach-blossom-promise >/dev/null 2>&1; then
  docker cp peach-blossom-promise:/etc/nginx/conf.d/project-ark-acme.conf "/opt/cosworks/shared/project-ark-acme.conf.backup.$(date +%Y%m%d%H%M%S)"
  docker cp deploy/gateway-ip.conf peach-blossom-promise:/etc/nginx/conf.d/project-ark-acme.conf
  docker exec peach-blossom-promise nginx -t
  docker exec peach-blossom-promise nginx -s reload
else
  echo "Existing public gateway not found; refusing to take over port 80."
  exit 1
fi

curl --fail --retry 10 --retry-delay 2 -H 'Host: 47.115.220.98' http://127.0.0.1/api/health
echo "Deployment complete"
