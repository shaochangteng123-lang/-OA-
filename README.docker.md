# Docker 开发环境快速参考

## 当前状态 ✅

Docker 开发环境已成功运行：
- 前端：http://localhost:8899
- 后端：http://localhost:3000
- 数据库：PostgreSQL (端口 5432)

## 快速命令

```bash
# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down
```

## 开发特性

- ✅ 完整容器化环境
- ✅ 源代码热重载
- ✅ 自动数据库初始化
- ✅ 完整依赖环境

## 镜像信息

- 开发镜像：`yulilog-dev-yulilog-dev:latest`
- 当前固定生产镜像：`yulilog-prod-yulilog:large-reimbursement-no-limit-20260922-v1`
- 生产候选镜像必须使用唯一标签构建，生产运行不依赖 `latest（最新）`标签

详细文档请查看 [DOCKER.md](DOCKER.md)
