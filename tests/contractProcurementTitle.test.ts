import {
  getContractOcrAutomaticAdoptionSafetyContext,
  parseContractText,
  type ContractTextSource,
} from "../server/services/contractOcr";

const procurementPage = (title = "岗亭定制采购", object = "岗亭") =>
  [
    title,
    "甲方（购货方）：北京采购有限公司",
    "乙方（售货方）：郑州制造有限公司",
    "根据《中华人民共和国合同法》和有关法律法规之规定，就甲方向乙",
    `方采购${object}事宜经双方协议一致签订本采购合同。双方同意并协商如`,
    "下：",
  ].join("\n");

const otherTerms = [
  "十、其他约定事项",
  "1、本合同一式贰份，甲、乙双方各执壹份，持件与原件具有同等法律效力。",
  "本合同未尽事宜由双方另行议定补充合同，补充合同具有同等法律效力。",
].join("\n");

function independentSources(
  text: string,
  visibleText = text,
  pageNumber = 1,
): ContractTextSource[] {
  return [
    { text, source: "pdf_text", pageNumber, confidence: 99 },
    {
      text: visibleText,
      source: "ocr_300",
      pageNumber,
      confidence: 0.99,
      recognitionEngine: "paddleocr",
    },
  ];
}

const projectField = (result: ReturnType<typeof parseContractText>) =>
  result.fields.find((field) => field.field === "project_name")!;

describe("非主营采购合同独立标题识别", () => {
  it("首页无合同后缀标题由同页跨行采购对象佐证，其他约定不能成为项目候选", () => {
    const result = parseContractText("", {
      expectedCategory: "non_main",
      sources: [
        ...independentSources(procurementPage()),
        ...independentSources(otherTerms, otherTerms, 3),
      ],
    });
    expect(projectField(result).normalizedValue).toBe("岗亭定制采购");
    expect(projectField(result).confidence).toBe(100);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project,
    ).toMatchObject({
      trustedSource: true,
      strongEvidence: true,
      samePageVisibleOcrEvidence: true,
      riskCodes: [],
    });
    expect(
      projectField(result).candidates?.some((candidate) =>
        /其他约定|同等法律效力/.test(candidate.normalizedValue),
      ),
    ).not.toBe(true);
  });

  it("规则适用于其他采购对象，并保留原文完整短标题", () => {
    const result = parseContractText(
      procurementPage("办公家具定制采购", "办公家具"),
      {
        expectedCategory: "non_main",
      },
    );
    expect(projectField(result).normalizedValue).toBe("办公家具定制采购");
  });

  it.each([
    [
      "没有正文采购对象",
      "岗亭定制采购\n甲方：北京采购有限公司\n乙方：郑州制造有限公司",
    ],
    ["标题与采购对象不同", procurementPage("岗亭定制采购", "办公家具")],
    [
      "短名称位于甲乙方之后",
      procurementPage().split("\n").slice(1).join("\n") + "\n岗亭定制采购",
    ],
  ])("%s时不凭短标题猜测项目名称", (_label, text) => {
    const result = parseContractText(text, { expectedCategory: "non_main" });
    expect(projectField(result).normalizedValue).not.toBe("岗亭定制采购");
  });

  it("后页相同短标题不被误认成合同首页名称", () => {
    const result = parseContractText("", {
      expectedCategory: "non_main",
      sources: independentSources(procurementPage(), procurementPage(), 3),
    });
    expect(projectField(result).normalizedValue).not.toBe("岗亭定制采购");
  });

  it("同一识别引擎的多档一致不能伪造独立识别满分", () => {
    const result = parseContractText("", {
      expectedCategory: "non_main",
      sources: (["ocr_300", "ocr_480"] as const).map((source) => ({
        text: procurementPage(),
        source,
        pageNumber: 1,
        confidence: 0.99,
        recognitionEngine: "paddleocr",
      })),
    });
    expect(projectField(result).normalizedValue).toBe("岗亭定制采购");
    expect(projectField(result).confidence).toBeLessThan(100);
    expect(projectField(result).ocrConfidence).toBe(0.99);
  });

  it("可见页面缺少采购对象佐证时，文字层标题不能自动通过", () => {
    const result = parseContractText("", {
      expectedCategory: "non_main",
      sources: independentSources(
        procurementPage(),
        procurementPage("岗亭定制采购", "办公家具"),
      ),
    });
    expect(projectField(result).confidence).toBeLessThan(100);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project.riskCodes,
    ).toContain("PROJECT_PDF_VISIBLE_EVIDENCE_MISSING");
  });

  it("正文佐证文字置信度较低时不会只采用标题的高置信度", () => {
    const sources = independentSources(procurementPage());
    sources[1].lineConfidences = [0.99, 0.99, 0.99, 0.45, 0.45, 0.99];
    const result = parseContractText("", {
      expectedCategory: "non_main",
      sources,
    });
    expect(projectField(result).normalizedValue).toBe("岗亭定制采购");
    expect(projectField(result).confidence).toBeLessThan(100);
    expect(projectField(result).ocrConfidence).toBe(0.45);
  });

  it("明确项目名称及其安全续行仍优先于无后缀采购标题", () => {
    const text =
      procurementPage() +
      "\n项目名称：园区基础设施改造工程\n前期手续技术咨询服务\n签订地点：北京";
    const result = parseContractText(text, { expectedCategory: "non_main" });
    expect(projectField(result).normalizedValue).toBe(
      "园区基础设施改造工程前期手续技术咨询服务",
    );
  });

  it("拒绝法律条款句式不影响真正的法律服务标题", () => {
    const text =
      "常年法律顾问服务合同\n甲方：北京采购有限公司\n乙方：北京律师事务所";
    const result = parseContractText(text, { expectedCategory: "non_main" });
    expect(projectField(result).normalizedValue).toContain("法律顾问");
  });
});
