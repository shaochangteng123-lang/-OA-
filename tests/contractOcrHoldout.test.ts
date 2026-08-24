/** @jest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  buildContractOcrHoldout,
  pageBucketFor,
} from "../server/services/contractOcrHoldout";

const HEADER = "行政区\t分类\t状态\t扩展名\t字节数\tSHA256\t相对路径";

interface FixtureRow {
  region: string;
  category: string;
  status: string;
  extension: string;
  content: Uint8Array;
  relativePath: string;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function pdfBytes(label: string, pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(label);
  for (let index = 0; index < pages; index += 1) pdf.addPage();
  return pdf.save({ useObjectStreams: false });
}

function manifestContent(rows: FixtureRow[]): string {
  return `${HEADER}\n${rows
    .map((row) =>
      [
        row.region,
        row.category,
        row.status,
        row.extension,
        String(row.content.byteLength),
        sha256(row.content),
        row.relativePath,
      ].join("\t"),
    )
    .join("\n")}\n`;
}

describe("合同 OCR（光学字符识别）确定性留出集", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-ocr-holdout-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("排除冻结摘要和精确重复，且打乱输入后双产物保持一致", async () => {
    const inputRoot = path.join(temporaryRoot, "input");
    fs.mkdirSync(inputRoot, { recursive: true });
    const frozen: FixtureRow = {
      region: "国网丰台",
      category: "主合同或其他合同",
      status: "正常或未标注",
      extension: "pdf",
      content: await pdfBytes("冻结样本", 2),
      relativePath: "机密冻结合同.pdf",
    };
    const firstCandidate: FixtureRow = {
      region: "国网朝阳",
      category: "主合同或其他合同",
      status: "正常或未标注",
      extension: "pdf",
      content: await pdfBytes("候选一", 2),
      relativePath: "机密候选一.pdf",
    };
    const candidates: FixtureRow[] = [
      firstCandidate,
      {
        region: "国网朝阳",
        category: "主合同或其他合同",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选二", 7),
        relativePath: "机密候选二.pdf",
      },
      {
        region: "国网朝阳",
        category: "补充协议",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选三", 7),
        relativePath: "机密候选三.pdf",
      },
      {
        region: "国网海淀",
        category: "主合同或其他合同",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选四", 12),
        relativePath: "机密候选四.pdf",
      },
      {
        region: "国网海淀",
        category: "补充协议",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选五", 3),
        relativePath: "机密候选五.pdf",
      },
      {
        region: "国网海淀",
        category: "解除或终止协议",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选六", 8),
        relativePath: "机密候选六.pdf",
      },
      {
        region: "国网门头沟",
        category: "主合同或其他合同",
        status: "正常或未标注",
        extension: "pdf",
        content: await pdfBytes("候选七", 13),
        relativePath: "机密候选七.pdf",
      },
      {
        region: "国网朝阳",
        category: "主合同或其他合同",
        status: "正常或未标注",
        extension: "docx",
        content: Buffer.from("唯一的合成文档内容", "utf8"),
        relativePath: "机密候选八.docx",
      },
    ];
    const duplicate: FixtureRow = {
      ...firstCandidate,
      relativePath: "机密候选一副本.pdf",
    };
    const sourceRows = [frozen, ...candidates, duplicate];
    for (const row of sourceRows) {
      fs.writeFileSync(path.join(inputRoot, row.relativePath), row.content);
    }

    const inventoryA = path.join(temporaryRoot, "inventory-a.tsv");
    const inventoryB = path.join(temporaryRoot, "inventory-b.tsv");
    const frozenManifest = path.join(temporaryRoot, "frozen.tsv");
    fs.writeFileSync(inventoryA, manifestContent(sourceRows));
    fs.writeFileSync(inventoryB, manifestContent([...sourceRows].reverse()));
    fs.writeFileSync(frozenManifest, manifestContent([frozen]));

    const outputManifestA = path.join(temporaryRoot, "private-a.tsv");
    const outputMetadataA = path.join(temporaryRoot, "anonymous-a.json");
    const outputManifestB = path.join(temporaryRoot, "private-b.tsv");
    const outputMetadataB = path.join(temporaryRoot, "anonymous-b.json");
    const common = {
      frozenManifestPath: frozenManifest,
      inputRoot,
      targetSize: 8,
      seed: "fixed-holdout-seed-v1",
      datasetVersion: "synthetic-holdout-v1",
      expectedCandidateCount: 8,
    };
    const first = await buildContractOcrHoldout({
      ...common,
      inventoryPath: inventoryA,
      outputManifestPath: outputManifestA,
      outputMetadataPath: outputMetadataA,
    });
    const second = await buildContractOcrHoldout({
      ...common,
      inventoryPath: inventoryB,
      outputManifestPath: outputManifestB,
      outputMetadataPath: outputMetadataB,
    });

    expect(first.selectedCount).toBe(8);
    expect(first.candidateCount).toBe(8);
    expect(first.sourceContractCount).toBe(10);
    expect(first.sourceUniqueContractCount).toBe(9);
    expect(first.exactDuplicateRowsExcluded).toBe(1);
    expect(first.selectedSha256).not.toContain(sha256(frozen.content));
    expect(first.selectedSha256).toEqual(second.selectedSha256);
    expect(fs.readFileSync(outputManifestA, "utf8")).toBe(
      fs.readFileSync(outputManifestB, "utf8"),
    );
    expect(fs.readFileSync(outputMetadataA, "utf8")).toBe(
      fs.readFileSync(outputMetadataB, "utf8"),
    );

    const manifestLines = fs
      .readFileSync(outputManifestA, "utf8")
      .trimEnd()
      .split("\n");
    expect(manifestLines[0]).toBe(HEADER);
    expect(manifestLines).toHaveLength(9);
    expect(
      manifestLines.slice(1).every((line) => line.split("\t").length === 7),
    ).toBe(true);
    expect(fs.statSync(outputManifestA).mode & 0o777).toBe(0o600);

    const anonymousText = fs.readFileSync(outputMetadataA, "utf8");
    const anonymous = JSON.parse(anonymousText);
    expect(anonymous.strictBlindHundredAvailable).toBe(false);
    expect(anonymous.selectionExcludedInputs).toEqual(
      expect.arrayContaining([
        "历史字段结果",
        "历史错误分类",
        "历史置信度",
        "人工真值",
      ]),
    );
    expect(anonymous.auditCompatibility.requiredRegions).toEqual([
      "国网朝阳",
      "国网海淀",
      "国网门头沟",
    ]);
    expect(anonymous.samples).toHaveLength(8);
    expect(anonymousText).not.toContain("relativePath");
    expect(anonymousText).not.toContain("机密候选");
    expect(anonymousText).not.toContain("机密冻结");
  });

  it("页数区间边界稳定且候选不足时拒绝声称百份盲测", async () => {
    expect(pageBucketFor(null)).toBe("页数不可用");
    expect(pageBucketFor(1)).toBe("1页");
    expect(pageBucketFor(5)).toBe("2-5页");
    expect(pageBucketFor(10)).toBe("6-10页");
    expect(pageBucketFor(20)).toBe("11-20页");
    expect(pageBucketFor(21)).toBe("21页以上");

    const inventory = path.join(temporaryRoot, "inventory.tsv");
    const frozen = path.join(temporaryRoot, "frozen.tsv");
    fs.writeFileSync(inventory, `${HEADER}\n`);
    fs.writeFileSync(frozen, `${HEADER}\n`);
    await expect(
      buildContractOcrHoldout({
        inventoryPath: inventory,
        frozenManifestPath: frozen,
        inputRoot: temporaryRoot,
        outputManifestPath: path.join(temporaryRoot, "private.tsv"),
        outputMetadataPath: path.join(temporaryRoot, "anonymous.json"),
        targetSize: 100,
        seed: "fixed-holdout-seed-v1",
        datasetVersion: "synthetic-holdout-v1",
      }),
    ).rejects.toThrow("不能声称已建立 100 份严格盲测集");
  });

  it("拒绝非合同冻结记录及不属于当前源集合的冻结摘要", async () => {
    const source: FixtureRow = {
      region: "国网海淀",
      category: "主合同或其他合同",
      status: "正常或未标注",
      extension: "pdf",
      content: await pdfBytes("当前源合同", 2),
      relativePath: "当前源合同.pdf",
    };
    const unrelatedFrozen: FixtureRow = {
      ...source,
      content: await pdfBytes("集合外冻结合同", 2),
      relativePath: "集合外冻结合同.pdf",
    };
    const inventory = path.join(temporaryRoot, "inventory.tsv");
    const frozen = path.join(temporaryRoot, "frozen.tsv");
    fs.writeFileSync(inventory, manifestContent([source]));
    fs.writeFileSync(frozen, manifestContent([unrelatedFrozen]));
    const options = {
      inventoryPath: inventory,
      frozenManifestPath: frozen,
      inputRoot: temporaryRoot,
      outputManifestPath: path.join(temporaryRoot, "private.tsv"),
      outputMetadataPath: path.join(temporaryRoot, "anonymous.json"),
      targetSize: 1,
      seed: "fixed-holdout-seed-v1",
      datasetVersion: "synthetic-holdout-v1",
    };

    await expect(buildContractOcrHoldout(options)).rejects.toThrow(
      "冻结清单存在不属于当前源合同集合的文件摘要",
    );

    fs.writeFileSync(
      frozen,
      manifestContent([
        {
          ...source,
          category: "发票源文件",
        },
      ]),
    );
    await expect(buildContractOcrHoldout(options)).rejects.toThrow(
      "冻结清单包含非合同记录",
    );
  });
});
