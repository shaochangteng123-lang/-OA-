/** @jest-environment node */
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  loadProjectReceiptFileMetadata,
  originalProjectNumber,
  prepareProjectReceiptPreview,
  projectReceiptPreviewUnavailableReason,
  projectReceiptPreviewUrl,
  realReceiptNumber,
  PROJECT_RECEIPT_FILES_SQL,
  type ProjectReceiptFileMetadata,
  type ProjectReceiptFileRow,
} from "../server/services/monthlyFinancialProjectReceiptPreview";
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisContract,
  type AnalysisReceipt,
} from "../server/services/monthlyFinancialAnalysis";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";

let workspaceRoot: string;
const now = new Date("2026-09-02T01:00:00Z");
function record(
  overrides: Partial<ProjectReceiptFileRow> = {},
): ProjectReceiptFileRow {
  return {
    receiptId: "receipt",
    rootContractId: "root",
    contractId: "contract",
    date: "2026-08-10",
    amount: "100.10",
    currency: "CNY",
    status: "confirmed",
    updatedAt: "2026-08-11",
    bankName: "银行",
    electronicReceiptNo: "回单-001",
    proofNo: "凭证-002",
    transactionSerialNo: "流水-003",
    rootCategory: "main_business",
    rootStatus: "effective",
    rootEffectiveAt: "2025-01-01",
    rootDeleted: false,
    contractDeleted: false,
    contractStatus: "effective",
    fileId: "file",
    fileContractId: "contract",
    fileRootId: "root",
    fileOwnerDeleted: false,
    fileType: "receipt",
    fileName: "银行回单.pdf",
    mimeType: "application/pdf",
    filePath: "uploads/contracts/receipt.pdf",
    canonical: [],
    hadCanonical: false,
    duplicateEvidence: false,
    ...overrides,
  };
}
function canonical(
  overrides: Partial<ProjectReceiptFileRow["canonical"][number]> = {},
): ProjectReceiptFileRow["canonical"][number] {
  return {
    id: "bank-transaction",
    current: true,
    fileActive: true,
    recognitionStatus: "recognized",
    account: "general",
    direction: "inflow",
    date: "2026-08-10",
    amount: "100.1",
    currency: "CNY",
    path: "uploads/monthly-financial-bank/receipt.jpg",
    name: "银行原件.pdf",
    allocation: "100.10",
    linkedReceiptCount: 1,
    ...overrides,
  };
}
async function setup(row = record(), role = "admin", status = "active") {
  let currentRow = row;
  const client = {
    query: jest.fn(async (sql: string) => ({
      rows: sql.startsWith("SELECT role") ? [{ role, status }] : [currentRow],
    })),
  };
  const metadata = (
    await loadProjectReceiptFileMetadata(client as never, [row.receiptId])
  ).get(row.receiptId)!;
  return {
    client,
    metadata,
    setRow: (next: ProjectReceiptFileRow) => {
      currentRow = next;
    },
    input: {
      client: client as never,
      actorId: "actor",
      rootContractId: "root",
      receiptId: "receipt",
      from: "2026-08",
      to: "2026-08",
      evidenceVersion: metadata.evidenceVersion,
      now,
      workspaceRoot,
    },
  };
}
beforeAll(async () => {
  workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "monthly-project-receipt-"),
  );
  await fs.mkdir(path.join(workspaceRoot, "uploads/contracts"), {
    recursive: true,
  });
  await fs.mkdir(path.join(workspaceRoot, "uploads/monthly-financial-bank"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(workspaceRoot, "uploads/contracts/receipt.pdf"),
    "%PDF-1.4\n银行回单测试数据\n%%EOF",
  );
  await fs.writeFile(
    path.join(workspaceRoot, "uploads/monthly-financial-bank/receipt.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]),
  );
  await fs.writeFile(
    path.join(workspaceRoot, "outside.pdf"),
    "%PDF-1.4\n不属于上传根目录",
  );
  await fs.writeFile(
    path.join(workspaceRoot, "uploads/contracts/not-pdf.pdf"),
    "<html>不是银行回单</html>",
  );
  await fs.symlink(
    path.join(workspaceRoot, "outside.pdf"),
    path.join(workspaceRoot, "uploads/contracts/escape.pdf"),
  );
});
afterAll(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe("真实项目编号和银行回单号", () => {
  it("不以内部编号补缺失业务编号，流水号不冒充银行回单号", () => {
    expect(originalProjectNumber(" 原件业务-001 ")).toBe("原件业务-001");
    for (const value of [undefined, null, "", "-", "—", "待识别"])
      expect(originalProjectNumber(value)).toBeNull();
    expect(
      realReceiptNumber({
        electronicReceiptNo: "回单01",
        proofNo: "凭证02",
        transactionSerialNo: "流水03",
      }),
    ).toEqual({
      receiptNumber: "回单01",
      receiptNumberSource: "electronic_receipt_no",
      transactionSerialNo: "流水03",
    });
    expect(
      realReceiptNumber({ proofNo: "凭证02", transactionSerialNo: "流水03" }),
    ).toEqual({
      receiptNumber: "凭证02",
      receiptNumberSource: "proof_no",
      transactionSerialNo: "流水03",
    });
    expect(
      realReceiptNumber({ proofNo: "ＡＢ－１２", transactionSerialNo: "ab12" }),
    ).toEqual({
      receiptNumber: null,
      receiptNumberSource: null,
      transactionSerialNo: "ab12",
    });
  });
});

describe("项目回单预览不可用原因", () => {
  it("旧空币种回单已完成严格核验时不误报为未上传文件", () => {
    expect(
      projectReceiptPreviewUnavailableReason({
        currency: null,
        verifiedLegacyCnyAmount: true,
      }),
    ).toBe(
      "银行回单已上传并完成核验，但旧记录未保存人民币币种；为避免误判币种，暂不提供原件预览",
    );
  });

  it("文件关系的具体异常优先展示，且不改变可用文件和普通缺失文件的语义", () => {
    const metadata: ProjectReceiptFileMetadata = {
      fileName: null,
      mimeType: null,
      available: false,
      reason: "银行回单替换关系不唯一，未猜测对应文件",
      evidenceVersion: "a".repeat(64),
    };
    expect(
      projectReceiptPreviewUnavailableReason({
        fileMetadata: metadata,
        currency: null,
        verifiedLegacyCnyAmount: true,
      }),
    ).toBe(metadata.reason);
    expect(
      projectReceiptPreviewUnavailableReason({
        fileMetadata: { ...metadata, available: true, reason: null },
      }),
    ).toBeNull();
    expect(projectReceiptPreviewUnavailableReason({ currency: "CNY" })).toBe(
      "未提供可用的回款银行回单文件",
    );
  });
});

describe("预览实时权限和项目期间边界", () => {
  it.each(["admin", "super_admin", "general_manager"])(
    "有效财务角色%s只取得受控预览入口",
    async (role) => {
      const test = await setup(record(), role);
      const result = await prepareProjectReceiptPreview(test.input);
      expect(result.absolutePath).toBe(
        await fs.realpath(
          path.join(workspaceRoot, "uploads/contracts/receipt.pdf"),
        ),
      );
      expect(result.mimeType).toBe("application/pdf");
      const url = projectReceiptPreviewUrl(
        "root",
        "receipt",
        "2026-08",
        "2026-08",
        test.metadata,
      )!;
      expect(url).toContain(
        "/analysis/projects/root/receipts/receipt/preview?",
      );
      expect(url).not.toContain("uploads");
      expect(JSON.stringify(test.metadata)).not.toContain(workspaceRoot);
    },
  );
  it.each([
    ["user", "active"],
    ["boss", "active"],
    ["chairman", "active"],
    ["admin", "inactive"],
  ])("角色%s或状态%s不足时实时拒绝", async (role, status) => {
    const test = await setup(record(), role, status);
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    { rootContractId: "another-root" },
    { receiptId: "another-receipt" },
    { from: "2026-07", to: "2026-07" },
    { from: "2026-09", to: "2026-09" },
  ])("不能跨项目、回款记录或期间：%j", async (override) => {
    const test = await setup();
    await expect(
      prepareProjectReceiptPreview({ ...test.input, ...override }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each([
    { status: "reversed" },
    { currency: "USD" },
    { currency: null },
    { date: "2026-08-32" },
    { rootDeleted: true },
    { contractDeleted: true },
    { rootCategory: "asset" },
    { rootStatus: "draft" },
    { contractStatus: "rejected" },
  ])("重新校验回款与合同状态：%j", async (override) => {
    const test = await setup(record(override));
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("未来回款拒绝，金额变化后旧证据版本失效", async () => {
    const future = await setup(record({ date: "2026-09-03" }));
    await expect(
      prepareProjectReceiptPreview({
        ...future.input,
        from: "2026-09",
        to: "2026-09",
      }),
    ).rejects.toMatchObject({ status: 404 });
    const changed = await setup();
    changed.setRow(record({ amount: "1000" }));
    await expect(
      prepareProjectReceiptPreview(changed.input),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("已变化"),
    });
  });
  it.each([
    { from: ["2026-08"] },
    { to: "2026-07" },
    { from: "1899-12" },
    { evidenceVersion: "bad" },
    { evidenceVersion: ["a".repeat(64)] },
  ])("重复或无效参数拒绝：%j", async (override) => {
    const test = await setup();
    await expect(
      prepareProjectReceiptPreview({ ...test.input, ...override }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("唯一当前裁片和原件的安全读取", () => {
  it("唯一有效裁片优先原件，精确金额核对后读取实际裁片", async () => {
    const test = await setup(record({ canonical: [canonical()] }));
    const result = await prepareProjectReceiptPreview(test.input);
    expect(result.absolutePath).toBe(
      await fs.realpath(
        path.join(workspaceRoot, "uploads/monthly-financial-bank/receipt.jpg"),
      ),
    );
    expect(result.mimeType).toBe("image/jpeg");
  });
  it.each([
    { current: false },
    { fileActive: false },
    { recognitionStatus: "review_required" },
    { amount: "100.11" },
    { date: "2026-08-11" },
    { currency: "USD" },
    { direction: "outflow" },
    { account: "business" },
    { allocation: "50" },
    { linkedReceiptCount: 2 },
    { path: null },
  ])("已有裁片无效时不悄悄退回另一张原件：%j", async (override) => {
    const test = await setup(record({ canonical: [canonical(override)] }));
    expect(test.metadata.available).toBe(false);
    expect(
      projectReceiptPreviewUrl(
        "root",
        "receipt",
        "2026-08",
        "2026-08",
        test.metadata,
      ),
    ).toBeNull();
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("两张有效裁片也不能任意选一张", async () => {
    const test = await setup(
      record({ canonical: [canonical(), canonical({ id: "another" })] }),
    );
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("不唯一"),
    });
  });
  it.each([
    { fileContractId: "sibling" },
    { fileRootId: "another-root" },
    { fileOwnerDeleted: true },
    { fileType: "sealed_contract" },
    { duplicateEvidence: true },
    { hadCanonical: true },
  ])("明确原件归属或证据唯一性不足时拒绝：%j", async (override) => {
    const test = await setup(record(override));
    expect(test.metadata.available).toBe(false);
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(["text/html", "image/svg+xml", "application/octet-stream"])(
    "禁止%s作为银行回单预览",
    async (mimeType) => {
      const test = await setup(record({ mimeType }));
      await expect(
        prepareProjectReceiptPreview(test.input),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it.each([
    "../outside.pdf",
    "uploads/contracts/../../outside.pdf",
    "uploads/contracts/escape.pdf",
  ])("拒绝目录及符号链接逃逸%s", async (filePath) => {
    const test = await setup(record({ filePath }));
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("真实文件格式不能仅相信数据库类型", async () => {
    const test = await setup(
      record({ filePath: "uploads/contracts/not-pdf.pdf" }),
    );
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("真实格式"),
    });
  });
  it("缺文件返回中文且不泄漏磁盘路径，展示名只保留文件名", async () => {
    const test = await setup(
      record({
        filePath: "uploads/contracts/missing.pdf",
        fileName: "uploads/contracts/missing.pdf",
      }),
    );
    expect(test.metadata.fileName).toBe("missing.pdf");
    await expect(
      prepareProjectReceiptPreview(test.input),
    ).rejects.toMatchObject({
      status: 404,
      message: "回款文件不可用，请联系管理员核对凭证",
    });
    expect(
      (await setup(record({ fileId: null, filePath: null }))).metadata
        .available,
    ).toBe(false);
  });
});

describe("分析凭证清单和限定元数据取数", () => {
  const root: AnalysisContract = {
    id: "root",
    rootId: "root",
    relationType: "main",
    title: "项目",
    businessContractNo: "原件业务-2026-001",
    partyA: "甲方",
    region: "海淀区",
    status: "effective",
    effectiveAt: "2024-01-01",
    contractDate: "2024-01-01",
    contractDateSource: "manual",
    originalAmount: "1000",
    amountDelta: "1000",
    amountBefore: null,
    amountAfter: null,
    supplementSequence: null,
    changeType: null,
    updatedAt: "2026-08-11",
  };
  function receipt(
    id: string,
    date: string,
    overrides: Partial<AnalysisReceipt> = {},
  ): AnalysisReceipt {
    return {
      id,
      date,
      rootId: "root",
      amount: "100.1",
      currency: "CNY",
      status: "confirmed",
      reversedAt: null,
      updatedAt: "2026-08-11",
      electronicReceiptNo: `真实回单-${id}`,
      bankName: "银行",
      ...overrides,
    };
  }
  it.each(["month", "quarter", "year"] as const)(
    "%s凭证按实际期间和根筛选，不包含已冲正或范围外文件",
    async (granularity) => {
      const test = await setup();
      const data = buildMonthlyFinancialAnalysis({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity,
          partyA: "甲方",
          comparisonYear: 2025,
        },
        generatedAt: now.toISOString(),
        reports: [],
        contracts: [
          root,
          { ...root, id: "other", rootId: "other", partyA: "其他甲方" },
        ],
        receipts: [
          receipt("receipt", "2026-08-10", { fileMetadata: test.metadata }),
          receipt("reversed", "2026-08-10", {
            status: "reversed",
            reversedAt: "2026-09-01",
          }),
          receipt("old", "2026-07-01"),
          receipt("other", "2026-08-10", { rootId: "other" }),
          receipt("previous", "2025-08-10"),
        ],
      });
      const module = data.modules.find((item) => item.key === "projects")!;
      expect(module.projectReceipts).toHaveLength(1);
      expect(
        module.columns.find((column) => column.key === "periodReceiptNumbers")
          ?.label,
      ).toBe("银行回单号");
      expect(module.projectReceipts![0]).toMatchObject({
        projectNumber: "原件业务-2026-001",
        receiptNumber: "真实回单-receipt",
        amount: "100.1",
        from: "2026-08",
        to: "2026-08",
        rootContractId: "root",
        receiptId: "receipt",
        mimeType: "application/pdf",
      });
      expect(module.details[0].periodReceiptNumbers).toBe("真实回单-receipt");
      expect(
        module.summaries.find((item) => item.key === "periodReceived")?.amount,
      ).toBe("100.1");
      expect(
        data.comparison?.modules
          .find((item) => item.key === "projects")
          ?.projectReceipts?.map((item) => item.receiptId),
      ).toEqual(["previous"]);
      expect(JSON.stringify(module.projectReceipts)).not.toContain("uploads/");
      expect(JSON.stringify(module.projectReceipts)).not.toContain(
        workspaceRoot,
      );
    },
  );
  it("缺业务编号和真实回单号留空，不把内部追溯编号或流水号换成展示号码", () => {
    const data = buildMonthlyFinancialAnalysis({
      query: { from: "2026-08", to: "2026-08", granularity: "month" },
      generatedAt: now.toISOString(),
      reports: [],
      contracts: [{ ...root, businessContractNo: null }],
      receipts: [
        receipt("internal-uuid", "2026-08-10", {
          electronicReceiptNo: null,
          proofNo: "流水-001",
          transactionSerialNo: "流水-001",
        }),
      ],
    });
    const module = data.modules.find((item) => item.key === "projects")!;
    expect(module.details[0]).toMatchObject({
      projectNumber: null,
      periodReceiptNumbers: null,
      sourceId: "root",
      periodReceivedSourceIds: "internal-uuid",
    });
    expect(module.projectReceipts![0]).toMatchObject({
      projectNumber: null,
      receiptNumber: null,
      transactionSerialNo: "流水-001",
      previewUrl: null,
    });
  });
  it("旧空币种回单经严格核验后保留金额，并向界面返回真实的预览受限原因", () => {
    const data = buildMonthlyFinancialAnalysis({
      query: { from: "2026-08", to: "2026-08", granularity: "month" },
      generatedAt: now.toISOString(),
      reports: [],
      contracts: [root],
      receipts: [
        receipt("legacy-cny", "2026-08-10", {
          currency: null,
          verifiedLegacyCnyAmount: true,
        }),
      ],
    });
    const projectReceipt = data.modules.find((item) => item.key === "projects")!
      .projectReceipts![0];
    expect(projectReceipt).toMatchObject({
      receiptId: "legacy-cny",
      amount: "100.1",
      previewUrl: null,
      previewUnavailableReason:
        "银行回单已上传并完成核验，但旧记录未保存人民币币种；为避免误判币种，暂不提供原件预览",
    });
  });
  it("完整历史仍保留给累计，只批量读取当前期间筛选下已发生的确认人民币回款文件", async () => {
    const raw = [
      receipt("old", "2024-01-01"),
      receipt("current", "2026-08-10"),
      receipt("future", "2026-08-20"),
      receipt("reversed", "2026-08-12", { status: "reversed" }),
      receipt("foreign", "2026-08-13", { currency: "USD" }),
      receipt("historical", "2026-08-11", {
        currency: null,
        historicalConfirmedAmount: true,
      }),
      receipt("legacy", "2026-08-12", {
        currency: null,
        verifiedLegacyCnyAmount: true,
      }),
      receipt("unverified", "2026-08-13", { currency: null }),
      receipt("invalid", "日期未知"),
      receipt("other", "2026-08-10", { rootId: "other" }),
    ];
    const client = {
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === PROJECT_RECEIPT_FILES_SQL)
          return { rows: [record({ receiptId: "current" })] };
        if (sql.startsWith("SELECT contract.id"))
          return {
            rows: [
              root,
              { ...root, id: "other", rootId: "other", partyA: "其他甲方" },
            ],
          };
        if (sql.includes("FROM contract_receipts receipt"))
          return { rows: raw };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const data = await loadFinancialAnalysisSources(
      {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        partyA: "甲方",
        contractRegion: "海淀区",
      },
      {
        queryClient: client as never,
        loadReport: async () => {
          throw new Error("本测试无月报");
        },
        now: new Date("2026-08-15T01:00:00Z"),
      },
    );
    expect(data.receipts).toHaveLength(raw.length);
    expect(data.receipts?.some((row) => row.id === "old")).toBe(true);
    expect(
      client.query.mock.calls
        .filter(([sql]) => sql === PROJECT_RECEIPT_FILES_SQL)
        .map(([, params]) => params),
    ).toEqual([[["current"]]]);
  });
  it("对比期文件元数据不被本期完整历史的空字段覆盖，旧回款继续进入累计", async () => {
    const raw = [
      receipt("old", "2024-01-01"),
      receipt("previous", "2025-08-10"),
      receipt("current", "2026-08-10"),
    ];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql === PROJECT_RECEIPT_FILES_SQL)
          return {
            rows: (params![0] as string[]).map((id) =>
              record({
                receiptId: id,
                date: raw.find((row) => row.id === id)!.date,
              }),
            ),
          };
        if (sql.startsWith("SELECT contract.id")) return { rows: [root] };
        if (sql.includes("FROM contract_receipts receipt"))
          return { rows: raw };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const data = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        comparisonYear: 2025,
      },
      {
        queryClient: client as never,
        loadReport: async () => {
          throw new Error("本测试无月报");
        },
        now,
      },
    );
    const current = data.modules.find((module) => module.key === "projects")!;
    const previous = data.comparison!.modules.find(
      (module) => module.key === "projects",
    )!;
    expect(
      current.series.find((series) => series.key === "received")!.values,
    ).toEqual(["300.3"]);
    expect(current.projectReceipts![0].previewUrl).toContain(
      "/receipts/current/preview?",
    );
    expect(previous.projectReceipts![0].previewUrl).toContain(
      "/receipts/previous/preview?",
    );
    expect(
      client.query.mock.calls
        .filter(([sql]) => sql === PROJECT_RECEIPT_FILES_SQL)
        .map(([, params]) => params),
    ).toEqual([[["current"]], [["previous"]]]);
  });
});
