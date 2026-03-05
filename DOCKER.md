# Docker 快速启动指南

## 一键启动

直接运行启动脚本：

```bash
./docker-start.sh
```

或使用 npm 命令：

```bash
npm run docker
```

## 常用命令

### 启动服务
```bash
./docker-start.sh          # 完整启动（停止旧容器、构建、启动）
npm run docker             # 同上
npm run docker:start       # 同上
```

### 停止服务
```bash
./docker-stop.sh           # 停止服务
npm run docker:stop        # 同上
```

### 查看日志
```bash
./docker-logs.sh           # 实时查看日志
npm run docker:logs        # 同上
```

### 重启服务
```bash
npm run docker:restart     # 停止并重新启动
```

### 其他命令
```bash
npm run docker:build       # 仅构建镜像（不启动）
npm run docker:up          # 使用 docker compose 启动（不重新构建）
npm run docker:down        # 使用 docker compose 停止
```

## 脚本说明

### docker-start.sh
自动化启动脚本，执行以下操作：
1. 检查 Docker 是否运行
2. 停止并删除旧容器
3. 构建新镜像
4. 启动容器
5. 等待服务就绪
6. 显示访问地址和常用命令

### docker-stop.sh
停止服务脚本，优雅地停止所有容器

### docker-logs.sh
日志查看脚本，实时显示容器日志

## 访问地址

服务启动后访问：http://localhost:8899

## 故障排查

### Docker 未运行
```bash
# macOS
open -a Docker

# 或手动启动 Docker Desktop
```

### 端口被占用
检查 8899 端口是否被占用：
```bash
lsof -i :8899
```

### 查看详细日志
```bash
docker compose logs -f
```

### 清理所有容器和镜像
```bash
docker compose down
docker rmi yulilog:latest
```
