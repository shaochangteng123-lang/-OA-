# 节假日数据更新说明

## 概述

节假日数据现在存储在数据库中。后端启动后会自动检查今年和明年的国务院节假日通知，发现缺失年份数据时会自动解析并写入 `holidays` 表。

## 数据来源

节假日数据来源于国务院办公厅发布的节假日安排通知。默认通过中国政府网政策库搜索接口发现通知链接，也可通过 `HOLIDAY_SOURCE_URL` 指定通知页面。

## 更新方法

### 方法1：后台自动更新（推荐）

1. **自动检查**
   - 服务启动后 30 秒自动检查一次
   - 每天 03:10 自动检查今年和明年数据
   - 仅在年份数据缺失时自动写入，避免重复覆盖

2. **手动兜底**

   ```bash
   npm run update:holidays 2027
   ```

3. **指定通知来源**
   ```bash
   HOLIDAY_SOURCE_URL=https://www.gov.cn/... npm run update:holidays 2027
   ```

### 方法2：通过API更新（需要管理员权限）

1. **准备数据格式**

   ```json
   {
     "holidays": [
       { "date": "2026-01-01", "name": "元旦", "type": "holiday" },
       { "date": "2026-01-04", "name": "元旦补班", "type": "workday" }
     ],
     "sourceUrl": "https://www.beijing.gov.cn/..."
   }
   ```

2. **调用API**
   ```bash
   POST /api/holidays/update
   Authorization: Cookie: connect.sid=...
   ```

## API接口

### 获取所有节假日

```
GET /api/holidays
GET /api/holidays?year=2026
```

### 获取指定日期

```
GET /api/holidays/date/2026-01-01
```

### 获取指定年份

```
GET /api/holidays/year/2026
```

### 更新节假日数据（需要管理员权限）

```
POST /api/holidays/update
Content-Type: application/json
{
  "holidays": [...],
  "sourceUrl": "..."
}
```

## 数据格式

```typescript
interface HolidayInfo {
  date: string; // yyyy-MM-dd 格式
  name: string; // 节假日名称，如"元旦"、"春节"等
  type: "holiday" | "workday"; // holiday: 放假, workday: 补班
}
```

## 注意事项

1. **数据缓存**：前端会缓存节假日数据1小时，更新后可能需要等待缓存过期或刷新页面
2. **备用数据**：如果API不可用，前端会使用内置的备用数据
3. **权限控制**：只有管理员可以更新节假日数据
4. **数据验证**：更新时会自动验证数据格式和日期格式
5. **自动更新范围**：后台任务检查今年和明年；手动命令默认更新明年，也可传入指定年份

## 未来改进

- [x] 实现自动爬取政府网站数据
- [x] 添加定时任务自动检查更新
- [ ] 支持多年份数据管理
- [ ] 添加数据变更历史记录

## 开发最终合同台账迁移生产

合同台账迁移使用白名单快照，不允许整库覆盖生产数据：

```bash
# 开发环境只读导出，输出目录必须不存在
npm run contract:ledger:export -- \
  --output /app/debug/contract-ledger-final-snapshot-2026-08-28 \
  --source-files-root /app

# 生产编译产物预演
NODE_ENV=production node dist/server/scripts/import-contract-ledger-snapshot.js \
  --dry-run --bundle /安全路径/contract-ledger-final-snapshot \
  --storage-root /app
```

正式提交还必须提供固定生产确认令牌和外部核对过的64位清单摘要。生产镜像不包含 `tsx（TypeScript直接执行器）`，不得在生产中使用开发命令。完整备份、演练、提交、验收和回滚步骤见 `docs/合同台账开发转生产迁移说明.md`。

## 第二批历史合同开发／生产增量导入

第二批使用独立冻结清单和开发库专用门禁，不复用第一次导入器：

```bash
npm run contract:historical:second -- --dry-run \
  --source-root /tmp/second-historical-import-source

npm run contract:historical:second -- --commit \
  --source-root /tmp/second-historical-import-source \
  --receipt-ocr /app/debug/second-historical-import-20260910/receipt-ocr.json
```

开发模式继续使用原命令和环境门禁。生产增量导入必须显式指定 `--target=production`，并同时锁定源文件清单摘要、业务语义摘要、生产目标数据库指纹和实际回单复核文件；正式提交另需固定确认令牌：

```bash
# 生产事务预演：完整执行后回滚，不推进合同编号序列
NODE_ENV=production node dist/server/scripts/import-second-historical-contracts.js \
  --dry-run --target=production \
  --source-root /migration/source \
  --receipt-ocr /migration/receipt-ocr.json \
  --manifest-sha256=f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3 \
  --semantic-sha256=2b5f2fd6d73bb668caef2d117767eb1ddc67f13f60a61a51c7d5de4be9c09936 \
  --target-database-sha256=<生产目标库基线摘要>

# 生产正式提交
NODE_ENV=production node dist/server/scripts/import-second-historical-contracts.js \
  --commit --target=production \
  --source-root /migration/source \
  --receipt-ocr /migration/receipt-ocr.json \
  --manifest-sha256=f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3 \
  --semantic-sha256=2b5f2fd6d73bb668caef2d117767eb1ddc67f13f60a61a51c7d5de4be9c09936 \
  --target-database-sha256=<与预演相同的生产目标库基线摘要> \
  --confirm-production=IMPORT_SECOND_HISTORICAL_BATCH_TO_PRODUCTION
```

生产执行使用 `SERIALIZABLE（可串行化）` 事务并锁定合同表、批次及全部发票号码。目标数据库指纹绑定 PostgreSQL（关系数据库）系统身份和排除本批新合同后的既有合同语义，龙潭湖仅掩码本次恢复允许变化的字段；因此预演、首次提交及刚完成后的幂等核验使用同一指纹，期间其他既有合同变化会阻断。系统检查合同域及报销模块的发票号码、普通／核减发票文件摘要和回单号，拒绝稳定编号、原件业务号及附件保存路径冲突。所有新附件只能位于 `/app/uploads`，逐级拒绝符号链接；龙潭湖必须沿用固定合同记录，提交前精确定位4份既有文件，其中只复用主合同和有效发票，另2份附件在确认没有任何下游引用后移除旧合同档案记录、清除作废票陈旧财务摘要，并重新写入不参与核算的辅助材料。预演与提交都完整写入并核验41份主合同、6份补充协议、219份财务原件、115份辅助材料、41条登记、219条明细、156条匹配、384份物理源映射和目标金额历史；生产增量必须与冻结计数完全一致。提交前还锁定并读取合同编号序列，下一值必须严格大于当前最大已用值；预演完全不调用序列。明确失败时回滚并只清理本轮新建文件；数据库提交结果无法确认时保留文件并禁止重试，必须先进行只读验收。

导入后使用 `verify-second-historical-contracts.ts` 执行逐文件摘要和财务闭环验收。未指定 `--target` 时仍默认为开发模式，原开发命令保持兼容；也可以显式执行：

```bash
NODE_ENV=development npx tsx server/scripts/verify-second-historical-contracts.ts \
  --target=development \
  --source-root /tmp/second-historical-import-source \
  --output /app/debug/second-historical-import-20260910/verification.json
```

生产环境只能运行编译后的只读验收器，并且必须同时提供冻结源文件清单摘要和回单复核文件摘要：

```bash
NODE_ENV=production node dist/server/scripts/verify-second-historical-contracts.js \
  --target=production \
  --source-root /migration/source \
  --receipt-ocr /migration/receipt-ocr.json \
  --manifest-sha256=f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3 \
  --receipt-ocr-sha256=e0c6d0c0f541e310a3f51146f0bc33955a27ab01a541a9deae1b49c2826d56de \
  --semantic-sha256=2b5f2fd6d73bb668caef2d117767eb1ddc67f13f60a61a51c7d5de4be9c09936 \
  --target-database-sha256=<生产预演输出的目标数据库指纹>
```

生产验收必须在 `/app` 工作目录和 `NODE_ENV=production` 下执行，拒绝未知参数、重复参数、错误目标、错误摘要和 `--output`。验收器会现场计算回单复核文件摘要，将97份付款人、账户、电子回单号和交易流水与数据库识别快照逐笔对照，并复算业务语义摘要和目标数据库指纹。全部数据库查询封装在 `REPEATABLE READ READ ONLY（可重复读只读事务）` 中，生产结果只输出到控制台，不创建或修改数据库记录和验收文件。

验收口径为：41份主合同全部具有财务资料，并且必须各有且仅有一条未反冲登记；登记明细必须与219份财务原件一一对应，39条登记应关闭、2条应保持待补，不再保留无财务资料的独立护套线合同。384份映射固定拆分为41份主合同、6份协议、219份财务原件、115份辅助材料、2份普通归档及1份作废票归档，不允许出现 `existing_contract_archive（既有合同档案）` 映射。每份合同的匹配金额必须等于发票与回单／付款合计的较小值；龙潭湖必须无待补差额，目标金额合同的现有845,000元发票与回单必须关闭。

已完成旧批次可使用 `correct-second-historical-auxiliary-classification.ts` 做一次性归类更正。脚本默认对开发库执行可串行化事务预演；开发提交必须指定独立确认令牌。生产预演和提交除生产令牌外，还必须传入由脚本导出的只读计算函数现场生成的 `--target-database-sha256`，该摘要绑定数据库系统编号、数据库编号、账号、4份目标合同完整记录及批次完整记录，禁止手工猜测或复用其他数据库摘要。脚本会先复制并核对三份辅助材料，再在同一事务中更新映射、移除错误数据库记录并写入完整删除前快照；旧物理文件始终保留。生产更正审计必须完整保存三条旧合同文件、三条旧映射、作废票财务摘要、错误根合同和旧导入审计，幂等验收逐字段复核。

```bash
# 开发库预演
npm run contract:historical:second:correct-auxiliary

# 开发库提交
npm run contract:historical:second:correct-auxiliary -- --commit \
  --target=development \
  --confirm-target=CORRECT_SECOND_HISTORICAL_AUXILIARY_IN_DEVELOPMENT
```

## 已核验旧回单币种补齐

`repair-reviewed-legacy-receipt-currency.ts` 只用于三张已逐张复核为人民币、但第十一版识别未保存币种的主营回单。工具仅允许在生产容器 `/app` 中运行，且同时冻结三份 SHA-256（安全散列算法）摘要及对应合同、回单、文件、OCR（光学字符识别）任务、财务摘要和物理原件。默认命令会完整模拟更新和审计后回滚，并返回正式提交必需的生产数据库状态摘要：

```bash
# 生产事务预演，零持久化写入
node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js

# 生产正式提交
node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js --commit \
  --target-database-sha256=<预演返回的摘要> \
  --confirm-target=REPAIR_REVIEWED_LEGACY_RECEIPT_CURRENCY_IN_PRODUCTION
```

脚本必须恰好更新 3 条回单并写入 3 条审计，否则整个可串行化事务回滚。提交后重新执行默认命令会只读核对完整后态并返回 `skipped（已跳过）`；其他空币种回单不会被推断或修改。

`compare-second-import-backup.ts` 用于导入前后旧数据审计。它逐行比较合同相关表、用户和项目；仅允许龙潭湖原合同恢复、既有发票补识别引用及既有财务登记从待补转为关闭，并进一步核验这些字段的最终值。用户或项目数量变化、其他旧行缺失或字段变化均立即失败。

### 更新日志

- 2026-08-28: 新增开发最终合同台账白名单快照导出与生产保存点预演、原子导入说明。
- 2026-09-10: 新增第二批历史合同开发库冻结导入、逐文件映射、整批回滚和龙潭湖原记录恢复说明。
- 2026-09-10: 第二批财务登记和凭证对应关系并入主导入单一事务；重复执行增加完整性复核和零写入跳过，独立恢复脚本限制为本批财务文件。
- 2026-09-10: 第二批验收新增219条登记明细、一一匹配、39条关闭／2条待补、龙潭湖零待补和目标金额当前财务闭环断言；导入前后审计只放行龙潭湖预期旧行变化。
- 2026-09-11: 第二批验收器新增严格的开发／生产目标解析；生产验收要求固定双摘要、只读事务和控制台输出，拒绝文件写入与未知参数。
- 2026-09-11: 第二批生产验收器增加回单复核文件现场摘要、97份识别快照、附件路径符号链接、逐文件归属、6份补充协议、219份财务原件、156条匹配及目标数据库指纹复核。
- 2026-09-11: 第二批验收器仅对龙潭湖固定合同、发票、文件摘要和既有识别任务兼容首批系统边界修复产生的六字段旧快照；其他财务记录仍必须提供第二批源路径和源摘要。
- 2026-09-11: 第二批导入器新增生产增量模式；固定清单、回单复核摘要和确认令牌，执行跨模块查重、稳定编号与附件路径预检、龙潭湖4份文件基线、完整事务预演和冻结增量断言，提交结果不确定时保留附件并禁止重试。
- 2026-09-13: 第二批最终口径改为41份主合同；10月31日护套线合同归入11月6日合同的辅助材料。龙潭湖2份附件从合同档案安全迁入辅助材料，作废票陈旧财务摘要同步移除，验收拒绝旧档案及旧映射类型残留。
- 2026-09-13: 新增已完成批次的幂等归类更正工具；生产执行绑定不可变数据库身份摘要，并把全部被删除数据库行及物理迁移信息写入可恢复审计。验收器同步核对批次40份新增合同、41个根结果及废弃合同和旧映射零残留。
- 2026-09-13: 辅助材料归类更正已在生产完成；生产预演、正式提交、后态幂等复跑及384份源文件全量验收均通过，台账最终为118组主合同链。
- 2026-09-13: 新增三张已核验旧回单币种补齐工具，采用精确摘要白名单、生产数据库状态绑定、物理原件复算、可串行化预演、三行影响门禁及完整前态审计。
