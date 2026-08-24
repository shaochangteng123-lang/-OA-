import path from "node:path";
import { CONTRACT_OCR_AUTOMATIC_POLICY_VERSION } from "../services/contractService.js";
import { resolvePaddleOcrModel } from "../services/ocrDaemon.js";
import {
  readContractOcrStage10Freeze,
  verifyContractOcrStage10Freeze,
  writePrivateImmutableJson,
  type ContractOcrStage10FreezeOptions,
} from "../services/contractOcrStage10Blind.js";
import { summarizeContractOcrStage10Metrics } from "../services/contractOcrStage10Metrics.js";

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    } else if (argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length));
    }
  }
  return values;
}

function optionValue(name: string): string | undefined {
  return optionValues(name)[0];
}

function requiredPath(name: string): string {
  const value = optionValue(name);
  if (!value) throw new Error(`必须提供 ${name}`);
  return path.resolve(value);
}

function requiredPrivateOutput(name: string): string {
  const outputPath = requiredPath(name);
  const privateRoot = path.resolve(
    process.cwd(),
    "debug/contract-ocr-stage10-private",
  );
  if (!outputPath.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(
      "第十阶段私有汇总只能写入 debug/contract-ocr-stage10-private 目录",
    );
  }
  return outputPath;
}

function main(): void {
  const freezePath = requiredPath("--freeze");
  const groundTruthPath = requiredPath("--ground-truth");
  const datasetVersion = optionValue("--dataset-version");
  if (!datasetVersion)
    throw new Error("必须提供 --dataset-version（数据集版本）");
  const verificationOptions: ContractOcrStage10FreezeOptions = {
    projectRoot: process.cwd(),
    baselinePath: requiredPath("--baseline"),
    inventoryPath: requiredPath("--inventory"),
    candidateManifestPath: requiredPath("--candidate-manifest"),
    finalManifestPath: requiredPath("--final-manifest"),
    mappingPath: requiredPath("--mapping"),
    groundTruthPath,
    familyIsolationMetadataPath: requiredPath("--family-isolation-metadata"),
    familyIsolationLineagePath: requiredPath("--family-lineage"),
    familyRegistryPath: requiredPath("--family-registry"),
    exclusionManifestPaths: optionValues("--exclude").map((value) =>
      path.resolve(value),
    ),
    consumedAuditPaths: optionValues("--consumed-audit").map((value) =>
      path.resolve(value),
    ),
    datasetVersion,
    automaticPolicyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
    configuredOcrModel: resolvePaddleOcrModel(),
  };
  const freeze = readContractOcrStage10Freeze(freezePath);
  verifyContractOcrStage10Freeze(freeze, verificationOptions);

  const inputPaths = optionValues("--input").map((value) =>
    path.resolve(value),
  );
  if (inputPaths.length === 0) {
    throw new Error("必须至少提供一个 --input（端到端证据分片）");
  }
  const summary = summarizeContractOcrStage10Metrics({
    freeze,
    groundTruthPath,
    e2eReportPaths: inputPaths,
  });
  writePrivateImmutableJson(requiredPrivateOutput("--output"), summary);
  console.log(
    `第十阶段 100 份盲测汇总完成：自动落库 ${summary.system.automaticDatabaseWrite.correct}/${summary.system.automaticDatabaseWrite.total}，生产门禁${summary.productionGate.ready ? "通过" : "未通过"}。`,
  );
  if (!summary.productionGate.ready) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
