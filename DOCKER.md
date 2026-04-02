# Docker 开发模式快速启动指南

## 🚀 快速开始（推荐）

```bash
# 启动完整 Docker 开发环境
docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

访问：http://localhost:8899

## 开发模式特性

### 完整容器化开发环境（推荐）
- ✅ 环境隔离，避免本地环境污染
- ✅ 代码热重载（源码挂载）
- ✅ 前端端口：8899（Vite dev server）
- ✅ 后端端口：3000（Express API）
- ✅ 数据库：PostgreSQL 容器
- ✅ 完整依赖环境（canvas、PDF 处理等）

### 轻量级模式（可选）
- 仅启动 PostgreSQL 容器
- 代码在本地运行
- 适合快速调试

## 常用命令

### 完整 Docker 开发模式（推荐）
```bash
docker compose up -d          # 启动服务
docker compose logs -f        # 查看日志
docker compose restart        # 重启服务
docker compose down           # 停止服务
docker compose up -d --build  # 重新构建并启动
```

### 轻量级模式（可选）
```bash
npm run docker:db    # 启动 PostgreSQL 容器
npm run dev          # 启动本地开发服务器
npm run docker:stop  # 停止数据库容器
```

### 生产模式
```bash
npm run docker:prod      # 启动生产环境
npm run docker:stop:prod # 停止生产环境
npm run docker:logs:prod # 查看生产环境日志
```

## 配置文件说明

```
docker-compose.yml         # 开发环境（推荐）
docker-compose.simple.yml  # 仅 PostgreSQL（轻量级）
docker-compose.prod.yml    # 生产环境
Dockerfile.dev             # 开发环境镜像
Dockerfile                 # 生产环境镜像
```

## 访问地址

- 前端：http://localhost:8899
- 后端 API：http://localhost:3000
- PostgreSQL：localhost:5432

## 开发工作流

### 日常开发（推荐）

1. **首次启动**
   ```bash
   docker compose up -d --build
   ```
   首次构建需要 3-5 分钟

2. **日常开发**
   - 修改 `src/` 或 `server/` 代码
   - 保存后自动热重载
   - 前端修改立即生效
   - 后端修改自动重启

3. **查看日志**
   ```bash
   docker compose logs -f
   ```

4. **停止服务**
   ```bash
   docker compose down
   ```

### 轻量级开发（可选）

1. **启动数据库**
   ```bash
   npm run docker:db
   ```

2. **启动开发服务器**
   ```bash
   npm run dev
   ```

3. **停止**
   ```bash
   Ctrl+C               # 停止开发服务器
   npm run docker:stop  # 停止数据库
   ```

## 数据持久化

- **数据库数据**：存储在 Docker volume `postgres_data` 中
- **上传文件**：挂载到 `./uploads` 目录
- **调试文件**：挂载到 `./debug` 目录

## 故障排查

### Docker 未运行
```bash
# macOS
open -a Docker
```

### 端口被占用
```bash
# 检查端口占用
lsof -i :8899
lsof -i :3000
lsof -i :5432

# 停止占用端口的进程
kill -9 <PID>
```

### 查看详细日志
```bash
# 所有服务日志
docker compose logs -f

# 仅应用日志
docker compose logs -f yulilog-dev

# 仅数据库日志
docker compose logs -f postgres
```

### 重新构建
```bash
# 停止服务
docker compose down

# 清除缓存重新构建
docker compose build --no-cache

# 启动服务
docker compose up -d
```

### 重置数据库
```bash
# 停止并删除数据库容器和数据
docker compose down -v

# 重新启动
docker compose up -d
```

### 清理所有数据
```bash
# 停止所有容器
docker compose down -v

# 删除镜像
docker rmi yulilog-worklog-yulilog-dev yulilog-worklog-yulilog
```

## 性能对比

| 模式 | 首次启动时间 | 热重载 | 环境隔离 | 推荐场景 |
|------|------------|--------|---------|---------|
| 完整 Docker | ~3-5分钟 | ✅ | ✅ | 日常开发（推荐） |
| 轻量级 | ~10秒 | ✅ | ⚠️ | 快速调试 |
| 生产模式 | ~5-10分钟 | ❌ | ✅ | 生产部署 |

## 注意事项

1. **推荐使用完整 Docker 开发模式**
2. 首次构建需要 3-5 分钟，后续启动很快
3. 源代码挂载到容器，修改后自动热重载
4. 数据库数据持久化，停止容器不会丢失数据
5. 如需快速调试，可使用轻量级模式
