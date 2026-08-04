#!/usr/bin/env bash

# ============================================
# YuliLog 模式启动/更新脚本
# ============================================
# 使用方法：
#   ./scripts/switch-mode.sh dev    # 启动或更新开发模式
#   ./scripts/switch-mode.sh prod   # 启动或更新生产模式
# ============================================

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
PROD_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"
MODE="${1:-}"

if [ -z "$MODE" ]; then
    echo "❌ 请指定模式: dev 或 prod"
    echo "使用方法: ./scripts/switch-mode.sh [dev|prod]"
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "❌ 未找到 Docker（容器平台），无法切换运行模式" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "❌ Docker Compose（容器编排）不可用，无法切换运行模式" >&2
    exit 1
fi

# 在停止现有服务之前先校验两套配置，避免配置错误导致服务已停但目标模式未启动。
if ! docker compose -f "$DEV_COMPOSE_FILE" config --quiet; then
    echo "❌ 开发模式 Compose（容器编排）配置校验失败，已取消切换" >&2
    exit 1
fi

if ! docker compose -f "$PROD_COMPOSE_FILE" config --quiet; then
    echo "❌ 生产模式 Compose（容器编排）配置校验失败，已取消切换" >&2
    exit 1
fi

case "$MODE" in
    dev)
        echo "🔄 启动或更新开发模式..."
        echo "ℹ️  生产环境保持运行，数据库和上传目录继续隔离"
        docker compose -f "$DEV_COMPOSE_FILE" up -d --build --wait --wait-timeout 180
        echo "✅ 开发模式已启动！"
        echo "📝 查看日志: npm run docker:dev:logs"
        echo "🛑 停止服务: npm run docker:dev:stop"
        ;;
    prod)
        echo "🔄 启动或更新生产模式..."
        echo "ℹ️  开发环境保持运行，数据库和上传目录继续隔离"
        if ! command -v npm >/dev/null 2>&1; then
            echo "❌ 未找到 npm（Node.js 包管理器），无法执行生产发布校验" >&2
            exit 1
        fi
        echo "🧪 执行生产发布前类型和完整回归测试校验..."
        (
            cd "$PROJECT_ROOT"
            npm run release:check
        )
        docker compose -f "$PROD_COMPOSE_FILE" up -d --build --wait --wait-timeout 180
        bash "$PROJECT_ROOT/scripts/reload-production-nginx.sh"
        echo "✅ 生产模式已启动！"
        echo "📝 查看日志: npm run docker:prod:logs"
        echo "🛑 停止服务: npm run docker:prod:stop"
        ;;
    *)
        echo "❌ 无效的模式: $MODE"
        echo "请使用: dev 或 prod"
        exit 1
        ;;
esac
