import path from "node:path";
import { buildContractOcrFamilyIsolation } from "../services/contractOcrFamilyIsolation.js";

const DEFAULT_SEED = "contract-ocr-family-holdout-v1";
const DEFAULT_DATASET_VERSION = "contract-ocr-family-holdout-v1";

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

function positiveIntegerOption(name: string, fallback: number): number {
  const value = optionValue(name);
  if (value == null) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} 必须是正整数`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const strictFreeze = process.argv.includes("--strict-freeze");
  const exclusionManifestPaths = optionValues("--exclude").map((value) =>
    path.resolve(value),
  );
  const consumedAuditPaths = optionValues("--consumed-audit").map((value) =>
    path.resolve(value),
  );
  if (exclusionManifestPaths.length < 2) {
    throw new Error(
      "必须至少重复传入两次 --exclude，分别覆盖历史回归集和既有留出集",
    );
  }

  const privateRoot = path.resolve(
    optionValue("--private-root") ||
      path.join(
        projectRoot,
        "debug/contract-ocr-holdout-private/family-isolation-v1",
      ),
  );
  const privateFamilyRegistryValue = optionValue("--family-registry");
  const result = await buildContractOcrFamilyIsolation({
    inventoryPath: path.resolve(
      optionValue("--inventory") || "/tmp/合同四区盘点清单.tsv",
    ),
    exclusionManifestPaths,
    consumedAuditPaths,
    ...(privateFamilyRegistryValue
      ? { privateFamilyRegistryPath: path.resolve(privateFamilyRegistryValue) }
      : {}),
    outputManifestPath: path.resolve(
      optionValue("--output-manifest") ||
        path.join(privateRoot, "contract-ocr-family-holdout-manifest.tsv"),
    ),
    outputMappingPath: path.resolve(
      optionValue("--output-mapping") ||
        path.join(privateRoot, "contract-ocr-family-mapping.tsv"),
    ),
    outputMetadataPath: path.resolve(
      optionValue("--output-metadata") ||
        path.join(projectRoot, "debug/contract-ocr-family-holdout-public.json"),
    ),
    targetSize: positiveIntegerOption("--size", 50),
    seed: optionValue("--seed") || DEFAULT_SEED,
    datasetVersion: optionValue("--dataset-version") || DEFAULT_DATASET_VERSION,
    ...(optionValue("--sample-id-prefix")
      ? { sampleIdPrefix: optionValue("--sample-id-prefix") }
      : {}),
    ...(strictFreeze
      ? {
          blindFreeze: {
            outputCandidateManifestPath: path.resolve(
              optionValue("--output-candidates") ||
                path.join(
                  privateRoot,
                  "contract-ocr-family-candidate-pool.tsv",
                ),
            ),
            outputLineagePath: path.resolve(
              optionValue("--output-lineage") ||
                path.join(privateRoot, "contract-ocr-family-lineage.json"),
            ),
            minimumCandidateDocuments: positiveIntegerOption(
              "--candidate-min",
              120,
            ),
            maximumCandidateDocuments: positiveIntegerOption(
              "--candidate-max",
              140,
            ),
          },
        }
      : {}),
    overwrite: process.argv.includes("--overwrite"),
  });

  console.log(
    `合同族隔离完成：源合同 ${result.sourceUniqueDocuments} 份，历史 consumed（已消耗）审计覆盖 ${result.consumedAuditUniqueDocuments} 份，直接排除 ${result.directlyExcludedDocuments} 份，整族追加排除 ${result.additionallyExcludedByFamily} 份，可用合同族 ${result.eligibleFamilies} 个，选中 ${result.selectedDocuments} 份。`,
  );
  console.log(result.metadata.capacity.notice);
  console.log(
    result.metadata.familyIsolation.privateFamilyRegistryUsed
      ? "隔离边界：使用完整私有合同族注册表并辅以路径／文件名键，不代表视觉或文本近重复严格隔离。"
      : "隔离边界：当前只使用路径与文件名精确启发式，不代表视觉或文本近重复严格隔离。",
  );
  if (result.metadata.blindFreeze) {
    console.log(
      `严格冻结完成：候选池 ${result.metadata.blindFreeze.candidateDocuments} 份，最终盲测集 ${result.metadata.blindFreeze.frozenDocuments} 份，每族最多一份。`,
    );
  }
  if (!result.capacitySufficient) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
