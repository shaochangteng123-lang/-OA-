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
- [server/routes/probation.ts](../server/routes/probation.ts) - 转正管理相关路由
- [server/routes/resignation.ts](../server/routes/resignation.ts) - 离职管理相关路由

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

### 员工路由 (`/api/employees`)
```typescript
GET    /api/employees/list                          // 获取员工列表
GET    /api/employees/statistics                    // 获取员工统计数据
GET    /api/employees/:id                           // 获取单个员工信息
PUT    /api/employees/:id                           // 更新员工信息
DELETE /api/employees/:id                           // 删除员工信息
GET    /api/employees/:id/documents                 // 获取员工人事档案文件
POST   /api/employees/:id/documents                 // 上传员工人事档案文件
DELETE /api/employees/:id/documents/:docId          // 删除员工人事档案文件
GET    /api/employees/:id/documents/:docId/download // 下载/预览员工人事档案文件
GET    /api/employees/:id/resignation-archive       // 获取员工离职档案（离职类型、离职附件、工作交接单）
```

### 离职路由 (`/api/resignation`)
```typescript
GET    /api/resignation/templates                         // 获取离职模板列表
POST   /api/resignation/templates                         // 管理员上传离职模板
DELETE /api/resignation/templates/:id                     // 管理员删除离职模板
GET    /api/resignation/templates/:id/download            // 下载/预览离职模板
GET    /api/resignation/handover-candidates               // 获取交接人候选列表
GET    /api/resignation/my-request                        // 获取我的离职申请
POST   /api/resignation/my-request                        // 保存离职申请草稿
POST   /api/resignation/my-request/upload-application     // 上传离职申请表
POST   /api/resignation/my-request/upload-handover        // 上传离职人交接单
POST   /api/resignation/my-request/upload-document        // 通用文档上传（补充材料）
DELETE /api/resignation/my-request/documents/:docId       // 删除已上传的文档
POST   /api/resignation/my-request/submit                 // 提交离职申请
POST   /api/resignation/my-request/confirm                // 离职人确认交接完成
GET    /api/resignation/handover-task                     // 获取待我处理的交接任务
POST   /api/resignation/:id/handover-upload               // 交接人上传交接单
POST   /api/resignation/:id/handover-confirm              // 交接人确认交接完成
GET    /api/resignation/management                        // 管理员获取离职申请列表
GET    /api/resignation/management/:id                    // 管理员获取离职详情
POST   /api/resignation/management/:id/approve            // 管理员审批通过离职申请
POST   /api/resignation/management/:id/reject             // 管理员驳回离职申请
GET    /api/resignation/requests/:id/documents/:docId/download // 下载离职附件
```


**数据显示规则：**
- `/api/reimbursement/list`：默认显示最近一个月的数据，按创建时间升序排列（早的在下，晚的在上）
- `/api/reimbursement/records`：显示所有历史数据，用于报销统计页面
- 基础报销、大额报销、商务报销页面使用 `/list` 端点，超过一个月的历史数据需在报销统计中查看
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

## 更新日志

- 2026-04-12: 新增离职通用文档上传和删除接口
  - `POST /api/resignation/my-request/upload-document` 支持上传所有类型的离职补充材料（终止劳动关系证明、固定资产交接单等）
  - `DELETE /api/resignation/my-request/documents/:docId` 支持删除已上传的文档，仅允许文档所属申请人删除自己上传的文档
  - 修复补充材料上传时使用错误接口导致的服务器错误
- 2026-04-10: 新增员工离职档案聚合接口，支持员工详情中查看离职类型、离职附件和工作交接单，并在无离职申请记录时按员工离职状态兜底展示
- 2026-04-09: 新增离职管理 API 路由说明，包含模板管理、交接确认、管理员审批和附件下载接口

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

- 2026-04-14: 离职管理审批流程与删除功能修复
  - 新增 `DELETE /api/resignation/management/:id`：管理员删除草稿或已驳回的离职申请
  - 修复 `POST /api/resignation/my-request/submit`：驳回后重新提交时记录"重新提交离职申请"日志（区别于首次提交）
- 2026-04-10: 调整离职页面结构与管理员模板入口展示
  - 前端员工端离职页增加“离职管理｜待我处理”内部切换，不新增新路由
  - 管理员端离职模板管理区仅展示 5 类补充模板入口，接口结构本身不变
- 2026-04-09: 离职接口支持按离职原因动态校验必传材料，并扩展模板类型
  - `POST /api/resignation/my-request/submit` 会按离职类型校验员工侧必传材料是否齐全，并返回缺失材料信息
  - `GET /api/resignation/management/:id` 补充返回 `requiredDocumentTypes`、`missingDocumentTypes`，供管理端详情展示缺项
  - `POST /api/resignation/templates` 支持上传离职申请表、交接单、终止/解除劳动关系证明、固定资产交接单、离职经济补偿协议书、离职其他费用结算约定、合伙人离任分红结算模板
  - 当前离职补充材料规则包含终止/解除劳动关系证明、固定资产交接单、离职经济补偿协议书、离职其他费用结算约定；其中离职经济补偿协议书仅在“被辞退”时必传
- 2026-04-09: 人力资源区上传接口统一为仅支持 PDF
  - `POST /api/probation/upload-doc`、`POST /api/probation/templates` 仅支持 PDF
  - `POST /api/employees/:id/documents`、`POST /api/employees/onboarding/templates` 仅支持 PDF
  - 对应前端页面已统一标注“仅支持 PDF”，后端也统一使用 PDF 白名单兜底
- 2026-04-09: 转正文件上传统一收敛为 PDF
  - `POST /api/probation/upload-doc` 仅支持 PDF 文件上传
  - `POST /api/probation/templates` 仅支持 PDF 模板上传
  - 转正文件继续通过浏览器内打开 PDF 查看，不再支持 DOC/DOCX/图片上传
- 2026-04-09: 支持转正 DOCX 文件在线预览
  - 员工端与总经理端复用统一的 DOCX 预览组件，通过现有下载接口拉取 blob 后在弹窗内渲染
  - `.doc` 文件继续下载查看，PDF/图片保持原在线查看行为
  - 现有转正文件下载接口继续复用，无需新增专门的预览接口
- 2026-04-09: 调整转正列表接口提交时间为首次送审时间
  - `GET /api/probation/list` 的 `submit_time` 改为优先返回审批记录中第一次 `submit/resubmit` 的 `action_time`
  - 避免返回材料上传时间或最后一次重提时间，确保与管理端“提交时间”业务语义一致
- 2026-04-09: 调整转正列表接口提交时间语义
  - `GET /api/probation/list` 的 `submit_time` 改为优先返回该申请最早上传材料时间 `probation_documents.created_at`
  - 当无上传材料记录时，再回退到审批记录中的 `submit/resubmit` 时间，避免将审批节点时间误显示为材料提交时间
- 2026-04-09: 修正转正列表接口提交时间返回逻辑
  - `GET /api/probation/list` 的 `submit_time` 改为优先返回审批记录中最近一次 `submit/resubmit` 的 `action_time`
  - 避免申请表主表字段在重提或代提等流程场景下与真实提交动作时间不一致
- 2026-04-09: 优化转正文件预览与下载接口行为
  - `GET /api/probation/templates/:id/download` 按文件类型返回 `inline/attachment`，图片和 PDF 在线查看，DOC/DOCX 下载查看
  - `GET /api/probation/my-doc/:docId/download` 调整为同样的预览/下载策略
  - `GET /api/probation/:id/documents/:docId/download` 补齐总经理端转正文件下载接口，并按文件类型返回合适的 Content-Disposition
- 2026-04-08: 新增转正申请说明展示能力
  - `probation_confirmations` 新增 `application_comment` 字段，用于存储员工提交转正申请时填写的说明
  - `POST /api/probation/upload-doc` 支持同时保存申请说明
  - `POST /api/probation/apply` 在 submit/resubmit 审批记录中带出申请说明，供审批流程展示
  - 转正详情与审批流程页面同步展示申请说明；驳回后仍不允许撤回，只能删除记录
- 2026-04-08: 优化员工端转正页默认展示规则
  - `GET /api/probation/my-status` 在无真实转正记录且用户未转正时，返回虚拟 `pending` 状态，前端默认显示“实习期”
  - `/api/probation/my-status` 返回的 `probation_end_date` 继续按入职时间加 6 个月计算
  - 员工端转正页面将“剩余天数”改为展示试用期总天数（截止时间减入职时间），并在“转正申请表”列直接显示上传入口和已上传文件
- 2026-04-08: 修复员工端转正记录删除后按钮显示与测试清理说明
  - `GET /api/probation/my-status` 新增 `hasRealConfirmation` 返回字段，用于区分真实转正记录与试用期虚拟 `pending` 状态
  - `GET /api/probation/my-status` 保留 `hasHistory`，供前端判断撤回后是否允许删除记录
  - `DELETE /api/probation/my-record` 可清理当前用户的转正主记录、转正文件、审批实例、审批记录及关联物理文件，用于重新测试转正流程
- 2026-04-03: 修复报销模块安全和逻辑缺陷
  - 核减发票上传：新增服务端金额校验，防止客户端篡改金额（`deductionOcrCache` 缓存校验）
  - 银行回单提交：修复 fileHash 与 proofNo 错位绑定问题（单笔和批量付款）
  - 发票识别：修复回退逻辑缺陷，确保最终结果包含完整关键字段（金额、日期、发票号）
  - 发票识别：修复异常被误判为有效发票问题，识别失败时标记 `isValidInvoice: false`
  - 发票上传：修正识别失败的 HTTP 状态码（业务错误返回 400，服务器错误返回 500）
  - 回单识别：修复中文大写金额解析错误（处理省略"壹"的写法，如"拾贰元"）
- 2026-03-27: 修复 departments.ts 路由注册顺序问题
  - `/org-options` GET/POST 路由移至 `/:id` 路由之前，避免被通配参数路由拦截返回 404
- 2026-03-26: 转正审批路由修复 PostgreSQL 事务一致性问题
  - `server/routes/probation.ts` 中审批通过/驳回流程改为在同一 `db.transaction(async (client) => ...)` 连接内执行全部 SQL
  - 新增事务内参数占位符转换与 `txRun` 封装，避免跨连接执行导致的“伪事务”
- 2026-03-26: 审批流程详情接口字段与前端类型同步
  - `GET /api/approval/by-target` 返回的 `adminApproverName`、`gmApproverName` 已在前端审批流程类型中声明
  - 修复审批流程弹窗读取审批人名称时的 TypeScript 报错
- 2026-03-26: 报销路由适配 PostgreSQL 异步 db 接口
  - `server/routes/reimbursement.ts` 中所有 `db.prepare(...).get/all/run` 已改为 `await` 调用，并统一保持异步路由处理
  - 创建、更新、撤回、删除、恢复等写操作已改为 PostgreSQL `db.transaction(async (client) => ...)` 事务写法
  - 发票分类聚合改为 PostgreSQL `STRING_AGG(DISTINCT ..., ',')`，软删除布尔字段判断统一改为 boolean 语义
- 2026-03-26: 审批中心路由适配 PostgreSQL 异步 db 接口
  - `server/routes/approval.ts` 中所有 `db.prepare(...).get/all/run` 调整为 `await` 调用，对应路由处理函数改为 `async`
  - 发票分类聚合函数由 `GROUP_CONCAT` 改为 PostgreSQL 兼容的 `STRING_AGG(DISTINCT ..., ',')`
  - 已删除报销单布尔字段判断改为 PostgreSQL boolean 判断
- 2026-03-13: 审批中心API新增报销类型和报销范围字段
  - GET /api/approval/pending 返回新增 invoiceCategories（发票分类聚合）、reimbursementScope 字段
  - GET /api/approval/approved-unpaid 返回新增 invoiceCategories、reimbursementScope 字段
  - GET /api/approval/paid-this-month 返回新增 invoiceCategories、reimbursementScope 字段
- 2026-03-13: 新增报销单恢复接口 POST /api/reimbursement/:id/restore
  - 已删除的报销单可恢复，清除 is_deleted 标记和 deleted_at 时间
  - 前端已删除报销单操作列显示"查看"和"恢复"按钮
- 2026-03-13: 新增报销单撤回接口 POST /api/reimbursement/:id/withdraw
  - 仅待审批（pending）状态的报销单可撤回，撤回后状态回到草稿（draft）
  - 同时将对应审批实例状态改为 withdrawn，管理员审批页面不再显示已撤回的报销单
  - 审批待办查询和计数接口排除 withdrawn 状态
- 2026-03-13: 统一报销事由标题格式为 YYYY年MM月-基础报销/大额报销/商务报销
  - 在 reimbursement.ts 和 approval.ts 中添加 normalizeReimbursementTitle 函数
  - 所有返回报销列表的接口自动格式化 title 字段，兼容旧数据
- 2026-03-13: 优化报销列表排序和数据显示规则
  - GET /api/reimbursement/list 改为按创建时间升序排列（早的在下，晚的在上）
  - 默认显示最近一个月的数据，超过一个月的历史数据需在报销统计中查看
  - 更新基础报销、大额报销、商务报销页面的提示信息
- 2026-03-13: GET /api/approval/pending 新增筛选参数支持
  - 支持 userId（员工）、type（类型，逗号分隔）、status（状态）、startDate/endDate（日期范围）
- 2026-03-12: 新增统一待办计数接口 GET /api/approval/pending-counts
  - 根据用户角色返回所有待办数量（审批中心、转正、报销待确认收款等）
  - 一次请求返回全部数据，避免前端多次请求
- 2026-03-12: 优化审批统计接口和待办列表接口
  - GET /api/approval/statistics 新增 basicStats/largeStats/businessStats 按类型当月统计
  - GET /api/approval/pending 返回除已完成外所有状态，按待审批→待支付→待确认排序，新增 reimbursementStatus/reimbursementUserId 字段
- 2026-03-12: 安全修复 - 修复 approval.ts 中 prefer-const 错误（日期查询变量声明方式）
- 2026-03-12: 修复报销单详情接口 GET /api/reimbursement/:id 缺失 reimbursement_month 和 service_target 字段的问题
- 2026-01-31: 优化转正管理 API，确保管理员端与用户端数据一致（入职日期、试用期截止日期动态计算）
- 2026-01-23: 添加报销管理路由，支持发票上传和OCR识别功能
- 2026-01-22: 创建文档，描述 API 路由模块核心功能
- 2026-04-07: 修复财务区审批中心错误显示转正申请记录的问题
  - GET /api/approval/statistics：super_admin 的 typeFilter 增加 `AND ai.target_type = 'reimbursement'` 排除转正记录
  - GET /api/approval/pending：条件增加 `ai.target_type != 'probation'` 排除转正记录
  - GET /api/approval/pending-counts：super_admin 的 typeFilter 增加 `AND ai.target_type = 'reimbursement'` 排除转正记录
  - 转正申请只应出现在人力资源区审批中心（总经理审批）
- 2026-04-08: 转正模块优化
  - DELETE /api/probation/my-record：允许撤回后（pending 且有历史提交记录）删除转正记录，不再仅限 rejected 状态
  - GET /api/approval/pending-counts：修复总经理 probationPending 查询条件错误（`pc.status = 'pending'` 改为 `pc.status = 'submitted'`），确保员工提交后总经理菜单栏角标正确显示
  - 前端审批流程时间线过滤 withdraw 记录，撤回后重新提交不再显示撤回历史
- 2026-04-08: 转正模块优化
  - DELETE /api/probation/my-record：允许撤回后（pending 且有历史提交记录）删除，不再仅限 rejected 状态
  - GET /api/approval/pending-counts：修复总经理 probationPending 查询条件错误（`pc.status = 'pending'` 改为 `pc.status = 'submitted'`），确保员工提交后总经理菜单栏角标正确显示
  - 前端审批流程时间线过滤 withdraw 记录，撤回后重新提交不再显示撤回节点
- 2026-04-02: 财务区安全与一致性修复 - PUT /api/reimbursement/:id 补齐 is_deduction 字段写入；/:id/deduction-invoices POST 接口增加 filePath session 归属校验；核减发票删除前强制 validateFilePath；付款回单 OCR cache 绑定 targetType/targetId/verifierId/fileHash，提交时严格匹配并一次性消费；审批通过/驳回改为事务写入；商务报销 client/service_target 更新时同步双写；大额报销后端阈值已统一为 >=1000（<1000 拒绝）
- 2026-04-12: 员工数据合同到期功能
  - POST /api/employees/my-profile：保存/创建员工信息时根据 hire_date 自动计算 contract_end_date（+1年）
  - PUT /api/employees/:id：管理员编辑员工信息时同步计算 contract_end_date
  - GET /api/employees/list：员工列表排序优先展示合同到期前10天的员工（置顶），返回 contract_end_date 字段
- 2026-04-12: 转正管理全员显示优化
  - GET /api/probation/list：全部查询（无 status 参数）和 status=pending 时，通过 UNION ALL 查询包含未提交转正申请的实习期员工（虚拟记录 id 以 `virtual_` 开头）
  - GET /api/probation/statistics：pending 和 total 计数包含未申请转正的实习期员工数量
