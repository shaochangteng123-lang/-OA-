# 离职系统数据结构完整说明

## 系统概述

该项目包含完整的**离职管理（Resignation）**和**入职管理（Onboarding）**功能模块。离职流程是一个多方参与、多阶段的业务流程，涉及离职人、交接人、管理员三个角色。

---

## 一、数据库表结构

### 1. resignation_requests 表（离职申请主表）

**用途**：记录每个员工的离职申请信息

**字段定义**：

| 字段名 | 类型 | 非空 | 说明 |
|--------|------|------|------|
| id | TEXT | ✓ | 主键，唯一标识符（nanoid） |
| employee_id | TEXT | ✓ | 外键，关联 employee_profiles.id（离职员工档案） |
| employee_user_id | TEXT | ✓ | 外键，关联 users.id（离职员工用户账号） |
| handover_user_id | TEXT | ✓ | 外键，关联 users.id（交接人用户账号） |
| handover_name | TEXT | - | 交接人名称（冗余字段，提高查询效率） |
| resign_type | TEXT | ✓ | 离职类型：`voluntary`(主动离职) \| `contract_end`(合同到期) \| `dismissal`(辞退) |
| resign_date | TEXT | ✓ | 离职日期（YYYY-MM-DD格式），需至少提前1个月申请 |
| reason | TEXT | - | 离职原因/说明文本 |
| status | TEXT | ✓ | 离职状态（见状态流转说明） |
| reject_target | TEXT | - | 驳回对象：`employee`\|`handover`\|`both`\|null（用于管理员驳回时指定目标） |
| employee_confirm_time | TEXT | - | 离职人确认交接完成的时间戳（ISO8601格式） |
| handover_confirm_time | TEXT | - | 交接人确认交接完成的时间戳 |
| submit_time | TEXT | - | 离职申请提交时间 |
| approve_time | TEXT | - | 管理员审批时间 |
| approver_id | TEXT | - | 外键，关联 users.id（审批管理员） |
| approver_comment | TEXT | - | 管理员审批意见（驳回原因或批准备注） |
| created_at | TEXT | ✓ | 创建时间 |
| updated_at | TEXT | ✓ | 更新时间 |

**约束**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `employee_id` → `employee_profiles(id)` ON DELETE CASCADE
- FOREIGN KEY: `employee_user_id` → `users(id)`
- FOREIGN KEY: `handover_user_id` → `users(id)`
- CHECK: `resign_type IN ('voluntary', 'contract_end', 'dismissal')`
- CHECK: `status IN ('draft', 'submitted', 'handover_confirmed', 'mutual_confirmed', 'approved', 'rejected', 'handover_rejected')`
- UNIQUE: `(employee_id)` - 每个员工同时只能有一个离职申请

**索引**：
- `idx_resignation_requests_employee_id`
- `idx_resignation_requests_employee_user_id`
- `idx_resignation_requests_handover_user_id`
- `idx_resignation_requests_status`

---

### 2. resignation_documents 表（离职附件表）

**用途**：存储离职流程中各类文档（申请表、交接单、证明材料等）

**字段定义**：

| 字段名 | 类型 | 非空 | 说明 |
|--------|------|------|------|
| id | TEXT | ✓ | 主键，唯一标识符 |
| request_id | TEXT | ✓ | 外键，关联 resignation_requests.id |
| document_type | TEXT | ✓ | 文档类型（7种，见下表） |
| uploader_role | TEXT | ✓ | 上传角色：`employee`(离职人)\|`handover`(交接人)\|`admin`(管理员) |
| file_name | TEXT | ✓ | 原始文件名 |
| file_path | TEXT | ✓ | 相对文件路径，格式：`/uploads/resignation-documents/{requestId}/{filename}` |
| file_size | INTEGER | - | 文件大小（字节） |
| mime_type | TEXT | - | MIME 类型（application/pdf, image/png 等） |
| uploaded_by | TEXT | ✓ | 外键，关联 users.id（上传者ID） |
| uploaded_by_name | TEXT | - | 上传者名称（冗余字段） |
| created_at | TEXT | ✓ | 上传时间 |
| is_current | INTEGER | ✓ | 是否为当前版本（1=是，0=历史版本） |

**约束**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `request_id` → `resignation_requests(id)` ON DELETE CASCADE
- FOREIGN KEY: `uploaded_by` → `users(id)`
- CHECK: `document_type IN (...7种文档类型...)`
- CHECK: `uploader_role IN ('employee', 'handover', 'admin')`

**索引**：
- `idx_resignation_documents_request_id`
- `idx_resignation_documents_type`

**文档类型定义**（document_type 枚举值）：

| 类型值 | 显示名称 | 上传者 | 必需 | 说明 |
|--------|---------|--------|------|------|
| `application_form` | 离职申请表 | employee | ✓ | 离职人填写的申请表 |
| `handover_form_employee` | 离职人交接单 | employee | ✓ | 离职人列出的交接清单 |
| `handover_form_handover` | 交接人交接单 | handover | ✓ | 交接人签署确认的交接单 |
| `termination_proof` | 终止/解除劳动关系证明 | employee | ✓ | 劳动关系终止证明 |
| `asset_handover` | 固定资产交接单 | employee | ✓ | 公司资产移交清单 |
| `compensation_agreement` | 离职经济补偿协议书 | employee | ⚠ | 仅"辞退"类型必需 |
| `expense_settlement_agreement` | 离职其他费用结算约定 | employee | ✓ | 其他费用结算协议 |

**版本管理**：
- 每种文档类型只保留最新版本为当前版本（`is_current=1`）
- 旧版本保留在数据库中作为历史记录（`is_current=0`）
- 不删除旧版本文件，保证完整的审计日志

---

### 3. resignation_templates 表（离职模板库）

**用途**：管理离职各类模板文件，供员工下载填写

**字段定义**：

| 字段名 | 类型 | 非空 | 说明 |
|--------|------|------|------|
| id | TEXT | ✓ | 主键 |
| template_type | TEXT | ✓ | 模板类型（7种，与文档类型类似） |
| name | TEXT | ✓ | 模板显示名称 |
| file_name | TEXT | ✓ | 原始文件名 |
| file_path | TEXT | ✓ | 相对文件路径：`/uploads/resignation-templates/{filename}` |
| file_size | INTEGER | - | 文件大小 |
| mime_type | TEXT | - | MIME 类型（仅支持 PDF） |
| uploaded_by | TEXT | ✓ | 外键，关联 users.id（上传管理员） |
| uploaded_by_name | TEXT | - | 上传管理员名称 |
| created_at | TEXT | ✓ | 上传时间 |

**约束**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `uploaded_by` → `users(id)`
- CHECK: `template_type IN ('application_form', 'handover_form', 'termination_proof', 'asset_handover', 'compensation_agreement', 'expense_settlement_agreement', 'partner_dividend_settlement')`

**模板类型（7种）**：
- `application_form` - 离职申请表模板
- `handover_form` - 交接单模板（通用）
- `termination_proof` - 终止/解除劳动关系证明模板
- `asset_handover` - 固定资产交接单模板
- `compensation_agreement` - 离职经济补偿协议书模板
- `expense_settlement_agreement` - 离职其他费用结算约定模板
- `partner_dividend_settlement` - 合伙人离任分红结算模板（新增）

---

### 4. resignation_audit_logs 表（离职审批流程日志）

**用途**：记录离职流程中的每一步操作（提交、确认、驳回、审批等），用于审计和流程追溯

**字段定义**：

| 字段名 | 类型 | 非空 | 说明 |
|--------|------|------|------|
| id | TEXT | ✓ | 主键 |
| request_id | TEXT | ✓ | 外键，关联 resignation_requests.id |
| action | TEXT | ✓ | 操作描述（如"提交离职申请"、"交接人确认交接完成"等） |
| operator_id | TEXT | ✓ | 外键，关联 users.id（操作人ID） |
| operator_name | TEXT | - | 操作人名称（冗余字段） |
| comment | TEXT | - | 操作备注（如驳回原因） |
| created_at | TEXT | ✓ | 操作时间 |

**约束**：
- PRIMARY KEY: `id`
- FOREIGN KEY: `request_id` → `resignation_requests(id)` ON DELETE CASCADE
- FOREIGN KEY: `operator_id` → `users(id)`

---

### 5. employee_profiles 表（员工档案表，相关字段）

**与离职相关字段**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | TEXT | 主键 |
| user_id | TEXT | 外键，关联 users.id |
| employee_no | TEXT | 员工编号 |
| name | TEXT | 员工姓名 |
| department | TEXT | 所属部门 |
| position | TEXT | 职位 |
| hire_date | TEXT | 入职日期 |
| contract_end_date | TEXT | 合同到期日期 |
| employment_status | TEXT | 员工状态：`active`(在职)\|`probation`(试用期)\|`resigned`(已离职)\|`on_leave`(休假中) |
| status | TEXT | 档案状态：`draft`(草稿)\|`submitted`(已提交) |

**离职后状态变化**：
- 管理员审批通过离职申请后，该员工的 `employment_status` 更新为 `'resigned'`

---

### 6. onboarding_templates 表（入职模板库）

**用途**：管理入职所需的各类文件模板

**字段定义**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | TEXT | 主键 |
| file_type | TEXT | 文件类型 |
| file_name | TEXT | 文件名 |
| file_path | TEXT | 相对文件路径 |
| file_size | INTEGER | 文件大小 |
| mime_type | TEXT | MIME 类型 |
| uploaded_by | TEXT | 上传人ID |
| uploaded_by_name | TEXT | 上传人名称 |
| created_at | TEXT | 上传时间 |

---

## 二、离职流程状态流转图

```
┌─────────────┐
│   草稿态    │  (draft)
│ (仅离职人)  │
└──────┬──────┘
       │ 提交申请（所有材料已上传）
       ↓
┌─────────────────────────────────┐
│   已提交 (已交接人处理)         │  (submitted)
│ 离职人：等待交接人上传交接单    │
│ 交接人：需上传交接单并确认      │
└──────┬───────────────┬──────────┘
       │               │ 交接人驳回
       │               ↓
       │        ┌──────────────────┐
       │        │ 交接人待重新提交  │ (handover_rejected)
       │        │ (仅对交接人可见)  │
       │        │ 离职人无感知      │
       │        └──────────────────┘
       │ 交接人确认
       ↓
┌──────────────────────┐
│  交接人已确认        │ (handover_confirmed)
│ 离职人需确认交接完成 │
└──────┬───────────────┘
       │ 离职人确认
       ↓
┌──────────────────────┐
│  双方已确认          │ (mutual_confirmed)
│ 等待管理员审批       │
└──────┬───────────────┘
       │ 管理员审批
       ├─ 通过 ─→ ┌────────────────┐
       │           │  已通过        │ (approved)
       │           └────────────────┘
       │
       └─ 驳回 ─→ ┌────────────────┐
                   │  已驳回        │ (rejected)
                   │ 回到草稿状态   │
                   └────────────────┘
```

**状态值定义**：

```typescript
type ResignationStatus = 
  | 'draft'                // 草稿：离职人填写但未提交
  | 'submitted'            // 已提交：离职人提交后，等待交接人处理
  | 'handover_confirmed'   // 交接人已确认：交接人上传交接单并确认
  | 'mutual_confirmed'     // 双方已确认：离职人也确认了交接完成
  | 'approved'             // 已通过：管理员审批通过
  | 'rejected'             // 已驳回：管理员驳回给离职人
  | 'handover_rejected'    // 交接人待重新提交：管理员仅驳回给交接人
```

---

## 三、离职类型与必需文档

根据离职类型（resign_type），所需文档不同：

### 主动离职 (voluntary)
必需文档：
1. ✓ 离职申请表（application_form）
2. ✓ 离职人交接单（handover_form_employee）
3. ✓ 终止/解除劳动关系证明（termination_proof）
4. ✓ 固定资产交接单（asset_handover）
5. ✓ 离职其他费用结算约定（expense_settlement_agreement）

### 合同到期 (contract_end)
必需文档：同主动离职

### 辞退 (dismissal)
必需文档：
1. ✓ 离职申请表（application_form）
2. ✓ 离职人交接单（handover_form_employee）
3. ✓ 终止/解除劳动关系证明（termination_proof）
4. ✓ 固定资产交接单（asset_handover）
5. ⚠ **离职经济补偿协议书**（compensation_agreement）- **专属于辞退**
6. ✓ 离职其他费用结算约定（expense_settlement_agreement）

---

## 四、各角色的权限与操作

### 离职人（employee_user_id）
- **草稿态**：
  - 填写离职信息（离职类型、离职日期、交接人、离职说明）
  - 上传申请表、交接单、补充材料
  - 删除草稿或已驳回的申请
  - 提交申请
  - 撤回已提交但交接人未确认的申请

- **已提交态**：
  - 查看交接人是否已上传交接单
  - 等待交接人确认

- **交接人已确认态**：
  - 确认交接完成（标记 employee_confirm_time）

- **双方已确认态**：
  - 等待管理员审批

- **已驳回态**：
  - 修改申请内容
  - 重新提交申请

### 交接人（handover_user_id）
- **已提交态**：
  - 查看离职人的申请和上传的材料
  - 上传交接单（handover_form_handover）或在线签名确认
  - 确认交接完成

- **交接人待重新提交态（handover_rejected）**：
  - 重新上传交接单或签名确认
  - 离职人无法看到该状态

- **其他态**：
  - 查看完成记录

### 管理员
- **所有态**：
  - 查看所有离职申请（按状态筛选）
  - 查看详情和完整流程日志
  - 审批通过（mutual_confirmed → approved）
  - 驳回（可指定驳回给离职人、交接人或双方）
  - 删除（仅草稿或已驳回）

---

## 五、API 端点映射

### 员工端 API

```
GET    /api/resignation/handover-candidates          获取交接人候选列表
GET    /api/resignation/my-request                   获取我的离职申请
POST   /api/resignation/my-request                   保存/更新离职申请草稿
POST   /api/resignation/my-request/submit            提交离职申请
POST   /api/resignation/my-request/withdraw          撤回离职申请
DELETE /api/resignation/my-request                   删除离职申请（仅草稿）
POST   /api/resignation/my-request/confirm           确认交接完成

POST   /api/resignation/my-request/upload-application      上传离职申请表
POST   /api/resignation/my-request/upload-handover         上传离职人交接单
POST   /api/resignation/my-request/upload-document         上传补充材料

DELETE /api/resignation/my-request/documents/:docId        删除已上传文档
GET    /api/resignation/requests/:id/documents/:docId/download   下载文档

GET    /api/resignation/templates                    获取离职模板列表
GET    /api/resignation/templates/:id/download      下载模板

GET    /api/resignation/:id/document-history        查看文档历史版本
GET    /api/resignation/:id/audit-logs              获取审批流程日志
```

### 交接人端 API

```
GET    /api/resignation/handover-task                      获取待处理交接任务
GET    /api/resignation/handover-task/completed            获取已完成交接记录

POST   /api/resignation/:id/handover-upload               上传交接单
POST   /api/resignation/:id/handover-sign                 在线签名确认
POST   /api/resignation/:id/handover-confirm              确认交接完成
DELETE /api/resignation/:id/handover-documents/:docId     删除交接单
```

### 管理员端 API

```
GET    /api/resignation/management                    列出所有离职申请（支持按状态筛选）
GET    /api/resignation/management/:id                查看离职申请详情
POST   /api/resignation/management/:id/approve        审批通过
POST   /api/resignation/management/:id/reject         驳回申请（可指定驳回对象）
DELETE /api/resignation/management/:id                删除申请（仅草稿或已驳回）

POST   /api/resignation/templates                     上传模板
DELETE /api/resignation/templates/:id                 删除模板
```

---

## 六、前端页面结构

### 1. Onboarding.vue（入职管理）
- **Tab 1：员工基础信息**
  - 个人信息表单（姓名、性别、出生日期等）
  - 联系方式、紧急联系人
  - 教育经历
  - 工作信息（员工编号、入职日期、部门、职位、员工状态）
  - 收款信息

- **Tab 2：入职文件**
  - 入职所需文件清单
  - 显示管理员上传的文件
  - 支持下载和预览

### 2. Resignation.vue（离职管理）
- **Tab 1：离职管理（我的离职申请）**
  - 当前状态卡片（显示员工名字、状态标签、交接人、离职日期、下一步操作）
  - 模板下载卡片
  - 离职申请表单（离职类型、离职日期、交接人选择、离职说明）
  - 附件上传区（我的附件、补充材料、交接人附件）
  - 操作按钮（查看流程、提交申请、撤回申请、确认交接完成、删除申请）

- **Tab 2：待我处理**
  - 待处理交接任务列表
  - 已完成交接记录列表
  - 支持上传交接单、在线签名确认、删除交接单

---

## 七、关键业务规则

### 1. 离职日期限制
- 离职日期必须至少提前 1 个月申请
- 前端日期选择器禁用 1 个月内的日期

### 2. 状态自动流转（refreshRequestStatus）
- 系统在文档上传、确认等操作后自动计算当前状态
- 不依赖人工维护 status 字段
- 状态计算基于：submit_time、handover_confirm_time、employee_confirm_time 和上传的文档

### 3. 文档版本管理
- 上传新版本时，旧版本的 is_current 设为 0
- 旧版本文件保留在磁盘上，不删除
- 查询当前文档时使用 `WHERE is_current = 1`

### 4. 驳回策略（handover_rejected 状态）
- 管理员可仅驳回给交接人（不告知离职人）
- 离职人在"待交接人处理"状态中看到 handover_rejected 时，显示为 "submitted"
- 系统实际状态是 handover_rejected，但离职人无感知

### 5. 交接人在线签名
- 生成田字格字帖界面
- 检测笔画是否在字体轮廓内
- 仅 PDF 源文件时，将签名合成到 PDF 最后一页
- 图片源文件时，保存签名为独立 PNG

---

## 八、数据存储路径

```
uploads/
├── resignation-documents/          # 离职文档
│   ├── {requestId1}/
│   │   ├── application_form-{timestamp}.pdf
│   │   ├── handover_form_employee-{timestamp}.pdf
│   │   └── ...
│   └── {requestId2}/
│       └── ...
├── resignation-templates/          # 离职模板库
│   ├── application_form-{timestamp}.pdf
│   ├── handover_form-{timestamp}.pdf
│   └── ...
└── onboarding-templates/           # 入职模板库
    ├── contract-{timestamp}.pdf
    └── ...
```

---

## 九、重要的表关系图

```
users (用户表)
  ├─→ resignation_requests (employee_user_id / handover_user_id / approver_id)
  ├─→ resignation_documents (uploaded_by)
  └─→ employee_profiles (user_id)
       └─→ resignation_requests (employee_id)

resignation_requests
  ├─→ resignation_documents (request_id)
  └─→ resignation_audit_logs (request_id)

resignation_templates (模板库，1:多关系)
```

---

## 十、特殊字段说明

### reject_target（驳回目标）
- `null`：正常流程
- `'employee'`：驳回给离职人
- `'handover'`：驳回给交接人（离职人无感知）
- `'both'`：同时驳回给双方

### is_current（文档版本标记）
- `1`：当前有效版本
- `0`：历史版本

### employment_status（员工状态）
- `'active'`：在职
- `'probation'`：试用期
- `'resigned'`：已离职（审批通过后更新）
- `'on_leave'`：休假中

---

## 总结

该离职管理系统采用 **多方协作、分阶段审批** 的设计模式：

1. **离职人**提交申请和材料 → 
2. **交接人**上传交接单并确认 → 
3. **管理员**审批最终确认

整个过程完整记录在 `resignation_audit_logs` 中，支持完整的审计追溯。数据库设计充分考虑了业务复杂性，包括文档版本管理、多角色权限隔离、状态自动流转等高级特性。

