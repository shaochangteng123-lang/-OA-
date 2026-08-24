/** @jest-environment node */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildContractOcrFamilyIsolation,
  contractOcrFamilyKeys,
  normalizeContractFamilyText,
  type ContractOcrFamilyIsolationOptions,
} from "../server/services/contractOcrFamilyIsolation";
import type { ContractOcrInventoryRow } from "../server/services/contractOcrHoldout";

const HEADER = "行政区\t分类\t状态\t扩展名\t字节数\tSHA256\t相对路径";

function digest(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function row(
  label: string,
  relativePath: string,
  category = "主合同或其他合同",
): ContractOcrInventoryRow {
  return {
    region: "国网海淀",
    category,
    sourceStatus: "正常或未标注",
    extension: "pdf",
    size: 1000 + label.length,
    sha256: digest(label),
    relativePath,
  };
}

function manifest(rows: ContractOcrInventoryRow[]): string {
  return `${HEADER}\n${rows
    .map((item) =>
      [
        item.region,
        item.category,
        item.sourceStatus,
        item.extension,
        String(item.size),
        item.sha256,
        item.relativePath,
      ].join("\t"),
    )
    .join("\n")}\n`;
}

function consumedAudit(
  records: Array<{ kind: string; sha256: string }>,
): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function privateFamilyRegistry(
  rows: Array<{
    row: ContractOcrInventoryRow;
    familyId: string;
    relationType:
      | "main"
      | "supplement"
      | "change"
      | "reduction"
      | "termination"
      | "other";
  }>,
): string {
  return `SHA256\t外部合同族编号\t关系类型\n${rows
    .map(({ row: item, familyId, relationType }) =>
      [item.sha256, familyId, relationType].join("\t"),
    )
    .join("\n")}\n`;
}

function parsePrivateMapping(filePath: string): Array<{
  sampleId: string;
  familyId: string;
  relationType: string;
  state: string;
  sha256: string;
}> {
  return fs
    .readFileSync(filePath, "utf8")
    .trimEnd()
    .split("\n")
    .slice(1)
    .map((line) => {
      const columns = line.split("\t");
      return {
        sampleId: columns[0],
        familyId: columns[1],
        relationType: columns[2],
        state: columns[3],
        sha256: columns[10],
      };
    });
}

describe("合同 OCR（光学字符识别）新盲测集合同族隔离", () => {
  let temporaryRoot: string;
  let sourceRows: ContractOcrInventoryRow[];
  let historicalExclusion: ContractOcrInventoryRow[];
  let stage7Exclusion: ContractOcrInventoryRow[];

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-ocr-family-isolation-test-"),
    );
    const familyA = "国网海淀/2025-甲项目￥100000";
    const familyB = "国网海淀/2026-乙项目￥200000";
    const familyC = "国网海淀/2027-丙项目￥300000";
    const historyMain = row(
      "history-main",
      `${familyA}/1-技术服务合同-甲项目-20250130￥100000.pdf`,
    );
    const historyRelative = row(
      "history-relative",
      `${familyA}/1-补充协议书-甲项目-20250912￥20000.pdf`,
      "补充协议",
    );
    const stage7Main = row(
      "stage7-main",
      `${familyB}/1-技术服务合同-乙项目-20260130￥200000.pdf`,
    );
    const stage7Relative = row(
      "stage7-relative",
      `${familyB}/1-补充协议书-乙项目-20260912￥-10000.pdf`,
      "补充协议",
    );
    const cleanMain = row(
      "clean-main",
      `${familyC}/1-技术服务合同-丙项目-20270130￥300000.pdf`,
    );
    const cleanRelative = row(
      "clean-relative",
      `${familyC}/1-变更协议书-丙项目-20270912￥30000.pdf`,
      "补充协议",
    );
    const singletonD = row(
      "singleton-d",
      "国网海淀/2028-丁项目/1-技术服务合同-丁项目-20280130￥400000.pdf",
    );
    const singletonE = row(
      "singleton-e",
      "国网海淀/2029-戊项目/1-技术服务合同-戊项目-20290130￥500000.pdf",
    );
    const singletonF = row(
      "singleton-f",
      "国网海淀/2030-己项目/1-技术服务合同-己项目-20300130￥600000.pdf",
    );
    sourceRows = [
      historyMain,
      historyRelative,
      stage7Main,
      stage7Relative,
      cleanMain,
      cleanRelative,
      singletonD,
      singletonE,
      singletonF,
    ];
    historicalExclusion = [historyMain];
    stage7Exclusion = [stage7Main];
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  function writeInputs(rows = sourceRows): {
    inventoryPath: string;
    exclusionPaths: string[];
  } {
    const inventoryPath = path.join(temporaryRoot, "inventory.tsv");
    const historicalPath = path.join(temporaryRoot, "historical.tsv");
    const stage7Path = path.join(temporaryRoot, "stage7.tsv");
    fs.writeFileSync(inventoryPath, manifest(rows));
    fs.writeFileSync(historicalPath, manifest(historicalExclusion));
    fs.writeFileSync(stage7Path, manifest(stage7Exclusion));
    return {
      inventoryPath,
      exclusionPaths: [historicalPath, stage7Path],
    };
  }

  function buildOptions(
    suffix: string,
    targetSize: number,
    rows = sourceRows,
  ): ContractOcrFamilyIsolationOptions {
    const inputs = writeInputs(rows);
    return {
      inventoryPath: inputs.inventoryPath,
      exclusionManifestPaths: inputs.exclusionPaths,
      outputManifestPath: path.join(temporaryRoot, `${suffix}-manifest.tsv`),
      outputMappingPath: path.join(temporaryRoot, `${suffix}-mapping.tsv`),
      outputMetadataPath: path.join(temporaryRoot, `${suffix}-public.json`),
      targetSize,
      seed: "fixed-family-seed-v1",
      datasetVersion: "synthetic-family-isolation-v1",
    };
  }

  it("规范化年份、金额、合同类型和 kV（千伏）写法", () => {
    expect(
      normalizeContractFamilyText(
        "1-技术服务合同-创新园110kV变电站-20250130￥133000.pdf",
      ),
    ).toBe("创新园110千伏变电站");
    expect(
      normalizeContractFamilyText(
        "1-补充协议书-创新园110千伏变电站-20250912￥20000.pdf",
      ),
    ).toBe("创新园110千伏变电站");
    expect(
      normalizeContractFamilyText(
        "1-核减协议书-创新园110千伏变电站-20260101￥3000.pdf",
      ),
    ).toBe("创新园110千伏变电站");
    expect(
      normalizeContractFamilyText(
        "1-主合同-创新园110千伏变电站-20250101￥133000.pdf",
      ),
    ).toBe("创新园110千伏变电站");
  });

  it("同项目目录和规范化文件名形成保守合同族键", () => {
    const main = sourceRows[0];
    const supplement = sourceRows[1];
    const unrelated = sourceRows[2];
    const mainKeys = new Set(
      contractOcrFamilyKeys(main).map((item) => item.key),
    );
    const supplementKeys = contractOcrFamilyKeys(supplement).map(
      (item) => item.key,
    );
    const unrelatedKeys = contractOcrFamilyKeys(unrelated).map(
      (item) => item.key,
    );

    expect(supplementKeys.some((key) => mainKeys.has(key))).toBe(true);
    expect(unrelatedKeys.some((key) => mainKeys.has(key))).toBe(false);
  });

  it("先建立完整合同族，再传播排除且每族最多选择一份", async () => {
    const options = buildOptions("complete", 3);
    const result = await buildContractOcrFamilyIsolation(options);

    expect(result.sourceUniqueDocuments).toBe(9);
    expect(result.directlyExcludedDocuments).toBe(2);
    expect(result.additionallyExcludedByFamily).toBe(2);
    expect(result.eligibleDocuments).toBe(5);
    expect(result.eligibleFamilies).toBe(4);
    expect(result.selectedDocuments).toBe(3);
    expect(result.capacitySufficient).toBe(true);

    const mapping = parsePrivateMapping(options.outputMappingPath);
    expect(mapping.filter((item) => item.state === "直接排除")).toHaveLength(2);
    expect(
      mapping.filter((item) => item.state === "整族传播排除"),
    ).toHaveLength(2);
    const selected = mapping.filter((item) => item.state === "已选择");
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((item) => item.familyId)).size).toBe(3);
    expect(
      selected.some((item) =>
        [...historicalExclusion, ...stage7Exclusion].some(
          (excluded) => excluded.sha256 === item.sha256,
        ),
      ),
    ).toBe(false);

    expect(fs.statSync(options.outputManifestPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(options.outputMappingPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(options.outputMetadataPath).mode & 0o777).toBe(0o644);
  });

  it("历史 consumed（已消耗）审计中未进入两个排除清单的合同也直接排除", async () => {
    const options = buildOptions("consumed", 3);
    const firstAuditPath = path.join(temporaryRoot, "consumed-a.jsonl");
    const secondAuditPath = path.join(temporaryRoot, "consumed-b.jsonl");
    fs.writeFileSync(
      firstAuditPath,
      consumedAudit([
        { kind: "contract", sha256: sourceRows[4].sha256 },
        { kind: "attachment", sha256: digest("非合同审计记录") },
      ]),
    );
    fs.writeFileSync(
      secondAuditPath,
      consumedAudit([{ kind: "contract", sha256: sourceRows[4].sha256 }]),
    );

    const result = await buildContractOcrFamilyIsolation({
      ...options,
      consumedAuditPaths: [firstAuditPath, secondAuditPath],
    });

    expect(result.consumedAuditUniqueDocuments).toBe(1);
    expect(result.directlyExcludedDocuments).toBe(3);
    expect(result.additionallyExcludedByFamily).toBe(3);
    expect(result.metadata.source.consumedAuditFileCount).toBe(2);
    expect(result.metadata.source.consumedAuditUniqueDocuments).toBe(1);
    const mapping = parsePrivateMapping(options.outputMappingPath);
    expect(
      mapping.find((item) => item.sha256 === sourceRows[4].sha256)?.state,
    ).toBe("直接排除");
    expect(
      mapping.find((item) => item.sha256 === sourceRows[5].sha256)?.state,
    ).toBe("整族传播排除");
  });

  it("公开元数据不含摘要、路径或合同字段原值，并明确能力边界", async () => {
    const options = buildOptions("privacy", 3);
    const result = await buildContractOcrFamilyIsolation(options);
    const publicText = fs.readFileSync(options.outputMetadataPath, "utf8");

    for (const source of sourceRows) {
      expect(publicText).not.toContain(source.sha256);
      expect(publicText).not.toContain(source.relativePath);
    }
    expect(publicText).not.toMatch(/[a-f0-9]{64}/u);
    expect(publicText).not.toContain("originalValue");
    expect(publicText).not.toContain("normalizedValue");
    expect(result.metadata.familyIsolation.visualNearDuplicateIsolation).toBe(
      false,
    );
    expect(result.metadata.familyIsolation.textNearDuplicateIsolation).toBe(
      false,
    );
    expect(result.metadata.familyIsolation.claim).toContain("不声明视觉近重复");
    expect(result.metadata.privacy).toEqual({
      includesDocumentDigests: false,
      includesDocumentPaths: false,
      includesContractFieldValues: false,
      privateManifestMode: "0600",
      privateMappingMode: "0600",
    });
    expect(result.metadata.source.consumedAuditFileCount).toBe(0);
    expect(result.metadata.source.consumedAuditUniqueDocuments).toBe(0);
  });

  it("库存顺序改变时选择、私有映射和公开元数据保持确定", async () => {
    const firstOptions = buildOptions("order-a", 3);
    const first = await buildContractOcrFamilyIsolation(firstOptions);
    const reversedInputs = writeInputs([...sourceRows].reverse());
    const secondOptions: ContractOcrFamilyIsolationOptions = {
      ...firstOptions,
      inventoryPath: reversedInputs.inventoryPath,
      exclusionManifestPaths: [...reversedInputs.exclusionPaths].reverse(),
      outputManifestPath: path.join(temporaryRoot, "order-b-manifest.tsv"),
      outputMappingPath: path.join(temporaryRoot, "order-b-mapping.tsv"),
      outputMetadataPath: path.join(temporaryRoot, "order-b-public.json"),
    };
    const second = await buildContractOcrFamilyIsolation(secondOptions);

    expect(first.selectedDocuments).toBe(second.selectedDocuments);
    expect(fs.readFileSync(firstOptions.outputManifestPath, "utf8")).toBe(
      fs.readFileSync(secondOptions.outputManifestPath, "utf8"),
    );
    expect(fs.readFileSync(firstOptions.outputMappingPath, "utf8")).toBe(
      fs.readFileSync(secondOptions.outputMappingPath, "utf8"),
    );
    expect(fs.readFileSync(firstOptions.outputMetadataPath, "utf8")).toBe(
      fs.readFileSync(secondOptions.outputMetadataPath, "utf8"),
    );
  });

  it("合同族容量不足时只选择可用族并输出明确缺口", async () => {
    const options = buildOptions("insufficient", 6);
    const result = await buildContractOcrFamilyIsolation(options);

    expect(result.selectedDocuments).toBe(4);
    expect(result.capacitySufficient).toBe(false);
    expect(result.capacityShortfall).toBe(2);
    expect(result.metadata.capacity.sufficient).toBe(false);
    expect(result.metadata.capacity.notice).toContain(
      "禁止声称已建立 6 份严格盲测集",
    );
    expect(fs.existsSync(options.outputManifestPath)).toBe(true);
    expect(fs.existsSync(options.outputMappingPath)).toBe(true);
    expect(fs.existsSync(options.outputMetadataPath)).toBe(true);
  });

  it("历史 consumed（已消耗）审计覆盖全部源合同时仍输出容量零和完整短缺", async () => {
    const options = buildOptions("zero-capacity", 5);
    const auditPath = path.join(temporaryRoot, "consumed-all.jsonl");
    fs.writeFileSync(
      auditPath,
      consumedAudit(
        sourceRows.map((item) => ({
          kind: "contract",
          sha256: item.sha256,
        })),
      ),
    );

    const result = await buildContractOcrFamilyIsolation({
      ...options,
      consumedAuditPaths: [auditPath],
    });

    expect(result.consumedAuditUniqueDocuments).toBe(9);
    expect(result.directlyExcludedDocuments).toBe(9);
    expect(result.eligibleDocuments).toBe(0);
    expect(result.eligibleFamilies).toBe(0);
    expect(result.selectedDocuments).toBe(0);
    expect(result.capacitySufficient).toBe(false);
    expect(result.capacityShortfall).toBe(5);
    expect(result.metadata.capacity.notice).toContain("只有 0 个可用合同族");
    expect(fs.existsSync(options.outputManifestPath)).toBe(true);
    expect(fs.existsSync(options.outputMappingPath)).toBe(true);
    expect(fs.existsSync(options.outputMetadataPath)).toBe(true);
  });

  it("使用完整私有注册表将主合同及各类协议整族归并，并从 130 份候选确定性冻结恰好 100 份", async () => {
    const historicalMain = row(
      "strict-history-main",
      "国网海淀/既有项目甲/1-主合同-既有项目甲.pdf",
    );
    const historicalChange = row(
      "strict-history-change",
      "国网海淀/既有项目甲/2-变更协议-既有项目甲.pdf",
      "补充协议",
    );
    const stage9Consumed = row(
      "strict-stage9",
      "国网海淀/既有项目乙/1-核减协议-既有项目乙.pdf",
      "解除或终止协议",
    );
    const cleanMainRows = Array.from({ length: 120 }, (_, index) =>
      row(
        `strict-clean-main-${index}`,
        `国网海淀/新盲测项目${String(index).padStart(3, "0")}/1-主合同-新盲测项目${String(index).padStart(3, "0")}.pdf`,
      ),
    );
    const cleanAgreementRows = Array.from({ length: 10 }, (_, index) =>
      row(
        `strict-clean-agreement-${index}`,
        `国网海淀/新盲测项目${String(index).padStart(3, "0")}/2-${
          index % 3 === 0
            ? "补充协议"
            : index % 3 === 1
              ? "变更协议"
              : "核减协议"
        }-新盲测项目${String(index).padStart(3, "0")}.pdf`,
        index % 3 === 2 ? "解除或终止协议" : "补充协议",
      ),
    );
    const strictRows = [
      historicalMain,
      historicalChange,
      stage9Consumed,
      ...cleanMainRows,
      ...cleanAgreementRows,
    ];
    const inventoryPath = path.join(temporaryRoot, "strict-inventory.tsv");
    const historicalPath = path.join(temporaryRoot, "strict-history.tsv");
    const stage9Path = path.join(temporaryRoot, "strict-stage9.tsv");
    const consumedPath = path.join(temporaryRoot, "strict-consumed.jsonl");
    const registryPath = path.join(temporaryRoot, "strict-family-registry.tsv");
    fs.writeFileSync(inventoryPath, manifest(strictRows));
    fs.writeFileSync(historicalPath, manifest([historicalMain]));
    fs.writeFileSync(stage9Path, manifest([stage9Consumed]));
    fs.writeFileSync(
      consumedPath,
      consumedAudit([{ kind: "contract", sha256: historicalMain.sha256 }]),
    );
    fs.writeFileSync(
      registryPath,
      privateFamilyRegistry([
        {
          row: historicalMain,
          familyId: "PRIVATE-HISTORY-A",
          relationType: "main",
        },
        {
          row: historicalChange,
          familyId: "PRIVATE-HISTORY-A",
          relationType: "change",
        },
        {
          row: stage9Consumed,
          familyId: "PRIVATE-HISTORY-B",
          relationType: "reduction",
        },
        ...cleanMainRows.map((item, index) => ({
          row: item,
          familyId: `PRIVATE-BLIND-${String(index).padStart(3, "0")}`,
          relationType: "main" as const,
        })),
        ...cleanAgreementRows.map((item, index) => ({
          row: item,
          familyId: `PRIVATE-BLIND-${String(index).padStart(3, "0")}`,
          relationType: (index % 3 === 0
            ? "supplement"
            : index % 3 === 1
              ? "change"
              : "reduction") as "supplement" | "change" | "reduction",
        })),
      ]),
    );

    const strictOptions: ContractOcrFamilyIsolationOptions = {
      inventoryPath,
      exclusionManifestPaths: [historicalPath, stage9Path],
      consumedAuditPaths: [consumedPath],
      privateFamilyRegistryPath: registryPath,
      outputManifestPath: path.join(temporaryRoot, "strict-frozen.tsv"),
      outputMappingPath: path.join(temporaryRoot, "strict-mapping.tsv"),
      outputMetadataPath: path.join(temporaryRoot, "strict-public.json"),
      targetSize: 100,
      seed: "stage10-strict-fixed-seed-v1",
      datasetVersion: "stage10-strict-synthetic-v1",
      sampleIdPrefix: "CTR-STAGE10-BLIND",
      blindFreeze: {
        outputCandidateManifestPath: path.join(
          temporaryRoot,
          "strict-candidates.tsv",
        ),
        outputLineagePath: path.join(temporaryRoot, "strict-lineage.json"),
        minimumCandidateDocuments: 120,
        maximumCandidateDocuments: 140,
      },
    };
    const result = await buildContractOcrFamilyIsolation(strictOptions);

    expect(result.candidatePoolDocuments).toBe(130);
    expect(result.eligibleFamilies).toBe(120);
    expect(result.selectedDocuments).toBe(100);
    expect(result.additionallyExcludedByFamily).toBe(1);
    expect(result.metadata.blindFreeze).toEqual({
      status: "frozen",
      exactTargetRequired: true,
      minimumCandidateDocuments: 120,
      maximumCandidateDocuments: 140,
      candidateDocuments: 130,
      candidateFamilies: 120,
      frozenDocuments: 100,
    });
    expect(
      fs
        .readFileSync(
          strictOptions.blindFreeze!.outputCandidateManifestPath,
          "utf8",
        )
        .trimEnd()
        .split("\n"),
    ).toHaveLength(131);
    expect(
      fs
        .readFileSync(strictOptions.outputManifestPath, "utf8")
        .trimEnd()
        .split("\n"),
    ).toHaveLength(101);
    expect(
      fs.statSync(strictOptions.blindFreeze!.outputCandidateManifestPath).mode &
        0o777,
    ).toBe(0o600);
    expect(
      fs.statSync(strictOptions.blindFreeze!.outputLineagePath).mode & 0o777,
    ).toBe(0o600);
    const lineage = JSON.parse(
      fs.readFileSync(strictOptions.blindFreeze!.outputLineagePath, "utf8"),
    ) as {
      inputs: { inventorySha256: string };
      outputs: {
        candidateManifestSha256: string;
        finalManifestSha256: string;
        mappingSha256: string;
      };
    };
    expect(lineage.inputs.inventorySha256).toBe(
      createHash("sha256")
        .update(fs.readFileSync(strictOptions.inventoryPath))
        .digest("hex"),
    );
    expect(lineage.outputs.candidateManifestSha256).toBe(
      createHash("sha256")
        .update(
          fs.readFileSync(
            strictOptions.blindFreeze!.outputCandidateManifestPath,
          ),
        )
        .digest("hex"),
    );
    expect(lineage.outputs.finalManifestSha256).toBe(
      createHash("sha256")
        .update(fs.readFileSync(strictOptions.outputManifestPath))
        .digest("hex"),
    );
    expect(lineage.outputs.mappingSha256).toBe(
      createHash("sha256")
        .update(fs.readFileSync(strictOptions.outputMappingPath))
        .digest("hex"),
    );
    const mapping = parsePrivateMapping(strictOptions.outputMappingPath);
    const selected = mapping.filter((item) => item.state === "已选择");
    expect(selected).toHaveLength(100);
    expect(new Set(selected.map((item) => item.familyId)).size).toBe(100);
    expect(
      selected.every(
        (item, index) =>
          item.sampleId.startsWith("CTR-STAGE10-BLIND-") && index < 100,
      ),
    ).toBe(true);
    expect(
      mapping.find((item) => item.sha256 === historicalChange.sha256)?.state,
    ).toBe("整族传播排除");
    expect(
      mapping.find((item) => item.sha256 === historicalChange.sha256)
        ?.relationType,
    ).toBe("change");

    const publicText = fs.readFileSync(
      strictOptions.outputMetadataPath,
      "utf8",
    );
    expect(publicText).not.toContain("PRIVATE-HISTORY");
    expect(publicText).not.toContain("PRIVATE-BLIND");
    expect(publicText).not.toContain(historicalMain.relativePath);
    expect(publicText).not.toContain(historicalMain.sha256);
    expect(publicText).not.toMatch(/[a-f0-9]{64}/u);

    const reversedInventoryPath = path.join(
      temporaryRoot,
      "strict-inventory-reversed.tsv",
    );
    const reversedRegistryPath = path.join(
      temporaryRoot,
      "strict-family-registry-reversed.tsv",
    );
    fs.writeFileSync(
      reversedInventoryPath,
      manifest([...strictRows].reverse()),
    );
    const registryLines = fs
      .readFileSync(registryPath, "utf8")
      .trimEnd()
      .split("\n");
    fs.writeFileSync(
      reversedRegistryPath,
      `${registryLines[0]}\n${registryLines.slice(1).reverse().join("\n")}\n`,
    );
    const reversedOptions: ContractOcrFamilyIsolationOptions = {
      ...strictOptions,
      inventoryPath: reversedInventoryPath,
      exclusionManifestPaths: [
        ...strictOptions.exclusionManifestPaths,
      ].reverse(),
      privateFamilyRegistryPath: reversedRegistryPath,
      outputManifestPath: path.join(
        temporaryRoot,
        "strict-frozen-reversed.tsv",
      ),
      outputMappingPath: path.join(
        temporaryRoot,
        "strict-mapping-reversed.tsv",
      ),
      outputMetadataPath: path.join(
        temporaryRoot,
        "strict-public-reversed.json",
      ),
      blindFreeze: {
        ...strictOptions.blindFreeze!,
        outputCandidateManifestPath: path.join(
          temporaryRoot,
          "strict-candidates-reversed.tsv",
        ),
        outputLineagePath: path.join(
          temporaryRoot,
          "strict-lineage-reversed.json",
        ),
      },
    };
    await buildContractOcrFamilyIsolation(reversedOptions);
    expect(fs.readFileSync(strictOptions.outputManifestPath, "utf8")).toBe(
      fs.readFileSync(reversedOptions.outputManifestPath, "utf8"),
    );
    expect(fs.readFileSync(strictOptions.outputMappingPath, "utf8")).toBe(
      fs.readFileSync(reversedOptions.outputMappingPath, "utf8"),
    );
    expect(fs.readFileSync(strictOptions.outputMetadataPath, "utf8")).toBe(
      fs.readFileSync(reversedOptions.outputMetadataPath, "utf8"),
    );
    expect(
      fs.readFileSync(
        strictOptions.blindFreeze!.outputCandidateManifestPath,
        "utf8",
      ),
    ).toBe(
      fs.readFileSync(
        reversedOptions.blindFreeze!.outputCandidateManifestPath,
        "utf8",
      ),
    );
  });

  it("严格冻结拒绝缺失或覆盖不完整的私有合同族注册表", async () => {
    const options = buildOptions("strict-registry-required", 3);
    const consumedPath = path.join(temporaryRoot, "strict-required.jsonl");
    fs.writeFileSync(
      consumedPath,
      consumedAudit([{ kind: "contract", sha256: sourceRows[0].sha256 }]),
    );
    const blindFreeze = {
      outputCandidateManifestPath: path.join(
        temporaryRoot,
        "strict-required-candidates.tsv",
      ),
      outputLineagePath: path.join(
        temporaryRoot,
        "strict-required-lineage.json",
      ),
      minimumCandidateDocuments: 3,
      maximumCandidateDocuments: 9,
    };
    await expect(
      buildContractOcrFamilyIsolation({
        ...options,
        consumedAuditPaths: [consumedPath],
        blindFreeze,
      }),
    ).rejects.toThrow("必须提供私有合同族注册表");

    const incompleteRegistryPath = path.join(
      temporaryRoot,
      "strict-incomplete-registry.tsv",
    );
    fs.writeFileSync(
      incompleteRegistryPath,
      privateFamilyRegistry([
        {
          row: sourceRows[0],
          familyId: "PRIVATE-INCOMPLETE",
          relationType: "main",
        },
      ]),
    );
    await expect(
      buildContractOcrFamilyIsolation({
        ...options,
        consumedAuditPaths: [consumedPath],
        privateFamilyRegistryPath: incompleteRegistryPath,
        blindFreeze,
      }),
    ).rejects.toThrow("未完整覆盖源库存");
  });

  it("历史 consumed（已消耗）审计包含源库存集合外摘要时拒绝构建", async () => {
    const options = buildOptions("outside-consumed", 3);
    const auditPath = path.join(temporaryRoot, "consumed-outside.jsonl");
    fs.writeFileSync(
      auditPath,
      consumedAudit([{ kind: "contract", sha256: digest("集合外合同") }]),
    );

    await expect(
      buildContractOcrFamilyIsolation({
        ...options,
        consumedAuditPaths: [auditPath],
      }),
    ).rejects.toThrow("不属于当前源库存的文档摘要");
  });

  it("少于两个排除清单或集合外排除记录时拒绝构建", async () => {
    const options = buildOptions("invalid", 3);
    await expect(
      buildContractOcrFamilyIsolation({
        ...options,
        exclusionManifestPaths: options.exclusionManifestPaths.slice(0, 1),
      }),
    ).rejects.toThrow("至少需要两个排除清单");

    const outsidePath = path.join(temporaryRoot, "outside.tsv");
    fs.writeFileSync(
      outsidePath,
      manifest([
        row("outside", "国网海淀/未进入库存的合同/1-技术服务合同-未知项目.pdf"),
      ]),
    );
    await expect(
      buildContractOcrFamilyIsolation({
        ...options,
        exclusionManifestPaths: [
          options.exclusionManifestPaths[0],
          outsidePath,
        ],
      }),
    ).rejects.toThrow("不属于当前源库存");
  });
});
