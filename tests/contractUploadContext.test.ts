jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({
  db: { all: jest.fn(), transaction: jest.fn() },
}));

import fs from "fs";
import path from "path";
import {
  allocateSupplementSequence,
  assertStoredContractUploadContext,
  cleanupLegacyDeletedContractDrafts,
  isExactAutomaticContractConfidence,
  normalizeAutomaticContractConfidence,
  updateContractDraft,
  validateNewContractUploadContext,
} from "../server/services/contractService";
import { db } from "../server/db/index";

describe("合同上传归属与精确可信度门禁", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("上传前必须选择北京市行政区和三类预选分类", () => {
    expect(() =>
      validateNewContractUploadContext({
        area: "",
        declaredCategory: "main_business",
        declaredSubtype: "engineering_consulting",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_AREA_REQUIRED" }));
    expect(() =>
      validateNewContractUploadContext({
        area: "上海市",
        declaredCategory: "main_business",
        declaredSubtype: "engineering_consulting",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_AREA_INVALID" }));
    expect(
      validateNewContractUploadContext({
        area: "全部",
        declaredCategory: "main_business",
      }),
    ).toMatchObject({ area: "全部", declaredCategory: "main_business" });
    expect(() =>
      validateNewContractUploadContext({
        area: "海淀区",
        declaredCategory: "",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_DECLARED_CATEGORY_REQUIRED" }),
    );
    expect(() =>
      validateNewContractUploadContext({
        area: "海淀区",
        declaredCategory: "unknown",
        declaredSubtype: "engineering_consulting",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_DECLARED_CATEGORY_INVALID" }),
    );
  });

  it("二级分类未传时由合同类型赋兼容默认值，显式旧值仍校验匹配", () => {
    expect(
      validateNewContractUploadContext({
        area: "海淀区",
        declaredCategory: "main_business",
      }),
    ).toEqual({
      area: "海淀区",
      declaredCategory: "main_business",
      declaredSubtype: "engineering_consulting",
      assetCategory: null,
    });
    expect(
      validateNewContractUploadContext({
        area: "海淀区",
        declaredCategory: "non_main",
        declaredSubtype: "other_service",
      }),
    ).toEqual({
      area: "海淀区",
      declaredCategory: "non_main",
      declaredSubtype: "other_service",
      assetCategory: null,
    });
    expect(
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "asset",
      }),
    ).toEqual({
      area: "朝阳区",
      declaredCategory: "asset",
      declaredSubtype: "procurement",
      assetCategory: "procurement",
    });
    expect(() =>
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "asset",
        declaredSubtype: "other_service",
        assetCategory: "other",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_DECLARED_SUBTYPE_MISMATCH" }),
    );
    expect(
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "asset",
        declaredSubtype: "software",
        assetCategory: "software",
      }),
    ).toEqual({
      area: "朝阳区",
      declaredCategory: "asset",
      declaredSubtype: "software",
      assetCategory: "software",
    });
    expect(
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "asset",
        declaredSubtype: "parking_space",
        assetCategory: "parking_space",
      }),
    ).toEqual({
      area: "朝阳区",
      declaredCategory: "asset",
      declaredSubtype: "parking_space",
      assetCategory: "parking_space",
    });
    expect(() =>
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "main_business",
        declaredSubtype: "other_service",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_DECLARED_SUBTYPE_MISMATCH" }),
    );
    expect(() =>
      validateNewContractUploadContext({
        area: "朝阳区",
        declaredCategory: "asset",
        declaredSubtype: "software",
        assetCategory: "equipment",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_ASSET_CATEGORY_MISMATCH" }),
    );
    expect(() =>
      assertStoredContractUploadContext({
        area: "朝阳区",
        declared_category: "asset",
        declared_subtype: "software",
        asset_category: "equipment",
      }),
    ).toThrow(
      expect.objectContaining({ code: "CONTRACT_ASSET_CATEGORY_REQUIRED" }),
    );
  });

  it("自动采用只接受显式整数 100 且不会把比例值或小数进位", () => {
    expect(normalizeAutomaticContractConfidence(100)).toBe(100);
    expect(normalizeAutomaticContractConfidence(1)).toBe(99);
    expect(normalizeAutomaticContractConfidence(99.99)).toBe(99);
    expect(normalizeAutomaticContractConfidence(99.999)).toBe(99);
    expect(normalizeAutomaticContractConfidence(0.99999)).toBe(99);
    expect(normalizeAutomaticContractConfidence(98.76)).toBe(98);
    expect(normalizeAutomaticContractConfidence(100.01)).toBe(99);
    expect(normalizeAutomaticContractConfidence(true)).toBe(0);
    expect(normalizeAutomaticContractConfidence([1])).toBe(0);
    expect(isExactAutomaticContractConfidence(100)).toBe(true);
    expect(isExactAutomaticContractConfidence("100")).toBe(true);
    expect(isExactAutomaticContractConfidence(99)).toBe(false);
    expect(isExactAutomaticContractConfidence(95)).toBe(false);
    expect(isExactAutomaticContractConfidence(94)).toBe(false);
    expect(isExactAutomaticContractConfidence(101)).toBe(false);
    expect(isExactAutomaticContractConfidence(99.99)).toBe(false);
    expect(isExactAutomaticContractConfidence(true)).toBe(false);
    expect(isExactAutomaticContractConfidence([100])).toBe(false);
  });

  it("自动采用策略仍以预选分类作为原子落库硬门禁", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(routeSource).toContain(
      "declaredCategory: contractLock.rows[0].declared_category",
    );
    expect(routeSource).toContain(
      "expectedCategory: job.declared_category || undefined",
    );
    expect(routeSource).toContain("const automaticAdoptionAccepted =");
    expect(routeSource).toMatch(
      /if \(automaticAdoptionAccepted\)[\s\S]*?UPDATE contract_ocr_fields SET[\s\S]*?final_value = \$3[\s\S]*?UPDATE contracts SET/,
    );
    expect(routeSource).toContain("decideContractAutomaticOcrAdoption");
  });

  it("补充协议名称继承主合同且台账按完整主合同链分页", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(routeSource).toContain(
      "supplementSequence = await allocateSupplementSequence",
    );
    expect(routeSource).toMatch(
      /supplementSubjectName = buildSupplementSubjectName\(\s*parent,\s*supplementSequence,?\s*\)/u,
    );
    expect(routeSource).toContain("WHEN $17::text IS NULL THEN title");
    expect(routeSource).toContain("ELSE $17::text");
    expect(routeSource).toContain(
      "COUNT(DISTINCT COALESCE(c.root_contract_id, c.id))",
    );
    expect(routeSource).toContain("matching_roots AS");
    expect(routeSource).toContain("paged_roots AS");
    expect(routeSource).toContain("SELECT list_page.*");
    expect(routeSource).not.toContain("SELECT matching_roots.*");
    expect(routeSource).toContain(
      "COALESCE(c.root_contract_id, c.id) = list_page.root_id",
    );
    expect(routeSource).toContain("WHEN 'supplement' THEN 1");
  });

  it("补充协议只在草稿物理删除后释放序号，撤销记录仍占号", async () => {
    const client = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AS next_sequence")
          ? { rows: [{ next_sequence: 1 }] }
          : { rows: [{ id: "root-1" }] },
      ),
    };

    await expect(
      allocateSupplementSequence(client as any, "root-1"),
    ).resolves.toBe(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("relation_type = 'supplement'"),
      ["root-1"],
    );
    const allocationSql = String(client.query.mock.calls[1]?.[0] || "");
    expect(allocationSql).not.toContain("is_deleted");

    // 数据库中仍保留的撤销草稿序号为（1）时，下一号必须是（2）。分配
    // SQL 不按 is_deleted/status 过滤，因此撤销阶段不会改变占号语义。
    const clientWithCancelledDraft = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AS next_sequence")
          ? { rows: [{ next_sequence: 2 }] }
          : { rows: [{ id: "root-1" }] },
      ),
    };
    await expect(
      allocateSupplementSequence(clientWithCancelledDraft as any, "root-1"),
    ).resolves.toBe(2);

    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    expect(routeSource).toMatch(
      /AS next_sequence[\s\S]*?relation_type = 'supplement'/u,
    );
    expect(databaseSource).toMatch(
      /idx_contracts_supplement_sequence_unique[\s\S]*?relation_type = 'supplement' AND supplement_sequence IS NOT NULL;/u,
    );
    const duplicateCleanupIndex = databaseSource.indexOf(
      "WITH duplicate_sequences AS",
    );
    const strictIndexIndex = databaseSource.indexOf(
      "DROP INDEX IF EXISTS idx_contracts_supplement_sequence_unique",
    );
    expect(duplicateCleanupIndex).toBeGreaterThan(-1);
    expect(strictIndexIndex).toBeGreaterThan(duplicateCleanupIndex);
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(serviceSource).toContain(
      "AND (status <> 'draft' OR is_deleted = TRUE)",
    );
  });

  it("启动清理永久删除旧软删除草稿并把现存补充协议四号改为一号", async () => {
    const legacyIds = ["deleted-1", "deleted-2", "deleted-3"];
    const inheritedName =
      "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）";
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes(
            "contract.is_deleted = TRUE AND contract.status = 'draft'",
          )
        ) {
          return {
            rows: legacyIds.map((id) => ({
              id,
              project_id: null,
              relation_type: "supplement",
              root_contract_id: "root-1",
            })),
            rowCount: legacyIds.length,
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
                id: "active-4",
                root_contract_id: "root-1",
                supplement_sequence: 4,
                created_at: "2026-08-16T13:21:17.329Z",
                title:
                  "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（4）",
                project_name:
                  "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（4）",
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
        return { rows: [], rowCount: 0, params };
      }),
    };
    (db.all as jest.Mock).mockResolvedValueOnce(
      legacyIds.map((id) => ({ id, cleanup_root_id: "root-1" })),
    );
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(cleanupLegacyDeletedContractDrafts()).resolves.toMatchObject({
      deletedDraftCount: 3,
      renumberedSupplementCount: 1,
      blockedDraftCount: 0,
      blockedContractIds: [],
      deletedFileCount: 0,
      failedFilePaths: [],
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET supplement_sequence = \$2,[\s\S]*title =/u),
      ["active-4", 1, inheritedName, expect.any(String), true],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET final_value = $2"),
      ["active-4", inheritedName, expect.any(String), 100],
    );
    const legacyCleanupSql = String((db.all as jest.Mock).mock.calls[0]?.[0]);
    expect(legacyCleanupSql).toContain(
      "deleted_audit.action = 'draft_deleted'",
    );
    expect(legacyCleanupSql).toContain(
      "cancellation_audit.action = 'contract_cancelled_before_seal'",
    );
  });

  it("启动清理按根合同隔离，审批资料阻断组不会影响安全组", async () => {
    (db.all as jest.Mock).mockResolvedValueOnce([
      { id: "blocked-draft", cleanup_root_id: "root-blocked" },
      { id: "safe-draft", cleanup_root_id: "root-safe" },
    ]);
    const createClient = (blocked: boolean) => ({
      query: jest.fn(async (sql: string) => {
        if (sql.includes("contract.id = ANY($1::text[])")) {
          return {
            rows: [
              {
                id: blocked ? "blocked-draft" : "safe-draft",
                project_id: null,
                relation_type: "supplement",
                root_contract_id: blocked ? "root-blocked" : "root-safe",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("SELECT draft.id")) {
          return blocked
            ? {
                rows: [
                  {
                    id: "next-draft",
                    root_contract_id: "root-blocked",
                    supplement_sequence: 2,
                    created_at: "2026-08-16T13:21:17.329Z",
                    title: "测试项目补充协议（2）",
                    project_name: "测试项目补充协议（2）",
                    root_project_name: "测试项目",
                    root_title: "测试项目",
                  },
                ],
                rowCount: 1,
              }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("AS max_sequence")) {
          return { rows: [{ max_sequence: 0 }], rowCount: 1 };
        }
        if (sql.includes("FROM unnest($1::text[])")) {
          return { rows: [{ contract_id: "next-draft" }], rowCount: 1 };
        }
        if (sql.includes("AS exists")) {
          return { rows: [{ exists: false }], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM contracts WHERE id = $1")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    });
    const blockedClient = createClient(true);
    const safeClient = createClient(false);
    (db.transaction as jest.Mock)
      .mockImplementationOnce(async (callback) => callback(blockedClient))
      .mockImplementationOnce(async (callback) => callback(safeClient));

    await expect(cleanupLegacyDeletedContractDrafts()).resolves.toMatchObject({
      deletedDraftCount: 1,
      blockedDraftCount: 1,
      blockedContractIds: ["blocked-draft"],
    });
    expect(
      blockedClient.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM contracts WHERE id"),
      ),
    ).toBe(false);
    expect(
      safeClient.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM contracts WHERE id"),
      ),
    ).toBe(true);
  });

  it("上传参数先于持久文件校验，重试和换文件复验已锁定归属", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const recognizeRoute = routeSource.slice(
      routeSource.indexOf('  "/recognize",'),
      routeSource.indexOf('router.post("/:id/recognize/retry"'),
    );
    expect(routeSource).toContain("storage: multer.memoryStorage()");
    expect(recognizeRoute).toContain("uploadRecognitionSingle");
    expect(recognizeRoute).toMatch(
      /String\(\s*req\.body\.relationType \|\| "",?\s*\)\.trim\(\)/,
    );
    expect(recognizeRoute).toContain("CONTRACT_RELATION_TYPE_REQUIRED");
    expect(recognizeRoute).toContain(
      "declaredSubtype: req.body.declaredSubtype",
    );
    expect(recognizeRoute).toContain("CONTRACT_PARENT_SUBTYPE_MISMATCH");
    expect(recognizeRoute).toContain(
      "const requestedProjectId = normalizeNullableText(req.body.projectId)",
    );
    expect(recognizeRoute).toContain("CONTRACT_ASSET_PROJECT_NOT_ALLOWED");
    expect(routeSource).toContain(
      "declaredSubtypeOptions: DECLARED_SUBTYPE_OPTIONS",
    );
    expect(routeSource).toContain("CONTRACT_RELATION_TYPE_IMMUTABLE");
    expect(routeSource).toContain("CONTRACT_DECLARED_SUBTYPE_IMMUTABLE");
    expect(routeSource).toContain(
      'Object.prototype.hasOwnProperty.call(req.body, "parentContractId")',
    );
    expect(routeSource).toContain("CONTRACT_PARENT_IMMUTABLE");
    const updateRoute = routeSource.slice(
      routeSource.indexOf('router.put("/:id"'),
      routeSource.indexOf('router.delete("/:id"'),
    );
    expect(updateRoute.indexOf("CONTRACT_PARENT_IMMUTABLE")).toBeLessThan(
      updateRoute.indexOf("recognitionFieldPayloadKeys"),
    );
    expect(updateRoute.indexOf("CONTRACT_PARENT_IMMUTABLE")).toBeLessThan(
      updateRoute.indexOf("db.transaction"),
    );
    expect(updateRoute).not.toContain(
      "normalizeNullableText(req.body.parentContractId)",
    );
    expect(updateRoute).not.toContain("FROM contract_ocr_jobs");
    expect(updateRoute).not.toContain("automaticCategory");
    expect(updateRoute).not.toContain("OCR_AUTOMATIC_RECOGNITION_REQUIRED");
    expect(
      recognizeRoute.indexOf("validateNewContractUploadContext"),
    ).toBeLessThan(recognizeRoute.indexOf("validateUploadedFile"));
    expect(
      routeSource.match(/assertStoredContractUploadContext\(/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("补充或终止协议识别为 partial 时仍可更新说明字段但不能提交上级合同", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const updateRoute = routeSource.slice(
      routeSource.indexOf('router.put("/:id"'),
      routeSource.indexOf('router.delete("/:id"'),
    );

    expect(updateRoute).toContain("req.body.description");
    expect(updateRoute).toContain("updateContractDraft(");
    expect(updateRoute).not.toContain("contract_ocr_jobs");
    expect(updateRoute).not.toContain('status !== "succeeded"');
    expect(updateRoute).not.toContain("OCR_PARENT_CATEGORY_MISMATCH");
    expect(updateRoute).toMatch(
      /hasOwnProperty\.call\(req\.body, "parentContractId"\)[\s\S]*?CONTRACT_PARENT_IMMUTABLE[\s\S]*?db\.transaction/,
    );
  });

  it("数据库保留历史兼容空预选分类但新表不再使用城区默认值", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS declared_category TEXT",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS declared_subtype TEXT",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contracts ALTER COLUMN area DROP DEFAULT",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contracts ALTER COLUMN relation_type DROP DEFAULT",
    );
    expect(databaseSource).not.toContain(
      "relation_type TEXT NOT NULL DEFAULT 'independent'",
    );
    expect(databaseSource).toContain(
      "UPDATE contracts SET relation_type = 'main' WHERE relation_type = 'independent'",
    );
    expect(databaseSource).toContain(
      "CHECK(relation_type IN ('main', 'supplement', 'termination')) NOT VALID",
    );
    expect(databaseSource).toContain("contracts_beijing_area_check");
    expect(databaseSource).toContain("contracts_declared_asset_category_check");
    expect(databaseSource).toContain("contracts_declared_subtype_check");
    expect(databaseSource).toContain("'parking_space'");
    expect(databaseSource).toContain(
      "contract_ocr_fields_confidence_integer_check",
    );
    expect(databaseSource).toContain(
      "contract_seal_verification_fields_confidence_integer_check",
    );
    expect(databaseSource).not.toContain("area TEXT NOT NULL DEFAULT '城区'");
  });

  it("服务端拒绝关联跨区项目且不覆盖合同上传行政区", async () => {
    const draft = {
      id: "contract-1",
      status: "draft",
      relation_type: "main",
      root_contract_id: "contract-1",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      amount_delta: 100,
      version: 1,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM contracts")) return { rows: [draft] };
        if (sql.includes("FROM worklog_projects")) {
          return { rows: [{ id: "project-1", district: "朝阳区" }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      updateContractDraft(
        draft.id,
        {
          expectedVersion: 1,
          projectId: "project-1",
        },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_PROJECT_AREA_MISMATCH",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET"),
      expect.anything(),
    );
  });

  it.each([
    ["main_business", "engineering_consulting"],
    ["non_main", "non_main_income"],
  ] as const)(
    "%s 合同可以关联同区项目且写入时沿用上传行政区",
    async (declaredCategory, declaredSubtype) => {
      const draft = {
        id: "contract-2",
        status: "draft",
        relation_type: "main",
        root_contract_id: "contract-2",
        parent_contract_id: null,
        area: "海淀区",
        declared_category: declaredCategory,
        declared_subtype: declaredSubtype,
        category: declaredCategory,
        asset_category: null,
        project_id: null,
        amount_delta: 100,
        version: 1,
      };
      let updateParams: unknown[] = [];
      const client = {
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes("SELECT * FROM contracts")) return { rows: [draft] };
          if (sql.includes("FROM worklog_projects")) {
            return { rows: [{ id: "project-2", district: "海淀区" }] };
          }
          if (sql.includes("UPDATE contracts SET")) {
            updateParams = params || [];
            return {
              rows: [{ ...draft, project_id: "project-2", version: 2 }],
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
        draft.id,
        { expectedVersion: 1, projectId: "project-2" },
        "finance-1",
        "admin",
      );
      expect(updateParams[6]).toBe("海淀区");
      expect(updateParams[7]).toBe("project-2");
    },
  );

  it("主合同作为一级合同时强制保持空上级合同并以自身为根", async () => {
    const relationType = "main" as const;
    const draft = {
      id: "root-contract-1",
      status: "draft",
      relation_type: relationType,
      root_contract_id: "root-contract-1",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
      amount_delta: 100,
      version: 1,
    };
    let updateParams: unknown[] = [];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT * FROM contracts")) return { rows: [draft] };
        if (sql.includes("UPDATE contracts SET")) {
          updateParams = params || [];
          return {
            rows: [
              {
                ...draft,
                relation_type: relationType,
                parent_contract_id: null,
                root_contract_id: draft.id,
                version: 2,
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
      draft.id,
      {
        expectedVersion: 1,
      },
      "finance-1",
      "admin",
    );

    expect(updateParams[5]).toBe(relationType);
    expect(updateParams[8]).toBeNull();
    expect(updateParams[9]).toBe(draft.id);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("FOR SHARE"),
      expect.anything(),
    );
  });

  it("主合同作为一级合同时拒绝领域服务改写上级合同", async () => {
    const relationType = "main" as const;
    const draft = {
      id: `locked-parent-${relationType}`,
      status: "draft",
      relation_type: relationType,
      root_contract_id: `locked-parent-${relationType}`,
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
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
        { expectedVersion: 1, parentContractId: "forged-parent" },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_PARENT_IMMUTABLE",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET"),
      expect.anything(),
    );
  });

  it.each(["supplement", "termination"] as const)(
    "%s 拒绝从原上级合同改挂到同上下文的另一份合同",
    async (relationType) => {
      const draft = {
        id: `locked-child-${relationType}`,
        status: "draft",
        relation_type: relationType,
        root_contract_id: "parent-original",
        parent_contract_id: "parent-original",
        area: "海淀区",
        declared_category: "main_business",
        declared_subtype: "engineering_consulting",
        category: "main_business",
        asset_category: null,
        project_id: "project-1",
        amount_delta: relationType === "termination" ? -10 : 10,
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
          { expectedVersion: 1, parentContractId: "parent-other" },
          "finance-1",
          "admin",
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "CONTRACT_PARENT_IMMUTABLE",
      });
      expect(client.query).not.toHaveBeenCalledWith(
        expect.stringContaining("FOR SHARE"),
        expect.anything(),
      );
      expect(client.query).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE contracts SET"),
        expect.anything(),
      );
    },
  );

  it("领域服务拒绝在上传后改写合同层级关系", async () => {
    const draft = {
      id: "locked-relation-contract",
      status: "draft",
      relation_type: "main",
      root_contract_id: "locked-relation-contract",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
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
    const forgedUpdate = {
      expectedVersion: 1,
      relationType: "supplement" as const,
      parentContractId: "parent-1",
    };

    await expect(
      updateContractDraft(draft.id, forgedUpdate, "finance-1", "admin"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_RELATION_TYPE_IMMUTABLE",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET"),
      expect.anything(),
    );
  });

  it.each([
    ["supplement", 10],
    ["termination", -10],
  ] as const)(
    "%s 草稿缺少上传前上级合同时拒绝保存",
    async (relationType, amount) => {
      const draft = {
        id: `child-${relationType}`,
        status: "draft",
        relation_type: relationType,
        root_contract_id: `parent-${relationType}`,
        parent_contract_id: null,
        area: "海淀区",
        declared_category: "main_business",
        declared_subtype: "engineering_consulting",
        category: "main_business",
        asset_category: null,
        project_id: "project-1",
        amount_delta: amount,
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
          { expectedVersion: 1, parentContractId: null },
          "finance-1",
          "admin",
        ),
      ).rejects.toThrow("补充协议或终止协议必须关联上级合同");
      expect(client.query).not.toHaveBeenCalledWith(
        expect.stringContaining("UPDATE contracts SET"),
        expect.anything(),
      );
    },
  );

  it("二级协议伪造与上级合同不同的项目时拒绝保存", async () => {
    const draft = {
      id: "child-project-mismatch",
      status: "draft",
      relation_type: "supplement",
      root_contract_id: "parent-project-1",
      parent_contract_id: "parent-project-1",
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: "project-1",
      amount_delta: 10,
      version: 1,
    };
    const parent = {
      id: "parent-project-1",
      status: "executing",
      relation_type: "main",
      root_contract_id: "parent-project-1",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: "project-1",
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FOR UPDATE")) return { rows: [draft] };
        if (sql.includes("FOR SHARE")) return { rows: [parent] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      updateContractDraft(
        draft.id,
        {
          expectedVersion: 1,
          parentContractId: parent.id,
          projectId: "project-2",
        },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_PARENT_PROJECT_MISMATCH",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET"),
      expect.anything(),
    );
  });

  it("补充协议草稿再次保存时保留完整主合同名称和已分配序号", async () => {
    const rootName = "费家村110千伏输变电工程前期手续技术咨询服务";
    const expectedName = `${rootName}补充协议（2）`;
    const draft = {
      id: "supplement-name-sequence-2",
      status: "draft",
      relation_type: "supplement",
      supplement_sequence: 2,
      root_contract_id: "root-full-name",
      parent_contract_id: "root-full-name",
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      project_name: expectedName,
      title: expectedName,
      description: null,
      party_a: null,
      party_b: null,
      amount_delta: 0,
      version: 1,
    };
    const parent = {
      id: "root-full-name",
      status: "effective",
      relation_type: "main",
      root_contract_id: "root-full-name",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      project_name: rootName,
      title: rootName,
    };
    let updateParams: unknown[] = [];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FOR UPDATE")) return { rows: [draft] };
        if (sql.includes("FOR SHARE")) return { rows: [parent] };
        if (sql.includes("UPDATE contracts SET")) {
          updateParams = params || [];
          return {
            rows: [
              {
                ...draft,
                title: params?.[1],
                project_name: params?.[12],
                version: 2,
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
      draft.id,
      { expectedVersion: 1, description: "保存草稿" },
      "finance-1",
      "admin",
    );

    expect(updateParams[1]).toBe(expectedName);
    expect(updateParams[12]).toBe(expectedName);
  });

  it("上传后不能修改行政区", async () => {
    const draft = {
      id: "contract-3",
      status: "draft",
      relation_type: "main",
      root_contract_id: "contract-3",
      parent_contract_id: null,
      area: "海淀区",
      declared_category: "non_main",
      declared_subtype: "non_main_income",
      category: "non_main",
      asset_category: null,
      project_id: null,
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
        { expectedVersion: 1, area: "朝阳区" },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_AREA_IMMUTABLE",
    });
  });

  it("补充协议与上级合同行政区不一致时拒绝且不覆盖", async () => {
    const draft = {
      id: "child-1",
      status: "draft",
      relation_type: "supplement",
      root_contract_id: "parent-1",
      parent_contract_id: "parent-1",
      area: "海淀区",
      declared_category: "main_business",
      declared_subtype: "engineering_consulting",
      category: "main_business",
      asset_category: null,
      project_id: null,
      amount_delta: 10,
      version: 1,
    };
    const parent = {
      id: "parent-1",
      status: "effective",
      relation_type: "main",
      root_contract_id: "parent-1",
      parent_contract_id: null,
      area: "朝阳区",
      category: "main_business",
      asset_category: null,
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FOR UPDATE")) return { rows: [draft] };
        if (sql.includes("FOR SHARE")) return { rows: [parent] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      updateContractDraft(
        draft.id,
        {
          expectedVersion: 1,
          parentContractId: parent.id,
          amountDelta: 10,
        },
        "finance-1",
        "admin",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_PARENT_AREA_MISMATCH",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET"),
      expect.anything(),
    );
  });
});
