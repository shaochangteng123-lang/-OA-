#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"

echo "🔎 校验 Nginx（反向代理）配置..."
docker compose -f "$PROD_COMPOSE_FILE" exec -T nginx nginx -t

echo "🔄 重载 Nginx（反向代理）配置..."
docker compose -f "$PROD_COMPOSE_FILE" exec -T nginx nginx -s reload

ACTIVE_CONFIG="$(
  docker compose -f "$PROD_COMPOSE_FILE" exec -T nginx nginx -T 2>&1
)"
AUTO_CLASSIFY_CONFIG="$(
  printf '%s\n' "$ACTIVE_CONFIG" | awk '
    /documents\/auto-classify/ { capture = 1 }
    capture { print }
    capture && /^[[:space:]]*}/ { exit }
  '
)"

if [ -z "$AUTO_CLASSIFY_CONFIG" ]; then
  echo "❌ Nginx（反向代理）运行配置中缺少人事档案自动识别路由" >&2
  exit 1
fi

if ! printf '%s\n' "$AUTO_CLASSIFY_CONFIG" | grep -Eq 'proxy_read_timeout[[:space:]]+2400s;'; then
  echo "❌ 人事档案自动识别路由的读取等待时间不是 2400 秒" >&2
  exit 1
fi

if ! printf '%s\n' "$AUTO_CLASSIFY_CONFIG" | grep -Eq 'proxy_send_timeout[[:space:]]+2400s;'; then
  echo "❌ 人事档案自动识别路由的发送等待时间不是 2400 秒" >&2
  exit 1
fi

echo "✅ Nginx（反向代理）配置已重载，自动识别等待时间为 2400 秒"
