#!/bin/bash
# ============================================
# YuliLog 停止脚本
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
echo -e "${BLUE}  YuliLog 工作日志系统 - 停止服务${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

echo -e "${YELLOW}停止容器...${NC}"
docker compose down

echo ""
echo -e "${GREEN}  ✓ 服务已停止${NC}"
echo ""
