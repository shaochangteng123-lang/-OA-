# ============================================
# YuliLog 工作日志系统 - 生产环境 Dockerfile
# ============================================
# 基于 Debian slim，统一使用 PaddleOCR（与开发环境一致）
# ============================================

ARG NODE_IMAGE=node:20-slim

# ==========================================
# 阶段1：基础依赖层
# ==========================================
FROM ${NODE_IMAGE} AS base

# 配置 Debian 镜像源（阿里云）
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null || true

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    build-essential \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    poppler-utils \
    fonts-noto-cjk \
    dumb-init wget curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ==========================================
# 阶段2：安装 PaddleOCR 并预下载模型
# ==========================================
FROM base AS ocr-models

# 配置 pip 镜像源
RUN pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/ \
    && pip3 config set global.trusted-host mirrors.aliyun.com

# 安装 PaddleOCR
RUN pip3 install --break-system-packages paddlepaddle paddleocr

# 预下载模型（避免运行时下载），存到 /opt/paddlex 方便后续复制
RUN PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    FLAGS_allocator_strategy=auto_growth \
    HOME=/opt \
    python3 -c "\
from paddleocr import PaddleOCR; \
PaddleOCR( \
    use_textline_orientation=True, \
    use_doc_orientation_classify=False, \
    use_doc_unwarping=False, \
    lang='ch', \
    ocr_version='PP-OCRv4', \
); \
print('Models downloaded successfully')"

# ==========================================
# 阶段3：Node.js 依赖安装
# ==========================================
FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --ignore-scripts --legacy-peer-deps

# ==========================================
# 阶段4：生产 Node.js 依赖
# ==========================================
FROM base AS prod-deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-offline --ignore-scripts --legacy-peer-deps \
    && npm rebuild canvas

# ==========================================
# 阶段5：构建阶段
# ==========================================
FROM deps AS builder

COPY tsconfig.json tsconfig.node.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY public ./public

RUN npm run build && npm run build:server

# ==========================================
# 阶段6：生产运行镜像
# ==========================================
FROM base AS production

LABEL maintainer="YuliLog Team"
LABEL description="YuliLog 工作日志管理系统"

# 从 ocr-models 阶段复制已安装的 PaddleOCR 和预下载的模型
COPY --from=ocr-models /usr/local/lib /usr/local/lib
COPY --from=ocr-models /usr/local/bin/python3* /usr/local/bin/
COPY --from=ocr-models /opt/.paddlex /opt/.paddlex

# 创建应用用户
RUN addgroup --gid 1001 nodejs \
    && adduser --disabled-password --gecos "" --uid 1001 --ingroup nodejs yulilog

WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder --chown=yulilog:nodejs /app/dist ./dist
COPY --from=builder --chown=yulilog:nodejs /app/package.json ./
COPY --from=prod-deps --chown=yulilog:nodejs /app/node_modules ./node_modules
COPY --chown=yulilog:nodejs docker-entrypoint.sh ./
COPY --chown=yulilog:nodejs server/scripts/paddle_ocr_worker.py ./server/scripts/

# 创建数据目录
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /app/data /app/uploads/temp /app/uploads/invoices \
    && chown -R yulilog:nodejs /app \
    && chmod -R 755 /opt/.paddlex 2>/dev/null || true

USER yulilog

ENV NODE_ENV=production \
    PORT=8899 \
    DATABASE_URL=postgresql://postgres:postgres@postgres:5432/yulilog_worklog \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    FLAGS_allocator_strategy=auto_growth \
    HOME=/opt

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8899/api/health || exit 1

EXPOSE 8899

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
