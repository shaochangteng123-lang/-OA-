# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YuliLog Worklog System (工作日志管理系统) - A work log management platform for Beijing infrastructure project management. Built with Vue 3 frontend and Express backend, using Feishu (飞书) OAuth for authentication.

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

Test files go in `tests/` directory or alongside source files with `.test.ts` or `.spec.ts` extension.

## Architecture

### Tech Stack
- **Frontend**: Vue 3 + Pinia + Vue Router + Element Plus + TanStack Query + TipTap editor
- **Backend**: Express + better-sqlite3 + express-session
- **Auth**: Feishu OAuth (飞书登录)
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
├── services/           # External service integrations (feishu.ts)
├── middleware/         # Express middleware (auth.ts)
├── config/             # Configuration files (admins.json)
└── types/              # Server-side type definitions
```

### Key Patterns

**Path Aliases**: Use `@/` for `src/` and `@server/` for `server/` (configured in vite.config.ts and tsconfig)

**API Proxy**: Frontend dev server proxies `/api` requests to `http://localhost:3000`

**Database**: SQLite stored at `data/worklog.db` (configurable via `DATABASE_PATH` env var). Schema defined in [server/db/index.ts](server/db/index.ts).

**Role-Based Access**: Four roles (super_admin, admin, user, guest) with permissions defined in [src/types/index.ts](src/types/index.ts). Admin roles configured via `server/config/admins.json`.

**Session Management**: express-session with better-sqlite3 session store. Sessions stored in the same database.

### Main Data Models
- **Users**: Feishu-authenticated users with roles
- **Projects**: Infrastructure projects with status, district, contacts
- **Worklogs**: Daily work logs with TipTap content
- **Calendar Events**: Scheduled events with recurrence support
- **Event Library**: Reusable event templates
- **Event Presets**: Pre-configured event sets for project types

## Environment Variables

Required for Feishu authentication:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`

Optional:
- `DATABASE_PATH` (default: `./data/worklog.db`)
- `SESSION_SECRET`
- `FRONTEND_URL` (default: `http://localhost:8899`)
- `PORT` (default: `3000`)
- `NODE_ENV`
