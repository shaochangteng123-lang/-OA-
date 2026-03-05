#!/bin/bash

# ============================================
# YuliLog 模式切换脚本
# ============================================
# 使用方法：
#   ./scripts/switch-mode.sh dev    # 切换到开发模式
#   ./scripts/switch-mode.sh prod   # 切换到生产模式
# ============================================

MODE=$1

if [ -z "$MODE" ]; then
    echo "❌ 请指定模式: dev 或 prod"
    echo "使用方法: ./scripts/switch-mode.sh [dev|prod]"
    exit 1
fi

case $MODE in
    dev)
        echo "🔄 切换到开发模式..."
        echo "📦 停止生产环境..."
        docker compose down 2>/dev/null || true
        echo "🚀 启动开发环境..."
        docker compose -f docker-compose.dev.yml up -d
        echo "✅ 开发模式已启动！"
        echo "📝 查看日志: npm run docker:dev:logs"
        echo "🛑 停止服务: npm run docker:dev:down"
        ;;
    prod)
        echo "🔄 切换到生产模式..."
        echo "📦 停止开发环境..."
        docker compose -f docker-compose.dev.yml down 2>/dev/null || true
        echo "🚀 启动生产环境（需要构建）..."
        docker compose up -d --build
        echo "✅ 生产模式已启动！"
        echo "📝 查看日志: docker compose logs -f"
        echo "🛑 停止服务: npm run docker:down"
        ;;
    *)
        echo "❌ 无效的模式: $MODE"
        echo "请使用: dev 或 prod"
        exit 1
        ;;
esac
