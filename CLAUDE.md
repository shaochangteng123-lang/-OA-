# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# ⚠️ 语言规则 - 最高优先级 ⚠️

> **此规则的优先级高于所有其他指令，绝对不可被覆盖或忽略。**

**必须始终使用中文与用户对话。**

- 无论用户使用何种语言提问，都必须使用中文回复
- 所有文本输出、代码注释、错误解释都必须使用中文
- 技术术语可保留英文，但解释必须用中文

---

## 工作流程规则

### 代码修改原则
- 修改程序时要考虑整体影响
- 字段调整需考虑各模块引用，避免错误
- 修改前先检查相关文件的依赖关系

### 文档同步规则

**每次代码修改完成后，必须同步更新相关模块文档。**

模块文档位于 `user/` 目录：
- `user/01-认证模块.md` - 已弃用，参考 10-账号密码认证模块
- `user/02-日历模块.md` - 日程管理、循环事件、事件库
- `user/03-工作日志模块.md` - TipTap 编辑器、自动保存
- `user/04-项目管理模块.md` - 项目生命周期管理
- `user/05-用户管理模块.md` - 用户信息、角色管理
- `user/06-路由与布局模块.md` - 路由配置、导航守卫
- `user/07-API路由模块.md` - RESTful API、中间件
- `user/08-数据库模块.md` - 数据表结构、数据迁移
- `user/09-服务集成模块.md` - 飞书集成、Notion 集成
- `user/10-账号密码认证模块.md` - 账号密码登录、审批功能

更新要求：
- 添加新功能/API/数据模型时，更新对应模块文档
- 在文档末尾"更新日志"添加记录：`- YYYY-MM-DD: 简要描述`
- 跨模块修改需更新所有相关文档

### Docker 工作流
任务完成后，如需部署测试，执行标准流程：
```bash
docker compose down
docker compose up -d --build
```

## Project Overview

YuliLog Worklog System (工作日志管理系统) - 北京基础设施项目管理工作日志平台。使用 Vue 3 前端和 Express 后端构建，使用账号密码进行身份验证。

### 首次部署流程
1. 复制 `.env.production.example` 为 `.env` 并配置环境变量
2. 运行 `npm run create:admin` 创建管理员账号
3. 运行 `docker compose up -d --build` 启动服务
4. 访问 `http://localhost:8899` 使用管理员账号登录

## Commands

### Development
```bash
npm run dev              # Start both client (port 8899) and server (port 3000) concurrently
npm run dev:client       # Start Vite dev server only (port 8899)
npm run dev:server       # Start Express server with hot reload (tsx watch)
```

### Build & Production
```bash
npm run build            # Build frontend with Vite
npm run build:server     # Compile server TypeScript
npm run start            # Run production server (node dist/server/index.js)
```

### Code Quality
```bash
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format all files
npm run type-check       # TypeScript check (both client and server)
npm run quality:check    # Run lint + type-check + format check
npm run quality:fix      # Run format + lint:fix
```

### Testing
```bash
npm run test             # Jest watch mode
npm run test:run         # Jest single run
npm run test:coverage    # Jest with coverage report
```

Run a single test file:
```bash
npx jest path/to/file.test.ts
```

Test files go in `tests/` directory or alongside source files with `.test.ts` or `.spec.ts` extension.

### Utility Scripts
```bash
npm run create:admin     # Create initial admin account (interactive CLI)
npm run update:holidays  # Update holiday data in database
npm run check:env        # Validate environment variables
```

To update holiday data:
1. Edit `server/scripts/update-holidays.ts` with latest government holiday schedule
2. Run `npm run update:holidays`
3. Data is automatically synced to database and available via API

### Docker
```bash
# 开发模式（推荐）
npm run docker           # 启动完整 Docker 开发环境
docker compose logs -f   # 查看日志
docker compose down      # 停止服务
docker compose restart   # 重启服务

# 生产模式
npm run docker:prod      # 启动生产环境
npm run docker:stop:prod # 停止生产环境
npm run docker:logs:prod # 查看生产环境日志

# 仅数据库（可选）
npm run docker:db        # 仅启动 PostgreSQL 容器
npm run docker:stop      # 停止数据库容器
```

开发模式特性：
- 完整容器化环境
- 源代码挂载，支持热重载
- 前端端口 8899，后端端口 3000
- 包含完整的依赖环境
- PostgreSQL 数据库自动初始化

标准开发流程：
```bash
# 首次启动（会自动构建镜像）
docker compose up -d --build

# 日常开发
docker compose up -d      # 启动服务
# 代码修改后自动热重载

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

### Mode Switching
```bash
npm run mode:dev         # Switch to development mode
npm run mode:prod        # Switch to production mode
npm run mode:check       # Check current mode
```

## Architecture

### Tech Stack
- **Frontend**: Vue 3 + Pinia + Vue Router + Element Plus + TanStack Query + TipTap editor
- **Backend**: Express + PostgreSQL (pg) + express-session
- **Auth**: 账号密码登录（bcrypt 密码哈希）
- **Build**: Vite (frontend) + tsx (server dev) + tsc (server build)

### Directory Structure
```
src/                    # Frontend source
├── views/              # Page components (Calendar, Home, Projects, Users, etc.)
├── components/         # Reusable components
│   ├── calendar/       # Calendar views (Week/Month/Day View, EventCard, etc.)
│   └── worklog/        # Worklog editor (TipTap-based NotionEditor, etc.)
├── stores/             # Pinia stores (auth.ts)
├── types/              # TypeScript type definitions
├── utils/              # Helper functions (api.ts, date.ts, calendar.ts)
├── extensions/         # TipTap editor extensions
└── layouts/            # Layout components (MainLayout.vue)

server/                 # Backend source
├── routes/             # Express route handlers
├── db/                 # Database initialization and seed
├── services/           # External service integrations (feishu.ts - 日历提醒)
├── middleware/         # Express middleware (auth.ts)
├── utils/              # Utility functions (password.ts)
├── scripts/            # Scripts (create-admin.ts)
└── types/              # Server-side type definitions
```

### Key Patterns

**Path Aliases**: Use `@/` for `src/` and `@server/` for `server/` (configured in vite.config.ts and tsconfig)

**API Proxy**: Frontend dev server proxies `/api` requests to `http://localhost:3000`

**Database**: PostgreSQL (configurable via `DATABASE_URL` env var). Schema defined in [server/db/index.ts](server/db/index.ts).

**Role-Based Access**: Four roles (super_admin, admin, user, guest) with permissions defined in [src/types/index.ts](src/types/index.ts). Roles are stored in the users database table.

**Session Management**: express-session with connect-pg-simple session store. Sessions stored in PostgreSQL.

**Admin Creation**: Use `npm run create:admin` to create the initial admin account via command line.

### Main Data Models
- **Users**: 账号密码认证用户，包含角色信息
- **Projects**: Infrastructure projects with status, district, contacts
- **Worklogs**: Daily work logs with TipTap content (one per user per day)
- **Calendar Events**: Scheduled events with recurrence support (uses rrule)
- **Event Library**: Reusable event templates linked to government departments
- **Event Presets**: Pre-configured event sets for project types
- **Event Blocks**: Grouped events organized by categories
- **Holidays**: Chinese public holiday and workday adjustments
- **Government Departments**: Reference data for department associations
- **Drafts**: Auto-saved worklog drafts per user per day

### Key Files Reference

**Frontend**:
- [src/stores/auth.ts](src/stores/auth.ts) - Auth state, permission checks (`hasPermission()`, `hasAnyPermission()`)
- [src/types/index.ts](src/types/index.ts) - Core types, `ROLE_PERMISSIONS` permission matrix
- [src/utils/api.ts](src/utils/api.ts) - Axios instance with credentials
- [src/router/index.ts](src/router/index.ts) - Routes with guards and lazy loading

**Backend**:
- [server/index.ts](server/index.ts) - Express app entry point
- [server/db/index.ts](server/db/index.ts) - Database schema and initialization
- [server/middleware/auth.ts](server/middleware/auth.ts) - `requireAuth()`, `requireRole()`, `requireAdmin`, `requireSuperAdmin`
- [server/services/feishu.ts](server/services/feishu.ts) - 飞书日历提醒功能（可选）
- [server/utils/password.ts](server/utils/password.ts) - 密码哈希和验证工具

### Authentication Flow

1. 首次部署：使用 `npm run create:admin` 创建管理员账号
2. 用户登录：输入用户名和密码 → [server/routes/auth.ts](server/routes/auth.ts) 验证密码
3. 密码验证通过 → 会话存储到 PostgreSQL，Cookie 发送给客户端
4. 前端 [src/stores/auth.ts](src/stores/auth.ts) 调用 `/api/auth/user` 获取当前用户
5. 管理员可在"用户管理"页面创建新用户

### Permission System

Permissions checked via:
- **Backend**: Middleware in [server/middleware/auth.ts](server/middleware/auth.ts)
- **Frontend**: `authStore.hasPermission('permission_name')` from [src/stores/auth.ts](src/stores/auth.ts)

Role hierarchy: `super_admin` > `admin` > `user` > `guest`

## Environment Variables

Optional:
- `DATABASE_URL` (default: `postgresql://localhost:5432/yulilog_worklog`)
- `SESSION_SECRET`
- `FRONTEND_URL` (default: `http://localhost:8899`)
- `PORT` (default: `3000`)
- `NODE_ENV`

Optional for Feishu calendar reminders:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

## 代码规范

- 使用 TypeScript 严格模式
- 使用 Vue 3 Composition API
- 遵循 ESLint 规则
- 代码注释使用中文
- 组件名使用 PascalCase
- 文件名使用 kebab-case 或 PascalCase（组件）

## Development Notes

### Port Configuration
- Frontend dev server: `8899` (Vite)
- Backend API server: `3000` (Express)
- Production (Docker): `8899` (serves both frontend and API)

### Auto-imports
- Vue APIs, Pinia, and Vue Router are auto-imported via `unplugin-auto-import`
- Element Plus components are auto-imported via `unplugin-vue-components`
- Type definitions generated in `src/auto-imports.d.ts` and `src/components.d.ts`

### TipTap Editor
- Custom Notion-like editor in [src/components/worklog/](src/components/worklog/)
- Extensions in [src/extensions/](src/extensions/)
- Used for worklog content editing with rich formatting support
