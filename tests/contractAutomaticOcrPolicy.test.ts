jest.mock("nanoid", () => ({ nanoid: () => "automatic-policy-id" }));
jest.mock("../server/db/index", () => ({ db: {} }));

import fs from "fs";
import path from "path";
import {
  buildSupplementSubjectName,
  CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
  decideContractAutomaticOcrAdoption,
  supplementSubjectMatchesParent,
  type ContractAutomaticOcrPolicyInput,
} from "../server/services/contractService";
import {
  CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP,
  getContractAmountAutomaticAdoptionContext,
  getContractOcrAutomaticAdoptionSafetyContext,
  getContractOcrCandidateFunnelTrace,
  parseContractText,
  type ContractOcrAmountAutomaticAdoptionSafety,
  type ContractOcrAutomaticAdoptionSafetyContext,
  type ContractOcrProjectAutomaticAdoptionSafety,
} from "../server/services/contractOcr";

const completeFields = [
  { field: "party_a", normalizedValue: "国网北京市电力公司" },
  { field: "party_b", normalizedValue: "北京羽隶工程咨询有限公司" },
  {
    field: "project_name",
    normalizedValue: "东玉河220千伏输变电工程工程规划许可证、施工许可证",
  },
  { field: "amount", normalizedValue: "290000.00" },
  { field: "category", normalizedValue: "main_business" },
  { field: "contract_date", normalizedValue: "2025-09-12" },
] as const;

function policyInput(
  overrides: Partial<ContractAutomaticOcrPolicyInput> = {},
): ContractAutomaticOcrPolicyInput {
  const fields = overrides.fields || completeFields;
  const selectedValue = (fieldCode: string) =>
    fields.find((field) => field.field === fieldCode)?.normalizedValue == null
      ? null
      : String(
          fields.find((field) => field.field === fieldCode)?.normalizedValue,
        );
  return {
    resultStatus: "partial",
    relationType: "main",
    declaredCategory: "main_business",
    rawText: "技术服务合同",
    fields,
    amountContext:
      overrides.amountContext === undefined
        ? selectedValue("amount")
          ? { status: "confirmed_amount", missingAmountEligible: false }
          : { status: "missing_amount", missingAmountEligible: true }
        : overrides.amountContext,
    safetyContext:
      overrides.safetyContext === undefined
        ? safetyContext({
            project: { selectedValue: selectedValue("project_name") },
            amount: { selectedValue: selectedValue("amount") },
          })
        : overrides.safetyContext,
    ...overrides,
  };
}

function safetyContext(
  overrides: {
    project?: Partial<ContractOcrProjectAutomaticAdoptionSafety>;
    amount?: Partial<ContractOcrAmountAutomaticAdoptionSafety>;
  } = {},
): ContractOcrAutomaticAdoptionSafetyContext {
  return {
    project: {
      selectedValue:
        "selectedValue" in (overrides.project || {})
          ? overrides.project?.selectedValue || null
          : "东玉河220千伏输变电工程工程规划许可证、施工许可证",
      candidateExists: true,
      trustedSource: true,
      source: "ocr_300",
      pageNumber: 1,
      origin: "labeled_field",
      strongEvidence: true,
      distinctCandidateCount: 1,
      leadingScore: 120,
      runnerUpScore: null,
      scoreGap: null,
      uniqueOrSufficientGap: true,
      genericContractType: false,
      organizationName: false,
      paymentClause: false,
      pdfTextEvidencePresent: false,
      samePageVisibleOcrEvidence: true,
      calculatedRelationVisibleClosure: false,
      riskCodes: [],
      ...overrides.project,
    },
    amount: {
      selectedValue:
        "selectedValue" in (overrides.amount || {})
          ? overrides.amount?.selectedValue || null
          : "290000.00",
      candidateExists: true,
      role: "contract_total",
      scope: "current_contract",
      strongEvidence: true,
      explicitContractTotal: true,
      amountEventConflict: false,
      unresolvedContractAmountFact: false,
      pdfTextEvidencePresent: false,
      samePageVisibleOcrEvidence: true,
      riskCodes: [],
      ...overrides.amount,
    },
  };
}

describe("合同最高合格候选自动采用策略", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );
  const ocrSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractOcr.ts"),
    "utf8",
  );

  it("非主营闭合服务对象经同页文字层和可见OCR一致复核后自动通过", () => {
    const page2 = [
      "咨询服务协议",
      "甲方：北京御海天朝文化发展有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "甲方是合法成立并有效存续的有限责任公司，主要负责北京市西城区后海项目的建设。",
      "甲方现聘请乙方作为顾问，为甲方就北京市西城区后海项目的交通影响评价咨询及协调工作提供服务；乙方亦愿意接受甲方的聘请。",
    ].join("\n");
    const page3 = [
      "第四条 咨询服务费和违约金及支付方式",
      "总价款双方约定咨询费总价款为1500000元（人民币壹佰伍拾万元整）。",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text: page2,
          source: "pdf_text",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
        {
          text: page2,
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: page3,
          source: "pdf_text",
          pageNumber: 3,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
        {
          text: page3,
          source: "ocr_300",
          pageNumber: 3,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: parsed.status,
      failureKind: parsed.failureKind,
      relationType: "main",
      declaredCategory: "non_main",
      rawText: parsed.rawText,
      fields: parsed.fields,
      amountContext: getContractAmountAutomaticAdoptionContext(parsed),
      safetyContext: safety,
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("北京市西城区后海项目的交通影响评价咨询");
    expect(
      parsed.fields.find((field) => field.field === "amount")?.normalizedValue,
    ).toBe("1500000.00");
    expect(safety.project).toMatchObject({
      trustedSource: true,
      strongEvidence: true,
      samePageVisibleOcrEvidence: true,
      uniqueOrSufficientGap: true,
      riskCodes: [],
    });
    expect(safety.amount).toMatchObject({
      role: "contract_total",
      scope: "current_contract",
      strongEvidence: true,
      explicitContractTotal: true,
      samePageVisibleOcrEvidence: true,
      riskCodes: [],
    });
    expect(decision).toMatchObject({
      accepted: true,
      status: "succeeded",
      blockers: [],
      values: {
        project_name: "北京市西城区后海项目的交通影响评价咨询",
        amount: "1500000.00",
        category: "non_main",
      },
    });
  });

  it.each([
    [
      "雍景桃源项目闲置地相关问题咨询",
      "甲方现聘请乙方作为顾问，为甲方就雍景桃源项目闲置地相关问题咨询及协调工作提供服务。",
      "总价款双方约定咨询费总价款为850000元。",
      "850000.00",
    ],
    [
      "北京市西城区后海项目的建设相关问题咨询",
      "甲方现聘请乙方作为顾问，为甲方就北京市西城区后海项目的建设相关问题咨询及协调工作提供服务。",
      "总价款双方约定咨询费总价款为960000元。",
      "960000.00",
    ],
  ])(
    "非主营通用咨询协议按闭合委托语义识别而不依赖固定模板：%s",
    (expectedProject, projectClause, amountClause, expectedAmount) => {
      const text = [
        "咨询服务协议",
        "甲方：北京甲方管理有限公司",
        "乙方：北京羽隶工程咨询有限公司",
        projectClause,
        amountClause,
      ].join("\n");
      const parsed = parseContractText("", {
        relationType: "main",
        expectedCategory: "non_main",
        sources: [
          {
            text,
            source: "pdf_text",
            pageNumber: 2,
            confidence: 0.99,
            recognitionEngine: "pdf_text",
          },
          {
            text,
            source: "ocr_300",
            pageNumber: 2,
            confidence: 0.99,
            recognitionEngine: "paddleocr",
          },
        ],
      });
      const safety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;

      expect(
        parsed.fields.find((field) => field.field === "project_name")
          ?.normalizedValue,
      ).toBe(expectedProject);
      expect(
        parsed.fields.find((field) => field.field === "amount")
          ?.normalizedValue,
      ).toBe(expectedAmount);
      expect(safety.project.riskCodes).toEqual([]);
      expect(safety.amount.riskCodes).toEqual([]);
    },
  );

  it("非主营闭合服务对象只有PDF文字层时仍保持失败关闭", () => {
    const text = [
      "咨询服务协议",
      "甲方：北京御海天朝文化发展有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "甲方现聘请乙方作为顾问，为甲方就北京市西城区后海项目的交通影响评价咨询及协调工作提供服务。",
      "咨询费总价款为1500000元。",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
      ],
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;

    expect(safety.project).toMatchObject({
      trustedSource: false,
      samePageVisibleOcrEvidence: false,
    });
    expect(safety.project.riskCodes).toEqual(
      expect.arrayContaining([
        "PROJECT_SOURCE_UNTRUSTED",
        "PROJECT_PDF_VISIBLE_EVIDENCE_MISSING",
      ]),
    );
  });

  it.each([
    ["年度审计服务合同", "年度审计服务"],
    ["品牌广告制作协议", "品牌广告制作"],
    ["办公区域保洁服务合同", "办公区域保洁服务"],
  ])("非主营首页业务标题不依赖主营工程词表：%s", (title, expected) => {
    const text = [
      title,
      "甲方：北京甲方管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe(expected);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(parsed)?.project,
    ).toMatchObject({
      selectedValue: expected,
      trustedSource: true,
      strongEvidence: true,
      samePageVisibleOcrEvidence: true,
      riskCodes: [],
    });
  });

  it("非主营封面条形码不拼入项目名且阶段付款不覆盖跨页合同总价", () => {
    const page1 = [
      "1202408310021",
      "璞湾项目咨询服务合同",
      "委托人（以下简称甲方）：北京市佳利华经济开发有限责任公司",
      "受托人（以下简称乙方）：北京羽隶工程咨询有限公司",
      "第二条 咨询服务费",
      "1、合同价款：本合同项下咨询服务费总价款为人民币1,200,000",
    ].join("\n");
    const page2 = [
      "元（大写：壹佰贰拾万元整）。该总价款为包含增值税的价格。",
      "2、支付方式：",
      "（1）取得会议纪要后15个工作日内，支付合同金额的50%，即人民币600，000元。",
      "（2）取得书面批复后15个工作日内，支付合同金额的50%，即人民币600,000元。",
    ].join("\n");
    const sources = (["ocr_300", "ocr_480"] as const).flatMap((source) => [
      {
        text: page1,
        source,
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      },
      {
        text: page2,
        source,
        pageNumber: 2,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      },
    ]);
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources,
      candidateFunnelDiagnostics: true,
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;
    const trace = getContractOcrCandidateFunnelTrace(parsed)!;

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("璞湾项目");
    expect(
      parsed.fields.find((field) => field.field === "amount")?.normalizedValue,
    ).toBe("1200000.00");
    expect(safety.project).toMatchObject({
      selectedValue: "璞湾项目",
      trustedSource: true,
      uniqueOrSufficientGap: true,
      riskCodes: [],
    });
    expect(safety.amount).toMatchObject({
      selectedValue: "1200000.00",
      role: "contract_total",
      scope: "current_contract",
      strongEvidence: true,
      explicitContractTotal: true,
      riskCodes: [],
    });
    expect(
      trace.generatedCandidates
        .filter(
          (candidate) =>
            candidate.field === "amount" &&
            candidate.normalizedValue === "600000.00",
        )
        .map((candidate) => candidate.amountRole),
    ).toEqual(expect.arrayContaining(["payment_amount"]));
    expect(
      trace.generatedCandidates.find(
        (candidate) =>
          candidate.field === "amount" &&
          candidate.normalizedValue === "1200000.00",
      ),
    ).toMatchObject({
      amountRole: "contract_total",
      explicitContractTotal: true,
    });
  });

  it("非主营合同只有按合同金额比例支付的阶段款时不得冒充合同总额", () => {
    const text = [
      "璞湾项目咨询服务合同",
      "甲方：北京市佳利华经济开发有限责任公司",
      "乙方：北京羽隶工程咨询有限公司",
      "支付合同金额的50%，即人民币600,000元。",
      "另一期支付合同金额的50%，即人民币600，000元。",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text,
          source: "ocr_480",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "amount")?.normalizedValue,
    ).toBe("");
    expect(getContractAmountAutomaticAdoptionContext(parsed)).toMatchObject({
      status: "payment_only",
    });
  });

  it("非主营局部增强的残缺标题与后续完整行重叠时只保留完整标题", () => {
    const text = [
      "1202408310021",
      "璞湾项",
      "目咨询服务合",
      "璞湾项目咨询服务合同",
      "甲方：北京市佳利华经济开发有限责任公司",
      "乙方：北京羽隶工程咨询有限公司",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          fieldScope: "project_name",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("璞湾项目");
    expect(
      parsed.fields.find((field) => field.field === "project_name")?.candidates,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "璞湾项目咨询服务合璞湾项目",
        }),
      ]),
    );
  });

  it("与标题同一行的年度数字仍属于非主营项目名称", () => {
    const text = [
      "2026年度审计服务合同",
      "甲方：北京甲方管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("2026年度审计服务");
  });

  it("非主营通用标题分包合同从闭合的上游项目合同与本次委托中取项目", () => {
    const page1 = [
      "技术咨询服务合同",
      "甲方：北京清水玖顺工程咨询有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "鉴于：",
      "甲方已与北京市佳利华经济开发有限责任公司签署《椿萱茂北京璞湾长者社区项目3号楼规划验收咨询服务合同》，为该项目提供技术咨询服务。",
      "现甲方委托乙方协助甲方在椿萱茂北京璞湾长者社区项目3号楼规划验收手续办理事项中提供技术咨询服务支持工作。",
    ].join("\n");
    const page2 =
      "第4条 技术咨询服务费收取\n本合同技术咨询服务费总额为：600,000元，人民币大写陆拾万元整。";
    const sources = (["ocr_300", "ocr_480"] as const).flatMap((source) => [
      {
        text: page1,
        source,
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      },
      {
        text: page2,
        source,
        pageNumber: 2,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      },
    ]);
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources,
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("椿萱茂北京璞湾长者社区项目3号楼规划验收咨询服务");
    expect(
      parsed.fields.find((field) => field.field === "amount")?.normalizedValue,
    ).toBe("600000.00");
    expect(safety.project).toMatchObject({
      trustedSource: true,
      strongEvidence: true,
      uniqueOrSufficientGap: true,
      riskCodes: [],
    });
    expect(safety.amount).toMatchObject({
      role: "contract_total",
      explicitContractTotal: true,
      riskCodes: [],
    });
  });

  it("只引用上游合同但没有形成本次委托闭环时不能冒充非主营项目", () => {
    const text = [
      "技术咨询服务合同",
      "甲方：北京甲方管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "甲方已与第三方签署《无关园区项目规划验收咨询服务合同》。",
      "本合同仅用于一般政策答疑。",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text,
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("");
  });

  it("非主营明确服务对象字段经同页可见复核后可形成可信项目", () => {
    const text = [
      "咨询服务协议",
      "甲方：北京甲方管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
      "本协议服务对象为年度审计服务。",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 2,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const projectSafety =
      getContractOcrAutomaticAdoptionSafetyContext(parsed)?.project;

    expect(projectSafety).toMatchObject({
      selectedValue: "年度审计服务",
      trustedSource: true,
      strongEvidence: true,
      samePageVisibleOcrEvidence: true,
      riskCodes: [],
    });
  });

  it("非主营纯合同类型标题仍不能冒充项目名称", () => {
    const text = [
      "咨询服务协议",
      "甲方：北京甲方管理有限公司",
      "乙方：北京羽隶工程咨询有限公司",
    ].join("\n");
    const parsed = parseContractText("", {
      relationType: "main",
      expectedCategory: "non_main",
      sources: [
        {
          text,
          source: "pdf_text",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "pdf_text",
        },
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      parsed.fields.find((field) => field.field === "project_name")
        ?.normalizedValue,
    ).toBe("");
  });

  it("冻结候选安全门禁策略版本", () => {
    expect(CONTRACT_OCR_AUTOMATIC_POLICY_VERSION).toBe(
      "highest-qualified-candidate-v3",
    );
  });

  it("不再依赖整数100分，将OCR服务已排序的最高合格候选自动采用", () => {
    const decision = decideContractAutomaticOcrAdoption(policyInput());

    expect(decision).toMatchObject({
      accepted: true,
      status: "succeeded",
      legalEmptyFields: [],
      blockers: [],
    });
    expect(decision.values).toEqual({
      party_a: "国网北京市电力公司",
      party_b: "北京羽隶工程咨询有限公司",
      project_name: "东玉河220千伏输变电工程工程规划许可证、施工许可证",
      amount: "290000.00",
      category: "main_business",
      contract_date: "2025-09-12",
    });
    expect(decision.warnings).toContain(
      `自动采用策略：${CONTRACT_OCR_AUTOMATIC_POLICY_VERSION}`,
    );
  });

  it("候选安全上下文缺失时失败关闭，字段残留值不能自动采用", () => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({ safetyContext: null }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.status).toBe("partial");
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "项目名称缺少候选安全证据",
        "合同金额缺少候选安全证据",
      ]),
    );
  });

  it("资产类安全门禁使用合同名称术语", () => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({ declaredCategory: "asset", safetyContext: null }),
    );
    const missingName = decideContractAutomaticOcrAdoption(
      policyInput({
        declaredCategory: "asset",
        fields: completeFields.map((field) =>
          field.field === "project_name"
            ? { ...field, normalizedValue: "" }
            : field,
        ),
        safetyContext: safetyContext({
          project: {
            selectedValue: null,
            candidateExists: false,
            trustedSource: false,
            strongEvidence: false,
            distinctCandidateCount: 0,
            leadingScore: null,
            runnerUpScore: null,
            scoreGap: null,
            uniqueOrSufficientGap: false,
          },
        }),
      }),
    );

    expect(decision.blockers).toContain("合同名称缺少候选安全证据");
    expect(decision.blockers).not.toContain("项目名称缺少候选安全证据");
    expect(missingName.blockers).toContain("合同名称没有可采用候选");
    expect(missingName.blockers).not.toContain("项目名称没有可采用候选");
  });

  it("补充协议名称固定继承主合同名称并追加补充协议", () => {
    expect(
      buildSupplementSubjectName({
        project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
        title: "不应优先使用的标题",
      }),
    ).toBe("费家村110千伏输变电工程前期手续技术咨询服务补充协议");
    expect(
      buildSupplementSubjectName({
        project_name: null,
        title: "办公用房租赁合同",
      }),
    ).toBe("办公用房租赁合同补充协议");
    expect(
      buildSupplementSubjectName({
        project_name: "办公用房租赁合同补充协议书",
        title: null,
      }),
    ).toBe("办公用房租赁合同补充协议");
    expect(
      buildSupplementSubjectName(
        {
          project_name: "费家村110千伏输变电工程前期手续技术咨询服务",
          title: null,
        },
        12,
      ),
    ).toBe("费家村110千伏输变电工程前期手续技术咨询服务补充协议（12）");
  });

  it("补充协议名称不依赖OCR候选，可靠正文仅用于核对所选主合同", () => {
    const inheritedSubjectName =
      "费家村110千伏输变电工程前期手续技术咨询服务补充协议（2）";
    const fields = completeFields.filter(
      (field) => field.field !== "project_name",
    );
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        fields,
        inheritedSubjectName,
        recognizedSubjectMatchesParent: null,
        amountContext: {
          status: "confirmed_amount",
          missingAmountEligible: false,
        },
        safetyContext: safetyContext({
          amount: {
            role: "relation_adjustment",
            scope: "relation_total",
          },
        }),
      }),
    );

    expect(decision.values.project_name).toBe(inheritedSubjectName);
    expect(decision.blockers).not.toContain(
      "识别结果缺少核心字段记录：project_name",
    );
    expect(decision.blockers).not.toEqual(
      expect.arrayContaining([
        "项目名称缺少候选安全证据",
        "项目名称没有可采用候选",
      ]),
    );
  });

  it("补充协议正文名称与主合同明显不一致时阻止自动采用", () => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        inheritedSubjectName:
          "费家村110千伏输变电工程前期手续技术咨询服务补充协议",
        recognizedSubjectMatchesParent: false,
        amountContext: {
          status: "confirmed_amount",
          missingAmountEligible: false,
        },
        safetyContext: safetyContext({
          amount: {
            role: "relation_adjustment",
            scope: "relation_total",
          },
        }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toContain(
      "补充协议正文项目名称与所选主合同不一致",
    );
  });

  it("补充协议正文名称支持合同后缀差异，通用协议名不作错误判断", () => {
    const parent = {
      project_name: "网络接入技术服务合同",
      title: null,
    };
    expect(
      supplementSubjectMatchesParent("网络接入技术服务补充协议", parent),
    ).toBe(true);
    expect(
      supplementSubjectMatchesParent("其他设备采购项目补充协议", parent),
    ).toBe(false);
    expect(
      supplementSubjectMatchesParent("网络接入技术服务合同续签协议", parent),
    ).toBe(true);
    expect(supplementSubjectMatchesParent("续签协议", parent)).toBeNull();
    expect(supplementSubjectMatchesParent("补充协议", parent)).toBeNull();
  });

  it("补充协议正文项目名称尾部被截断时仍可核对到同一主合同", () => {
    const parent = {
      project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务",
      title: null,
    };

    expect(
      supplementSubjectMatchesParent("焦化厂110千伏输变电工程前期手续", parent),
    ).toBe(true);
    expect(
      supplementSubjectMatchesParent("焦化厂110千伏输变电工程", parent),
    ).toBe(false);
    expect(
      supplementSubjectMatchesParent(
        "其他厂110千伏输变电工程前期手续技术咨询服务",
        parent,
      ),
    ).toBe(false);
  });

  it.each([
    {
      label: "候选不存在",
      projectValue: completeFields[2].normalizedValue,
      projectSafety: { candidateExists: false },
      blocker: "项目名称没有可验证候选",
    },
    {
      label: "来源不可信",
      projectValue: completeFields[2].normalizedValue,
      projectSafety: { trustedSource: false },
      blocker: "项目名称候选来源不满足自动采用条件",
    },
    {
      label: "纯合同类型",
      projectValue: "技术服务合同",
      projectSafety: { genericContractType: false },
      blocker: "项目名称候选属于合同或协议类型",
    },
    {
      label: "公司名称",
      projectValue: "北京羽隶工程咨询有限公司",
      projectSafety: { organizationName: false },
      blocker: "项目名称候选属于单位名称",
    },
    {
      label: "付款条款",
      projectValue: "付款方式及进度款安排",
      projectSafety: { paymentClause: false },
      blocker: "项目名称候选属于付款或费用条款",
    },
  ])("项目名称$label不能绕过安全门禁", (scenario) => {
    const fields = completeFields.map((field) =>
      field.field === "project_name"
        ? { ...field, normalizedValue: scenario.projectValue }
        : field,
    );
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        fields,
        safetyContext: safetyContext({
          project: {
            selectedValue: scenario.projectValue,
            ...scenario.projectSafety,
          },
        }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toContain(scenario.blocker);
  });

  it("项目候选分差低于阈值时阻断，达到阈值时允许最高候选", () => {
    const insufficient = decideContractAutomaticOcrAdoption(
      policyInput({
        safetyContext: safetyContext({
          project: {
            distinctCandidateCount: 2,
            leadingScore: 100,
            runnerUpScore:
              100 - (CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP - 1),
            scoreGap: CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP - 1,
            // 即使调用方伪造布尔值，策略仍按实际分数重新计算。
            uniqueOrSufficientGap: true,
          },
        }),
      }),
    );
    const sufficient = decideContractAutomaticOcrAdoption(
      policyInput({
        safetyContext: safetyContext({
          project: {
            distinctCandidateCount: 2,
            leadingScore: 100,
            runnerUpScore:
              100 - CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP,
            scoreGap: CONTRACT_PROJECT_AUTOMATIC_ADOPTION_MINIMUM_SCORE_GAP,
            uniqueOrSufficientGap: true,
          },
        }),
      }),
    );

    expect(insufficient.accepted).toBe(false);
    expect(insufficient.blockers).toContain("项目名称候选不唯一且排序差距不足");
    expect(sufficient.accepted).toBe(true);
  });

  it("PDF文字层项目和金额必须由同页可见OCR同值同角色佐证", () => {
    const pdfText = [
      "工程咨询服务合同",
      "项目名称：东城更新项目",
      "甲方：北京建设有限公司",
      "乙方：北京咨询有限公司",
      "合同金额：100000元",
      "合同签订日期：2026年8月5日",
    ].join("\n");
    const parseWithVisibleText = (visibleText: string, visiblePage = 1) =>
      parseContractText("", {
        relationType: "main",
        expectedCategory: "main_business",
        sources: [
          {
            text: pdfText,
            source: "pdf_text",
            pageNumber: 1,
            confidence: 99,
          },
          {
            text: visibleText,
            source: "ocr_300",
            pageNumber: visiblePage,
            confidence: 99,
            recognitionEngine: "paddleocr",
          },
        ],
      });
    const hiddenOnly = parseWithVisibleText("印章遮挡，未识别到字段");
    const verified = parseWithVisibleText(pdfText);
    const crossPage = parseWithVisibleText(pdfText, 2);
    const wrongAmountRole = parseWithVisibleText(
      pdfText.replace("合同金额：100000元", "付款金额：100000元"),
    );
    const hiddenSafety =
      getContractOcrAutomaticAdoptionSafetyContext(hiddenOnly)!;
    const verifiedSafety =
      getContractOcrAutomaticAdoptionSafetyContext(verified)!;
    const hiddenDecision = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: hiddenOnly.fields,
        rawText: hiddenOnly.rawText,
        amountContext: getContractAmountAutomaticAdoptionContext(hiddenOnly),
        safetyContext: hiddenSafety,
      }),
    );
    const verifiedDecision = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: verified.fields,
        rawText: verified.rawText,
        amountContext: getContractAmountAutomaticAdoptionContext(verified),
        safetyContext: verifiedSafety,
      }),
    );

    expect(hiddenSafety.project).toMatchObject({
      pdfTextEvidencePresent: true,
      samePageVisibleOcrEvidence: false,
      trustedSource: false,
    });
    expect(hiddenSafety.amount).toMatchObject({
      pdfTextEvidencePresent: true,
      samePageVisibleOcrEvidence: false,
    });
    expect(hiddenDecision.accepted).toBe(false);
    expect(hiddenDecision.blockers).toEqual(
      expect.arrayContaining([
        "项目名称PDF文字层候选缺少同页可见OCR同值佐证",
        "合同金额PDF文字层候选缺少同页可见OCR同值同角色佐证",
      ]),
    );
    expect(verifiedSafety.project.samePageVisibleOcrEvidence).toBe(true);
    expect(verifiedSafety.amount.samePageVisibleOcrEvidence).toBe(true);
    expect(verifiedDecision.accepted).toBe(true);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(crossPage)?.project
        .samePageVisibleOcrEvidence,
    ).toBe(false);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(wrongAmountRole)?.amount
        .samePageVisibleOcrEvidence,
    ).toBe(false);
  });

  it.each([
    ["payment_amount", "current_contract"],
    ["tax_amount", "current_contract"],
    ["service_fee", "current_contract"],
    ["unit_price", "current_contract"],
    ["generic_total", "unscoped"],
  ] as const)("金额角色%s、作用域%s不能自动采用", (role, scope) => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        safetyContext: safetyContext({
          amount: {
            role,
            scope,
            explicitContractTotal: false,
          },
        }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "合同金额候选没有明确合同金额角色",
        "合同金额候选缺少整份合同作用域",
      ]),
    );
  });

  it("补充协议只采用有变更角色和总额作用域的计算金额", () => {
    const fields = completeFields.map((field) =>
      field.field === "amount"
        ? { ...field, normalizedValue: "60000.00" }
        : field,
    );
    const accepted = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        fields,
        amountContext: {
          status: "calculated_amount",
          missingAmountEligible: false,
        },
        safetyContext: safetyContext({
          amount: {
            selectedValue: "60000.00",
            role: "relation_adjustment",
            scope: "relation_total",
            explicitContractTotal: false,
            pdfTextEvidencePresent: true,
            samePageVisibleOcrEvidence: false,
            calculatedRelationVisibleClosure: true,
          },
        }),
      }),
    );
    const unscoped = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        fields,
        amountContext: {
          status: "calculated_amount",
          missingAmountEligible: false,
        },
        safetyContext: safetyContext({
          amount: {
            selectedValue: "60000.00",
            role: "relation_adjustment",
            scope: "component",
            explicitContractTotal: false,
          },
        }),
      }),
    );
    const missingVisibleClosure = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        fields,
        amountContext: {
          status: "calculated_amount",
          missingAmountEligible: false,
        },
        safetyContext: safetyContext({
          amount: {
            selectedValue: "60000.00",
            role: "relation_adjustment",
            scope: "relation_total",
            explicitContractTotal: false,
            pdfTextEvidencePresent: true,
            samePageVisibleOcrEvidence: false,
            calculatedRelationVisibleClosure: false,
          },
        }),
      }),
    );

    expect(accepted.accepted).toBe(true);
    expect(unscoped.accepted).toBe(false);
    expect(unscoped.blockers).toContain(
      "补充或终止协议金额缺少本次变更总额作用域",
    );
    expect(missingVisibleClosure.accepted).toBe(false);
    expect(missingVisibleClosure.blockers).toContain(
      "合同金额PDF文字层候选缺少同页可见OCR同值同角色佐证",
    );
  });

  it("原文存在未分类明确金额时不能伪装成安全金额缺失", () => {
    const fields = completeFields.map((field) =>
      field.field === "amount" ? { ...field, normalizedValue: null } : field,
    );
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        fields,
        amountContext: {
          status: "missing_amount",
          missingAmountEligible: true,
        },
        safetyContext: safetyContext({
          amount: {
            selectedValue: null,
            candidateExists: false,
            role: null,
            scope: "unscoped",
            strongEvidence: false,
            explicitContractTotal: false,
            unresolvedContractAmountFact: true,
            riskCodes: ["AMOUNT_UNRESOLVED_RAW_FACT"],
          },
        }),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toContain(
      "原文存在尚未形成候选的明确合同金额事实",
    );
  });

  it.each([
    "合同金额按实际结算\n合同期限3年",
    "合同金额据实结算\n税率6%",
    "合同金额另行协商\n签署日期2026年8月10日",
    "合同金额以审计结果为准\n项目编号20260810",
  ])("无固定金额语义不会被后续普通数字误判：%s", (rawText) => {
    const parsed = parseContractText(rawText, { relationType: "main" });
    const amountContext = getContractAmountAutomaticAdoptionContext(parsed);
    const amountSafety =
      getContractOcrAutomaticAdoptionSafetyContext(parsed)!.amount;

    expect(amountContext).toEqual({
      status: "missing_amount",
      missingAmountEligible: true,
    });
    expect(amountSafety).toMatchObject({
      selectedValue: null,
      unresolvedContractAmountFact: false,
      riskCodes: [],
    });
  });

  it.each(["合同金额\n100000", "合同金额：100000", "合同总价\n100,000.00"])(
    "明确金额标签后的无单位金额形成候选且不能与空字段绕过门禁：%s",
    (rawText) => {
      const parsed = parseContractText(rawText, { relationType: "main" });
      const amountSafety =
        getContractOcrAutomaticAdoptionSafetyContext(parsed)!.amount;
      const decision = decideContractAutomaticOcrAdoption(
        policyInput({
          rawText,
          fields: completeFields.map((field) =>
            field.field === "amount"
              ? { ...field, normalizedValue: null }
              : field,
          ),
          amountContext: getContractAmountAutomaticAdoptionContext(parsed),
          safetyContext: safetyContext({ amount: amountSafety }),
        }),
      );

      expect(amountSafety).toMatchObject({
        selectedValue: "100000.00",
        candidateExists: true,
        unresolvedContractAmountFact: false,
      });
      expect(amountSafety.riskCodes).not.toContain(
        "AMOUNT_UNRESOLVED_RAW_FACT",
      );
      expect(decision.accepted).toBe(false);
      expect(decision.blockers).toContain("合同金额与候选安全证据不一致");
    },
  );

  it("框架协议允许项目、金额和日期为空，并使用上传锁定分类", () => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        rawText: "前期手续咨询服务框架采购协议",
        fields: completeFields.map((field) =>
          ["project_name", "amount", "category", "contract_date"].includes(
            field.field,
          )
            ? { ...field, normalizedValue: null }
            : field,
        ),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.legalEmptyFields).toEqual([
      "project_name",
      "amount",
      "contract_date",
    ]);
    expect(decision.values.category).toBe("main_business");
    expect(decision.warnings).toContain(
      "合同类型采用上传前选择值，不参与OCR识别和安全门禁",
    );
  });

  it("支付方式补充协议允许金额为空且解除协议自身金额固定为零", () => {
    const supplement = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        rawText: "本补充协议仅变更支付方式",
        fields: completeFields.map((field) =>
          ["amount", "contract_date"].includes(field.field)
            ? { ...field, normalizedValue: null }
            : field,
        ),
      }),
    );
    const termination = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "termination",
        rawText: "解除协议书",
        fields: completeFields.map((field) =>
          ["project_name", "amount", "contract_date"].includes(field.field)
            ? { ...field, normalizedValue: null }
            : field,
        ),
      }),
    );

    expect(supplement.accepted).toBe(true);
    expect(supplement.legalEmptyFields).toEqual(["amount", "contract_date"]);
    expect(termination.accepted).toBe(true);
    expect(termination.values.amount).toBe("0.00");
    expect(termination.legalEmptyFields).toEqual([
      "project_name",
      "contract_date",
    ]);
    expect(termination.warnings).toContain(
      "解除协议自身合同金额固定为0；解除结算调整额采用有效结算记录生成，不采用正文金额候选",
    );
  });

  it("普通主合同缺少项目时阻断，安全金额缺失保持合法空值", () => {
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: completeFields.map((field) =>
          ["project_name", "amount"].includes(field.field)
            ? { ...field, normalizedValue: null }
            : field,
        ),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.status).toBe("partial");
    expect(decision.blockers).toEqual(
      expect.arrayContaining(["项目名称没有可采用候选"]),
    );
    expect(decision.legalEmptyFields).toContain("amount");
  });

  it("普通主合同只有安全的金额缺失状态才允许金额为空", () => {
    const rawText = "技术服务合同\n本合同服务内容为现场资料整理。";
    const parsed = parseContractText(rawText, { relationType: "main" });
    const parsedSafety = getContractOcrAutomaticAdoptionSafetyContext(parsed)!;
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        rawText,
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: null }
            : field,
        ),
        amountContext: getContractAmountAutomaticAdoptionContext(parsed),
        safetyContext: safetyContext({ amount: parsedSafety.amount }),
      }),
    );

    expect(decision.accepted).toBe(true);
    expect(decision.values.amount).toBeNull();
    expect(decision.legalEmptyFields).toContain("amount");
    expect(decision.warnings).toContain("合同金额自动采用合法空值");
  });

  it("金额缺失分类包含强总额冲突时继续阻断自动采用", () => {
    const rawText = [
      "合同总金额：人民币100000元。",
      "合同总价：人民币120000元。",
      "付款金额：人民币3000元。",
    ].join("\n");
    const parsed = parseContractText(rawText, { relationType: "main" });
    const amountContext = getContractAmountAutomaticAdoptionContext(parsed);
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        rawText,
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: null }
            : field,
        ),
        amountContext,
        safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
      }),
    );

    expect(amountContext).toEqual({
      status: "missing_amount",
      missingAmountEligible: false,
    });
    expect(decision.accepted).toBe(false);
    expect(decision.values.amount).toBeNull();
    expect(decision.blockers).toContain("合同金额没有可采用候选");
  });

  it("补充协议原有空金额豁免也不能覆盖未决强金额事实", () => {
    const rawText = [
      "补充协议",
      "原合同金额为230000元。",
      "付款金额为3000元。",
    ].join("\n");
    const parsed = parseContractText(rawText, { relationType: "supplement" });
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        relationType: "supplement",
        rawText,
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: null }
            : field,
        ),
        amountContext: getContractAmountAutomaticAdoptionContext(parsed),
        safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
      }),
    );

    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toContain("合同金额没有可采用候选");
  });

  it("租赁续签的新租期总额作为正向补充金额自动采用", () => {
    const rawText = `房屋租赁续签协议
甲方：北京出租方有限公司
乙方：北京承租方有限公司
续租期自2027年01月01日起至2027年12月31日止。
续租期间每月租金为人民币10000元/月。
本续签协议一式肆份，甲乙双方各执贰份。
合同签订日期：2026年12月20日`;
    const parsed = parseContractText("", {
      sources: ["ocr_300", "ocr_480"].map((source) => ({
        text: rawText,
        source: source as "ocr_300" | "ocr_480",
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      })),
      expectedCategory: "asset",
      relationType: "supplement",
      leaseOperationType: "renewal",
    });
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: parsed.status,
      relationType: "supplement",
      declaredCategory: "asset",
      rawText,
      fields: parsed.fields.map((field) => ({
        field: field.field,
        normalizedValue: field.normalizedValue,
      })),
      amountContext: getContractAmountAutomaticAdoptionContext(parsed),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
      inheritedSubjectName: "原房屋租赁合同补充协议（1）",
      recognizedSubjectMatchesParent: true,
    });

    expect(decision.accepted).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.values.amount).toBe("120000.00");
  });

  it("独立续签主合同把新租期总额作为自身合同总额自动采用", () => {
    const rawText = `国航大厦房屋租赁续签协议
甲方：北京出租方有限公司
乙方：北京承租方有限公司
续租期自2027年01月01日起至2027年12月31日止。
续租期间每月租金为人民币10000元/月。
本续签协议一式肆份，甲乙双方各执贰份。
合同签订日期：2026年12月20日`;
    const parsed = parseContractText("", {
      sources: ["ocr_300", "ocr_480"].map((source) => ({
        text: rawText,
        source: source as "ocr_300" | "ocr_480",
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      })),
      expectedCategory: "asset",
      relationType: "main",
      renewalMain: true,
    });
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: parsed.status,
      relationType: "main",
      declaredCategory: "asset",
      rawText,
      fields: parsed.fields.map((field) => ({
        field: field.field,
        normalizedValue: field.normalizedValue,
      })),
      amountContext: getContractAmountAutomaticAdoptionContext(parsed),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
    });

    expect(decision.accepted).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.values.amount).toBe("120000.00");
  });

  it("模糊金额候选即使非空也不能绕过内部金额状态", () => {
    const rawText = "技术服务合同\n含税金额：人民币120000元。";
    const parsed = parseContractText(rawText, { relationType: "main" });
    const parsedAmount = parsed.fields.find(
      (field) => field.field === "amount",
    )!;
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        rawText,
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: parsedAmount.normalizedValue }
            : field,
        ),
        amountContext: getContractAmountAutomaticAdoptionContext(parsed),
        safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
      }),
    );

    expect(parsedAmount.normalizedValue).toBe("120000.00");
    expect(decision.accepted).toBe(false);
    expect(decision.blockers).toContain(
      "合同金额状态未形成可采用的明确或计算金额",
    );
  });

  it("只有付款金额时保持 payment_only 且不得冒充合同金额", () => {
    const rawText = "技术服务合同\n付款金额：人民币3000元。";
    const parsed = parseContractText(rawText, { relationType: "main" });
    const amountContext = getContractAmountAutomaticAdoptionContext(parsed);
    const decision = decideContractAutomaticOcrAdoption(
      policyInput({
        rawText,
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: null }
            : field,
        ),
        amountContext,
        safetyContext: getContractOcrAutomaticAdoptionSafetyContext(parsed),
      }),
    );

    expect(amountContext).toEqual({
      status: "payment_only",
      missingAmountEligible: false,
    });
    expect(decision.accepted).toBe(false);
    expect(decision.values.amount).toBeNull();
    expect(decision.values.amount).not.toBe("3000.00");
  });

  it("保留分类、层级、主体同名、非法金额和非法日期硬业务校验", () => {
    const sameParties = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: completeFields.map((field) =>
          field.field === "party_b"
            ? { ...field, normalizedValue: "国网北京市电力公司" }
            : field,
        ),
      }),
    );
    const wrongCategory = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: completeFields.map((field) =>
          field.field === "category"
            ? { ...field, normalizedValue: "asset" }
            : field,
        ),
      }),
    );
    const illegalAmount = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: completeFields.map((field) =>
          field.field === "amount"
            ? { ...field, normalizedValue: "-290000.00" }
            : field,
        ),
      }),
    );
    const illegalDate = decideContractAutomaticOcrAdoption(
      policyInput({
        fields: completeFields.map((field) =>
          field.field === "contract_date"
            ? { ...field, normalizedValue: "2025-02-30" }
            : field,
        ),
      }),
    );
    const relationFailure = decideContractAutomaticOcrAdoption(
      policyInput({ resultStatus: "failed", failureKind: "document" }),
    );
    const infrastructureFailure = decideContractAutomaticOcrAdoption(
      policyInput({ resultStatus: "failed", failureKind: "infrastructure" }),
    );

    expect(sameParties.blockers).toContain("甲方单位与乙方单位不能完全相同");
    expect(wrongCategory.blockers).not.toContain(
      "OCR识别合同分类与上传时锁定分类不一致",
    );
    expect(wrongCategory.values.category).toBe("main_business");
    expect(illegalAmount.blockers).toContain("主合同金额必须大于 0");
    expect(illegalDate.blockers).toContain("合同签订日期不是真实有效日期");
    expect(relationFailure.status).toBe("failed");
    expect(infrastructureFailure.blockers).toEqual(["OCR识别基础设施失败"]);
  });

  it("识别任务、最终值落库和合同主表使用同一自动采用决定", () => {
    const recognitionJobSource = routeSource.slice(
      routeSource.indexOf("async function runRecognitionJob"),
      routeSource.indexOf("const contractOcrConcurrency"),
    );

    expect(recognitionJobSource).toContain(
      "decideContractAutomaticOcrAdoption",
    );
    expect(recognitionJobSource).toContain(
      "getContractAmountAutomaticAdoptionContext(result)",
    );
    expect(recognitionJobSource).toContain(
      "getContractOcrAutomaticAdoptionSafetyContext(result)",
    );
    expect(recognitionJobSource).not.toContain(
      "isExactAutomaticContractConfidence",
    );
    expect(recognitionJobSource).toContain("automaticDecision.accepted");
    expect(recognitionJobSource).toContain(
      "recognitionRunner: typeof recognizeContractFile = recognizeContractFile",
    );
    expect(recognitionJobSource).toContain("await recognitionRunner(");
    expect(recognitionJobSource).toContain('process.env.NODE_ENV !== "test"');
    expect(recognitionJobSource).toContain(
      "自定义合同识别执行器只允许用于隔离测试",
    );
    expect(recognitionJobSource).toContain("final_value = $3");
    expect(recognitionJobSource).toContain("manually_confirmed = FALSE");
    expect(recognitionJobSource).toContain("category = $6");
    expect(recognitionJobSource).toContain("contract_date_source = $8");
    expect(recognitionJobSource).toContain("persistedJob.rowCount !== 1");
    expect(recognitionJobSource).toContain("adoptedField.rowCount !== 1");
    expect(recognitionJobSource).toContain("updatedContract.rowCount !== 1");
    expect(recognitionJobSource).toContain(
      "clearDraftAutomaticRecognitionValues",
    );
  });

  it("每份主营文件拥有独立编号并另行核对补充协议的上级编号", () => {
    const recognitionJobSource = routeSource.slice(
      routeSource.indexOf("async function runRecognitionJob"),
      routeSource.indexOf("const contractOcrConcurrency"),
    );

    expect(recognitionJobSource).toContain("ownsBusinessContractNumber");
    expect(recognitionJobSource).toContain("referencesParentBusinessNumber");
    expect(recognitionJobSource).toContain(
      "extractReferencedParentContractBusinessNumber",
    );
    expect(recognitionJobSource).toContain(
      "本文件关联原合同编号 ${referencedParentBusinessNumber}",
    );
    expect(recognitionJobSource).toContain("请重新选择正确的上级合同");
    expect(recognitionJobSource).toContain("但该原合同当前已撤销或删除");
    expect(recognitionJobSource).toContain("请先重新建立正确原合同后再关联");
    expect(recognitionJobSource).toContain(
      "ownsBusinessContractNumber\n              ? businessNumberEvidence?.value || null\n              : null",
    );
  });

  it("审批门禁只接受当前策略认证且未被改写的自动落库值", () => {
    const submissionSource = serviceSource.slice(
      serviceSource.indexOf("async function validateSubmission"),
      serviceSource.indexOf("export async function submitContractForApproval"),
    );

    expect(submissionSource).toContain('job.status !== "succeeded"');
    expect(submissionSource).toContain("final_value");
    expect(submissionSource).toContain("OCR_CONTRACT_VALUE_MISMATCH");
    expect(submissionSource).not.toContain("fieldsWithoutAdoptionEvidence");
    expect(submissionSource).not.toContain(
      "isExactAutomaticContractConfidence",
    );
    expect(submissionSource).toContain("recognizedAmount === null");
    expect(submissionSource).toContain("expectedContractDateSource");
    expect(submissionSource).toContain("persistedPolicyMarker");
    expect(submissionSource).toContain("OCR_AUTOMATIC_POLICY_STALE");
    expect(submissionSource).toContain("changedAutomaticFields");
    expect(submissionSource).toContain("inheritedSupplementSubjectName");
    expect(submissionSource).toContain(
      'contract.relation_type === "supplement"',
    );
    expect(submissionSource).toContain('field.field_code === "project_name"');
    expect(submissionSource).not.toContain("parseContractText(job.raw_text");
    expect(submissionSource).toContain('field.field_code !== "category"');
    expect(submissionSource).toContain("field.normalized_value");
    expect(submissionSource).not.toContain("SELECT field_code, confidence");
  });

  it("人工确认接口已禁用且自动主流程不依赖人工标志", () => {
    expect(routeSource).toContain(
      '"/:id/ocr-jobs/:jobId/confirm",\n  requireFinance',
    );
    expect(routeSource).toContain("OCR_MANUAL_CONFIRMATION_DISABLED");
    expect(routeSource).toContain("合同字段只允许系统自动识别");
    expect(routeSource).not.toContain(
      "reviewedFields: req.body?.reviewedFields",
    );
    expect(routeSource).toContain("manually_confirmed = FALSE");
  });

  it("OCR输出评分结构保持不变，自动采用政策不伪造100分", () => {
    expect(ocrSource).toContain("confidence: fieldScore");
    expect(ocrSource).toContain("ocrConfidence");
    expect(ocrSource).toContain("fieldScore");
    expect(serviceSource).toContain(
      "fieldScore（字段规则评分）继续作为诊断信息保存",
    );
    expect(serviceSource).not.toContain("confidence = 100");
  });
});
