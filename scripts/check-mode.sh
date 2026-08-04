#!/usr/bin/env bash

# ============================================
# YuliLog 模式检查脚本
# ============================================
# 检查当前运行的是开发模式还是生产模式
# ============================================

set -uo pipefail

DEV_CONTAINER_NAME="yulilog-worklog-dev"
PROD_CONTAINER_NAME="yulilog-prod"
CHECK_FAILED=0

echo "🔍 检查当前运行模式..."
echo ""

if ! command -v docker >/dev/null 2>&1; then
    echo "❌ 未找到 Docker（容器平台），无法检查容器运行模式" >&2
    exit 1
fi

if ! RUNNING_CONTAINERS="$(docker ps --format "{{.Names}}" 2>/dev/null)"; then
    echo "❌ 无法连接 Docker（容器平台），请确认服务已启动" >&2
    exit 1
fi

if printf '%s\n' "$RUNNING_CONTAINERS" | grep -Fxq "$DEV_CONTAINER_NAME"; then
    DEV_CONTAINER="$DEV_CONTAINER_NAME"
else
    DEV_CONTAINER=""
fi

if printf '%s\n' "$RUNNING_CONTAINERS" | grep -Fxq "$PROD_CONTAINER_NAME"; then
    PROD_CONTAINER="$PROD_CONTAINER_NAME"
else
    PROD_CONTAINER=""
fi

# 检查本地开发服务器
LOCAL_DEV=""
if command -v lsof >/dev/null 2>&1; then
    LOCAL_DEV="$(
        lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null |
            grep -E ":(8899|3000|5173)" |
            grep -v "com.docke" |
            head -1 ||
            true
    )"
fi

get_node_env() {
    local container_name="$1"
    local container_env
    local env_line

    if ! container_env="$(
        docker inspect \
            --format '{{range .Config.Env}}{{println .}}{{end}}' \
            "$container_name" 2>/dev/null
    )"; then
        return 1
    fi

    while IFS= read -r env_line; do
        case "$env_line" in
            NODE_ENV=*)
                printf '%s\n' "${env_line#NODE_ENV=}"
                return 0
                ;;
        esac
    done <<<"$container_env"

    return 1
}

echo "📦 Docker（容器平台）状态："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$DEV_CONTAINER" ]; then
    echo "✅ 开发模式容器运行中"
    echo "   容器名称: $DEV_CONTAINER"

    if DEV_NODE_ENV="$(get_node_env "$DEV_CONTAINER")"; then
        echo "   NODE_ENV（运行环境变量）: $DEV_NODE_ENV"
        if [ "$DEV_NODE_ENV" != "development" ]; then
            echo "   ❌ 配置异常：开发容器应为 development"
            CHECK_FAILED=1
        fi
    else
        echo "   ❌ 无法读取 NODE_ENV（运行环境变量）"
        CHECK_FAILED=1
    fi
fi

if [ -n "$PROD_CONTAINER" ]; then
    echo "✅ 生产模式容器运行中"
    echo "   容器名称: $PROD_CONTAINER"

    if PROD_NODE_ENV="$(get_node_env "$PROD_CONTAINER")"; then
        echo "   NODE_ENV（运行环境变量）: $PROD_NODE_ENV"
        if [ "$PROD_NODE_ENV" != "production" ]; then
            echo "   ❌ 配置异常：生产容器应为 production"
            CHECK_FAILED=1
        fi
    else
        echo "   ❌ 无法读取 NODE_ENV（运行环境变量）"
        CHECK_FAILED=1
    fi
fi

if [ -z "$DEV_CONTAINER" ] && [ -z "$PROD_CONTAINER" ]; then
    echo "❌ 没有开发或生产容器运行"
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

if [ -n "$DEV_CONTAINER" ] && [ -n "$PROD_CONTAINER" ]; then
    echo "🎯 当前模式: 开发与生产容器同时运行"
    echo "   两套环境可以同时运行，数据库和上传目录相互隔离"
elif [ -n "$DEV_CONTAINER" ]; then
    echo "🎯 当前模式: Docker（容器）开发模式"
    echo "   特点: 代码修改自动生效，无需重建"
elif [ -n "$PROD_CONTAINER" ]; then
    echo "🎯 当前模式: Docker（容器）生产模式"
    echo "   特点: 代码修改需要重新构建容器镜像"
elif [ -n "$LOCAL_DEV" ]; then
    echo "🎯 当前模式: 本地开发模式"
    echo "   特点: 代码修改自动生效，无需 Docker（容器平台）"
else
    echo "🎯 当前模式: 未运行"
    echo "   提示: 使用 'npm run dev' 或 'npm run mode:dev' 启动"
fi

echo ""

if [ "$CHECK_FAILED" -ne 0 ]; then
    echo "❌ 模式一致性校验失败"
    exit 1
fi
