#!/bin/bash
# ============================================
# YuliLog 一键启动脚本
# ============================================
# 功能：自动停止旧容器、构建并启动新容器
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  YuliLog 工作日志系统 - 一键启动${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ==========================================
# 1. 检查 Docker 是否运行
# ==========================================
echo -e "${YELLOW}[1/5] 检查 Docker 状态...${NC}"
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}[错误] Docker 未运行，请先启动 Docker Desktop${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Docker 运行正常${NC}"
echo ""

# ==========================================
# 2. 停止并删除旧容器
# ==========================================
echo -e "${YELLOW}[2/5] 清理旧容器...${NC}"
if docker ps -a | grep -q yulilog-app; then
    echo "  停止容器..."
    docker stop yulilog-app > /dev/null 2>&1 || true
    echo "  删除容器..."
    docker rm yulilog-app > /dev/null 2>&1 || true
    echo -e "${GREEN}  ✓ 旧容器已清理${NC}"
else
    echo "  无需清理"
fi
echo ""

# ==========================================
# 3. 构建镜像
# ==========================================
echo -e "${YELLOW}[3/5] 构建 Docker 镜像...${NC}"
docker compose build --no-cache
echo -e "${GREEN}  ✓ 镜像构建完成${NC}"
echo ""

# ==========================================
# 4. 启动容器
# ==========================================
echo -e "${YELLOW}[4/5] 启动容器...${NC}"
docker compose up -d
echo -e "${GREEN}  ✓ 容器启动成功${NC}"
echo ""

# ==========================================
# 5. 等待服务就绪
# ==========================================
echo -e "${YELLOW}[5/5] 等待服务就绪...${NC}"
echo "  检查健康状态..."

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker exec yulilog-app wget --no-verbose --tries=1 --spider http://localhost:8899/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ 服务已就绪${NC}"
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}[错误] 服务启动超时${NC}"
        echo ""
        echo "查看日志："
        docker compose logs --tail=50
        exit 1
    fi

    echo -n "."
    sleep 1
done

echo ""
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}  ✓ YuliLog 启动成功！${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "访问地址: ${GREEN}http://localhost:8899${NC}"
echo ""
echo "常用命令："
echo "  查看日志: ${YELLOW}docker compose logs -f${NC}"
echo "  停止服务: ${YELLOW}docker compose down${NC}"
echo "  重启服务: ${YELLOW}./docker-start.sh${NC}"
echo ""
