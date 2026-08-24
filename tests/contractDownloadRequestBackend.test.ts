jest.mock("../server/db/index", () => ({
  db: {
    transaction: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));
jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "generated-id"),
}));

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { db, pool } from "../server/db/index";
import {
  acknowledgeContractDownloadResults,
  createContractDownloadRequest,
  deleteWithdrawnContractDownloadRequest,
  decideContractDownloadRequest,
  eligibleContractDownloadFileTypes,
  exportAdminContractDownloadHistory,
  exportManagerContractDownloadHistory,
  getAvailableContractDownloadFiles,
  getContractDownloadRequest,
  getContractDownloadPendingCounts,
  isContractDownloadAdminRole,
  listContractDownloadRequests,
  prepareApprovedContractFileDownload,
  prepareContractDownloadRequestFilePreview,
  resubmitContractDownloadRequest,
  withdrawContractDownloadRequest,
} from "../server/services/contractDownloadRequest";

const projectRoot = path.resolve(__dirname, "..");

describe("员工合同文件下载申请后端", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const requestRow = (overrides: Record<string, unknown> = {}) => ({
    id: "request-1",
    request_no: "HTXZ-20260819-000001",
    contract_id: "contract-1",
    applicant_id: "employee-1",
    applicant_name_snapshot: "员工甲",
    applicant_position_snapshot: "报批报建专员",
    contract_no_snapshot: "HT-001",
    contract_name_snapshot: "测试合同",
    contract_area_snapshot: "朝阳区",
    contract_status_snapshot: "effective",
    purpose: "甲方要求",
    status: "pending_approval",
    chain_id: "request-1",
    previous_request_id: null,
    attempt_no: 1,
    target_approver_id: "gm-1",
    target_approver_name_snapshot: "总经理甲",
    target_approver_position_snapshot: "总经理",
    target_executor_id: "admin-1",
    target_executor_name_snapshot: "管理员甲",
    target_executor_position_snapshot: "管理员",
    application_file_path: "uploads/application.pdf",
    application_file_name: "申请单.pdf",
    application_file_hash: "a".repeat(64),
    applicant_signature_snapshot_path: "uploads/signature.png",
    applicant_signature_snapshot_hash: "b".repeat(64),
    approved_application_file_path: null,
    approved_application_file_hash: null,
    approver_id: null,
    approver_name_snapshot: null,
    approver_position_snapshot: null,
    approver_signature_snapshot_path: null,
    approver_signature_snapshot_hash: null,
    decision_comment: null,
    decided_at: null,
    executor_id: null,
    executor_name_snapshot: null,
    executor_position_snapshot: null,
    processing_note: null,
    processing_started_at: null,
    completed_at: null,
    withdrawn_at: null,
    withdrawal_reason: null,
    created_at: "2026-08-19T01:00:00.000Z",
    updated_at: "2026-08-19T01:00:00.000Z",
    applicant_seen_at: "2026-08-19T01:00:00.000Z",
    version: 1,
    ...overrides,
  });

  it("合同状态与可申请附件使用同一套服务端白名单", () => {
    expect([...eligibleContractDownloadFileTypes("draft")]).toEqual([
      "draft_contract",
      "seal_application",
    ]);
    expect([...eligibleContractDownloadFileTypes("pending_seal")]).toEqual([
      "draft_contract",
      "seal_application",
      "triplicate",
      "payment_request",
    ]);
    expect(
      eligibleContractDownloadFileTypes("effective").has("sealed_contract"),
    ).toBe(true);
  });

  it("管理员组包含管理员、超级管理员和董事长", () => {
    expect(isContractDownloadAdminRole("admin")).toBe(true);
    expect(isContractDownloadAdminRole("super_admin")).toBe(true);
    expect(isContractDownloadAdminRole("chairman")).toBe(true);
    expect(isContractDownloadAdminRole("general_manager")).toBe(false);
    expect(isContractDownloadAdminRole("user")).toBe(false);
  });

  it("普通员工不能通过可选附件接口读取行政区域为全部的合同", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: "contract-global",
          contract_no: "HT-001",
          business_contract_no: null,
          title: "全域合同",
          project_name: null,
          area: "全部",
          root_area: "全部",
          status: "effective",
        },
      ],
    });

    await expect(
      getAvailableContractDownloadFiles(
        { id: "employee-1", role: "user" },
        "contract-global",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "EMPLOYEE_GLOBAL_CONTRACT_FORBIDDEN",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("具体区子协议的根合同为全部时仍禁止员工读取", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: "supplement-hidden",
          contract_no: "HT-002",
          business_contract_no: null,
          title: "子协议",
          project_name: null,
          area: "朝阳区",
          root_area: "全部",
          status: "effective",
        },
      ],
    });
    await expect(
      getAvailableContractDownloadFiles(
        { id: "employee-1", role: "user" },
        "supplement-hidden",
      ),
    ).rejects.toMatchObject({ code: "EMPLOYEE_GLOBAL_CONTRACT_FORBIDDEN" });
  });

  it("主合同可选附件包含同一根合同链的补充协议文件", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "contract-1",
            contract_no: "HT-001",
            business_contract_no: null,
            title: "主合同",
            project_name: null,
            area: "朝阳区",
            root_id: "contract-1",
            root_area: "朝阳区",
            status: "effective",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "supplement-file-1",
            contract_id: "supplement-1",
            file_type: "sealed_contract",
            file_name: "补充协议盖章件.pdf",
            file_path: "uploads/contracts/supplement.pdf",
            file_size: 2048,
            mime_type: "application/pdf",
            file_hash: "a".repeat(64),
            created_at: "2026-08-20T00:00:00.000Z",
          },
        ],
      });

    await expect(
      getAvailableContractDownloadFiles(
        { id: "employee-1", role: "user" },
        "contract-1",
      ),
    ).resolves.toMatchObject({
      contract: { id: "contract-1" },
      files: [{ id: "supplement-file-1" }],
    });

    const fileQuery = (pool.query as jest.Mock).mock.calls[1];
    expect(String(fileQuery[0])).toContain(
      "COALESCE(owner.root_contract_id, owner.id) = $1",
    );
    expect(String(fileQuery[0])).toContain("owner.is_deleted = FALSE");
    expect(String(fileQuery[0])).toContain("file.is_current = TRUE");
    expect(String(fileQuery[0])).toContain(
      "sealed_file.file_type = 'sealed_contract'",
    );
    expect(String(fileQuery[0])).toContain("sealed_file.is_current = TRUE");
    expect(fileQuery[1]).toEqual(["contract-1"]);
  });

  it("提交下载申请时跨根合同附件必须拒绝", async () => {
    const clientQuery = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM users u")) {
        return {
          rows: [
            {
              id: "employee-1",
              name: "员工甲",
              role: "user",
              position: "报批报建专员",
            },
          ],
        };
      }
      if (sql.includes("FROM contracts contract")) {
        return {
          rows: [
            {
              id: "contract-1",
              contract_no: "HT-001",
              business_contract_no: null,
              title: "主合同",
              project_name: null,
              area: "朝阳区",
              root_id: "contract-1",
              root_area: "朝阳区",
              status: "effective",
            },
          ],
        };
      }
      if (sql.includes("FROM contract_files file")) {
        expect(sql).toContain(
          "COALESCE(owner.root_contract_id, owner.id) = $1",
        );
        expect(sql).toContain("owner.relation_type = 'main'");
        expect(sql).toContain("sealed_file.file_type = 'sealed_contract'");
        expect(params).toEqual(["contract-1", ["other-root-file"]]);
        return { rows: [] };
      }
      return { rows: [] };
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );

    await expect(
      createContractDownloadRequest(
        { id: "employee-1", role: "user" },
        {
          contractId: "contract-1",
          purpose: "项目履约查阅",
          fileIds: ["other-root-file"],
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DOWNLOAD_FILE_SELECTION_INVALID",
    });
  });

  it("申请后合同改成全部时员工不能继续预览合同文件", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "request-1",
            status: "pending_approval",
            applicant_id: "employee-1",
            target_approver_id: "gm-1",
            contract_id: "contract-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "contract-1",
            contract_no: "HT-003",
            business_contract_no: null,
            title: "已调整范围合同",
            project_name: null,
            area: "朝阳区",
            root_id: "root-1",
            root_area: "全部",
            status: "effective",
          },
        ],
      });
    await expect(
      prepareContractDownloadRequestFilePreview(
        { id: "employee-1", role: "user" },
        "request-1",
        "request-file-1",
      ),
    ).rejects.toMatchObject({ code: "EMPLOYEE_GLOBAL_CONTRACT_FORBIDDEN" });
  });

  it("员工不能调用管理员指定文件下载能力", async () => {
    await expect(
      prepareApprovedContractFileDownload(
        { id: "employee-1", role: "user" },
        "request-1",
        "request-file-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_ADMIN_ONLY",
    });
  });

  it("总经理待办和管理员待办默认不会混入已处理历史", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const managerResult = await listContractDownloadRequests(
      { id: "gm-1", role: "general_manager" },
      "approval",
    );
    expect(managerResult).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "status = 'pending_approval'",
    );

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await listContractDownloadRequests(
      { id: "admin-1", role: "admin" },
      "admin",
    );
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "status IN ('approved', 'processing')",
    );
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "target_executor_id",
    );
  });

  it("总经理审批历史只按本人实际审批记录分页并按决定时间倒序", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 12 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      listContractDownloadRequests(
        { id: "gm-1", role: "general_manager" },
        "approval_history",
        undefined,
        2,
        5,
      ),
    ).resolves.toEqual({
      items: [],
      total: 12,
      page: 2,
      pageSize: 5,
    });

    const countCall = (pool.query as jest.Mock).mock.calls[0];
    const listCall = (pool.query as jest.Mock).mock.calls[1];
    expect(String(countCall[0])).toContain("approver_id = $1");
    expect(String(countCall[0])).not.toContain("target_approver_id = $1");
    expect(String(countCall[0])).toContain(
      "status IN ('approved', 'processing', 'completed')",
    );
    expect(String(countCall[0])).not.toContain("'rejected'");
    expect(countCall[1]).toEqual(["gm-1"]);
    expect(String(listCall[0])).toContain(
      "ORDER BY decided_at DESC, updated_at DESC, id DESC",
    );
    expect(listCall[1]).toEqual(["gm-1", 5, 5]);
  });

  it("总经理下载审批搜索在服务端计数和分页前统一生效", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listContractDownloadRequests(
      { id: "gm-1", role: "general_manager" },
      "approval",
      undefined,
      1,
      20,
      "示例合同",
    );

    const countCall = (pool.query as jest.Mock).mock.calls[0];
    const listCall = (pool.query as jest.Mock).mock.calls[1];
    expect(String(countCall[0])).toContain("contract_name_snapshot ILIKE $2");
    expect(String(countCall[0])).toContain("contract_no_snapshot ILIKE $2");
    expect(String(countCall[0])).toContain("applicant_name_snapshot ILIKE $2");
    expect(countCall[1]).toEqual(["gm-1", "%示例合同%"]);
    expect(listCall[1]).toEqual(["gm-1", "%示例合同%", 20, 0]);
  });

  it("非总经理和未处理状态不能读取总经理审批历史", async () => {
    await expect(
      listContractDownloadRequests(
        { id: "admin-1", role: "admin" },
        "approval_history",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listContractDownloadRequests(
        { id: "gm-1", role: "general_manager" },
        "approval_history",
        "pending_approval",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listContractDownloadRequests(
        { id: "gm-1", role: "general_manager" },
        "approval_history",
        "rejected",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("管理员处理历史只按本人实际办结记录分页并按完成时间倒序", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 7 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      listContractDownloadRequests(
        { id: "admin-2", role: "admin" },
        "admin_history",
        undefined,
        3,
        10,
        "合同甲",
      ),
    ).resolves.toEqual({
      items: [],
      total: 7,
      page: 3,
      pageSize: 10,
    });

    const countCall = (pool.query as jest.Mock).mock.calls[0];
    const listCall = (pool.query as jest.Mock).mock.calls[1];
    expect(String(countCall[0])).toContain("executor_id = $1");
    expect(String(countCall[0])).not.toContain("target_executor_id = $1");
    expect(String(countCall[0])).toContain("status = 'completed'");
    expect(String(countCall[0])).toContain("contract_name_snapshot ILIKE $2");
    expect(countCall[1]).toEqual(["admin-2", "%合同甲%"]);
    expect(String(listCall[0])).toContain(
      "ORDER BY completed_at DESC, updated_at DESC, id DESC",
    );
    expect(listCall[1]).toEqual(["admin-2", "%合同甲%", 10, 20]);
  });

  it("总经理按本人审批范围和关键词导出包含北京时间的Excel", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...requestRow({
              status: "approved",
              approver_id: "gm-1",
              approver_name_snapshot: "总经理甲",
              decided_at: "2026-08-19T02:00:00.000Z",
            }),
            file_count: 1,
          },
        ],
      });

    const exported = await exportManagerContractDownloadHistory(
      { id: "gm-1", role: "general_manager" },
      "合同甲",
    );
    const countCall = (pool.query as jest.Mock).mock.calls[0];
    const listCall = (pool.query as jest.Mock).mock.calls[1];
    expect(String(countCall[0])).toContain("request.approver_id = $1");
    expect(String(countCall[0])).toContain(
      "request.status IN ('approved', 'processing', 'completed')",
    );
    expect(countCall[1]).toEqual(["gm-1", "%合同甲%"]);
    expect(String(listCall[0])).toContain(
      "request.decided_at DESC, request.updated_at DESC, request.id DESC",
    );

    const workbook = XLSX.read(exported.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
      worksheet,
      { defval: "" },
    );
    expect(workbook.SheetNames[0]).toBe("合同下载审批记录");
    expect(rows[0]).toMatchObject({
      申请时间: "2026-08-19 09:00:00",
      审批时间: "2026-08-19 10:00:00",
      附件数量: 1,
    });
    expect(exported.fileName).toContain("合同下载审批记录");
  });

  it("管理员按本人可见范围和关键词导出安全Excel并使用北京时间", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...requestRow({
              request_no: "=危险编号",
              contract_no_snapshot: "+危险合同号",
              contract_name_snapshot: "-危险合同名",
              applicant_name_snapshot: "@危险申请人",
              purpose: '=HYPERLINK("https://example.com")',
              status: "completed",
              approver_id: "gm-1",
              approver_name_snapshot: "总经理甲",
              decided_at: "2026-08-19T02:00:00.000Z",
              executor_id: "admin-2",
              executor_name_snapshot: "管理员甲",
              processing_started_at: "2026-08-19T02:30:00.000Z",
              completed_at: "2026-08-19T03:00:00.000Z",
              processing_note: "+处理说明",
            }),
            file_count: 3,
          },
        ],
      });

    const exported = await exportAdminContractDownloadHistory(
      { id: "admin-2", role: "admin" },
      "测试合同",
    );
    const countCall = (pool.query as jest.Mock).mock.calls[0];
    const listCall = (pool.query as jest.Mock).mock.calls[1];
    expect(String(countCall[0])).toContain("request.executor_id = $1");
    expect(String(countCall[0])).toContain("request.status = 'completed'");
    expect(String(countCall[0])).toContain("contract_name_snapshot ILIKE $2");
    expect(countCall[1]).toEqual(["admin-2", "%测试合同%"]);
    expect(listCall[1]).toEqual(["admin-2", "%测试合同%"]);

    const workbook = XLSX.read(exported.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
      worksheet,
      { defval: "" },
    );
    expect(rows[0]).toMatchObject({
      申请编号: "'=危险编号",
      合同编号: "'+危险合同号",
      合同名称: "'-危险合同名",
      申请人: "'@危险申请人",
      下载用途: '\'=HYPERLINK("https://example.com")',
      申请时间: "2026-08-19 09:00:00",
      审批时间: "2026-08-19 10:00:00",
      处理开始时间: "2026-08-19 10:30:00",
      完成时间: "2026-08-19 11:00:00",
      处理说明: "'+处理说明",
      附件数量: 3,
    });
    expect(exported.mimeType).toContain("spreadsheetml.sheet");
  });

  it("非实际管理员不能导出且超过五千条时要求缩小范围", async () => {
    await expect(
      exportManagerContractDownloadHistory(
        { id: "admin-2", role: "admin" },
        "",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_MANAGER_EXPORT_FORBIDDEN",
    });
    await expect(
      exportAdminContractDownloadHistory(
        { id: "super-1", role: "super_admin" },
        "",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_ADMIN_EXPORT_FORBIDDEN",
    });
    expect(pool.query).not.toHaveBeenCalled();

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ count: 5001 }],
    });
    await expect(
      exportAdminContractDownloadHistory({ id: "admin-2", role: "admin" }, ""),
    ).rejects.toMatchObject({
      code: "CONTRACT_DOWNLOAD_EXPORT_TOO_LARGE",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("员工当前申请与历史申请按最新未完成和最终完成记录分开分页", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listContractDownloadRequests(
      { id: "employee-1", role: "user" },
      "mine",
    );
    const currentSql = String((pool.query as jest.Mock).mock.calls[0][0]);
    expect(currentSql).toContain("applicant_id = $1");
    expect(currentSql).toContain("NOT EXISTS");
    expect(currentSql).toContain("status <> 'completed'");

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 11 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      listContractDownloadRequests(
        { id: "employee-1", role: "user" },
        "mine_history",
        undefined,
        2,
        10,
      ),
    ).resolves.toEqual({
      items: [],
      total: 11,
      page: 2,
      pageSize: 10,
    });
    const historySql = String((pool.query as jest.Mock).mock.calls[0][0]);
    const historyListSql = String((pool.query as jest.Mock).mock.calls[1][0]);
    expect(historySql).toContain("applicant_id = $1");
    expect(historySql).toContain("status = 'completed'");
    expect(historySql).not.toContain("OR EXISTS");
    expect(historyListSql).toContain(
      "ORDER BY updated_at DESC, created_at DESC, id DESC",
    );
    expect((pool.query as jest.Mock).mock.calls[1][1]).toEqual([
      "employee-1",
      10,
      10,
    ]);
  });

  it("非员工不能读取员工历史申请", async () => {
    await expect(
      listContractDownloadRequests(
        { id: "gm-1", role: "general_manager" },
        "mine_history",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listContractDownloadRequests(
        { id: "employee-1", role: "user" },
        "mine_history",
        "rejected",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("非管理员和未完成状态不能读取管理员处理历史", async () => {
    await expect(
      listContractDownloadRequests(
        { id: "super-admin-1", role: "super_admin" },
        "admin_history",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      listContractDownloadRequests(
        { id: "admin-1", role: "admin" },
        "admin_history",
        "processing",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("已完成下载详情只向实际执行管理员开放并过滤其他管理员尝试", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        requestRow({
          status: "completed",
          target_executor_id: "admin-1",
          executor_id: "admin-2",
          completed_at: "2026-08-19T03:00:00.000Z",
        }),
      ],
    });
    await expect(
      getContractDownloadRequest({ id: "admin-1", role: "admin" }, "request-1"),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          requestRow({
            status: "completed",
            target_executor_id: "admin-1",
            executor_id: "admin-2",
            completed_at: "2026-08-19T03:00:00.000Z",
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ attempt_no: 2 }] });

    await expect(
      getContractDownloadRequest({ id: "admin-2", role: "admin" }, "request-1"),
    ).resolves.toMatchObject({ id: "request-1", status: "completed" });

    const chainCall = (pool.query as jest.Mock).mock.calls.find(([sql]) =>
      String(sql).includes("INNER JOIN contract_download_requests request"),
    );
    expect(String(chainCall?.[0])).toContain("request.target_executor_id = $2");
    expect(String(chainCall?.[0])).toContain("request.executor_id = $2");
    expect(chainCall?.[1]).toEqual(["request-1", "admin-2"]);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        requestRow({
          status: "completed",
          executor_id: "chairman-1",
          completed_at: "2026-08-19T03:00:00.000Z",
        }),
      ],
    });
    await expect(
      getContractDownloadRequest(
        { id: "chairman-1", role: "chairman" },
        "request-1",
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN" });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("重提链详情只向实际处理人开放并过滤其他总经理的新尝试", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        requestRow({
          status: "approved",
          approver_id: "gm-2",
          target_approver_id: "gm-1",
        }),
      ],
    });
    await expect(
      getContractDownloadRequest(
        { id: "gm-1", role: "general_manager" },
        "request-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN",
    });
    expect(pool.query).toHaveBeenCalledTimes(1);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          requestRow({
            status: "rejected",
            approver_id: "gm-1",
            decided_at: "2026-08-19T02:00:00.000Z",
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ attempt_no: 2 }] });

    await expect(
      getContractDownloadRequest(
        { id: "gm-1", role: "general_manager" },
        "request-1",
      ),
    ).resolves.toMatchObject({ id: "request-1", status: "rejected" });

    const chainCall = (pool.query as jest.Mock).mock.calls.find(([sql]) =>
      String(sql).includes("INNER JOIN contract_download_requests request"),
    );
    expect(String(chainCall?.[0])).toContain("request.target_approver_id = $2");
    expect(String(chainCall?.[0])).toContain("request.approver_id = $2");
    expect(chainCall?.[1]).toEqual(["request-1", "gm-1"]);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [requestRow({ target_approver_id: "gm-2" })],
    });
    await expect(
      getContractDownloadRequest(
        { id: "gm-1", role: "general_manager" },
        "request-1",
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN" });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("我的下载申请按申请链只返回最新一次尝试", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    await listContractDownloadRequests(
      { id: "employee-1", role: "user" },
      "mine",
    );
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "successor.previous_request_id = contract_download_requests.id",
    );
  });

  it("下载申请提醒按员工、总经理和指定管理员分别统计", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ count: 2 }],
    });
    await expect(
      getContractDownloadPendingCounts({ id: "employee-1", role: "user" }),
    ).resolves.toEqual({
      unreadResults: 2,
      managerPending: 0,
      executorPending: 0,
      total: 2,
    });
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "updated_at > applicant_seen_at",
    );
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual(["employee-1"]);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ count: 3 }],
    });
    await expect(
      getContractDownloadPendingCounts({
        id: "gm-1",
        role: "general_manager",
      }),
    ).resolves.toMatchObject({ managerPending: 3, total: 3 });
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "target_approver_id = $1",
    );
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "status = 'pending_approval'",
    );

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ count: 4 }],
    });
    await expect(
      getContractDownloadPendingCounts({ id: "admin-1", role: "admin" }),
    ).resolves.toMatchObject({ executorPending: 4, total: 4 });
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "target_executor_id = $1",
    );
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain(
      "status IN ('approved', 'processing')",
    );

    (pool.query as jest.Mock).mockClear();
    await expect(
      getContractDownloadPendingCounts({ id: "boss-1", role: "boss" }),
    ).resolves.toEqual({
      unreadResults: 0,
      managerPending: 0,
      executorPending: 0,
      total: 0,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("总经理驳回会作为非待审批结果计入申请人员工未读", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ count: 1 }],
    });
    await expect(
      getContractDownloadPendingCounts({ id: "employee-1", role: "user" }),
    ).resolves.toMatchObject({ unreadResults: 1, total: 1 });
    const unreadSql = String((pool.query as jest.Mock).mock.calls[0][0]);
    expect(unreadSql).toContain("status <> 'pending_approval'");
    expect(unreadSql).toContain("updated_at > applicant_seen_at");
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual(["employee-1"]);
  });

  it("员工只确认当前页指定结果，分页外未读不会被清除且编号会去重", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ acknowledged_count: 2, unread_results: 1 }],
      rowCount: 1,
    });
    await expect(
      acknowledgeContractDownloadResults({ id: "employee-1", role: "user" }, [
        "request-1",
        "request-1",
        "request-2",
      ]),
    ).resolves.toEqual({ acknowledgedCount: 2, unreadResults: 1 });
    const acknowledgeSql = String((pool.query as jest.Mock).mock.calls[0][0]);
    expect(acknowledgeSql).toContain("SET applicant_seen_at = updated_at");
    expect(acknowledgeSql).toContain("applicant_id = $1");
    expect(acknowledgeSql).toContain("id = ANY($2::text[])");
    expect(acknowledgeSql).toContain("status <> 'pending_approval'");
    expect(acknowledgeSql).toContain("updated_at > applicant_seen_at");
    expect(acknowledgeSql).toContain(
      "NOT EXISTS (\n             SELECT 1 FROM acknowledged",
    );
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual([
      "employee-1",
      ["request-1", "request-2"],
    ]);

    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ acknowledged_count: 0, unread_results: 1 }],
      rowCount: 1,
    });
    await expect(
      acknowledgeContractDownloadResults({ id: "employee-1", role: "user" }, [
        "other-employee-request",
      ]),
    ).resolves.toEqual({ acknowledgedCount: 0, unreadResults: 1 });
    expect(String((pool.query as jest.Mock).mock.calls[0][0])).toContain(
      "applicant_id = $1",
    );
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual([
      "employee-1",
      ["other-employee-request"],
    ]);

    (pool.query as jest.Mock).mockClear();
    await expect(
      acknowledgeContractDownloadResults(
        { id: "gm-1", role: "general_manager" },
        ["request-1"],
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_EMPLOYEE_ONLY",
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("确认已读必须提供 1 至 100 个申请编号，不能无参清空全部未读", async () => {
    await expect(
      acknowledgeContractDownloadResults(
        { id: "employee-1", role: "user" },
        undefined,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CONTRACT_DOWNLOAD_ACK_REQUEST_IDS_REQUIRED",
    });
    await expect(
      acknowledgeContractDownloadResults(
        { id: "employee-1", role: "user" },
        [],
      ),
    ).rejects.toMatchObject({
      code: "CONTRACT_DOWNLOAD_ACK_REQUEST_IDS_REQUIRED",
    });
    await expect(
      acknowledgeContractDownloadResults(
        { id: "employee-1", role: "user" },
        Array.from({ length: 101 }, (_, index) => `request-${index}`),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CONTRACT_DOWNLOAD_ACK_REQUEST_IDS_LIMIT",
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("申请人可在总经理审批前撤回，撤回不产生本人未读并完整写入审计", async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [requestRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "employee-1",
            name: "员工甲",
            role: "user",
            position: "报批报建专员",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    const withdrawn = requestRow({
      status: "withdrawn",
      withdrawn_at: "2026-08-19T02:00:00.000Z",
      withdrawal_reason: "暂不需要",
      updated_at: "2026-08-19T02:00:00.000Z",
      applicant_seen_at: "2026-08-19T02:00:00.000Z",
      version: 2,
    });
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [withdrawn] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-withdraw",
            request_id: "request-1",
            request_no: "HTXZ-20260819-000001",
            attempt_no: 1,
            action: "withdraw",
            actor_id: "employee-1",
            actor_name_snapshot: "员工甲",
            actor_position_snapshot: "报批报建专员",
            from_status: "pending_approval",
            to_status: "withdrawn",
            comment: "暂不需要",
            metadata_json: {},
            created_at: "2026-08-19T02:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ attempt_no: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "request-1" }] });

    const result = await withdrawContractDownloadRequest(
      { id: "employee-1", role: "user" },
      "request-1",
      "暂不需要",
      1,
    );

    expect(result).toMatchObject({
      status: "withdrawn",
      canWithdraw: false,
      canResubmit: true,
      canDelete: true,
      chainHistory: [{ action: "withdraw", attemptNo: 1 }],
    });
    expect(clientQuery.mock.calls[2][0]).toContain("applicant_seen_at = $2");
    expect(clientQuery.mock.calls[3][1]).toContain("withdraw");
  });

  it("撤回与审批使用状态和版本门禁，非待审批申请不能撤回", async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({
      rows: [requestRow({ status: "approved", version: 2 })],
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    await expect(
      withdrawContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        null,
        2,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DOWNLOAD_WITHDRAW_PENDING_ONLY",
    });
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it("本人只能删除已撤回的最新叶子并显式清理子记录后保留合同审计边界", async () => {
    const withdrawn = requestRow({
      status: "withdrawn",
      withdrawn_at: "2026-08-19T02:00:00.000Z",
      version: 2,
      application_file_path:
        "uploads/contract-download-requests/request-1/submitted-application.pdf",
      applicant_signature_snapshot_path:
        "uploads/contract-download-requests/request-1/submitted-signature.png",
    });
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [withdrawn] })
      .mockResolvedValueOnce({ rows: [{ has_successor: false }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "employee-1",
            name: "员工甲",
            role: "user",
            position: "报批报建专员",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );

    await expect(
      deleteWithdrawnContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        2,
      ),
    ).resolves.toEqual({
      deleted: true,
      storedFilePaths: [
        "uploads/contract-download-requests/request-1/submitted-application.pdf",
        "uploads/contract-download-requests/request-1/submitted-signature.png",
      ],
    });
    const sqlCalls = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls[4]).toContain("download_request_deleted");
    expect(sqlCalls[5]).toContain(
      "DELETE FROM contract_download_request_audit_logs",
    );
    expect(sqlCalls[6]).toContain(
      "DELETE FROM contract_download_request_files",
    );
    expect(sqlCalls[7]).toContain("DELETE FROM contract_download_requests");
    expect(sqlCalls.join("\n")).not.toContain("DELETE FROM user_signatures");
  });

  it("撤回申请存在后继或审批处理事实时禁止删除历史链节点", async () => {
    const withdrawn = requestRow({
      status: "withdrawn",
      withdrawn_at: "2026-08-19T02:00:00.000Z",
      version: 2,
      application_file_path:
        "uploads/contract-download-requests/request-1/submitted-application.pdf",
      applicant_signature_snapshot_path:
        "uploads/contract-download-requests/request-1/submitted-signature.png",
    });
    const successorClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [withdrawn] })
        .mockResolvedValueOnce({ rows: [{ has_successor: true }] }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: typeof successorClient) => Promise<unknown>) =>
        handler(successorClient),
    );
    await expect(
      deleteWithdrawnContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        2,
      ),
    ).rejects.toMatchObject({
      code: "CONTRACT_DOWNLOAD_DELETE_NOT_LATEST_LEAF",
    });

    const processedClient = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          requestRow({
            status: "withdrawn",
            withdrawn_at: "2026-08-19T02:00:00.000Z",
            version: 2,
            approver_id: "gm-1",
            decided_at: "2026-08-19T02:30:00.000Z",
          }),
        ],
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: typeof processedClient) => Promise<unknown>) =>
        handler(processedClient),
    );
    await expect(
      deleteWithdrawnContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        2,
      ),
    ).rejects.toMatchObject({
      code: "CONTRACT_DOWNLOAD_DELETE_HAS_PROCESSING_FACT",
    });
  });

  it("总经理批准后生成批准版申请单和本人签名快照并持久化路径与摘要", async () => {
    const requestId = `approval-request-${process.pid}`;
    const fixtureDirectory = path.join(
      projectRoot,
      "uploads",
      `contract-download-approval-${process.pid}`,
    );
    const applicantSignaturePath = path.join(
      fixtureDirectory,
      "applicant-signature.png",
    );
    const managerSignaturePath = path.join(
      fixtureDirectory,
      "manager-signature.png",
    );
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    for (const [filePath, strokeColor] of [
      [applicantSignaturePath, "#111111"],
      [managerSignaturePath, "#0f766e"],
    ] as const) {
      const canvas = createCanvas(240, 100);
      const context = canvas.getContext("2d");
      context.strokeStyle = strokeColor;
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(18, 72);
      context.bezierCurveTo(58, 8, 124, 94, 222, 28);
      context.stroke();
      fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    }
    const storedApplicantSignaturePath = path.relative(
      projectRoot,
      applicantSignaturePath,
    );
    const storedManagerSignaturePath = path.relative(
      projectRoot,
      managerSignaturePath,
    );
    const applicantSignatureHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(applicantSignaturePath))
      .digest("hex");
    const generatedPdfBytes = Uint8Array.from([37, 80, 68, 70, 45, 84]);
    const expectedPdfHash = crypto
      .createHash("sha256")
      .update(generatedPdfBytes)
      .digest("hex");
    const pdfDocumentSpy = jest.spyOn(PDFDocument, "create").mockResolvedValue({
      setTitle: jest.fn(),
      setSubject: jest.fn(),
      addPage: jest.fn(() => ({ drawImage: jest.fn() })),
      embedPng: jest.fn(async () => ({})),
      save: jest.fn(async () => generatedPdfBytes),
    } as never);
    const source = requestRow({
      id: requestId,
      chain_id: requestId,
      applicant_signature_snapshot_path: storedApplicantSignaturePath,
      applicant_signature_snapshot_hash: applicantSignatureHash,
    });
    const requestFile = {
      id: "request-file-1",
      request_id: requestId,
      contract_file_id: "contract-file-1",
      file_type_snapshot: "sealed_contract",
      file_name_snapshot: "盖章合同.pdf",
      file_path_snapshot: "uploads/contracts/sealed-contract.pdf",
      file_hash_snapshot: "c".repeat(64),
      file_size_snapshot: 1024,
      mime_type_snapshot: "application/pdf",
      downloaded_by: null,
      downloaded_at: null,
      created_at: "2026-08-19T01:00:00.000Z",
    };
    let updateParameters: unknown[] = [];
    const clientQuery = jest.fn(
      async (sqlValue: unknown, parameters?: unknown[]) => {
        const sql = String(sqlValue);
        if (sql.includes("SELECT * FROM contract_download_requests")) {
          return { rows: [source] };
        }
        if (sql.includes("SELECT u.id, u.name, u.role")) {
          return {
            rows: [
              {
                id: "gm-1",
                name: "总经理甲",
                role: "general_manager",
                position: "总经理",
              },
            ],
          };
        }
        if (sql.includes("FROM contracts contract")) {
          return {
            rows: [
              {
                id: "contract-1",
                contract_no: "HT-001",
                business_contract_no: "YW-001",
                title: "测试合同",
                project_name: "测试项目",
                area: "朝阳区",
                root_id: "contract-1",
                root_area: "朝阳区",
                status: "effective",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_download_request_files")) {
          return { rows: [requestFile] };
        }
        if (sql.includes("FROM user_signatures")) {
          return { rows: [{ signature_path: storedManagerSignaturePath }] };
        }
        if (sql.includes("UPDATE contract_download_requests SET")) {
          updateParameters = parameters || [];
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO contract_download_request_audit_logs")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`测试未处理的数据库查询：${sql}`);
      },
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    (pool.query as jest.Mock).mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      const finalRow = requestRow({
        ...source,
        status: "approved",
        approver_id: "gm-1",
        approver_name_snapshot: "总经理甲",
        approver_position_snapshot: "总经理",
        approver_signature_snapshot_path: updateParameters[9],
        approver_signature_snapshot_hash: updateParameters[10],
        approved_application_file_path: updateParameters[7],
        approved_application_file_hash: updateParameters[8],
        decision_comment: "同意下载",
        decided_at: updateParameters[6],
        updated_at: updateParameters[6],
        version: 2,
      });
      if (sql.includes("SELECT * FROM contract_download_requests")) {
        return { rows: [finalRow] };
      }
      if (sql.includes("FROM contract_download_request_files")) {
        return { rows: [requestFile] };
      }
      if (sql.includes("INNER JOIN contract_download_requests")) {
        return { rows: [] };
      }
      if (sql.includes("FROM contract_download_request_audit_logs")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT attempt_no")) {
        return { rows: [{ attempt_no: 1 }] };
      }
      throw new Error(`测试未处理的结果查询：${sql}`);
    });

    let approvedPdfPath = "";
    let managerSnapshotPath = "";
    try {
      await expect(
        decideContractDownloadRequest(
          { id: "gm-1", role: "general_manager" },
          requestId,
          "approve",
          "同意下载",
          1,
        ),
      ).resolves.toMatchObject({
        id: requestId,
        status: "approved",
        approver: { comment: "同意下载" },
      });

      expect(pdfDocumentSpy).toHaveBeenCalledTimes(1);
      expect(
        clientQuery.mock.calls.some(([sql]) =>
          String(sql).includes("FROM user_signatures"),
        ),
      ).toBe(true);
      expect(updateParameters.slice(0, 6)).toEqual([
        requestId,
        "approved",
        "gm-1",
        "总经理甲",
        "总经理",
        "同意下载",
      ]);
      approvedPdfPath = path.resolve(projectRoot, String(updateParameters[7]));
      managerSnapshotPath = path.resolve(
        projectRoot,
        String(updateParameters[9]),
      );
      expect(path.basename(approvedPdfPath)).toMatch(
        /^approved-application-[0-9a-f]{16}\.pdf$/,
      );
      expect(path.basename(managerSnapshotPath)).toMatch(
        /^approved-signature-[0-9a-f]{16}\.png$/,
      );
      expect(fs.existsSync(approvedPdfPath)).toBe(true);
      expect(fs.existsSync(managerSnapshotPath)).toBe(true);
      expect(updateParameters[8]).toBe(expectedPdfHash);
      expect(updateParameters[8]).toBe(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(approvedPdfPath))
          .digest("hex"),
      );
      expect(updateParameters[10]).toBe(
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(managerSnapshotPath))
          .digest("hex"),
      );
      expect(String(updateParameters[7])).toContain("approved-application-");
      expect(String(updateParameters[9])).toContain("approved-signature-");
    } finally {
      pdfDocumentSpy.mockRestore();
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      fs.rmSync(
        path.join(
          projectRoot,
          "uploads",
          "contract-download-requests",
          "2026",
          "08",
          "19",
          requestId,
        ),
        { recursive: true, force: true },
      );
    }
  });

  it("总经理驳回只保存决定与原因，不生成批准版申请单或签名快照", async () => {
    const source = requestRow();
    let updateParameters: unknown[] = [];
    const clientQuery = jest.fn(
      async (sqlValue: unknown, parameters?: unknown[]) => {
        const sql = String(sqlValue);
        if (sql.includes("SELECT * FROM contract_download_requests")) {
          return { rows: [source] };
        }
        if (sql.includes("SELECT u.id, u.name, u.role")) {
          return {
            rows: [
              {
                id: "gm-1",
                name: "总经理甲",
                role: "general_manager",
                position: "总经理",
              },
            ],
          };
        }
        if (sql.includes("UPDATE contract_download_requests SET")) {
          updateParameters = parameters || [];
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO contract_download_request_audit_logs")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`测试未处理的数据库查询：${sql}`);
      },
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    (pool.query as jest.Mock).mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      const finalRow = requestRow({
        status: "rejected",
        approver_id: "gm-1",
        approver_name_snapshot: "总经理甲",
        approver_position_snapshot: "总经理",
        decision_comment: "用途说明不完整",
        decided_at: updateParameters[6],
        updated_at: updateParameters[6],
        version: 2,
      });
      if (sql.includes("SELECT * FROM contract_download_requests")) {
        return { rows: [finalRow] };
      }
      if (sql.includes("FROM contract_download_request_files")) {
        return { rows: [] };
      }
      if (sql.includes("INNER JOIN contract_download_requests")) {
        return { rows: [] };
      }
      if (sql.includes("FROM contract_download_request_audit_logs")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT attempt_no")) {
        return { rows: [{ attempt_no: 1 }] };
      }
      throw new Error(`测试未处理的结果查询：${sql}`);
    });
    const pdfDocumentSpy = jest.spyOn(PDFDocument, "create");
    try {
      await expect(
        decideContractDownloadRequest(
          { id: "gm-1", role: "general_manager" },
          "request-1",
          "reject",
          "用途说明不完整",
          1,
        ),
      ).resolves.toMatchObject({
        id: "request-1",
        status: "rejected",
        approver: { comment: "用途说明不完整" },
      });

      expect(pdfDocumentSpy).not.toHaveBeenCalled();
      expect(
        clientQuery.mock.calls.some(([sql]) =>
          String(sql).includes("FROM user_signatures"),
        ),
      ).toBe(false);
      expect(updateParameters.slice(0, 7)).toEqual([
        "request-1",
        "rejected",
        "gm-1",
        "总经理甲",
        "总经理",
        "用途说明不完整",
        expect.any(String),
      ]);
      expect(updateParameters.slice(7, 11)).toEqual([null, null, null, null]);
      const auditCall = clientQuery.mock.calls.find(
        ([sql, parameters]) =>
          String(sql).includes("contract_download_request_audit_logs") &&
          Array.isArray(parameters) &&
          parameters.includes("reject"),
      );
      expect(auditCall?.[1]).toEqual(
        expect.arrayContaining([
          "request-1",
          "reject",
          "pending_approval",
          "rejected",
          "用途说明不完整",
        ]),
      );
    } finally {
      pdfDocumentSpy.mockRestore();
    }
  });

  it("只有驳回或撤回的最新申请允许重提，已有后继时拒绝重复重提", async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [requestRow({ status: "rejected", version: 2 })],
      })
      .mockResolvedValueOnce({ rows: [{ id: "request-2" }] });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    await expect(
      resubmitContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        { purpose: "修正用途", fileIds: ["file-1"] },
        2,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DOWNLOAD_ALREADY_RESUBMITTED",
    });
    expect(clientQuery.mock.calls[1][0]).toContain("previous_request_id = $1");
  });

  it("历史独立申请链中的旧驳回记录不能绕过最新叶子重新提交", async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [requestRow({ status: "rejected", version: 2 })],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "newer-chain-leaf" }] });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    await expect(
      resubmitContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        { purpose: "再次提交", fileIds: ["file-1"] },
        2,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DOWNLOAD_RESUBMIT_SOURCE_NOT_LATEST",
    });
  });

  it("驳回后重提可选择同根补充协议附件并创建全新不可变尝试", async () => {
    const pdfDocumentSpy = jest.spyOn(PDFDocument, "create").mockResolvedValue({
      setTitle: jest.fn(),
      setSubject: jest.fn(),
      addPage: jest.fn(() => ({ drawImage: jest.fn() })),
      embedPng: jest.fn(async () => ({})),
      save: jest.fn(async () => Uint8Array.from([37, 80, 68, 70])),
    } as never);
    const fixturePrefix = `contract-download-resubmit-${process.pid}`;
    const fixtureDirectory = path.join(projectRoot, "uploads", fixturePrefix);
    const signaturePath = path.join(fixtureDirectory, "signature.png");
    const contractFilePath = path.join(fixtureDirectory, "contract.pdf");
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    const canvas = createCanvas(240, 100);
    const context = canvas.getContext("2d");
    context.strokeStyle = "#111111";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(20, 70);
    context.bezierCurveTo(60, 10, 120, 95, 220, 30);
    context.stroke();
    fs.writeFileSync(signaturePath, canvas.toBuffer("image/png"));
    fs.writeFileSync(contractFilePath, Buffer.from("immutable-contract-file"));
    const storedSignaturePath = path.relative(projectRoot, signaturePath);
    const storedContractPath = path.relative(projectRoot, contractFilePath);
    const contractHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(contractFilePath))
      .digest("hex");
    const source = requestRow({
      status: "rejected",
      decision_comment: "请补充用途",
      decided_at: "2026-08-19T02:00:00.000Z",
      version: 2,
    });
    const selectedFile = {
      id: "file-1",
      contract_id: "supplement-1",
      file_type: "sealed_contract",
      file_name: "盖章合同.pdf",
      file_path: storedContractPath,
      file_size: fs.statSync(contractFilePath).size,
      mime_type: "application/pdf",
      file_hash: contractHash,
      created_at: "2026-08-18T01:00:00.000Z",
    };
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [source] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "request-1" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "employee-1",
            name: "员工甲",
            role: "user",
            position: "报批报建专员",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "contract-1",
            contract_no: "HT-001",
            business_contract_no: "YW-001",
            title: "测试合同",
            project_name: "测试项目",
            area: "朝阳区",
            root_id: "contract-1",
            root_area: "朝阳区",
            status: "effective",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [selectedFile] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "gm-1", name: "总经理甲", role: "general_manager" }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "admin-1", name: "管理员甲", role: "admin" }],
      })
      .mockResolvedValueOnce({ rows: [{ value: 8 }] })
      .mockResolvedValueOnce({
        rows: [{ signature_path: storedSignaturePath }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (handler: (client: { query: jest.Mock }) => Promise<unknown>) =>
        handler({ query: clientQuery }),
    );
    const newRequest = requestRow({
      id: "generated-id",
      request_no: "HTXZ-20260819-000008",
      purpose: "已补充完整用途",
      status: "pending_approval",
      chain_id: "request-1",
      previous_request_id: "request-1",
      attempt_no: 2,
      version: 1,
    });
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [newRequest] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-submit",
            request_id: "request-1",
            request_no: "HTXZ-20260819-000001",
            attempt_no: 1,
            action: "submit",
            actor_id: "employee-1",
            actor_name_snapshot: "员工甲",
            actor_position_snapshot: "报批报建专员",
            from_status: null,
            to_status: "pending_approval",
            comment: "甲方要求",
            metadata_json: {},
            created_at: "2026-08-19T01:00:00.000Z",
          },
          {
            id: "audit-reject",
            request_id: "request-1",
            request_no: "HTXZ-20260819-000001",
            attempt_no: 1,
            action: "reject",
            actor_id: "gm-1",
            actor_name_snapshot: "总经理甲",
            actor_position_snapshot: "总经理",
            from_status: "pending_approval",
            to_status: "rejected",
            comment: "请补充用途",
            metadata_json: {},
            created_at: "2026-08-19T02:00:00.000Z",
          },
          {
            id: "audit-resubmit",
            request_id: "generated-id",
            request_no: "HTXZ-20260819-000008",
            attempt_no: 2,
            action: "resubmit",
            actor_id: "employee-1",
            actor_name_snapshot: "员工甲",
            actor_position_snapshot: "报批报建专员",
            from_status: "rejected",
            to_status: "pending_approval",
            comment: "已补充完整用途",
            metadata_json: { previousRequestId: "request-1", attemptNo: 2 },
            created_at: "2026-08-19T03:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ attempt_no: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: "generated-id" }] });

    let insertedApplicationPaths: string[] = [];
    try {
      const result = await resubmitContractDownloadRequest(
        { id: "employee-1", role: "user" },
        "request-1",
        { purpose: "已补充完整用途", fileIds: ["file-1"] },
        2,
      );
      expect(result).toMatchObject({
        id: "generated-id",
        chainId: "request-1",
        previousRequestId: "request-1",
        attemptNo: 2,
        canWithdraw: true,
        canResubmit: false,
      });
      expect(result.chainHistory.map((entry) => entry.action)).toEqual([
        "submit",
        "reject",
        "resubmit",
      ]);

      const insertRequestCall = clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("INSERT INTO contract_download_requests"),
      );
      expect(insertRequestCall).toBeDefined();
      const insertParameters = insertRequestCall?.[1] as unknown[];
      expect(insertParameters[0]).toBe("generated-id");
      expect(String(insertParameters[1])).toMatch(/^HTXZ-\d{8}-000008$/);
      expect(insertParameters.slice(11, 14)).toEqual([
        "request-1",
        "request-1",
        2,
      ]);
      const selectedFilesCall = clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("FROM contract_files file"),
      );
      expect(String(selectedFilesCall?.[0])).toContain(
        "COALESCE(owner.root_contract_id, owner.id) = $1",
      );
      expect(selectedFilesCall?.[1]).toEqual(["contract-1", ["file-1"]]);
      insertedApplicationPaths = [
        String(insertParameters[20]),
        String(insertParameters[23]),
      ];
      expect(
        clientQuery.mock.calls.some(([sql]) =>
          String(sql).includes("is_current = TRUE"),
        ),
      ).toBe(true);
      expect(
        clientQuery.mock.calls.some(([sql]) =>
          String(sql).includes("FROM user_signatures"),
        ),
      ).toBe(true);
      const sourceUpdate = clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("SET applicant_seen_at = updated_at"),
      );
      expect(sourceUpdate?.[1]).toEqual(["request-1"]);
      expect(String(sourceUpdate?.[0])).not.toContain("status =");
      const auditCall = clientQuery.mock.calls.find(
        ([sql, parameters]) =>
          String(sql).includes("contract_download_request_audit_logs") &&
          Array.isArray(parameters) &&
          parameters.includes("resubmit"),
      );
      expect(auditCall?.[1]).toEqual(
        expect.arrayContaining([
          "generated-id",
          "resubmit",
          "rejected",
          "pending_approval",
        ]),
      );
    } finally {
      pdfDocumentSpy.mockRestore();
      for (const storedPath of insertedApplicationPaths) {
        fs.rmSync(path.resolve(projectRoot, storedPath), { force: true });
      }
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("管理员待办不能通过状态参数读取未批准或已完成申请", async () => {
    await expect(
      listContractDownloadRequests(
        { id: "admin-1", role: "admin" },
        "admin",
        "pending_approval",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();

    await expect(
      listContractDownloadRequests(
        { id: "admin-1", role: "admin" },
        "admin",
        "completed",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: "request-pending",
          status: "pending_approval",
          applicant_id: "employee-1",
          target_approver_id: "gm-1",
        },
      ],
    });
    await expect(
      getContractDownloadRequest(
        { id: "admin-1", role: "admin" },
        "request-pending",
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_DOWNLOAD_REQUEST_FORBIDDEN",
    });
  });

  it("数据库保存申请、不可变附件快照、签名快照与全流程审计", () => {
    const databaseSource = fs.readFileSync(
      path.join(projectRoot, "server/db/index.ts"),
      "utf8",
    );
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_download_requests",
    );
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_download_request_files",
    );
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_download_request_audit_logs",
    );
    expect(databaseSource).toContain("file_hash_snapshot");
    expect(databaseSource).toContain("applicant_signature_snapshot_hash");
    expect(databaseSource).toContain(
      "contract_download_requests_status_consistency_check",
    );
    expect(databaseSource).toContain(
      "VALIDATE CONSTRAINT contract_download_requests_approver_signature_hash_check",
    );
    expect(databaseSource).toContain("target_executor_name_snapshot");
    expect(databaseSource).toContain("applicant_seen_at TEXT NOT NULL");
    expect(databaseSource).toContain(
      "idx_contract_download_requests_applicant_unread",
    );
    expect(databaseSource).toContain(
      "'pending_approval', 'approved', 'rejected', 'withdrawn'",
    );
    expect(databaseSource).toContain("previous_request_id TEXT");
    expect(databaseSource).toContain(
      "idx_contract_download_requests_previous_unique",
    );
    expect(databaseSource).toContain(
      "idx_contract_download_requests_chain_attempt",
    );
    expect(databaseSource).toContain(
      "idx_contract_download_requests_one_active",
    );
    expect(databaseSource).toContain(
      "contract_download_requests_lineage_check",
    );
    expect(databaseSource).toContain(
      "contract_download_request_audit_logs_action_check",
    );
    expect(databaseSource).toContain(
      "contract_download_requests_previous_request_id_fkey",
    );
    const compatibilityColumn = databaseSource.indexOf(
      "ADD COLUMN IF NOT EXISTS previous_request_id TEXT",
    );
    const chainIndex = databaseSource.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_download_requests_previous_unique",
    );
    expect(compatibilityColumn).toBeGreaterThan(-1);
    expect(chainIndex).toBeGreaterThan(compatibilityColumn);
    const initialCreateEnd = databaseSource.indexOf(
      "// 兼容已由早期开发版本创建的合同表",
    );
    expect(databaseSource.slice(0, initialCreateEnd)).not.toContain(
      "idx_contract_download_requests_previous_unique",
    );
  });

  it("服务端只读取锁定签名并对附件和申请单执行哈希复核", () => {
    const serviceSource = fs.readFileSync(
      path.join(projectRoot, "server/services/contractDownloadRequest.ts"),
      "utf8",
    );
    expect(serviceSource).toContain("FROM user_signatures");
    expect(serviceSource).not.toContain("signatureDataUrl");
    expect(serviceSource).toContain("absoluteSnapshotFilePath");
    expect(serviceSource).toContain("CONTRACT_DOWNLOAD_SNAPSHOT_HASH_MISMATCH");
    expect(serviceSource).toContain("uniqueGeneralManager");
    expect(serviceSource).toContain("result.rows.length !== 1");
    expect(serviceSource).toContain("UNIQUE_CONTRACT_DOWNLOAD_ADMIN_REQUIRED");
    expect(serviceSource).toContain("request.target_executor_id === actor.id");
    expect(serviceSource).toContain("applicantSignatureOverride");
    expect(serviceSource).toContain("markApprovedContractFileDownloaded");
    expect(serviceSource).toContain("CONTRACT_DOWNLOAD_USE_RESUBMIT");
    expect(serviceSource).toContain("previousRequestNo");
    expect(serviceSource).toContain("requestChainHistory");
  });

  it("路由完整覆盖申请、审批、申请单预览、管理员下载与办结", () => {
    const routeSource = fs.readFileSync(
      path.join(projectRoot, "server/routes/contractDownloadRequests.ts"),
      "utf8",
    );
    expect(routeSource).toContain('router.get("/available/:contractId"');
    expect(routeSource).toContain('router.post("/"');
    expect(routeSource).toContain('router.get("/pending-counts"');
    expect(routeSource).toContain('router.post("/notifications/acknowledge"');
    expect(routeSource).toContain("req.body?.requestIds");
    expect(routeSource.indexOf('router.get("/pending-counts"')).toBeLessThan(
      routeSource.indexOf('router.get("/:id/application-preview"'),
    );
    expect(routeSource).toContain('router.post("/:id/decision"');
    expect(routeSource).toContain('router.get("/:id/application-preview"');
    expect(routeSource).toContain(
      'router.get("/:id/files/:requestFileId/preview"',
    );
    expect(routeSource).toContain(
      'router.get("/:id/files/:requestFileId/download"',
    );
    expect(routeSource).toContain('router.post("/:id/complete"');
    expect(routeSource).toContain('router.post("/:id/withdraw"');
    expect(routeSource).toContain('router.delete("/:id"');
    expect(routeSource).toContain('router.post("/:id/resubmit"');
    expect(routeSource).toContain('router.get("/manager-processed/export"');
    expect(routeSource).toContain('router.get("/admin-processed/export"');
    expect(routeSource).toContain("exportManagerContractDownloadHistory");
    expect(routeSource).toContain("exportAdminContractDownloadHistory");
    expect(routeSource).toContain('rawScope === "employee_history"');
    expect(routeSource).toContain('? "mine_history"');
    expect(routeSource).toContain('rawScope === "manager_processed"');
    expect(routeSource).toContain('? "approval_history"');
    expect(routeSource).toContain('rawScope === "admin_processed"');
    expect(routeSource).toContain('? "admin_history"');
    expect(routeSource).toContain("markApprovedContractFileDownloaded");
    expect(routeSource).toContain(
      "CONTRACT_DOWNLOAD_APPLICATION_DIRECT_DOWNLOAD_FORBIDDEN",
    );
    expect(routeSource).toContain('req.query.download === "1"');
    const serverSource = fs.readFileSync(
      path.join(projectRoot, "server/index.ts"),
      "utf8",
    );
    expect(serverSource).toContain(
      'app.use("/api/contract-download-requests", contractDownloadRequestsRoutes)',
    );
  });
});
