#!/bin/bash

# ============================================
# YuliLog 模式检查脚本
# ============================================
# 检查当前运行的是开发模式还是生产模式
# ============================================

echo "🔍 检查当前运行模式..."
echo ""

# 检查开发模式容器
DEV_CONTAINER=$(docker ps --filter "name=yulilog-app-dev" --format "{{.Names}}" 2>/dev/null)

# 检查生产模式容器
PROD_CONTAINER=$(docker ps --filter "name=yulilog-app" --format "{{.Names}}" 2>/dev/null | grep -v "yulilog-app-dev")

# 检查本地开发服务器
LOCAL_DEV=$(lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E ":(8899|3000|5173)" | grep -v "com.docke" | head -1)

echo "📦 Docker 容器状态："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$DEV_CONTAINER" ]; then
    echo "✅ 开发模式 Docker 容器运行中"
    echo "   容器名称: $DEV_CONTAINER"
    docker inspect $DEV_CONTAINER --format '   环境: {{index .Config.Env 0}}' 2>/dev/null | grep NODE_ENV || echo "   环境: development"
elif [ -n "$PROD_CONTAINER" ]; then
    echo "✅ 生产模式 Docker 容器运行中"
    echo "   容器名称: $PROD_CONTAINER"
    docker inspect $PROD_CONTAINER --format '   环境: {{index .Config.Env 0}}' 2>/dev/null | grep NODE_ENV || echo "   环境: production"
else
    echo "❌ 没有 Docker 容器运行"
fi

echo ""
echo "💻 本地开发服务器状态："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$LOCAL_DEV" ]; then
    echo "✅ 本地开发服务器运行中"
    echo "   $LOCAL_DEV"
else
    echo "❌ 没有本地开发服务器运行"
fi

echo ""
echo "📊 总结："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$DEV_CONTAINER" ]; then
    echo "🎯 当前模式: Docker 开发模式"
    echo "   特点: 代码修改自动生效，无需重建"
elif [ -n "$PROD_CONTAINER" ]; then
    echo "🎯 当前模式: Docker 生产模式"
    echo "   特点: 代码修改需要重建 Docker"
elif [ -n "$LOCAL_DEV" ]; then
    echo "🎯 当前模式: 本地开发模式"
    echo "   特点: 代码修改自动生效，无需 Docker"
else
    echo "🎯 当前模式: 未运行"
    echo "   提示: 使用 'npm run dev' 或 'npm run mode:dev' 启动"
fi

echo ""
