jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../server/services/contractSealApplication", () => {
  class ContractSealApplicationError extends Error {
    constructor(
      message: string,
      public readonly statusCode = 400,
      public readonly code = "CONTRACT_SEAL_APPLICATION_INVALID",
    ) {
      super(message);
    }
  }
  return {
    ContractSealApplicationError,
    generateApprovedContractSealApplication: jest.fn(),
    cleanupApprovedContractSealApplicationArtifact: jest.fn(),
  };
});

import fs from "fs";
import path from "path";
import {
  ContractDomainError,
  createContractApprovalRound,
  decideContractApproval,
  reassignLegacyPendingContractApprovalRounds,
  resolveContractApprovalTarget,
} from "../server/services/contractService";
import { db } from "../server/db/index";
import {
  cleanupApprovedContractSealApplicationArtifact,
  ContractSealApplicationError,
  generateApprovedContractSealApplication,
} from "../server/services/contractSealApplication";

describe("合同审批角色约束", () => {
  beforeEach(() => jest.clearAllMocks());

  function generalManagerDecisionClient() {
    const contract = {
      id: "contract-1",
      contract_no: "HT-20260811-000001",
      created_by: "creator-1",
      status: "approving",
      pending_action: "seal",
      previous_status: "draft",
      relation_type: "main",
      root_contract_id: "contract-1",
      project_id: null,
    };
    return {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT id, root_contract_id FROM contracts")) {
          return { rows: [{ id: contract.id, root_contract_id: contract.id }] };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-1",
                contract_id: contract.id,
                approval_kind: "seal",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: "gm-1",
                target_approver_name_snapshot: "总经理",
                target_approver_role_snapshot: "general_manager",
                target_source: "general_manager",
                project_id_snapshot: null,
                submitted_at: "2026-08-11T08:00:00.000Z",
                completed_at: null,
                completed_by: null,
                completed_action: null,
                created_at: "2026-08-11T08:00:00.000Z",
                updated_at: "2026-08-11T08:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_seal_applications application")) {
          return {
            rows: [
              {
                id: "application-1",
                form_version: 1,
                signed_file_id: "applicant-file-1",
                signer_id: "creator-1",
                signer_name: "申请人",
                signer_role: "admin",
                signature_snapshot_path: "uploads/applicant.png",
                signed_at: "2026-08-11T07:30:00.000Z",
                approval_round_id: null,
                approved_file_id: null,
                file_name: "用印申请单.pdf",
                file_path: "uploads/application.pdf",
                file_hash: "a".repeat(64),
                file_version: 1,
              },
            ],
          };
        }
        if (
          sql.includes("UPDATE contract_files") ||
          sql.includes("UPDATE contract_seal_applications")
        ) {
          return { rows: [{ id: String(params[0]) }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM contract_files")) {
          return {
            rows: [{ file_path: "uploads/application.pdf" }],
            rowCount: 1,
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return {
            rows: [
              {
                ...contract,
                status: params[1],
                pending_action: null,
                previous_status: null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
  }

  const approvalArtifact = {
    contractId: "contract-1",
    applicationId: "application-1",
    formVersion: 1,
    approvalRoundId: "round-1",
    originalFileHash: "a".repeat(64),
    approver: {
      id: "gm-1",
      name: "总经理",
      role: "general_manager",
      signaturePath: "uploads/gm-signature.png",
      signatureAbsolutePath: "/tmp/gm-signature.png",
      signatureHash: "b".repeat(64),
      signedAt: "2026-08-11T08:30:00.000Z",
    },
    file: {
      fileName: "用印申请单-审批签署.pdf",
      filePath: "uploads/approved.pdf",
      absolutePath: "/tmp/approved.pdf",
      fileSize: 2048,
      mimeType: "application/pdf" as const,
      fileHash: "c".repeat(64),
    },
  };

  function decisionClient(
    targetId: string,
    overrides: Record<string, unknown> = {},
    legacyProjectOwner = false,
  ) {
    const contract = {
      id: "contract-1",
      status: "approving",
      pending_action: "seal",
      previous_status: "draft",
      relation_type: "main",
      root_contract_id: "contract-1",
      project_id: null,
      ...overrides,
    };
    return {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT id, root_contract_id FROM contracts")) {
          return { rows: [{ id: contract.id, root_contract_id: contract.id }] };
        }
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-1",
                contract_id: contract.id,
                approval_kind:
                  contract.pending_action === "termination"
                    ? "termination"
                    : "seal",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: targetId,
                target_approver_name_snapshot: legacyProjectOwner
                  ? "项目负责人"
                  : "总经理",
                target_approver_role_snapshot: legacyProjectOwner
                  ? "user"
                  : "general_manager",
                target_source: legacyProjectOwner
                  ? "project_owner"
                  : "general_manager",
                project_id_snapshot: "project-1",
                submitted_at: "2026-08-05T08:00:00.000Z",
                completed_at: null,
                completed_by: null,
                completed_action: null,
                created_at: "2026-08-05T08:00:00.000Z",
                updated_at: "2026-08-05T08:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("SELECT id FROM worklog_projects")) {
          return { rows: [{ id: params[0] }] };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return {
            rows: [
              {
                ...contract,
                status: params[1],
                pending_action: null,
                previous_status: null,
                rejected_at: params[1] === "rejected" ? params[3] : null,
                terminated_at: params[1] === "terminated" ? params[3] : null,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
  }

  it("业务服务拒绝管理员参与合同业务审批", async () => {
    await expect(
      decideContractApproval("contract-1", "approve", "admin-1", "admin"),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 403,
      code: "CONTRACT_APPROVAL_GENERAL_MANAGER_ONLY",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("总经理仍必须是本轮快照锁定的目标审批人", async () => {
    const client = decisionClient("gm-1");
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-2",
        "general_manager",
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_APPROVAL_TARGET_ONLY" });
  });

  it("历史项目负责人待审批轮次必须先迁移且员工不能继续审批", async () => {
    const client = decisionClient("owner-legacy", {}, true);
    await expect(
      decideContractApproval("contract-1", "approve", "owner-legacy", "user"),
    ).rejects.toMatchObject({
      code: "CONTRACT_APPROVAL_GENERAL_MANAGER_ONLY",
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-1",
        "general_manager",
      ),
    ).rejects.toMatchObject({
      code: "CONTRACT_APPROVAL_LEGACY_TARGET_NOT_MIGRATED",
    });
  });

  it("用印审批驳回进入已拒绝终态且不会写入终止时间", async () => {
    const client = decisionClient("gm-1");
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "reject",
        "gm-1",
        "general_manager",
        "合同条款不符合要求",
      ),
    ).resolves.toMatchObject({ status: "rejected" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "terminated_at = CASE WHEN $2 = 'terminated' THEN $4 ELSE terminated_at END",
      ),
      expect.arrayContaining(["contract-1", "rejected", "reject", "gm-1"]),
    );
  });

  it("总经理通过用印审批时生成双签申请单并与审批状态同事务保存", async () => {
    const client = generalManagerDecisionClient();
    (generateApprovedContractSealApplication as jest.Mock).mockResolvedValue(
      approvalArtifact,
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-1",
        "general_manager",
      ),
    ).resolves.toMatchObject({ status: "pending_seal" });

    expect(generateApprovedContractSealApplication).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        applicationId: "application-1",
        approvalRoundId: "round-1",
        actorId: "gm-1",
      }),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("signed_file_id = $3, approved_file_id = $3"),
      expect.arrayContaining([
        "application-1",
        "round-1",
        "gm-1",
        "general_manager",
      ]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_files"),
      ["applicant-file-1", "contract-1"],
    );
    expect(
      cleanupApprovedContractSealApplicationArtifact,
    ).not.toHaveBeenCalled();
  });

  it("总经理没有本人电子签名时阻断通过且不改变合同状态", async () => {
    const client = generalManagerDecisionClient();
    (generateApprovedContractSealApplication as jest.Mock).mockRejectedValue(
      new ContractSealApplicationError(
        "请先在个人设置上传并锁定本人电子签名",
        409,
        "PERSONAL_SIGNATURE_REQUIRED",
      ),
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-1",
        "general_manager",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "PERSONAL_SIGNATURE_REQUIRED",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contracts SET status = $2"),
      ),
    ).toBe(false);
  });

  it("总经理双签生成后审批事务失败会清理新文件并由事务回滚原申请件", async () => {
    const client = generalManagerDecisionClient();
    const baseImplementation = client.query.getMockImplementation();
    client.query.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes("UPDATE contracts SET status = $2")) {
          throw new Error("模拟审批事务提交失败");
        }
        return baseImplementation?.(sql, params);
      },
    );
    (generateApprovedContractSealApplication as jest.Mock).mockResolvedValue(
      approvalArtifact,
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-1",
        "general_manager",
      ),
    ).rejects.toThrow("模拟审批事务提交失败");

    expect(cleanupApprovedContractSealApplicationArtifact).toHaveBeenCalledWith(
      approvalArtifact,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_files"),
      ["applicant-file-1", "contract-1"],
    );
  });

  it("终止业务审批通过仍进入终止状态", async () => {
    const client = decisionClient("gm-1", {
      pending_action: "termination",
      previous_status: "executing",
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "approve",
        "gm-1",
        "general_manager",
      ),
    ).resolves.toMatchObject({ status: "terminated" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "terminated_at = CASE WHEN $2 = 'terminated' THEN $4 ELSE terminated_at END",
      ),
      expect.arrayContaining(["contract-1", "terminated", "approve"]),
    );
  });

  it("执行中合同的终止申请被驳回后恢复执行中并继续计入项目经营口径", async () => {
    const client = decisionClient("gm-1", {
      pending_action: "termination",
      previous_status: "executing",
      project_id: "project-1",
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "reject",
        "gm-1",
        "general_manager",
        "继续履行原合同",
      ),
    ).resolves.toMatchObject({
      status: "executing",
      pending_action: null,
      previous_status: null,
      rejected_at: null,
      terminated_at: null,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET status = $2"),
      expect.arrayContaining(["contract-1", "executing", "reject", "gm-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPDATE contract_approval_rounds SET status = $2",
      ),
      expect.arrayContaining(["round-1", "rejected", "gm-1", "reject"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_approval_records"),
      expect.arrayContaining(["reject", "approving", "executing"]),
    );
    const projectSyncCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE worklog_projects p"),
    );
    expect(projectSyncCall?.[1]?.[0]).toBe("project-1");
    expect(String(projectSyncCall?.[0])).toContain(
      "WHERE effective_root_status IN ('effective', 'executing', 'completed')",
    );
    expect(String(projectSyncCall?.[0])).toContain(
      "root_contract.current_effective_amount",
    );
    expect(String(projectSyncCall?.[0])).toContain(
      "effective_root_status = 'executing'",
    );
  });

  it("终止申请缺少合法申请前状态时拒绝处理且不改写合同", async () => {
    const client = decisionClient("gm-1", {
      pending_action: "termination",
      previous_status: "draft",
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-1",
        "reject",
        "gm-1",
        "general_manager",
        "终止状态异常",
      ),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 409,
      code: "CONTRACT_TERMINATION_PREVIOUS_STATUS_INVALID",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contracts SET status = $2"),
      ),
    ).toBe(false);
  });

  it("终止申请驳回提示恢复原状态，不再误报合同进入已拒绝终态", () => {
    const approvalWorkspaceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractApprovalWorkspace.vue",
      ),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(approvalWorkspaceSource).toContain(
      "终止申请已驳回，合同已恢复申请前状态",
    );
    expect(approvalWorkspaceSource).not.toContain(
      "终止申请已拒绝，合同已进入已拒绝终态",
    );
    expect(detailSource).not.toContain("终止申请已驳回，合同已恢复申请前状态");
  });

  it("主营项目合同也统一锁定唯一活动总经理", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
      })),
    };
    await expect(
      resolveContractApprovalTarget(
        client as never,
        {
          category: "main_business",
          project_id: "project-1",
        } as never,
      ),
    ).resolves.toMatchObject({
      id: "gm-1",
      source: "general_manager",
      projectIdSnapshot: "project-1",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM worklog_projects"),
      expect.anything(),
    );
  });

  it("主营合同未关联项目时锁定唯一活动总经理", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
      })),
    };
    await expect(
      resolveContractApprovalTarget(
        client as never,
        {
          category: "main_business",
          project_id: null,
        } as never,
      ),
    ).resolves.toMatchObject({
      id: "gm-1",
      source: "general_manager",
      projectIdSnapshot: null,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("role = 'general_manager'"),
    );
  });

  it("主营合同未关联项目时把总经理写入审批轮次快照", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM users")) {
          return {
            rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const result = await createContractApprovalRound(client as never, {
      contract: {
        id: "contract-without-project",
        category: "main_business",
        project_id: null,
      } as never,
      kind: "seal",
      initiatorId: "finance-1",
      initiatorRole: "admin",
      now: "2026-08-11T08:00:00.000Z",
    });
    expect(result.round).toMatchObject({
      target_approver_id: "gm-1",
      target_approver_name_snapshot: "总经理",
      target_approver_role_snapshot: "general_manager",
      target_source: "general_manager",
      project_id_snapshot: null,
    });
  });

  it("提交时把唯一目标审批人、来源和项目编号写入审批轮次快照", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM users")) {
          return {
            rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const result = await createContractApprovalRound(client as never, {
      contract: {
        id: "contract-1",
        category: "main_business",
        project_id: "project-1",
      } as never,
      kind: "seal",
      initiatorId: "finance-1",
      initiatorRole: "admin",
      now: "2026-08-05T08:00:00.000Z",
    });
    expect(result.round).toMatchObject({
      target_approver_id: "gm-1",
      target_approver_name_snapshot: "总经理",
      target_approver_role_snapshot: "general_manager",
      target_source: "general_manager",
      project_id_snapshot: "project-1",
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_approval_rounds"),
      expect.arrayContaining([
        "contract-1",
        "seal",
        "gm-1",
        "总经理",
        "general_manager",
        "project-1",
      ]),
    );
  });

  it("主营项目负责人状态不再参与合同审批人解析", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
      })),
    };
    await expect(
      resolveContractApprovalTarget(
        client as never,
        {
          category: "main_business",
          project_id: "project-1",
        } as never,
      ),
    ).resolves.toMatchObject({
      id: "gm-1",
      source: "general_manager",
    });
  });

  it("主营、非主营和资产类必须唯一锁定一个活动总经理", async () => {
    const multipleManagers = {
      query: jest.fn(async () => ({
        rows: [
          { id: "gm-1", name: "总经理甲", role: "general_manager" },
          { id: "gm-2", name: "总经理乙", role: "general_manager" },
        ],
      })),
    };
    await expect(
      resolveContractApprovalTarget(
        multipleManagers as never,
        {
          category: "non_main",
          project_id: null,
        } as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "GENERAL_MANAGER_NOT_UNIQUE",
    });

    const oneManager = {
      query: jest.fn(async () => ({
        rows: [{ id: "gm-1", name: "总经理", role: "general_manager" }],
      })),
    };
    await expect(
      resolveContractApprovalTarget(
        oneManager as never,
        {
          category: "asset",
          project_id: null,
        } as never,
      ),
    ).resolves.toMatchObject({ id: "gm-1", source: "general_manager" });
  });

  it("启动迁移把历史项目负责人待审批轮次重指向唯一活动总经理", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM contract_approval_rounds approval_round")) {
          return {
            rows: [
              {
                id: "legacy-round-1",
                contract_id: "contract-1",
                target_approver_id: "owner-1",
                target_approver_name_snapshot: "项目负责人",
                target_approver_role_snapshot: "user",
                target_source: "project_owner",
                contract_project_id: "project-1",
              },
            ],
          };
        }
        if (sql.includes("FROM users")) {
          return {
            rows: [{ id: "gm-1", name: "刘行", role: "general_manager" }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      reassignLegacyPendingContractApprovalRounds(),
    ).resolves.toEqual({ reassignedCount: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("target_source = 'general_manager'"),
      ["legacy-round-1", "gm-1", "刘行", "project-1", expect.any(String)],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["approval_target_reassigned_to_general_manager"]),
    );
  });

  it("历史待审批轮次存在但总经理不唯一时阻断迁移", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM contract_approval_rounds approval_round")) {
          return {
            rows: [
              {
                id: "legacy-round-1",
                contract_id: "contract-1",
                target_source: "project_owner",
              },
            ],
          };
        }
        if (sql.includes("FROM users")) {
          return {
            rows: [
              { id: "gm-1", name: "总经理甲", role: "general_manager" },
              { id: "gm-2", name: "总经理乙", role: "general_manager" },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      reassignLegacyPendingContractApprovalRounds(),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "LEGACY_CONTRACT_APPROVAL_GENERAL_MANAGER_NOT_UNIQUE",
    });
  });

  it("审批路由先排除管理员角色，再由服务层校验快照目标", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toContain(
      'router.post("/:id/approve", requireContractApprover',
    );
    expect(source).not.toContain('router.post("/:id/approve", requireFinance');
    expect(source).toContain(
      'const CONTRACT_APPROVER_ROLES = ["general_manager"] as const',
    );
    expect(source).not.toContain(
      'const CONTRACT_APPROVER_ROLES = ["general_manager", "user"] as const',
    );
    expect(source).toContain("approval_round.target_approver_id = ?");
  });

  it("用印、终止和盖章差异复审都创建独立审批人快照轮次", () => {
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    const sealSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractSealWorkflow.ts"),
      "utf8",
    );
    expect(serviceSource).toContain('kind: "seal"');
    expect(serviceSource).toContain('"difference_rejected"');
    expect(serviceSource).toContain('kind: "termination"');
    expect(sealSource).toContain('kind: "seal_difference"');
    expect(`${serviceSource}\n${sealSource}`).toContain(
      "approvalTargetSnapshot(round)",
    );
  });

  it("合同审批人解析不再读取项目负责人", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    const targetResolver = serviceSource.slice(
      serviceSource.indexOf(
        "export async function resolveContractApprovalTarget",
      ),
      serviceSource.indexOf(
        "export async function reassignLegacyPendingContractApprovalRounds",
      ),
    );
    expect(targetResolver).not.toContain("worklog_projects");
    expect(targetResolver).not.toContain("owner_user_id");
    expect(`${routeSource}\n${serviceSource}`).not.toContain(
      "projects.project_manager",
    );
  });

  it("识别字段只允许自动原子写入或财务专用接口整组确认", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).not.toContain("ON CONFLICT (job_id, field_code) DO UPDATE");
    expect(source).toContain("OCR_FIELDS_READ_ONLY");
    expect(source).toContain("contract_date_source = $8");
    expect(source).toContain("automaticDecision.values.contract_date");
    expect(source).toContain('"/:id/ocr-jobs/:jobId/confirm"');
    expect(source).toContain("requireFinance");
    expect(source).toContain("识别任务仍在执行");
    expect(source).toContain("文件扩展名与真实格式不一致");
  });
});
