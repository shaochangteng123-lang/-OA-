jest.mock("nanoid", () => ({ nanoid: () => "multi-party-test-id" }));
jest.mock("../server/db/index", () => ({
  db: { transaction: jest.fn() },
}));
jest.mock("@/utils/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

import { parseContractText } from "../server/services/contractOcr";
import {
  decideContractAutomaticOcrAdoption,
  inferAssetFundingMode,
} from "../server/services/contractService";
import { resolveContractFinancialCompanySubject } from "../server/services/contractFinancialWorkflow";
import { normalizeOcrFields } from "../src/utils/contractApi";
import { findSealedContractMismatches } from "../server/services/contractSealVerification";

describe("三方合同识别与财务主体兼容", () => {
  it("明确甲乙丙方标签分别识别并保留，双方合同不生成空丙方字段", () => {
    const threeParty = parseContractText(
      [
        "技术服务合同",
        "甲方：北京万方安和投资有限责任公司",
        "乙方：北京万柳置业集团有限公司",
        "丙方：北京羽隶工程咨询有限公司",
        "项目：中央党校回迁安置房图纸资料整理",
        "合同金额：人民币900000元",
        "合同签订日期：2023年3月25日",
      ].join("\n"),
      { expectedCategory: "main_business", relationType: "main" },
    );

    expect(
      threeParty.fields.find((field) => field.field === "party_a")
        ?.normalizedValue,
    ).toBe("北京万方安和投资有限责任公司");
    expect(
      threeParty.fields.find((field) => field.field === "party_b")
        ?.normalizedValue,
    ).toBe("北京万柳置业集团有限公司");
    expect(
      threeParty.fields.find((field) => field.field === "party_c")
        ?.normalizedValue,
    ).toBe("北京羽隶工程咨询有限公司");

    const twoParty = parseContractText(
      ["技术服务合同", "甲方：北京甲方有限公司", "乙方：北京乙方有限公司"].join(
        "\n",
      ),
    );
    expect(twoParty.fields.some((field) => field.field === "party_c")).toBe(
      false,
    );
  });

  it("丙方与甲乙方重复时形成明确冲突提示", () => {
    const result = parseContractText(
      [
        "技术服务合同",
        "甲方：北京甲方有限公司",
        "乙方：北京乙方有限公司",
        "丙方：北京甲方有限公司",
      ].join("\n"),
    );
    const partyC = result.fields.find((field) => field.field === "party_c");

    expect(partyC?.confidence).toBeLessThanOrEqual(40);
    expect(partyC?.warnings?.join(" ")).toContain("识别为同一单位");
  });

  it("丙方候选冲突时阻断整组自动采用", () => {
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: "partial",
      relationType: "main",
      declaredCategory: "main_business",
      rawText: "技术服务合同",
      fields: [
        { field: "party_a", normalizedValue: "北京甲方有限公司" },
        { field: "party_b", normalizedValue: "北京乙方有限公司" },
        {
          field: "party_c",
          normalizedValue: "北京丙方有限公司",
          warnings: ["丙方单位存在候选冲突"],
        },
        { field: "project_name", normalizedValue: "回迁安置房图纸整理项目" },
        { field: "amount", normalizedValue: "900000.00" },
        { field: "category", normalizedValue: "main_business" },
        { field: "contract_date", normalizedValue: "2023-03-25" },
      ],
      amountContext: {
        status: "confirmed_amount",
        missingAmountEligible: false,
      },
      safetyContext: {
        project: {
          selectedValue: "回迁安置房图纸整理项目",
          candidateExists: true,
          trustedSource: true,
          source: "plain_text",
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
          riskCodes: [],
        },
        amount: {
          selectedValue: "900000.00",
          candidateExists: true,
          role: "contract_total",
          scope: "current_contract",
          strongEvidence: true,
          explicitContractTotal: true,
          amountEventConflict: false,
          unresolvedContractAmountFact: false,
          pdfTextEvidencePresent: false,
          samePageVisibleOcrEvidence: true,
          calculatedRelationVisibleClosure: false,
          riskCodes: [],
        },
      },
    });

    expect(decision.accepted).toBe(false);
    expect(decision.partyC).toBe("北京丙方有限公司");
    expect(decision.blockers).toContain("丙方单位存在候选冲突，不能自动采用");
  });

  it("内部公司位于丙方时仍能唯一确定财务主体和资产资金方式", () => {
    expect(
      resolveContractFinancialCompanySubject([
        "北京万方安和投资有限责任公司",
        "北京万柳置业集团有限公司",
        "北京羽隶工程咨询有限公司",
      ]),
    ).toEqual({
      name: "北京羽隶工程咨询有限公司",
      taxId: "91110116MA01G3U20C",
    });
    expect(
      inferAssetFundingMode(
        "asset",
        "北京甲方有限公司",
        "北京乙方有限公司",
        "北京羽隶工程咨询有限公司",
      ),
    ).toBe("engineering_direct");
  });

  it("前端仅在服务端返回丙方时展示可选丙方识别项", () => {
    expect(
      normalizeOcrFields(null).some((field) => field.key === "party_c"),
    ).toBe(false);
    const fields = normalizeOcrFields([
      { field: "party_a", finalValue: "北京甲方有限公司" },
      { field: "party_b", finalValue: "北京乙方有限公司" },
      { field: "party_c", finalValue: "北京丙方有限公司" },
    ]);
    expect(fields.find((field) => field.key === "party_c")).toMatchObject({
      label: "丙方单位",
      value: "北京丙方有限公司",
      required: false,
    });
  });

  it("盖章版核验将丙方纳入审批快照差异比较", () => {
    expect(
      findSealedContractMismatches(
        {
          partyA: "北京甲方有限公司",
          partyB: "北京乙方有限公司",
          partyC: "北京丙方有限公司",
          amount: 900000,
        },
        [
          { field: "party_a", value: "北京甲方有限公司" },
          { field: "party_b", value: "北京乙方有限公司" },
          { field: "party_c", value: "北京其他有限公司" },
          { field: "amount", value: "900000.00" },
        ],
      ),
    ).toEqual([
      {
        field: "party_c",
        label: "丙方单位",
        approvedValue: "北京丙方有限公司",
        sealedValue: "北京其他有限公司",
      },
    ]);
  });
});
