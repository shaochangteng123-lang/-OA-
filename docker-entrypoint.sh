#!/bin/sh
# ============================================
# YuliLog Docker 启动脚本
# ============================================
# 功能：
# 1. 检查数据目录权限
# 2. 启动 Node.js 应用
# ============================================

set -e

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "============================================"
echo "  YuliLog 工作日志系统 - 启动检查"
echo "============================================"

# ==========================================
# 1. 检查数据目录
# ==========================================
echo ""
echo "${YELLOW}[1/2] 检查数据目录...${NC}"

DATA_DIR="/app/data"

if [ ! -d "$DATA_DIR" ]; then
    echo "  创建数据目录: $DATA_DIR"
    mkdir -p "$DATA_DIR"
fi

if [ ! -w "$DATA_DIR" ]; then
    echo "${RED}[错误] 数据目录不可写: $DATA_DIR${NC}"
    exit 1
fi

echo "${GREEN}  ✓ 数据目录检查通过${NC}"

# ==========================================
# 2. 显示配置信息并启动
# ==========================================
echo ""
echo "${YELLOW}[2/2] 当前配置...${NC}"
echo "  - 环境: ${NODE_ENV:-production}"
echo "  - 端口: ${PORT:-8899}"
echo "  - 数据库: ${DATABASE_URL:-postgresql://localhost:5432/yulilog_worklog}"
echo ""
echo "============================================"
echo "${GREEN}启动应用...${NC}"
echo ""

# 启动 Node.js 应用
exec node dist/server/index.js
