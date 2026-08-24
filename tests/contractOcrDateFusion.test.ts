import {
  calculateContractAutomaticReviewCrop,
  contractOcrFieldsRequiringAutomaticReview,
  parseContractText,
  type ContractOcrField,
} from "../server/services/contractOcr";

function contractDate(text: string): ContractOcrField {
  const result = parseContractText(text);
  const value = result.fields.find((field) => field.field === "contract_date");
  if (!value) throw new Error("缺少合同签订日期字段");
  return value;
}

describe("合同日期候选融合", () => {
  it.each([
    ["签订时间：2021-8-13", "2021-08-13"],
    ["签订时间：2021 / 11 / 22", "2021-11-22"],
    ["签订时间：2021．11．22", "2021-11-22"],
    ["签订时间：20211122", "2021-11-22"],
  ])("解析数字日期 %s", (text, expected) => {
    expect(contractDate(text).normalizedValue).toBe(expected);
  });

  it.each([
    ["签订日期：二〇二一年八月十三日", "2021-08-13"],
    ["签订日期：二零二一年十一月二十二日", "2021-11-22"],
    ["签订日期：贰零贰壹年捌月拾叁日", "2021-08-13"],
  ])("解析中文日期 %s", (text, expected) => {
    expect(contractDate(text).normalizedValue).toBe(expected);
  });

  it("融合签订标签后被拆成多个识别行的日期字符", () => {
    const value = contractDate(
      ["签订时间：", "2021", "-", "11", "-", "22", "签订地点：北京"].join("\n"),
    );

    expect(value.normalizedValue).toBe("2021-11-22");
  });

  it("首页有明确签订日期且签章页为空时采用首页日期", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "签订时间：2021 - 11 - 22",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.82,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "签章页",
            "甲方（盖章）：北京建设有限公司",
            "乙方（盖章）：北京咨询有限公司",
            "签订日期：",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 13,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
        },
      ],
    });

    expect(
      result.fields.find((field) => field.field === "contract_date")
        ?.normalizedValue,
    ).toBe("2021-11-22");
  });

  it("局部日期复核允许关联标签上方的手写日期，整页来源仍禁止", () => {
    const scoped = parseContractText("", {
      sources: [
        {
          text: ["2021-11-22", "签订时间："].join("\n"),
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.88,
          recognitionEngine: "paddleocr",
          fieldScope: "contract_date",
        },
      ],
    });
    const unscoped = parseContractText(
      ["付款日期：2021-11-22", "签订时间："].join("\n"),
    );

    expect(
      scoped.fields.find((field) => field.field === "contract_date")
        ?.normalizedValue,
    ).toBe("2021-11-22");
    expect(
      unscoped.fields.find((field) => field.field === "contract_date")
        ?.normalizedValue,
    ).toBe("");
  });

  it("租赁签署页残缺年份仅在紧邻明确租赁起始日时安全恢复", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "租赁期限自2025年10月31日起至2026年10月31日止。",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "甲方（签字）：曾宇",
            "签订日期：262年10月27日",
            "乙方（盖章）：北京羽隶工程咨询有限公司",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 3,
          confidence: 0.92,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    expect(
      result.fields.find((field) => field.field === "contract_date")
        ?.normalizedValue,
    ).toBe("2025-10-27");
  });

  it("残缺签署年份远离租赁起始日时继续拒绝猜测", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: "租赁期限自2025年10月31日起至2026年10月31日止。",
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "甲方（签字）：曾宇",
            "签订日期：262年06月01日",
            "乙方（盖章）：北京羽隶工程咨询有限公司",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 3,
          confidence: 0.92,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    expect(
      result.fields.find((field) => field.field === "contract_date")
        ?.normalizedValue,
    ).toBe("");
  });

  it.each([
    "签订日期：2021-02-30",
    "签订日期：二〇二一年十三月一日",
    "服务期限：20210101至20231231",
    "付款日期：20211122",
  ])("拒绝非法或非签署日期 %s", (text) => {
    expect(contractDate(text).normalizedValue).toBe("");
  });
});

describe("合同字段自动局部复核", () => {
  it("项目冲突、金额角色冲突和日期低置信度同时触发自动复核", () => {
    const base = {
      originalValue: "候选",
      normalizedValue: "候选",
      confidence: 90,
      fieldScore: 90,
      ocrConfidence: 0.9,
      source: "ocr_300" as const,
    };
    const fields: ContractOcrField[] = [
      {
        ...base,
        field: "project_name",
        warnings: ["项目名称存在候选冲突：候选甲 / 候选乙"],
      },
      {
        ...base,
        field: "amount",
        warnings: ["合同金额存在候选冲突：100000 / 3000"],
      },
      {
        ...base,
        field: "contract_date",
        normalizedValue: "2025-08-25",
        fieldScore: 80,
        ocrConfidence: 0.7,
      },
    ];

    expect(contractOcrFieldsRequiringAutomaticReview({ fields })).toEqual([
      "project_name",
      "amount",
      "contract_date",
    ]);
  });

  it("稳定候选不重复触发局部复核", () => {
    const fields: ContractOcrField[] = [
      {
        field: "contract_date",
        originalValue: "2025-08-25",
        normalizedValue: "2025-08-25",
        confidence: 96,
        fieldScore: 96,
        ocrConfidence: 0.96,
        source: "ocr_300",
      },
    ];

    expect(contractOcrFieldsRequiringAutomaticReview({ fields })).toEqual([]);
  });

  it("项目局部增强裁片中的金额和日期不得污染其他字段", () => {
    const result = parseContractText("", {
      sources: [
        {
          text: [
            "项目名称：甲地110千伏输变电工程",
            "合同金额：100000元",
            "合同签订日期：2025-01-01",
          ].join("\n"),
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.95,
          recognitionEngine: "paddleocr",
        },
        {
          text: [
            "项目名称：乙地110千伏输变电工程",
            "合同金额：999000元",
            "合同签订日期：2024-02-02",
          ].join("\n"),
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.99,
          recognitionEngine: "paddleocr",
          fieldScope: "project_name",
        },
      ],
    });

    const amount = result.fields.find((field) => field.field === "amount");
    const date = result.fields.find((field) => field.field === "contract_date");
    expect(amount?.normalizedValue).toBe("100000.00");
    expect(
      amount?.candidates?.some(
        (candidate) => candidate.normalizedValue === "999000.00",
      ),
    ).toBe(false);
    expect(date?.normalizedValue).toBe("2025-01-01");
    expect(
      date?.candidates?.some(
        (candidate) => candidate.normalizedValue === "2024-02-02",
      ),
    ).toBe(false);
  });

  it("项目与日期复核裁片保持页面边界和二百万像素上限", () => {
    const line = {
      bbox: [
        [520, 2_600],
        [1_180, 2_600],
        [1_180, 2_680],
        [520, 2_680],
      ],
    };
    const projectCrop = calculateContractAutomaticReviewCrop(
      "project_name",
      line,
      2_480,
      3_505,
    );
    const dateCrop = calculateContractAutomaticReviewCrop(
      "contract_date",
      line,
      2_480,
      3_505,
    );

    expect(projectCrop).not.toBeNull();
    expect(projectCrop!.left).toBe(0);
    expect(projectCrop!.width).toBe(2_480);
    expect(projectCrop!.width * projectCrop!.height).toBeLessThanOrEqual(
      2_000_000,
    );
    expect(dateCrop).not.toBeNull();
    expect(dateCrop!.left).toBeLessThan(520);
    expect(dateCrop!.left + dateCrop!.width).toBeGreaterThan(2_000);
    expect(dateCrop!.width * dateCrop!.height).toBeLessThanOrEqual(2_000_000);
  });
});
