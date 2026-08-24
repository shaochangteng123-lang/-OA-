import fs from "fs";
import path from "path";
import { createHash } from "crypto";

describe("四区合同与财务凭证审计检查点", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/scripts/audit-four-area-documents.ts"),
    "utf8",
  );
  const regressionEvaluatorSource = fs.readFileSync(
    path.resolve(process.cwd(), "debug/evaluate-contract-ocr-regression.mjs"),
    "utf8",
  );

  it("只复用结构、策略、配置和识别上下文完全一致的结果", () => {
    expect(source).toContain("const AUDIT_SCHEMA_VERSION = 4");
    expect(source).toContain("record.schemaVersion === AUDIT_SCHEMA_VERSION");
    expect(source).toContain(
      "record.auditPolicyVersion === AUDIT_POLICY_VERSION",
    );
    expect(source).toContain(
      "record.auditConfigurationHash === expectedConfigurationHash",
    );
    expect(source).toContain("typeof record.recognitionContextKey");
    expect(source).toContain("companyNames: [...options.companyNames].sort()");
    expect(source).toContain(
      "companyTaxIds: [...options.companyTaxIds].sort()",
    );
    expect(source).toContain(
      "companyBankAccounts: [...options.companyBankAccounts].sort()",
    );
    expect(source).toContain(
      "requiredRegions: [...options.requiredRegions].sort()",
    );
  });

  it("模型配置进入审计摘要和每条记录，同一 V12（第十二版）不同模型不得复用", () => {
    expect(source).toContain(
      'const ocrModel = resolvePaddleOcrModel(optionValue("--ocr-model"))',
    );
    expect(source).toContain("ocrModel: options.ocrModel");
    expect(source).toContain("record.ocrModel === expectedOcrModel");
    expect(source).toContain("process.env.OCR_MODEL = options.ocrModel");
    expect(source).toContain("expectedCategory: declaredCategory || undefined");

    const hashFunction = source.slice(
      source.indexOf("function auditConfigurationHash"),
      source.indexOf("function relationTypeForCategory"),
    );
    expect(hashFunction.indexOf("kind: options.kind")).toBeLessThan(
      hashFunction.indexOf("ocrModel: options.ocrModel"),
    );
    expect(hashFunction.indexOf("ocrModel: options.ocrModel")).toBeLessThan(
      hashFunction.indexOf("companyNames:"),
    );

    const configuration = (ocrModel: "v4_mobile" | "v5_server") => ({
      schemaVersion: 4,
      auditPolicyVersion: "automatic-risk-review-2026-08-07-v12",
      kind: "contract",
      ocrModel,
      declaredCategory: "main_business",
      automaticPolicyVersion: "highest-qualified-candidate-v2",
      companyNames: ["北京羽隶工程咨询有限公司"],
      companyTaxIds: ["91110116MA01G3U20C"],
      companyBankAccounts: [],
      requiredRegions: ["国网丰台", "国网朝阳", "国网海淀", "国网门头沟"],
    });
    const hash = (ocrModel: "v4_mobile" | "v5_server") =>
      createHash("sha256")
        .update(JSON.stringify(configuration(ocrModel)))
        .digest("hex");

    expect(hash("v4_mobile")).toBe(
      "fe19f3c3f2d9916c5a70ad0a2b79cbacc3ad7e20f9bbc79fe389468d0cf24191",
    );
    expect(hash("v5_server")).toBe(
      "5f40f364c447b046d475f66bd22601a09428ddfe011d23da40448dd4e188d943",
    );
    expect(hash("v4_mobile")).not.toBe(hash("v5_server"));

    const contextFunction = source.slice(
      source.indexOf("function recognitionContextKey"),
      source.indexOf("function completedPathKey"),
    );
    expect(contextFunction).not.toContain("ocrModel");
  });

  it("检查点和重复缓存同时绑定文件摘要及合同金额语义", () => {
    expect(source).toContain(
      "`${row.relativePath}\\u0000${row.sha256}\\u0000${contextKey}`",
    );
    expect(source).toContain("`${sha256}\\u0000${contextKey}`");
    expect(source).toContain(
      "contract:${relationTypeForCategory(row.category)}",
    );
    expect(source).toContain(
      "const sourceFormat = row.extension.toLowerCase()",
    );
    expect(source).toContain("`${kind}:${sourceFormat}`");
    expect(source).toContain('recordType: "duplicate_reference"');
    expect(source).toContain(
      'const AUDIT_POLICY_VERSION = "automatic-risk-review-2026-08-07-v12"',
    );
  });

  it("运行前复核四个行政区及源文件大小和摘要", () => {
    expect(source).toContain('"国网丰台"');
    expect(source).toContain('"国网海淀"');
    expect(source).toContain('"国网朝阳"');
    expect(source).toContain('"国网门头沟"');
    expect(source).toContain("actualSize !== selected.row.size");
    expect(source).toContain("actualSha256 !== selected.row.sha256");
    expect(source).toContain("sha256File(filePath)");
  });

  it("留出集可显式声明行政区子集且默认仍锁定四区", () => {
    expect(source).toContain('optionValue("--required-regions")');
    expect(source).toContain('FOUR_AREA_REGIONS.join(",")');
    expect(source).toContain(
      "const expectedRegions = new Set(options.requiredRegions)",
    );
    expect(source).toContain(
      "const inventoryForKind = inventory.filter((row) => row.kind === options.kind)",
    );
    expect(source).toContain(
      "const actualRegions = new Set(inventoryForKind.map((row) => row.region))",
    );
    expect(source).toContain(
      'throw new Error("盘点清单行政区与 --required-regions 不一致")',
    );
  });

  it("原始评测结果使用仅当前用户可读权限", () => {
    expect(source).toContain("mode: 0o600");
    expect(source).toContain("fs.chmodSync(options.outputPath, 0o600)");
  });

  it("基础设施失败不会被记录为已完成检查点", () => {
    expect(source).toContain('result?.failureKind === "infrastructure"');
    expect(source).toContain("const shouldRetry =");
    expect(source).toContain("shouldRetry ||");
    expect(source).toContain('candidate.failureKind === "infrastructure"');
    expect(source).toContain(
      "if (!error && isReusableAuditResult(result, options.kind))",
    );
    expect(source).toContain("group.slice(1)");
  });

  it("仅复用与文档类型匹配且结构完整的结果", () => {
    expect(source).toContain(
      '["succeeded", "partial", "failed"].includes(String(candidate.status))',
    );
    expect(source).toContain(
      'candidate.kind === (kind === "invoice" ? "invoice" : "bank_receipt")',
    );
    expect(source).toContain("Array.isArray(candidate.fields)");
    expect(source).toContain("Array.isArray(candidate.blockingReasons)");
  });

  it("并发只允许 1 或 2 且默认为 1", () => {
    expect(source).toContain(
      'const concurrencyText = optionValue("--concurrency") || "1"',
    );
    expect(source).toContain("if (!/^[12]$/.test(concurrencyText))");
    expect(source).toContain("options.concurrency");
    expect(source).toContain("forEachWithConcurrency");
  });

  it("合同回归复用生产自动采用策略并锁定上传声明分类", () => {
    expect(source).toContain('optionValue("--declared-category")');
    expect(source).toContain("decideContractAutomaticOcrAdoption({");
    expect(source).toContain("automaticReady: automaticAdoption.accepted");
    expect(source).toContain(
      "policyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION",
    );
    expect(source).toContain("declaredCategory: options.declaredCategory");
    expect(source).not.toContain(
      "result.fields.every((field) => field.confidence === 100)",
    );
  });

  it("压缩结果保留原始置信度、字段评分和模型版本", () => {
    expect(source).toContain("ocrConfidence: field.ocrConfidence");
    expect(source).toContain("fieldScore: field.fieldScore");
    expect(source).toContain("ocrConfidence: candidate.ocrConfidence");
    expect(source).toContain("fieldScore: candidate.fieldScore");
    expect(source).toContain("modelVersion: result.modelVersion");
  });

  it("回归汇总校验生产策略决定并报告自动写入成功判定", () => {
    expect(regressionEvaluatorSource).toContain(
      'argument === "--declared-category"',
    );
    expect(regressionEvaluatorSource).toContain(
      "automaticReady 与生产策略决定不一致",
    );
    expect(regressionEvaluatorSource).toContain("automaticWriteSucceeded");
    expect(regressionEvaluatorSource).toContain(
      "离线复用生产策略，不执行数据库写入",
    );
  });

  it("先按物理路径裁切并逐一验源，再按摘要和识别上下文分组", () => {
    const limitIndex = source.indexOf(
      "pendingRows = pendingRows.slice(0, options.limit)",
    );
    const prepareIndex = source.indexOf("await preparePhysicalRow(");
    const groupIndex = source.indexOf(
      "const validGroups = new Map<string, PreparedPhysicalRow[]>()",
    );
    expect(limitIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(limitIndex);
    expect(groupIndex).toBeGreaterThan(prepareIndex);
    expect(source).toContain("await fs.promises.stat(filePath)");
    expect(source).toContain("await sha256File(filePath)");
    expect(source).toContain(
      "resultCacheKey(prepared.row.sha256, prepared.contextKey)",
    );
  });

  it("恢复时复核已完成路径，识别使用验摘要的不可变副本并在完成后再次验源", () => {
    expect(source).toContain("checkpointCompleted: isCheckpointCompleted(row)");
    expect(source).toContain("已复核检查点源文件未变化");
    expect(source).toContain("createVerifiedRecognitionCopy(representative)");
    expect(source).toContain("await fs.promises.copyFile(");
    expect(source).toContain("copiedSha256 !== prepared.row.sha256");
    expect(source).toContain(
      "await validatePreparedSourceIsStillCurrent(representative)",
    );
    expect(source).toContain("result = undefined");
  });

  it("单进程内集中同步追加完整 JSONL（逐行 JSON）记录", () => {
    expect(source).toContain("function appendAuditRecord(");
    expect(source).toContain("fs.appendFileSync(outputPath");
    expect(source).not.toContain("fs.promises.appendFile");
  });
});
