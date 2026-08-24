jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import fs from "fs";
import path from "path";
import {
  cancelContractBeforeSeal,
  deleteContractDraft,
  withdrawContractApproval,
} from "../server/services/contractService";
import { db } from "../server/db/index";

describe("合同生命周期与访问审计", () => {
  it("草拟合同按版本永久删除数据库记录与全部依赖", async () => {
    const contract = {
      id: "contract-draft",
      status: "draft",
      version: 3,
      project_id: "project-1",
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("SELECT id FROM worklog_projects")) {
          return { rows: [{ id: "project-1" }] };
        }
        if (sql.includes("AS exists")) return { rows: [{ exists: false }] };
        if (sql.includes("DELETE FROM contracts WHERE id")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await deleteContractDraft("contract-draft", "finance-1", "admin", 3);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_audit_logs"),
      ["contract-draft"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contracts WHERE id"),
      ["contract-draft"],
    );
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("is_deleted = TRUE"),
      ),
    ).toBe(false);
  });

  it("草稿存在财务凭证时阻断永久删除", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-draft",
                status: "draft",
                version: 1,
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("AS exists")) return { rows: [{ exists: true }] };
        return { rows: [], rowCount: 0 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractDraft("contract-draft", "finance-1", "admin", 1),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DRAFT_HAS_FINANCIAL_DATA",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM contracts WHERE id"),
      ),
    ).toBe(false);
  });

  it("删除一号补充协议草稿后把现存二号紧凑改为一号", async () => {
    const inheritedName =
      "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）";
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "deleted-draft-1",
                status: "draft",
                version: 1,
                relation_type: "supplement",
                root_contract_id: "root-1",
                parent_contract_id: "root-1",
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("SELECT file_path AS stored_path")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("parent_contract_id = $1 OR root_contract_id = $1")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("AS exists")) {
          return { rows: [{ exists: false }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM contracts WHERE id = $1")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT draft.id")) {
          return {
            rows: [
              {
                id: "active-draft-2",
                root_contract_id: "root-1",
                supplement_sequence: 2,
                created_at: "2026-08-16T13:21:17.329Z",
                title:
                  "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（2）",
                project_name:
                  "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（2）",
                root_project_name:
                  "焦化厂110千伏输变电工程前期手续技术咨询服务",
                root_title: "焦化厂110千伏输变电工程前期手续技术咨询服务",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("AS max_sequence")) {
          return { rows: [{ max_sequence: 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractDraft("deleted-draft-1", "finance-1", "admin", 1),
    ).resolves.toMatchObject({ deletedFileCount: 0, failedFilePaths: [] });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET supplement_sequence = \$2,[\s\S]*title =/u),
      ["active-draft-2", 1, inheritedName, expect.any(String), true],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("draft.root_contract_id = $1"),
      ["root-1", ["deleted-draft-1"]],
    );
    const ocrProjectNameUpdate = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE contract_ocr_fields"),
    );
    expect(String(ocrProjectNameUpdate?.[0] || "")).not.toContain("evidence =");
  });

  it("后续补充协议已有审批或用印资料时阻断删除和序号调整", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "deleted-draft-1",
                status: "draft",
                version: 1,
                relation_type: "supplement",
                root_contract_id: "root-1",
                parent_contract_id: "root-1",
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("SELECT draft.id")) {
          return {
            rows: [
              {
                id: "active-draft-2",
                root_contract_id: "root-1",
                supplement_sequence: 2,
                created_at: "2026-08-16T13:21:17.329Z",
                title: "测试项目补充协议（2）",
                project_name: "测试项目补充协议（2）",
                root_project_name: "测试项目",
                root_title: "测试项目",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("AS max_sequence")) {
          return { rows: [{ max_sequence: 0 }], rowCount: 1 };
        }
        if (sql.includes("FROM unnest($1::text[])")) {
          return { rows: [{ contract_id: "active-draft-2" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractDraft("deleted-draft-1", "finance-1", "admin", 1),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_DRAFT_COMPACTION_HAS_WORKFLOW_DATA",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM contracts WHERE id"),
      ),
    ).toBe(false);
  });

  it("永久删除兼容数据库中带前导斜杠的附件路径", async () => {
    const unlink = jest
      .spyOn(fs.promises, "unlink")
      .mockResolvedValue(undefined);
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-draft",
                status: "draft",
                version: 1,
                relation_type: "main",
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("SELECT file_path AS stored_path")) {
          return {
            rows: [{ stored_path: "/uploads/contracts/draft.pdf" }],
            rowCount: 1,
          };
        }
        if (sql.includes("parent_contract_id = $1 OR root_contract_id = $1")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("AS exists")) {
          return { rows: [{ exists: false }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM contracts WHERE id = $1")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractDraft("contract-draft", "finance-1", "admin", 1),
    ).resolves.toMatchObject({ deletedFileCount: 1, failedFilePaths: [] });
    expect(unlink).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "uploads/contracts/draft.pdf"),
    );
    unlink.mockRestore();
  });

  it("旧版本不能删除草稿", async () => {
    const client = {
      query: jest.fn(async (sql: string) =>
        sql.includes("SELECT * FROM contracts")
          ? { rows: [{ id: "contract-draft", status: "draft", version: 4 }] }
          : { rows: [] },
      ),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractDraft("contract-draft", "finance-1", "admin", 3),
    ).rejects.toMatchObject({ statusCode: 409, code: "VERSION_CONFLICT" });
  });

  it.each(["draft", "pending_seal"])(
    "允许撤销尚未盖章的%s合同并保留审计",
    async (status) => {
      const client = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes("SELECT * FROM contracts")) {
            return {
              rows: [
                {
                  id: "contract-cancellable",
                  status,
                  version: 2,
                  project_id: null,
                },
              ],
            };
          }
          if (sql.includes("SELECT EXISTS"))
            return { rows: [{ exists: false }] };
          return { rows: [] };
        }),
      };
      (db.transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transactionClient: typeof client) => unknown) =>
          callback(client),
      );

      await cancelContractBeforeSeal(
        "contract-cancellable",
        "finance-1",
        "admin",
        2,
        "项目取消，不再继续签署",
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("is_deleted = TRUE"),
        expect.arrayContaining(["contract-cancellable", "finance-1"]),
      );
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_audit_logs"),
        expect.arrayContaining([
          "contract_cancelled_before_seal",
          expect.stringContaining("项目取消，不再继续签署"),
          "项目取消，不再继续签署",
        ]),
      );
    },
  );

  it("已上传盖章版的待盖章合同不能撤销", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-sealed",
                status: "pending_seal",
                version: 5,
              },
            ],
          };
        }
        if (sql.includes("SELECT EXISTS")) return { rows: [{ exists: true }] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      cancelContractBeforeSeal(
        "contract-sealed",
        "finance-1",
        "admin",
        5,
        "项目取消",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_SEALED_EVIDENCE_EXISTS",
    });
  });

  it("撤销审批中的未盖章合同会同步关闭待处理审批轮次", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-approving-cancel",
                status: "approving",
                pending_action: "seal",
                previous_status: "draft",
                version: 4,
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("SELECT EXISTS")) return { rows: [{ exists: false }] };
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-cancel",
                contract_id: "contract-approving-cancel",
                approval_kind: "seal",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: "manager-1",
                target_approver_name_snapshot: "总经理",
                target_approver_role_snapshot: "general_manager",
                target_source: "general_manager",
                project_id_snapshot: null,
                submitted_at: "2026-08-13T08:00:00.000Z",
              },
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

    await cancelContractBeforeSeal(
      "contract-approving-cancel",
      "finance-1",
      "admin",
      4,
      "甲方终止本次合作",
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_approval_rounds"),
      ["round-cancel", expect.any(String), "finance-1"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_approval_records"),
      expect.arrayContaining([
        "round-cancel",
        "finance-1",
        "admin",
        "合同在盖章前被撤销：甲方终止本次合作",
      ]),
    );
  });

  it("撤销原因必填且不能绕过服务层校验", async () => {
    const transactionCallCount = (db.transaction as jest.Mock).mock.calls
      .length;
    await expect(
      cancelContractBeforeSeal("contract-draft", "finance-1", "admin", 1, " "),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CONTRACT_CANCELLATION_REASON_REQUIRED",
    });
    expect(db.transaction).toHaveBeenCalledTimes(transactionCallCount);
  });

  it("生效后的合同不能使用盖章前撤销", async () => {
    const client = {
      query: jest.fn(async (sql: string) =>
        sql.includes("SELECT * FROM contracts")
          ? {
              rows: [
                {
                  id: "contract-effective",
                  status: "effective",
                  version: 8,
                },
              ],
            }
          : { rows: [] },
      ),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      cancelContractBeforeSeal(
        "contract-effective",
        "finance-1",
        "admin",
        8,
        "项目取消",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_ALREADY_SEALED_OR_EFFECTIVE",
    });
  });

  it("本轮目标审批人未处理时可撤回用印审批并关闭审批轮次", async () => {
    const approving = {
      id: "contract-approving",
      status: "approving",
      pending_action: "seal",
      previous_status: "draft",
      version: 6,
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [approving] };
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-1",
                contract_id: approving.id,
                approval_kind: "seal",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: "owner-1",
                target_approver_name_snapshot: "项目负责人",
                target_approver_role_snapshot: "user",
                target_source: "project_owner",
                project_id_snapshot: "project-1",
                submitted_at: "2026-08-04T08:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("action IN ('approve', 'reject', 'comment')")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE contracts SET status = 'draft'")) {
          return { rows: [{ ...approving, status: "draft", version: 7 }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    const result = await withdrawContractApproval(
      "contract-approving",
      "finance-1",
      "admin",
      6,
    );

    expect(result.status).toBe("draft");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'withdraw'"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["approval_withdrawn"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_approval_rounds"),
      ["round-1", expect.any(String), "finance-1"],
    );
  });

  it("本轮目标审批人已评论后禁止撤回本轮审批", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-approving",
                status: "approving",
                pending_action: "seal",
                previous_status: "draft",
                version: 6,
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-1",
                contract_id: "contract-approving",
                approval_kind: "seal",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: "owner-1",
                target_approver_name_snapshot: "项目负责人",
                target_approver_role_snapshot: "user",
                target_source: "project_owner",
                project_id_snapshot: "project-1",
                submitted_at: "2026-08-04T08:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("action IN ('approve', 'reject', 'comment')")) {
          return { rows: [{ id: "manager-comment" }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      withdrawContractApproval("contract-approving", "finance-1", "admin", 6),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_APPROVAL_ALREADY_HANDLED",
    });
  });

  it("接口生成不可覆盖编号、写文件访问审计并由详情传版本号", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(routeSource).toContain("generateContractNumber(client)");
    expect(routeSource).not.toContain(
      "normalizeNullableText(req.body.contractNo)",
    );
    expect(databaseSource).toContain("contract_no_sequence");
    expect(databaseSource).toContain("ALTER COLUMN contract_no SET NOT NULL");
    expect(routeSource).toContain("'file_previewed'");
    expect(detailSource).toContain("handleDeleteDraft");
    expect(detailSource).toContain("handleWithdrawApproval");
    expect(detailSource).toContain("detail.value.contract.version");
  });
});
