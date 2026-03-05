#!/bin/bash
# ============================================
# YuliLog 快速启动脚本
# ============================================
# 功能：一键启动 Docker 服务（最简化版本）
# ============================================

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}🚀 YuliLog 快速启动中...${NC}"
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}⏳ 正在启动 Docker...${NC}"
    open -a Docker

    # 等待 Docker 启动
    MAX_WAIT=30
    COUNT=0
    while ! docker info > /dev/null 2>&1; do
        if [ $COUNT -ge $MAX_WAIT ]; then
            echo "❌ Docker 启动超时，请手动启动 Docker Desktop"
            exit 1
        fi
        echo -n "."
        sleep 1
        COUNT=$((COUNT + 1))
    done
    echo ""
    echo -e "${GREEN}✓ Docker 已启动${NC}"
fi

# 停止旧容器并启动新容器
echo -e "${YELLOW}⏳ 重启服务...${NC}"
docker compose down > /dev/null 2>&1 || true
docker compose up -d --build

# 等待服务就绪
echo -e "${YELLOW}⏳ 等待服务就绪...${NC}"
sleep 5

MAX_RETRIES=20
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s http://localhost:8899/api/health > /dev/null 2>&1; then
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo "❌ 服务启动超时"
        docker compose logs --tail=30
        exit 1
    fi
    echo -n "."
    sleep 1
done

echo ""
echo ""
echo -e "${GREEN}✅ YuliLog 启动成功！${NC}"
echo ""
echo -e "📱 访问地址: ${BLUE}http://localhost:8899${NC}"
echo ""
echo "常用命令："
echo "  查看日志: docker compose logs -f"
echo "  停止服务: docker compose down"
echo "  重启服务: ./docker-quick-start.sh"
echo ""
