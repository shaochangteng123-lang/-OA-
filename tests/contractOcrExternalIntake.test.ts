/** @jest-environment node */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  CONTRACT_OCR_EXTERNAL_REGISTRY_HEADER,
  prepareContractOcrExternalIntake,
} from "../server/scripts/lib/contractOcrExternalIntake";

const FROZEN_MODEL = "v6_medium";
const FROZEN_RULES = "contract-rules-sha256-2209a00b3e57e913";
const FROZEN_AUTOMATIC_POLICY = "highest-qualified-candidate-v3";

interface RegistryEntry {
  relativePath: string;
  sha256: string;
  familyId: string;
  instrumentId: string;
  role: "main" | "supplement" | "change";
  executionState: "final_signed";
  parentInstrumentId?: string;
  versionGroupId: string;
  versionOrder: number;
  finalRepresentative: boolean;
}

interface PreparedInputs {
  inputRoot: string;
  outputRoot: string;
  historyConfigPath: string;
  baselinePath: string;
  familyRegistryPath: string;
  workspaceRoot: string;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

function writePrivateFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

async function createBasePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  document.setTitle("合成合同结构测试文件");
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function uniquePdf(basePdf: Buffer, marker: string): Buffer {
  return Buffer.concat([
    basePdf,
    Buffer.from(`\n% external-intake-test:${marker}\n`, "utf8"),
  ]);
}

function writePdf(
  inputRoot: string,
  relativePath: string,
  content: Buffer,
): string {
  const absolutePath = path.join(inputRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return sha256(content);
}

function registryContent(entries: readonly RegistryEntry[]): string {
  const rows = entries.map((entry) =>
    [
      entry.relativePath,
      entry.sha256,
      entry.familyId,
      entry.instrumentId,
      entry.role,
      entry.executionState,
      entry.parentInstrumentId || "",
      entry.versionGroupId,
      String(entry.versionOrder),
      entry.finalRepresentative ? "是" : "否",
      "SYNTHETIC-EXTERNAL-BATCH",
      "自动化测试责任人",
    ].join("\t"),
  );
  return `${CONTRACT_OCR_EXTERNAL_REGISTRY_HEADER}\n${rows.join("\n")}\n`;
}

function writeBaseline(root: string): string {
  const controlledFixturePath = path.join(
    root,
    "frozen-controlled-fixture.txt",
  );
  writePrivateFile(
    controlledFixturePath,
    "冻结实现夹具，不允许导入流程修改。\n",
  );
  const controlledFixtureDigest = sha256(
    fs.readFileSync(controlledFixturePath),
  );
  const baselinePath = path.join(root, "frozen-baseline.json");
  writePrivateFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        baselineId: "contract-ocr-stage10-baseline-synthetic-test",
        immutable: true,
        versions: {
          ocrModel: FROZEN_MODEL,
          paddleOcrVersion: "3.5.0",
          rulesVersion: FROZEN_RULES,
          automaticPolicyVersion: FROZEN_AUTOMATIC_POLICY,
          implementationDigest: sha256("synthetic-implementation-digest"),
          evaluationDigest: sha256("synthetic-evaluation-digest"),
        },
        implementation: {
          files: [
            {
              role: "synthetic_controlled_fixture",
              relativePath: path.basename(controlledFixturePath),
              sha256: controlledFixtureDigest,
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  return baselinePath;
}

function writeHistoryConfiguration(
  root: string,
  exposedDigests: readonly string[],
): string {
  const historyPath = path.join(root, "history.jsonl");
  writePrivateFile(
    historyPath,
    exposedDigests
      .map((digest, index) =>
        JSON.stringify({
          kind: "contract",
          sha256: digest,
          familyId: `SYNTHETIC-HISTORY-FAMILY-${index + 1}`,
          instrumentId: `SYNTHETIC-HISTORY-INSTRUMENT-${index + 1}`,
        }),
      )
      .join("\n") + (exposedDigests.length > 0 ? "\n" : ""),
  );
  const configurationPath = path.join(root, "history-config.json");
  writePrivateFile(
    configurationPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        familyIdentityNamespace: "SYNTHETIC-EXTERNAL-BATCH",
        familyIdentityCoverage: "complete",
        sources: [
          {
            sourceId: "synthetic-history-audit",
            kind: "audit_jsonl",
            path: historyPath,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return configurationPath;
}

function writeRegistry(
  root: string,
  entries: readonly RegistryEntry[],
): string {
  const registryPath = path.join(root, "family-registry.tsv");
  writePrivateFile(registryPath, registryContent(entries));
  return registryPath;
}

function createPreparedInputs(
  root: string,
  familyRegistryPath: string,
  historyConfigPath: string,
): PreparedInputs {
  const inputRoot = path.join(root, "external-contracts");
  fs.mkdirSync(inputRoot, { recursive: true });
  return {
    inputRoot,
    outputRoot: path.join(root, "private-output"),
    historyConfigPath,
    baselinePath: writeBaseline(root),
    familyRegistryPath,
    workspaceRoot: root,
  };
}

function assertPrivateTreePermissions(root: string): void {
  expect(mode(root)).toBe(0o700);
  const pending = [root];
  let fileCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        expect(mode(entryPath)).toBe(0o700);
        pending.push(entryPath);
      } else {
        expect(entry.isFile()).toBe(true);
        expect(mode(entryPath)).toBe(0o600);
        fileCount += 1;
      }
    }
  }
  expect(fileCount).toBeGreaterThan(0);
}

async function createIndependentFamilies(
  inputRoot: string,
  basePdf: Buffer,
  count: number,
): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const ordinal = String(index + 1).padStart(3, "0");
    const relativePath = `合同族-${ordinal}/最终签署主合同-${ordinal}.pdf`;
    const digest = writePdf(
      inputRoot,
      relativePath,
      uniquePdf(basePdf, `independent-family-${ordinal}`),
    );
    entries.push({
      relativePath,
      sha256: digest,
      familyId: `EXT-FAMILY-${ordinal}`,
      instrumentId: `EXT-INSTRUMENT-${ordinal}`,
      role: "main",
      executionState: "final_signed",
      versionGroupId: `EXT-VERSION-${ordinal}`,
      versionOrder: 1,
      finalRepresentative: true,
    });
  }
  return entries;
}

describe("合同 OCR（光学字符识别）外部盲测数据导入准备", () => {
  jest.setTimeout(120_000);

  let temporaryRoot: string;
  let basePdf: Buffer;

  beforeAll(async () => {
    basePdf = await createBasePdf();
  });

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-ocr-external-intake-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("155个候选合同族中5族历史曝光后保留150族，并保持基线和私有权限不变", async () => {
    const inputRoot = path.join(temporaryRoot, "external-contracts");
    fs.mkdirSync(inputRoot, { recursive: true });
    const entries = await createIndependentFamilies(inputRoot, basePdf, 155);
    const registryPath = writeRegistry(temporaryRoot, entries);
    const historyConfigPath = writeHistoryConfiguration(
      temporaryRoot,
      entries.slice(0, 5).map((entry) => entry.sha256),
    );
    const inputs = createPreparedInputs(
      temporaryRoot,
      registryPath,
      historyConfigPath,
    );
    expect(inputs.inputRoot).toBe(inputRoot);
    const baselineBefore = sha256(fs.readFileSync(inputs.baselinePath));
    const originalOcrModel = process.env.OCR_MODEL;

    const result = await prepareContractOcrExternalIntake({
      ...inputs,
      sourceId: "synthetic-155-families",
      minimumFinalFamilies: 150,
      nativeTextMode: "off",
    });

    expect(result.summary.counts).toEqual(
      expect.objectContaining({
        scannedFiles: 155,
        uniqueDocuments: 155,
        candidateFamiliesBeforeExposure: 155,
        exposureExcludedFamilies: 5,
        unresolvedFamilies: 0,
        finalBlindCandidateFamilies: 150,
      }),
    );
    expect(result.summary.target).toEqual(
      expect.objectContaining({ met: true, shortfall: 0 }),
    );
    expect(sha256(fs.readFileSync(inputs.baselinePath))).toBe(baselineBefore);
    expect(process.env.OCR_MODEL).toBe(originalOcrModel);
    assertPrivateTreePermissions(inputs.outputRoot);
  });

  it("149个合格合同族只报告容量差1族，不冒充达到150族目标", async () => {
    const inputRoot = path.join(temporaryRoot, "external-contracts");
    fs.mkdirSync(inputRoot, { recursive: true });
    const entries = await createIndependentFamilies(inputRoot, basePdf, 149);
    const registryPath = writeRegistry(temporaryRoot, entries);
    const historyConfigPath = writeHistoryConfiguration(temporaryRoot, [
      sha256("outside-current-import-history-evidence"),
    ]);
    const inputs = createPreparedInputs(
      temporaryRoot,
      registryPath,
      historyConfigPath,
    );

    const result = await prepareContractOcrExternalIntake({
      ...inputs,
      sourceId: "synthetic-149-families",
      minimumFinalFamilies: 150,
      nativeTextMode: "off",
    });

    expect(result.summary.counts).toEqual(
      expect.objectContaining({
        scannedFiles: 149,
        uniqueDocuments: 149,
        candidateFamiliesBeforeExposure: 149,
        exposureExcludedFamilies: 0,
        unresolvedFamilies: 0,
        finalBlindCandidateFamilies: 149,
      }),
    );
    expect(result.summary.target).toEqual(
      expect.objectContaining({ met: false, shortfall: 1 }),
    );
    assertPrivateTreePermissions(inputs.outputRoot);
  });

  it("同族主合同、补充协议、变更协议及精确重复只形成一个合同族，并整族传播历史曝光", async () => {
    const inputRoot = path.join(temporaryRoot, "external-contracts");
    fs.mkdirSync(inputRoot, { recursive: true });
    const mainContent = uniquePdf(basePdf, "family-a-main");
    const familyA: RegistryEntry[] = [
      {
        relativePath: "项目甲/最终签署主合同.pdf",
        sha256: writePdf(inputRoot, "项目甲/最终签署主合同.pdf", mainContent),
        familyId: "EXT-FAMILY-A",
        instrumentId: "EXT-A-MAIN",
        role: "main",
        executionState: "final_signed",
        versionGroupId: "EXT-A-MAIN-VERSION",
        versionOrder: 1,
        finalRepresentative: true,
      },
      {
        relativePath: "项目甲/主合同扫描副本.pdf",
        sha256: writePdf(inputRoot, "项目甲/主合同扫描副本.pdf", mainContent),
        familyId: "EXT-FAMILY-A",
        instrumentId: "EXT-A-MAIN",
        role: "main",
        executionState: "final_signed",
        versionGroupId: "EXT-A-MAIN-VERSION",
        versionOrder: 1,
        finalRepresentative: false,
      },
      {
        relativePath: "项目甲/补充协议.pdf",
        sha256: writePdf(
          inputRoot,
          "项目甲/补充协议.pdf",
          uniquePdf(basePdf, "family-a-supplement"),
        ),
        familyId: "EXT-FAMILY-A",
        instrumentId: "EXT-A-SUPPLEMENT",
        role: "supplement",
        executionState: "final_signed",
        parentInstrumentId: "EXT-A-MAIN",
        versionGroupId: "EXT-A-SUPPLEMENT-VERSION",
        versionOrder: 1,
        finalRepresentative: false,
      },
      {
        relativePath: "项目甲/变更协议.pdf",
        sha256: writePdf(
          inputRoot,
          "项目甲/变更协议.pdf",
          uniquePdf(basePdf, "family-a-change"),
        ),
        familyId: "EXT-FAMILY-A",
        instrumentId: "EXT-A-CHANGE",
        role: "change",
        executionState: "final_signed",
        parentInstrumentId: "EXT-A-MAIN",
        versionGroupId: "EXT-A-CHANGE-VERSION",
        versionOrder: 1,
        finalRepresentative: false,
      },
    ];
    const familyBContent = uniquePdf(basePdf, "family-b-main");
    const familyB: RegistryEntry = {
      relativePath: "项目乙/最终签署主合同.pdf",
      sha256: writePdf(inputRoot, "项目乙/最终签署主合同.pdf", familyBContent),
      familyId: "EXT-FAMILY-B",
      instrumentId: "EXT-B-MAIN",
      role: "main",
      executionState: "final_signed",
      versionGroupId: "EXT-B-MAIN-VERSION",
      versionOrder: 1,
      finalRepresentative: true,
    };
    const entries = [...familyA, familyB];
    const registryPath = writeRegistry(temporaryRoot, entries);
    const historyConfigPath = writeHistoryConfiguration(temporaryRoot, [
      familyA[2].sha256,
    ]);
    const inputs = createPreparedInputs(
      temporaryRoot,
      registryPath,
      historyConfigPath,
    );

    const result = await prepareContractOcrExternalIntake({
      ...inputs,
      sourceId: "synthetic-family-relations",
      minimumFinalFamilies: 1,
      nativeTextMode: "off",
    });

    expect(result.summary.counts).toEqual(
      expect.objectContaining({
        scannedFiles: 5,
        uniqueDocuments: 4,
        candidateFamiliesBeforeExposure: 2,
        exposureExcludedFamilies: 1,
        unresolvedFamilies: 0,
        finalBlindCandidateFamilies: 1,
      }),
    );
    expect(result.summary.target).toEqual(
      expect.objectContaining({ met: true, shortfall: 0 }),
    );
  });

  it("离线导入服务不依赖识别引擎或子进程模块", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/lib/contractOcrExternalIntake.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:ocrDaemon|paddle_ocr_worker|localOcr|contractOcr\.js)["']/u,
    );
    expect(source).not.toMatch(/from\s+["']node:child_process["']/u);
    expect(source).not.toMatch(
      /\b(?:spawn|spawnSync|exec|execFile|fork)\s*\(/u,
    );
    expect(source).not.toMatch(/\b(?:PaddleOCR|Tesseract)\s*\(/u);
  });
});
