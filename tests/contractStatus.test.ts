jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import fs from "fs";
import path from "path";
import {
  advanceSupplementAmountChainAtEffective,
  assertContractStatusTransition,
  canTransitionContractStatus,
  ContractDomainError,
  inferAssetFundingMode,
  reverseContractFinancialRecord,
  submitContractForApproval,
  updateContractDraft,
} from "../server/services/contractService";
import { archiveVerifiedSealedContract } from "../server/services/contractSealWorkflow";
import { db } from "../server/db/index";

const CURRENT_AUTOMATIC_POLICY_WARNING =
  "自动采用策略：highest-qualified-candidate-v3";
const CURRENT_AUTOMATIC_ACCEPTED_WARNING =
  "自动采用结果：highest-qualified-candidate-v3：通过";

describe("资产合同资金方式自动判断", () => {
  it("任一方是工程咨询公司时使用直接付款", () => {
    expect(
      inferAssetFundingMode(
        "asset",
        "外部供应商有限公司",
        "北京羽隶工程咨询有限公司",
      ),
    ).toBe("engineering_direct");
  });

  it("唯一我方签约主体不是工程咨询公司时使用内部划拨", () => {
    expect(
      inferAssetFundingMode(
        "asset",
        "外部供应商有限公司",
        "北京羽隶科技有限公司",
      ),
    ).toBe("engineering_to_technology");
  });

  it("第三家已配置我方公司签约时仍使用内部划拨", () => {
    expect(
      inferAssetFundingMode(
        "asset",
        "外部供应商有限公司",
        "北京羽隶设计有限公司",
        [
          {
            name: "北京羽隶工程咨询有限公司",
            taxId: "ENGINEERING-TAX-ID",
          },
          { name: "北京羽隶设计有限公司", taxId: "DESIGN-TAX-ID" },
        ],
      ),
    ).toBe("engineering_to_technology");
  });

  it("我方签约主体未配置或双方均为内部主体时保持待核对", () => {
    expect(
      inferAssetFundingMode("asset", "外部供应商有限公司", "未配置集团公司"),
    ).toBe("pending_review");
    expect(
      inferAssetFundingMode(
        "asset",
        "北京羽隶工程咨询有限公司",
        "北京羽隶科技有限公司",
      ),
    ).toBe("pending_review");
  });

  it("非资产合同不生成资产资金方式", () => {
    expect(
      inferAssetFundingMode(
        "main_business",
        "北京羽隶工程咨询有限公司",
        "客户有限公司",
      ),
    ).toBeNull();
  });
});

function approvalSubmissionFixture(options?: {
  includeSealFile?: boolean;
  signedApplicationVersion?: number | null;
  signerId?: string | null;
  category?: "main_business" | "non_main" | "asset";
}) {
  const includeSealFile = options?.includeSealFile !== false;
  const category = options?.category || "non_main";
  const declaredSubtype = {
    main_business: "engineering_consulting",
    non_main: "non_main_income",
    asset: "software",
  }[category];
  const signedApplicationVersion =
    options?.signedApplicationVersion === undefined
      ? 7
      : options.signedApplicationVersion;
  const contract = {
    id: "contract-online-seal",
    status: "draft",
    relation_type: "main",
    area: "朝阳区",
    declared_category: category,
    declared_subtype: declaredSubtype,
    category,
    business_contract_no:
      category === "main_business" ? "SGTYHT/25-JS-TEST" : null,
    asset_category: category === "asset" ? declaredSubtype : null,
    project_id: null,
    party_a: "甲方",
    party_b: "乙方",
    project_name: "在线用印测试服务",
    amount_delta: 100,
    contract_date: null,
    contract_date_source: null,
    version: 7,
    created_by: "finance-1",
  };
  const recognizedFields = [
    ["party_a", "甲方"],
    ["party_b", "乙方"],
    ["project_name", "在线用印测试服务"],
    ["amount", "100"],
    ["category", category],
    ["contract_date", null],
  ].map(([field_code, final_value]) => ({
    field_code,
    normalized_value: final_value,
    final_value,
    manually_confirmed: false,
    confirmed_by: null,
    confirmed_at: null,
  }));
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT * FROM contracts")) {
        return { rows: [contract] };
      }
      if (sql.includes("FROM contract_ocr_jobs")) {
        return {
          rows: [
            {
              id: "job-online-seal",
              status: "succeeded",
              file_id: "draft-online-seal",
              warnings_json: [
                CURRENT_AUTOMATIC_POLICY_WARNING,
                CURRENT_AUTOMATIC_ACCEPTED_WARNING,
              ],
            },
          ],
        };
      }
      if (sql.includes("FROM contract_files")) {
        return {
          rows: [
            {
              id: "draft-online-seal",
              file_type: "draft_contract",
            },
            ...(includeSealFile
              ? [
                  {
                    id: "signed-seal-application-file",
                    file_type: "seal_application",
                  },
                ]
              : []),
          ],
        };
      }
      if (sql.includes("FROM contract_ocr_fields")) {
        return { rows: recognizedFields };
      }
      if (sql.includes("FROM contract_seal_applications")) {
        return {
          rows:
            signedApplicationVersion === null
              ? []
              : [
                  {
                    signed_file_id: "signed-seal-application-file",
                    contract_version: signedApplicationVersion,
                    signer_id: options?.signerId ?? "finance-1",
                  },
                ],
        };
      }
      if (sql.includes("SELECT id, name, role FROM users")) {
        return {
          rows: [
            {
              id: "general-manager-1",
              name: "测试总经理",
              role: "general_manager",
            },
          ],
        };
      }
      if (sql.includes("UPDATE contracts SET status = 'approving'")) {
        return {
          rows: [
            {
              ...contract,
              status: "approving",
              pending_action: "seal",
              previous_status: "draft",
              version: contract.version + 1,
            },
          ],
        };
      }
      void params;
      return { rows: [] };
    }),
  };
  return { client, contract };
}

describe("合同生命周期状态机", () => {
  it("项目状态只按根合同组计算且终止审批沿用申请前状态", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(source).toContain("root_groups AS");
    expect(source).toContain("effective_root_status");
    expect(source).toContain("root_contract.pending_action = 'termination'");
    expect(source).toContain("root_contract.current_effective_amount");
    expect(source).not.toContain(
      "EXISTS (SELECT 1 FROM eligible WHERE status = 'effective')",
    );
  });

  it("子协议审批串行预留金额并阻止核减到已结算金额以下", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(source).toContain("contract-root-approval:");
    expect(source).toContain("includeApprovedReservations");
    expect(source).toContain("status = 'pending_seal'");
    expect(source).toContain("previous_status = 'pending_seal'");
    expect(source).toContain("pending_action = 'seal'");
    expect(source).toContain("CONTRACT_TOTAL_BELOW_SETTLED");
    expect(source).toContain("CONTRACT_PENDING_CHILD_SEAL");
  });

  it("详情页区分六步主流程、终止介入状态与已拒绝分支", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(source).toMatch(/watch\(\s*contractId,/);
    expect(source).toContain("resetDetailViewState()");
    expect(source).toContain("rejected-lifecycle");
    expect(source).toContain('{ value: "rejected", label: "已拒绝" }');
    expect(source).toContain("terminationLifecycleNotice");
    expect(source).toContain("终止作为独立状态介入，不占用主流程节点");
    expect(source).not.toContain('{ value: "terminated", label: "已终止" }');
    expect(source.match(/grid-template-columns: repeat\(6,/g)).toHaveLength(2);
  });

  it("允许标准用印和执行状态流转", () => {
    expect(canTransitionContractStatus("draft", "approving")).toBe(true);
    expect(canTransitionContractStatus("approving", "pending_seal")).toBe(true);
    expect(canTransitionContractStatus("approving", "rejected")).toBe(true);
    expect(canTransitionContractStatus("pending_seal", "effective")).toBe(true);
    expect(canTransitionContractStatus("effective", "executing")).toBe(true);
    expect(canTransitionContractStatus("effective", "completed")).toBe(true);
    expect(canTransitionContractStatus("executing", "completed")).toBe(true);
    expect(canTransitionContractStatus("completed", "executing")).toBe(true);
  });

  it("拒绝跳过审批、盖章及终止后的非法修改", () => {
    expect(() => assertContractStatusTransition("draft", "effective")).toThrow(
      ContractDomainError,
    );
    expect(canTransitionContractStatus("rejected", "draft")).toBe(false);
    expect(canTransitionContractStatus("terminated", "draft")).toBe(false);
  });

  it("项目金额快照排除已拒绝根合同并使用独立状态文案", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(source).toContain(
      "WHERE effective_root_status IN ('effective', 'executing', 'completed')",
    );
    expect(source).toContain("effective_root_status = 'rejected'");
    expect(source).toContain("THEN '已拒绝'");
  });

  it("数据库、接口元数据和前端展示均声明已拒绝状态", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const presentationSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractPresentation.ts"),
      "utf8",
    );
    expect(databaseSource).toContain("'completed', 'rejected', 'terminated'");
    expect(databaseSource).toContain("ADD CONSTRAINT contracts_status_check");
    expect(databaseSource).toContain(
      "ADD CONSTRAINT contracts_asset_project_check",
    );
    expect(databaseSource).toContain(
      "CHECK(COALESCE(declared_category, category) IS DISTINCT FROM 'asset' OR project_id IS NULL)",
    );
    expect(databaseSource).toContain("'difference_rejected'");
    expect(routeSource).toContain('{ value: "rejected", label: "已拒绝" }');
    expect(presentationSource).toContain('rejected: "已拒绝"');
  });

  it("租赁续签冻结旧到期日并在盖章归档后推进主合同当前租期", () => {
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
    const sealSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractSealWorkflow.ts"),
      "utf8",
    );

    expect(databaseSource).toContain("lease_operation_type TEXT");
    expect(databaseSource).toContain("lease_previous_end_date TEXT");
    expect(databaseSource).toContain(
      "lease_operation_type IS NULL OR relation_type = 'supplement'",
    );
    expect(routeSource).toContain('"/:id/renewals/recognize"');
    expect(routeSource).toContain(
      "recognizedChangeAmount: leaseTerms.totalAmount",
    );
    expect(routeSource).toContain("leasePreviousEndDate");
    expect(serviceSource).toContain("CONTRACT_RENTAL_RENEWAL_STALE");
    expect(sealSource).toContain("rental_renewal_effective");
    expect(sealSource).toContain("lease_end_date = $2");
    expect(sealSource).toContain(
      "sealedLeaseTerms.leaseEndDate !== contract.lease_end_date",
    );
  });

  it("补充协议归档后重算已完成根合同为执行中", async () => {
    const child = {
      id: "supplement-1",
      status: "pending_seal",
      root_contract_id: "root-1",
      parent_contract_id: "root-1",
      relation_type: "supplement",
      project_id: "project-1",
      party_a: "甲方",
      party_b: "乙方",
      contract_date: null,
      amount_delta: 50,
      recognized_final_amount: null,
      amount_before_change: 100,
      amount_after_change: 150,
      supplement_change_type: "amount_adjustment",
      supplement_sequence: 1,
      version: 2,
    };
    const root = {
      id: "root-1",
      status: "completed",
      relation_type: "main",
      root_contract_id: "root-1",
      project_id: "project-1",
      category: "main_business",
      financial_direction: "income",
      current_effective_amount: 100,
    };
    const verification = {
      id: "verification-1",
      contract_id: child.id,
      file_id: "file-1",
      status: "ready_to_archive",
      upload_date: "2026-08-05",
      approved_snapshot_json: {
        partyA: "甲方",
        partyB: "乙方",
        amount: 50,
        amountVerificationRequired: true,
      },
      recognition_status: "succeeded",
      recognition_method: "pdf_text",
      recognition_warnings_json: [],
      raw_text: "",
      mismatches_json: [],
      infrastructure_failure: false,
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
      file_is_current: true,
      file_name: "盖章合同.pdf",
      mime_type: "application/pdf",
    };
    const verificationFields = [
      ["party_a", "甲方"],
      ["party_b", "乙方"],
      ["amount", "50"],
      ["contract_date", "2026-08-01"],
    ].map(([field_code, final_value]) => ({
      field_code,
      approved_value: final_value,
      recognized_value: final_value,
      final_value,
      confidence: 100,
      source: "pdf_text",
      requires_manual_confirmation: false,
      manually_confirmed: false,
      is_mismatch: false,
    }));
    let childEffective = false;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes(
            "SELECT id, root_contract_id, renewed_from_contract_id FROM contracts",
          )
        ) {
          return {
            rows: [
              {
                id: child.id,
                root_contract_id: child.root_contract_id,
                renewed_from_contract_id: null,
              },
            ],
          };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          params?.[0] === child.id
        ) {
          return {
            rows: [childEffective ? { ...child, status: "effective" } : child],
          };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          params?.[0] === root.id
        ) {
          return { rows: [root] };
        }
        if (sql.includes("FROM contract_seal_verifications v")) {
          return {
            rows: [
              {
                ...verification,
                status: childEffective ? "archived" : verification.status,
              },
            ],
          };
        }
        if (sql.includes("FROM contract_seal_verification_fields")) {
          return { rows: verificationFields };
        }
        if (sql.includes("AS next_total")) {
          return { rows: [{ next_total: 150 }] };
        }
        if (sql.includes("AS received_amount")) {
          return { rows: [{ received_amount: 100, paid_amount: 0 }] };
        }
        if (sql.includes("UPDATE contracts SET current_effective_amount")) {
          return {
            rows: [{ ...root, current_effective_amount: params?.[1] }],
          };
        }
        if (sql.includes("UPDATE contracts SET status = 'effective'")) {
          childEffective = true;
          return { rows: [{ ...child, status: "effective" }] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 150,
                invoice_count: 1,
                receipt_total: 100,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return { rows: [{ ...root, status: params?.[1] }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await archiveVerifiedSealedContract({
      contractId: child.id,
      verificationId: verification.id,
      actorId: "finance-1",
      actorRole: "admin",
      expectedVersion: 2,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET status = $2"),
      expect.arrayContaining(["root-1", "executing"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPDATE contracts SET current_effective_amount = $2",
      ),
      expect.arrayContaining(["root-1", 150]),
    );
  });

  it("补充协议审批金额基准过期时拒绝推进根合同当前金额", async () => {
    const contract = {
      id: "supplement-stale",
      relation_type: "supplement",
      root_contract_id: "root-1",
      parent_contract_id: "root-1",
      amount_delta: 50,
      recognized_final_amount: null,
      amount_before_change: 100,
      amount_after_change: 150,
      supplement_change_type: "amount_adjustment",
      supplement_sequence: 2,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("SELECT * FROM contracts") &&
          sql.includes("relation_type = 'main'")
        ) {
          return {
            rows: [
              {
                id: "root-1",
                relation_type: "main",
                current_effective_amount: 120,
              },
            ],
          };
        }
        if (sql.includes("SELECT id, supplement_sequence AS sequence")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await expect(
      advanceSupplementAmountChainAtEffective(
        client as never,
        contract as never,
        "2026-08-16T00:00:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "SUPPLEMENT_AMOUNT_SNAPSHOT_STALE",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes(
          "UPDATE contracts SET current_effective_amount = $2",
        ),
      ),
    ).toBe(false);
  });

  it("未关联项目的主营合同识别任务仍在执行时拒绝提交审批", async () => {
    const contract = {
      id: "contract-1",
      status: "draft",
      relation_type: "main",
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "测试项目",
      amount_delta: 100,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              { id: "job-1", status: "processing", file_id: "draft-file-1" },
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
      submitContractForApproval("contract-1", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "OCR_JOB_IN_PROGRESS",
    });
  });

  it("识别任务缺少合同签订日期时拒绝提交审批", async () => {
    const contract = {
      id: "contract-2",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "测试服务",
      amount_delta: 100,
      contract_date: "2026-08-05",
      contract_date_source: "ocr",
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-2",
                status: "succeeded",
                file_id: "draft-file-2",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [{ id: "draft-file-2", file_type: "draft_contract" }],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return {
            rows: [
              {
                field_code: "party_a",
                confidence: 98,
                normalized_value: "甲方",
                final_value: "甲方",
              },
              {
                field_code: "party_b",
                confidence: 98,
                normalized_value: "乙方",
                final_value: "乙方",
              },
              {
                field_code: "project_name",
                confidence: 98,
                normalized_value: "测试服务",
                final_value: "测试服务",
              },
              {
                field_code: "amount",
                confidence: 98,
                normalized_value: "100",
                final_value: "100",
              },
              {
                field_code: "category",
                confidence: 98,
                normalized_value: "non_main",
                final_value: "non_main",
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

    await expect(
      submitContractForApproval("contract-2", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "OCR_FIELDS_INCOMPLETE",
      message: expect.stringContaining("contract_date"),
    });
  });

  it("识别任务成功后允许低于100分的最高合格候选通过审批识别门禁", async () => {
    const contract = {
      id: "contract-confidence-98",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "测试服务",
      amount_delta: 100,
      contract_date: "2026-08-05",
      contract_date_source: "ocr",
    };
    const recognizedFields = [
      ["party_a", "甲方", 100],
      ["party_b", "乙方", 98],
      ["project_name", "测试服务", 100],
      ["amount", "100", 100],
      ["category", "non_main", 100],
      ["contract_date", "2026-08-05", 100],
    ].map(([field_code, final_value, confidence]) => ({
      field_code,
      normalized_value: final_value,
      final_value,
      confidence,
      manually_confirmed: false,
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-confidence-98",
                status: "succeeded",
                file_id: "draft-confidence-98",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-confidence-98",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval("contract-confidence-98", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("补充协议系统继承名称含全角序号时不误报识别值变化", async () => {
    const rootName = "焦化厂110千伏输变电工程前期手续技术咨询服务";
    const inheritedName = `${rootName}补充协议（1）`;
    const contract = {
      id: "supplement-fullwidth-sequence",
      status: "draft",
      relation_type: "supplement",
      parent_contract_id: "root-fullwidth-sequence",
      root_contract_id: "root-fullwidth-sequence",
      supplement_sequence: 1,
      area: "朝阳区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      party_a: "国网北京市电力公司",
      party_b: "北京羽隶工程咨询有限公司",
      title: inheritedName,
      project_name: inheritedName,
      amount_delta: 95000,
      original_contract_amount: 400000,
      recognized_original_amount: 400000,
      recognized_final_amount: 495000,
      amount_before_change: 400000,
      amount_after_change: 495000,
      supplement_change_type: "amount_adjustment",
      contract_date: null,
      contract_date_source: null,
      version: 3,
      created_by: "finance-1",
    };
    const root = {
      id: "root-fullwidth-sequence",
      status: "effective",
      relation_type: "main",
      parent_contract_id: null,
      root_contract_id: "root-fullwidth-sequence",
      area: "朝阳区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      title: null,
      project_name: rootName,
      amount_delta: 400000,
      original_contract_amount: 400000,
      current_effective_amount: 400000,
    };
    const recognizedFields = [
      ["party_a", contract.party_a, contract.party_a],
      ["party_b", contract.party_b, contract.party_b],
      ["project_name", "焦化厂110千伏输变电工程前期手续", inheritedName],
      ["amount", "95000.00", "95000.00"],
      ["category", "main_business", "main_business"],
      ["contract_date", null, null],
    ].map(([field_code, normalized_value, final_value]) => ({
      field_code,
      normalized_value,
      final_value,
      manually_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
    }));
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [params?.[0] === root.id ? root : contract],
          };
        }
        if (sql.includes("AS received_amount")) {
          return { rows: [{ received_amount: 0, paid_amount: 0 }] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-fullwidth-sequence",
                status: "succeeded",
                file_id: "draft-fullwidth-sequence",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-fullwidth-sequence",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        if (sql.includes("FROM contract_seal_applications")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "supplement-fullwidth-sequence",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
    });
  });

  it("仅上传同类型文件不能绕过在线电子签名门禁", async () => {
    const { client } = approvalSubmissionFixture({
      includeSealFile: true,
      signedApplicationVersion: null,
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval("contract-online-seal", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("在线签名对应旧合同版本时拒绝提交审批", async () => {
    const { client } = approvalSubmissionFixture({
      signedApplicationVersion: 6,
    });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval("contract-online-seal", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SEAL_APPLICATION_CONTRACT_VERSION_MISMATCH",
      message: "合同内容在用印申请单签名后发生变化，请重新确认并签名",
    });
  });

  it("在线用印申请不是合同创建人本人签署时拒绝提交审批", async () => {
    const { client } = approvalSubmissionFixture({ signerId: "finance-2" });
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval("contract-online-seal", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "SEAL_APPLICATION_CREATOR_SIGNATURE_REQUIRED",
      message: "用印申请单必须由合同创建人本人完成电子签名",
    });
  });

  it.each([
    ["主营项目合同", "main_business"],
    ["非主营项目合同", "non_main"],
    ["资产类合同", "asset"],
  ] as const)(
    "%s当前版本在线签名齐全时无需三联单和请款单即可提交审批",
    async (_label, category) => {
      const { client } = approvalSubmissionFixture({ category });
      (db.transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transactionClient: typeof client) => unknown) =>
          callback(client),
      );

      await expect(
        submitContractForApproval("contract-online-seal", "finance-1", "admin"),
      ).resolves.toMatchObject({
        id: "contract-online-seal",
        status: "approving",
        pending_action: "seal",
        version: 8,
      });

      const documentQuery = client.query.mock.calls.find(([sql]) =>
        String(sql).includes("FROM contract_files"),
      );
      expect(documentQuery?.[1]).toEqual([
        "contract-online-seal",
        ["draft_contract", "seal_application"],
      ]);
      expect(JSON.stringify(client.query.mock.calls)).not.toContain(
        "triplicate",
      );
      expect(JSON.stringify(client.query.mock.calls)).not.toContain(
        "payment_request",
      );
    },
  );

  it("识别任务成功后允许合法空项目、金额和日期通过审批识别门禁", async () => {
    const contract = {
      id: "contract-framework-empty",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: null,
      amount_delta: null,
      contract_date: null,
      contract_date_source: null,
    };
    const recognizedFields = [
      ["party_a", "甲方"],
      ["party_b", "乙方"],
      ["project_name", null],
      ["amount", null],
      ["category", "non_main"],
      ["contract_date", null],
    ].map(([field_code, final_value]) => ({
      field_code,
      normalized_value: final_value,
      final_value,
      confidence: 82,
      manually_confirmed: false,
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-framework-empty",
                status: "succeeded",
                file_id: "draft-framework-empty",
                raw_text: "前期手续咨询服务框架采购协议",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-framework-empty",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "contract-framework-empty",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("审批门禁通过当前策略标记与不可变字段证明允许安全金额为空", async () => {
    const contract = {
      id: "contract-missing-amount",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "现场资料整理服务",
      amount_delta: null,
      contract_date: "2026-08-05",
      contract_date_source: "ocr",
    };
    const recognizedFields = [
      ["party_a", "甲方"],
      ["party_b", "乙方"],
      ["project_name", "现场资料整理服务"],
      ["amount", null],
      ["category", "non_main"],
      ["contract_date", "2026-08-05"],
    ].map(([field_code, final_value]) => ({
      field_code,
      normalized_value: final_value,
      final_value,
      manually_confirmed: false,
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-missing-amount",
                status: "succeeded",
                file_id: "draft-missing-amount",
                raw_text:
                  "技术服务合同\n项目名称：现场资料整理服务\n付款方式由双方另行约定。",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-missing-amount",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "contract-missing-amount",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("审批门禁拒绝没有当前策略标记的伪造成功任务", async () => {
    const contract = {
      id: "contract-ordinary-empty",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: null,
      amount_delta: null,
      contract_date: null,
      contract_date_source: null,
    };
    const recognizedFields = [
      ["party_a", "甲方"],
      ["party_b", "乙方"],
      ["project_name", null],
      ["amount", null],
      ["category", "non_main"],
      ["contract_date", null],
    ].map(([field_code, final_value]) => ({
      field_code,
      final_value,
      manually_confirmed: false,
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-ordinary-empty",
                status: "succeeded",
                file_id: "draft-ordinary-empty",
                raw_text: "技术服务合同",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-ordinary-empty",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "contract-ordinary-empty",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "OCR_AUTOMATIC_POLICY_STALE",
      message: expect.stringContaining("没有当前自动采用通过证明"),
    });
  });

  it("审批门禁拒绝自动采用与人工确认混合证明", async () => {
    const contract = {
      id: "contract-mixed-attestation",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "测试服务",
      amount_delta: 100,
      contract_date: "2026-08-05",
      contract_date_source: "ocr",
    };
    const recognizedFields = [
      ["party_a", "甲方"],
      ["party_b", "乙方"],
      ["project_name", "测试服务"],
      ["amount", "100"],
      ["category", "non_main"],
      ["contract_date", "2026-08-05"],
    ].map(([field_code, final_value]) => ({
      field_code,
      normalized_value: final_value,
      final_value,
      manually_confirmed: field_code === "project_name",
      confirmed_by: field_code === "project_name" ? "finance-1" : null,
      confirmed_at:
        field_code === "project_name" ? "2026-08-10T00:00:00.000Z" : null,
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-mixed-attestation",
                status: "succeeded",
                file_id: "draft-mixed-attestation",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-mixed-attestation",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "contract-mixed-attestation",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "OCR_MANUAL_CONFIRMATION_INCOMPLETE",
    });
  });

  it("审批门禁允许具有完整确认元数据的整组六字段人工证明", async () => {
    const contract = {
      id: "contract-all-manual",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "人工核对服务",
      amount_delta: 100,
      contract_date: "2026-08-05",
      contract_date_source: "manual",
    };
    const recognizedFields = [
      ["party_a", "甲方", "甲方"],
      ["party_b", "乙方", "乙方"],
      ["project_name", "错误候选", "人工核对服务"],
      ["amount", "100", "100"],
      ["category", "non_main", "non_main"],
      ["contract_date", "2026-08-05", "2026-08-05"],
    ].map(([field_code, normalized_value, final_value]) => ({
      field_code,
      normalized_value,
      final_value,
      manually_confirmed: true,
      confirmed_by: "finance-1",
      confirmed_at: "2026-08-10T00:00:00.000Z",
    }));
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-all-manual",
                status: "succeeded",
                file_id: "draft-all-manual",
                warnings_json: [],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [{ id: "draft-all-manual", file_type: "draft_contract" }],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval("contract-all-manual", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("审批门禁允许五个必需字段完成人工证明且草拟日期留空", async () => {
    const contract = {
      id: "contract-manual-without-date",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "人工核对服务",
      amount_delta: 100,
      contract_date: null,
      contract_date_source: null,
    };
    const recognizedFields = [
      ["party_a", "甲方", "甲方"],
      ["party_b", "乙方", "乙方"],
      ["project_name", "错误候选", "人工核对服务"],
      ["amount", "100", "100"],
      ["category", "non_main", "non_main"],
    ].map(([field_code, normalized_value, final_value]) => ({
      field_code,
      normalized_value,
      final_value,
      manually_confirmed: true,
      confirmed_by: "finance-1",
      confirmed_at: "2026-08-10T00:00:00.000Z",
    }));
    recognizedFields.push({
      field_code: "contract_date",
      normalized_value: null,
      final_value: null,
      manually_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
    });
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-manual-without-date",
                status: "succeeded",
                file_id: "draft-manual-without-date",
                warnings_json: [],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [
              {
                id: "draft-manual-without-date",
                file_type: "draft_contract",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_ocr_fields")) {
          return { rows: recognizedFields };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      submitContractForApproval(
        "contract-manual-without-date",
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "SEAL_APPLICATION_SIGNATURE_REQUIRED",
      message: "请先在线填写用印申请单并完成本人电子签名",
    });
  });

  it("识别任务文件不是当前草拟合同时拒绝提交审批", async () => {
    const contract = {
      id: "contract-3",
      status: "draft",
      relation_type: "main",
      area: "朝阳区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      party_a: "甲方",
      party_b: "乙方",
      project_name: "测试服务",
      amount_delta: 100,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("FROM contract_ocr_jobs")) {
          return {
            rows: [
              {
                id: "job-old",
                status: "succeeded",
                file_id: "draft-old",
                warnings_json: [
                  CURRENT_AUTOMATIC_POLICY_WARNING,
                  CURRENT_AUTOMATIC_ACCEPTED_WARNING,
                ],
              },
            ],
          };
        }
        if (sql.includes("FROM contract_files")) {
          return {
            rows: [{ id: "draft-current", file_type: "draft_contract" }],
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
      submitContractForApproval("contract-3", "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "OCR_FILE_VERSION_MISMATCH",
    });
  });

  it("资产类补充协议继承分类且保持项目为空", async () => {
    const draft = {
      id: "child-1",
      status: "draft",
      relation_type: "supplement",
      root_contract_id: "root-asset-1",
      parent_contract_id: "root-asset-1",
      area: "朝阳区",
      project_id: null,
      declared_category: "asset",
      declared_subtype: "parking_space",
      category: "asset",
      asset_category: "parking_space",
      amount_delta: 20,
      version: 1,
    };
    const parent = {
      id: "root-asset-1",
      status: "executing",
      relation_type: "main",
      root_contract_id: "root-asset-1",
      parent_contract_id: null,
      project_id: null,
      area: "朝阳区",
      category: "asset",
      declared_subtype: "parking_space",
      asset_category: "parking_space",
      title: "车位合同",
      project_name: "车位合同",
    };
    let updateParams: unknown[] = [];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("SELECT * FROM contracts") &&
          sql.includes("FOR UPDATE")
        ) {
          return { rows: [draft] };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          sql.includes("FOR SHARE")
        ) {
          return { rows: [parent] };
        }
        if (sql.includes("UPDATE contracts SET")) {
          updateParams = params || [];
          return {
            rows: [
              {
                ...draft,
                relation_type: "supplement",
                category: "asset",
                asset_category: "parking_space",
                project_id: null,
                parent_contract_id: "root-asset-1",
                root_contract_id: "root-asset-1",
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

    await updateContractDraft(
      "child-1",
      {
        expectedVersion: 1,
        parentContractId: "root-asset-1",
        projectId: null,
        category: "asset",
        amountDelta: 20,
      },
      "finance-1",
      "admin",
    );

    expect(updateParams[3]).toBe("asset");
    expect(updateParams[4]).toBe("parking_space");
    expect(updateParams[7]).toBeNull();
    expect(updateParams[8]).toBe("root-asset-1");
    expect(updateParams[9]).toBe("root-asset-1");
  });

  it("资产类合同拒绝关联项目", async () => {
    const draft = {
      id: "asset-contract-1",
      status: "draft",
      relation_type: "main",
      root_contract_id: "asset-contract-1",
      parent_contract_id: null,
      area: "朝阳区",
      project_id: null,
      declared_category: "asset",
      declared_subtype: "software",
      category: "asset",
      asset_category: "software",
      amount_delta: 100,
      version: 1,
    };
    const client = {
      query: jest.fn(async (sql: string) =>
        sql.includes("SELECT * FROM contracts")
          ? { rows: [draft] }
          : { rows: [] },
      ),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      updateContractDraft(
        draft.id,
        { expectedVersion: 1, projectId: "project-1" },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_ASSET_PROJECT_NOT_ALLOWED",
    });
  });

  it("已终止根合同不能新增子协议", async () => {
    const draft = {
      id: "child-2",
      status: "draft",
      relation_type: "termination",
      area: "海淀区",
      root_contract_id: "root-terminated",
      parent_contract_id: "root-terminated",
      project_id: null,
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      amount_delta: 10,
      version: 1,
    };
    const terminatedParent = {
      id: "root-terminated",
      status: "terminated",
      relation_type: "main",
      root_contract_id: "root-terminated",
      project_id: "project-1",
      area: "海淀区",
      category: "main_business",
      asset_category: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FOR UPDATE")) return { rows: [draft] };
        if (sql.includes("FOR SHARE")) return { rows: [terminatedParent] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      updateContractDraft(
        "child-2",
        {
          expectedVersion: 1,
          parentContractId: "root-terminated",
          amountDelta: -10,
        },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_PARENT_NOT_EFFECTIVE",
    });
  });

  it("在根合同详情中可以冲正子协议名下的财务记录", async () => {
    const child = {
      id: "child-finance",
      root_contract_id: "root-finance",
      project_id: "project-1",
      status: "effective",
    };
    const root = {
      id: "root-finance",
      root_contract_id: "root-finance",
      project_id: "project-1",
      status: "executing",
      category: "main_business",
    };
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_receipts") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "child-finance",
                file_id: "receipt-file-1",
                status: "confirmed",
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return {
            rows: [
              { id: "child-finance", root_id: "root-finance" },
              { id: "root-finance", root_id: "root-finance" },
            ],
          };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          params?.[0] === child.id
        ) {
          return { rows: [child] };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          params?.[0] === root.id
        ) {
          return { rows: [root] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 100,
                invoice_count: 1,
                receipt_total: 60,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("SELECT id FROM worklog_projects")) {
          return { rows: [{ id: "project-1" }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      reverseContractFinancialRecord(
        "receipt",
        "receipt-1",
        "finance-1",
        "admin",
        "银行退回款项",
        "root-finance",
      ),
    ).resolves.toMatchObject({ id: "root-finance" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reversed'"),
      expect.arrayContaining(["receipt-1", "finance-1"]),
    );
  });
});
