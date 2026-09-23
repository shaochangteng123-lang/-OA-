#!/usr/bin/env bash

# ============================================
# YuliLog 生产候选镜像构建脚本
# ============================================
# 仅构建带唯一标签的候选镜像，不部署、不更新 latest（最新）标签。
# ============================================

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_REF="${1:-}"
MIN_FREE_KIB=$((12 * 1024 * 1024))

fail() {
    echo "❌ $1" >&2
    exit 1
}

if [ "$#" -ne 1 ]; then
    echo "使用方法: npm run docker:prod:build -- yulilog-prod-yulilog:<唯一标签>" >&2
    exit 2
fi

case "$IMAGE_REF" in
    yulilog-prod-yulilog:*) ;;
    *) fail "生产候选镜像必须使用 yulilog-prod-yulilog:<唯一标签> 格式" ;;
esac

IMAGE_TAG="${IMAGE_REF#yulilog-prod-yulilog:}"
if [ -z "$IMAGE_TAG" ] || [ "$IMAGE_TAG" = "latest" ]; then
    fail "禁止使用 latest（最新）或空标签构建生产候选镜像"
fi
if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
    fail "生产候选镜像标签格式无效"
fi

command -v docker >/dev/null 2>&1 || fail "未找到 Docker（容器平台）"
command -v npm >/dev/null 2>&1 || fail "未找到 npm（Node.js 包管理器）"
command -v git >/dev/null 2>&1 || fail "未找到 Git（版本控制）"

docker info >/dev/null 2>&1 || fail "无法连接 Docker（容器平台）"
if docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
    fail "目标镜像标签已经存在，禁止覆盖历史版本：$IMAGE_REF"
fi

if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain --untracked-files=normal)" ] &&
    [ "${ALLOW_DIRTY_PRODUCTION_BUILD:-0}" != "1" ]; then
    fail "工作区存在未提交内容；请先提交或整理，确需从已核验备份构建时显式设置 ALLOW_DIRTY_PRODUCTION_BUILD=1"
fi

AVAILABLE_KIB="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
if [ -z "$AVAILABLE_KIB" ] || ! [[ "$AVAILABLE_KIB" =~ ^[0-9]+$ ]]; then
    fail "无法读取磁盘可用空间"
fi
if [ "$AVAILABLE_KIB" -lt "$MIN_FREE_KIB" ]; then
    fail "磁盘可用空间不足 12 吉字节，已拒绝生产镜像构建"
fi

cd "$PROJECT_ROOT"
echo "🧪 执行生产发布前类型检查和完整回归测试..."
npm run release:check

echo "🏗️  构建生产候选镜像：$IMAGE_REF"
docker build --file "$PROJECT_ROOT/Dockerfile" --tag "$IMAGE_REF" "$PROJECT_ROOT"

echo "✅ 候选镜像构建完成，但尚未部署：$IMAGE_REF"
echo "ℹ️  验收通过后，再更新 docker-compose.prod.yml 中的固定镜像标签并执行 npm run docker:prod"
