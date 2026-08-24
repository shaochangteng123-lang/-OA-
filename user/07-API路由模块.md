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
- [server/routes/resignationManagement.ts](../server/routes/resignationManagement.ts) - 管理员离职归档、模板在线填写与一键识别路由
- [server/routes/leave.ts](../server/routes/leave.ts) - 请假管理相关路由
- [server/routes/payroll.ts](../server/routes/payroll.ts) - 人力成本工资表相关路由
- [server/routes/boss-dashboard.ts](../server/routes/boss-dashboard.ts) - 羽隶经营看板汇总与指标注册路由
- [server/routes/contracts.ts](../server/routes/contracts.ts) - 合同台账、识别、审批、盖章核验、财务闭环与经营统计路由
- [server/routes/contractSealApplications.ts](../server/routes/contractSealApplications.ts) - 在线编辑、本人电子签名和生成用印申请单路由
- [server/routes/contractAuxiliaryPackages.ts](../server/routes/contractAuxiliaryPackages.ts) - 辅助材料档案包、备注及文件预览路由

### 主入口

- [server/index.ts](../server/index.ts) - Express 应用入口

## 路由结构

### 认证路由 (`/api/auth`)

```text
POST   /api/auth/login             // 账号密码登录
GET    /api/auth/user              // 获取当前用户信息
GET    /api/auth/session           // 检查当前会话
POST   /api/auth/change-password   // 修改本人密码
GET    /api/auth/signature         // 获取本人签名状态及是否已锁定
GET    /api/auth/signature/image   // 读取本人已保存签名图片
POST   /api/auth/signature         // 首次确认并锁定本人电子签名
DELETE /api/auth/signature         // 已停用；确认后的签名不允许删除
POST   /api/auth/logout            // 退出登录
```

- 电子签名只支持 `personal`（本人签名），不再提供管理员代管他人签名类型
- 签名接口不接收用户编号，只依据当前登录会话操作本人数据
- 保存时继续执行签名图片去底、阴影过滤、笔画筛选和裁切；图片通过鉴权接口返回，不开放上传目录物理路径
- 首次保存使用数据库事务锁串行确认；账号已有签名时拒绝重复上传，删除接口始终拒绝，前端同步把按钮锁定为“已确认并锁定”
- 转正签署调用已保存签名后，仍在当前申请版本中复制独立签名快照

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

### 今日日志与团队日志路由 (`/api/daily-logs`)

```typescript
GET    /api/daily-logs/team                                // 获取指定日期团队日志
GET    /api/daily-logs/team/weekly-summary                 // 在线查看指定周团队周报
GET    /api/daily-logs/team/attachments/:attachmentId/preview // 在线预览团队日志附件
GET    /api/daily-logs/weekly-summaries                    // 获取个人周报列表
GET    /api/daily-logs/weekly-summary/download             // 导出个人/团队周报
GET    /api/files/invoices/*                               // 读取支持年/月/日多级路径的发票或收据
GET    /api/files/payment-proofs/*                         // 读取支持年/月/日多级路径的付款回单
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
GET    /api/users                              // 管理员获取完整用户列表
GET    /api/users/directory                    // 已登录用户获取精简同事目录
GET    /api/users/activities                   // 获取本人活动；管理员可查看指定用户
GET    /api/users/next-employee-number         // 管理员预览创建用户时的下一个员工编号
POST   /api/users                              // 管理员更新用户；BOSS和董事长仅维护轻量账号字段
POST   /api/users/create                       // 管理员创建员工账号或轻量系统账号
DELETE /api/users/:id                          // 管理员删除非超级管理员用户
POST   /api/users/:id/reset-password           // 管理员重置非超级管理员用户密码
```

**用户数据权限规则：**

- 完整列表包含联系方式与收款信息，管理员、超级管理员和董事长可访问
- 精简目录只返回编号、姓名、头像、部门、职位和角色，供普通业务选择器使用；BOSS和董事长不进入该目录
- 普通管理员不能修改超级管理员账号，也不能授予超级管理员角色
- 后端每次从数据库校验实时角色，不能以菜单是否可见作为接口授权依据
- 创建弹窗通过 `GET /api/users/next-employee-number` 展示当前下一个员工编号；该接口与创建接口使用同一编号读取锁和生成规则
- 创建员工账号时不接收 `employeeNo`，后端在事务锁内生成下一员工编号，并同步写入账号和员工草稿档案
- 创建BOSS或董事长账号时只要求用户名、密码和角色，联系方式、组织、收款信息及员工编号写为空，且不创建员工档案
- 管理员、超级管理员或董事长可创建董事长账号；只有超级管理员或董事长能修改系统级账号或授予超级管理员角色，董事长通过统一角色中间件获得与超级管理员一致的管理权限
- 编辑用户时仍可提交 `employeeNo` 修改编号；后端会校验格式、唯一性，并同步更新对应员工档案
- 创建、编辑用户时会读取最新部门职位配置，拒绝不存在的部门或不属于该部门的职位；修改成功后同步更新对应员工档案的部门和职位
- BOSS和董事长账号必须独立创建，更新接口拒绝轻量账号与任何员工角色互相转换

### 羽隶经营看板路由 (`/api/boss-dashboard`)

```text
GET /api/boss-dashboard/summary?startMonth=YYYY-MM&endMonth=YYYY-MM  // 获取统一财务周期及当前实时快照
GET /api/boss-dashboard/metrics  // 获取已启用的经营指标注册定义
```

- 仅BOSS、管理员和超级管理员可以访问。
- 对外可见页面名称统一为“羽隶经营看板”；权限角色显示为 BOSS，内部角色编码继续使用 `boss`。
- `startMonth` 与 `endMonth` 必须同时提交。按月查询时两者为同一个月份；按年查询时固定为所选自然年的 `01` 月至 `12` 月。顶部财务指标、三组财务趋势及 `reimbursements` 报销汇总和明细全部使用同一组起止月份，不再额外混入系统当前月数据。
- `period` 返回 `startMonth`、`endMonth`、月份数组、周期类型、显示名称、财务指标汇总方式、人力成本平均口径和分母。财务指标按所选周期合计；单月人均人力成本按该月工资记录人数计算，多月及年度人月均成本按所选周期工资记录人次（人月）计算。
- 返回公司级人力成本汇总，不返回员工个人工资明细；BOSS账号自身不计入人员和人力成本。人力成本趋势拆分工资、单位社保、个人社保、单位公积金、个人公积金和个税代扣；个税代扣直接汇总 `payroll_records.individual_income_tax`，个人缴纳及个税均属于工资代扣，不额外计入公司人力成本总额。
- `reimbursements` 按所选财务周期对基础报销、大额报销、商务报销返回数量和金额，同时返回报销范围／区域、服务对象／单位的汇总排名以及该周期最近 12 条报销明细；统计排除草稿、驳回和已删除记录。
- `workLogs.daily` 返回今日日报应填、已填写、已归档、未填写、填写率和未填写人员，并附最近员工日报；`workLogs.weekly` 优先返回本周周报，本周无数据时回退到最近一个已生成周报的周期。
- `people`、`workLogs`、`projects` 和 `risks` 始终是请求时的当前实时快照，不使用 `startMonth`、`endMonth` 伪造历史状态；前端在“人员与日志”“项目与风险”分区明确标注该规则。
- 汇总接口只读取现有业务数据，不创建或修改工资、报销、日报和周报。羽隶经营看板首次进入时获取实时汇总，此后每 30 秒静默自动同步。
- 数据源缺失时返回不可用状态和原因，不以零代替缺失数据。
- BOSS的业务写请求统一返回 `BOSS_READ_ONLY`（BOSS只读）错误；仅修改密码、退出登录和个人偏好例外，员工档案与电子签名写入不例外。

### 合同管理路由 (`/api/contracts`)

```text
GET    /api/contracts/meta                                      // 分类、状态、项目、行政区、二级分类、支出分类和当前费率
GET    /api/contracts                                           // 分页台账及当前筛选汇总
GET    /api/contracts/cancelled                                 // 财务管理角色分页查看已撤销合同及保留文件
GET    /api/contracts/dashboard                                 // 合同经营统计、趋势、排名和风险
GET    /api/contracts/rates                                     // 当前费率及不可覆盖历史版本
POST   /api/contracts/rates                                     // 新增带生效日期和原因的费率版本
GET    /api/contracts/pending-count                             // 当前账号被快照指定的合同待审批数量
GET    /api/contracts/pending-seal-count                        // 财务管理角色读取待盖章合同数量，用于合同台账提醒
GET    /api/contracts/approvals/pending                         // 当前账号被快照指定的待审批合同
GET    /api/contracts/approvals/processed                       // 当前账号本人已处理记录
GET    /api/contracts/ocr-jobs/:jobId                           // 查询识别任务、字段证据及完整逐行识别结果
POST   /api/contracts/recognize                                 // 携带行政区、合同类型、合同关系、辅助材料开关及二级协议上级合同上传草拟合同
PATCH  /api/contracts/:id/auxiliary-material-setting            // 按合同版本更新是否需要辅助材料
POST   /api/contracts/:id/recognize/retry                       // 重新排队未达标或失败的整份识别任务
POST   /api/contracts/:id/ocr-model-comparison                  // 财务对同一当前 PDF 原件执行两套模型诊断对比
POST   /api/contracts/:id/ocr-jobs/:jobId/confirm               // 财务整组确认最新低可信任务的六个核心字段
GET    /api/contracts/:id                                       // 合同组、附件、审批、财务与核算详情；审批记录与当前目标返回姓名及职位
PUT    /api/contracts/:id                                       // 保存说明及主营／非主营同区项目归属；资产类项目必须为空
DELETE /api/contracts/:id                                       // 二次确认软删除草稿
POST   /api/contracts/:id/submit                                // 按项目归属锁定项目负责人或总经理并提交审批
POST   /api/contracts/:id/withdraw                              // 目标审批人未处理前撤回本轮用印审批
POST   /api/contracts/:id/cancel                                // 盖章前撤销合同并保留历史证据
POST   /api/contracts/:id/approve                               // 由合同审批中心统一调用；本轮快照目标通过、驳回或评论
GET    /api/contracts/:id/termination-upload-context            // 读取主合同或补充协议的解除上传上下文及结算预览
GET    /api/contracts/:id/supplement-upload-context             // 读取普通补充协议上传上下文和当前金额
GET    /api/contracts/:id/renewal-upload-context                // 读取独立续签主合同的来源、分类和到期日上下文
POST   /api/contracts/:id/renewals/recognize                    // 从租赁原合同上传并创建独立续签主合同
POST   /api/contracts/:id/rental-exit/confirm                   // 满100%租赁主合同由管理员直接确认退租／还车
POST   /api/contracts/:id/terminations/recognize                // 上传解除协议书并锁定解除目标、结算快照和识别任务
POST   /api/contracts/:id/termination-request                   // 历史兼容入口；固定返回 410 并要求上传解除协议书
POST   /api/contracts/:id/files                                 // 上传用印及其他合同附件
DELETE /api/contracts/:id/files/:fileId                         // 移除草拟阶段送审附件
GET    /api/contracts/files/:fileId                             // 鉴权预览或下载合同文件
GET    /api/contracts/:id/audit-logs                            // 分页读取操作审计记录
GET    /api/contracts/:id/seal-application                      // 财务角色或总经理只读获取当前用印申请单
PUT    /api/contracts/:id/seal-application                      // 仅财务角色保存在线用印申请草稿
POST   /api/contracts/:id/seal-application/sign                 // 仅财务角色中的合同创建人使用本人锁定签名生成已签 PDF
GET    /api/contracts/:id/auxiliary-packages                    // 读取辅助合同档案包
POST   /api/contracts/:id/auxiliary-packages                    // 上传至少一份辅助合同及任意组合的多份发票、回单并直接归档；单包总文件最多20份
POST   /api/contracts/:id/auxiliary-packages/:packageId/files   // 向已有档案追加合同、发票或回单；已有辅助合同后可只追加发票／回单
GET    /api/contracts/:id/auxiliary-packages/:packageId         // 读取辅助档案详情
PATCH  /api/contracts/:id/auxiliary-packages/:packageId/note    // 修改特殊情况备注
DELETE /api/contracts/:id/auxiliary-packages/:packageId         // 删除辅助档案包
GET    /api/contracts/:id/auxiliary-packages/:packageId/files/:fileId // 鉴权预览辅助资料
POST   /api/contracts/:id/sealed                                // 上传盖章版并发起核验
GET    /api/contracts/:id/sealed-verifications/latest           // 读取当前盖章核验
GET    /api/contracts/:id/sealed-verifications/:verificationId  // 读取指定核验版本
POST   /api/contracts/:id/sealed-verifications/:verificationId/retry     // 重试识别
POST   /api/contracts/:id/sealed-verifications/:verificationId/reapprove // 提交差异说明复审
POST   /api/contracts/:id/sealed-verifications/:verificationId/archive   // 核验通过后最终归档
POST   /api/contracts/:id/financial-ocr                         // 上传财务凭证并返回服务端识别任务；未验证结果只隔离不建草稿
GET    /api/contracts/:id/financial-ocr/pending                 // 恢复已验证、未消费且尚未进入财务登记的凭证任务
DELETE /api/contracts/:id/financial-ocr/:jobId                  // 硬删除尚未消费的临时财务凭证、识别任务和摘要占用
POST   /api/contracts/:id/financial-registrations               // 保存发票草稿；可同时保存尚未结清的部分银行凭证
POST   /api/contracts/:id/financial-registrations/:registrationId/settlements // 为待结清草稿多次追加发票、银行凭证及部分对应关系
POST   /api/contracts/:id/financial-registrations/:registrationId/confirm // 整组确认发票与回单
DELETE /api/contracts/:id/financial-registrations/:registrationId         // 整组删除配对草稿
POST   /api/contracts/:id/financial-registrations/:registrationId/reverse // 整组冲正已确认登记
POST   /api/contracts/:id/{invoices|receipts|payments}          // 历史兼容入口；新建时拒绝单边登记
POST   /api/contracts/:id/{invoices|receipts|payments}/:recordId/confirm // 仅兼容没有登记批次的历史记录
DELETE /api/contracts/:id/{invoices|receipts|payments}/:recordId         // 仅兼容没有登记批次的历史草稿
POST   /api/contracts/:id/{invoices|receipts|payments}/:recordId/reverse // 仅兼容没有登记批次的历史记录
```

### 合同文件下载申请路由 (`/api/contract-download-requests`)

```text
GET  /api/contract-download-requests/available/:contractId              // 员工读取当前合同状态下可申请的当前附件
POST /api/contract-download-requests                                    // 员工提交一份合同、多份附件、下载用途和本人电子签名申请单
GET  /api/contract-download-requests?scope=mine                          // 员工查看每条申请链最新且尚未完成的当前申请
GET  /api/contract-download-requests?scope=employee_history              // 员工分页查看最终已完成的历史申请
GET  /api/contract-download-requests?scope=manager_pending               // 唯一活动总经理查看分配给本人的待审批记录，可带 keyword
GET  /api/contract-download-requests?scope=manager_processed             // 总经理分页查看本人已批准申请及后续状态
GET  /api/contract-download-requests?scope=admin_pending                 // 指定管理员查看已批准或执行中的任务
GET  /api/contract-download-requests?scope=admin_processed               // 执行管理员分页查看本人已经办结的下载处理历史
GET  /api/contract-download-requests/manager-processed/export            // 当前实际审批总经理按审批记录关键词导出本人可见Excel（电子表格）
GET  /api/contract-download-requests/admin-processed/export              // 当前实际执行管理员按处理记录关键词导出本人可见Excel（电子表格）
GET  /api/contract-download-requests/pending-counts                      // 按当前角色读取员工未读结果／总经理待审批／管理员待执行数量
POST /api/contract-download-requests/notifications/acknowledge           // 普通员工以 requestIds（申请编号数组）确认当前页结果已读，每次 1 至 100 条
GET  /api/contract-download-requests/:id                                 // 按申请人、目标总经理或目标管理员读取详情
GET  /api/contract-download-requests/:id/application-preview             // 受控在线预览申请单；批准后返回双签版本
POST /api/contract-download-requests/:id/decision                        // 目标总经理批准或驳回并校验申请版本
POST /api/contract-download-requests/:id/withdraw                        // 原申请人在总经理审批前按版本撤回
DELETE /api/contract-download-requests/:id                               // 原申请人按版本删除已撤回且无后继、无处理事实的最新叶子
POST /api/contract-download-requests/:id/resubmit                        // 已驳回／已撤回申请创建下一次不可变申请尝试
GET  /api/contract-download-requests/:id/files/:requestFileId/preview    // 申请人、目标总经理或管理员受控在线预览选定文件
GET  /api/contract-download-requests/:id/files/:requestFileId/download   // 管理员下载申请中指定的文件快照
POST /api/contract-download-requests/:id/complete                        // 全部指定文件成功传输后由执行管理员标记已处理
```

- 状态固定为 `pending_approval`（待总经理审批）、`approved`（管理员待办）、`processing`（管理员执行中）、`completed`（已完成）、`rejected`（已驳回）和 `withdrawn`（已撤回）。详情响应除当前尝试流程和 `auditLogs`（审计记录）外，还返回 `chainId`、`previousRequestId`、`attemptNo`、`canWithdraw`、`canResubmit` 及跨尝试 `chainHistory`（申请链历史）；
- 员工只能针对自身及根合同行政区域均不是“全部”的合同提交申请。可选附件接口和提交接口共用合同状态附件白名单，并再次校验 `is_current`（当前版本）、所属合同、文件摘要和物理路径；主合同文件始终可选，补充协议和解除协议只有存在当前 `sealed_contract`（盖章合同文件）后才进入候选。客户端伪造未盖章子协议、合同或附件编号不能绕过；
- 创建接口不接受客户端签名图片，只读取申请人 `user_signatures`（用户锁定签名）并复制快照生成 PDF（便携式文档格式）。总经理批准时读取总经理本人锁定签名，生成同页双签申请单；申请单预览和管理员下载均复核 SHA-256（安全散列算法）；
- 一份申请只对应一份合同，可包含 1 至 20 个当前有效附件。选定文件的编号、类型、名称、路径、摘要、大小和格式全部形成不可变快照；管理员接口只能下载这些快照文件，传输成功后才记录下载事实，全部文件均有成功记录后才能办结；
- 总经理目标账号在提交事务中按唯一活动 `general_manager`（总经理）解析；执行人按唯一活动 `admin`（管理员）账号形成姓名快照。下载申请的管理员接口即使识别管理员组角色，也必须再次匹配该申请的目标执行人账号；超级管理员或董事长不能抢占已指定给吴静雯等实际管理员的任务，管理员只负责执行，不进行二次审批。
- 提醒计数不接受客户端传入人员编号：普通员工只统计本人 `updated_at > applicant_seen_at` 的审批／执行结果，其中总经理驳回明确计入未读；总经理只统计分配给本人的待审批申请；管理员只统计分配给本人的已批准和执行中任务。员工确认已读必须提交 1 至 100 个 `requestIds`（申请编号），服务端去重后仅推进当前员工、指定编号、非待审批且仍未读记录的 `applicant_seen_at`（申请人查看时间），不改业务状态或版本；缺少编号不能批量清除，伪造他人编号不会更新，未翻到的分页结果继续保留未读。
- 撤回只允许原申请人在 `pending_approval`（待审批）状态执行，必须携带 `expectedVersion`（期望版本）；撤回与总经理审批锁定同一申请行，任一方先提交后，另一方以 409 冲突结束。撤回同步把本人已读时间推进到撤回时点，不为员工自己的操作生成未读提醒；
- 重提只允许该员工、该合同所有申请链中的最新叶子，且来源必须为 `rejected`（已驳回）或 `withdrawn`（已撤回）。请求体重新提交用途、当前附件编号及来源版本；服务端重新校验合同范围、当前附件、摘要、唯一总经理／管理员和锁定签名，并创建新申请编号、新申请单及新附件快照。原申请、签名、申请单、驳回意见和附件快照均不修改；普通创建接口发现最近叶子可重提时返回 `CONTRACT_DOWNLOAD_USE_RESUBMIT`，防止绕过申请链；
- “当前申请”每条申请链只返回最新且尚未完成的尝试，保留待审批、管理员处理中以及可撤回／可重提记录；`employee_history`（员工历史范围）只返回最终已完成申请，并按更新时间倒序分页。被驳回后重新提交的旧尝试不再单独占一行，其驳回原因和重提过程继续保留在完成申请展开后的 `chainHistory`（申请链历史）中。第 2 次及以后生成的签名申请单明确标注提交次数和原申请编号；并发重提由来源行锁、活动申请唯一索引、上次申请唯一后继索引共同阻止。
- `manager_processed`（总经理已处理范围）仅允许总经理调用，按当前账号匹配 `approver_id`（实际审批人编号），且只返回 `approved`（已批准）、`processing`（执行中）和 `completed`（已完成）记录；`status=rejected`（筛选已驳回）固定返回 403，不在审批记录列表展示驳回申请。分页总数与列表使用相同权限条件，并按 `decided_at`（决定时间）、`updated_at`（更新时间）和申请编号倒序。其他总经理即使曾是目标快照也不能读取非本人决定的记录。
- 下载申请的总经理待办、审批记录和管理员处理记录支持 `keyword`（关键词），在服务端分页前同时匹配合同名称、合同编号、申请人和下载用途；页面当前视图总数与搜索结果使用完全相同的条件。总经理审批记录导出只允许实际 `general_manager`（总经理）本人，固定筛选 `approver_id`（实际审批人编号）及已批准、执行中、已完成状态；管理员处理记录导出只允许实际 `admin`（管理员）本人，固定筛选 `executor_id`（实际执行人编号）和已完成状态。两类导出均复用当前关键词并限制最多 5000 条，列明申请、审批、处理开始和完成时间，统一格式化为北京时间 `YYYY-MM-DD HH:mm:ss`。所有用户文本以字符串写入 XLSX（电子表格），以 `=`、`+`、`-`、`@` 开头时增加文本前缀，防止公式注入；
- 已撤回申请的删除只允许原申请人、当前申请链最新叶子、匹配版本且没有后继、审批、下载或管理员处理事实时执行。事务内先向合同审计写入申请编号、轮次和删除状态等最小边界，再显式删除本申请的附件快照、下载申请审计及申请主记录；事务提交后只清理本次申请专属申请单和签名快照物理文件，不删除原合同附件或 `user_signatures`（用户共享签名）原件。历史链中间节点、已审批或已执行事实一律拒绝删除；
- 总经理读取详情时，待审批尝试必须匹配本人 `target_approver_id`（目标审批人编号），已处理尝试必须匹配本人 `approver_id`（实际审批人编号）；重提链只返回当前总经理有权查看的待审批或本人已处理尝试，旧驳回记录不能成为查看后来分配给其他总经理新尝试的入口。
- `admin_processed`（管理员已处理范围）仅允许 `admin`（管理员）角色调用，按当前账号匹配 `executor_id`（实际执行人编号）且只返回 `completed`（已完成）记录；分页总数与列表使用相同权限条件，并按 `completed_at`（完成时间）、`updated_at`（更新时间）和申请编号倒序。其他管理员、超级管理员、董事长及其他角色不能读取该账号的处理历史。
- 管理员读取待办详情时继续匹配本人 `target_executor_id`（目标执行人编号）及已批准／执行中状态；读取已完成详情时必须匹配本人 `executor_id`（实际执行人编号）。管理员看到的重提链同步按该边界过滤，已完成旧尝试不能暴露后来分配给其他管理员的新任务。

**读取与写入权限：**

- 管理员、超级管理员、董事长和总经理可读取全部合同；普通员工可读取、查看详情和在线预览全部具体行政区合同，但服务端排除合同或根合同区域为“全部”的记录；BOSS（经营管理）同样不能读取或统计“全部”区域合同。合同业务审批只允许唯一活动总经理，普通员工不再因项目负责人身份获得审批权限；
- 新增、草稿维护、资料上传、盖章归档、费率版本和财务记录只允许管理员、超级管理员、董事长；
- 用印申请单的 `GET`（读取）接口允许财务角色和总经理只读调用，供总经理在审批前核对申请人签名、审批后读取 `approvedFileId`（最终双签文件编号）；审批签署完成后 `signedFileId`（已签文件编号）也统一指向该最终双签文件，申请人单签附件不再保留。`PUT`（更新）和 `POST /sign`（签署）仍仅允许财务角色，且签署仍必须由合同创建人本人完成，未扩张总经理的编辑或申请人签署权限；
- 未签用印申请的 `GET`（读取）响应只从当前草拟合同文件的最新识别原文取得 `copyCount`（用印总份数），并返回 `copyCountRecognition`（份数识别状态）。成功时直接返回唯一可信的 1 至 20 份整数；未形成唯一值时返回 `null`（空值）和 `unrecognized`（未识别），不再回退历史草稿或默认 2 份。保存及签署继续在事务内重新锁定同一当前文件的可信份数并覆盖客户端值；
- `approvals/pending`、`approvals/processed`、`pending-count` 和 `POST /:id/approve` 只允许 `general_manager`（总经理）角色调用，并继续要求本轮快照 `target_approver_id`（目标审批人编号）等于当前活动账号。管理员、超级管理员、董事长和普通员工即使能查看合同，也不能进入审批中心或调用审批决定接口；
- `pending-seal-count` 仅供管理员、超级管理员和董事长读取未撤销的待盖章合同数量，用于合同台账菜单提醒，不授予任何合同审批权限；实际上传、核验和归档盖章版仍沿用财务管理角色门禁；
- 前端可从“合同审批”中心或当前目标审批人的合同详情工作区调用同一个 `POST /:id/approve`（审批决定）；未新增详情专用接口。接口地址、请求体、目标快照权限、并发校验和服务端事务均保持不变，非目标审批人不能因详情读取权限调用成功；
- BOSS（经营管理）写请求仍由全局只读边界拒绝，不能因可读取合同接口而获得审批或财务权限。

**新增、识别与审批规则：**

> 当前有效关系规则：仅允许 `main`（主合同）、`supplement`（补充协议）、`termination`（终止协议）。本节后续历史说明中如仍出现 `independent`（独立合同），仅代表旧版本背景；新增请求不再接受该值，历史数据已迁移为主合同。

- `POST /recognize` 使用 `multipart/form-data`（多段表单数据），普通新增只接受主合同或补充协议。页面要求用户选择 `area`（行政区）、`declaredCategory`（合同类型）与 `relationType`（合同关系）；补充协议还必须携带有效 `parentContractId`（上级合同编号）。终止协议必须改走解除协议专用识别接口，不能通过通用入口创建无解除目标的草稿；
- 主合同台账与详情的补充协议快速入口先调用 `GET /api/contracts/:id/supplement-upload-context`，由服务端返回只读继承信息、当前有效金额、下一不可复用序号和生成名称；随后只向 `POST /api/contracts/:id/supplements/recognize` 上传一个协议文件。该专用接口拒绝客户端提交项目、分类、主体、金额或上级合同等业务字段，全部上下文均在根合同事务锁内重新读取并继承，避免页面篡改或过期数据创建错误链条；
- 房屋／场地、汽车和车位租赁主合同从台账或详情先调用 `GET /:id/renewal-upload-context`，取得续签来源、行政区、租赁分类、主体和来源到期日；随后 `POST /:id/renewals/recognize` 只接受一个新合同文件。服务端锁定来源合同并创建 `relationType = main`（主合同）、根合同编号等于自身、上级合同为空的新记录，同时保存续签来源和来源到期日快照；存在未拒绝续签后继或办理中补充／解除协议时拒绝并发创建；
- 续签新合同按普通主合同金额语义识别自身总额，金额、本期租赁起止日、费率、文件、审批、附件和财务均独立保存，不调用补充协议序号、金额快照或增量链。提交审批和盖章归档分别重新核对续签来源及冻结到期日；只有盖章核验归档成功后续签谱系才生效，原合同金额、到期日和财务状态不修改；
- `GET /api/contracts` 和 `GET /api/contracts/:id` 返回 `previousLeaseContractId`（续签来源合同编号）、`renewalContractId`（续签去向合同编号）及后继状态。续签新合同作为独立一级主合同参与分页、序号、金额和附件；原合同存在办理中后继时隐藏重复入口，后继归档生效后原合同不再触发到期提醒；
- 租赁原合同的“退租／还车”只从详情右上角发起。详情显示执行进度达到 100% 时调用 `POST /api/contracts/:id/rental-exit/confirm`，请求携带 `expectedVersion`（预期版本）；接口仅允许管理员、超级管理员和董事长调用，在事务中锁定主合同，重新按当前有效金额及已确认未冲正付款以整数分计算真实进度，并复核租赁分类、主合同关系、可办理状态、版本、同链未完成子协议和财务草稿。只有已履行金额与当前有效金额严格相等才直接终止原合同并写入审计，不创建解除协议、合同文件、识别任务或审批记录；真实金额不足时返回 `CONTRACT_RENTAL_EXIT_AGREEMENT_REQUIRED`（必须办理解除协议）并改走解除协议上传，超过合同金额时返回结算超额错误并要求先处理，版本冲突及其他并发错误只提示且不得绕过；
- 主合同或补充协议详情的解除入口先调用 `GET /api/contracts/:id/termination-upload-context?targetContractId=...`。服务端校验目标属于当前合同链，返回系统生成的解除协议名称、目标关系、解除前金额、已履行金额、解除后不再履行金额和最终金额；随后 `POST /api/contracts/:id/terminations/recognize` 只接受 `targetContractId`（解除目标编号）和协议文件，其余分类、主体、项目、金额和主合同关系全部从锁定目标派生。旧 `POST /:id/termination-request` 不再修改状态，固定返回 `410 CONTRACT_TERMINATION_FILE_REQUIRED`（必须上传解除协议书）；
- `GET /api/contracts` 按匹配到的根合同去重分页，并返回每个根合同的主合同及尚未上传当前盖章版的补充、终止协议；响应顺序固定为主合同在前，未盖章子协议按正式生效时间和 `supplementSequence`（补充协议序号）排序，供台账默认折叠、按需展开主从链。每项返回 `hasSealedContractFile`（是否存在当前盖章合同文件）；子协议一旦为真即不再属于台账匹配或展开结果。`total`（总数）和页码仍以主合同链数量计算，子协议不占独立序号。主合同和可见子协议响应同步返回原始金额、当前有效金额、生效前金额、本次增减、生效后金额、变更类型和序号；经营与财务口径读取根合同当前有效金额。列表汇总中的 `effectiveIncomeContractAmount`（有效收入合同额）汇总主营和非主营，`effectiveExpenseContractAmount`（有效支出合同额）汇总资产类；两者相加为兼容字段 `effectiveContractAmount`（有效合同总额）。`pendingSignatureAmount`（待签合同金额）只包含草稿、首次审批中和待盖章；有效与待签数量分别返回，`allContractAmount`（全部合同总额）为有效与待签之和；

开发库可用以下 SQL（结构化查询语言）抽查合同截至日期；内部划拨模式必须同时比较工程咨询向科技划拨回单和科技最终对外付款回单，且只读取状态为已确认的记录：

```sql
WITH roots AS (
  SELECT id, contract_no, financial_direction, asset_funding_mode
  FROM contracts
  WHERE COALESCE(root_contract_id, id) = id AND is_deleted = FALSE
)
SELECT roots.contract_no,
  CASE
    WHEN roots.financial_direction = 'income' THEN (
      SELECT MAX(receipt.receipt_date)
      FROM contract_receipts receipt
      JOIN contracts child ON child.id = receipt.contract_id
      WHERE COALESCE(child.root_contract_id, child.id) = roots.id
        AND child.is_deleted = FALSE AND child.status <> 'rejected'
        AND receipt.status = 'confirmed'
    )
    WHEN roots.financial_direction = 'cost'
      AND roots.asset_funding_mode = 'engineering_to_technology' THEN GREATEST(
        (SELECT MAX(payment.payment_date)
         FROM contract_payments payment
         JOIN contracts child ON child.id = payment.contract_id
         WHERE COALESCE(child.root_contract_id, child.id) = roots.id
           AND child.is_deleted = FALSE AND child.status <> 'rejected'
           AND payment.status = 'confirmed'),
        (SELECT MAX(payment.payment_date)
         FROM contract_external_payments payment
         JOIN contracts child ON child.id = payment.contract_id
         WHERE COALESCE(child.root_contract_id, child.id) = roots.id
           AND child.is_deleted = FALSE AND child.status <> 'rejected'
           AND payment.status = 'confirmed')
      )
    WHEN roots.financial_direction = 'cost' THEN (
      SELECT MAX(payment.payment_date)
      FROM contract_payments payment
      JOIN contracts child ON child.id = payment.contract_id
      WHERE COALESCE(child.root_contract_id, child.id) = roots.id
        AND child.is_deleted = FALSE AND child.status <> 'rejected'
        AND payment.status = 'confirmed'
    )
  END AS contract_cutoff_date
FROM roots
ORDER BY roots.contract_no;
```

- `declaredCategory` 与 `declaredSubtype` 是上传前锁定的业务分类；OCR（光学字符识别）六字段中的 `category` 存在候选时必须与锁定大类一致，正文没有可用分类候选时采用锁定大类作为业务事实，但不得改写或提高 OCR（光学字符识别）诊断分。二级分类不得由不充分原文自动改写。请求不得携带甲方、乙方、项目名称、金额、OCR（光学字符识别）合同类型或合同签订日期，违规返回 `OCR_FIELDS_READ_ONLY`（识别字段只读）；
- 识别状态为排队中、识别中、成功、未达到自动采用标准或失败。新建任务、整份重试或替换草拟文件后，在本次识别成功前甲方、乙方、项目名称、合同金额、合同类型和合同签订日期六个核心字段一律为空；OCR（光学字符识别）服务完成字段专属二次排序后，第三版自动采用策略继续核验项目候选来源、语义、唯一性或实际分差，以及金额角色和作用域，不再要求 `fieldScore`（字段规则评分）精确等于 100。候选安全证据与甲乙方、分类／层级、上下级上下文、金额和日期等硬业务校验全部通过后，服务端才在同一事务中设置字段最终值并写入合同主数据；
- PDF（便携式文档格式）电子文字层只能提出候选，即使文字层六项齐全，服务端也必须渲染包含字段证据的可见页面并执行图像 OCR（光学字符识别）。文字层与图像候选、页码、来源和冲突原因全部保留，字段专属二次排序负责选出最高合格候选；不同来源不一致不再单独把任务置为 `partial`（部分结果），但非法内容和跨字段硬冲突仍阻断；
- DOC（旧版 Word 二进制文档）经安全转换后与 DOCX（开放 XML 文字处理文档）统一作为 `docx_text`（文档文字来源）。DOCX 正文解析排除显式隐藏运行、删除／移动前修订和域指令文字；样式表存在启用的继承隐藏属性时安全失败。结构化正文形成的 0–99 分继续作为诊断，不因分值低于 100 自动转人工；客户端提交分值、仅上传前分类声明或仅任务成功状态均不能绕过硬业务校验；
- 金额解析优先保留明确“合同总价／合同总金额”等当前合同总额；唯一明确合同总额优先于数值更大的设备清单或分项“含税总价”，同一优先层出现多个不同的明确合同总额时保留全部候选并执行字段专属二次排序，不按最大值静默选择。单独一行的裸“含税总价／价税合计”不能仅因位于行首就视为整份合同总额；除非同一子句明确指向本合同、协议或合同价款，否则只作为普通金额候选。金额候选同步保存当前合同总额、普通金额、历史金额或关系调整额语义；“原合同／变更前／历史／已结算”同值金额不能冒充当前金额。特别约定只有在同一金额条款明确说明金额冲突且明确指向“金额／价款／总价／费用／报酬”优先时才覆盖普通条款。补充协议按每个金额自身位置之前最近且方向唯一的增加／减少动作确定本次有符号调整额；正文明确“调整后／变更后／最终合同总额”时，该最终总额是最高业务依据，系统使用根合同当前有效金额反算本次增减，不由动作金额覆盖。仅变更付款方式时，分期支付金额只证明付款计划存在，不进入合同总额候选；识别任务的金额字段保持空，但合同金额链保存“当前有效金额＋0＝当前有效金额”。审批提交冻结三段金额快照，盖章归档按同一根合同的生效顺序校验并推进；过期快照或前序协议未完成时拒绝生效；
- 资产车位租赁封面的独立编号／年度文号行不参与合同名称跨行拼接，下一行租赁协议标题独立形成名称候选。金额先识别明确“每月租赁费用共计”的优惠后整月总额，再按租赁起止日期计算月数；基准车位单价、各折扣单价、不含税额和增值税额只作核验。正文“按半年支付，费用共计×元／半年”与六个月租期一致时形成同周期总额证据，不作为普通阶段付款降级；
- 合同签订日期只从“签订日期／签订时间”等标签之后的同一行后缀提取，或在标签行留空时读取紧邻的下一条纯日期行；下一条日期附近出现有效期、合同期限、服务期限或履行期限语义时不得借用。标签之前、上一行、较远行及任何有效期起止日期都不能成为签订日期候选；“原合同／前次／历史／变更前”签订日期标记为历史角色。草拟合同日期为选填项，整页及局部复识后仍没有合法日期时允许以空最终值完成识别和提交审批。明确“项目名称／工程名称／信息咨询项目名称”等标签后的完整值按项目字段本身保留，属于名称正文的“咨询服务／技术服务”尾词不被通用合同类型清洗截掉；仅后续独立“合同”行与该尾词共同组成文档类型时剥离。项目名称跨行遇到付款方式、合同生效时间、甲乙方、金额、日期或编号立即停止；字段专属二次排序完成后采用最高合格候选，候选诊断仍保留但不单独要求人工确认；
- 上传时选择的合同层级还会与正文前八条有效标题行核验：主合同或独立合同遇到明确“补充协议／终止协议”标题，或补充与终止标题相互冲突时，识别任务以 `document`（文档业务错误）失败，不能进入六字段人工确认；“补充协议（一）”“补充协议书（1）”“解除协议（二）”等常见编号后缀同样属于明确标题，选错必须删除草稿并按正确层级重新上传；
- `GET /ocr-jobs/:jobId` 在原任务与字段结果之外返回 `ocrLines`（逐行识别结果），每行固定包含 `page`（页码）、`text`（文本）、`bbox`（坐标框）、`confidence`（原始置信度）和 `modelVersion`（模型版本）。任务级 `warnings`（警告）继续按原响应结构返回并保留审计用途；合同创建页仅隐藏黄色任务级诊断横幅，逐字段结果、任务状态、安全门禁和后续操作均不改变。`POST /:id/ocr-model-comparison` 仅允许财务角色对当前 PDF（便携式文档格式）草拟合同运行诊断，忽略电子文字层并串行使用 `v4_mobile`（第四版移动模型）和 `v5_server`（第五版服务器模型）识别全部页面，返回各自耗时、字段结果和置信度；接口不创建任务、不保存对比结果、不修改合同字段或解析规则；
- 最终采用门禁不读取四舍五入后的展示值，也不以精确整数 100 作为唯一条件。`ocrConfidence`（识别原始置信度）与 `fieldScore`（字段规则评分）原样保存，仅用于诊断、审计和展示；主流程只采用既有候选已排序且通过安全上下文核验的最高合格候选。项目候选不存在、来源不可信、属于合同类型／单位名称／付款条款或候选差距不足时阻断；金额没有明确角色和整合同作用域，或属于付款、税额、服务费、单价时阻断。任一门禁失败时六字段原子不写并保持 `partial`（部分结果）；
- 项目名称候选冲突、金额角色冲突或签订日期空值／低置信时，现有识别任务在内部自动执行同模型局部增强 OCR（光学字符识别）、重新候选排序并再次选择，不新增接口或请求字段。增强结果以 `fieldScope`（字段作用域）限制为目标字段，同时完整保留逐行文字、页码、坐标、`ocrConfidence`（识别原始置信度）和 `modelVersion`（模型版本）；完成后仍由同一风险采用策略原子写入六字段，不进入人工确认兜底；
- 合法空值允许随成功任务写入最终状态：合同签订日期在整页和局部复识后仍无合法候选可为空；无固定金额框架协议可为空项目、金额和日期；终止／解除协议可为空项目和日期，但该协议自身的“合同金额”固定写入 `0.00`，不采用正文金额候选。仅付款补充协议的识别金额字段合法为空，但业务合同记录必须同时写入 `payment_terms_only`（仅变更付款方式）和三段金额快照，不能把空值解释为识别缺失。解除协议用于原合同金额链的调整额仍独立按有效结算快照计算，不与协议自身 0 元金额混用。自动采用时字段 `final_value`（最终值）与合同主表同事务写入，且逐项检查实际写入行数；`manually_confirmed`（人工确认标志）保持 `false`（否），日期为空时 `contract_date_source`（合同日期来源）也为空。提交审批时要求识别任务带当前自动采用策略标记，并验证未人工确认的最终值和补充协议金额快照仍与当时安全采用结果一致；旧策略任务、被改写字段或已过期的金额基准必须重新识别；
- `POST /:id/ocr-jobs/:jobId/confirm` 已禁用，所有请求稳定返回 `409 OCR_MANUAL_CONFIRMATION_DISABLED`（人工确认已禁用）。合同核心字段只允许当前自动识别策略原子写入；`partial`（部分结果）任务只能调用重新识别，不允许旧客户端或内部页面提交人工值；
- `PUT /:id` 只接受说明、项目归属和预期版本号；项目归属只允许主营和非主营合同使用，且必须与合同同区，资产类传入非空项目编号返回 `409 CONTRACT_ASSET_PROJECT_NOT_ALLOWED`（资产合同禁止项目关系）。前端 `ContractUpdatePayload`（合同更新载荷）及草稿保存／提交请求不再包含 `parentContractId`（上级合同编号），上传识别请求仍必须携带并锁定该字段。上传后 `area`、`declaredCategory`、`declaredSubtype`、`assetCategory`、`relationType` 和 `parentContractId` 均锁定，不得通过更新接口修改。更新路由收到任何 `parentContractId` 字段时，即使值与当前上级相同或为 `null`（空值），也立即返回 `409 CONTRACT_PARENT_IMMUTABLE`（上级合同不可修改）且不进入领域服务；领域服务在行锁内再次拒绝实际变更。恢复二级草稿只读显示上传时上级合同，候选接口失败也不得清空锁定编号。任何 `relationType` 输入仍返回 `CONTRACT_RELATION_TYPE_IMMUTABLE`（合同关系不可修改），选错层级或上级必须删除草稿并按正确金额语义重新上传。提交甲方、乙方、项目名称、金额、合同类型、合同签订日期等六个识别核心字段、`confirmedFields`（确认字段）或 `ocrFields`（识别字段）均返回 `OCR_FIELDS_READ_ONLY`（识别字段只读）；
- 更新、删除、撤回、盖章前撤销以及所有盖章核验写操作携带 `expectedVersion`（预期版本号）；版本过期返回 `409`，防止并发覆盖；
- 盖章前撤销必须提交 `confirmed=true`、`expectedVersion`（预期版本号）和非空 `cancellationReason`（撤销原因，最多 300 字）；仅允许财务管理角色撤销草拟中、首次用印审批中或尚未上传盖章版的待盖章合同。服务端再次执行原因必填与长度校验，一旦发现盖章版文件或盖章核验记录即拒绝。撤销采用软删除，关闭待处理审批轮次并把原因写入审计，同时保留文件、审批记录和审计证据；
- `GET /cancelled` 只返回带盖章前撤销审计的软删除合同，不混入普通删除草稿；响应包含撤销人、撤销时间、撤销原因、撤销前状态和最小文件元数据。升级前的历史固定说明规范化为空值，由页面明确标注未填写原因。已撤销合同文件仍复用鉴权文件接口，但仅财务管理角色可读取；
- 草稿删除请求必须同时提交 `confirmed=true`；撤回仅适用于由草稿提交、且本轮目标审批人尚未通过、驳回或评论的用印审批，撤回时同步关闭审批轮次并记录目标快照；
- `GET /meta` 返回“全部”和北京市 16 个具体行政区、三类合同类型、内部兼容二级分类及项目行政区。合同区域选择“全部”时可关联任一北京市具体行政区项目；选择具体区时仍只允许同区项目。关联协议继续要求与上级合同保存的区域值一致；
- `GET /:id` 的主合同及每条关联合同必须返回四类合法 `relationType` 或 `relation_type`。前端逐项执行枚举校验；字段缺失、值非法，或新旧命名字段同时存在但值不一致时，整份详情解析失败并进入页面错误态，不渲染合同详情、不恢复草稿，也不得静默回退为独立合同；
- `GET /:id` 仅在目标为主合同时聚合同一根合同链的正式 `contract_files`（合同文件）：主合同自身文件始终返回，补充协议和解除协议只有存在当前 `sealed_contract`（盖章合同文件）后才整包返回该来源的草拟文件、用印申请单和盖章版。子协议详情继续返回空 `files`（附件数组），但合同主数据返回 `hasSealedContractFile`，供刷新后恢复其盖章核验流程。每份聚合附件包含 `sourceContractId`（来源合同编号）、`sourceContractName`（来源合同名称）、`sourceRelationType`（来源关系类型）和 `sourceSupplementSequence`（来源补充协议序号）；排序固定为主合同在前、补充协议按序号升序、解除协议在后，同一来源内按创建时间和文件编号倒序。聚合查询不读取财务发票／回单事实或辅助档案；文件预览和直接下载继续按附件真实所属合同调用既有权限与受控路径校验，不因主合同集中展示扩大权限；
- 提交时服务端要求最新识别任务为成功且绑定当前草拟文件；六个核心字段记录必须齐全，甲方、乙方和锁定分类等必填字段必须有最终值，项目、金额和日期仅可按已通过的安全策略保持合法空值。全自动结果必须带当前自动采用通过标记且未被改写；兼容人工结果必须具有甲方、乙方、项目名称、合同金额、合同分类五个必需字段的完整确认元数据，签订日期非空时也必须确认，空日期字段保持未人工确认不算混合证明。服务端同时复核 OCR（光学字符识别）合同类型与 `declared_category`（预选合同大类）一致、签订日期来源与确认属性一致、最终值与合同主数据一致，以及甲乙方、关系、金额、已选同区项目归属、二级协议上级合同、当前文件版本和必需用印资料。`main_business`（主营项目分类）已关联项目时读取 `worklog_projects.owner_user_id`（项目负责人编号）锁定活动项目负责人，未关联项目时改为锁定唯一活动总经理；已选项目失效或负责人不可用时不得回退。`non_main`（非主营）和 `asset`（资产）同样必须且只能解析出一个活动总经理。主合同无上级即可提交，终止协议调整额必须小于 0；
- 在线用印申请只接收表单字段和 `expectedVersion`（预期版本）；签署人必须是合同创建人本人，签名图片由服务端从该创建人当前账号的 `user_signatures`（用户签名）重新读取，忽略且不接受客户端签名数据。申请人创建的用印申请单固定为一页 A4（国际标准纸张），并在同页预留总经理审批签字栏、写入单页版式标记。`POST /:id/files` 明确拒绝手工上传 `seal_application`（用印申请单）。提交审批必须同时找到当前草拟合同和当前已签名用印申请 PDF（便携式文档格式），并再次核验签名人等于合同创建人、申请单合同版本与提交时完全一致。申请人和总经理均直接点击各自的签署栏进行签名确认，不提供“调用签名”按钮。总经理进入首次用印审批页内工作区时，前端先通过只读用印申请接口加载当前申请单；总经理审批签署栏先展示“待签署”空态，只有总经理点击该签署栏后才请求本人已锁定签名，并在同一区域显示签名及“签名已确认，待提交”。此时尚未写入申请单；签名未确认、未锁定或任一必需内容缺失时不得提交通过。点击“确认审批并签名”后，审批接口从总经理本人当前锁定签名重新生成审批快照，在原申请单同页预留栏写入总经理姓名、审批时间和签名，并把新的一页双签文件设为当前用印申请单。审批成功后前端重新读取用印申请并使用其 `approvedFileId`（最终双签文件编号）继续在工作区原位预览，不自动收起；请求体仍只接收审批动作和意见，不能提交签名图片或指定签名文件。总经理未配置签名、签名文件缺失、角色变化、原申请单摘要异常、缺少版式标记、页数／尺寸异常或页面旋转时返回冲突错误，合同与审批轮次保持待审批。项目负责人审批、驳回、评论、解除协议审批和盖章差异复审不触发总经理签名。三联单、请款单只在后续付款阶段按需上传，不得作为草拟用印提交门禁；
- `PATCH /:id/auxiliary-material-setting` 仅接受布尔值和当前合同版本，使用行锁更新 `requires_auxiliary_materials` 并写审计；已拒绝或已终止合同不能修改。辅助材料档案上传只允许关联已开启该开关的未删除合同：首次创建档案包必须上传至少一份 `contract`（辅助合同）；已有档案包后可通过追加接口只提交 `invoice`（发票）或 `receipt`（银行回单），无需重复上传合同。三类文件单包合计最多 20 份，单个文件最多 30MB；同包相同 SHA-256（安全散列算法）摘要固定拒绝，任一文件校验失败时本批已落盘文件全部清理。全部文件通过格式、结构和路径安全校验后直接归档，不识别甲方、乙方、金额或其他正文内容，也不写入正式合同识别、发票、回款或付款表；辅助材料固定不参与收入、支出、合同额或项目金额核算，追加、备注、删除和鉴权预览继续使用档案版本控制；
- 每次用印、终止和盖章差异复审均创建独立审批轮次，目标统一为唯一活动总经理并快照其编号、姓名、角色、来源及项目编号。审批路由和服务层均拒绝管理员、项目负责人及普通员工执行决定，并在行锁内比较总经理账号与本轮快照。服务启动将历史尚未处理的项目负责人轮次安全重指向唯一活动总经理并写审计；总经理缺失或不唯一时阻断启动。审批轮次、项目金额快照、审批记录和合同审计在同一数据库事务中写入；同一根合同组的协议审批使用事务级锁串行处理。
- 解除协议按普通用印流程提交审批；驳回时只把解除协议自身置为已拒绝，被解除目标保持原状态。审批通过后解除协议进入待盖章，目标仍不终止。只有盖章版核验归档事务再次确认解除目标、结算快照及未完成子协议均未变化后，才终止主合同或指定补充协议并更新根合同金额。解除协议进入审批或待盖章期间，合同链新增财务凭证返回 `FINANCIAL_RECORD_TERMINATION_PENDING`（解除办理中禁止新增财务记录）。
- `GET /meta`、台账、详情和审批历史统一返回 `rejected` 状态及“已拒绝”文案；已拒绝根合同的当前金额、发票、回款、付款、核算基数和完成率按经营口径归零，历史财务事实只在详情中保留审计展示，且已拒绝状态不计入终止合同统计。

**盖章核验规则：**

- `POST /:id/sealed` 只接受真实 PDF（便携式文档格式）、JPEG（联合图像专家组格式）或 PNG（便携式网络图形），只创建核验记录，不直接生效；上传与 `retry`（重新识别）均先读取审批合同的锁定分类和合同关系，并把该上下文传入合同识别器。资产类房屋租赁继续使用正文综合总额优先、否则“（月租金＋明确月物业管理费）×租期”、仅有月租金时“月租金×租期”的专用规则；收据、保证金、首期／分期款、水电能源和维修改造费用不得形成盖章版合同金额。合同响应同步返回 `leaseMonthlyPropertyManagementFee`（月物业管理费）及 `monthly_rent_property_fee_calculated`（月租金与月物业费计算）来源；
- 甲方、乙方和金额逐字段与审批快照比较。甲方、乙方或金额的未舍入最终验证值不严格等于整数 100、字段缺失、内容错误或发生候选冲突时，本次核验不可归档，只能重新识别或重新上传；盖章版识别出真实有效日期时以该日期作为归档合同日期。签章页的日期标签与手写值被印章噪声隔开时，仅在同页 OCR（光学字符识别）原文精确出现审批日期且日期不晚于上传日时恢复该日期；非签章页日期不得借用。日期仍缺失或非法时采用盖章文件上传日并记录 `upload_date`（上传日期）来源，不要求逐字段人工确认。上传日兜底不是 OCR（光学字符识别）结果，且不适用于草拟合同；
- 可靠识别值与审批快照存在差异时，管理员必须调用 `reapprove` 提交差异说明，合同重新进入审批中，并锁定唯一活动总经理通过统一 `approve` 接口复审；接口不提供修改识别值以消除差异的能力；
- 只有可靠识别结果与审批快照一致，或差异已经复审通过时，`archive`（归档接口）才能归档当前盖章文件并把合同改为生效中；同一归档事务把盖章版有效识别日期或上传日同步写入合同签订日期及来源。

**财务记录与统计规则：**

- 财务登记页同时提供“发票”和“银行回单”上传位，二者分别调用 `POST /:id/financial-ocr`。发票必传，银行回单可在开票阶段暂不上传；服务端按真实文件头校验 PDF（便携式文档格式）、JPEG（联合图像专家组格式）或 PNG（便携式网络图形），以文件原文调用财务凭证识别服务；银行回单显式固定请求 `v6_medium`（第六版中型模型），不读取环境默认模型，也不调用 Tesseract（开源文字识别）。文件名、客户端金额、日期和主体均不参与自动填充；
- 单页电子 PDF（便携式文档格式）发票优先复用 `pdftohtml -xml`（PDF 坐标文字提取）结构化快速路径。仅当文件为单页，且价税合计、税额、开票日期、发票号码、开票名称、购销双方名称与税号全部完整时，才记录 `pdf_structured_fast`（PDF 结构化快速识别）并跳过整页渲染、PaddleOCR（飞桨文字识别）和 Tesseract（开源文字识别）；扫描件、多页发票或任一字段不全时仍回退原图像识别与独立证据门禁。开票名称只读取“项目名称”列到右侧最近相邻列边界之间的明细及续行，支持多个项目名称，不拼接后方“规格型号”、“产权证书／不动产权证号”及其右侧数量、单价等列；
- 页面移除或清空尚未生成财务记录的凭证时调用 `DELETE /:id/financial-ocr/:jobId`。服务端仅允许删除未消费、未被登记引用且不在识别中的任务，并在同一事务中硬删除识别任务、全局摘要登记和合同附件索引；物理文件随后清理。同一原件不再占用跨合同防重，可重新上传。已消费、已确认或已进入登记的凭证不能通过该接口删除；
- 同一摘要任务处于有效租约的 `processing`（处理中）时返回 `FINANCIAL_OCR_IN_PROGRESS`（财务识别处理中）；基础设施失败或租约过期时，相同文件再次上传会复用已存原件并安全接管原任务，增加重试次数和审计原因。业务阻断、文件错误及普通识别失败保留原结果，不反复重跑；完成结果只有当前 `workerToken`（工作令牌）持有者可写入，旧任务不得覆盖新结果；
- 合同创建时按锁定大类直接写入财务方向和来源：主营／非主营为 `income`（收入），资产类为 `cost`（支出），补充／终止协议继承同类方向。识别任务只有同时满足 `validationStatus=verified`、`canAutoPost=true`、`documentStatus=normal` 及凭证方向符合合同类型时才返回 `canCreateDraft=true`：主营／非主营登记必须配对销项发票与收款回单；资产登记必须配对进项发票与付款凭证。发票业务快照和页面只返回购买方名称、销售方名称、开票名称、发票号码、开票日期、税费、开票金额七项；开票名称完整保留票面内容，例如 `*生产生活服务*技术咨询费`，底层兼容字段仍为 `itemName`（开票名称字段）。双方纳税人识别号及红字／作废判断只作为服务端安全证据，不作为页面识别字段。银行回单只输出并要求电子回单号码、付款时间、付款人户名及账号、收款人户名及账号、金额七项；付款时间保留原件精度，原件只有日期时不伪造时分秒，且不得使用记账日期、上传日期或当前日期兜底。银行凭证的新任务不再要求 Tesseract（开源文字识别）独立证据，但仍要求实际模型为第六版中型模型、单页真实文件、最低行级置信、正常状态及双方账号不同；付款人为公司法定全称时判为付款，收款人为公司法定全称时判为回款，双方同时命中或均未命中时保持方向未知并安全隔离；
- 公司身份以“法定全称＋纳税人识别号”结构化绑定，默认同时管理“北京羽隶工程咨询有限公司”和“北京羽隶科技有限公司”，不得把一家公司的名称与另一家公司的税号交叉组合成命中。发票一方精确命中任一已配置主体、另一方为外部主体时才能确定进项／销项；发票双方都是内部主体或都不是已配置主体时均不能自动入账。仅当资产合同明确采用“工程咨询划拨科技支付”时，付款人为北京羽隶工程咨询有限公司、收款人为北京羽隶科技有限公司的内部划拨回单才按付款日期计入工程咨询经营支出；反向划拨、主体缺失或主体不唯一统一阻断。科技公司随后向合同对方的最终付款只核销履约，不重复计入支出，也不改写发票或回单上的原始法定主体；
- 财务识别前先在根合同甲乙双方中解析合同公司主体，必须恰好一方命中上述已配置主体；双方均命中或均未命中时返回 `FINANCIAL_CONTRACT_SUBJECT_NOT_UNIQUE`（合同公司主体不唯一）并禁止上传财务凭证。本轮发票购销方或银行回单收付方中的公司主体还必须与合同已解析主体一致；科技公司的发票或付款不得误挂到工程咨询公司签署的合同，反向同理，跨主体误挂保持方向未知并阻断自动入账；
- 前端可仅提交 `invoiceOcrJobIds`（发票识别任务编号数组）保存“待回款发票草稿”，也可同时提交尚未覆盖全部发票金额的 `bankOcrJobIds`（银行回单识别任务编号数组），保存为部分回款／付款草稿。后续可反复调用 `POST /:id/financial-registrations/:registrationId/settlements` 追加银行凭证，也可同时增加发票。服务端锁定合同、登记、全部任务及已有对应关系，将原有与新增发票合并，按分计算每张发票剩余额度；累计银行凭证金额小于或等于累计发票金额时保存本批凭证和部分对应关系，超过时返回 `FINANCIAL_REGISTRATION_AMOUNT_MISMATCH`（财务登记金额不一致），任一写入或验证失败整批回滚；
- 保存登记时，服务端先复核发票和银行凭证方向是否符合合同分类，再优先把金额完全相同的凭证一一对应，剩余金额按上传顺序逐笔分配并返回 `matches`（对应关系）：每项包含发票记录编号、回款／付款记录编号和本次对应金额。一张发票可拆分对应多张回单，一张回单也可拆分对应多张发票；每张已保存银行凭证的对应金额必须完整覆盖其票面金额，未结算的发票余额允许暂时保留。本批银行凭证、回款费率快照、合同执行状态及审计在同一事务中确认，凭证立即进入已收／已付和经营核算。批次 `confirm`（确认接口）只负责在发票合计、银行凭证合计及对应分配合计三者完全一致后关闭配对并确认发票；合同详情接口同步返回 `financialRegistrationMatches`，用于持续展示历史登记中的具体对应关系；
- 策略切换不新增或改变路由地址。已消费、已确认、已冲正或已生成正式财务记录的旧双通道任务保持当时结果；尚未生成正式财务记录且识别方法／引擎／解析策略仍为旧版的银行回单，无论旧状态为 `blocked`（已阻断）还是 `verified`（已验证），仅在用户通过既有上传入口显式重新提交同一原件时允许接管重识别。服务端在摘要事务锁内递增重试次数、轮换工作令牌并记录旧状态、旧方法、旧版本、证据摘要和阻断码；页面读取不得触发重算，处理中任务、已消费任务、已有正式记录任务或令牌不匹配的旧实例不得覆盖当前结果；
- 合同财务发票执行两层防重：上传时先以原件 SHA-256（安全散列算法）摘要跨合同拦截同一文件；识别完成后立即以规范化“销售方＋发票号码”检查既有上传任务及草稿、已确认、已冲正记录，命中时返回 `DUPLICATE_CONTRACT_INVOICE`（合同发票重复）且不进入页面金额合计。登记保存仍在固定顺序咨询锁和数据库唯一索引下二次复核；整票概要不重复展示税额，资产租赁逐条明细表独立展示每项税额。银行回单在上传识别完成后和登记保存时均只按规范化电子回单号码全局查重，命中返回 `DUPLICATE_CONTRACT_BANK_DOCUMENT`；付款时间、金额、付款／收款人及双方账号不参与唯一键，只作为识别与审计事实；
- 资产房屋租赁合同的财务发票识别响应在原整票字段外返回 `lineItems`（逐条明细），每项含项目名称、不含税金额、税额、含税金额、自动支出分类、是否计入合同核算和识别状态。登记接口仅接受服务端已验证且逐条金额按分闭合的明细，并保存至独立明细表；合同详情响应的 `rentalInvoiceSummary` 返回租金、物业管理费、合同内合计 `contractAccountingExpense`、电费、系统维护费及合同外合计 `outsideContractCost`，全部金额由服务端按分汇总；
- 资产车辆租赁合同的财务识别若已通过免税／不征税双通道验证，`taxAmount`（税额）允许为 `null`（空值）。单张兼容登记、批量新建登记和已有登记补充发票均按合同锁定的 `vehicle_rental`（车辆租赁）上下文保留该空值；正式发票记录和详情响应不得把空值转成 0。其他合同或未通过免税验证的发票仍必须提供合法非负、最多两位小数的税额；
- `lineItems` 和 `rentalInvoiceSummary` 只在合同具有房屋租赁期限事实时启用；其他资产合同和收入合同返回普通整票识别结果，登记时不要求明细拆分，也不保存发票明细分类；
- 合同财务登记接口不再消费客户端整笔 `expenseCategory`（支出分类）参数；付款主记录只保存历史兼容默认值，资产成本分类和合同核算完全读取服务端发票逐条明细，客户端不能覆盖；
- 资产合同资金方式不再接受客户端人工选择；合同识别写入甲乙双方时自动推导：任一方为北京羽隶工程咨询有限公司则保存 `engineering_direct`，否则保存 `engineering_to_technology`。原 `PATCH /api/contracts/:id/asset-funding-mode` 仅保留历史兼容，不在页面暴露；`POST /api/contracts/:id/financial-registrations/external-payments` 支持无发票时创建待补发票的科技对外付款登记，`POST /api/contracts/:id/financial-registrations/:registrationId/external-payments` 继续向已有登记追加付款。两者只接受付款人为科技公司、收款人为合同对方的已验证回单，不要求当前发票金额与付款一致；后续补票自动挂回原登记，最终确认接口才执行金额闭合校验。工程咨询划拨回单不属于该核算链，只独立进入经营支出统计；
- 报销真实发票、报销核减发票与合同财务发票共用跨模块发票号码门禁：发票号码经 NFKC（兼容等价规范化）、转大写并删除非字母数字字符后作为全局键。报销预查／上传、创建、编辑、恢复及独立核减保存，与合同财务识别任务写入共用按号码字典序取得的事务级咨询锁；同一发票只能先进入其中一个模块，后进入的模块返回 `INVOICE_ALREADY_USED_IN_OTHER_MODULE`（发票已被其他模块使用）并说明来源。无票收据／支付截图明确排除，其他上传模块不受影响；
- 银行凭证在每次创建或补充登记成功时即变为 `confirmed`（已确认）并进入合同状态、完成率、台账汇总和经营看板；登记在配对未闭合期间仍保持 `draft`（未闭合），发票也保持草稿。配对金额完全闭合后，批次 `confirm` 只确认发票和登记，不覆盖银行凭证原始确认时间或费率快照。纯发票草稿可以硬删除；已有已确认银行凭证的开放登记禁止删除，`reverse`（冲正）允许整组关闭并冲正已入账金额。没有 `registration_id`（登记编号）的历史单条记录继续使用旧路径只读兼容，不能与新登记混用或自动补配；
- 盖章上传和重试在识别前校验合同状态及乐观版本；盖章识别队列已满时返回 `SEALED_RECOGNITION_BUSY`，无效合同不会先消耗识别资源；
- 列表、看板和项目排行对单项及聚合金额执行整数分回验，超过安全展示范围时返回 `CONTRACT_AGGREGATE_SAFE_RANGE_EXCEEDED`，禁止静默丢失分值；
- 资产付款分类仅允许房租、电费、车位费、租车、网费、其他六类；资产类禁止录入回款，非资产类禁止录入付款；
- 只有生效中、执行中的合同可新增财务记录，已完成合同阻止新增；已完成记录冲正且结算不足时自动回到执行中；
- 已拒绝合同即使在驳回前存在已确认财务事实，也不参与台账汇总、项目排行、月度趋势、年度收入、履约完成率或经营风险统计；其历史凭证不删除，仅作为审计事实保留；
- 回款确认时保存当笔核算费率快照，主营商务费用率按 10% 计算，历史统计不随以后新增费率版本重算。

**查询、审计和队列规则：**

- 台账支持分类、生命周期状态、结算状态、项目、区域、关系、相对方、合同日期、关键字和分页；分类筛选对尚未形成正式分类的草稿使用上传时锁定的声明分类。`settlementStatus`（结算状态）只允许 `unsettled`（未结算）、`partial`（部分结算）、`settled`（已结清），并只匹配固定金额且当前处于生效中、执行中或已完成的根合同组。合同日期范围固定读取根合同日期，子协议自身日期不参与合同链日期筛选。经营看板改用 `startMonth/endMonth`（开始月份／结束月份），默认当前年度 1 月至当前月，允许完整自然年和最多连续 36 个月；开始晚于结束或范围超限返回 `400`。全部／有效／待签金额、三类有效合同结构与累计未结、结算状态仍为全历史快照，不受起止月份过滤；期间合同额和项目排行按根合同签订月份过滤，收支、开票和核算收入按实际发生月份过滤；
- `GET /api/contracts/dashboard`（获取合同经营看板）返回 `startMonth/endMonth` 及统一期间指标：`summary.periodContractCount/periodContractAmount`（期间生效合同数量／金额）、`periodIncome/periodExpense/periodInvoiceAmount/periodAccountingIncome`（期间收入／支出／开票／核算收入）；顶部 `allContract*`、`effective*`、`pendingSignature*` 明确为全历史快照。`categories` 同时返回期间结算、全历史累计结算、未结和完成比例；`mainBusiness/nonMain/asset` 返回期间收付及全历史累计余额。`monthlyTrend` 完整覆盖起止月份；`periodComparison` 返回所选期间、上一等长期间和上年同期，单月时等价为本月、上月和上年同月。基期为 0 时 `percentage`（比例）为 `null`（空值），不得返回无穷值、非数值或伪造的 0%；
- 看板和台账结算筛选只读取 `confirmed`（已确认）银行回单／付款，`draft`（草稿）和 `reversed`（已冲正）始终排除；主营、非主营直接按合同分类读取回款，资产类读取付款，尚无首笔财务登记的有效合同仍可进入未结算统计。无固定金额以根合同原始金额、金额增减和当前有效金额联合识别，不能把历史迁移形成的 0 当作固定零元合同；其真实收付可进入分类累计金额，但不会进入分类完成比例或正常结算三态。所有聚合、未结差额和环比／同比金额先按整数分回验，分类和项目筛选同时作用于三期比较；一月份的上月固定为上一年度十二月；
- 文件预览和强制下载使用同一鉴权接口并写审计。普通员工和 BOSS（经营管理）只能内联预览行政区域不为“全部”的合同文件，`download=1`（强制下载）固定返回 `CONTRACT_DIRECT_DOWNLOAD_FORBIDDEN`；总经理和管理员组可直接下载。台账、详情、合同关系及看板对普通员工／BOSS 的查询同时在服务端排除“全部”区域；`audit-logs` 返回操作人实时角色、前后状态、结果、说明和结构化变更；
- OCR（光学字符识别）任务通过工作实例令牌和 5 分钟租约原子认领，每 60 秒续租及检查过期任务；并发数限制为 1 至 4，多实例和服务重启时不会让旧任务覆盖当前文件版本。

### 员工路由 (`/api/employees`)

```typescript
GET    /api/employees/list                          // 获取员工列表
GET    /api/employees/statistics                    // 获取员工统计数据
GET    /api/employees/my-profile                    // 获取本人档案；BOSS返回空且不自动建档
GET    /api/employees/:id                           // 获取单个员工信息
PUT    /api/employees/:id                           // 更新员工信息
DELETE /api/employees/:id                           // 删除员工信息
GET    /api/employees/:id/documents                 // 获取员工人事档案文件
POST   /api/employees/:id/documents                 // 上传员工人事档案文件
POST   /api/employees/:id/documents/auto-classify   // 自动识别类型并上传员工人事档案文件
DELETE /api/employees/:id/documents                 // 一键删除员工全部人事档案文件
DELETE /api/employees/:id/documents/:docId          // 删除员工人事档案文件
GET    /api/employees/:id/documents/:docId/download // 下载/预览员工人事档案文件
GET    /api/employees/:id/resignation-archive       // 获取员工五类离职档案当前版本及完成状态
GET    /api/employees/onboarding/templates                          // 获取入职模板列表
POST   /api/employees/onboarding/templates                          // 管理员上传入职模板
DELETE /api/employees/onboarding/templates/:templateId              // 管理员删除入职模板
GET    /api/employees/onboarding/templates/:templateId/original     // 管理员预览未写编号的原模板
GET    /api/employees/onboarding/templates/:templateId/preview      // 员工在线预览模板
GET    /api/employees/onboarding/templates/:templateId/download     // 员工下载个性化模板
```

**员工实时状态规则：**

- `GET /api/employees/list` 返回员工档案中的基础状态，并增加 `effective_employment_status`（实时在职状态）供列表展示和筛选
- 已批准请假进入北京时间对应的日期和上午、下午时段后，实时状态为 `on_leave`（休假中）；结束时段到达后自动恢复基础状态，不写回员工档案
- `GET /api/employees/statistics` 使用同一实时状态规则统计在职、实习期、休假中和已离职人数

### 离职路由 (`/api/resignation`)

```typescript
GET    /api/resignation/templates                                      // 管理员获取五类当前模板
POST   /api/resignation/templates                                      // 管理员上传真实 PDF 模板
DELETE /api/resignation/templates/:id                                  // 管理员删除模板
GET    /api/resignation/templates/:id/preview                          // 管理员在线预览原模板；历史 DOCX 临时转换为 PDF
GET    /api/resignation/templates/:id/download                         // 下载原模板；download=1 强制下载
GET    /api/resignation/management/candidates                          // 获取可创建离职记录的员工
POST   /api/resignation/management                                     // 创建离职人员记录
GET    /api/resignation/management                                     // 获取离职人员列表
GET    /api/resignation/management/:id                                 // 获取离职档案详情
PATCH  /api/resignation/management/:id                                 // 更新离职日期或备注
DELETE /api/resignation/management/:id                                 // 删除档案待完善记录
POST   /api/resignation/management/:id/documents/type/:documentType    // 单类 PDF 上传或替换
POST   /api/resignation/management/:id/documents/auto-classify         // 合并 PDF 一键识别拆分
POST   /api/resignation/management/:id/confirm-completion              // 管理员核对后确认离职并停用原账号
DELETE /api/resignation/management/:id/documents/:documentId           // 删除未完成档案文件
GET    /api/resignation/management/:id/templates/:templateType/editor  // 获取原模板叠加编辑数据
GET    /api/resignation/management/:id/templates/:templateType/preview // 预览转换后的原模板 PDF
PUT    /api/resignation/management/:id/templates/:templateType/editor  // 保存字段覆盖值和自定义文字
GET    /api/resignation/management/:id/templates/:templateType/download // 下载按原版式生成的 PDF
GET    /api/resignation/management/:id/templates/print-all             // 合并五类模板供一并打印
GET    /api/resignation/requests/:id/documents/:docId/download         // 预览或下载离职档案
```

**离职状态与一致性规则：**

- 整组路由仅管理员和超级管理员可访问，员工端旧离职申请、交接和审批接口不再作为业务入口
- 离职人员列表同步返回员工入职日期和当前员工状态，供管理页面区分在职、实习期及已离职
- 新上传模板仅接受真实 PDF（便携式文档格式）；接口同时校验 `.pdf` 扩展名、`application/pdf` 媒体类型和 `%PDF-` 文件头，不能通过改扩展名绕过
- 历史已上传的 DOCX（开放 XML 文字处理文档）继续兼容读取；系统先将未改写原稿固定转换为 PDF（便携式文档格式）底稿，再保留“编号：”并按原文字宽度统一覆盖每页完整编号
- 姓名、身份证号、首次劳动合同日期、离职日期、部门、职位和任职年限由服务端提供；各自动字段返回所在模板文字行的真实字体、字号和颜色，不接受客户端手工指定字号
- 编辑接口中的自动字段同时返回从原模板对应文字行读取的字体、字号和颜色，在线预览与下载文件使用同一份排版参数
- 编辑接口逐页提取 PDF（便携式文档格式）中未被自动字段覆盖的空白填写下划线及下划线上已有文字，过滤细表格边框和普通固定正文，并将每条填写线作为可保存字段返回；已有文字字段同时返回原文字标记，未修改时生成文件继续保留原模板字形，修改后才遮盖原字并写入覆盖层；保存接口使用同一份 PDF 坐标重新构建字段清单，避免丢失签名、日期、金额及原文字修改值
- 终止协议的首次劳动合同日期按年、月、日三个槽位完整返回；模板编号返回每页 `YULI-CSXXX-LZ序号` 的完整精确覆盖坐标，未识别到坐标的页面不使用其他页面位置代填
- 首次劳动合同日期按人事档案中合同开始日期升序读取最早一份，不使用当前续签合同替代
- 当前 PDF（便携式文档格式）模板直接作为底稿；历史 DOCX（开放 XML 文字处理文档）模板转换为 PDF（便携式文档格式）后继续使用
- 固定档案类型为终止 / 解除劳动关系协议书、员工离职交接单、薪资及各类款项结算确认书、离职经济补偿协议书、离职证明
- 一键识别不限制五类材料顺序，以每份材料首页标题作为新分段边界；兼容全角或半角分隔符及少量识别误差，真正未识别到首页标题的文件起始页会拒绝归档并返回页码
- 五类当前档案齐全后，离职记录自动由 `draft` 更新为 `pending_confirmation`，管理员可继续预览、替换或删除文件；删除任一必需档案时自动退回 `draft`
- 调用确认接口后，离职记录才更新为 `approved`，并与员工状态、原账号状态和审计日志在同一事务中更新
- 完成后允许替换错传文件但禁止删除；替换不会再次停用后来人工激活的旧账号
- 已离职档案不能改回在职；返聘必须创建新账号和新员工档案

### 人力成本路由 (`/api/payroll`)

```typescript
GET   /api/payroll?month=YYYY-MM             // 管理员只读获取已生成的指定月份工资表
POST  /api/payroll/generate                  // 管理员主动生成或同步指定月份工资表
PATCH /api/payroll/:month/:employeeId        // 管理员修改本月工资、公积金基数、社保基数或应纳个税
GET   /api/payroll/receipts?month=YYYY-MM    // 获取指定月份四类人力成本回单及识别汇总
POST  /api/payroll/receipts                  // 批量上传指定月份、指定类别的银行回单
POST  /api/payroll/tax-details               // 上传个人个税明细并按姓名自动填充应纳个税
DELETE /api/payroll/receipts/:receiptId      // 删除识别完成或失败的错传回单
GET   /api/files/human-cost-receipt-items/:itemId // 预览员工对应的单笔工资回单
GET   /api/files/payroll-tax-details/:fileId // 在线预览个人个税明细原件
```

**人力成本接口规则：**

- 三个接口均使用管理员权限中间件，只允许管理员、超级管理员访问
- 超级管理员可以管理工资表，但其系统维护账号本身不生成工资记录，也不参与明细和合计
- 金额字段由前端以字符串提交，后端限制为非负数、整数最多 12 位、小数最多 8 位
- 数据库 `NUMERIC`（精确数值）字段读取时转为字符串，避免 JavaScript（脚本语言）浮点数导致精度丢失
- 工资表保存本月工资、公积金缴费基数、社保缴费基数、应纳个税及各自手工修改标记；单位和个人社保均按社保缴费基数计算，单位和个人住房公积金均按公积金缴费基数 × 6% 计算。每名员工的各险种、公积金和个税先四舍五入到分，再参与员工合计、全员合计、实发工资和公司成本计算
- 工资表汇总返回 `cost_total`（公司人力成本合计），等价公式为本月工资总额加单位社保总额、单位公积金总额；实现上使用代扣合计加实发工资得到同一结果。个人社保、个人公积金和个税属于员工工资代扣，会在实发工资中抵减，不作为公司额外成本重复计入；内部使用精确十进制计算，表格明细和合计统一四舍五入显示两位小数
- 主动生成新月份时，本月工资、公积金缴费基数和社保缴费基数默认沿用紧邻上月的最终值；应纳个税默认 0，待当月手工修改或上传个人个税明细后更新。当前及未来月份只刷新未在该月手工修改的默认值；历史月份一旦生成即作为快照，不在读取时自动重算
- 修改接口必须提交当前记录 `version`（版本号）；版本过期返回 409，防止两个管理员相互覆盖，并将每个修改字段写入工资修改日志
- 回单上传使用 `multipart/form-data`（多段表单数据），字段为 `month`、`category`、UTF-8（统一字符编码）的 `originalNames` 和最多 20 个 `files`；`category` 仅允许 `social_security`、`housing_fund`、`income_tax`、`net_salary`
- 回单只接受内容与声明格式一致的 PDF（便携式文档格式）、JPEG（图像格式）和 PNG（便携式网络图形），单个文件最大 50MB；同月份、同类别、同文件摘要返回重复并跳过
- 上传成功返回 202，文件保存后进入 `processing`（处理中）；前端轮询读取接口，直至转为 `recognized`（已识别）、`partial`（部分识别）或 `failed`（识别失败）
- 四类文件均复用财务区审批中心付款回单的解析和真实性校验；PDF（便携式文档格式）按页转换图片，并兼容同页上下两笔回单。金额按整数分汇总，部分页面失败时只汇总校验成功金额；机构类收款人支持从住房公积金管理中心、社保管理中心和待报解预算收入等全称兜底提取，避免第二个“户名”标签漏识别后误报收款人缺失
- 实发工资只接受摘要、用途、备注或客户附言中具有工资语义的银行回单；“备注”字段包含“薪资”时明确判定为工资用途候选，并继续执行同源银行回单真实性校验。同一 PDF（便携式文档格式）内其他回单不计入失败或金额汇总，并通过 `ignored_item_count` 返回忽略笔数
- 银行回单按月份和类别限制为一个上传批次：首次请求仍可批量提交多个文件；该月份、该类别已有任意回单时，后续上传返回 409，删除该类别全部回单后才允许再次上传。个人个税明细接口不受此限制
- 实发工资文件中只要至少一笔工资银行回单通过同源真实性校验，即按已识别处理；其他无关页面或失败片段不再把整份工资文件标记为待核对。每位员工的回单金额仍随 `salary_receipts` 返回，前端将回单合计与账面实发金额逐人比较，金额不一致时标红但保留点击预览
- 旧识别版本的历史回单在读取对应月份时自动排队重识别，使已上传文件直接应用最新校验、工资过滤和员工关联规则
- 历史重识别和新上传识别共用单一串行队列，同一回单不会重复入队；识别引擎发生基础设施异常时暂停当前批次的后续任务，登录和其他业务接口继续可用
- 实发工资回单优先按完整收款账号匹配员工；明确具有工资或薪资用途，并已识别银行回单关键字、金额和交易凭证时，允许文字识别漏掉收款账号，改按收款户名精确匹配员工。社保、公积金、个税及普通付款回单仍要求账号；同名或无法唯一匹配时不自动关联。工资表每行返回 `salary_receipts`，点击员工实发金额后通过单笔预览接口查看对应页及上下区域
- 主动生成指定月份时会同步该月人员范围：入职当月加入，离职当月保留并从离职次月移除；重复生成会清理该月不再符合条件的预生成记录
- 回单原件通过 `GET /api/files/human-cost-receipts/:receiptId` 由管理员权限校验后内联预览，不直接暴露上传目录
- 个人个税明细上传与个税银行回单是两个独立入口；`POST /api/payroll/tax-details` 使用 `multipart/form-data`（多段表单数据），字段为 `month`、UTF-8（统一字符编码）的 `originalName` 和单个 `file`
- 个税明细支持内容真实的 PDF（便携式文档格式）、JPEG（图像格式）和 PNG（便携式网络图形），单个文件最大 50MB；服务按文字坐标定位“姓名”行与“应纳个税”列，空白单元格填 0，只更新文件中成功匹配的本月员工
- 个税明细识别成功后批量更新 `individual_income_tax`、手工标记和记录版本；金额发生变化时写入工资修改日志，并返回更新后的完整工资表、识别人数、0 元人数及未识别员工名单。识别成功的原件按工资月份保存，重复上传会替换该月上一份明细，并可通过管理员文件接口内联预览

### 正式入职邀请函上传 (`/api/employees/:id/documents`)

- `document_type=invitation` 时只识别 PDF（便携式文档格式）第一页
- 成功识别月度税前工资后更新员工工资档案，并同步当前及未来已生成月份的自动工资
- 新上传的正式邀请函作为最新工资依据，会覆盖当前及未来月份原有的本月工资手工值并解除该字段的手工标记；缴费基数和应纳个税的手工值保持不变
- 识别失败不阻止入职邀请函归档，也不会覆盖员工已有工资基线；响应返回失败原因供管理员手工处理

### 劳动合同归档 (`/api/employees/:id/documents`)

- `document_type=contract` 时识别劳动合同起止日期和试用期截止日期；扫描件兼容日期下划线、空格和常见数字误识别
- 每次上传都新增一条合同档案，不覆盖旧合同；响应返回 `contractRecognition`、`currentHireDate`、当前有效的 `currentContractEndDate`、首份合同对应的 `currentProbationEndDate` 和 `probationConfirmationSynced`
- `employee_profiles.hire_date` 由合同自动维护：取所有已识别完整起止日期合同中最早的开始日期；员工保存资料和管理员编辑均不能覆盖
- 合同结束日期最晚的档案作为当前合同，其余档案保留为历史合同；员工列表合同到期时间同步取当前合同结束日期
- 第一份劳动合同识别到试用期截止且员工仍为实习期时创建待提交转正记录；已有转正记录无论状态均同步校正日期，但不改变审批状态和正式文件
- 删除合同时重新计算第一份合同、入职日期和当前合同结束日期；没有可识别合同后将员工入职日期与合同到期时间清空
- 新建账号的入职日期为空，选择实习期也不会提前生成待转正记录；合同识别出开始日期和试用期截止后再建立或同步记录
- 已注册员工没有成功识别起止日期的劳动合同时，员工资料与转正记录中的入职、试用期日期均为空；旧版手填或推算日期在启动迁移时清理

### 员工合同到期提醒 (`GET /api/approval/pending-counts`)

- 待办计数同时返回当前用户的 `myHireDate`、`myContractEndDate` 和 `myEmploymentStatus`
- 员工端通过现有待办轮询同步入职日期和劳动合同信息，管理员上传合同后无需员工刷新或重新填写
- 前端与管理员员工列表共用到期判断：结束日期距离当天不超过 10 天时开始提醒，到期后持续提醒，已离职员工不提醒
- 合同日期随现有待办轮询更新，用于左侧“入职”菜单红色角标
- 管理员和超级管理员额外返回 `probationDueSoon`，统计试用期截止距当天不超过 30 天或已经到期、且仍待提交/驳回待处理的实习期员工
- 管理员和超级管理员额外返回 `probationArchivePending`：正常流程统计已经完成全部转正审批、但当前申请版本尚未上传 `official` 正式盖章档案的员工；直接创建为在职且没有转正流程的员工，在尚未补录直属 `official` 正式档案时也计入。统计按员工去重，超级管理员、老板和董事长等系统专用账号不计入员工到期及待归档提醒

### 员工转正档案 (`/api/probation/employee/:employeeId`)

- `GET /archive`：管理员读取员工转正记录及正式盖章档案；正常流程只返回管理员在“转正档案”上传的 `official` 文件，系统终审生成的 `generated` 底稿、待提交、审批中和已驳回材料均不进入正式档案
- `POST /documents`：管理员上传正式盖章文件；已转正记录允许在尚无 `official` 文件时上传一次，系统生成底稿不占用该名额；上传后沿用同一转正记录并自动同步到转正申请列表“正式文件”列
- `DELETE /documents/:docId`：只允许删除未走审批流程的管理员补录材料，流程内材料继续遵循转正状态锁定规则
- `GET /documents/:docId/download`：管理员在员工详情中预览或下载正式转正申请表；存在未通过的正常转正记录时拒绝读取流程材料
- 审批中记录禁止上传正式文件；已完成记录只在已有正式盖章文件时禁止重复上传，系统生成的待盖章底稿不视为已归档
- 待填写或已驳回记录属于正常员工流程，管理员补档接口拒绝上传，员工本人在转正页面在线填写述职并重新签名

### 在线转正申请与分阶段签名 (`/api/probation`)

```typescript
GET  /api/probation/template-preview       // 登录用户读取管理员最新原始模板，仅供在线画布渲染
GET  /api/probation/my-status             // 员工读取自动填写数据、当前阶段、签名记录和正式文件
POST /api/probation/online-submit         // 员工提交原模板中的本人述职、转正类型和已确认签名类型
GET  /api/probation/signature-tasks       // 当前账号读取本人待签署的转正申请
GET  /api/probation/signatures/:id/image  // 有流程权限的账号在原模板中回显签名图片
POST /api/probation/:id/sign-review       // 当前签署人填写意见、选择签名并通过或驳回
GET  /api/probation/list                  // 管理员、总经理或董事长按职责读取转正管理列表
GET  /api/probation/:id                   // 管理员、总经理或董事长读取申请详情和当前版本签名记录
GET  /api/probation/:id/approval-flow     // 有权限的参与人读取当前流程及全部版本审批记录
```

**自动填写与签署规则：**

- 员工提交时后端从员工档案快照申请人、部门、职位和劳动合同入职日期，职位同时作为转正定岗；客户端不能提交这些自动字段
- 员工和各级审批人直接在管理员最新上传的单页 PDF（便携式文档格式）模板上填写；接口只以内嵌方式提供底稿，页面不提供员工模板下载入口
- 本人签名的服务端时间作为申请日期；主管领导、人事部和最终审批的签名日期也只取服务端时间
- 转正必须按员工、主管领导意见、人事部意见、董事长最终审批顺序处理；员工每次提交时固定保存总经理、管理员和董事长的账号及姓名快照，待办和签署权限只开放给该版分配人
- 当前流程返回四个环节的审批人姓名，页面显示为“角色（姓名）”；已签环节始终使用签署记录中的姓名快照，账号改名或后续换人不会改变历史审批人
- 超级管理员、老板和董事长等系统专用账号本人不作为转正申请对象，不进入转正列表、统计、签署待办目标、本人转正状态或转正档案；超级管理员和董事长按各自权限查看或审批真实员工转正不受影响
- 参与人必须先在个人设置确认并锁定本人签名；转正接口只接收 `personal`（本人签名），由服务器读取、处理并复制已保存签名，不接收客户端任意签名图片
- 每条签署记录保存实际登录操作人，申请单签名人就是该操作人，不再产生管理员代签记录
- `my-status`、`signature-tasks` 和申请详情同时返回当前版本 `signatures` 与全部版本 `signatureHistory`；历史记录包含版本、环节、决定、签名人、实际操作人、意见和服务端签署时间
- 签名图片读取接口只允许申请人、对应主管、原签署人、管理员、超级管理员、总经理或董事长访问，不返回物理存储路径
- 驳回必须填写非空驳回理由，否则 `sign-review` 返回校验错误且不写入审批记录；驳回成功后把当前阶段退回员工重新填写，历史版本签名保留审计
- 员工重新提交时 `form_version` 递增，不能覆盖旧版本签署记录；员工端和审批任务端均可查看当前流程及全部历史版本
- 管理员签署人事部意见并通过后，申请进入董事长待办；管理员不能继续点击或代签最终审批栏
- 董事长完成最终审批时写入转正完成状态、员工在职状态和终审时间，并基于当前版本生成唯一的待盖章 PDF（便携式文档格式）底稿
- 待盖章底稿中的转正结论使用员工姓名、职位和最终审批签名日期生成；最终审批签名前不生成底稿及转正结论
- 管理员申请详情把 `generated_documents` 作为待盖章底稿返回，可预览、下载和打印；`documents` 只返回管理员归档的正式盖章文件
- `my-status`、转正申请列表和员工转正档案只返回当前版本 `source_type='official'` 的正式盖章文件；终审生成底稿、旧员工上传材料及驳回版本不能冒充正式文件
- 管理员在员工转正档案上传盖章文件后，同一条 `probation_documents` 记录会立即被转正申请列表读取，无需复制物理文件
- 管理员使用 `status=approved&thisMonth=1` 查询本月最终完成记录；接口同时限定本月开始和下月开始边界，避免未来日期误入
- 总经理使用 `reviewedByMeThisMonth=1` 查询本人本月实际签署过主管领导意见的申请；董事长使用同一参数查询本人本月实际处理的最终审批，通过和驳回都计入
- 已废弃的员工模板下载上传流程、管理员代上传代提交以及旧式直接通过或驳回接口返回 `410`，防止绕过在线签署链

### 人事档案一键删除 (`/api/employees/:id/documents`)

- 仅管理员可调用，一次删除指定员工的全部 `employee_documents` 档案记录
- 档案删除和员工入职日期、合同到期时间清空在同一数据库事务中完成；存在劳动合同时，同步重算当前及未来月份的自动工资，保留手工金额和历史月份快照
- 入职邀请函形成的工资基线不会随档案文件一起删除，来源文件字段由外键自动置空；已经生成的工资记录也不会删除
- 数据库事务提交后再清理存储文件；个别存储文件清理失败时接口仍返回已删除的档案数量和清理失败数量，便于后续排查

### 人事档案自动识别上传 (`/api/employees/:id/documents/auto-classify`)

- 仅管理员可调用，沿用单文件 10MB（兆字节）上限；前端多选后按文件逐个请求，浏览器与生产反向代理仅对此接口放宽至最长等待 40 分钟，避免大批扫描件并发或提前超时
- 单个 PDF（便携式文档格式）可包含多类材料；接口逐页读取文字层或执行 OCR（文字识别），以每类首页标题作为页段边界
- 页面最靠前的固定类型主标题优先于正文交叉词；扫描页先执行 300 DPI（每英寸点数）标题区快速筛查，只有标题区文字充分、平均置信度达标且没有任何边界候选时才直接视为续页，证据不足、分类候选或证件类页面继续执行 480 DPI（每英寸点数）标题增强及 300 DPI（每英寸点数）整页兜底
- 劳动合同、保密协议和个人声明固定保留高分辨率确认；低风险类型只有两种文字排序均得到前置精确标题、完整正文结构且无竞争类型时才省略增强轮。固定类型冲突或固定类型与明确“其他资料”标题冲突时返回 `422`；完全没有页段边界时，整文件后备仍复核第一页
- 多个固定类型候选无法确定唯一类型、某页文字层与两次图片识别均缺少有效文字，或多页文件未识别出任何可靠页段边界时返回 `422`；`analysis.uncertainPages`（分析中的不确定页）提供页码、候选类型和说明，接口不会拆分文件或写入任何档案记录
- 文档类型顺序不固定；同一页段的页面保持连续，同类型首页被其他材料分隔后会拆成另一份独立档案；未出现的类型不会生成档案记录
- 识别后的每个类型会拆成独立 PDF（便携式文档格式）并分别写入 `employee_documents`
- 离职证明、职业资格材料等明确非固定材料可直接拆分并写入 `document_type=other`（档案类型为其他）；通用资料标题属于弱证据，只有整页与标题区两路结果一致时才自动归入“其他”，“成如下协议”“达成如下协议”等正文句不会作为资料标题；仅一次命中、标题不一致或与固定类型冲突时返回 `422`。内容可读但无法匹配固定十类的单页 PDF（便携式文档格式）仍可归入“其他”，多页文件没有可靠页段边界或页面缺少有效识别文字时拒绝整次上传
- 响应通过 `otherSegments` 返回已归入“其他”的材料名称和页码，并暂时保留同内容的 `unsupportedSegments` 兼容旧前端
- 响应通过 `missingTypes` 返回本次文件未识别到的固定十类档案；“其他”是可选收纳类型，不属于缺失项
- 多类档案记录在同一个数据库事务中写入；任一拆分或写入失败时整批回滚并清理拆分文件
- 空 PDF（便携式文档格式）、超过页数限制或无效文件仍会拒绝，不产生档案记录
- 拆分出入职邀请函后继续执行工资识别和本月工资同步，自动上传不会绕开原有工资业务逻辑
- 分类阶段已得到的图片识别候选会在请求内按原页码映射到拆分文件，用于劳动合同期限和邀请函工资解析；PDF（便携式文档格式）文字层优先，多个图片候选结果不一致时自动执行原有高分辨率回退，完整识别原文不会写入响应或数据库
- 网关等待超时或浏览器连接中断时，前端将结果标记为“暂时无法确认”，明确提示不要重复上传并稍后刷新员工档案；只有服务端明确返回业务失败时才显示为上传失败
- 服务端明确返回成功后，前端在当前员工的人事档案页内显示绿色完成提示，列出本文件实际归档的档案类型；提示不会自动消失，只能由管理员点击对应关闭按钮移除
- 生产发布流程在容器更新后固定校验并重载 Nginx（反向代理），并复核该路由的读取、发送等待时间均为 2400 秒，避免绑定挂载已更新但旧工作进程仍按 60 秒返回 `504`

### 入职模板员工编号与合同日期

- `POST /api/users/create` 自动生成唯一员工编号；`POST /api/users` 修改编号时同步更新对应 `employee_profiles.employee_no`
- `PUT /api/employees/:id` 接收部门、职位、合同模板起止日期和可选试用期起止日期；职位必须属于所选部门，日期范围必须成对填写、顺序正确，且试用期位于合同期限内
- 入职邀请函上传时校验每一页右上角“编号”，劳动合同书同时校验全部编号位置、劳动合同期限、试用期年月日空位和第四条职位区域，新员工入职申请表校验第 1 页右上角“员工编号”
- 2025年度公司电脑管理办法上传时校验每一页“编号”以及“附件1 笔记本电脑协议书”中的甲方、乙方和身份证号码位置；员工 `preview（预览）` 或 `download（下载）` 时自动在每一页写入员工编号，并写入甲方单位“北京羽隶工程咨询有限公司”、乙方姓名和身份证号码，员工姓名或身份证号码缺失时返回 `409`
- 员工调用模板 `preview` 或 `download` 接口时，后端读取 `users.employee_no` 并实时写入全部目标页；原始模板文件不会被修改
- 劳动合同 `preview（预览）` 接口始终开放：只使用管理员当前设置的合同期限和试用期；未设置当前模板期限时保留最新版模板中的空白日期，不再沿用上一期或正式合同日期，第四条岗位仍读取员工档案中的当前职位
- 劳动合同书 `download（下载）` 接口还会读取当前员工的模板日期和职位，写入合同期限、试用期及第四条岗位；未设置合同期限或职位时返回 `409`，模板缺少日期或第四条职位位置时返回 `422`，续签无试用期时对应位置保持空白
- 人事档案成功归档劳动合同后，同一事务清空四个新周期日期字段并返回 `contractTemplateLocked=true`；员工端下载随即锁定，预览显示最新版模板的空白日期并实时填入当前职位，管理员重新设置下一期合同模板起止日期后才写入新日期并重新开放下载
- 合同模板拟定日期只用于生成待签文件；签字合同归档后仍由 OCR（文字识别）结果维护正式入职、合同到期和转正日期
- 管理员预览模板使用 `original` 接口，因此不会写入管理员自己的编号
- 员工及管理员通过人事档案下载接口预览正式资料时，接口直接返回管理员上传的档案，不覆盖文件内编号，也不修改展示文件名
- 员工编号修改后无需重新上传模板，下一次模板预览或下载自动使用新编号；已经归档的历史资料保持原样
- 动态编号文件返回 `Cache-Control（缓存控制）: no-store`，防止浏览器继续展示改号前的缓存副本

### 请假路由 (`/api/leave`)

```typescript
GET    /api/leave/types                         // 获取可用假期类型
GET    /api/leave/balances                      // 获取本人当年假期余额
POST   /api/leave/calculate-days                // 预计算请假天数
POST   /api/leave/calculate-period-by-days       // 按组合总天数自动反算结束时间
POST   /api/leave/calculate-full-period         // 按本人可用余额计算一键请满时间
POST   /api/leave/requests                      // 提交请假申请
POST   /api/leave/requests/combined             // 原子提交并拆分组合请假
GET    /api/leave/requests                      // 获取本人请假申请列表
POST   /api/leave/requests/approved/mark-read   // 将本人全部审批通过提醒标记为已读
POST   /api/leave/requests/:id/rejected/mark-read // 将本人指定驳回提醒标记为已读
GET    /api/leave/requests/:id/related-context  // 获取续假或补假的主申请上下文
POST   /api/leave/requests/:id/related          // 提交单一或组合续假/补假
GET    /api/leave/requests/:id                  // 获取请假申请详情
POST   /api/leave/requests/:id/cancel           // 撤回请假申请并转为草稿
POST   /api/leave/requests/:id/resubmit         // 草稿或驳回申请重新提交
DELETE /api/leave/requests/:id                  // 永久删除本人草稿及其完整历史链
GET    /api/leave/pending                       // 指定总经理或董事长获取本人待审批请假
GET    /api/leave/reviewed                      // 总经理或董事长获取本人历史审批记录
POST   /api/leave/requests/:id/approve          // 指定总经理或董事长审批通过
POST   /api/leave/requests/:id/reject           // 指定总经理或董事长审批驳回
GET    /api/leave/admin/types                   // 管理员获取假期类型
POST   /api/leave/admin/types                   // 管理员新增假期类型
PUT    /api/leave/admin/types/:code             // 管理员修改假期类型
DELETE /api/leave/admin/types/:code             // 管理员删除假期类型
GET    /api/leave/admin/requests                // 管理员获取全员请假抄送记录
GET    /api/leave/admin/balances                // 管理员获取余额总览
PUT    /api/leave/admin/balances/:targetUserId/:typeCode/:year // 管理员手动调整余额
GET    /api/leave/admin/export                  // 管理员导出请假记录
```

**假期类型更新规则：**

- `PUT /api/leave/admin/types/:code` 会在 `transaction（事务）` 中锁定当前配置后保存，避免并发修改造成配置与余额不同步
- 默认天数发生变化且该类型需要余额检查时，会同步当年仍等于旧默认天数的余额记录
- 已由管理员手动调整为其他数值的个人余额不自动覆盖，且不会把总额降到已使用与审批中天数之下
- 年假属于例外：低于年假基础额度的个人总额会在读取时自动补足，高于基础额度的人工调整继续保留
- 假期默认天数和个人总天数只接受 0 至 999.5 的半天倍数
- 年假、带薪事假、病假、丧假、婚假、产假和陪产假强制启用余额检查；管理员只能调整其默认天数或员工个人年度总天数，不能改为不限额度
- `PUT /api/leave/admin/balances/:targetUserId/:typeCode/:year` 使用行锁校验调整值不得低于已使用与审批中之和；不限额度类型拒绝余额调整

**请假提交与余额规则：**

- 日期与上午、下午时段由后端校验，开始日期不得早于服务器当天，结束时间不得早于开始时间，单次区间最长 366 个自然日
- `calculate-period-by-days` 接收开始日期、开始时段和半天倍数的组合总天数，按统一节假日及补班表自动返回结束日期和结束时段，并与单次申请共用 366 个自然日的区间上限；组合补假可传 `allowPast=true` 计算历史时间
- `calculate-full-period` 读取申请起始年份的实时可用余额，并按统一节假日和补班表向后寻找结束半天；当年剩余工作日不足以请满时返回 `409`，补假场景可传 `allowPast=true`
- `requests/combined` 接收总时间段和 2 至 8 个类型分段，按工作半天顺序拆成独立申请；所有分段在同一事务中校验类型、性别、事由、附件、重叠与余额，任一失败整组回滚
- 组合分段天数必须都是 0.5 天的倍数、类型不得重复，分段合计必须等于所选总时间段的实际工作日
- `requests/:id/related` 仅允许本人基于已批准申请创建，接收 `requestMode=single|combined`；组合模式接收 2 至 8 个类型分段，分配规则与普通组合请假一致，并在同一事务中拆单
- 续假开始时间由上下文接口确定并在表单锁定，必须等于主申请或上一条有效续假之后的首个工作半天；补假可提交历史日期但必须位于主申请结束之后；组合续假分段被驳回后重提时保持原分段开始时间
- 续假和补假通过 `parent_request_id` 统一关联主申请；组合续假、组合补假的各分段保留 `extension` 或 `supplement` 业务类型，共享 `combination_group_id`，并拥有独立申请编号、审批状态和余额快照
- 待审批、审批历史和申请详情会直接返回主申请的假期类型、起止时间、天数和事由，审批人无需凭申请编号另行查找
- 跨年申请按实际工作日拆分到各自然年，并把年度分配快照保存在申请记录中
- 提交和重新提交会在事务中锁定年度余额后预占审批中天数，防止两个并发申请同时透支
- 审批、驳回和撤回按提交时的余额规则及年度快照结算，不受之后假期类型配置变化影响
- 所有活动账号的年假先使用“年假”类型配置的默认天数作为基础额度；有有效入职日期时，当前年度到达十周年或二十周年后，读取余额或提交申请会自动上调至 10 天或 15 天
- 产假与陪产假按员工性别过滤：女员工不显示陪产假，男员工不显示产假
- `GET /api/leave/types` 和 `GET /api/leave/balances` 为婚假返回本人 `is_available` 与 `unavailable_reason`；同一身份证号存在审批中或已批准婚假时锁定再次申请，身份证号缺失时同样不可申请
- 普通、组合、续假、补假及驳回重提接口均在事务中按规范化身份证号校验婚假资格，并使用事务级锁防止并发重复申请；被驳回或取消的婚假不占用一次性资格
- 管理员余额总览会按所选年份为每个活动账号补齐适用的启用假期类型余额，返回员工编号并按编号数字升序排列；年假至少显示配置的基础额度，产假与陪产假仍按员工性别过滤；补足年假时保留已有使用和审批中天数，高于基础额度的人工调整不变
- 请假申请编号固定为 `QJ-YYYY-NNNNN`，在事务级锁保护下按年度连续生成；启动迁移会把历史 `LR` 前缀统一转换为 `QJ`，若目标编号已存在则在该年度当前最大序号后续号
- 待审批和已通过记录按日期及上午、下午时段检查重叠，同一员工的并发提交使用事务级锁串行处理
- 请假提交按申请人角色绑定审批人：普通员工绑定活动总经理，总经理绑定活动董事长；对应角色没有可用账号时拒绝提交，不回退到管理员或超级管理员
- 请假列表、详情和审批日志中的审批身份以账号角色为准：总经理固定显示“总经理 姓名”，董事长固定显示“董事长 姓名”，不再被员工档案中的项目经理等职位覆盖
- 待办、审批记录、通过和驳回接口允许总经理和董事长调用，并且只能处理 `approver_id`（审批人编号）等于当前账号的申请；总经理不能处理总经理申请，董事长仅接收分配给本人的总经理申请
- `GET /api/approval/pending-counts` 为总经理和董事长统计分配给本人的 `leaveApprovalPending`（请假待审批数量）；管理员和超级管理员固定为 0
- `GET /api/approval/pending-counts` 为所有用户返回 `myLeaveApproved`（本人未读的请假审批通过数量）；审批通过时置为未读，员工调用 `/api/leave/requests/approved/mark-read` 后统一清零
- `GET /api/approval/pending-counts` 的 `myLeaveRejected` 只统计本人尚未查看且没有后续版本的最新驳回申请；员工查看申请详情后调用 `/api/leave/requests/:id/rejected/mark-read` 按条消除提醒并返回剩余未读数量
- `GET /api/leave/reviewed` 按申请链只返回当前最终版本，同一申请经历驳回、重提和通过后只占一条记录，历史操作继续在详情审批进度中展示；当前版本为审批中或草稿时不进入审批记录，撤回及永久删除后也不再展示
- 管理员通过 `/api/leave/admin/requests` 以抄送身份查看全员请假记录、附件和审批进度，不具备通过或驳回权限；假期类型和余额管理权限保持不变
- `/api/leave/admin/requests` 为每条已批准申请返回 `remaining_days`（距返岗的自然天数，精确到半天）、`remaining_leave_days`（剩余请假工作日天数）、`return_to_work_date`（返岗日期）、`return_to_work_half`（返岗时段）和 `leave_timing_status`（时段状态）；返岗日期及剩余请假工作日计算排除周末和法定节假日，并包含调班工作日
- 普通组合请假、组合续假和组合补假的全部最新分段均审批通过后，待审批历史和管理员抄送接口按整组最早开始、最晚结束及合计工作日返回统一返岗信息；仍有待审批、驳回或取消分段时不把该分段提前计入返岗时间
- 审批中的申请撤回后直接变为 `draft`（草稿），立即释放预占余额；草稿重提时沿用原编号并重新校验日期、时间重叠、余额、附件和当前审批人
- 草稿仅允许申请人本人永久删除；删除会清理整条版本链、审批日志、附件记录及磁盘附件，不保留软删除记录
- 服务启动时先把旧版 `cancelled`（已撤销）记录迁移为 `draft`（草稿）并清除余额占用标记；随后及每天 00:05 检查过期草稿，每月 1 日清理上月遗留草稿

**报销发票上传规则：**

- `/api/reimbursement/upload-invoice` 和 `/api/reimbursement/upload-deduction-invoice` 在本地 OCR（光学字符识别）完成后校验购买方公司主体
- 购买方名称必须精确匹配“北京羽隶工程咨询有限公司”，购买方纳税人识别号必须精确匹配“91110116MA01G3U20C”
- 名称、税号任一不一致或任一无法识别时返回 `400`，错误消息包含当前发票号码，例如“发票号码 26502000000717101161 不是北京羽隶工程咨询有限公司发票，请核查”
- 公司主体只出现在销售方时不通过购买方校验；基础报销、大额报销和商务报销共用该规则
- 电子发票的购买方、销售方名称及税号按 PDF（便携式文档格式）文字坐标成对提取，避免左右双栏被串接后产生主体误判

**数据显示规则：**

- `/api/reimbursement/list`：默认显示最近一个月的数据，按创建时间升序排列（早的在下，晚的在上）
- `/api/reimbursement/records`：显示所有历史数据，用于报销统计页面
- 基础报销、大额报销、商务报销页面使用 `/list` 端点，超过一个月的历史数据需在报销统计中查看
- `/api/reimbursement/transport-fuel-quota`：返回基础报销当月交通额度使用情况，总额度为 ¥1500；统计运输、交通、汽油、柴油、通行费及交通卡、一卡通、公交卡、地铁卡、乘车卡等交通储值卡类发票，排除草稿和已驳回报销单，编辑模式可通过 `excludeId` 排除当前报销单

````

### 月度财务报表（`/api/monthly-financial-reports`）

月度财务报表只提供以下六个业务接口：

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/monthly-financial-reports/:month` | `admin`、`general_manager` | 查询指定自然月的账户、收支、来源、校验和权限 |
| `PUT` | `/api/monthly-financial-reports/:month/manual-items` | `admin` | 提交完整手工项目列表，服务端按编号差异增删改；系统首月可同时初始化四账户期初 |
| `POST` | `/api/monthly-financial-reports/:month/refresh` | `admin` | 重新汇总合同回款、工资、已支付报销和资产付款 |
| `POST` | `/api/monthly-financial-reports/:month/close` | `admin` | 执行月结、保存期末和不可变版本快照 |
| `POST` | `/api/monthly-financial-reports/:month/reopen` | `admin` | 必填原因后重新开启已月结报表 |
| `GET` | `/api/monthly-financial-reports/:month/export` | `admin`、`general_manager` | 按《月度结算表》模板下载四工作表 XLSX（电子表格）并记录持久化月报的下载审计 |

月份必须为 `YYYY-MM`。所有写接口必须携带 `expectedVersion`（预期版本），使用月份级事务锁和可串行化事务；版本不一致、首次并发创建及序列化冲突统一返回 `409` 和 `MONTHLY_FINANCE_VERSION_CONFLICT`。未持久化月份必须先保存或同步，不能直接月结。总经理的任何写请求，以及超级管理员、董事长、BOSS（经营管理）和普通员工的六个接口请求，均在服务端权限中间件处拒绝。

所有金额字段以十进制字符串返回，不固定小数位、不默认补零；`totals.income` 表示公司银行实际收到的已确认主营业务回款总额，不是税费及账户拆分后的合计。查询响应通过 `automaticDetails`（自动来源明细）返回人员级工资成本及基础报销、大额报销、商务报销记录，字段包含来源编号、日期、账户、指标、金额、说明、稳定人员编号和人员姓名。报销只按银行回单实际交易日期写入的 `payment_business_date` 归月。下载文件包含“月度结算、手工项目明细、自动来源明细、校验”四个工作表。已月结的查询和下载只读取对应版本快照；快照缺失或结构损坏返回完整性错误，禁止实时重算。历史月重开、早月补建或维护会通过 `affectedMonths` 返回被级联标记为待重新核算的后续月份，旧快照继续保留。完整字段、分类和错误边界见 [16-月度财务报表模块.md](./16-月度财务报表模块.md)。

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
````

### 请求验证中间件

```typescript
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().optional(),
  district: z.string().optional(),
});

router.post("/api/projects", validate(createProjectSchema), handler);
```

### 错误处理中间件

```typescript
app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    code: err.code,
  });
});
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

- 2026-08-24: 新增无发票先保存科技对外付款登记接口；付款与发票金额可暂不一致，补票后自动建立对应关系，最终确认时再校验闭合。
- 2026-08-24: 内部划拨资产合同取消科技对外付款的工程划拨前置门禁；发票与科技对外付款闭合后直接形成合同核算，工程划拨独立用于经营支出统计。
- 2026-08-22: 月报页面基于自动来源明细将三类报销按“类型＋人员”精确汇总为当月总额，不展示单笔报销细项。
- 2026-08-22: 月报页面仅使用自动来源人员明细展开人力成本；三类报销仍保留接口追溯明细，但账户页面只显示当月分类总计。
- 2026-08-21: 月度财务报表查询响应新增自动来源人员明细，支持工资成本和三类报销在所属账户内按人展示。
- 2026-08-20: 新增月度财务报表六个接口；查询与下载仅允许普通管理员和总经理，四个维护接口仅允许普通管理员；补充版本冲突、字符串金额、月结快照和初版下载口径。

- 2026-08-20: `GET /api/invoice-applications/pending-counts` 改为按当前会话角色返回待办：员工统计本人被驳回待修改申请，总经理统计分配给本人的待审批申请，管理员统计待材料盖章及全部待开票／待财务登记申请；接口不接收客户端人员编号。
- 2026-08-18: 合同审批待办、历史、数量及决定接口仅允许总经理调用；新审批轮次不再读取项目负责人，服务同时硬校验总经理角色和轮次目标。启动阶段迁移历史项目负责人待办且不改写历史审批记录。
- 2026-08-18: 普通员工获得合同台账、详情、关系和附件内联预览权限，但服务端强制排除行政区域“全部”及对应根合同；普通员工和 BOSS 的强制下载返回 403，总经理与管理员组保留直接下载。BOSS 合同看板聚合同步排除“全部”区域。

- 2026-08-16: 新增主合同补充协议上传上下文和仅文件识别接口；补充协议由服务端继承全部主合同信息、分配不可复用序号并生成名称。列表、详情和审批响应新增原始／当前、生效前／增减／生效后金额及变更类型；仅付款协议保存 0 增减，明确最终总额优先，归档按根合同事务锁和生效顺序推进当前有效金额。
- 2026-08-16: 补充协议计算金额自动采用支持可见构成项闭环，旧第四版部分识别结果在草稿恢复时自动创建第五版重识别任务；接口字段保持不变。
- 2026-08-16: 修复补充协议第五版自动识别成功后写入继承名称时数据库无法推断条件参数类型的问题，名称参数明确按文本写入，避免正确识别在最终事务阶段回滚。
- 2026-08-16: 修复合同列表按根合同链分页时分页公共表表达式的别名引用错误，`GET /api/contracts` 恢复正常返回完整主从链。
- 2026-08-14: 补充协议创建、重识别和草稿保存统一继承主合同名称并追加“补充协议”；合同列表接口改为按根合同链分页并返回完整主从链，筛选命中子协议时不再脱离主合同单独展示。
- 2026-08-13: 合同审批待办、已处理、待办数量及审批决定接口新增总经理／普通项目负责人角色门禁，管理员角色不可调用；新增财务管理角色只读的 `GET /api/contracts/pending-seal-count`（待盖章数量）接口，用于合同台账盖章提醒，不扩张审批权限。
- 2026-08-13: 合同项目归属接口限定为主营和非主营合同可选；资产类创建或更新请求携带非空项目编号时稳定拒绝，资产类二级协议也不得从上级合同继承项目。
- 2026-08-13: 合同关系删除独立合同；元数据、创建校验和响应枚举仅保留主合同、补充协议、终止协议，历史独立合同统一迁移为主合同。
- 2026-08-13: 禁用合同 OCR（光学字符识别）人工确认接口；未自动通过的任务只能重新识别，并修正后页明确“合同名称”经双档可见识别一致时的项目名称安全门禁。

- 2026-08-12: 合同财务登记改为详情页内嵌的发票＋银行回单双凭证登记；新增 `POST /:id/financial-registrations` 及按登记编号整组确认、删除、冲正接口，两项已验证识别任务在同一事务中生成并处理配对草稿，旧单条新增入口拒绝新建并仅兼容无登记批次的历史记录。银行回单新快照精简为电子回单号码、付款时间、付款人户名及账号、收款人户名及账号、金额七项，电子回单号码严格必填，付款时间保留原件精度且不使用记账日或上传日兜底。
- 2026-08-12: 财务登记接口升级为多发票、多回单批次，接收两个任务编号数组；服务端要求两侧合计金额精准一致并原子创建、确认、删除和冲正整批记录，统计仍只按已确认回单金额计算。
- 2026-08-12: 合同发票业务字段统一命名为“开票名称”，完整保留并显示票面税收分类前缀和明细名称，例如 `*生产生活服务*技术咨询费`；发票解析策略升级为第四版，显式重新选择同一未消费原件时按新策略重算，底层兼容字段保持不变。
- 2026-08-12: 合同详情的合同回款、税费、预扣营销、商务费用和核算基数改为按合同组全部已确认回款累计计算；本月收入和本年累计继续按回款日期独立统计，不再用当月回款把合同累计核算清零。
- 2026-08-12: `POST /api/contracts/:id/financial-ocr`（财务凭证识别）中的银行回单固定只请求 `PP-OCRv6_medium`（第六版中型模型）；方向规则改为付款人公司户名命中即付款、收款人公司户名命中即回款，不再要求公司银行账号配置。接口地址和响应结构不变，账号字段识别、防重及其他安全门禁继续保留。
- 2026-08-13: 新增 `DELETE /api/contracts/:id/financial-ocr/:jobId`；未消费凭证在页面移除或清空时硬删除识别任务、摘要登记、附件索引和物理文件。财务登记草稿整组删除采用同一规则并释放跨合同重复占用；已确认、已冲正及已进入核算的记录继续禁止硬删除。
- 2026-08-12: 合同详情顶部固定审批操作和首次用印工作区精简仅调整前端布局；继续复用 `POST /:id/approve`（审批决定）、用印申请只读接口和受控文件预览接口，地址、请求体、目标快照鉴权、并发控制、签名落库及数据库事务均不变。
- 2026-08-11: 当前目标审批人可从合同详情原位工作区调用既有 `POST /:id/approve`（审批决定）；未新增或修改接口，审批中心仍为集中入口，快照鉴权、并发校验、请求体和事务语义保持不变。
- 2026-08-11: 总经理首次用印审批页内工作区先只读获取申请单，审批签署栏在本人点击该栏时才请求锁定签名，并在同一区域显示“签名已确认，待提交”；审批接口、请求体与权限边界保持不变。
- 2026-08-11: 合同审批前端调用入口曾统一收口到合同审批中心；后续已由本日最新记录补充详情页目标审批人原位处理能力。`POST /:id/approve`（审批决定）的接口结构、快照鉴权和事务语义始终保持不变。
- 2026-08-11: 用印申请 `GET`（读取）接口新增总经理只读权限，用于首次用印审批前后核对申请单；`PUT`（更新）和 `POST /sign`（签署）权限不扩张。审批成功后重新读取 `approvedFileId`（最终双签文件编号）供窗口继续预览。
- 2026-08-11: 用印申请单调整为单页双签布局，申请人创建时预留总经理审批签字栏；总经理通过首次用印审批时由服务端在同页补充本人锁定电子签名，不再追加第二页。辅助合同新增入口继续收紧为草拟合同创建向导。
- 2026-08-14: 用印审批签署完成后，申请记录的已签文件与审批完成文件统一指向最终双签申请单，申请人单签附件记录及物理文件同步删除。
- 2026-08-11: 新增在线用印申请读取、保存和本人电子签名接口，以及辅助合同档案包、备注、重试、删除和鉴权预览接口；草拟合同提交不再要求三联单或请款单，辅助档案响应不暴露服务器路径、摘要或完整识别原文。
- 2026-08-11: 在线用印签署接口收紧为合同创建人本人，提交审批再次核验签名人；盖章核验在部分字段待重试时仍保留其他可靠字段的独立差异。
- 2026-08-11: 合同识别明确保留项目名称标签后的完整字段值；草拟合同日期允许为空，盖章归档同步有效识别日期或上传日及其来源；创建页隐藏黄色任务级诊断横幅但接口警告、字段结果、状态和安全门禁保持不变。API（应用程序接口）与数据库结构均未变化。
- 2026-08-11: 合同提交接口允许 `main_business`（主营项目分类）的项目归属为空；已关联项目时锁定项目负责人，未关联项目时锁定唯一活动总经理，响应和数据库字段结构不变。

- 2026-08-07: 合同识别任务与提交审批门禁统一采用字段专属二次排序后的最高合格候选，不再使用精确 100 分门槛；自动成功时原子写入字段最终值和合同主表并校验实际写入行数，提交审批根据任务原文与最终值复用同一策略，合法空值可随任务完成，人工确认接口继续兼容但主流程不再依赖。
- 2026-08-06: 合同识别任务新增逐行页码、文本、坐标框、置信度和模型版本返回；新增仅财务可用的同原件双模型诊断接口，串行比较第四版移动模型与第五版服务器模型的耗时、字段和置信度，不写入业务结果。
- 2026-04-12: 新增离职通用文档上传和删除接口
  - `POST /api/resignation/my-request/upload-document` 支持上传所有类型的离职补充材料（终止劳动关系证明、固定资产交接单等）
  - `DELETE /api/resignation/my-request/documents/:docId` 支持删除已上传的文档，仅允许文档所属申请人删除自己上传的文档
  - 修复补充材料上传时使用错误接口导致的服务器错误
- 2026-04-10: 新增员工离职档案聚合接口，支持员工详情中查看离职类型、离职附件和工作交接单，并在无离职申请记录时按员工离职状态兜底展示
- 2026-04-09: 新增离职管理 API 路由说明，包含模板管理、交接确认、管理员审批和附件下载接口

### 创建日程

```typescript
// server/routes/calendar.ts
router.post("/events", requireAuth, async (req, res) => {
  try {
    const { title, start_time, end_time, recurrence_rule } = req.body;
    const userId = req.session.user.id;

    const event = db
      .prepare(
        `
      INSERT INTO calendar_events
      (title, start_time, end_time, recurrence_rule, created_by)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(title, start_time, end_time, recurrence_rule, userId);

    res.json({
      success: true,
      data: { id: event.lastInsertRowid },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
```

### 获取工作日志

```typescript
// server/routes/worklogs.ts
router.get("/:date", requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.session.user.id;

    const worklog = db
      .prepare(
        `
      SELECT * FROM worklogs
      WHERE user_id = ? AND log_date = ?
    `,
      )
      .get(userId, date);

    res.json({
      success: true,
      data: worklog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
```

## 权限控制

### 路由级权限

```typescript
import { requirePermission } from "./middleware/auth";

// 需要特定权限
router.post(
  "/api/projects",
  requireAuth,
  requirePermission("projects.create"),
  handler,
);
```

### 资源所有权检查

```typescript
router.put("/api/worklogs/:id", requireAuth, async (req, res) => {
  const worklog = db
    .prepare("SELECT * FROM worklogs WHERE id = ?")
    .get(req.params.id);

  // 检查是否是资源所有者或管理员
  if (
    worklog.user_id !== req.session.user.id &&
    !["admin", "super_admin"].includes(req.session.user.role)
  ) {
    return res.status(403).json({
      success: false,
      message: "无权限操作该资源",
    });
  }

  // 执行更新操作...
});
```

## 请求限流

```typescript
import rateLimit from "express-rate-limit";

// API 限流
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 个请求
  message: "请求过于频繁，请稍后再试",
});

app.use("/api/", limiter);

// 登录接口特殊限流
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "登录尝试次数过多，请稍后再试",
});

app.use("/api/auth/login", loginLimiter);
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
import cors from "cors";

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:8899",
    credentials: true,
  }),
);
```

### 4. 安全防护

```typescript
import helmet from "helmet";

// 设置安全 HTTP 头
app.use(helmet());

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

- 2026-08-06: 合同详情前端严格解析主合同和关联合同的关系枚举；关系字段缺失、非法或双命名值冲突时整页安全阻断，不再静默伪装为独立合同。
- 2026-07-30: 转正状态、详情、待签任务和审批流程接口新增分环节审批人姓名；每版申请固定审批人，历史流程使用签署快照避免随人员调整变化
- 2026-07-30: 放开管理员创建董事长轻量账号的权限，并保留系统级账号修改和超级管理员角色授予限制
- 2026-07-30: 员工人事档案自动识别接口增加正文组合特征和可疑“其他”标题复核，修复保密协议被正文短语误命名并归错类型
- 2026-07-17: 请假待审批与审批历史接口补充统一的剩余天数、返岗日期、返岗时段和时序状态字段
- 2026-07-17: 请假管理员列表与详情接口新增抄送接收人的角色、姓名字段，请假导出同步增加“抄送对象”列
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
- 2026-06-02: 团队周报新增在线查看接口
  - GET /api/daily-logs/team/weekly-summary：返回指定周团队周报、补充和附件
  - GET /api/daily-logs/team/attachments/:attachmentId/preview：管理员/总经理在线预览团队日志附件
- 2026-07-15: 文件读取路由支持业务类别下的年/月/日多级路径，上传接口统一返回包含实际上传日期的完整相对路径
- 2026-07-15: `PUT /api/leave/admin/types/:code` 新增当年余额同步逻辑，默认天数变化时仅同步仍处于旧默认值的余额记录，并返回 `syncedBalanceCount`
- 2026-07-15: 用户接口按完整管理数据与精简同事目录拆分，完整列表和修改操作仅管理员、超级管理员可用，并限制活动记录越权查询
- 2026-07-15: 请假申请增加跨年余额拆分、提交时规则快照、事务锁预占、并发编号保护及管理员余额下调边界校验
- 2026-07-15: 离职审批、员工状态和审计日志改为事务写入，限制各状态的材料修改与重复审批，并按数据库实时角色校验敏感读取
- 2026-07-15: 统一待办角标口径，普通管理员不再显示无权审批的转正待办，员工离职待办排除已经进入最终审批的状态
- 2026-07-15: 转正提交、审批实例、审批记录与员工状态改为事务内锁定处理，阻止重复提交以及通过、拒绝并发造成的状态冲突
- 2026-07-16: 新增管理员专用 `/api/payroll` 月度工资表查询与修改接口，并在正式邀请函上传接口中接入第一页工资识别和本月工资同步
- 2026-07-16: 人力成本接口统一排除超级管理员系统账号，防止其进入工资明细和汇总金额
- 2026-07-16: 新增员工人事档案自动识别上传接口，支持文件名与第一页内容分类，不确定文件拒绝归档并清理临时文件
- 2026-07-16: 人事档案自动上传升级为合并文件逐页识别、任意顺序分段拆分和多类型事务归档，并隔离十类之外材料
- 2026-07-16: 修复横向学历证书因标题文字顺序错乱而漏判的问题，并向前端返回、提示合并文件缺失类型
- 2026-07-16: 修复邀请函薪资未覆盖旧手工工资的问题，新增劳动合同期限识别、合同历史归档及员工合同到期时间同步
- 2026-07-16: 人事档案新增“其他”类型，固定十类之外的额外页段及整份未知资料改为自动归档，不再丢弃
- 2026-07-16: 新增员工人事档案一键删除接口，事务清空全部档案和合同到期时间，并保留工资基线及历史工资记录
- 2026-07-16: 用户创建和编辑接口改为接收管理员填写的唯一员工编号；三类入职模板下载接口按当前编号动态写入第一页，并增加管理员原模板预览接口
- 2026-07-16: 入职邀请函编号扩展至两页、劳动合同编号扩展至全部页面并保留黑色/蓝色版式
- 2026-07-16: 人事档案列表和下载接口改为保留管理员上传时的内容、编号及文件名，动态编号仅用于员工下载入职模板
- 2026-07-16: 人事接口安全修正：移除 `/uploads` 静态文件公开访问，工资生成改为显式写操作并增加版本校验，请假增加重叠和实时角色校验，离职交接单由后端验证真实 PDF（便携式文档格式）
- 2026-07-17: 离职申请列表和详情开放给人事管理员核对资料，最终通过与驳回仅允许总经理、超级管理员操作；新增人力资源审批中心离职入口并禁止审批本人申请
- 2026-07-17: 请假统一由总经理审批并抄送管理员，普通管理员移除通过和驳回权限，超级管理员保留全部请假审批能力
- 2026-07-17: 人力成本工资表新增 `cost_total`（成本合计），按社保、公积金、个税总额加本月实发工资总额精确计算
- 2026-07-17: 待办计数接口增加本人合同到期日期与在职状态，支持员工端提前 10 天和过期后的菜单提醒
- 2026-07-17: 修复员工假期余额与管理员配置不一致的问题；年假改为按当前周年日计算并在周年到达后自动上调，普通假期测试余额同步到当前配置
- 2026-07-17: 请假首次申请和驳回后重新提交均禁止选择今天以前的日期，后端预计算及提交接口同步拒绝历史开始日期
- 2026-07-17: `GET /api/approval/pending-counts` 新增本人请假驳回待重提数量；仅统计没有后续版本的最新驳回记录，重新提交后历史驳回不再重复提示
- 2026-07-17: 请假申请列表统一按版本链只返回当前最新记录，驳回重提不再重复占行；`GET /api/leave/requests/:id` 无论传入哪个版本均返回最新申请，并汇总整条链的审批日志、附件、操作人职位及姓名；历史附件按整条申请链校验审批人权限
- 2026-07-17: 请假撤回改为草稿并立即释放余额；草稿支持重新提交和本人永久删除，系统在月度切换后自动硬删除上月草稿及其完整历史、日志和附件
- 2026-07-17: 增加历史请假状态迁移，旧版“已撤销”记录在服务启动时自动转为草稿并显示重新提交、永久删除操作
- 2026-07-17: 新增 `GET /api/leave/reviewed` 历史审批接口；管理员请假抄送记录返回剩余工作日天数和返岗时段；员工列表及统计按已批准请假实时计算“休假中”状态
- 2026-07-23: 劳动合同归档接口返回试用期截止识别结果并同步当前转正记录；`GET /api/approval/pending-counts` 新增管理员 `probationDueSoon` 试用期到期前 30 天提醒
- 2026-07-23: 入职日期改由劳动合同开始日期自动维护；合同上传、删除接口返回 `currentHireDate`，待办计数增加 `myHireDate` 供员工端实时同步
- 2026-07-23: 试用期截止统一取第一份劳动合同的识别结果，续签合同仅更新当前合同到期日期；已有转正记录只校正日期，不改变审批状态和文件
- 2026-07-23: 无可识别劳动合同的员工不再返回旧入职日期；启动迁移及最后一份合同删除操作同步清空员工与转正记录日期
- 2026-07-23: 员工更新接口新增合同模板期限和试用期拟定日期校验；劳动合同模板下载时动态写入员工编号及日期，未设置期限时禁止下载空白日期合同
- 2026-07-27: 请假审批接口开放给管理员并按角色分流；总经理仅处理分配给本人的申请，管理员和超级管理员处理除本人外的全部待办，审批记录继续按实际操作人返回，待办计数同步供审批中心和员工数据角标使用
- 2026-07-23: 员工资料保存、提交和管理员编辑接口取消出生日期与身份证内日期的强制一致性校验，继续分别校验日期与身份证格式
- 2026-07-23: 新增员工转正档案查询、补录、删除和下载接口；直接在职员工可归档转正申请表且不会伪造审批记录
- 2026-07-23: 放开已转正缺件记录的管理员单次补传入口，已有申请表的完成记录继续保持锁定
- 2026-07-23: 收紧管理员转正补档接口，待提交和已驳回记录只能由员工本人上传或修改申请表
- 2026-07-23: 员工转正档案接口仅返回转正通过后的正式申请表，并同步禁止通过档案下载地址读取未通过材料
- 2026-07-23: 用户与员工更新接口统一校验部门职位配置并事务同步两张资料表；劳动合同下载接口新增第四条职位自动写入
- 2026-07-23: 劳动合同正式归档后自动清空本期模板日期并锁定员工端模板下载，管理员设置下一期模板期限后重新开放
- 2026-07-23: 劳动合同模板拆分预览与下载接口；归档后只锁定下载，在线预览始终开放并改为无下载控件的系统内逐页展示
- 2026-07-24: 劳动合同归档时保存上一期模板日期与职位快照；新周期未设置时预览继续显示上一期完整内容，旧数据回退最近正式合同识别日期
- 2026-07-24: 新增转正在线提交、本人待签任务和分阶段签署接口；员工、主管领导意见、人事部意见、总经理审批按顺序提交意见与电子签名，最终审批通过后自动生成正式转正申请单，旧模板上传和越级审批接口停止使用；正式文件查询和下载只开放当前终审版本，驳回及旧上传材料不再展示
- 2026-07-24: 转正填写和审批统一改为直接渲染管理员上传的原始申请单模板；新增原模板内嵌预览与鉴权签名图片接口，签署方式收紧为本人上传签名图片并确认回填
- 2026-07-24: 转正签名上传增加前后端双层图像处理，自动识别白色或灰色纸张底色、清除阴影和低透明噪点、裁切有效笔迹，防止整张照片及灰色底块进入签名栏
- 2026-07-24: 转正签名去底改为局部背景差分与连通区域筛选，过滤强阴影、边缘暗块和纸张颗粒，并保证前端确认预览与后端正式归档使用同一套处理规则
- 2026-07-24: 新增本人电子签名状态、图片、保存和删除接口；接口只使用当前会话账号，转正签署可调用个人签名并继续保存当次流程快照
- 2026-07-24: 电子签名接口新增管理员代管的总经理签名类型；转正路径调整为总经理签主管领导意见、管理员签人事部意见和最终审批，管理员可选择本人或总经理签名，流程同时记录实际操作人与签名人
- 2026-07-24: 员工在线填写转正申请改由 `/probation/application` 独立页面承载，原转正页只负责状态展示和跳转，不再打开填写弹窗
- 2026-07-24: 离职改为管理员归档流程，新增五类 Word（文字处理文档）模板、在线填写下载、离职人员创建、单类 PDF（便携式文档格式）上传和合并档案一键识别接口；档案齐全后事务联动员工已离职与原账号停用
- 2026-07-24: 离职模板上传扩展为 DOCX（开放 XML 文字处理文档）和 PDF（便携式文档格式）；PDF 模板默认内嵌预览，可下载原件但不进入在线填写接口
- 2026-07-24: 离职人员列表接口增加员工入职日期并展示当前员工状态
- 2026-07-24: 转正状态、待签任务、申请详情和审批流程接口统一返回全部版本签署历史；员工与审批人可查看完整流程，审批驳回强制填写理由并由服务端再次校验
- 2026-07-24: 转正正式文件接口新增附件下载模式；管理员完成总经理审批后可在审批详情中预览、下载和打印，最终签名缺失时禁止生成转正结论及正式文件
- 2026-07-24: 转正主管领导意见不再分配给系统总经理账号，改为主管领导、人事部、总经理审批三个环节均由管理员依次代签；待办计数、签署权限及流程文案同步收紧，并保留签名身份与实际管理员操作人
- 2026-07-24: 对旧总经理已签主管领导意见的在途申请增加通过拦截和页面提示，必须驳回后重新提交，避免旧流程签名进入新规则下的正式转正文件
- 2026-07-24: 更正转正职责为总经理签主管领导意见、管理员签人事部意见并代签最终总经理审批；人事部通过后审批窗口自动切换最终环节，解决管理员无法点击总经理签名栏的问题
- 2026-07-24: 离职模板接口统一为原模板 PDF（便携式文档格式）叠加编辑，新增原稿预览、单份生成文件下载和五类合并打印；编号与自动字段均由服务端按员工档案生成
- 2026-07-26: 新增离职模板管理统一在线预览接口；PDF（便携式文档格式）原样返回，DOCX（开放 XML 文字处理文档）临时转换为 PDF 后返回，预览不修改原模板
- 2026-07-26: 离职 DOCX（开放 XML 文字处理文档）编号改为转换前直接替换临时副本原文字节点；模板编辑接口同步返回原行字体、字号和颜色，避免编号残留及自动文字贴图感
- 2026-07-27: 离职 DOCX（开放 XML 文字处理文档）改为先固定转换未改写原稿、再叠加逐页编号和填写内容；按原文件页数清理转换器产生的空白尾页并修正页脚总页数，在线编辑新增文字的字号固定为模板正文字号
- 2026-07-27: 修正离职模板首次合同日期的年、月、日定位；图片型或异常 PDF（便携式文档格式）改用 PDF.js（PDF 解析器）读取真实坐标，编号仅覆盖各页原 `XXX` 字形范围，避免擦除“内部人事文件”等页眉
- 2026-07-27: 新增 `GET /api/probation/history/:historyId/approval-flow`，员工本人、管理员、总经理及历史流程参与人可读取对应历史转正记录的审批与签署快照；转正列表和本人状态接口的历史记录增加是否存在审批明细标识
- 2026-07-27: `GET /api/approval/pending-counts` 新增 `probationArchivePending`，管理员可实时收到转正终审完成但正式盖章档案尚未上传的待归档提醒
- 2026-07-27: 转正终审生成件调整为待盖章底稿；正式文件只认管理员在员工转正档案上传的 `official` 盖章件，并自动同步到本人状态、员工档案和转正申请列表
- 2026-07-27: 离职模板新增上传收紧为仅支持真实 PDF（便携式文档格式），同步校验扩展名、媒体类型和文件头；历史 DOCX（开放 XML 文字处理文档）模板保留兼容读取
- 2026-07-27: 离职模板编辑数据改为按整行文字片段组合定位姓名、身份证号、日期和岗位空白区；逐页编号读取原 PDF（便携式文档格式）的逐字符坐标，只覆盖 `XXX` 的真实字形范围
- 2026-07-27: 离职模板逐页编号改为保留原“编号：”并统一覆盖完整 `YULI-CSXXX-LZ序号` 区域，五类生成编号使用同一字体、字号、红色和基线
- 2026-07-27: 离职模板编辑接口取消自动字段统一字号，改为返回每个下划线所在文字行的真实字体、字号和颜色；前端点击下划线直接编辑，预览与生成文件使用同一排版参数
- 2026-07-27: 离职模板编辑接口新增全部空白填写下划线识别；逐页过滤表格边框和固定正文后返回稳定字段编号，保存、再次加载、单份下载及合并打印均保留管理员填写内容
- 2026-07-28: 按使用反馈撤回离职模板统一正文行字号和下划线延长参数，编辑接口恢复各字段原模板字号，生成文件恢复在原填写区域内横向适配长内容
- 2026-07-28: 离职模板编辑保存接口新增 `fieldAlignments` 字段方向映射，只接受左对齐、居中或右对齐；旧草稿缺少该数据时继续使用模板原方向，单份下载和合并打印同步应用已保存方向
- 2026-07-28: 离职模板编辑接口补充下划线上已有模板文字的可编辑字段和原文字标记，按下划线基线区分相邻行；离职证明身份证号默认在原留白区域居中，解决部分下划线漏出编辑区域和身份证号位置不协调
- 2026-07-27: 入职模板中的 2025年度公司电脑管理办法新增自动填充，预览和下载会在每一页写入编号，并写入甲方单位、乙方姓名和身份证号码
- 2026-07-27: 离职档案一键识别按每份材料首页标题切分，五类材料可任意排序；修复全角分隔符或标题前存在填充文字时第一页漏识别并误报顺序错误的问题
- 2026-07-27: 新增离职档案完成确认接口；五类档案齐全后不再自动停用账号，管理员逐项预览核对并确认后才完成离职与账号停用
- 2026-07-27: 离职档案齐全状态由 `draft` 独立为 `pending_confirmation`；列表、详情和筛选统一显示“待确认离职”，删除必需档案时自动退回 `draft`
- 2026-07-27: `GET /api/probation/list` 新增总经理本人本月审批筛选；按主管领导签名人及签署月份返回通过或驳回记录，管理员的本月终审查询补齐下月边界
- 2026-07-27: `GET /api/approval/pending-counts` 为管理员和超级管理员实时返回离职归档待办数量，统计 `draft` 与 `pending_confirmation`，供系统首次加载及业务操作后统一刷新角标
- 2026-07-27: 报销额度接口 `/api/reimbursement/transport-fuel-quota` 及创建、编辑报销单的服务端核减重算同步纳入交通储值卡类发票，`*预付卡销售*交通卡/一卡通/公交卡/地铁卡/乘车卡充值` 按交通额度类处理
- 2026-07-27: 管理员请假余额总览按所选年份补齐每个活动账号的启用假期余额，避免无历史余额记录的人员显示空白
- 2026-07-27: 管理员请假余额总览返回员工编号，并按员工编号数字升序排序
- 2026-07-27: 修复管理员余额中部分员工年假显示 `0/0`；所有活动账号至少获得年假配置的基础额度，有有效入职日期时再按工龄上调，产假和陪产假继续按性别过滤
- 2026-07-27: 请假审批最终收口为仅申请单指定的总经理可处理；管理员和超级管理员移除待办计数及审批接口权限，仅通过管理员记录接口接收抄送并查看全员流程
- 2026-07-27: `POST /api/users/create` 改为后端自动生成员工编号，按已有 `YULI-CS` 最大数字序号继续递增并返回生成值
- 2026-07-27: 新增 `GET /api/users/next-employee-number`，创建用户弹窗改为展示后端实时计算的员工编号
- 2026-07-28: 离职模板位置分析兼容“），”组合文字，身份证号字段严格限制在右括号和原下划线以内
- 2026-07-28: 离职模板预览、下载及合并打印中的长文字改为优先等比例缩放，避免固定下划线内的大写金额被横向挤压而难以辨认
- 2026-07-28: 新增羽隶经营看板汇总与指标注册接口，并增加BOSS业务写操作统一拦截。
- 2026-07-28: BOSS创建接口改为仅接收账号字段，不生成员工编号或档案；本人档案、员工目录、工资及人员统计统一排除BOSS。
- 2026-07-28: 用户更新接口将超级管理员识别为系统账号，允许仅提交用户名、密码、角色和账号状态，不再要求员工编号、联系方式、部门、职位、员工状态或收款资料。
- 2026-07-28: BOSS相关接口校验、只读拦截及看板错误提示统一使用 BOSS 角色名称。
- 2026-07-28: 羽隶经营看板汇总接口新增单位与个人社保、公积金拆分、三类报销与区域服务单位明细、日报和周报汇总，并统一更新看板名称。
- 2026-07-28: `GET /api/boss-dashboard/summary` 新增 `startMonth` 与 `endMonth` 趋势范围参数，校验月份格式、起止顺序及最多 24 个月范围；历史趋势筛选不改变本月核心指标口径。
- 2026-07-28: 完善羽隶经营看板接口说明：明确今日日报与最近周报只读实时同步、三类报销及范围／区域和服务对象／单位明细、人力成本单位与个人缴纳拆分，并记录前端每 30 秒自动刷新；内部权限角色保持 BOSS／`boss`。
- 2026-07-29: 人力成本接口新增按月份和费用类别批量上传、异步识别、汇总查询、原件预览及删除银行回单能力，支持 PDF（便携式文档格式）、JPEG（图像格式）和 PNG（便携式网络图形）。
- 2026-07-29: 人力成本银行回单新增月份与类别级上传锁；已有回单时接口拒绝新批次，删除该类别全部文件后恢复上传，个人个税明细接口保持独立。
- 2026-07-29: 实发工资用途识别新增“备注包含薪资”的明确判断，命中后仍须通过财务付款回单同源真实性校验才计入工资。
- 2026-07-29: 人力成本计算改为社保各险种、公积金和个税逐项取整到分后再汇总，确保员工合计、全员合计、实发工资及公司成本与页面分项和税务实扣一致。
- 2026-07-31: 人力成本回单补充机构收款人兜底识别，修复住房公积金管理中心全称已识别但第二个“户名”标签缺失时错误提示无法识别收款人。
- 2026-07-29: 人力成本回单复用财务付款回单真实性校验，实发工资只汇总工资用途回单并精确匹配员工；新增点击实发金额预览单笔回单、月度入离职同步和中文原文件名保护。
- 2026-07-29: 修复历史回单重识别可能重复启动多个 OCR（文字识别）进程并导致后端退出；识别任务改为去重串行队列，异常后暂停当前批次。
- 2026-07-29: 人力成本工资接口新增独立公积金缴费基数；社保按社保基数、公积金按公积金基数分别计算，明细和合计统一显示两位小数。
- 2026-07-29: 实发工资识别取消已识别文件的待核对状态，员工回单合计与账面实发不一致时标红且仍可点击预览；新增个人个税明细独立上传接口，按姓名和“应纳个税”列批量回填。
- 2026-07-29: 个人个税明细识别成功后持久化保存原件，回单汇总返回当月明细文件信息，并新增管理员在线预览接口。
- 2026-07-29: 羽隶经营看板汇总接口统一按 `startMonth`／`endMonth` 计算顶部财务指标、趋势和报销明细；自然月只统计单月、自然年统计 1 至 12 月，新增个税代扣汇总及工资人数／人月平均口径，并明确人员、日志、项目、风险仍为当前实时快照。
- 2026-07-30: 请假审批通过新增员工未读计数和批量标记已读接口，待办计数同步返回 `myLeaveApproved`
- 2026-07-30: 劳动合同预览取消上一期及正式合同日期回退；未设置当前模板期限时保留空白日期，只实时写入员工编号和当前职位
- 2026-07-30: 请假接口新增一键请满、组合申请原子拆单、续假与补假主子关联，并收紧固定额度类型和个人余额调整规则
- 2026-07-30: 组合请假新增按分配总天数反算结束时间接口；续假开始时段锁定，审批接口直接返回原请假摘要
- 2026-07-30: 转正列表 `reviewedByMeThisMonth=1` 扩展到管理员和超级管理员，按当前账号本月实际签署的人事部意见返回记录，不再要求整单已经终审完成
- 2026-07-31: 请假驳回提醒新增按申请标记已读接口；员工查看驳回详情后，待办计数立即返回剩余未读数量
- 2026-07-31: 续假和补假接口新增组合申请模式，按分段拆为独立记录，共享组合批次并统一关联原主申请；历史补假自动计算接口支持 `allowPast`
- 2026-07-31: 婚假新增身份证号级一次性资格校验和事务并发锁；类型及余额接口同步返回锁定状态与原因
- 2026-07-31: 请假审批人新增按申请人角色分流；普通员工绑定活动总经理，总经理绑定活动董事长，董事长可读取本人待办和记录并执行通过、驳回，管理员和超级管理员继续只读抄送
- 2026-07-31: 组合请假返岗信息改为整组审批通过后按最后一段结束时段统一计算，分页列表只返回部分分段时仍补查完整组合，未通过分段不会提前延后返岗
- 2026-07-31: 员工人事档案自动识别接口增加主标题优先、300 DPI（每英寸点数）整页与 600 DPI（每英寸点数）标题区增强复核，并过滤页眉页脚伪正文；重复同类材料按各自连续页段分别归档，识别文字不足、分类冲突或多页文件没有可靠页段边界时返回具体说明且不产生记录，浏览器与生产反向代理等待上限同步放宽至 40 分钟
- 2026-07-31: 员工人事档案自动识别接口新增 OCR（文字识别）坐标阅读顺序重建，按同行横向位置还原被拆散、错序的正式标题；劳动合同封面可结合甲乙方、签订日期及合同正文特征确认类型，首个明确档案前存在未分类页段时整次拒绝落库，不再静默归入“其他”
- 2026-07-31: 修复保密协议被弱通用标题误归“其他”；整页与标题区识别改为证据合并，唯一固定类型优先、不同固定类型冲突即拒绝上传，通用“其他资料”标题需两路一致且排除“成如下协议”等正文断句
- 2026-07-31: 修复生产应用更新后 Nginx（反向代理）未重载导致自动识别仍在 60 秒返回 `504`；发布流程新增配置校验、重载和 2400 秒运行配置复核，超时提示改为结果待确认并提醒勿重复上传
- 2026-08-04: 管理员人事档案一键识别上传在服务端明确完成整份文件事务归档后显示绿色页内成功提示，并保留实际归档类型和手动关闭入口；失败或结果待确认时不误报成功
- 2026-07-31: 转正正式档案待归档计数同时覆盖审批完成未归档和直接在职未补录两类真实员工，并排除超级管理员、老板和董事长等系统专用账号；开发和线上环境按同一业务口径统计
- 2026-07-31: 转正业务全面排除系统专用账号作为员工申请对象；列表、统计、待办目标、本人状态、详情、审批流程和档案接口均不再返回超级管理员、老板或董事长本人的历史转正记录，同时保留其管理真实员工流程的权限
- 2026-08-04: 员工人事档案自动识别接口改为 300 DPI（每英寸点数）标题快速筛查与按风险增强复核；合同、保密协议、个人声明及低置信页面保留高分辨率确认，清晰续页不再重复整页识别，并复用一致的页级候选提取工资与合同期限
- 2026-08-04: 请假流程中的审批人身份改为优先显示账号角色，刘行等总经理账号不再显示员工档案职位；请假申请编号由 `LR` 统一迁移并改为生成 `QJ-YYYY-NNNNN`
- 2026-08-04: 人力成本工资生成接口改为从紧邻上月沿用本月工资、公积金缴费基数和社保缴费基数，应纳个税默认清零；历史月份保持快照不变
- 2026-08-04: 实发工资回单在明确识别工资用途、收款人、金额和交易凭证时允许收款账号缺失，并按户名精确关联员工；识别版本仅升级实发工资，其他人力成本回单和普通付款回单继续执行账号必填校验且不触发无关重识别
- 2026-08-05: 合同上传接口新增九类 `declaredSubtype`（二级分类）必填与大类联动校验，合同层级取消默认主合同并在上传后锁定；二级协议必须在上传前绑定同区、同大类、同二级分类的一级合同。
- 2026-08-05: 合同普通用印及盖章差异审批驳回进入 `rejected`（已拒绝）业务终态；接口元数据、台账、详情和经营聚合同步区分已拒绝与终止。
- 2026-08-05: 财务识别任务新增失败类型、重试次数、工作令牌和租约；基础设施失败或过期任务可通过相同原件安全接管，业务阻断及文件或普通识别失败不盲目重跑。
- 2026-08-05: 银行回单接口拆分电子回单号与交易流水号，补充交易日期、记账日期、银行、币种和双方账号；回款与付款按“银行＋两类号码”分别执行跨表防重。
- 2026-08-05: 四区审计检查点改为同时校验结构版本、策略版本、身份配置、文件摘要和识别上下文，旧结果与基础设施失败记录不再被误当作当前完成结果。
- 2026-08-04: 新增 `/api/contracts` 合同业务接口，覆盖台账、详情、经营统计、异步自动识别任务、草稿业务信息维护、总经理审批、盖章归档、终止、附件、发票、回款、付款、冲正和受控文件读取。
- 2026-08-04: 合同接口新增费率历史查询与新增版本；自动识别最终值与合同主数据改为同一事务写入，子协议继承根合同业务口径，合同组内财务记录支持跨主子协议冲正。
- 2026-08-04: 通用请求客户端不再全局固定 JSON（数据交换格式）请求头，由请求体自动选择 JSON（数据交换格式）或带边界的表单编码，修复合同文件预览成功但上传接口收不到文件的问题。
- 2026-08-04: 完整补充合同 API（应用程序接口）清单及权限边界，明确五步录入对应的自动识别门禁、编号生成、草稿删除与撤回、盖章差异复审、财务三态、回单流水号、资产六类、审计和识别租约规则。
- 2026-08-04: 合同 API（应用程序接口）增加盖章识别前置校验与限流、NFKC（兼容等价规范化）防重、聚合金额安全回验及财务草稿物理凭证清理说明。
- 2026-08-05: 合同 API（应用程序接口）改为包含合同签订日期的六个核心字段均不低于 90% 后原子写入并作为提交门禁，草拟日期不得人工填写或猜测，识别字段全程只读且失败仅允许整份重试或重传；项目元数据返回行政区并由服务端按项目主数据强制联动。
- 2026-08-05: 草拟合同新建、重试及替换文件后在识别成功前统一清空六个核心字段；补充协议和终止协议不再预写上级合同分类，改为识别成功事务自动校验分类一致后原子写入六字段。
- 2026-08-05: 合同上传接口新增 `area`、`declaredCategory` 与资产类四类 `assetCategory` 前置必填并在创建后锁定；预选分类仅校验 OCR 合同类型，六字段最终验证值必须严格为整数 100 且内容验证正确，任何小于 100 均失败且不得舍入冒充；项目与上级合同仅限同区且服务端不得覆盖合同区域或分类。
- 2026-08-05: 合同识别新增财务整组六字段确认接口；仅最新 `partial`（部分结果）任务、当前草拟文件和当前合同版本可确认，自动原分值与完整证据永久保留，人工结果不得冒充自动 100，提交门禁同时接受真实自动验证字段与带审计的财务确认字段。
- 2026-08-05: 合同上传同步保存页面主动选择的合同关系，不再使用兼容默认值；主合同和独立合同强制无上级且以自身为根，补充协议和终止协议才要求关联有效一级合同。项目归属继续独立用于主营项目累计，不再与上级合同关联混写。
- 2026-08-05: 合同六字段人工确认接口新增 `reviewedFields`（逐字段原文核对凭据）服务端门禁；服务端依据锁定的最新识别结果和提交值重算必需核对字段，非整数 100 分及被修改的原整数 100 分字段均须显式确认，并将核对清单写入审计详情。
- 2026-08-05: 合同财务凭证新增服务端识别任务接口；发票、回款和资产付款只按原文识别快照建草稿，严格校验正常状态、独立证据和业务方向，旧客户端字段仅作一致性断言；财务文件摘要跨合同全局防重，银行回单不再允许客户端重复确认标记绕过。
- 2026-08-05: 合同用印、终止和盖章差异复审批按分类锁定审批轮次：主营取关联项目活动负责人，非主营和资产类取唯一活动总经理；待办、计数、已处理、详情、附件与审计均按当前账号范围过滤，审批接口由服务层核对快照目标而非信任前端角色。
- 2026-08-05: 财务凭证底层识别或业务判定异常时，在同一事务中将识别任务置为失败并写入完成审计，避免任务长期残留在处理中。
- 2026-08-05: 新建合同、草拟合同替换及普通合同附件上传接口增加真实旧版 DOC 支持；继续执行扩展名、媒体类型和 OLE（复合文档）结构三重校验，伪造文件不能进入识别队列。
- 2026-08-05: 合同识别任务把草稿的 `relation_type`（合同关系类型）传入识别服务，补充协议和终止协议接口只允许识别结果中的本次增减额进入金额字段，防止将变更后合同总额误写成协议调整额。
- 2026-08-05: 财务凭证识别接口同时传入公司法定名称、纳税人识别号和可配置银行账号；发票名称与税号、回单名称与账号必须成对命中公司主体，任一不一致均返回方向未知并禁止生成草稿。
- 2026-08-06: 修复终止申请驳回被误写为合同已拒绝终态的问题；接口现校验并恢复申请前的生效中、执行中或已完成状态，普通用印和盖章差异驳回语义保持不变。
- 2026-08-06: 合同更新接口与领域服务双重锁定上传前选择的合同关系；主合同、独立合同不能追加上级，补充协议、终止协议必须沿用同项目一级合同。
- 2026-08-06: 修复合同 OCR（光学字符识别）自动采用门禁回退；仅独立验证形成的精确整数 100 可自动写入，95–99 均保留为诊断分并进入 `partial`（部分结果）及财务整组核对。
- 2026-08-06: 封堵合同电子文字层自动采用漏洞；PDF（便携式文档格式）六项齐全仍强制渲染可见页面并执行图像识别，只有同页两类证据完全一致才可形成 100，DOC／DOCX（文档格式）纯文字单独最高 99；DOCX 同步排除隐藏运行、删除修订和域代码，隐藏样式安全失败。
- 2026-08-06: 完成 V11（第十一版）合同字段安全收口；补充／终止金额按每次位置绑定动作且始终最高 99，唯一明确总额优先于更大分项，裸含税总价最高 99，金额与日期独立证据必须同值同语义角色；项目名仅按明确续行信号拼接，无括注许可角色降级，带编号的补充／解除标题与上传层级冲突同样硬失败；更新载荷移除上级合同，恢复草稿只读保留锁定关系，路由与领域服务继续双重不可变。
- 2026-08-06: 报销普通发票与核减发票上传接口新增购买方公司名称和纳税人识别号双字段校验；任一不匹配或无法识别时返回固定核查提示并拒绝上传。
- 2026-08-06: 修复报销发票双栏购销信息提取错位；上传接口改用坐标配对后的购买方名称和税号执行公司主体校验。
- 2026-08-06: 报销发票公司主体校验失败响应新增发票号码，普通发票与核减发票上传接口同步返回可定位的核查提示。
- 2026-08-06: 管理员报销全部查询接口取消历史删除标记过滤，默认与发票管理接口统一返回所有已付款、已完成历史报销；服务启动流程同步取消超过90天报销单自动归档任务。
- 2026-08-07: 合同识别第六阶段改为风险驱动自动采用；项目名称候选冲突、金额角色冲突和日期低置信自动触发同模型局部增强 OCR（光学字符识别）与重新排序，硬校验通过后原子写入六项最终值，接口结构和数据库结构不变，人工确认接口仅保留历史兼容用途。
- 2026-08-10: 合同识别自动采用升级为第三版候选安全门禁；项目名称校验可信来源、语义及候选分差，金额校验明确角色和作用域，PDF（便携式文档格式）文字层项目／金额还必须有同页可见 OCR（光学字符识别）同值、同金额角色佐证。仅自动采用成功任务写入专用通过标记；兼容人工确认改为整组六字段全量核对，阻断任务不能借高诊断分升级。现有 OCR 响应、数据库结构及 API（应用程序接口）路径和字段均未改变。
- 2026-08-11: 辅助合同创建、列表和详情响应统一使用最小 DTO（数据传输对象），隐藏存储路径、摘要、完整原文、坐标及操作人编号；多文件上传失败时同步清理本次已落盘文件。
- 2026-08-11: 合同详情响应为审批记录补充实际职位，并为当前待审批目标补充姓名与职位，供审批流程按“职位 姓名”展示；数据库结构与审批事务不变。
- 2026-08-11: 申请人与总经理改为直接点击各自签署栏确认本人签名，不再提供“调用签名”按钮；点击确认只在页面显示锁定签名，正式落签仍由服务端在提交时完成，接口请求体和数据库结构不变。
- 2026-08-13: 多凭证财务登记新增发票与回款／付款回单的金额对应明细；服务端优先匹配金额完全相同的凭证，剩余金额再按上传顺序分配，并在创建响应和合同详情中返回具体关系。
- 2026-08-13: 财务登记支持先票后款；发票识别后可先保存待回款草稿，新增登记补充回单接口，补齐回单并建立金额对应关系后才允许整组确认和核算。
- 2026-08-13: 待回款登记补充接口支持同时追加发票和回单；服务端将原有发票与新增发票合并后原子校验金额、落库并重建对应关系。
- 2026-08-13: 新增合同盖章前撤销接口；财务管理角色可经二次确认撤销未实际盖章的合同，服务端校验版本及盖章证据并保留文件、审批和审计历史。
- 2026-08-13: 新增已撤销合同只读查询；管理员可分页查看撤销信息与保留文件，普通台账查看者不能读取软删除合同及其附件。
- 2026-08-13: 盖章前撤销接口新增必填 `cancellationReason`（撤销原因）；已撤销合同查询同步返回该原因，历史未采集原因的记录返回空值。
- 2026-08-13: 主营合同编号改为采用原件明确“合同编号：”标签后的业务编号；合同接口新增 `businessContractNo` 与 `systemContractNo`，台账 `contractNo` 展示原件编号，内部 `HT` 流水号继续保留用于系统追踪。合同模板编号、合同类型编号和空白甲乙方编号均不得替代业务编号。
- 2026-08-13: 修正主营业务文件编号规则：主合同与每份补充／终止协议分别拥有独立原件编号；页面未明示编号时读取文件二维码并完整保留 `(B1)` 等后缀。补充协议的自身编号用于独立查重，二维码基础编号或明确“原合同编号／主合同编号”仅用于核对上级合同。
- 2026-08-13: 原件业务编号改为延迟补全；草拟文件无二维码或明文编号时不阻断审批，盖章上传及重新识别再次读取二维码／明确编号并补写，仍无可靠证据时保留系统内部流水号且不猜测。
- 2026-08-14: 合同财务识别与登记接口取消按合同分类推断收支方向，改由发票购销方向决定回款或付款类型；合同详情对普通指定审批人隐藏根合同组财务事实，已撤销合同文件预览与下载继续写入审计。
- 2026-08-17: 财务登记创建与补充接口允许保存累计银行凭证金额不超过发票金额的部分结算，并支持同一登记多次追加；每批银行凭证保存后立即确认、冻结回款费率并计入已收／已付，累计超额原子拒绝。确认接口新增发票、银行凭证和对应分配三项金额的按分闭环复核，只负责关闭完整配对；已有实际结算的开放登记禁止删除并允许整组冲正。
- 2026-08-17: 合同链日期筛选改为固定读取根合同日期；经营看板年度合同数量、金额、未结金额和项目合同排行按主合同年份过滤，补充／终止协议年份不再改变统计归属。资金流水及核算收入继续使用真实业务发生日期。
- 2026-08-17: 合同收支方向改为由合同大类直接写入；主营和非主营固定为收入，资产类固定为支出，历史合同统一回填 `contract_category`（合同分类）来源。发票和银行凭证只校验方向一致性，不能覆盖合同分类方向。
- 2026-08-17: 合同上传新增默认关闭的辅助材料开关，新增按版本更新开关接口；辅助档案接口仅允许已开启合同使用。创建页面不再要求用户选择二级分类，服务端按合同类型赋兼容默认值或继承上级合同。
- 2026-08-17: 合同所属行政区新增“全部”正式值；上传、草稿更新和项目关系校验同步支持，“全部”合同可关联任一北京市具体行政区项目。
- 2026-08-17: 扩展现有合同经营看板接口，新增三类合同本月／累计／未结／完成比例、严格结算三态、无固定金额独立数量及所选月／上月／上年同月收支比较；合同台账增加结算状态筛选用于看板下钻。全部金额按分计算且只统计已确认未冲正银行回单，原核算公式、历史费率和路由地址不变。
- 2026-08-17: 合同台账汇总拆分有效合同与待签合同金额，草稿、首次审批中和待盖章不再进入有效总额；合同经营看板接口新增全部／有效／待签数量与金额，并将合同金额存量、分类有效结构和结算状态改为全部年度快照。年份继续作用于年度核算、十二个月趋势和项目排行。
- 2026-08-17: 合同台账和经营看板的有效金额新增收入／支出拆分字段及数量；主营、非主营计入有效收入合同额，资产类计入有效支出合同额，兼容有效总额保持两者相加。
- 2026-08-17: 盖章版上传和重新识别接口改为复用审批合同的分类及合同关系上下文；资产租赁盖章版继续执行租赁专用金额规则，不再让附件收据或保证金金额参与合同总额候选。
- 2026-08-17: 盖章核验增加签章页审批日期证据恢复；同页精确日期可跨越印章噪声采用，非签章页日期和晚于上传日的异常日期继续拒绝。
- 2026-08-17: 盖章核验 `retry`（重新识别）增加未归档 `ready_to_archive`（可归档）状态，用于在不重复上传文件的情况下应用更新后的识别规则。
- 2026-08-17: 合同财务发票新增单页电子 PDF（便携式文档格式）结构化坐标快速路径；核心字段完整时跳过整页渲染及两类图像识别，开票名称仅取项目名称列并排除规格型号。公司身份改为工程咨询／科技两个名称税号结构化主体；两内部主体之间的划拨不计合同收支，最终对外付款才进入资产合同支出并归集至工程咨询公司经营口径，路由地址不变。
- 2026-08-17: 合同财务发票上传增加识别后即时业务键查重，重复发票不进入页面合计，登记保存仍保留咨询锁和唯一索引二次防线；发票表格完整显示发票号码并移除税额列。
- 2026-08-17: 报销真实／核减发票与合同财务发票新增跨模块号码互斥；双方写入共用规范化发票号码和事务咨询锁，后进入模块返回统一错误码并标明已占用模块；无票收据明确排除。
- 2026-08-17: 资产合同新增资金承担方式更新和最终对外付款补充接口；内部划拨作为工程咨询经营支出，科技最终付款作为独立履约事实，两条金额链分别按分与发票对应。
- 2026-08-18: 合同响应新增月物业管理费字段和“月租金＋月物业费”计算来源；资产房屋租赁识别及盖章重试均采用综合总额优先、否则固定月租金与明确月物业费合计乘租期的口径。
- 2026-08-17: 内部划拨登记接口收紧主体方向校验，识别结果及保存事务均要求北京羽隶工程咨询有限公司付款、北京羽隶科技有限公司收款；方向相反或任一主体不匹配返回主体不一致错误并拒绝登记。
- 2026-08-18: 合同银行回单上传及三类登记保存接口统一按规范化电子回单号码查重；同批、已验证／已阻断上传任务或历史收付款记录存在相同号码时返回 `DUPLICATE_CONTRACT_BANK_DOCUMENT`，不再要求日期、金额和账号同时相同才判重。
- 2026-08-18: 资产房屋租赁发票识别与登记接口新增逐条明细、自动成本分类及金额闭合门禁；详情接口新增按有效付款比例分摊后的租赁成本汇总，冲正记录自动排除。
- 2026-08-18: 资产合同资金方式改为服务端按甲乙双方自动推导，工程咨询公司出现在任一方即直付，否则为工程咨询划拨科技；前端取消资金方式选择器。
- 2026-08-18: 资产财务登记移除整笔支出分类输入，登记与补充付款接口忽略客户端分类参数，成本口径只采用发票逐条自动分类。
- 2026-08-18: 发票 `lineItems` 明细拆分限定为资产房屋租赁合同上下文；其他合同继续返回和保存普通整票识别字段。
- 2026-08-18: 合同终止改为正式解除协议书流程；新增解除上传上下文及专用识别接口，锁定主合同或补充协议目标并返回已履行、未履行和最终金额。旧原因式终止接口固定返回 410，通用合同上传拒绝创建无目标解除协议；盖章核验归档后才终止目标，办理期间冻结新增财务记录。
- 2026-08-18: 新增员工合同文件下载申请 API（应用程序接口）；员工只能对具体行政区合同提交用途、锁定签名申请单和当前附件快照，唯一活动总经理审批后进入管理员待办，管理员只下载获批文件并在全部传输成功后办结。
- 2026-08-19: 解除协议识别响应中的协议自身合同金额固定为 `0.00`；原合同金额链调整额继续按解除结算快照独立保存，二者不互相覆盖。
- 2026-08-19: 合同下载申请新增角色隔离提醒计数和员工结果确认已读接口；计数只依据当前登录账号，不接受客户端指定申请人、审批人或执行人。
- 2026-08-19: 合同下载申请新增员工待审批撤回及驳回／撤回后重提接口；重提创建新申请行并返回跨尝试审批历史，来源版本、本人权限、最新叶子和并发唯一约束均由服务端校验。
- 2026-08-19: 合同下载结果确认已读接口改为必传 1 至 100 个当前页申请编号；服务端按登录员工和指定编号更新，禁止无参清空、跨员工确认或连带清除分页外未读结果。
- 2026-08-19: 合同下载申请新增总经理本人已处理历史范围；按实际审批人和已处理状态分页、按决定时间倒序，并收紧重提链详情，旧驳回处理人不能读取后来分配给其他总经理的新尝试。
- 2026-08-19: 合同下载申请新增执行管理员本人办结历史范围；仅按实际执行人返回已完成记录并按完成时间分页倒序，其他管理员和非管理员均不能读取。
- 2026-08-19: 总经理合同下载审批记录排除已驳回申请，只保留本人已批准及其执行中、已完成状态；显式筛选已驳回返回 403。
- 2026-08-20: 主营项目新增在线三联单生成接口；工程项目名称和本次付款由申请人填写，合同金额与以前累计由服务端读取，累计金额按分计算并冻结快照，输出第一联、第二联、第三联三页 A4 PDF。历史 Excel 三联单检查、预览和打印接口继续兼容。
- 2026-08-19: 新增收入合同开票申请 API（应用程序接口），覆盖资格查询、草稿保存、材料上传、申请人签名提交、总经理审批签名、管理员盖章交付及开具完成。主营三联单必须为真实 Excel（电子表格）原件且包含“其他费用”工作表；原件下载、目标表预览与管理员打印分为独立受控接口。

## 开票申请接口

开票申请与付款申请完全分离。请求中的 `amount`（本次开票金额）表示客户拟支付、我公司据此申请开票的金额，不得写入公司对外付款事实。

- `GET /api/invoice-applications/eligibility?contractId=...`：返回主合同摘要、当前有效合同金额、已开票金额、审批／盖章／待开票占用金额、剩余可申请额度和同一甲方最近一份非草稿、非驳回申请的有效开票信息。仅已完成盖章核验并归档的主营／非主营主合同可通过；资产合同、子协议、草稿、审批中、待盖章、撤销、驳回、终止和无剩余额度均拒绝。
- `GET /api/invoice-applications`：员工使用 `scope=mine` 并以 `view=current|history` 区分当前与历史；总经理使用 `scope=manager_pending|manager_processed` 区分“待我审批／审批记录”；管理员使用 `scope=admin`。`manager_pending` 只返回 `target_approver_id`（目标审批人编号）等于当前总经理且状态为待审批的申请，按提交时间升序；`manager_processed` 只返回 `approver_id`（实际审批人编号）等于当前总经理且已经驳回或通过后进入后续状态的申请，按决定时间倒序。两类总经理范围均支持 `keyword` 在服务端分页前匹配合同名称、编号、甲方和申请人。`GET /api/invoice-applications/:id` 同步区分当前目标审批人与实际处理人权限。
- `GET /api/invoice-applications/pending-counts`：按登录角色返回开票待办数量。员工返回本人 `rejected`（已驳回待修改）数量；总经理只返回 `target_approver_id`（目标审批人编号）等于本人且状态为待审批的数量；管理员返回待盖章、待开具和已开具但待财务登记数量，`pending_invoice`（待开票／待财务登记）持续计数到正式发票足额匹配并完成。响应同时返回角色分项和当前角色总数。
- `POST /api/invoice-applications` 和 `PATCH /api/invoice-applications/:id`：创建或更新本人草稿。更新必须带 `expectedVersion`（预期版本）；保存开票名称、税号、地址、电话、开户行、账号和选填备注，如用户修改历史带入值，必须将修改前后快照写入审计记录。
- `POST /api/invoice-applications/:id/triplicate`：主营项目申请人在线生成固定三联单。请求只接收可修改的工程项目名称、本次付款金额和申请版本；服务端锁定合同链，读取当前有效合同金额，汇总以前处于有效流程状态的申请金额，按分计算“之前累计＋本次＝本次累计”，校验剩余额度及累计不超过合同金额，并生成第一联、第二联、第三联三页 A4 PDF（便携式文档格式）。
- `POST /api/invoice-applications/triplicate-inspection`：历史兼容接口。普通员工仍可对旧主营三联单 Excel（电子表格）执行只读结构检查；新申请页面不再要求上传该文件。
- `POST /api/invoice-applications/:id/materials` 和 `DELETE /api/invoice-applications/:id/materials/:materialId`：仅草稿所有人可增删材料。主营合同必须上传真实 XLS（旧版电子表格）或 XLSX（电子表格）三联单，并精确包含“其他费用”工作表；正式保存时再次提取本次付款金额并与申请金额按分核对。非主营材料可为 Excel（电子表格）、PDF（便携式文档格式）、JPG（联合图像专家组格式）或 PNG（便携式网络图形），单份申请累计最多 20 份。文件进入扩展名、真实文件头、容器可解析性、大小、工作表数量和主动内容安全门禁；金额来自电子表格结构，不调用 OCR（光学字符识别）。
- `GET /api/invoice-applications/:id/materials/:materialId/preview`：受权预览。系统在线生成的主营三联单直接内联返回三页 PDF；历史 Excel 三联单仍只返回“其他费用”派生预览，绝不返回其他工作表。
- `GET /api/invoice-applications/:id/materials/:materialId/download`：下载完整原件，仅用于受权业务处理和审计；下载不得改写原文件。
- `GET /api/invoice-applications/:id/materials/:materialId/print`：仅对需要盖章的材料和管理员任务开放。系统生成的主营三联单以内联三页 PDF 返回，管理员可直接使用浏览器打印；历史 Excel 三联单继续导出只显示“其他费用”工作表的 PDF，转换不可用时安全回退为仅含该表的 XLSX（电子表格）。非主营需盖章材料按原格式下载打印。
- `GET /api/invoice-applications/:id/application-preview`：预览当前开票及用印申请单。待总经理审批时返回申请人单签 PDF（便携式文档格式）；审批通过后返回申请人和总经理同页双签版。物理文件、当前版本及 SHA-256（安全散列算法）摘要任一不一致时拒绝输出。
- `POST /api/invoice-applications/:id/submit`：事务内重算剩余额度，校验开票名称、税号及本人确认，从服务端读取申请人锁定签名后才可进入总经理审批。
- `POST /api/invoice-applications/:id/withdraw`：仅申请人本人可在状态仍为待总经理审批时按 `expectedVersion`（预期版本）撤回。撤回与总经理审批共用根合同及申请行锁；成功后恢复草稿，清除本轮目标审批人、签名引用和提交额度快照，但保留申请内容、三联单及完整审计记录。
- `POST /api/invoice-applications/:id/decision`：仅提交时锁定的总经理可通过或驳回；通过必须从服务端读取本人锁定签名。需盖章时进入 `pending_seal`（待盖章），无需盖章时直接进入 `pending_invoice`（待开具发票）。
- `POST /api/invoice-applications/:id/deliver`：管理员登记材料已盖章并交付申请人，必须提交本次申请对应的 `sealedTriplicateFileId`。该文件须由当前管理员上传至同一合同、类型为“三联单”、真实格式为 PDF（便携式文档格式）且仍为有效附件；图片或其他格式不能推进交付。校验通过后状态进入待开具发票。
- `POST /api/invoice-applications/:id/mark-issued`：管理员登记本次发票已开具，该动作只写入开具事实且不得重复调用。正式发票文件仍通过现有合同财务登记上传和查重；只有已登记开具且正式发票足额匹配时申请才进入已完成，任一条件缺失均保持待开具／待财务登记。

- 2026-08-19: 开票申请状态动作及既有正式发票的单笔／整组确认、删除、冲正统一采用“根合同事务锁→申请行／发票行锁”顺序，禁止发票写入与开具登记并发死锁；补充已开具和正式发票足额的双重完成条件、材料总数上限及显式清空历史开票可选字段的空值语义。
- 2026-08-19: 新增主营三联单上传前检查接口，按“本次付款”列明细与“合计”交叉单元格返回整数分；正式材料上传和提交审批均重新核对原件摘要及金额，禁止客户端改写自动填入值。
- 2026-08-19: 开票申请不再要求或展示开票内容，服务端统一保存空兼容值；发票类型白名单收紧为增值税专用发票、增值税普通发票，其他类型直接拒绝。
- 2026-08-20: 开票申请详情增加申请人部门快照，原“签字记录／操作留痕”统一为审批流程；各节点返回职位、姓名、动作和时间。
- 2026-08-20: 员工本人开票申请分页新增当前申请与历史申请视图；默认当前申请排除已完成记录，历史申请仅返回已完成记录，并在最终分页前重算关联根合同的发票分配状态。
- 2026-08-20: 开票待办计数扩展为员工、总经理、管理员角色化口径；总经理开票审批和管理员待财务登记不再漏计，员工被驳回待修改申请持续提示至重提。
- 2026-08-20: 开票申请列表新增总经理待审批与审批记录独立范围，分别按目标审批人和实际处理人隔离并支持服务端搜索；下载申请审批同步增加合同、编号、申请人和用途搜索。
- 2026-08-20: 合同下载申请新增撤回叶子安全删除接口；总经理待审批卡片主操作改为“同意”且继续强制本人在申请单签字；管理员处理记录新增本人权限范围关键词搜索与防公式注入、上海时区日期列、5000条上限的 Excel（电子表格）导出接口。
- 2026-08-20: 开票申请新增审批前撤回接口；仅申请人本人、待总经理审批状态和匹配版本可撤回为草稿，总经理审批与员工撤回并发时只有先取得事务锁的一方成功。
- 2026-08-20: 新增财务识别待登记任务恢复接口；仅返回当前主合同中已验证、可建草稿、未消费且未被登记明细引用的发票和回单，页面刷新后继续使用原任务，重复回单校验保持不变。
- 2026-08-20: 营收财务登记的主体闭环改为核对“销项发票销售方＝回款回单收款人”；购买方与实际付款人允许为不同主体。资产支出及内部划拨仍执行原有严格付款方、收款方规则。
- 2026-08-20: 辅助材料上传取消内容识别与重新识别接口；一份辅助合同及多份可选发票、回单通过文件安全校验后直接归档，响应状态直接为已归档。
- 2026-08-20: 资产租赁发票识别区分房屋与车辆：只有房屋租赁启用逐条费用、税额和合同内外成本闭环；小客车、车辆、汽车及租车合同按普通资产发票处理，票面明确“免税／不征税”时允许税额为空。
- 2026-08-20: 合同元数据中的资产二级分类固定为采购合同、软件合同、设备合同、房屋租赁、汽车租赁、办公资产合同六项；新建资产主合同必须显式提交其中一项，子协议继续继承上级分类。
- 2026-08-24: 合同元数据资产二级分类新增 `parking_space`（车位合同），现共七项；新建资产主合同可显式选择，补充协议和解除协议继续继承上级分类。该编码只表示合同主数据分类，不替代付款明细的 `parking`（车位费）。
- 2026-08-20: 读取、保存和签署草拟合同用印申请单时，服务端均从最新合同识别原文提取唯一且合法的“一式×份”数量，并强制覆盖客户端份数；没有明确表述、存在冲突或超出 1 至 20 份时保持未识别并阻断办理，页面不允许人工修改。
- 2026-08-20: 合同台账汇总、根合同链置顶和单行到期标记统一按 `CURRENT_DATE + 1 month`（当前日期加一个月）判断租赁到期提醒，不再使用三个月窗口。
- 2026-08-20: 合同经营看板由独立年份／月份改为 `startMonth/endMonth` 统一期间，新增严格期间合同额并明确顶部合同规模为全历史快照；期间收支、核算、趋势、比较和项目排行统一使用同一起止范围，最长 36 个月。
- 2026-08-20: 辅助材料文件接口支持默认内联预览及 `download=1`（下载）附件响应；两种方式均继续校验合同、档案包、文件编号、受控路径与财务角色权限。
- 2026-08-20: 辅助材料列表、详情、预览和下载只读权限扩展至总经理；新增、备注和删除仍仅允许管理员组。管理员与总经理前端预览统一调用原生浏览器新页面，保留浏览器打印和保存能力。
- 2026-08-20: 关闭合同“是否需要辅助材料”前，服务端在合同行锁内检查辅助档案；只要仍存在任一档案包即返回 `CONTRACT_AUXILIARY_SETTING_HAS_CONTENT`，必须全部删除后才能关闭。
- 2026-08-20: 辅助材料档案包改为至少一份必传合同，合同、发票、回单三类均可多选，单包合计最多 20 份且单份最多 30MB；重复摘要、超量或任一文件校验失败时整批拒绝并清理本批文件，安全校验通过后直接归档且不发起内容识别。
- 2026-08-21: 辅助材料新增档案内追加文件接口；首次建档仍要求辅助合同，已有档案后可只追加发票或回单。追加过程锁定档案版本并复核单包20份上限、已有合同、跨批次摘要重复及文件安全，失败时清理本批临时文件。
- 2026-08-20: 主合同详情接口集中返回同根主合同、补充协议和解除协议的正式附件，并补充四个来源字段；补充及解除协议详情不单独返回附件。附件按主合同、补充序号、解除协议排序，预览和直接下载仍校验文件真实归属合同，财务事实和辅助档案不并入本附件数组。
- 2026-08-20: 合同财务识别在字段解析前增加票面文件类型门禁；普通 PDF（便携式文档格式）和图片必须由可见首页 OCR（光学字符识别）在顶部识别发票标题，银行回单必须在顶部同时出现银行名称／银行字样和回单标题。完整结构化电子发票仅在核心字段、坐标布局及顶部标题同时闭合时走受限快速例外；不符合分别返回 `INVOICE_DOCUMENT_TYPE_MISMATCH` 或 `BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH`，页面明确提示“此不是有效发票／此不是有效回单”，停止后续字段登记并清理本次无效上传任务。
- 2026-08-20: 合同台账列表项新增 `contractCutoffDate`（合同截至日期）；服务端在根合同分页前按已确认未冲正银行事实求最新业务日期，收入读取回款日期，普通支出读取付款日期，工程咨询划拨科技模式同时比较划拨回单与最终对外付款回单日期。字段仅在根合同状态为已完成，或已有有效回单后终止时返回；其他状态、无有效回单及关联协议行页面均显示空值。
- 2026-08-20: 管理员登记开票申请材料已盖章交付前，必须先上传本次盖章后三联单；交付入口仅接受 PDF（便携式文档格式），接口校验文件与合同、管理员、附件类型、真实格式和有效状态一致，缺失或伪造文件编号时拒绝推进流程。
- 2026-08-21: 合同识别接口在同一任务内自动补扫普通失败页并对“一式几份”执行独立高清可见页复核；未恢复页或非唯一用印总份数均阻断成功落库。用印申请读取改为返回可信份数或明确空值状态，不再显示默认 2 份，也不新增人工重新识别入口。
- 2026-08-21: 合同台账与主合同附件改按子协议当前盖章版事实切换：未上传盖章版的补充／解除协议挂在主合同台账子行，上传成功后立即退出台账并整包进入主合同附件。列表筛选、移动端展开、台账导出、员工下载候选及伪造附件校验统一使用 `sealed_contract + is_current` 门禁；上传只改变展示位置，解除目标仍须核验归档后才终止。
- 2026-08-21: 合同财务登记的单张、批量新建和已有登记补充三条发票路径同步兼容已验证车辆租赁免税票的空税额；空值原样写入正式发票记录并原样回读，不再触发金额格式错误。非车辆租赁或未通过免税验证的发票仍执行数字及两位小数门禁。
- 2026-08-22: 月度财务报表接口增加月份级并发锁、可串行化月结、历史月份承接链级联重算、严格快照完整性、手工项差异审计和稳定人员编号；报销删除接口仅允许本人草稿／已驳回状态，并增加独立业务付款日期。
- 2026-08-24: 月报收入返回银行实际主营到账总额；报销归月改为银行回单实际交易日期；下载接口改为《月度结算表》模板主表加三张追溯明细表。
- 2026-08-24: 合同结构解析升级至第十七版；封面独立编号／年度文号不再污染下一行租赁标题，停车位租赁可按优惠后每月总费用与实际租期计算合同总额，并以同周期半年费用复核。既有第十六版部分结果在草稿恢复时自动复跑，无需重新上传原件或按单份合同修改识别代码。
- 2026-08-24: 房屋／场地、汽车和车位租赁原合同新增续签及退租／还车直达办理；续签使用专用文件识别入口并冻结原到期日，新租期金额作为正向补充增量。盖章归档后才推进主合同当前有效到期日；退租／还车继续复用解除协议结算归档，办理前不提前终止。
- 2026-08-24: 新增租赁满进度直接退出接口；服务端在合同锁内按整数分重新核算执行进度并校验预期版本，已履行金额严格等于当前有效金额后管理员可直接退租／还车且不创建解除协议文件，不足时继续强制使用解除协议识别入口，超额时先处理结算差异。
- 2026-08-24: 租赁续签改为独立新主合同接口：新增专用来源上下文，续签上传不再创建补充协议或进入原合同金额链；新旧合同通过独立谱系字段互链，只有新合同盖章归档后才正式切换到期提醒与后续操作叶子。
