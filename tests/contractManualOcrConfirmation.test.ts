jest.mock("nanoid", () => ({ nanoid: () => "audit-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import { db } from "../server/db/index";
import {
  confirmContractOcrFields,
  ContractDomainError,
  type ContractOcrCoreField,
} from "../server/services/contractService";

const validFields: Record<ContractOcrCoreField, string> = {
  party_a: "国网北京市电力公司",
  party_b: "北京羽隶工程咨询有限公司",
  project_name: "跃进110千伏输变电工程不动产登记（土地证）",
  amount: "95000.00",
  category: "main_business",
  contract_date: "2025-08-25",
};

const validReviewedFields = {
  party_a: true,
  party_b: true,
  project_name: true,
  amount: true,
  category: true,
  contract_date: true,
} as const;

const draftFieldsWithoutDate: Record<ContractOcrCoreField, string> = {
  ...validFields,
  contract_date: "",
};

const requiredDraftFieldsReviewed = {
  ...validReviewedFields,
  contract_date: false,
} as const;

function createConfirmationClient(
  options: {
    declaredCategory?: "main_business" | "non_main" | "asset";
    jobStatus?: string;
    relationType?: "main" | "supplement";
    parentBusinessNo?: string | null;
    referencedBusinessNo?: string;
    ownBusinessNo?: string;
  } = {},
) {
  const contract = {
    id: "contract-1",
    contract_no: "HT-20260805-000001",
    title: null,
    description: null,
    declared_category: options.declaredCategory || "main_business",
    declared_subtype:
      options.declaredCategory === "asset"
        ? "software"
        : options.declaredCategory === "non_main"
          ? "non_main_income"
          : "engineering_consulting",
    category: null,
    asset_category: null,
    relation_type: options.relationType || "main",
    status: "draft",
    area: "丰台区",
    project_id: null,
    parent_contract_id:
      options.relationType === "supplement" ? "parent-1" : null,
    root_contract_id:
      options.relationType === "supplement" ? "parent-1" : "contract-1",
    party_a: null,
    party_b: null,
    project_name: null,
    amount_delta: null,
    contract_date: null,
    contract_date_source: null,
    pending_action: null,
    previous_status: null,
    version: 3,
    created_by: "finance-1",
    updated_by: "finance-1",
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
  } as const;
  const storedFields = new Map<
    ContractOcrCoreField,
    {
      field_code: ContractOcrCoreField;
      original_value: string | null;
      normalized_value: string | null;
      final_value: string | null;
      confidence: number;
      source: string;
      page_number: number | null;
      evidence: string | null;
      manually_confirmed: boolean;
      confirmed_by: string | null;
      confirmed_at: string | null;
    }
  >(
    [
      ["party_a", validFields.party_a, 100],
      ["party_b", validFields.party_b, 99],
      ["project_name", "跃进110千伏输变电工程不动产登记", 100],
      ["amount", "95000", 100],
      ["category", "main_business", 100],
      ["contract_date", null, 0],
    ].map(([fieldCode, normalizedValue, confidence]) => [
      fieldCode as ContractOcrCoreField,
      {
        field_code: fieldCode as ContractOcrCoreField,
        original_value:
          normalizedValue === null ? null : String(normalizedValue),
        normalized_value:
          normalizedValue === null ? null : String(normalizedValue),
        final_value: null,
        confidence: Number(confidence),
        source: "ocr_600",
        page_number: 1,
        evidence: `证据-${fieldCode}`,
        manually_confirmed: false,
        confirmed_by: null,
        confirmed_at: null,
      },
    ]),
  );

  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT * FROM contracts")) {
        if (params[0] === "parent-1") {
          return {
            rows: [
              {
                ...contract,
                id: "parent-1",
                relation_type: "main",
                status: "effective",
                parent_contract_id: null,
                root_contract_id: "parent-1",
                category: "main_business",
                business_contract_no:
                  options.parentBusinessNo ?? "PARENT-CONTRACT-001",
              },
            ],
          };
        }
        return { rows: [contract] };
      }
      if (sql.includes("SELECT job.id, job.status")) {
        return {
          rows: [
            {
              id: "job-1",
              status: options.jobStatus || "partial",
              file_type: "draft_contract",
              is_current: true,
            },
          ],
        };
      }
      if (
        sql.includes("SELECT id FROM contract_ocr_jobs") &&
        sql.includes("ORDER BY created_at DESC")
      ) {
        return { rows: [{ id: "job-1" }] };
      }
      if (sql.includes("SELECT field_code, normalized_value, confidence")) {
        return { rows: [...storedFields.values()] };
      }
      if (sql.includes("FROM contract_ocr_lines WHERE job_id")) {
        return {
          rows: [
            {
              page_number: 1,
              text:
                options.relationType === "supplement"
                  ? `二维码合同编号：${options.ownBusinessNo || "PARENT-CONTRACT-001(B1)"}`
                  : `合同编号：${options.ownBusinessNo || "CURRENT-CONTRACT-001"}`,
              bbox_json: [],
              confidence: 0.99,
              model_version: "v6_medium",
            },
            ...(options.relationType === "supplement"
              ? [
                  {
                    page_number: 2,
                    text: `原合同编号：${options.referencedBusinessNo || "PARENT-CONTRACT-001"}`,
                    bbox_json: [],
                    confidence: 0.99,
                    model_version: "v6_medium",
                  },
                ]
              : []),
          ],
        };
      }
      if (
        sql.includes("SELECT id FROM contracts") &&
        sql.includes("business_contract_no")
      ) {
        return { rows: [] };
      }
      if (sql.includes("UPDATE contract_ocr_fields SET")) {
        const fieldCode = params[1] as ContractOcrCoreField;
        const field = storedFields.get(fieldCode)!;
        field.final_value =
          params[2] === null || params[2] === undefined
            ? null
            : String(params[2]);
        field.manually_confirmed = Boolean(params[3]);
        field.confirmed_by = field.manually_confirmed
          ? String(params[4])
          : null;
        field.confirmed_at = field.manually_confirmed
          ? String(params[5])
          : null;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE contracts SET") && sql.includes("party_a")) {
        return {
          rows: [
            {
              ...contract,
              party_a: params[1],
              party_b: params[2],
              project_name: params[3],
              amount_delta: params[4],
              category: params[5],
              contract_date: params[6],
              contract_date_source: params[7],
              business_contract_no: params[8],
              updated_by: params[9],
              version: 4,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE contract_ocr_jobs SET")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO contract_audit_logs")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SELECT field_code, original_value")) {
        return { rows: [...storedFields.values()] };
      }
      throw new Error(`未处理的测试 SQL：${sql}`);
    }),
  };
  return { client, storedFields };
}

describe("合同低可信字段财务确认", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("补充协议人工确认不能绕过原合同编号与上级合同核对", async () => {
    const { client } = createConfirmationClient({
      relationType: "supplement",
      parentBusinessNo: "PARENT-CONTRACT-001",
      referencedBusinessNo: "OTHER-CONTRACT-002",
    });
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) => callback(client as never));

    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, amount: "-142500.00" },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_PARENT_BUSINESS_NUMBER_MISMATCH",
    });
  });

  it("日期填写时核对四个识别字段与日期，合同类型沿用上传前选择", async () => {
    const { client, storedFields } = createConfirmationClient();
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) => callback(client as never));

    const result = await confirmContractOcrFields({
      contractId: "contract-1",
      jobId: "job-1",
      expectedVersion: 3,
      actorId: "finance-1",
      actorRole: "admin",
      fields: validFields,
      reviewedFields: validReviewedFields,
    });

    expect(result.contract.version).toBe(4);
    expect(result.contract.contract_date_source).toBe("manual");
    expect(result.fields).toHaveLength(6);
    expect(storedFields.get("category")).toMatchObject({
      final_value: "main_business",
      manually_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
    });
    expect(
      [...storedFields.values()]
        .filter((field) => field.field_code !== "category")
        .every((field) => field.manually_confirmed),
    ).toBe(true);
    expect(storedFields.get("contract_date")?.final_value).toBe("2025-08-25");
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("status = 'succeeded'"),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO contract_audit_logs"),
      ),
    ).toBe(true);
    const auditCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO contract_audit_logs"),
    );
    expect(JSON.parse(String(auditCall?.[1]?.[7]))).toMatchObject({
      reviewRequiredFields: [
        "party_a",
        "party_b",
        "project_name",
        "amount",
        "contract_date",
      ],
      reviewedFields: [
        "party_a",
        "party_b",
        "project_name",
        "amount",
        "contract_date",
      ],
      preservedAutomaticFields: ["category"],
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("草拟合同日期留空时只核对四个识别必需字段并保留空日期", async () => {
    const { client, storedFields } = createConfirmationClient();
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) => callback(client as never));

    const result = await confirmContractOcrFields({
      contractId: "contract-1",
      jobId: "job-1",
      expectedVersion: 3,
      actorId: "finance-1",
      actorRole: "admin",
      fields: draftFieldsWithoutDate,
      reviewedFields: requiredDraftFieldsReviewed,
    });

    expect(result.contract.contract_date).toBeNull();
    expect(result.contract.contract_date_source).toBeNull();
    expect(storedFields.get("contract_date")).toMatchObject({
      final_value: null,
      manually_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
    });
    expect(
      [...storedFields.values()]
        .filter(
          (field) =>
            field.field_code !== "contract_date" &&
            field.field_code !== "category",
        )
        .every((field) => field.manually_confirmed),
    ).toBe(true);
    const auditCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO contract_audit_logs"),
    );
    expect(JSON.parse(String(auditCall?.[1]?.[7]))).toMatchObject({
      reviewRequiredFields: ["party_a", "party_b", "project_name", "amount"],
      manuallyConfirmedFields: ["party_a", "party_b", "project_name", "amount"],
      optionalEmptyFields: ["contract_date"],
      contractDateSource: null,
    });
  });

  it("由服务端按最新字段重算核对清单并拒绝缺失或非true凭据", async () => {
    const { client } = createConfirmationClient();
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) => callback(client as never));

    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        // project_name 原为整数 100 分，但本次提交值已修改，服务端仍须要求核对。
        reviewedFields: { party_b: true, contract_date: true },
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 400,
      code: "OCR_FIELD_REVIEW_REQUIRED",
    });

    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        reviewedFields: {
          ...validReviewedFields,
          contract_date: false,
        },
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 400,
      code: "OCR_FIELD_REVIEW_REQUIRED",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contract_ocr_fields SET"),
      ),
    ).toBe(false);
  });

  it("拒绝缺失或伪造的核对凭据对象", async () => {
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        reviewedFields: undefined,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 400,
      code: "OCR_FIELD_REVIEW_REQUIRED",
    });
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        reviewedFields: { contract_date: "true" },
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 400,
      code: "OCR_FIELD_REVIEW_INVALID",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("拒绝相同甲乙方、无效日期和不完整字段", async () => {
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, party_b: validFields.party_a },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "CONTRACT_PARTIES_IDENTICAL",
    });
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, contract_date: "2025-02-30" },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "CONTRACT_DATE_INVALID",
    });
    const incomplete = { ...validFields } as Partial<typeof validFields>;
    delete incomplete.contract_date;
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: incomplete as typeof validFields,
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "OCR_CONFIRMATION_FIELDS_INVALID",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("拒绝非财务角色进入人工确认事务", async () => {
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "manager-1",
        actorRole: "general_manager",
        fields: validFields,
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      statusCode: 403,
      code: "CONTRACT_FINANCE_ONLY",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("拒绝空项目、零金额和超出安全范围的金额", async () => {
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, project_name: "  " },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({ statusCode: 400 });

    const { client } = createConfirmationClient();
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) => callback(client as never));
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, amount: "0.00" },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "CONTRACT_AMOUNT_INVALID",
    });

    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: { ...validFields, amount: "1000000000000.00" },
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "CONTRACT_AMOUNT_INVALID",
    });
  });

  it("在事务锁内沿用预选分类并拒绝过期版本和非partial任务", async () => {
    const mismatch = createConfirmationClient({
      declaredCategory: "non_main",
    });
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) =>
        callback(mismatch.client as never),
      );
    const categoryResult = await confirmContractOcrFields({
      contractId: "contract-1",
      jobId: "job-1",
      expectedVersion: 3,
      actorId: "finance-1",
      actorRole: "admin",
      fields: validFields,
      reviewedFields: validReviewedFields,
    });
    expect(categoryResult.contract.category).toBe("non_main");
    expect(
      categoryResult.fields.find((field) => field.field_code === "category"),
    ).toMatchObject({
      final_value: "non_main",
      manually_confirmed: false,
    });

    const staleVersion = createConfirmationClient();
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) =>
        callback(staleVersion.client as never),
      );
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 2,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "VERSION_CONFLICT",
    });

    const completedJob = createConfirmationClient({ jobStatus: "succeeded" });
    jest
      .mocked(db.transaction)
      .mockImplementation(async (callback) =>
        callback(completedJob.client as never),
      );
    await expect(
      confirmContractOcrFields({
        contractId: "contract-1",
        jobId: "job-1",
        expectedVersion: 3,
        actorId: "finance-1",
        actorRole: "admin",
        fields: validFields,
        reviewedFields: validReviewedFields,
      }),
    ).rejects.toMatchObject<Partial<ContractDomainError>>({
      code: "OCR_JOB_NOT_CONFIRMABLE",
    });
  });
});
