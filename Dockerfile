# ============================================
# YuliLog 工作日志系统 - 生产环境 Dockerfile
# ============================================
# 优化的多阶段构建：最大化缓存利用，加速重复构建
# ============================================

ARG NODE_IMAGE=node:20-alpine

# ==========================================
# 阶段1：基础依赖层（缓存原生编译工具）
# ==========================================
FROM ${NODE_IMAGE} AS base

# 安装 better-sqlite3 原生编译所需依赖
RUN apk add --no-cache python3 make g++ sqlite sqlite-libs

WORKDIR /app

# ==========================================
# 阶段2：依赖安装（利用缓存）
# ==========================================
FROM base AS deps

# 仅复制包管理文件（变化少，利用缓存）
COPY package.json package-lock.json ./

# 安装所有依赖（构建需要 devDependencies）
RUN npm ci --prefer-offline --ignore-scripts

# ==========================================
# 阶段3：生产依赖（并行构建）
# ==========================================
FROM base AS prod-deps

COPY package.json package-lock.json ./

# 仅安装生产依赖 + 重新编译原生模块
RUN npm ci --omit=dev --prefer-offline --ignore-scripts \
    && npm rebuild better-sqlite3

# ==========================================
# 阶段4：构建阶段
# ==========================================
FROM deps AS builder

# 复制配置文件（变化较少）
COPY tsconfig.json tsconfig.node.json tsconfig.server.json vite.config.ts index.html ./

# 复制源代码（变化频繁，放最后）
COPY src ./src
COPY server ./server
COPY public ./public

# 并行构建前端和后端
RUN npm run build && npm run build:server

# ==========================================
# 阶段5：生产运行镜像（最小化）
# ==========================================
FROM ${NODE_IMAGE} AS production

LABEL maintainer="YuliLog Team"
LABEL description="YuliLog 工作日志管理系统"

# 安装运行时依赖
RUN apk add --no-cache sqlite dumb-init wget \
    && rm -rf /var/cache/apk/* \
    && addgroup -g 1001 -S nodejs \
    && adduser -S yulilog -u 1001 -G nodejs

WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder --chown=yulilog:nodejs /app/dist ./dist
COPY --from=builder --chown=yulilog:nodejs /app/package.json ./
COPY --from=prod-deps --chown=yulilog:nodejs /app/node_modules ./node_modules
COPY --chown=yulilog:nodejs docker-entrypoint.sh ./

# 创建数据目录和上传目录并设置权限
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /app/data \
    && mkdir -p /app/uploads/temp \
    && mkdir -p /app/uploads/invoices \
    && chown -R yulilog:nodejs /app

USER yulilog

ENV NODE_ENV=production \
    PORT=8899 \
    DATABASE_PATH=/app/data/worklog.db

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8899/api/health || exit 1

EXPOSE 8899

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
