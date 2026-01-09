# ============================================
# YuliLog 工作日志系统 - 生产环境 Dockerfile
# ============================================
# 优化的多阶段构建：最小化镜像体积，最大化安全性
# 适用于移动硬盘多PC协同开发场景
# ============================================

# ==========================================
# 基础镜像配置
# 通过构建参数 NODE_IMAGE 可以在 docker-compose.yml 中指定国内镜像源
# 默认仍为官方 node:20-alpine
# ==========================================
ARG NODE_IMAGE=node:20-alpine

# ==========================================
# 阶段1：依赖安装（包含原生编译工具）
# ==========================================
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

# 安装 better-sqlite3 原生编译所需依赖
# 这些工具仅在此阶段使用，不会进入最终镜像
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite sqlite-libs

# 复制包管理文件
COPY package.json package-lock.json ./

# 安装所有依赖（包括 devDependencies，构建需要）
# --ignore-scripts 跳过 prepare 脚本（husky 仅用于开发环境）
RUN npm ci --prefer-offline --ignore-scripts

# ==========================================
# 阶段2：构建阶段
# ==========================================
FROM deps AS builder

WORKDIR /app

# 复制 TypeScript 配置文件（构建必需）
COPY tsconfig.json tsconfig.node.json tsconfig.server.json ./

# 复制 Vite 配置
COPY vite.config.ts ./

# 复制入口文件（Vite 需要）
COPY index.html ./

# 复制源代码
COPY src ./src
COPY server ./server
COPY public ./public

# 构建前端（Vite）
RUN npm run build

# 构建后端（TypeScript）
RUN npm run build:server

# ==========================================
# 阶段3：生产依赖（精简）
# ==========================================
FROM ${NODE_IMAGE} AS prod-deps

WORKDIR /app

# 安装 better-sqlite3 原生编译所需依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite sqlite-libs

# 复制包管理文件
COPY package.json package-lock.json ./

# 仅安装生产依赖
# --ignore-scripts 跳过 prepare 脚本（husky 仅用于开发环境）
RUN npm ci --omit=dev --prefer-offline --ignore-scripts \
    # 手动重新编译 better-sqlite3 原生模块
    && npm rebuild better-sqlite3

# ==========================================
# 阶段4：生产运行镜像（最小化）
# ==========================================
FROM ${NODE_IMAGE} AS production

# 标签信息
LABEL maintainer="YuliLog Team"
LABEL description="YuliLog 工作日志管理系统 - 生产环境"
LABEL version="1.0.0"

# 安装运行时依赖（仅 SQLite 运行库 + 健康检查工具）
RUN apk add --no-cache \
    sqlite \
    dumb-init \
    wget \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs \
    && adduser -S yulilog -u 1001 -G nodejs

WORKDIR /app

# 从构建阶段复制构建产物
COPY --from=builder --chown=yulilog:nodejs /app/dist ./dist
COPY --from=builder --chown=yulilog:nodejs /app/package.json ./

# 从生产依赖阶段复制 node_modules
COPY --from=prod-deps --chown=yulilog:nodejs /app/node_modules ./node_modules

# 复制启动验证脚本
COPY --chown=yulilog:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# 创建数据目录
RUN mkdir -p /app/data \
    && chown -R yulilog:nodejs /app

# 切换到非 root 用户
USER yulilog

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8899
ENV DATABASE_PATH=/app/data/worklog.db

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8899/api/health || exit 1

# 暴露端口
EXPOSE 8899

# 使用 dumb-init 作为 PID 1 进程，正确处理信号
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# 启动命令
CMD ["./docker-entrypoint.sh"]
