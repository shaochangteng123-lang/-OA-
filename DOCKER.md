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
npm run docker:prod # 启动或恢复配置中固定的生产镜像，不现场构建
npm run docker:prod:build -- yulilog-prod-yulilog:release-YYYYMMDD-name # 只构建唯一标签候选镜像，不部署
npm run docker:prod:stop # 停止生产环境
npm run docker:prod:logs # 查看生产环境日志
```

开发与生产使用独立数据库卷、网络和上传目录，可以同时运行。`npm run mode:dev` 与
`npm run mode:prod` 只启动或更新目标环境，不会停止另一套环境。
生产应用镜像由 `docker-compose.prod.yml` 显式固定；日常生产入口强制使用 `--no-build`，不会把当前工作区中的未提交内容构建进生产。镜像缺失时会直接失败，不会自动拉取同名镜像。
候选镜像构建与部署已经拆分：`docker:prod:build` 会先执行 `npm run release:check`，拒绝 `latest（最新）`、空标签、已存在标签、低于 12 吉字节的可用空间以及默认情况下的未提交工作区；构建成功后也不会自动部署。验收通过后，应把生产编排中的固定镜像标签更新为候选标签，再执行 `npm run docker:prod`。
生产容器启动后还会校验并重载 Nginx（反向代理）配置，并确认人事档案自动识别路由的收发等待时间均为 2400 秒。`nginx.conf` 使用绑定挂载，文件更新不会让既有工作进程自动采用新配置，因此生产更新应统一使用 `npm run docker:prod` 或 `npm run mode:prod`，不要只重建应用容器。
开发与生产容器默认统一使用 `OCR_MODEL=v6_medium`（第六版中型识别模型）；生产旧容器若缺少第六版模型目录，必须通过完整重建镜像升级，不能只修改环境变量。`v4_mobile`（第四版移动模型）继续作为显式回滚配置保留。
生产 Nginx（反向代理）的全部 `/api/`（应用程序接口）请求统一使用 2400 秒读写等待时间，覆盖同步发票、支付截图、付款回单、押金条及月报银行回单 OCR（光学字符识别），避免开发直连成功但生产代理提前返回超时。
批量银行回单和工资凭证路由允许不超过后端既有上限的 1GB 请求体，月报银行回单路由允许 200MB；单文件大小、文件数量和页数仍由后端业务门禁逐项校验。
生产启动日志和环境检查只显示数据库连接是否已配置，不输出完整连接地址、账号或密码。

## 配置文件说明

```
docker-compose.yml         # 开发环境（推荐）
docker-compose.dev.yml     # 兼容旧命令，直接引用开发环境唯一配置
docker-compose.simple.yml  # 仅 PostgreSQL（轻量级）
docker-compose.prod.yml    # 生产运行环境，固定当前已验证镜像且禁止现场构建
Dockerfile                 # 开发与生产共用的多阶段构建文件
scripts/build-production-image.sh # 生产候选镜像的独立安全构建入口
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
- **生产上传文件**：挂载到 `./uploads/production` 目录
- **开发上传文件**：挂载到 `./uploads/development` 目录
- **未归属历史文件**：保存在 `./uploads/unassigned`，不挂载到应用容器
- **调试文件**：挂载到 `./debug` 目录

自动备份会校验 `业务类别/年/月/日/文件` 与 `业务类别/状态目录/年/月/日/.../文件` 两种日期归档结构；历史、已删除、已识别等状态目录均须继续包含真实年月日。不符合任一结构时停止备份，不移动或删除原附件。
月报银行回单的 `monthly-financial-bank/recognized/文件版本号/` 目录是受控例外：原件、页图和裁片按不可变文件版本聚合，业务日期由数据库记录，因此备份时原样保留且不改名。

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

| 模式        | 首次启动时间 | 热重载 | 环境隔离 | 推荐场景         |
| ----------- | ------------ | ------ | -------- | ---------------- |
| 完整 Docker | ~3-5分钟     | ✅     | ✅       | 日常开发（推荐） |
| 轻量级      | ~10秒        | ✅     | ⚠️       | 快速调试         |
| 生产模式    | ~5-10分钟    | ❌     | ✅       | 生产部署         |

## 注意事项

1. **推荐使用完整 Docker 开发模式**
2. 首次构建需要 3-5 分钟，后续启动很快
3. 源代码挂载到容器，修改后自动热重载
4. 数据库数据持久化，停止容器不会丢失数据
5. 如需快速调试，可使用轻量级模式
