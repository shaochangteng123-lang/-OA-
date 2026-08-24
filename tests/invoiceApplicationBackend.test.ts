/** @jest-environment node */

import fs from "fs";
import path from "path";
import { pool } from "../server/db/index.js";
import {
  allocateInvoiceApplicationFacts,
  approvedInvoiceApplicationStatus,
  assertInvoiceApplicationMaterialPolicy,
  calculateInvoiceApplicationCapacity,
  createInvoiceApplication,
  generateMainBusinessTriplicate,
  getInvoiceApplicationAdminPendingCounts,
  getInvoiceApplicationPendingCounts,
  listInvoiceApplications,
  markInvoiceApplicationIssued,
  normalizeInvoiceApplicationType,
  resolveInvoiceApplicationBillingInfo,
  statusAfterInvoiceAllocation,
  withdrawInvoiceApplication,
} from "../server/services/invoiceApplication.js";

jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({
  db: {},
  pool: { query: jest.fn() },
}));

const repositoryFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("开票申请服务端主流程", () => {
  test("正式发票按申请提交顺序进行 FIFO 分配", () => {
    const allocations = allocateInvoiceApplicationFacts(
      [
        { id: "application-1", amount: 60, submittedAt: "2026-01-01" },
        { id: "application-2", amount: 80, submittedAt: "2026-01-02" },
      ],
      [
        { id: "invoice-1", amount: 100, createdAt: "2026-01-03" },
        { id: "invoice-2", amount: 20, createdAt: "2026-01-04" },
      ],
    );
    expect(allocations).toEqual([
      {
        applicationId: "application-1",
        invoiceId: "invoice-1",
        allocatedAmount: 60,
      },
      {
        applicationId: "application-2",
        invoiceId: "invoice-1",
        allocatedAmount: 40,
      },
      {
        applicationId: "application-2",
        invoiceId: "invoice-2",
        allocatedAmount: 20,
      },
    ]);
  });

  test("历史发票不得反向覆盖后提交的开票申请", () => {
    expect(
      allocateInvoiceApplicationFacts(
        [{ id: "application", amount: 50, submittedAt: "2026-02-02" }],
        [{ id: "old-invoice", amount: 50, createdAt: "2026-02-01" }],
      ),
    ).toEqual([]);
  });

  test("剩余额度同时扣除有效发票和未覆盖申请占用", () => {
    expect(
      calculateInvoiceApplicationCapacity({
        currentEffectiveAmount: 500,
        invoicedAmount: 120,
        activeReservations: [
          { amount: 100, allocatedAmount: 40 },
          { amount: 80, allocatedAmount: 0 },
        ],
      }),
    ).toEqual({
      currentEffectiveAmount: 500,
      invoicedAmount: 120,
      pendingAmount: 140,
      remainingAmount: 240,
    });
  });

  test("用户明确清空历史开票可选字段时不恢复旧值", () => {
    const normalized = {
      name: "新甲方",
      taxNumber: "NEW-TAX",
      address: "",
      phone: "",
      bankName: "",
      bankAccount: "",
      remark: "",
    };
    expect(
      resolveInvoiceApplicationBillingInfo(
        {
          name: "新甲方",
          taxNumber: "NEW-TAX",
          address: "",
          phone: "",
          bankName: "",
          bankAccount: "",
          remark: "",
        },
        normalized,
        {
          name: "旧甲方",
          taxNumber: "OLD-TAX",
          address: "旧地址",
          phone: "旧电话",
          bankName: "旧开户行",
          bankAccount: "旧账号",
          remark: "旧备注",
        },
      ),
    ).toEqual(normalized);
    expect(
      resolveInvoiceApplicationBillingInfo(
        { name: "新甲方", taxNumber: "NEW-TAX" },
        normalized,
        {
          ...normalized,
          address: "历史地址",
        },
      ).address,
    ).toBe("历史地址");
  });

  test("审批后仅需要盖章的申请进入管理员盖章队列", () => {
    expect(approvedInvoiceApplicationStatus("material_need_seal")).toBe(
      "pending_seal",
    );
    expect(approvedInvoiceApplicationStatus("material_no_seal")).toBe(
      "pending_invoice",
    );
    expect(approvedInvoiceApplicationStatus("no_material")).toBe(
      "pending_invoice",
    );
  });

  test("正式发票覆盖后自动完成，冲正后自动恢复待开票", () => {
    expect(
      statusAfterInvoiceAllocation({
        currentStatus: "pending_invoice",
        applicationAmount: 100,
        allocatedAmount: 100,
        issuedAt: "2026-08-19T10:00:00.000Z",
      }),
    ).toBe("completed");
    expect(
      statusAfterInvoiceAllocation({
        currentStatus: "completed",
        applicationAmount: 100,
        allocatedAmount: 60,
        issuedAt: "2026-08-19T10:00:00.000Z",
      }),
    ).toBe("pending_invoice");
    expect(
      statusAfterInvoiceAllocation({
        currentStatus: "pending_invoice",
        applicationAmount: 100,
        allocatedAmount: 100,
        issuedAt: null,
      }),
    ).toBe("pending_invoice");
  });

  test("非主营材料总数受单据级上限约束", () => {
    expect(() =>
      assertInvoiceApplicationMaterialPolicy({
        category: "non_main",
        materialMode: "material_no_seal",
        materials: Array.from({ length: 21 }, () => ({
          requiresSeal: false,
          hasOtherExpenseSheet: false,
        })),
      }),
    ).toThrow("最多上传20份材料");
  });

  test("主营固定三联单必须恰好一份且选择盖章", () => {
    expect(() =>
      assertInvoiceApplicationMaterialPolicy({
        category: "main_business",
        materialMode: "material_need_seal",
        materials: [
          { requiresSeal: true, hasOtherExpenseSheet: true },
          { requiresSeal: true, hasOtherExpenseSheet: true },
        ],
      }),
    ).toThrow("必须且只能上传一份");
    expect(() =>
      assertInvoiceApplicationMaterialPolicy({
        category: "main_business",
        materialMode: "material_need_seal",
        materials: [{ requiresSeal: true, hasOtherExpenseSheet: true }],
      }),
    ).not.toThrow();
  });

  test("非主营选择需要盖章时至少选择一份盖章附件", () => {
    expect(() =>
      assertInvoiceApplicationMaterialPolicy({
        category: "non_main",
        materialMode: "material_need_seal",
        materials: [{ requiresSeal: false, hasOtherExpenseSheet: false }],
      }),
    ).toThrow("至少选择一份需盖章附件");
  });

  test("员工、总经理和管理员三个流程角色不能越权", async () => {
    await expect(
      withdrawInvoiceApplication(
        { id: "manager", role: "general_manager" },
        "application",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      generateMainBusinessTriplicate(
        { id: "manager", role: "general_manager" },
        "application",
        { projectName: "测试项目", amount: "100.00" },
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getInvoiceApplicationAdminPendingCounts({
        id: "employee",
        role: "user",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listInvoiceApplications({ id: "employee", role: "user" }, "admin"),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      markInvoiceApplicationIssued(
        { id: "employee", role: "user" },
        "application",
        "",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      createInvoiceApplication(
        { id: "manager", role: "general_manager" },
        {
          contractId: "contract",
          amount: 100,
          invoiceContent: "服务费",
          invoiceType: "专票",
          materialMode: "no_material",
          billingInfo: {},
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("开票待办按员工、总经理和管理员当前职责分别计数", async () => {
    const query = pool.query as jest.Mock;
    query.mockReset().mockResolvedValueOnce({ rows: [{ count: 2 }] });
    await expect(
      getInvoiceApplicationPendingCounts({ id: "employee", role: "user" }),
    ).resolves.toMatchObject({
      employeeActionPending: 2,
      managerPending: 0,
      adminPending: 0,
      total: 2,
    });
    expect(String(query.mock.calls[0][0])).toContain("status = 'rejected'");
    expect(query.mock.calls[0][1]).toEqual(["employee"]);

    query.mockReset().mockResolvedValueOnce({ rows: [{ count: 3 }] });
    await expect(
      getInvoiceApplicationPendingCounts({
        id: "manager",
        role: "general_manager",
      }),
    ).resolves.toMatchObject({
      employeeActionPending: 0,
      managerPending: 3,
      adminPending: 0,
      total: 3,
    });
    expect(String(query.mock.calls[0][0])).toContain(
      "target_approver_id = $1 AND status = 'pending_approval'",
    );
    expect(query.mock.calls[0][1]).toEqual(["manager"]);

    query.mockReset().mockResolvedValueOnce({
      rows: [
        {
          pending_seal: 1,
          pending_issue: 2,
          pending_finance_registration: 4,
          pending_invoice: 6,
        },
      ],
    });
    await expect(
      getInvoiceApplicationPendingCounts({ id: "admin", role: "admin" }),
    ).resolves.toMatchObject({
      pendingSeal: 1,
      pendingIssue: 2,
      pendingFinanceRegistration: 4,
      pendingInvoice: 6,
      adminPending: 7,
      total: 7,
    });
    expect(String(query.mock.calls[0][0])).toContain(
      "COUNT(*) FILTER (WHERE status = 'pending_invoice')",
    );
  });

  test("员工开票申请默认显示当前记录并可切换已完成历史", async () => {
    const query = pool.query as jest.Mock;
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      listInvoiceApplications(
        { id: "employee-1", role: "user" },
        "mine",
        undefined,
        2,
        10,
      ),
    ).resolves.toEqual({
      items: [],
      total: 2,
      page: 2,
      pageSize: 10,
    });
    const reconcileCandidateSql = String(query.mock.calls[0][0]);
    const currentCountSql = String(query.mock.calls[1][0]);
    const currentListSql = String(query.mock.calls[2][0]);
    expect(reconcileCandidateSql).toContain(
      "application.status IN ('pending_invoice', 'completed')",
    );
    expect(reconcileCandidateSql).toContain(
      "COALESCE(contract.root_contract_id, contract.id)",
    );
    expect(currentCountSql).toContain("application.applicant_id=$1");
    expect(currentCountSql).toContain("application.status <> 'completed'");
    expect(currentCountSql).not.toContain("application.status = 'completed'");
    expect(currentListSql).toContain("application.status <> 'completed'");
    expect(query.mock.calls[2][1]).toEqual(["employee-1", 10, 10]);

    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 11 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      listInvoiceApplications(
        { id: "employee-1", role: "user" },
        "mine",
        undefined,
        2,
        10,
        "history",
      ),
    ).resolves.toEqual({
      items: [],
      total: 11,
      page: 2,
      pageSize: 10,
    });
    const historyCountSql = String(query.mock.calls[1][0]);
    const historyListSql = String(query.mock.calls[2][0]);
    expect(historyCountSql).toContain("application.applicant_id=$1");
    expect(historyCountSql).toContain("application.status = 'completed'");
    expect(historyCountSql).not.toContain("application.status <> 'completed'");
    expect(historyListSql).toContain("application.status = 'completed'");
    expect(query.mock.calls[2][1]).toEqual(["employee-1", 10, 10]);
  });

  test("员工开票申请拒绝未知列表视图且不查询数据库", async () => {
    const query = pool.query as jest.Mock;
    query.mockReset();

    await expect(
      listInvoiceApplications(
        { id: "employee-1", role: "user" },
        "mine",
        undefined,
        1,
        20,
        "unknown" as never,
      ),
    ).rejects.toMatchObject({ message: "员工开票申请列表视图不正确" });
    expect(query).not.toHaveBeenCalled();
  });

  test("总经理待审批与审批记录按本人职责分开查询", async () => {
    const query = pool.query as jest.Mock;
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listInvoiceApplications(
      { id: "manager-1", role: "general_manager" },
      "approval",
      undefined,
      1,
      20,
      "current",
      "甲方",
    );
    const approvalSql = String(query.mock.calls[0][0]);
    expect(approvalSql).toContain("application.target_approver_id=$1");
    expect(approvalSql).toContain("application.status = 'pending_approval'");
    expect(approvalSql).toContain(
      "application.contract_title_snapshot ILIKE $2",
    );
    const approvalListSql = String(query.mock.calls[1][0]);
    expect(approvalListSql).toContain(
      "application.submitted_at ASC NULLS LAST",
    );

    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await listInvoiceApplications(
      { id: "manager-1", role: "general_manager" },
      "approval_history",
    );
    const historySql = String(query.mock.calls[0][0]);
    expect(historySql).toContain("application.approver_id=$1");
    expect(historySql).not.toContain("application.target_approver_id=$1");
    expect(historySql).toContain(
      "application.status IN ('rejected','pending_seal','pending_invoice','completed')",
    );
    expect(String(query.mock.calls[1][0])).toContain(
      "application.decided_at DESC NULLS LAST",
    );

    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await listInvoiceApplications(
      { id: "admin-1", role: "admin" },
      "admin",
      undefined,
      1,
      20,
      "history",
    );
    const adminSql = String(query.mock.calls[0][0]);
    expect(adminSql).toContain(
      "application.status IN ('pending_seal','pending_invoice','completed')",
    );
    expect(adminSql).not.toContain("application.status <> 'completed'");
  });

  test("总经理详情权限区分当前待审批人和实际处理人", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).toContain("managerCanReadPending");
    expect(service).toContain('application.status === "pending_approval"');
    expect(service).toContain("actor.id === application.target_approver_id");
    expect(service).toContain("managerCanReadProcessed");
    expect(service).toContain("actor.id === application.approver_id");
    expect(service).toContain("Boolean(application.decided_at)");
  });

  test("管理员登记已开具为一次性审计动作", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).toContain("if (application.issued_at)");
    expect(service).toContain("INVOICE_APPLICATION_ALREADY_ISSUED");
  });

  test("申请状态事务统一先取得根合同锁再锁申请行", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).toContain("async function lockApplicationAfterRoot");
    expect(service).toMatch(
      /const rootId = await lockRoot\(client, initial\.contract_id\);\s+const application = await loadApplication\(client, applicationId, true\);/,
    );
  });

  test("正式发票单笔和整组操作均先取得根合同锁再锁业务记录", () => {
    const service = repositoryFile("server/services/contractService.ts");
    const assertLockOrder = (
      start: string,
      end: string | null,
      rowLock: string,
    ) => {
      const startIndex = service.indexOf(start);
      const endIndex = end
        ? service.indexOf(end, startIndex + start.length)
        : service.length;
      const block = service.slice(startIndex, endIndex);
      expect(block.indexOf("lockInvoiceApplicationRoot")).toBeGreaterThan(-1);
      expect(block.indexOf(rowLock)).toBeGreaterThan(-1);
      expect(block.indexOf("lockInvoiceApplicationRoot")).toBeLessThan(
        block.indexOf(rowLock),
      );
    };
    assertLockOrder(
      "export async function confirmContractFinancialRecord",
      "export async function deleteContractFinancialDraft",
      "getLockedFinancialRecord",
    );
    assertLockOrder(
      "export async function deleteContractFinancialDraft",
      "export async function deleteContractFinancialOcrUpload",
      "getLockedFinancialRecord",
    );
    assertLockOrder(
      "export async function reverseContractFinancialRecord",
      "function assertRegistrationEvidence",
      "getLockedFinancialRecord",
    );
    assertLockOrder(
      "export async function confirmContractFinancialRegistration",
      "export async function deleteContractFinancialRegistrationDraft",
      "getLockedFinancialRegistration",
    );
    assertLockOrder(
      "export async function deleteContractFinancialRegistrationDraft",
      "export async function reverseContractFinancialRegistration",
      "getLockedFinancialRegistration",
    );
    assertLockOrder(
      "export async function reverseContractFinancialRegistration",
      null,
      "getLockedFinancialRegistration",
    );
    const routes = repositoryFile("server/routes/contracts.ts");
    const appendStart = routes.indexOf(
      "async function appendFinancialRegistrationSettlementJobs",
    );
    const appendEnd = routes.indexOf(
      "async function appendExternalPaymentJobs",
      appendStart,
    );
    const appendBlock = routes.slice(appendStart, appendEnd);
    expect(
      appendBlock.indexOf("lockInvoiceApplicationRootByFinancialSource"),
    ).toBeGreaterThan(-1);
    expect(
      appendBlock.indexOf("lockInvoiceApplicationRootByFinancialSource"),
    ).toBeLessThan(appendBlock.indexOf("FOR UPDATE"));
  });

  test("数据库使用根合同事务锁且发票删除级联移除分配", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    const schema = repositoryFile("server/db/index.ts");
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("invoice-application:");
    expect(schema).toMatch(
      /invoice_id TEXT NOT NULL REFERENCES contract_invoices\(id\) ON DELETE CASCADE/,
    );
  });

  test("发票新增、单批删除和冲正均在事务内触发额度重算", () => {
    const routes = repositoryFile("server/routes/contracts.ts");
    const service = repositoryFile("server/services/contractService.ts");
    expect(
      routes.match(
        /reconcileInvoiceApplicationAllocations\(\s*client,\s*contractId,?\s*\)/g,
      ),
    ).toHaveLength(3);
    expect(
      service.match(
        /reconcileInvoiceApplicationAllocations\(\s*client,\s*record\.contract_id,?\s*\)/g,
      ),
    ).toHaveLength(3);
    expect(
      service.match(
        /reconcileInvoiceApplicationAllocations\(\s*client,\s*registration\.contract_id,?\s*\)/g,
      ),
    ).toHaveLength(3);
    expect(service).toContain("DELETE FROM contract_invoices");
    expect(service).toContain("SET status = 'reversed'");
  });

  test("材料路由区分预览、完整原件下载和管理员盖章打印", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    expect(routes).toContain("/:id/materials/:materialId/preview");
    expect(routes).toContain("/:id/materials/:materialId/download");
    expect(routes).toContain("/:id/materials/:materialId/print");
    expect(routes).toContain("INVOICE_APPLICATION_ADMIN_ROLES");
    expect(routes).toContain("exportOtherExpensesPrintableFileFromPath");
    expect(routes).toContain("/:id/generated-files/:fileId/preview");
  });

  test("员工开票申请列表路由校验当前与历史视图参数", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    expect(routes).toContain(
      'const rawView = String(req.query.view || "current")',
    );
    expect(routes).toContain('rawScope === "mine"');
    expect(routes).toContain('"current,history".split(",")');
    expect(routes).toContain("员工开票申请列表视图不正确");
    expect(routes).toMatch(
      /scope === "mine"\s*\? rawView\s*: "current"\) as InvoiceApplicationEmployeeListView/,
    );
    expect(routes).toContain('rawScope === "manager_pending"');
    expect(routes).toContain('rawScope === "manager_processed"');
    expect(routes).toContain('? "approval_history"');
  });

  test("合同开票待办覆盖员工退回、总经理审批和管理员后续处理", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(routes).toContain('router.get("/pending-counts"');
    expect(routes).toContain("getInvoiceApplicationPendingCounts(actor(req))");
    expect(service).toContain("status = 'rejected'");
    expect(service).toContain(
      "target_approver_id = $1 AND status = 'pending_approval'",
    );
    expect(service).toContain("status = 'pending_seal'");
    expect(service).toContain(
      "status = 'pending_invoice' AND issued_at IS NULL",
    );
    expect(service).toContain(
      "status = 'pending_invoice' AND issued_at IS NOT NULL",
    );
    expect(service).toContain(
      "COUNT(*) FILTER (WHERE status = 'pending_invoice')",
    );
    expect(service).toContain(
      "const adminPending = pendingSeal + pendingInvoice",
    );
  });

  test("主营三联单上传前识别金额且正式上传与提交再次核对", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(routes).toContain('router.post("/triplicate-inspection"');
    expect(routes).toContain('upload.single("file")');
    expect(routes).toContain("paymentAmountCents");
    expect(routes).toContain("recognizedApplicationAmount:");
    expect(service).toContain("MAIN_TRIPLICATE_AMOUNT_MISMATCH");
    expect(service).toContain("inspectInvoiceApplicationMaterial({");
    expect(service).toContain("主营开票金额由已上传三联单确定");
  });

  test("主营项目在线三联单保存金额快照并生成三页PDF材料", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    const schema = repositoryFile("server/db/index.ts");
    expect(routes).toContain('router.post("/:id/triplicate"');
    expect(routes).toContain("generateMainBusinessTriplicate(");
    expect(service).toContain("renderMainBusinessTriplicatePdf({");
    expect(service).toContain("previousTriplicatePaymentAmount(");
    expect(service).toContain("triplicate_cumulative_payment_snapshot=$6");
    expect(service).toContain("copies: 3");
    expect(service).toContain("is_system_generated_triplicate");
    expect(service).toContain("MAIN_TRIPLICATE_CUMULATIVE_EXCEEDS_CONTRACT");
    expect(service).toContain("MAIN_TRIPLICATE_PREVIOUS_PAYMENT_CHANGED");
    expect(schema).toContain("triplicate_project_name TEXT");
    expect(schema).toContain("triplicate_previous_payment_snapshot");
    expect(schema).toContain("triplicate_cumulative_payment_snapshot");
    expect(schema).toContain("idx_invoice_application_generated_triplicate");
  });

  test("开票申请仅允许申请人在总经理审批前按版本撤回为草稿", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    const schema = repositoryFile("server/db/index.ts");
    expect(routes).toContain('router.post("/:id/withdraw"');
    expect(service).toContain(
      "export async function withdrawInvoiceApplication",
    );
    expect(service).toContain('application.status !== "pending_approval"');
    expect(service).toContain("status='draft'");
    expect(service).toContain('action: "withdraw"');
    expect(service).toContain("applicant_signed_file_id=NULL");
    expect(schema).toContain("'material_deleted', 'submit', 'withdraw'");
  });

  test("系统生成三联单PDF直接内联预览打印且历史Excel继续转换", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    expect(routes).toContain('material.mimeType !== "application/pdf"');
    expect(routes).toContain('material.mimeType === "application/pdf"');
    expect(routes).toContain("inlineDisposition(material.fileName)");
  });

  test("管理员交付前必须上传盖章后三联单并归档为合同附件", () => {
    const routes = repositoryFile("server/routes/invoice-applications.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    const contractRoutes = repositoryFile("server/routes/contracts.ts");
    expect(routes).toContain("req.body?.sealedTriplicateFileId");
    expect(service).toContain("INVOICE_APPLICATION_SEALED_TRIPLICATE_REQUIRED");
    expect(service).toContain(
      "INVOICE_APPLICATION_SEALED_TRIPLICATE_PDF_REQUIRED",
    );
    expect(service).toContain(
      'sealedTriplicate.rows[0].mime_type !== "application/pdf"',
    );
    expect(service).toContain("file_type = 'triplicate'");
    expect(service).toContain("sealedTriplicateFileId");
    const versionedTypes = contractRoutes.slice(
      contractRoutes.indexOf("const versionedSingleCurrentFileTypes"),
      contractRoutes.indexOf("const CONTRACT_CATEGORIES"),
    );
    expect(versionedTypes).not.toContain('"triplicate"');
  });

  test("申请字段精简后服务端只接受专票和普票且开票内容固定为空", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).toContain('invoiceContent: ""');
    expect(service).toContain('"增值税专用发票", "增值税普通发票"');
    expect(service).toContain("发票类型只允许增值税专用发票或普通发票");
    expect(service).not.toContain('row("开票内容"');
    expect(normalizeInvoiceApplicationType("增值税专用发票")).toBe(
      "增值税专用发票",
    );
    expect(normalizeInvoiceApplicationType("增值税普通发票")).toBe(
      "增值税普通发票",
    );
    expect(() => normalizeInvoiceApplicationType("电子发票")).toThrow(
      "只允许增值税专用发票或普通发票",
    );
  });

  test("员工合同台账响应一次性注入批量开票资格", () => {
    const routes = repositoryFile("server/routes/contracts.ts");
    expect(routes).toContain("getInvoiceApplicationEligibilityBatch(");
    expect(routes).toContain("invoiceApplicationEligibility:");
    expect(routes).toContain('currentActor.role === "user"');
  });

  test("服务模块依赖保持单向，不反向导入合同服务", () => {
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).not.toContain('from "./contractService.js"');
  });

  test("公开类型不暴露材料路径和摘要", () => {
    const typeSource = repositoryFile("server/types/invoice-application.ts");
    const materialView = typeSource.slice(
      typeSource.indexOf("export interface InvoiceApplicationMaterialView"),
      typeSource.indexOf("export interface InvoiceApplicationView"),
    );
    expect(materialView).not.toContain("filePath");
    expect(materialView).not.toContain("fileHash");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    expect(service).toContain("INVOICE_APPLICATION_MATERIAL_HASH_MISMATCH");
  });

  test("申请人部门职位按提交事实固化并用于审批流程", () => {
    const schema = repositoryFile("server/db/index.ts");
    const service = repositoryFile("server/services/invoiceApplication.ts");
    const types = repositoryFile("server/types/invoice-application.ts");
    expect(schema).toContain("applicant_department_snapshot");
    expect(schema).toContain("employee.department");
    expect(service).toContain("employee.department, employee.position");
    expect(service).toContain(
      "department: application.applicant_department_snapshot",
    );
    expect(service).toContain("input.applicant.department");
    expect(types).toContain("department: string");
  });
});
