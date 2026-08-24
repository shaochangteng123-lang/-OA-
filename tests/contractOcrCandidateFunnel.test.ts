jest.mock("nanoid", () => ({ nanoid: () => "candidate-funnel-id" }));
const mockDatabaseAdapterAccess = jest.fn();
jest.mock("../server/db/index", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, property) => {
        mockDatabaseAdapterAccess(String(property));
        return jest.fn();
      },
    },
  ),
}));
jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcrDetailed: jest.fn(async () => ({
    lines: [
      { text: "技术服务合同", confidence: 0.98, box: [] },
      { text: "甲方：北京甲方建设有限公司", confidence: 0.98, box: [] },
      { text: "乙方：北京乙方咨询有限公司", confidence: 0.98, box: [] },
      {
        text: "项目名称：新城110千伏输变电工程",
        confidence: 0.98,
        box: [],
      },
      { text: "合同金额：133000元", confidence: 0.98, box: [] },
      { text: "签订日期：2026年8月10日", confidence: 0.98, box: [] },
    ],
    fullText:
      "技术服务合同\n甲方：北京甲方建设有限公司\n乙方：北京乙方咨询有限公司\n项目名称：新城110千伏输变电工程\n合同金额：133000元\n签订日期：2026年8月10日",
    modelVersion: "v6_medium",
  })),
}));
jest.mock("../server/services/tesseractOcrDaemon", () => ({
  callTesseractOcrDetailed: jest.fn(async () => ({
    lines: [],
    fullText: "",
    confidence: 0,
  })),
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractAmountBreakdown,
  getContractAmountStatus,
  getContractOcrCandidateFunnelIsolationProof,
  getContractOcrCandidateFunnelTrace,
  getContractOcrAutomaticAdoptionSafetyContext,
  parseContractText,
  recognizeContractFile,
  type ContractOcrCandidateFunnelTrace,
  type ContractRecognitionResult,
} from "../server/services/contractOcr";
import {
  contractOcrDocumentFailureStage,
  diagnoseContractOcrCandidateFunnel,
  earliestContractOcrFunnelFailureStage,
  summarizeContractOcrCandidateFunnel,
  type ContractOcrAutomaticDecisionLike,
  type ContractOcrFieldFunnelDiagnostic,
  type ContractOcrFunnelGroundTruth,
} from "../server/services/contractOcrCandidateFunnel";
import { decideContractAutomaticOcrAdoption } from "../server/services/contractService";

const completeText = [
  "技术服务合同",
  "甲方：北京甲方建设有限公司",
  "乙方：北京乙方咨询有限公司",
  "项目名称：新城110千伏输变电工程",
  "付款金额：人民币3000元",
  "合同金额：人民币133000元（大写：人民币壹拾叁万叁仟元整）",
  "签订日期：2026年8月10日",
].join("\n");

const truth: ContractOcrFunnelGroundTruth = {
  party_a: "北京甲方建设有限公司",
  party_b: "北京乙方咨询有限公司",
  project_name: "新城110千伏输变电工程",
  amount: "133000.00",
  contract_date: "2026-08-10",
};

function automaticDecision(result: ContractRecognitionResult) {
  return decideContractAutomaticOcrAdoption({
    resultStatus: result.status,
    failureKind: result.failureKind,
    relationType: "main",
    declaredCategory: "main_business",
    rawText: result.rawText,
    fields: result.fields,
    amountContext: getContractAmountAutomaticAdoptionContext(result),
    safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
  });
}

function businessProjection(result: ContractRecognitionResult) {
  return {
    result,
    amountStatus: getContractAmountStatus(result),
    amountBreakdown: getContractAmountBreakdown(result),
    amountContext: getContractAmountAutomaticAdoptionContext(result),
    safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    automaticDecision: automaticDecision(result),
  };
}

function syntheticResult(
  rawText: string,
  selectedProject: string,
): ContractRecognitionResult {
  return {
    status: "partial",
    fields: [
      {
        field: "project_name",
        originalValue: selectedProject,
        normalizedValue: selectedProject,
        confidence: selectedProject ? 90 : 0,
        ocrConfidence: null,
        fieldScore: selectedProject ? 90 : 0,
        source: "plain_text",
      },
    ],
    rawText,
    method: "plain_text",
    warnings: [],
    ocrLines: [],
  };
}

function syntheticTrace(options: {
  expected: string;
  generated?: boolean;
  retained?: boolean;
  rank?: number;
}): ContractOcrCandidateFunnelTrace {
  const candidateId = "candidate-0001";
  return {
    schemaVersion: 1,
    effectiveRelationType: "main",
    generatedCandidates: options.generated
      ? [
          {
            candidateId,
            generator: "project",
            field: "project_name",
            originalValue: options.expected,
            normalizedValue: options.expected,
            confidence: 90,
            ocrConfidence: null,
            fieldScore: 90,
            source: "plain_text",
            evidence: options.expected,
            recognitionEngine: "plain_text",
            strongEvidence: true,
            confidenceCap: 100,
            precedence: 0,
            explicitContractTotal: false,
          },
        ]
      : [],
    filteringDecisions: options.generated
      ? [
          {
            candidateId,
            retained: options.retained === true,
            ...(options.retained
              ? {}
              : { rejectedAt: "effective_amount" as const }),
          },
        ]
      : [],
    ranking:
      options.generated && options.retained
        ? [
            {
              field: "project_name",
              candidates: [
                ...(options.rank === 2
                  ? [
                      {
                        rank: 1,
                        normalizedValue: "错误项目",
                        score: 95,
                        fieldScore: 95,
                        orderingReasonCodes: [],
                        selected: true,
                        candidateIds: [],
                      },
                    ]
                  : []),
                {
                  rank: options.rank || 1,
                  normalizedValue: options.expected,
                  score: 90,
                  fieldScore: 90,
                  orderingReasonCodes: [],
                  selected: options.rank !== 2,
                  candidateIds: [candidateId],
                },
              ],
            },
          ]
        : [],
  };
}

function rejectedDecision(
  projectValue: string | null,
): ContractOcrAutomaticDecisionLike {
  return {
    accepted: false,
    status: "partial",
    values: { project_name: projectValue },
    legalEmptyFields: [],
    blockers: ["其他字段没有可采用候选"],
    warnings: [],
  };
}

describe("第十一阶段A合同候选漏斗诊断", () => {
  it("关闭和开启诊断时完整业务投影保持一致", () => {
    const baseline = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
    });
    const diagnostic = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });

    expect(businessProjection(diagnostic)).toEqual(
      businessProjection(baseline),
    );
    expect(getContractOcrCandidateFunnelTrace(baseline)).toBeNull();
    expect(getContractOcrCandidateFunnelTrace(diagnostic)).not.toBeNull();
    expect(Object.keys(diagnostic)).not.toContain("candidateFunnel");
    expect(JSON.stringify(diagnostic)).not.toContain("generatedCandidates");
    expect(JSON.stringify(diagnostic)).not.toContain("trustedSource");
    expect(JSON.stringify(diagnostic)).not.toContain(
      "samePageVisibleOcrEvidence",
    );
    expect(JSON.stringify(diagnostic)).not.toContain("amountRole");
  });

  it("关闭完整漏斗诊断时仍生成不序列化的候选安全上下文", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result);

    expect(getContractOcrCandidateFunnelTrace(result)).toBeNull();
    expect(safety).toMatchObject({
      project: {
        selectedValue: truth.project_name,
        candidateExists: true,
        trustedSource: true,
        uniqueOrSufficientGap: true,
      },
      amount: {
        selectedValue: truth.amount,
        candidateExists: true,
        role: "contract_amount",
        scope: "current_contract",
      },
    });
    expect(JSON.stringify(result)).not.toContain("riskCodes");
    expect(JSON.stringify(result)).not.toContain("explicitContractTotal");
  });

  it("候选不存在或最终值与候选证据错配时不能绕过自动采用门禁", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
    });
    const fieldsWithWrongProject = result.fields.map((field) =>
      field.field === "project_name"
        ? {
            ...field,
            normalizedValue: "技术服务合同",
            candidates: [],
          }
        : field,
    );
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: result.status,
      failureKind: result.failureKind,
      relationType: "main",
      declaredCategory: "main_business",
      rawText: result.rawText,
      fields: fieldsWithWrongProject,
      amountContext: getContractAmountAutomaticAdoptionContext(result),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    });

    expect(decision.accepted).toBe(false);
    expect(decision.status).toBe("partial");
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "项目名称与候选安全证据不一致",
        "项目名称候选属于合同或协议类型",
      ]),
    );
  });

  it("后页唯一且高分的项目字段仍因来源不可信保持partial", () => {
    const text = [
      "技术服务合同",
      "甲方：北京甲方建设有限公司",
      "乙方：北京乙方咨询有限公司",
      "项目名称：年度技术服务项目",
      "合同金额：133000元",
      "签订日期：2026年8月10日",
    ].join("\n");
    const result = parseContractText(text, {
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 8,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
        },
      ],
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result);
    const decision = automaticDecision(result);

    expect(
      result.fields.find((field) => field.field === "project_name"),
    ).toMatchObject({
      normalizedValue: "年度技术服务项目",
      fieldScore: 97,
      pageNumber: 8,
    });
    expect(safety?.project).toMatchObject({
      candidateExists: true,
      trustedSource: false,
      distinctCandidateCount: 1,
      uniqueOrSufficientGap: true,
      riskCodes: ["PROJECT_SOURCE_UNTRUSTED"],
    });
    expect(decision).toMatchObject({
      accepted: false,
      status: "partial",
      blockers: ["项目名称候选来源不满足自动采用条件"],
    });
  });

  it.each([
    {
      label: "明确金额",
      relationType: "main" as const,
      text: completeText,
    },
    {
      label: "补充协议计算金额",
      relationType: "supplement" as const,
      text: [
        "技术服务合同补充协议",
        "甲方：北京甲方建设有限公司",
        "乙方：北京乙方咨询有限公司",
        "项目名称：新城110千伏输变电工程",
        "原合同金额为230000元",
        "本次补充协议增加合同金额60000元",
        "调整后合同金额为290000元",
      ].join("\n"),
    },
    {
      label: "仅付款金额",
      relationType: "main" as const,
      text: "技术服务合同\n付款金额：人民币3000元",
    },
    {
      label: "金额缺失",
      relationType: "main" as const,
      text: "技术服务合同\n服务内容：现场资料整理",
    },
    {
      label: "项目名称跨行",
      relationType: "main" as const,
      text: [
        "项目名称：东城110千伏输变电工程工程规划许可证、施",
        "工许可证",
        "甲方：北京甲方建设有限公司",
      ].join("\n"),
    },
  ])("$label场景的诊断旁路不改变结果", ({ text, relationType }) => {
    const baseline = parseContractText(text, {
      relationType,
      expectedCategory: "main_business",
    });
    const diagnostic = parseContractText(text, {
      relationType,
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });

    expect(businessProjection(diagnostic)).toEqual(
      businessProjection(baseline),
    );
  });

  it("真实图片文件入口对同一识别来源执行开关等价校验且不访问数据库", async () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-funnel-image-"),
    );
    const filePath = path.join(temporaryDirectory, "contract.png");
    try {
      await sharp({
        create: {
          width: 1000,
          height: 1400,
          channels: 3,
          background: "white",
        },
      })
        .png()
        .toFile(filePath);
      const commonOptions = {
        relationType: "main" as const,
        expectedCategory: "main_business" as const,
        ocrModel: "v6_medium" as const,
      };
      const baseline = await recognizeContractFile(
        filePath,
        "image/png",
        commonOptions,
      );
      const diagnostic = await recognizeContractFile(filePath, "image/png", {
        ...commonOptions,
        candidateFunnelDiagnostics: true,
      });

      expect(businessProjection(diagnostic)).toEqual(
        businessProjection(baseline),
      );
      expect(Object.keys(diagnostic)).toEqual(Object.keys(baseline));
      expect(getContractOcrCandidateFunnelIsolationProof(diagnostic)).toBe(
        true,
      );
      expect(getContractOcrCandidateFunnelTrace(diagnostic)).not.toBeNull();
      expect(JSON.stringify(diagnostic)).not.toContain("candidateFunnel");
      expect(mockDatabaseAdapterAccess).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("真实DOCX文件入口继承旁路轨迹但不增加识别结果字段", async () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-funnel-docx-"),
    );
    const filePath = path.join(temporaryDirectory, "contract.docx");
    try {
      const zip = new JSZip();
      zip.file(
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      );
      zip.file(
        "word/document.xml",
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${completeText
          .split("\n")
          .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
          .join("")}</w:body></w:document>`,
      );
      fs.writeFileSync(
        filePath,
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      const mimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const baseline = await recognizeContractFile(filePath, mimeType, {
        relationType: "main",
        expectedCategory: "main_business",
      });
      const diagnostic = await recognizeContractFile(filePath, mimeType, {
        relationType: "main",
        expectedCategory: "main_business",
        candidateFunnelDiagnostics: true,
      });

      expect(businessProjection(diagnostic)).toEqual(
        businessProjection(baseline),
      );
      expect(Object.keys(diagnostic)).toEqual(Object.keys(baseline));
      expect(getContractOcrCandidateFunnelIsolationProof(diagnostic)).toBe(
        true,
      );
      expect(getContractOcrCandidateFunnelTrace(diagnostic)).not.toBeNull();
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("记录候选生成、过滤和最终排序但不改变付款金额安全边界", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const trace = getContractOcrCandidateFunnelTrace(result)!;
    const amount = result.fields.find((field) => field.field === "amount")!;

    expect(
      trace.generatedCandidates.some((item) => item.generator === "project"),
    ).toBe(true);
    expect(
      trace.generatedCandidates.some(
        (item) =>
          item.field === "amount" && item.amountRole === "payment_amount",
      ),
    ).toBe(true);
    const filteredAmountIds = new Set(
      trace.filteringDecisions
        .filter(
          (decision) =>
            !decision.retained && decision.rejectedAt === "effective_amount",
        )
        .map((decision) => decision.candidateId),
    );
    expect(
      trace.generatedCandidates.some(
        (item) =>
          item.amountRole === "payment_amount" &&
          filteredAmountIds.has(item.candidateId),
      ),
    ).toBe(true);
    expect(
      trace.ranking.find((item) => item.field === "amount")?.candidates[0],
    ).toMatchObject({
      rank: 1,
      normalizedValue: "133000.00",
      selected: true,
    });
    expect(amount.normalizedValue).toBe("133000.00");
  });

  it("中文大写金额不参与合同金额候选生成和排序", () => {
    const result = parseContractText(
      "合同金额：133000元（大写：壹拾叁万叁仟元整）",
      {
        relationType: "main",
        candidateFunnelDiagnostics: true,
      },
    );
    const trace = getContractOcrCandidateFunnelTrace(result);
    const amountRanking = trace?.ranking.find(
      (field) => field.field === "amount",
    )?.candidates;

    expect(amountRanking?.[0]).toMatchObject({
      normalizedValue: "133000.00",
      orderingReasonCodes: [],
    });
    expect(
      trace?.generatedCandidates.filter(
        (candidate) =>
          candidate.field === "amount" && candidate.kind === "chinese_amount",
      ),
    ).toEqual([]);
  });

  it("把框架协议内部删除的项目候选归因到候选过滤", () => {
    const projectName = "东城110千伏输变电工程";
    const result = parseContractText(
      `${projectName}技术服务合同\n咨询服务框架协议\n甲方：北京甲方建设有限公司`,
      {
        relationType: "main",
        candidateFunnelDiagnostics: true,
      },
    );
    const trace = getContractOcrCandidateFunnelTrace(result)!;
    const candidate = trace.generatedCandidates.find(
      (item) =>
        item.field === "project_name" && item.normalizedValue === projectName,
    );

    expect(candidate).toBeDefined();
    expect(
      trace.filteringDecisions.find(
        (decision) => decision.candidateId === candidate?.candidateId,
      ),
    ).toMatchObject({
      retained: false,
      rejectedAt: "framework_project",
    });
  });

  it("参与项目融合的短候选保留为排序证据且记录真实排序分", () => {
    const shortProject = "东城110千伏输变电工程";
    const result = parseContractText(
      [
        `项目名称：${shortProject}`,
        `工程名称：${shortProject}（前期手续）`,
      ].join("\n"),
      {
        relationType: "main",
        candidateFunnelDiagnostics: true,
      },
    );
    const trace = getContractOcrCandidateFunnelTrace(result)!;
    const shortCandidate = trace.generatedCandidates.find(
      (item) =>
        item.field === "project_name" && item.normalizedValue === shortProject,
    );
    const projectRanking = trace.ranking.find(
      (item) => item.field === "project_name",
    )?.candidates[0];

    expect(shortCandidate).toBeDefined();
    expect(projectRanking?.candidateIds).toContain(shortCandidate?.candidateId);
    expect(
      trace.filteringDecisions.find(
        (decision) => decision.candidateId === shortCandidate?.candidateId,
      ),
    ).toEqual({ candidateId: shortCandidate?.candidateId, retained: true });
    expect(projectRanking?.score).toBeGreaterThan(
      projectRanking?.fieldScore || 0,
    );
  });

  it("getter返回深拷贝，修改诊断对象不影响业务结果或内部金额状态", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const before = businessProjection(result);
    const firstTrace = getContractOcrCandidateFunnelTrace(result)!;
    firstTrace.generatedCandidates[0].normalizedValue = "被修改的诊断值";
    firstTrace.ranking
      .find((field) => field.field === "amount")
      ?.candidates[0].orderingReasonCodes.push("被修改的排序原因");
    firstTrace.ranking[0].candidates.splice(0);
    const firstSafety = getContractOcrAutomaticAdoptionSafetyContext(result)!;
    firstSafety.project.trustedSource = false;
    firstSafety.project.riskCodes.push("被修改的安全原因");
    firstSafety.amount.role = "payment_amount";

    expect(businessProjection(result)).toEqual(before);
    expect(
      getContractOcrCandidateFunnelTrace(result)?.generatedCandidates[0]
        .normalizedValue,
    ).not.toBe("被修改的诊断值");
    expect(
      getContractOcrCandidateFunnelTrace(result)?.ranking[0].candidates,
    ).not.toHaveLength(0);
    expect(
      getContractOcrCandidateFunnelTrace(result)?.ranking.find(
        (field) => field.field === "amount",
      )?.candidates[0].orderingReasonCodes,
    ).not.toContain("被修改的排序原因");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project
        .trustedSource,
    ).toBe(true);
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.project.riskCodes,
    ).not.toContain("被修改的安全原因");
    expect(
      getContractOcrAutomaticAdoptionSafetyContext(result)?.amount.role,
    ).toBe("contract_amount");
  });

  it("正确样本输出每个字段的首个失败阶段", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const diagnostics = diagnoseContractOcrCandidateFunnel(
      result,
      getContractOcrCandidateFunnelTrace(result),
      truth,
      automaticDecision(result),
    );

    expect(diagnostics).toHaveLength(5);
    expect(diagnostics.map((item) => item.firstFailureStage)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
    ]);
    expect(
      summarizeContractOcrCandidateFunnel(diagnostics).byFailureStage,
    ).toMatchObject({ passed: 5 });
  });

  it.each([
    {
      label: "OCR原文缺失",
      rawText: "无关正文",
      generated: false,
      retained: false,
      rank: undefined,
      selected: "",
      decision: rejectedDecision(null),
      expectedStage: "ocr_raw",
    },
    {
      label: "候选未生成",
      rawText: "目标项目",
      generated: false,
      retained: false,
      rank: undefined,
      selected: "",
      decision: rejectedDecision(null),
      expectedStage: "candidate_generation",
    },
    {
      label: "候选被过滤",
      rawText: "目标项目",
      generated: true,
      retained: false,
      rank: undefined,
      selected: "",
      decision: rejectedDecision(null),
      expectedStage: "candidate_filtering",
    },
    {
      label: "候选排序错误",
      rawText: "目标项目",
      generated: true,
      retained: true,
      rank: 2,
      selected: "错误项目",
      decision: rejectedDecision("错误项目"),
      expectedStage: "candidate_ranking",
    },
    {
      label: "自动采用阻断",
      rawText: "目标项目",
      generated: true,
      retained: true,
      rank: 1,
      selected: "目标项目",
      decision: {
        ...rejectedDecision("目标项目"),
        blockers: ["项目名称没有可采用候选"],
      },
      expectedStage: "automatic_adoption",
    },
  ])("归因到$label", (scenario) => {
    const expected = { ...truth, project_name: "目标项目" };
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      syntheticResult(scenario.rawText, scenario.selected),
      syntheticTrace({
        expected: "目标项目",
        generated: scenario.generated,
        retained: scenario.retained,
        rank: scenario.rank,
      }),
      expected,
      scenario.decision,
    ).find((field) => field.field === "project_name");

    expect(diagnostic?.firstFailureStage).toBe(scenario.expectedStage);
  });

  it("逐行模型原文缺失时不会被文字层或已生成候选伪装成OCR命中", () => {
    const result = syntheticResult("目标项目", "目标项目");
    result.ocrLines = [
      {
        page: 1,
        text: "模型识别错误项目",
        bbox: [],
        confidence: 0.9,
        modelVersion: "v6_medium",
      },
    ];
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      result,
      syntheticTrace({
        expected: "目标项目",
        generated: true,
        retained: true,
      }),
      { ...truth, project_name: "目标项目" },
      {
        ...rejectedDecision("目标项目"),
        accepted: true,
        status: "succeeded",
        blockers: [],
      },
    ).find((field) => field.field === "project_name");

    expect(diagnostic).toMatchObject({
      rawEvidenceKind: "ocr_lines",
      ocrLineContainsExpected: false,
      sourceRawContainsExpected: true,
      ocrRawContainsExpected: false,
      firstFailureStage: "ocr_raw",
    });
  });

  it("其他字段导致整单阻断时不把正确项目名称误归为自动采用失败", () => {
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      syntheticResult("目标项目", "目标项目"),
      syntheticTrace({
        expected: "目标项目",
        generated: true,
        retained: true,
      }),
      { ...truth, project_name: "目标项目" },
      rejectedDecision("目标项目"),
    ).find((field) => field.field === "project_name");

    expect(diagnostic).toMatchObject({
      automaticDecisionValue: "目标项目",
      automaticDecisionBlockedForField: false,
      firstFailureStage: "passed",
    });
  });

  it("排名阶段抑制的正确候选归因到候选排序而不是候选过滤", () => {
    const trace = syntheticTrace({
      expected: "目标项目",
      generated: true,
      retained: false,
    });
    trace.filteringDecisions[0].rejectedAt = "ranking_suppression";
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      syntheticResult("目标项目", "错误项目"),
      trace,
      { ...truth, project_name: "目标项目" },
      rejectedDecision("错误项目"),
    ).find((field) => field.field === "project_name");

    expect(diagnostic).toMatchObject({
      firstFailureStage: "candidate_ranking",
      matchingRankingSuppressedCandidateIds: ["candidate-0001"],
    });
  });

  it("金额数值正确但金额状态错误时归因到排名后业务校验", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      result,
      getContractOcrCandidateFunnelTrace(result),
      { ...truth, amountStatus: "payment_only" },
      automaticDecision(result),
    ).find((field) => field.field === "amount");

    expect(diagnostic).toMatchObject({
      selectedMatchesExpected: true,
      amountStatusMatchesExpected: false,
      firstFailureStage: "post_ranking_validation",
    });
  });

  it("项目名称比较保留括号和连接符，不把标题缺失判为正确", () => {
    const expectedProject = "创新园110千伏变电站（一期）";
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      syntheticResult(expectedProject, "创新园110千伏变电站一期"),
      syntheticTrace({
        expected: "创新园110千伏变电站一期",
        generated: true,
        retained: true,
      }),
      { ...truth, project_name: expectedProject },
      rejectedDecision("创新园110千伏变电站一期"),
    ).find((field) => field.field === "project_name");

    expect(diagnostic?.firstFailureStage).toBe("candidate_generation");
  });

  it("样本首个失败阶段按流程先后选择而不是按字段顺序", () => {
    expect(
      earliestContractOcrFunnelFailureStage([
        { firstFailureStage: "automatic_adoption" },
        { firstFailureStage: "ocr_raw" },
      ] as ContractOcrFieldFunnelDiagnostic[]),
    ).toBe("ocr_raw");
  });

  it("字段全部正确但整单分类阻断时文档级首错不能显示通过", () => {
    const result = parseContractText(completeText, {
      relationType: "main",
      expectedCategory: "main_business",
      candidateFunnelDiagnostics: true,
    });
    const decision = {
      ...automaticDecision(result),
      accepted: false,
      status: "partial" as const,
      blockers: ["OCR识别合同分类与上传时锁定分类不一致"],
    };
    const diagnostics = diagnoseContractOcrCandidateFunnel(
      result,
      getContractOcrCandidateFunnelTrace(result),
      truth,
      decision,
    );

    expect(
      diagnostics.every((field) => field.firstFailureStage === "passed"),
    ).toBe(true);
    expect(contractOcrDocumentFailureStage(diagnostics, decision)).toBe(
      "automatic_adoption",
    );
  });

  it("中文大写金额已在原文时归因到候选生成而不是OCR原文", () => {
    const result = syntheticResult("合同价款：壹拾叁万叁仟元整", "");
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      result,
      syntheticTrace({ expected: "133000.00" }),
      {
        party_a: null,
        party_b: null,
        project_name: null,
        amount: "133000.00",
        contract_date: null,
      },
      rejectedDecision(null),
    ).find((field) => field.field === "amount");

    expect(diagnostic).toMatchObject({
      ocrRawContainsExpected: true,
      firstFailureStage: "candidate_generation",
    });
  });

  it("中文日期已在原文时归因到候选生成而不是OCR原文", () => {
    const result = syntheticResult("签订日期：二〇二六年八月十日", "");
    const diagnostic = diagnoseContractOcrCandidateFunnel(
      result,
      syntheticTrace({ expected: "2026-08-10" }),
      {
        party_a: null,
        party_b: null,
        project_name: null,
        amount: null,
        contract_date: "2026-08-10",
      },
      rejectedDecision(null),
    ).find((field) => field.field === "contract_date");

    expect(diagnostic).toMatchObject({
      ocrRawContainsExpected: true,
      firstFailureStage: "candidate_generation",
    });
  });

  it("离线脚本固定模型、私有目录、不可覆盖和只读约束", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/diagnose-contract-ocr-stage11.ts",
      ),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(source).toContain('const FIXED_OCR_MODEL = "v6_medium"');
    expect(source).toContain("debug/contract-ocr-stage11-private");
    expect(source).toContain('fs.openSync(options.outputPath, "wx", 0o600)');
    expect(source).toContain("LOCKED_DIAGNOSTIC_GROUND_TRUTH_SHA256");
    expect(source).toContain("getContractOcrCandidateFunnelIsolationProof");
    expect(source).toContain("shutdownOcrDaemon");
    expect(source).not.toContain('optionValue("--declared-category")');
    expect(source).toContain("candidateFunnelDiagnostics: true");
    expect(packageJson.scripts?.["contract:ocr:diagnose-stage11"]).toBe(
      "tsx server/scripts/diagnose-contract-ocr-stage11.ts",
    );
  });
});
