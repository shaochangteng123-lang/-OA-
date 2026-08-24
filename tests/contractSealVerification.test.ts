import {
  compareSealedContract,
  findSealedContractMismatches,
} from "../server/services/contractSealVerification";
import type { ContractRecognitionResult } from "../server/services/contractOcr";

function recognition(
  values: Partial<
    Record<"party_a" | "party_b" | "amount" | "contract_date", string>
  >,
  confidence = 100,
  warnings: string[] = [],
): ContractRecognitionResult {
  return {
    status: "succeeded",
    rawText: "测试合同",
    method: "pdf_text",
    warnings,
    fields: Object.entries(values).map(([field, value]) => ({
      field: field as "party_a" | "party_b" | "amount" | "contract_date",
      originalValue: value || "",
      normalizedValue: value || "",
      confidence,
      source: "pdf_text",
    })),
  };
}

describe("盖章合同与审批版本一致性", () => {
  const approved = {
    partyA: "北京建设有限公司",
    partyB: "北京咨询有限公司",
    amount: "100000.00",
    contractDate: "2026-08-01",
  };

  it("忽略排版符号差异并按整数分比较金额", () => {
    const result = compareSealedContract(
      approved,
      recognition({
        party_a: "北京建设（有限公司）",
        party_b: "北京咨询有限公司",
        amount: "100,000.00",
        contract_date: "2026-08-01",
      }),
      "2026-08-04",
    );
    expect(result.mismatches).toEqual([]);
    expect(result.requiresRecognitionRetry).toBe(false);
  });

  it("仅变更付款方式的补充协议不要求盖章正文识别出零元", () => {
    const result = compareSealedContract(
      {
        ...approved,
        amount: 0,
        amountVerificationRequired: false,
      },
      recognition({
        party_a: approved.partyA,
        party_b: approved.partyB,
        contract_date: "2026-08-01",
      }),
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(false);
    expect(result.mismatches).toEqual([]);
    expect(result.values.find((item) => item.field === "amount")).toEqual({
      field: "amount",
      value: null,
      confidence: 0,
      source: "not_applicable",
      requiresRecognitionRetry: false,
    });
  });

  it("识别出主体或金额变化时给出明确差异，盖章日期作为最终同步值", () => {
    const result = compareSealedContract(
      approved,
      recognition({
        party_a: "北京城市建设有限公司",
        party_b: "北京咨询有限公司",
        amount: "120000.00",
        contract_date: "2026-08-02",
      }),
      "2026-08-04",
    );
    expect(result.mismatches.map((item) => item.field)).toEqual([
      "party_a",
      "amount",
    ]);
    expect(
      result.values.find((item) => item.field === "contract_date"),
    ).toMatchObject({
      value: "2026-08-02",
      source: "pdf_text",
      requiresRecognitionRetry: false,
    });
  });

  it("日期缺失时自动使用上传日期且不阻塞归档", () => {
    const result = compareSealedContract(
      { ...approved, contractDate: null },
      recognition({
        party_a: approved.partyA,
        party_b: approved.partyB,
        amount: "100000",
      }),
      "2026-08-04",
    );
    expect(
      result.values.find((item) => item.field === "contract_date"),
    ).toMatchObject({
      value: "2026-08-04",
      source: "upload_date",
      requiresRecognitionRetry: false,
    });
    expect(result.requiresRecognitionRetry).toBe(false);
  });

  it("签章页日期被印章噪声打散时以文件中的审批日期恢复", () => {
    const sealedRecognition = recognition({
      party_a: approved.partyA,
      party_b: approved.partyB,
      amount: "100000",
    });
    sealedRecognition.ocrLines = [
      "甲方（盖章）",
      "乙方（盖章）",
      "法定代表人/授权代理人：",
      "日期：",
      "印章噪声",
      "2025.6.6",
      "2075.6.6",
    ].map((text, index) => ({
      page: 12,
      text,
      bbox: [
        [0, index * 10],
        [100, index * 10],
        [100, index * 10 + 8],
        [0, index * 10 + 8],
      ],
      confidence: 0.94,
      modelVersion: "v6_medium" as const,
    }));

    const result = compareSealedContract(
      { ...approved, contractDate: "2025-06-06" },
      sealedRecognition,
      "2026-08-17",
    );

    expect(
      result.values.find((item) => item.field === "contract_date"),
    ).toMatchObject({
      value: "2025-06-06",
      source: "signature_page_ocr",
      confidence: 94,
      requiresRecognitionRetry: false,
    });
  });

  it("非签章页即使出现审批日期也不覆盖上传日期兜底", () => {
    const sealedRecognition = recognition({
      party_a: approved.partyA,
      party_b: approved.partyB,
      amount: "100000",
    });
    sealedRecognition.ocrLines = [
      {
        page: 3,
        text: "付款日期：2025.6.6",
        bbox: [
          [0, 0],
          [100, 0],
          [100, 10],
          [0, 10],
        ],
        confidence: 0.99,
        modelVersion: "v6_medium",
      },
    ];

    const result = compareSealedContract(
      { ...approved, contractDate: "2025-06-06" },
      sealedRecognition,
      "2026-08-17",
    );

    expect(
      result.values.find((item) => item.field === "contract_date"),
    ).toMatchObject({ value: "2026-08-17", source: "upload_date" });
  });

  it("日期候选非法时自动使用上传日期且不阻塞归档", () => {
    const result = compareSealedContract(
      approved,
      recognition({
        party_a: approved.partyA,
        party_b: approved.partyB,
        amount: "100000",
        contract_date: "2026-02-30",
      }),
      "2026-08-04",
    );
    expect(
      result.values.find((item) => item.field === "contract_date"),
    ).toMatchObject({
      value: "2026-08-04",
      source: "upload_date",
      requiresRecognitionRetry: false,
    });
    expect(result.mismatches).toEqual([]);
    expect(result.requiresRecognitionRetry).toBe(false);
  });

  it("基础设施失败不能被当作普通日期缺失", () => {
    const result = compareSealedContract(
      approved,
      recognition({}, 0, ["OCR 识别基础设施暂时不可用，可稍后重试"]),
      "2026-08-04",
    );
    expect(result.infrastructureFailure).toBe(true);
    expect(result.requiresRecognitionRetry).toBe(true);
  });

  it("使用结构化故障类型识别基础设施失败，不依赖警告文案", () => {
    const result = compareSealedContract(
      approved,
      {
        ...recognition({}, 0, ["临时目录创建失败"]),
        failureKind: "infrastructure",
      },
      "2026-08-04",
    );
    expect(result.infrastructureFailure).toBe(true);
  });

  it("识别任务失败时即使携带看似完整字段也必须重新识别", () => {
    const result = compareSealedContract(
      approved,
      {
        ...recognition({
          party_a: approved.partyA,
          party_b: approved.partyB,
          amount: "100000",
          contract_date: "2026-08-01",
        }),
        status: "failed",
        failureKind: "recognition",
      },
      "2026-08-04",
    );

    expect(result.infrastructureFailure).toBe(false);
    expect(result.requiresRecognitionRetry).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("金额格式不能转换为整数分时按缺失处理而不是误报差异", () => {
    const result = compareSealedContract(
      approved,
      recognition({
        party_a: approved.partyA,
        party_b: approved.partyB,
        amount: "壹拾万元整",
      }),
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.values.find((item) => item.field === "amount")).toMatchObject(
      { value: null, requiresRecognitionRetry: true },
    );
  });

  it("甲乙方和金额与审批快照一致时不再被非满分诊断分阻断", () => {
    const result = compareSealedContract(
      approved,
      recognition(
        {
          party_a: approved.partyA,
          party_b: approved.partyB,
          amount: "100000",
        },
        99.99,
      ),
      "2026-08-04",
    );
    expect(result.requiresRecognitionRetry).toBe(false);
    expect(
      result.values
        .filter((item) => item.requiresRecognitionRetry)
        .map((item) => item.field),
    ).toEqual([]);
    expect(result.mismatches).toEqual([]);
  });

  it("文档来源的一致值即使诊断分为 55 也可通过内容核验", () => {
    const result = compareSealedContract(
      approved,
      recognition(
        {
          party_a: approved.partyA,
          party_b: approved.partyB,
          amount: "100000",
        },
        55,
      ),
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(false);
    expect(result.mismatches).toEqual([]);
  });

  it("一方无法核验时仍保留另一方高质量识别出的真实差异", () => {
    const result = compareSealedContract(
      approved,
      {
        ...recognition({
          party_a: "其他建设有限公司",
          party_b: approved.partyB,
          amount: "100000",
        }),
        fields: [
          {
            field: "party_a",
            originalValue: "其他建设有限公司",
            normalizedValue: "其他建设有限公司",
            confidence: 100,
            source: "pdf_text",
          },
          {
            field: "party_b",
            originalValue: "北京咨洵有限公司",
            normalizedValue: "北京咨洵有限公司",
            confidence: 55,
            source: "pdf_text",
          },
          {
            field: "amount",
            originalValue: "100000",
            normalizedValue: "100000",
            confidence: 100,
            source: "pdf_text",
          },
        ],
      },
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(true);
    expect(result.mismatches.map((item) => item.field)).toEqual(["party_a"]);
    expect(
      result.values.find((item) => item.field === "party_b"),
    ).toMatchObject({ requiresRecognitionRetry: true });
  });

  it("多来源 99 分且无风险警告的真实差异进入差异复审", () => {
    const result = compareSealedContract(
      approved,
      {
        ...recognition({
          party_a: "其他建设有限公司",
          party_b: approved.partyB,
          amount: "100000",
        }),
        fields: [
          {
            field: "party_a",
            originalValue: "其他建设有限公司",
            normalizedValue: "其他建设有限公司",
            confidence: 99,
            fieldScore: 99,
            source: "mixed",
          },
          {
            field: "party_b",
            originalValue: approved.partyB,
            normalizedValue: approved.partyB,
            confidence: 99,
            fieldScore: 99,
            source: "pdf_text",
          },
          {
            field: "amount",
            originalValue: "100000",
            normalizedValue: "100000",
            confidence: 99,
            fieldScore: 99,
            source: "pdf_text",
          },
        ],
      },
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(false);
    expect(result.mismatches.map((item) => item.field)).toEqual(["party_a"]);
  });

  it.each([
    { fieldScore: 98, requiresRetry: true, mismatchFields: [] },
    { fieldScore: 99, requiresRetry: true, mismatchFields: [] },
    { fieldScore: 100, requiresRetry: false, mismatchFields: ["party_a"] },
  ])(
    "$fieldScore 分边界按比较资格处理核心字段",
    ({ fieldScore, requiresRetry, mismatchFields }) => {
      const result = compareSealedContract(
        approved,
        recognition(
          {
            party_a: "其他建设有限公司",
            party_b: approved.partyB,
            amount: "100000",
          },
          fieldScore,
        ),
        "2026-08-04",
      );

      expect(result.requiresRecognitionRetry).toBe(requiresRetry);
      expect(result.mismatches.map((item) => item.field)).toEqual(
        mismatchFields,
      );
    },
  );

  it("多来源 99 分差异存在本字段候选冲突时仍要求重新识别", () => {
    const result = compareSealedContract(
      approved,
      {
        ...recognition({
          party_a: "其他建设有限公司",
          party_b: approved.partyB,
          amount: "100000",
        }),
        fields: [
          {
            field: "party_a",
            originalValue: "其他建设有限公司",
            normalizedValue: "其他建设有限公司",
            confidence: 99,
            fieldScore: 99,
            source: "mixed",
            warnings: [
              "甲方单位存在候选冲突：其他建设有限公司 / 北京建设有限公司",
            ],
          },
          ...recognition({
            party_b: approved.partyB,
            amount: "100000",
          }).fields,
        ],
      },
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("无关的项目名称和日期警告不影响一致核心字段核验", () => {
    const result = compareSealedContract(
      approved,
      recognition(
        {
          party_a: approved.partyA,
          party_b: approved.partyB,
          amount: "100000",
        },
        55,
        [
          "项目名称存在候选冲突：项目甲 / 项目乙",
          "合同签订日期存在候选冲突：2026-08-01 / 2021-08-01",
        ],
      ),
      "2026-08-04",
    );

    expect(result.requiresRecognitionRetry).toBe(false);
    expect(result.mismatches).toEqual([]);
  });

  it.each(["manual", "rule"])(
    "%s 来源即使值与审批快照一致也不能通过自动核验",
    (source) => {
      const disqualifiedRecognition = recognition({
        party_a: approved.partyA,
        party_b: approved.partyB,
        amount: "100000",
      });
      for (const field of disqualifiedRecognition.fields) {
        field.source = source as unknown as typeof field.source;
      }
      const result = compareSealedContract(
        approved,
        disqualifiedRecognition,
        "2026-08-04",
      );

      expect(result.requiresRecognitionRetry).toBe(true);
      expect(
        result.values
          .filter((item) => item.requiresRecognitionRetry)
          .map((item) => item.field),
      ).toEqual(["party_a", "party_b", "amount"]);
    },
  );

  it("自动识别最终值只按审批快照计算甲乙方和金额关键差异", () => {
    const mismatches = findSealedContractMismatches(approved, [
      { field: "party_a", value: approved.partyA },
      { field: "party_b", value: "其他咨询有限公司" },
      { field: "amount", value: "100000.00" },
      { field: "contract_date", value: "2026-08-03" },
    ]);
    expect(mismatches.map((item) => item.field)).toEqual(["party_b"]);
  });

  it("甲方和乙方同时变化时分别生成差异并保留双方对照值", () => {
    const mismatches = findSealedContractMismatches(approved, [
      { field: "party_a", value: "其他建设有限公司" },
      { field: "party_b", value: "其他咨询有限公司" },
      { field: "amount", value: "100000.00" },
      { field: "contract_date", value: "2026-08-03" },
    ]);

    expect(mismatches).toEqual([
      {
        field: "party_a",
        label: "甲方单位",
        approvedValue: approved.partyA,
        sealedValue: "其他建设有限公司",
      },
      {
        field: "party_b",
        label: "乙方单位",
        approvedValue: approved.partyB,
        sealedValue: "其他咨询有限公司",
      },
    ]);
  });
});
