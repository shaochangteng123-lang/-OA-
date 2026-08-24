jest.mock("nanoid", () => ({ nanoid: () => "generated-id" }));
jest.mock("../server/db/index", () => ({
  db: {
    transaction: jest.fn(),
    get: jest.fn(),
    all: jest.fn(),
  },
}));
jest.mock("../server/services/contractOcr", () => ({
  recognizeContractFile: jest.fn(),
  extractContractBusinessNumber: jest.fn(() => null),
  extractReferencedParentContractBusinessNumber: jest.fn(() => null),
}));

import fs from "fs";
import path from "path";
import { db } from "../server/db/index";
import {
  assertSealedContractRecognitionAllowed,
  createSealedContractVerification,
  getSealedContractVerification,
  recognizeSealedContractFile,
} from "../server/services/contractSealWorkflow";
import { decideContractApproval } from "../server/services/contractService";
import type { ContractRecognitionResult } from "../server/services/contractOcr";
import {
  extractContractBusinessNumber,
  recognizeContractFile,
} from "../server/services/contractOcr";

function recognition(warnings: string[] = []): ContractRecognitionResult {
  return {
    status: warnings.length > 0 ? "failed" : "succeeded",
    rawText: warnings.length > 0 ? "" : "盖章合同",
    method: warnings.length > 0 ? "none" : "pdf_text",
    warnings,
    fields:
      warnings.length > 0
        ? []
        : [
            {
              field: "party_a",
              originalValue: "甲方公司",
              normalizedValue: "甲方公司",
              confidence: 100,
              source: "pdf_text",
            },
            {
              field: "party_b",
              originalValue: "乙方公司",
              normalizedValue: "乙方公司",
              confidence: 100,
              source: "pdf_text",
            },
            {
              field: "amount",
              originalValue: "100000",
              normalizedValue: "100000",
              confidence: 100,
              source: "pdf_text",
            },
            {
              field: "contract_date",
              originalValue: "2026-08-01",
              normalizedValue: "2026-08-01",
              confidence: 100,
              source: "pdf_text",
            },
          ],
  };
}

function createClient(
  contractOverrides: Record<string, unknown> = {},
  duplicateFile: { id: string; file_type: string } | null = null,
) {
  let verificationInsert: unknown[] = [];
  const fieldInserts: unknown[][] = [];
  const contract = {
    id: "contract-1",
    status: "pending_seal",
    version: 3,
    party_a: "甲方公司",
    party_b: "乙方公司",
    amount_delta: 100000,
    contract_date: "2026-08-01",
    relation_type: "main",
    parent_contract_id: null,
    category: "main_business",
    declared_category: "main_business",
    business_contract_no: null,
    project_id: null,
    ...contractOverrides,
  };
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT * FROM contracts")) {
        return { rows: [contract] };
      }
      if (sql.includes("SELECT COALESCE(MAX(version)")) {
        return { rows: [{ next_version: 1 }] };
      }
      if (sql.includes("UPDATE contracts SET business_contract_no")) {
        return {
          rows: [
            {
              ...contract,
              business_contract_no: params[1],
              version: contract.version + 1,
            },
          ],
        };
      }
      if (sql.includes("FROM contract_files") && sql.includes("file_hash")) {
        return { rows: duplicateFile ? [duplicateFile] : [] };
      }
      if (sql.includes("INSERT INTO contract_seal_verifications")) {
        verificationInsert = params;
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO contract_seal_verification_fields")) {
        fieldInserts.push(params);
        return { rows: [] };
      }
      if (sql.includes("SELECT v.*, f.file_name")) {
        return {
          rows: [
            {
              id: verificationInsert[0],
              contract_id: "contract-1",
              file_id: verificationInsert[2],
              status: verificationInsert[3],
              upload_date: verificationInsert[4],
              approved_snapshot_json: verificationInsert[5],
              recognition_status: verificationInsert[6],
              recognition_method: verificationInsert[7],
              recognition_warnings_json: verificationInsert[8],
              raw_text: verificationInsert[9],
              mismatches_json: verificationInsert[10],
              infrastructure_failure: verificationInsert[11],
              difference_explanation: null,
              approval_submitted_at: null,
              approval_completed_at: null,
              created_by: "finance-1",
              confirmed_by: null,
              confirmed_at: null,
              archived_by: null,
              archived_at: null,
              created_at: "2026-08-05T00:00:00.000Z",
              updated_at: "2026-08-05T00:00:00.000Z",
              file_name: "盖章合同.pdf",
              mime_type: "application/pdf",
              file_is_current: true,
            },
          ],
        };
      }
      if (sql.includes("SELECT * FROM contract_seal_verification_fields")) {
        return {
          rows: fieldInserts.map((field) => ({
            id: field[0],
            verification_id: field[1],
            contract_id: field[2],
            field_code: field[3],
            approved_value: field[4],
            recognized_value: field[5],
            final_value: field[6],
            confidence: field[7],
            source: field[8],
            requires_manual_confirmation: field[9],
            manually_confirmed: false,
            is_mismatch: field[10],
            confirmed_by: null,
            confirmed_at: null,
            created_at: "2026-08-05T00:00:00.000Z",
            updated_at: "2026-08-05T00:00:00.000Z",
          })),
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return { client, fieldInserts };
}

describe("盖章合同归档复核闭环", () => {
  afterEach(() => {
    jest.clearAllMocks();
    (extractContractBusinessNumber as jest.Mock).mockReturnValue(null);
  });

  it("盖章上传和重试复用审批合同的分类及关系识别上下文", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "asset-contract",
      status: "pending_seal",
      version: 7,
      party_a: "出租方",
      party_b: "承租方",
      amount_delta: 635952,
      declared_category: "asset",
      category: "asset",
      relation_type: "main",
    });
    const context = await assertSealedContractRecognitionAllowed(
      "asset-contract",
      7,
    );
    (recognizeContractFile as jest.Mock).mockResolvedValueOnce(recognition());

    await recognizeSealedContractFile(
      "/tmp/盖章资产合同.pdf",
      "application/pdf",
      context,
    );

    expect(context).toEqual({
      expectedCategory: "asset",
      relationType: "main",
    });
    expect(recognizeContractFile).toHaveBeenCalledWith(
      "/tmp/盖章资产合同.pdf",
      "application/pdf",
      { expectedCategory: "asset", relationType: "main" },
    );
  });

  it("独立续签主合同的盖章识别继续使用续签主合同层级上下文", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "renewal-main-contract",
      status: "pending_seal",
      version: 4,
      party_a: "出租方",
      party_b: "承租方",
      amount_delta: 120000,
      declared_category: "asset",
      category: "asset",
      relation_type: "main",
      renewed_from_contract_id: "previous-rental-contract",
    });

    await expect(
      assertSealedContractRecognitionAllowed("renewal-main-contract", 4),
    ).resolves.toEqual({
      expectedCategory: "asset",
      relationType: "main",
      renewalMain: true,
    });
  });

  it("识别一致时只进入待归档，不会在上传事务中直接生效", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同.pdf",
        filePath: "uploads/contracts/盖章合同.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-1",
      },
      recognition: recognition(),
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.contract.status).toBe("pending_seal");
    expect(result.contract.version).toBe(4);
    expect(result.verification.status).toBe("ready_to_archive");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contracts SET status = 'effective'"),
      ),
    ).toBe(false);
  });

  it("仅付款补充协议的盖章正文没有零元金额也可进入待归档", async () => {
    const { client } = createClient({
      relation_type: "supplement",
      parent_contract_id: "root-1",
      root_contract_id: "root-1",
      amount_delta: 0,
      supplement_change_type: "payment_terms_only",
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const paymentTermsRecognition = recognition();
    paymentTermsRecognition.fields = paymentTermsRecognition.fields.filter(
      (field) => field.field !== "amount",
    );

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "仅变更付款方式补充协议.pdf",
        filePath: "uploads/contracts/仅变更付款方式补充协议.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-payment-terms-only",
      },
      recognition: paymentTermsRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("ready_to_archive");
    expect(result.verification.requiresRecognitionRetry).toBe(false);
    expect(result.verification.approvedSnapshot).toMatchObject({
      amount: 0,
      amountVerificationRequired: false,
    });
    expect(
      result.verification.fields.find((field) => field.field === "amount"),
    ).toMatchObject({
      recognizedValue: null,
      finalValue: null,
      source: "not_applicable",
      requiresRecognitionRetry: false,
    });
  });

  it("草拟阶段没有编号时允许盖章文件补全二维码业务编号", async () => {
    (extractContractBusinessNumber as jest.Mock).mockReturnValue({
      value: "SGBJCY00JSJS2500693(B1)",
      pageNumbers: [2],
      source: "qr",
    });
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同.pdf",
        filePath: "uploads/contracts/盖章合同.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-business-number",
      },
      recognition: recognition(),
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.contract.business_contract_no).toBe(
      "SGBJCY00JSJS2500693(B1)",
    );
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("business_contract_no = $2") &&
          params?.[1] === "SGBJCY00JSJS2500693(B1)",
      ),
    ).toBe(true);
  });

  it("草拟和盖章文件都没有可靠编号时不阻断核验且保留原值", async () => {
    const { client } = createClient({ business_contract_no: null });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "无二维码盖章合同.pdf",
        filePath: "uploads/contracts/无二维码盖章合同.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-without-business-number",
      },
      recognition: recognition(),
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.contract.business_contract_no).toBeNull();
    expect(result.verification.status).toBe("ready_to_archive");
  });

  it("盖章文件与草拟文件完全一致时返回明确提示且不创建核验记录", async () => {
    const { client } = createClient(
      {},
      {
        id: "draft-file-1",
        file_type: "draft_contract",
      },
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      createSealedContractVerification({
        contractId: "contract-1",
        file: {
          fileName: "盖章合同.pdf",
          filePath: "uploads/contracts/盖章合同.pdf",
          fileSize: 100,
          mimeType: "application/pdf",
          fileHash: "draft-hash",
        },
        recognition: recognition(),
        uploadDate: "2026-08-05",
        actorId: "finance-1",
        actorRole: "admin",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SEALED_FILE_MATCHES_DRAFT",
      message:
        "所选盖章合同与当前合同的草拟文件完全一致，请上传实际签字盖章后的合同",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO contract_seal_verifications"),
      ),
    ).toBe(false);
  });

  it("识别基础设施失败时冻结所有最终值并禁止默认成功", async () => {
    const { client, fieldInserts } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同.pdf",
        filePath: "uploads/contracts/盖章合同.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-2",
      },
      recognition: recognition(["OCR 识别基础设施暂时不可用，可稍后重试"]),
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("infrastructure_failed");
    expect(result.verification.infrastructureFailure).toBe(true);
    expect(fieldInserts.map((field) => field[6])).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["sealed_verification_infrastructure_failed"]),
    );
  });

  it("总经理处理差异复审时在同一事务同步核验状态", async () => {
    const approvingContract = {
      id: "contract-2",
      status: "approving",
      pending_action: "seal",
      previous_status: "pending_seal",
      relation_type: "main",
      root_contract_id: "contract-2",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT id, root_contract_id FROM contracts")) {
          return {
            rows: [{ id: "contract-2", root_contract_id: "contract-2" }],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [approvingContract] };
        }
        if (sql.includes("SELECT * FROM contract_approval_rounds")) {
          return {
            rows: [
              {
                id: "round-2",
                contract_id: "contract-2",
                approval_kind: "seal_difference",
                status: "pending",
                initiator_id: "finance-1",
                initiator_role: "admin",
                target_approver_id: "manager-1",
                target_approver_name_snapshot: "总经理",
                target_approver_role_snapshot: "general_manager",
                target_source: "general_manager",
                project_id_snapshot: null,
                submitted_at: "2026-08-05T08:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return {
            rows: [{ ...approvingContract, status: params[1] }],
          };
        }
        if (sql.includes("UPDATE contract_seal_verifications SET")) {
          return { rows: [{ id: "verification-2" }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      decideContractApproval(
        "contract-2",
        "approve",
        "manager-1",
        "general_manager",
      ),
    ).resolves.toMatchObject({ status: "pending_seal" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_seal_verifications SET"),
      ["contract-2", "difference_approved", expect.any(String)],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining([
        "approval_approve",
        expect.stringContaining("verification-2"),
      ]),
    );
  });

  it("高置信度关键差异只能进入差异说明与复审流程", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const changedRecognition = recognition();
    const amountField = changedRecognition.fields.find(
      (field) => field.field === "amount",
    );
    if (!amountField) throw new Error("测试识别结果缺少合同金额");
    amountField.originalValue = "120000";
    amountField.normalizedValue = "120000";

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同差异版.pdf",
        filePath: "uploads/contracts/盖章合同差异版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-difference",
      },
      recognition: changedRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("difference_explanation_required");
    expect(result.verification.mismatches).toEqual([
      expect.objectContaining({ field: "amount", sealedValue: "120000" }),
    ]);
  });

  it("甲乙双方名称分别核对，任一方变化都会进入差异复审", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const changedRecognition = recognition();
    for (const [fieldCode, value] of [
      ["party_a", "新甲方公司"],
      ["party_b", "新乙方公司"],
    ] as const) {
      const field = changedRecognition.fields.find(
        (candidate) => candidate.field === fieldCode,
      );
      if (!field) throw new Error(`测试识别结果缺少${fieldCode}`);
      field.originalValue = value;
      field.normalizedValue = value;
    }

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同主体差异版.pdf",
        filePath: "uploads/contracts/盖章合同主体差异版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-party-difference",
      },
      recognition: changedRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("difference_explanation_required");
    expect(result.verification.mismatches.map((item) => item.field)).toEqual([
      "party_a",
      "party_b",
    ]);
    expect(
      result.verification.fields
        .filter((field) => ["party_a", "party_b"].includes(field.field))
        .map((field) => [field.field, field.isMismatch]),
    ).toEqual([
      ["party_a", true],
      ["party_b", true],
    ]);
  });

  it("关键字段与审批快照一致时非满分诊断分不再阻断归档", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const lowConfidenceRecognition = recognition();
    const amountField = lowConfidenceRecognition.fields.find(
      (field) => field.field === "amount",
    );
    if (!amountField) throw new Error("测试识别结果缺少合同金额");
    amountField.confidence = 99;

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同低可信版.pdf",
        filePath: "uploads/contracts/盖章合同低可信版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-low-confidence",
      },
      recognition: lowConfidenceRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("ready_to_archive");
    expect(result.verification.requiresRecognitionRetry).toBe(false);
    expect(result.verification.mismatches).toEqual([]);
    expect(
      result.verification.fields.find((field) => field.field === "amount"),
    ).toMatchObject({ requiresRecognitionRetry: false });
  });

  it("多来源 99 分且无风险警告的真实金额差异进入差异复审", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const changedRecognition = recognition();
    const amountField = changedRecognition.fields.find(
      (field) => field.field === "amount",
    );
    if (!amountField) throw new Error("测试识别结果缺少合同金额");
    amountField.originalValue = "120000";
    amountField.normalizedValue = "120000";
    amountField.confidence = 99;
    amountField.fieldScore = 99;
    amountField.source = "mixed";

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同金额差异版.pdf",
        filePath: "uploads/contracts/盖章合同金额差异版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-mixed-amount-difference",
      },
      recognition: changedRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("difference_explanation_required");
    expect(result.verification.requiresRecognitionRetry).toBe(false);
    expect(result.verification.mismatches.map((item) => item.field)).toEqual([
      "amount",
    ]);
    expect(
      result.verification.fields.find((field) => field.field === "amount"),
    ).toMatchObject({
      requiresRecognitionRetry: false,
      isMismatch: true,
    });
  });

  it("98 分的真实差异仍因证据不足而阻断", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const changedRecognition = recognition();
    const amountField = changedRecognition.fields.find(
      (field) => field.field === "amount",
    );
    if (!amountField) throw new Error("测试识别结果缺少合同金额");
    amountField.originalValue = "120000";
    amountField.normalizedValue = "120000";
    amountField.confidence = 98;
    amountField.fieldScore = 98;

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同低证据差异版.pdf",
        filePath: "uploads/contracts/盖章合同低证据差异版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-low-score-amount-difference",
      },
      recognition: changedRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("review_required");
    expect(result.verification.requiresRecognitionRetry).toBe(true);
    expect(result.verification.mismatches).toEqual([]);
  });

  it("核心字段缺失时仍要求重新识别", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const missingPartyRecognition = recognition();
    missingPartyRecognition.fields = missingPartyRecognition.fields.filter(
      (field) => field.field !== "party_b",
    );

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同缺少乙方.pdf",
        filePath: "uploads/contracts/盖章合同缺少乙方.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-missing-party-b",
      },
      recognition: missingPartyRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("review_required");
    expect(result.verification.requiresRecognitionRetry).toBe(true);
    expect(
      result.verification.fields.find((field) => field.field === "party_b"),
    ).toMatchObject({ requiresRecognitionRetry: true });
  });

  it.each(["manual", "rule"])(
    "%s 来源的核心字段在持久化回读后仍要求重新识别",
    async (source) => {
      const { client } = createClient();
      (db.transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transactionClient: typeof client) => unknown) =>
          callback(client),
      );
      const disqualifiedRecognition = recognition();
      for (const field of disqualifiedRecognition.fields) {
        if (field.field !== "contract_date") {
          field.source = source as unknown as typeof field.source;
        }
      }

      const result = await createSealedContractVerification({
        contractId: "contract-1",
        file: {
          fileName: `盖章合同-${source}.pdf`,
          filePath: `uploads/contracts/盖章合同-${source}.pdf`,
          fileSize: 100,
          mimeType: "application/pdf",
          fileHash: `hash-disqualified-${source}`,
        },
        recognition: disqualifiedRecognition,
        uploadDate: "2026-08-05",
        actorId: "finance-1",
        actorRole: "admin",
        expectedVersion: 3,
      });

      expect(result.verification.status).toBe("review_required");
      expect(result.verification.requiresRecognitionRetry).toBe(true);
    },
  );

  it("失败识别即使携带完整字段也保持待重新识别状态", async () => {
    const { client } = createClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const failedRecognition = recognition();
    failedRecognition.status = "failed";
    failedRecognition.failureKind = "recognition";

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同失败识别.pdf",
        filePath: "uploads/contracts/盖章合同失败识别.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-failed-with-fields",
      },
      recognition: failedRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("review_required");
    expect(result.verification.requiresRecognitionRetry).toBe(true);
  });

  it("历史记录中的非法金额即使为 100 分也不能通过回读门禁", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "verification-history",
      contract_id: "contract-1",
      file_id: "sealed-file-history",
      status: "review_required",
      upload_date: "2026-08-05",
      approved_snapshot_json: {
        partyA: "甲方公司",
        partyB: "乙方公司",
        amount: "100000",
      },
      recognition_status: "partial",
      recognition_method: "pdf_text",
      recognition_warnings_json: [],
      raw_text: "盖章合同",
      mismatches_json: [],
      infrastructure_failure: false,
      created_by: "finance-1",
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
      file_name: "盖章合同.pdf",
      mime_type: "application/pdf",
    });
    (db.all as jest.Mock).mockResolvedValueOnce(
      [
        ["party_a", "甲方公司", "甲方公司"],
        ["party_b", "乙方公司", "乙方公司"],
        ["amount", "100000", "壹拾万元整"],
        ["contract_date", null, "2026-08-05"],
      ].map(([fieldCode, approvedValue, finalValue]) => ({
        field_code: fieldCode,
        approved_value: approvedValue,
        recognized_value: finalValue,
        final_value: finalValue,
        confidence: 100,
        source: "pdf_text",
        requires_manual_confirmation: false,
        manually_confirmed: false,
        is_mismatch: false,
      })),
    );

    const verification = await getSealedContractVerification("contract-1");

    expect(verification.requiresRecognitionRetry).toBe(true);
    expect(
      verification.fields.find((field) => field.field === "amount"),
    ).toMatchObject({ requiresRecognitionRetry: true });
  });

  it("合同日期缺失时自动采用上传日期并可进入待归档", async () => {
    const { client } = createClient({ contract_date: null });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    const missingDateRecognition = recognition();
    missingDateRecognition.fields = missingDateRecognition.fields.filter(
      (field) => field.field !== "contract_date",
    );

    const result = await createSealedContractVerification({
      contractId: "contract-1",
      file: {
        fileName: "盖章合同无日期版.pdf",
        filePath: "uploads/contracts/盖章合同无日期版.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
        fileHash: "hash-missing-date",
      },
      recognition: missingDateRecognition,
      uploadDate: "2026-08-05",
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 3,
    });

    expect(result.verification.status).toBe("ready_to_archive");
    expect(result.verification.requiresRecognitionRetry).toBe(false);
    expect(
      result.verification.fields.find(
        (field) => field.field === "contract_date",
      ),
    ).toMatchObject({
      finalValue: "2026-08-05",
      source: "upload_date",
      requiresRecognitionRetry: false,
    });
  });

  it("数据库、接口和审批服务具备差异复审与审计闭环", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    const sealWorkflowSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractSealWorkflow.ts"),
      "utf8",
    );
    expect(databaseSource).toContain("contract_seal_verifications");
    expect(databaseSource).toContain("contract_seal_verification_fields");
    expect(databaseSource).toContain("seal_difference_submit");
    expect(databaseSource).toContain(
      "idx_contract_files_one_current_sealed_contract",
    );
    expect(routeSource).toContain(
      "/:id/sealed-verifications/:verificationId/retry",
    );
    expect(routeSource).not.toContain(
      "/:id/sealed-verifications/:verificationId/confirm",
    );
    expect(routeSource).toContain(
      "/:id/sealed-verifications/:verificationId/reapprove",
    );
    expect(routeSource).toContain(
      "/:id/sealed-verifications/:verificationId/archive",
    );
    expect(routeSource).not.toContain("manuallyProvidedDate");
    expect(routeSource).toMatch(
      /router\.post\("\/:id\/sealed"[\s\S]*?assertSealedContractRecognitionAllowed[\s\S]*?const uploadDate = currentShanghaiDate\(\)[\s\S]*?await recognizeSealedContractFile/,
    );
    expect(sealWorkflowSource).toContain("SEALED_RECOGNITION_BUSY");
    expect(sealWorkflowSource).toContain("CONTRACT_SEAL_OCR_QUEUE_LIMIT");
    expect(sealWorkflowSource).not.toContain(
      "export async function confirmSealedContractVerification",
    );
    expect(sealWorkflowSource).toMatch(
      /retrySealedContractVerification[\s\S]*?assertSealedContractRecognitionAllowed[\s\S]*?recognizeSealedContractFile/,
    );
    expect(serviceSource).toContain("difference_approved");
    expect(serviceSource).toContain("SEALED_DIFFERENCE_APPROVAL_NOT_FOUND");
    expect(serviceSource).not.toContain(
      "export async function archiveSealedContract(",
    );
  });
});
