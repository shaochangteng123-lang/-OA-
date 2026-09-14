#!/bin/sh
# ============================================
# YuliLog Docker 启动脚本
# ============================================
# 功能：
# 1. 检查数据目录权限
# 2. 校验人力成本回单识别关键接线
# 3. 启动 Node.js 应用
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
echo "${YELLOW}[1/3] 检查数据目录...${NC}"

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
# 2. 校验人力成本回单识别关键接线
# ==========================================
echo ""
echo "${YELLOW}[2/3] 校验人力成本回单识别版本...${NC}"

PAYROLL_ROUTE="/app/dist/server/routes/payroll.js"
HUMAN_COST_OCR="/app/dist/server/services/humanCostReceiptOcr.js"
HUMAN_COST_IDENTITY="/app/dist/server/services/humanCostReceiptIdentity.js"

if ! grep -Eq 'social_security:[[:space:]]*([6-9]|[1-9][0-9]+)' "$PAYROLL_ROUTE"; then
    echo "${RED}[错误] 社保回单识别版本低于 6，拒绝启动旧版生产服务${NC}"
    exit 1
fi

if ! grep -q 'allowMaskedTaxPayeeAccount' "$HUMAN_COST_OCR"; then
    echo "${RED}[错误] 社保遮挡收款账号兼容未接入，拒绝启动生产服务${NC}"
    exit 1
fi

if [ ! -f "$HUMAN_COST_IDENTITY" ]; then
    echo "${RED}[错误] 电子回单号查重服务缺失，拒绝启动生产服务${NC}"
    exit 1
fi

echo "${GREEN}  ✓ 社保版本、遮挡账号兼容和电子回单号查重均已接入${NC}"

# ==========================================
# 3. 显示配置信息并启动
# ==========================================
echo ""
echo "${YELLOW}[3/3] 当前配置...${NC}"
echo "  - 环境: ${NODE_ENV:-production}"
echo "  - 端口: ${PORT:-8899}"
if [ -n "${DATABASE_URL:-}" ]; then
    echo "  - 数据库: 已配置（敏感信息不输出）"
else
    echo "  - 数据库: 使用默认连接（敏感信息不输出）"
fi
echo ""
echo "============================================"
echo "${GREEN}启动应用...${NC}"
echo ""

# 启动 Node.js 应用
exec node dist/server/index.js
