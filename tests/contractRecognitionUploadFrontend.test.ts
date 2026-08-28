jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import { api } from "@/utils/api";
import {
  confirmCompletedRentalExit,
  getContract,
  getContractMeta,
  getContractOcrJob,
  getContractRentalRenewalUploadContext,
  getContractSupplementUploadContext,
  normalizeOcrFields,
  recognizeContract,
  recognizeRentalRenewalContract,
  recognizeSupplementContract,
} from "@/utils/contractApi";

const envelope = (data: unknown) => ({
  data: { success: true, data },
});

describe("合同上传前业务选择与精确可信度展示", () => {
  beforeEach(() => jest.clearAllMocks());

  it("履行完成的租赁合同确认退租或还车时提交版本号且不上传文件", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ terminated: true }),
    );

    await confirmCompletedRentalExit("rental-contract-1", 7);

    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/rental-contract-1/rental-exit/confirm",
      { expectedVersion: 7 },
    );
    const payload = (api.post as jest.Mock).mock.calls[0][1];
    expect(payload).not.toBeInstanceOf(FormData);
  });

  it("合同详情将下划线格式履行进度规范为页面使用字段", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        contract: {
          id: "rental-contract-progress",
          relation_type: "main",
          completion_rate: 100,
          previous_lease_contract_id: "rental-contract-old",
          renewal_contract_id: "rental-contract-next",
          renewal_contract_status: "approving",
        },
        files: [],
        approvals: [],
        invoices: [],
        receipts: [],
        payments: [],
        externalPayments: [],
        relations: [],
      }),
    );

    const detail = await getContract("rental-contract-progress");

    expect(detail.contract.completionRate).toBe(100);
    expect(detail.contract.previousLeaseContractId).toBe("rental-contract-old");
    expect(detail.contract.renewalContractId).toBe("rental-contract-next");
    expect(detail.contract.renewalContractStatus).toBe("approving");
  });

  it("续签上下文独立读取原合同且续签文件创建新的主合同草稿", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        source_contract_id: "rental-source-1",
        source_contract_name: "原房屋租赁合同",
        area: "朝阳区",
        declared_category: "asset",
        declared_subtype: "house_rental",
        asset_category: "house_rental",
        project_id: null,
        project_name: "原房屋租赁合同",
        party_a: "出租方",
        party_b: "承租方",
        current_lease_end_date: "2026-12-31",
        can_upload: true,
        blocking_reason: null,
      }),
    );

    const context =
      await getContractRentalRenewalUploadContext("rental-source-1");

    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/rental-source-1/renewal-upload-context",
    );
    expect(context).toMatchObject({
      sourceContractId: "rental-source-1",
      sourceContractName: "原房屋租赁合同",
      declaredCategory: "asset",
      declaredSubtype: "house_rental",
      currentLeaseEndDate: "2026-12-31",
      canUpload: true,
    });

    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contractId: "rental-renewal-new", jobId: "renewal-job-1" }),
    );
    const file = new File(["renewal"], "续签合同.pdf", {
      type: "application/pdf",
    });

    const result = await recognizeRentalRenewalContract(
      "rental-source-1",
      file,
    );

    expect(result.contractId).toBe("rental-renewal-new");
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/rental-source-1/renewals/recognize",
      expect.any(FormData),
      { timeout: 120_000 },
    );
    const formData = (api.post as jest.Mock).mock.calls.at(-1)?.[1] as FormData;
    expect(Array.from(formData.keys())).toEqual(["file"]);
    expect(formData.get("file")).toBe(file);
  });

  it("合同元数据按大类返回并保留资产租赁二级分类", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        areas: ["朝阳区"],
        projects: [],
        assetCategories: ["procurement", "software"],
        declaredSubtypeOptions: {
          main_business: [
            { value: "engineering_consulting", label: "工程咨询服务" },
            { value: "preliminary_procedures", label: "项目前期手续办理" },
            { value: "technical_consulting", label: "技术咨询服务" },
          ],
          non_main: [
            { value: "non_main_income", label: "非主营业务收入合同" },
            { value: "other_service", label: "其他服务合同" },
          ],
          asset: [
            { value: "procurement", label: "采购合同" },
            { value: "software", label: "软件合同" },
            { value: "equipment", label: "设备合同" },
            { value: "house_rental", label: "房屋租赁" },
            { value: "vehicle_rental", label: "汽车租赁" },
            { value: "parking_space", label: "车位租赁" },
            { value: "office_asset", label: "办公资产合同" },
          ],
        },
      }),
    );

    const meta = await getContractMeta();

    expect(meta.declaredSubtypeOptions.main_business).toHaveLength(3);
    expect(meta.declaredSubtypeOptions.non_main).toHaveLength(2);
    expect(meta.declaredSubtypeOptions.asset).toHaveLength(7);
    expect(meta.declaredSubtypeOptions.asset).toContainEqual({
      value: "parking_space",
      label: "车位租赁",
    });
    expect(meta.statuses).toContainEqual({
      value: "rejected",
      label: "已拒绝",
    });
  });

  it("旧服务未返回二级分类元数据时使用完整安全回退", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({ areas: [], projects: [], assetCategories: [] }),
    );

    const meta = await getContractMeta();

    expect(
      meta.declaredSubtypeOptions.main_business.map(({ value }) => value),
    ).toEqual([
      "engineering_consulting",
      "preliminary_procedures",
      "technical_consulting",
    ]);
    expect(meta.declaredSubtypeOptions.non_main).toHaveLength(2);
    expect(meta.declaredSubtypeOptions.asset).toHaveLength(7);
  });

  it("上传资产类合同时携带行政区、预选分类和资产子类", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contractId: "contract-1", jobId: "job-1" }),
    );
    const file = new File(["contract"], "采购合同.pdf", {
      type: "application/pdf",
    });

    await recognizeContract(file, {
      area: "朝阳区",
      declaredCategory: "asset",
      declaredSubtype: "software",
      relationType: "main",
      assetCategory: "software",
      requiresAuxiliaryMaterials: true,
    });

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(formData.get("file")).toBe(file);
    expect(formData.get("area")).toBe("朝阳区");
    expect(formData.get("declaredCategory")).toBe("asset");
    expect(formData.get("declaredSubtype")).toBe("software");
    expect(formData.get("relationType")).toBe("main");
    expect(formData.get("assetCategory")).toBe("software");
    expect(formData.get("requiresAuxiliaryMaterials")).toBe("true");
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/recognize",
      expect.any(FormData),
      { timeout: 120_000 },
    );
  });

  it("非资产类上传不携带资产子类", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contractId: "contract-2", jobId: "job-2" }),
    );
    const file = new File(["contract"], "咨询合同.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await recognizeContract(file, {
      area: "海淀区",
      declaredCategory: "main_business",
      declaredSubtype: "engineering_consulting",
      relationType: "main",
    });

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(formData.get("area")).toBe("海淀区");
    expect(formData.get("declaredCategory")).toBe("main_business");
    expect(formData.get("declaredSubtype")).toBe("engineering_consulting");
    expect(formData.get("relationType")).toBe("main");
    expect(formData.has("assetCategory")).toBe(false);
    expect(formData.get("requiresAuxiliaryMaterials")).toBe("false");
  });

  it("补充协议上传前携带已选上级合同", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contractId: "contract-3", jobId: "job-3" }),
    );
    const file = new File(["contract"], "补充协议.pdf", {
      type: "application/pdf",
    });

    await recognizeContract(file, {
      area: "朝阳区",
      declaredCategory: "main_business",
      declaredSubtype: "technical_consulting",
      relationType: "supplement",
      parentContractId: "parent-1",
    });

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(formData.get("relationType")).toBe("supplement");
    expect(formData.get("parentContractId")).toBe("parent-1");
  });

  it("快速补充协议入口读取并规范化主合同继承上下文", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        parent_contract_id: "parent-quick",
        root_contract_id: "root-quick",
        area: "朝阳区",
        declared_category: "main_business",
        declared_subtype: "technical_consulting",
        asset_category: null,
        project_id: "project-quick",
        project_name: "示例项目",
        party_a: "甲方公司",
        party_b: "乙方公司",
        parent_contract_name: "示例主合同",
        supplement_sequence: 2,
        generated_contract_name: "示例主合同补充协议（2）",
        original_contract_amount: "100000.00",
        current_effective_amount: "120000.00",
        can_upload: true,
        blocking_reason: null,
      }),
    );

    const context = await getContractSupplementUploadContext("parent-quick");

    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/parent-quick/supplement-upload-context",
    );
    expect(context).toMatchObject({
      parentContractId: "parent-quick",
      rootContractId: "root-quick",
      declaredCategory: "main_business",
      declaredSubtype: "technical_consulting",
      projectId: "project-quick",
      supplementSequence: 2,
      generatedContractName: "示例主合同补充协议（2）",
      originalContractAmount: "100000.00",
      currentEffectiveAmount: "120000.00",
      canUpload: true,
    });
  });

  it("快速补充协议识别只上传文件，不重复提交继承字段", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ contractId: "supplement-1", jobId: "job-supplement-1" }),
    );
    const file = new File(["supplement"], "补充协议（2）.pdf", {
      type: "application/pdf",
    });

    await recognizeSupplementContract("parent-quick", file);

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(Array.from(formData.keys())).toEqual(["file"]);
    expect(formData.get("file")).toBe(file);
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/parent-quick/supplements/recognize",
      expect.any(FormData),
      { timeout: 120_000 },
    );
  });

  it("99.99 与 99.999 均不会规范化或显示为 100", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        id: "job-confidence",
        contractId: "contract-confidence",
        status: "partial",
        warnings: [],
        fields: [
          { key: "party_a", value: "甲方", confidence: 99.99 },
          { key: "party_b", value: "乙方", confidence: 99.999 },
          { key: "project_name", value: "项目", confidence: 100 },
          { key: "amount", value: "100", confidence: true },
          { key: "category", value: "main_business", confidence: [1] },
        ],
      }),
    );

    const job = await getContractOcrJob("job-confidence");

    expect(
      job.fields.find((field) => field.key === "party_a")?.confidence,
    ).toBe(99);
    expect(
      job.fields.find((field) => field.key === "party_b")?.confidence,
    ).toBe(99);
    expect(
      job.fields.find((field) => field.key === "project_name")?.confidence,
    ).toBe(100);
    expect(
      job.fields.find((field) => field.key === "amount")?.confidence,
    ).toBeNull();
    expect(
      job.fields.find((field) => field.key === "category")?.confidence,
    ).toBeNull();
  });

  it("字段主值保留规范值，并优先映射首条完整识别证据", () => {
    const fields = normalizeOcrFields([
      {
        field: "party_b",
        originalValue: "):北京羽隶工程咨询有限公司",
        normalizedValue: "北京羽隶工程咨询有限公司",
        evidence: JSON.stringify([
          {
            text: "（乙方）：北京羽隶工程咨询有限公司",
            source: "ocr",
            pageNumber: 1,
          },
          { text: "乙方：其他候选", source: "ocr", pageNumber: 4 },
        ]),
        confidence: 99,
      },
    ]);

    const partyB = fields.find((field) => field.key === "party_b");
    expect(partyB?.value).toBe("北京羽隶工程咨询有限公司");
    expect(partyB?.rawText).toBe("):北京羽隶工程咨询有限公司");
    expect(partyB?.evidenceText).toBe("（乙方）：北京羽隶工程咨询有限公司");
  });

  it("兼容接口直接返回证据数组及旧数据纯文本证据", () => {
    const fields = normalizeOcrFields([
      {
        field: "party_a",
        normalizedValue: "甲方有限公司",
        evidence: [{ text: "甲方：甲方有限公司" }],
      },
      {
        field: "project_name",
        normalizedValue: "测试项目",
        evidence: "项目名称：测试项目",
      },
    ]);

    expect(fields.find((field) => field.key === "party_a")?.evidenceText).toBe(
      "甲方：甲方有限公司",
    );
    expect(
      fields.find((field) => field.key === "project_name")?.evidenceText,
    ).toBe("项目名称：测试项目");
  });

  it("明显期限矛盾日期清空规范值后财务确认初始值为空且证据仍可见", () => {
    const fields = normalizeOcrFields([
      {
        field: "contract_date",
        originalValue: "2015.12.10",
        normalizedValue: "",
        evidence: [
          {
            text: "签订时间：2015.12.10",
            source: "ocr_300",
            pageNumber: 1,
          },
        ],
        confidence: 45,
      },
    ]);

    const contractDate = fields.find((field) => field.key === "contract_date");
    expect(contractDate?.value).toBe("");
    expect(contractDate?.rawText).toBe("2015.12.10");
    expect(contractDate?.evidenceText).toBe("签订时间：2015.12.10");
    expect(contractDate?.confidence).toBe(45);
  });
});
