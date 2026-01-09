#!/bin/sh
# ============================================
# YuliLog Docker 启动脚本
# ============================================
# 功能：
# 1. 验证必需环境变量
# 2. 检查数据目录权限
# 3. 启动 Node.js 应用
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "  YuliLog 工作日志系统 - 启动检查"
echo "============================================"

# ==========================================
# 1. 检查必需环境变量
# ==========================================
echo ""
echo "${YELLOW}[1/4] 检查环境变量...${NC}"

MISSING_VARS=""

# 检查飞书配置
if [ -z "$FEISHU_APP_ID" ]; then
    MISSING_VARS="$MISSING_VARS FEISHU_APP_ID"
fi

if [ -z "$FEISHU_APP_SECRET" ]; then
    MISSING_VARS="$MISSING_VARS FEISHU_APP_SECRET"
fi

if [ -z "$FEISHU_REDIRECT_URI" ]; then
    MISSING_VARS="$MISSING_VARS FEISHU_REDIRECT_URI"
fi

# 检查会话密钥
if [ -z "$SESSION_SECRET" ]; then
    MISSING_VARS="$MISSING_VARS SESSION_SECRET"
elif [ ${#SESSION_SECRET} -lt 32 ]; then
    echo "${RED}[错误] SESSION_SECRET 长度必须至少 32 字符${NC}"
    exit 1
fi

# 检查是否使用默认密钥
if [ "$SESSION_SECRET" = "yulilog_worklog_system_session_secret_key_2025_change_me_in_production" ]; then
    echo "${YELLOW}[警告] 检测到使用默认 SESSION_SECRET，生产环境请更换！${NC}"
fi

if [ -n "$MISSING_VARS" ]; then
    echo "${RED}[错误] 缺少必需的环境变量:${MISSING_VARS}${NC}"
    echo ""
    echo "请在 .env.production 文件中配置以下变量："
    echo "  - FEISHU_APP_ID: 飞书应用 ID"
    echo "  - FEISHU_APP_SECRET: 飞书应用密钥"
    echo "  - FEISHU_REDIRECT_URI: OAuth 回调地址"
    echo "  - SESSION_SECRET: 会话加密密钥（至少32字符）"
    exit 1
fi

echo "${GREEN}  ✓ 环境变量检查通过${NC}"

# ==========================================
# 2. 检查数据目录
# ==========================================
echo ""
echo "${YELLOW}[2/4] 检查数据目录...${NC}"

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
# 3. 显示配置信息
# ==========================================
echo ""
echo "${YELLOW}[3/4] 当前配置...${NC}"
echo "  - 环境: ${NODE_ENV:-production}"
echo "  - 端口: ${PORT:-8899}"
echo "  - 数据库: ${DATABASE_PATH:-/app/data/worklog.db}"
echo "  - 回调地址: $FEISHU_REDIRECT_URI"

# ==========================================
# 4. 启动应用
# ==========================================
echo ""
echo "${YELLOW}[4/4] 启动应用...${NC}"
echo "============================================"
echo ""

# 启动 Node.js 应用
exec node dist/server/index.js
