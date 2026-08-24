import path from "node:path";
import { CONTRACT_OCR_AUTOMATIC_POLICY_VERSION } from "../services/contractService.js";
import { resolvePaddleOcrModel } from "../services/ocrDaemon.js";
import {
  createContractOcrStage10Baseline,
  createContractOcrStage10Freeze,
  readContractOcrStage10Baseline,
  readContractOcrStage10Freeze,
  verifyContractOcrStage10Baseline,
  verifyContractOcrStage10Freeze,
  writePrivateImmutableJson,
  type ContractOcrStage10FreezeOptions,
} from "../services/contractOcrStage10Blind.js";

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
    if (argument.startsWith(prefix)) values.push(argument.slice(prefix.length));
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

function privateOutputPath(value: string): string {
  const resolved = path.resolve(value);
  const privateRoot = path.resolve(
    process.cwd(),
    "debug/contract-ocr-stage10-private",
  );
  if (!resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(
      "第十阶段私有冻结文件只能写入 debug/contract-ocr-stage10-private 目录",
    );
  }
  return resolved;
}

function freezeOptions(): ContractOcrStage10FreezeOptions {
  const datasetVersion = optionValue("--dataset-version");
  if (!datasetVersion)
    throw new Error("必须提供 --dataset-version（数据集版本）");
  return {
    projectRoot: process.cwd(),
    baselinePath: requiredPath("--baseline"),
    inventoryPath: requiredPath("--inventory"),
    candidateManifestPath: requiredPath("--candidate-manifest"),
    finalManifestPath: requiredPath("--final-manifest"),
    mappingPath: requiredPath("--mapping"),
    groundTruthPath: requiredPath("--ground-truth"),
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
}

function main(): void {
  const baselineOutput = optionValue("--baseline-output");
  const baselineVerify = optionValue("--verify-baseline");
  if (baselineOutput || baselineVerify) {
    const baselineOptions = {
      projectRoot: process.cwd(),
      automaticPolicyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
      configuredOcrModel: resolvePaddleOcrModel(),
    };
    if (baselineVerify) {
      const baseline = readContractOcrStage10Baseline(
        path.resolve(baselineVerify),
      );
      verifyContractOcrStage10Baseline(baseline, baselineOptions);
      console.log(`第十阶段版本基线校验通过：${baseline.baselineId}`);
      return;
    }
    const baseline = createContractOcrStage10Baseline(baselineOptions);
    writePrivateImmutableJson(privateOutputPath(baselineOutput!), baseline);
    console.log(
      `第十阶段数据无关版本基线已冻结：${baseline.baselineId}，输出权限为 0600。`,
    );
    return;
  }
  const options = freezeOptions();
  const verifyPath = optionValue("--verify");
  if (verifyPath) {
    const freeze = readContractOcrStage10Freeze(path.resolve(verifyPath));
    verifyContractOcrStage10Freeze(freeze, options);
    console.log(
      `第十阶段冻结校验通过：${freeze.freezeId}，规则版本 ${freeze.versions.rulesVersion}，自动采用策略 ${freeze.versions.automaticPolicyVersion}`,
    );
    return;
  }

  const outputPath = privateOutputPath(requiredPath("--output"));
  const freeze = createContractOcrStage10Freeze(options);
  writePrivateImmutableJson(outputPath, freeze);
  console.log(
    `第十阶段已冻结 ${freeze.blindSet.count} 份合同、${freeze.blindSet.uniqueFamilyCount} 个合同族；冻结编号 ${freeze.freezeId}，输出权限为 0600。`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
