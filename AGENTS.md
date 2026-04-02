# AGENTS.md

本文件用于约束 Codex 在本仓库中的协作行为（精简版，优先减少上下文占用）。

## ⚠️ 语言规则（最高优先级）

> 本规则优先级高于其他规则，不可覆盖。

- 必须始终使用中文与用户对话
- 所有文本输出、代码注释、错误解释均使用中文
- 技术术语可保留英文，但解释必须是中文
- 凡出现英文术语，统一使用 `English（中文）` 格式（如：`Critical（严重）`、`transaction（事务）`）

## 工作准则

- 修改前先评估影响范围（前端/后端/API/数据库/类型）
- 字段或接口变更必须同步所有引用位置
- 优先做最小必要修改，避免无关重构

## 文档同步（强制）

每次代码修改完成后，必须同步更新 `user/` 下对应模块文档：

- `user/01-认证模块.md`（已弃用，参考 10）
- `user/02-日历模块.md`
- `user/03-工作日志模块.md`
- `user/04-项目管理模块.md`
- `user/05-用户管理模块.md`
- `user/06-路由与布局模块.md`
- `user/07-API路由模块.md`
- `user/08-数据库模块.md`
- `user/09-服务集成模块.md`
- `user/10-账号密码认证模块.md`

更新要求：

- 新增或调整功能/API/数据模型时，更新对应文档
- 跨模块改动时，更新所有相关文档
- 在文档末尾“更新日志”追加：`- YYYY-MM-DD: 简要描述`

## 验证与部署

- 按改动范围执行必要检查（如 `npm run lint`、`npm run type-check`、`npm run test:run`）
- 若需要 Docker 部署验证，执行：

```bash
docker compose down
docker compose up -d --build
```

## 项目关键信息（简表）

- 技术栈：Vue 3 + Express + PostgreSQL + express-session
- 认证方式：账号密码登录（bcrypt）
- 端口：前端开发 `8899`，后端开发 `3000`，生产 `8899`
- 路径别名：`@/` -> `src/`，`@server/` -> `server/`

## 常用入口文件

- `src/stores/auth.ts`
- `src/types/index.ts`
- `src/router/index.ts`
- `src/utils/api.ts`
- `server/index.ts`
- `server/db/index.ts`
- `server/middleware/auth.ts`
- `server/routes/auth.ts`

## 详细资料

- 通用说明：`README*`、`DOCKER.md`
- 模块文档：`user/`
- 其他补充：`docs/`
