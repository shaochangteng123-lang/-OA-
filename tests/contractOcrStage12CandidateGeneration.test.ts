/** @jest-environment node */

import {
  getContractOcrCandidateFunnelTrace,
  parseContractText,
  type ContractOcrCandidateFunnelCandidate,
  type ContractOcrCandidateFunnelTrace,
  type ParseContractTextOptions,
} from "../server/services/contractOcr";

function parseWithCandidateFunnel(
  text: string,
  options: ParseContractTextOptions = {},
): ContractOcrCandidateFunnelTrace {
  const result = parseContractText(text, {
    ...options,
    candidateFunnelDiagnostics: true,
  });
  const trace = getContractOcrCandidateFunnelTrace(result);
  if (!trace) throw new Error("缺少候选漏斗诊断结果");
  return trace;
}

function generatedCandidates(
  trace: ContractOcrCandidateFunnelTrace,
  field: ContractOcrCandidateFunnelCandidate["field"],
): ContractOcrCandidateFunnelCandidate[] {
  return trace.generatedCandidates.filter(
    (candidate) => candidate.field === field,
  );
}

function ocrSource(text: string, pageNumber: number) {
  return {
    text,
    source: "ocr_300" as const,
    pageNumber,
    confidence: 0.98,
    recognitionEngine: "paddleocr",
  };
}

describe("第十二阶段项目名称候选生成", () => {
  it("从首页租赁协议标题生成非工程类项目候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [ocrSource("西直门停车位租赁协议", 1)],
    });

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "西直门停车位租赁",
          projectOrigin: "cover_title",
        }),
      ]),
    );
  });

  it("封面编号行与下一行租赁标题不得拼成合同名称", () => {
    const trace = parseWithCandidateFunnel("", {
      expectedCategory: "asset",
      sources: [
        ocrSource(
          [
            "编号：国航物业-国航大厦车位合（2025）14",
            "国航大厦停车场车位租赁协议",
            "出租方：国航物业酒店管理有限公司国航大厦分公司",
          ].join("\n"),
          1,
        ),
      ],
    });
    const candidates = generatedCandidates(trace, "project_name");

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "国航大厦停车场车位租赁",
          projectOrigin: "cover_title",
        }),
      ]),
    );
    expect(
      candidates.some((candidate) =>
        candidate.normalizedValue.includes("编号"),
      ),
    ).toBe(false);
  });

  it("从首页多行标题生成项目名称候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "海淀区智慧园区",
            "网络升级项目",
            "技术服务合同",
            "甲方：北京建设有限公司",
          ].join("\n"),
          1,
        ),
      ],
    });

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "海淀区智慧园区网络升级项目",
          pageNumber: 1,
          projectOrigin: "cover_title",
        }),
      ]),
    );
  });

  it("从首页书名号合同标题生成项目名称候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "《海淀区智慧园区网络升级项目技术服务合同》",
            "甲方：北京建设有限公司",
          ].join("\n"),
          1,
        ),
      ],
    });

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "海淀区智慧园区网络升级项目",
          pageNumber: 1,
          projectOrigin: "cover_title",
        }),
      ]),
    );
  });

  it("网络服务标题同时生成保留和剥离服务尾词的候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [ocrSource("网络接入技术服务合同书", 1)],
    });
    const values = new Set(
      generatedCandidates(trace, "project_name").map(
        (candidate) => candidate.normalizedValue,
      ),
    );

    expect(values.size).toBeGreaterThanOrEqual(2);
    expect(values.has("网络接入")).toBe(true);
    expect(values.has("网络接入技术服务")).toBe(true);
  });

  it("合同名称字段派生候选仅剥离文档类型", () => {
    const trace =
      parseWithCandidateFunnel("合同名称：北京联通公有云标准产品协议");

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "北京联通公有云标准产品",
          projectOrigin: "labeled_field",
        }),
      ]),
    );
  });

  it("从服务描述中的明确服务对象生成项目名称候选", () => {
    const trace = parseWithCandidateFunnel(
      "本合同的服务对象为：创新园110千伏变电站不动产权办理项目。",
    );

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "创新园110千伏变电站不动产权办理项目",
          projectOrigin: "body_description",
        }),
      ]),
    );
  });

  it("从具有前后边界的就某对象服务句生成正文候选", () => {
    const trace = parseWithCandidateFunnel(
      "甲方委托乙方就创新园网络升级项目的建设相关工作提供咨询服务。",
    );

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "创新园网络升级项目",
          projectOrigin: "body_description",
          strongEvidence: false,
        }),
      ]),
    );
  });

  it("咨询及协调工作只作为服务边界而不吞入项目候选", () => {
    const trace = parseWithCandidateFunnel(
      "甲方聘请乙方作为顾问，为甲方就西城更新项目的交通影响评价咨询及协调工作提供服务。",
    );

    expect(generatedCandidates(trace, "project_name")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "西城更新项目的交通影响评价咨询",
          projectOrigin: "body_description",
        }),
      ]),
    );
  });

  it("正文代词项目不能生成新的项目名称候选", () => {
    const trace = parseWithCandidateFunnel(
      "甲方委托乙方就本项目的建设相关工作提供咨询服务。",
    );

    expect(generatedCandidates(trace, "project_name")).toHaveLength(0);
  });

  it("普通服务范围和付款描述不能生成项目名称候选", () => {
    const trace = parseWithCandidateFunnel(
      "服务内容：乙方提供资料整理、付款审核和日常咨询服务。",
    );

    expect(generatedCandidates(trace, "project_name")).toHaveLength(0);
  });
});

describe("第十二阶段金额候选生成", () => {
  it.each([
    ["合同价款", "110000.00", "contract_total"],
    ["服务费用总额", "120000.00", "contract_total"],
    ["协议金额", "150000.00", "contract_amount"],
    ["含税合同金额", "130000.00", "contract_amount"],
  ])(
    "金额来源%s生成带业务角色的候选",
    (anchor, expectedValue, expectedRole) => {
      const trace = parseWithCandidateFunnel(
        `${anchor}：人民币${expectedValue.replace(".00", "")}元`,
        { relationType: "main" },
      );

      expect(generatedCandidates(trace, "amount")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            normalizedValue: expectedValue,
            amountRole: expectedRole,
            strongEvidence: true,
            explicitContractTotal: true,
          }),
        ]),
      );
    },
  );

  it("明确合同金额标签可以绑定下一行无单位纯数字", () => {
    const trace = parseWithCandidateFunnel("合同金额：\n12000", {
      relationType: "main",
    });

    expect(generatedCandidates(trace, "amount")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "12000.00",
          amountRole: "contract_amount",
          strongEvidence: true,
          explicitContractTotal: true,
        }),
      ]),
    );
  });

  it("同一条款内的多个金额分别绑定最近的金额角色", () => {
    const trace = parseWithCandidateFunnel(
      [
        "含税合同金额：人民币16320元，其中付款金额：人民币3000元，",
        "服务费：人民币15542.86元，税额：人民币777.14元，设备单价：人民币800元。",
      ].join(""),
      { relationType: "main" },
    );
    const amountCandidates = generatedCandidates(trace, "amount");

    expect(amountCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "16320.00",
          amountRole: "contract_amount",
        }),
        expect.objectContaining({
          normalizedValue: "3000.00",
          amountRole: "payment_amount",
        }),
        expect.objectContaining({
          normalizedValue: "15542.86",
          amountRole: "service_fee",
        }),
        expect.objectContaining({
          normalizedValue: "777.14",
          amountRole: "tax_amount",
        }),
        expect.objectContaining({
          normalizedValue: "800.00",
          amountRole: "unit_price",
        }),
      ]),
    );
  });

  it("费用共计只绑定总费用且不吞入未税金额和增值税额", () => {
    const trace = parseWithCandidateFunnel(
      "停车位租金费用共计人民币16320元（不含税金额15542.86元、增值税额777.14元）。",
      { relationType: "main" },
    );
    const amountCandidates = generatedCandidates(trace, "amount");

    expect(amountCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "16320.00",
          amountRole: "service_fee",
        }),
        expect.objectContaining({
          normalizedValue: "777.14",
          amountRole: "tax_amount",
        }),
      ]),
    );
    expect(
      amountCandidates.some(
        (candidate) =>
          candidate.normalizedValue === "15542.86" &&
          candidate.amountRole === "service_fee",
      ),
    ).toBe(false);
  });

  it("收费表中的周期金额保留单价角色", () => {
    const trace = parseWithCandidateFunnel(
      "费用组成\n收费项目：网络接入服务\n收费金额：\n11000元/年",
      { relationType: "main" },
    );

    expect(generatedCandidates(trace, "amount")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "11000.00",
          amountRole: "unit_price",
          explicitContractTotal: false,
        }),
      ]),
    );
  });

  it("千分比违约金描述不能生成金额候选", () => {
    const trace = parseWithCandidateFunnel(
      "违约责任：网络服务费总额千分之三作为每日违约金。",
      { relationType: "main" },
    );

    expect(generatedCandidates(trace, "amount")).toHaveLength(0);
  });

  it("补充协议的裸协议金额不能生成本次增减候选", () => {
    const trace = parseWithCandidateFunnel(
      "补充协议\n协议金额：人民币60000元",
      { relationType: "supplement" },
    );
    const amountCandidates = generatedCandidates(trace, "amount");

    expect(amountCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generator: "amount",
          normalizedValue: "60000.00",
          amountRole: "contract_amount",
        }),
      ]),
    );
    expect(
      amountCandidates.some(
        (candidate) =>
          candidate.generator === "relation_adjustment_amount" ||
          candidate.amountRole === "relation_adjustment",
      ),
    ).toBe(false);
  });
});

describe("第十二阶段合同日期候选生成", () => {
  it("从正式订立序言生成合同日期候选", () => {
    const trace = parseWithCandidateFunnel(
      "本合同由甲乙双方于2026年8月10日在北京市正式订立。",
    );

    expect(generatedCandidates(trace, "contract_date")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "2026-08-10",
          verificationRole: "current_contract_date",
        }),
      ]),
    );
  });

  it("正式订立序言允许合同简称括注", () => {
    const trace = parseWithCandidateFunnel(
      "本《咨询服务协议》（本协议）由以下双方于2026年8月10日在北京市签署。",
    );

    expect(generatedCandidates(trace, "contract_date")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "2026-08-10",
          verificationRole: "current_contract_date",
        }),
      ]),
    );
  });

  it("从签章页无标签落款生成合同日期候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "甲方（盖章）：北京建设有限公司",
            "法定代表人（签字）：",
            "乙方（盖章）：北京咨询有限公司",
            "法定代表人（签字）：",
            "二〇二六年八月十日",
          ].join("\n"),
          12,
        ),
      ],
    });

    expect(generatedCandidates(trace, "contract_date")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "2026-08-10",
          pageNumber: 12,
          verificationRole: "current_contract_date",
        }),
      ]),
    );
  });

  it("签章页日期位于拆分日/期标签之前时仍生成落款候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "甲方（盖章）：北京建设有限公司",
            "乙方（盖章）：北京咨询有限公司",
            "2026年",
            "8月",
            "10日",
            "日",
            "期",
          ].join("\n"),
          8,
        ),
      ],
    });

    expect(generatedCandidates(trace, "contract_date")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedValue: "2026-08-10",
          pageNumber: 8,
          verificationRole: "current_contract_date",
        }),
      ]),
    );
  });

  it("签章区出现两个不同合法日期时不猜测落款日期", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "甲方（盖章）：北京建设有限公司",
            "2026年8月10日",
            "乙方（盖章）：北京咨询有限公司",
            "2026年8月11日",
          ].join("\n"),
          8,
        ),
      ],
    });

    expect(generatedCandidates(trace, "contract_date")).toHaveLength(0);
  });

  it("营业执照附件日期不能作为签章落款候选", () => {
    const trace = parseWithCandidateFunnel("", {
      sources: [
        ocrSource(
          [
            "甲方（盖章）：北京建设有限公司",
            "乙方（盖章）：北京咨询有限公司",
            "乙方营业执照复印件",
            "登记机关",
            "2022年6月27日",
            "国家市场监督管理总局监制",
          ].join("\n"),
          16,
        ),
      ],
    });

    expect(generatedCandidates(trace, "contract_date")).toHaveLength(0);
  });

  it("正式订立日期与期限付款验收日期冲突时只生成订立日期候选", () => {
    const trace = parseWithCandidateFunnel(
      [
        "本合同由甲乙双方于2026年8月10日在北京市正式订立。",
        "服务期限：2026年9月1日至2027年8月31日。",
        "付款日期：2026年9月5日。",
        "验收日期：2027年8月31日。",
      ].join("\n"),
    );
    const dates = new Set(
      generatedCandidates(trace, "contract_date").map(
        (candidate) => candidate.normalizedValue,
      ),
    );

    expect(dates).toEqual(new Set(["2026-08-10"]));
  });
});
