# 07 - API 路由模块

## 模块概述

API 路由模块是后端的核心，负责处理所有 HTTP 请求，提供 RESTful API 接口供前端调用。

## 主要功能

### 1. RESTful API 设计
- 遵循 REST 规范
- 标准化的请求/响应格式
- 统一的错误处理
- API 版本管理

### 2. 路由分组
- 按业务模块划分路由
- 清晰的路由命名空间
- 模块化路由管理

### 3. 请求验证
- 参数验证（使用 Zod）
- 数据格式校验
- 业务规则验证

### 4. 响应处理
- 统一的响应格式
- 错误码规范
- 数据序列化

## 核心文件

### 路由文件
- [server/routes/auth.ts](../server/routes/auth.ts) - 认证相关路由
- [server/routes/calendar.ts](../server/routes/calendar.ts) - 日历相关路由
- [server/routes/worklogs.ts](../server/routes/worklogs.ts) - 工作日志相关路由
- [server/routes/projects.ts](../server/routes/projects.ts) - 项目管理相关路由
- [server/routes/users.ts](../server/routes/users.ts) - 用户管理相关路由
- [server/routes/reimbursement.ts](../server/routes/reimbursement.ts) - 报销管理相关路由

### 主入口
- [server/index.ts](../server/index.ts) - Express 应用入口

## 路由结构

### 认证路由 (`/api/auth`)
```typescript
GET  /api/auth/feishu          // 获取飞书登录 URL
GET  /api/auth/feishu/callback // 飞书登录回调
GET  /api/auth/me              // 获取当前用户信息
POST /api/auth/logout          // 退出登录
```

### 日历路由 (`/api/calendar`)
```typescript
GET    /api/calendar/events              // 获取日程列表
POST   /api/calendar/events              // 创建日程
GET    /api/calendar/events/:id          // 获取日程详情
PUT    /api/calendar/events/:id          // 更新日程
DELETE /api/calendar/events/:id          // 删除日程
GET    /api/calendar/library             // 获取事件库
POST   /api/calendar/library             // 创建事件模板
GET    /api/calendar/holidays            // 获取节假日数据
```

### 工作日志路由 (`/api/worklogs`)
```typescript
GET    /api/worklogs              // 获取工作日志列表
POST   /api/worklogs              // 创建工作日志
GET    /api/worklogs/:date        // 获取指定日期的日志
PUT    /api/worklogs/:id          // 更新工作日志
DELETE /api/worklogs/:id          // 删除工作日志
GET    /api/drafts/:date          // 获取草稿
POST   /api/drafts/:date          // 保存草稿
```

### 项目路由 (`/api/projects`)
```typescript
GET    /api/projects              // 获取项目列表
POST   /api/projects              // 创建项目
GET    /api/projects/:id          // 获取项目详情
PUT    /api/projects/:id          // 更新项目
DELETE /api/projects/:id          // 删除项目
PUT    /api/projects/:id/status   // 更新项目状态
```

### 用户路由 (`/api/users`)
```typescript
GET    /api/users                 // 获取用户列表
GET    /api/users/:id             // 获取用户详情
PUT    /api/users/:id             // 更新用户信息
PUT    /api/users/:id/role        // 更新用户角色
PUT    /api/users/:id/status      // 启用/禁用用户
```

### 报销路由 (`/api/reimbursement`)
```typescript
POST   /api/reimbursement/upload-invoice  // 上传发票并进行OCR识别
POST   /api/reimbursement/compress-pdf    // 压缩PDF文件
```

## 中间件

### 认证中间件
```typescript
import { requireAuth, requireAdmin, requireSuperAdmin } from './middleware/auth'

// 需要登录
router.get('/api/protected', requireAuth, handler)

// 需要管理员权限
router.post('/api/admin', requireAdmin, handler)

// 需要超级管理员权限
router.delete('/api/system', requireSuperAdmin, handler)
```

### 请求验证中间件
```typescript
import { z } from 'zod'

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().optional(),
  district: z.string().optional()
})

router.post('/api/projects',
  validate(createProjectSchema),
  handler
)
```

### 错误处理中间件
```typescript
app.use((err, req, res, next) => {
  console.error(err)

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    code: err.code
  })
})
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "项目名称"
  }
}
```

### 列表响应
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

### 错误响应
```json
{
  "success": false,
  "message": "错误信息",
  "code": "ERROR_CODE"
}
```

## 路由示例

### 创建日程
```typescript
// server/routes/calendar.ts
router.post('/events', requireAuth, async (req, res) => {
  try {
    const { title, start_time, end_time, recurrence_rule } = req.body
    const userId = req.session.user.id

    const event = db.prepare(`
      INSERT INTO calendar_events
      (title, start_time, end_time, recurrence_rule, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, start_time, end_time, recurrence_rule, userId)

    res.json({
      success: true,
      data: { id: event.lastInsertRowid }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})
```

### 获取工作日志
```typescript
// server/routes/worklogs.ts
router.get('/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params
    const userId = req.session.user.id

    const worklog = db.prepare(`
      SELECT * FROM worklogs
      WHERE user_id = ? AND log_date = ?
    `).get(userId, date)

    res.json({
      success: true,
      data: worklog
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
})
```

## 权限控制

### 路由级权限
```typescript
import { requirePermission } from './middleware/auth'

// 需要特定权限
router.post('/api/projects',
  requireAuth,
  requirePermission('projects.create'),
  handler
)
```

### 资源所有权检查
```typescript
router.put('/api/worklogs/:id', requireAuth, async (req, res) => {
  const worklog = db.prepare('SELECT * FROM worklogs WHERE id = ?')
    .get(req.params.id)

  // 检查是否是资源所有者或管理员
  if (worklog.user_id !== req.session.user.id
      && !['admin', 'super_admin'].includes(req.session.user.role)) {
    return res.status(403).json({
      success: false,
      message: '无权限操作该资源'
    })
  }

  // 执行更新操作...
})
```

## 请求限流

```typescript
import rateLimit from 'express-rate-limit'

// API 限流
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 个请求
  message: '请求过于频繁，请稍后再试'
})

app.use('/api/', limiter)

// 登录接口特殊限流
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: '登录尝试次数过多，请稍后再试'
})

app.use('/api/auth/login', loginLimiter)
```

## 特色功能

### 1. 统一的错误处理
- 全局错误捕获
- 错误日志记录
- 友好的错误提示

### 2. 请求日志
- 记录所有 API 请求
- 性能监控
- 审计跟踪

### 3. CORS 配置
```typescript
import cors from 'cors'

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8899',
  credentials: true
}))
```

### 4. 安全防护
```typescript
import helmet from 'helmet'

// 设置安全 HTTP 头
app.use(helmet())

// CSRF 保护
// XSS 防护
// SQL 注入防护
```

## 注意事项

1. **参数验证**：
   - 所有用户输入必须验证
   - 使用 Zod 或类似库进行类型校验
   - 防止 SQL 注入和 XSS 攻击

2. **错误处理**：
   - 不要暴露敏感的错误信息
   - 记录详细错误日志供调试
   - 返回友好的错误提示给用户

3. **性能优化**：
   - 对慢查询进行优化
   - 使用数据库索引
   - 实现适当的缓存策略

4. **API 版本管理**：
   - 重大变更时创建新版本
   - 保持向后兼容
   - 提前通知废弃的 API

## 更新日志

- 2026-03-12: 优化审批统计接口和待办列表接口
  - GET /api/approval/statistics 新增 basicStats/largeStats/businessStats 按类型当月统计
  - GET /api/approval/pending 返回除已完成外所有状态，按待审批→待支付→待确认排序，新增 reimbursementStatus/reimbursementUserId 字段
- 2026-03-12: 安全修复 - 修复 approval.ts 中 prefer-const 错误（日期查询变量声明方式）
- 2026-03-12: 修复报销单详情接口 GET /api/reimbursement/:id 缺失 reimbursement_month 和 service_target 字段的问题
- 2026-01-31: 优化转正管理 API，确保管理员端与用户端数据一致（入职日期、试用期截止日期动态计算）
- 2026-01-23: 添加报销管理路由，支持发票上传和OCR识别功能
- 2026-01-22: 创建文档，描述 API 路由模块核心功能
