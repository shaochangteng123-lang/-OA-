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

**数据显示规则：**

- `/api/reimbursement/list`：默认显示最近一个月的数据，按创建时间升序排列（早的在下，晚的在上）
- `/api/reimbursement/records`：显示所有历史数据，用于报销统计页面
- 基础报销、大额报销、商务报销页面使用 `/list` 端点，超过一个月的历史数据需在报销统计中查看
- `/api/reimbursement/transport-fuel-quota`：返回基础报销当月交通额度使用情况，总额度为 ¥1500；统计运输、交通、汽油、柴油、通行费及交通卡、一卡通、公交卡、地铁卡、乘车卡等交通储值卡类发票，排除草稿和已驳回报销单，编辑模式可通过 `excludeId` 排除当前报销单

````

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
