import path from "node:path";
import { buildContractOcrHoldout } from "../services/contractOcrHoldout.js";

const DEFAULT_SEED = "contract-ocr-v6-holdout-v1";
const DEFAULT_DATASET_VERSION = "contract-ocr-v6-holdout-50-v1";

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function positiveIntegerOption(name: string, fallback: number): number {
  const value = optionValue(name);
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const inputRoot = path.resolve(
    optionValue("--input") ||
      process.env.CONTRACT_AUDIT_INPUT_ROOT ||
      "/tmp/contract-audit-input",
  );
  const result = await buildContractOcrHoldout({
    inventoryPath: path.resolve(
      optionValue("--inventory") || "/tmp/合同四区盘点清单.tsv",
    ),
    frozenManifestPath: path.resolve(
      optionValue("--frozen-manifest") ||
        path.join(
          projectRoot,
          "debug/contract-ocr-v6-regression-50-manifest.tsv",
        ),
    ),
    inputRoot,
    outputManifestPath: path.resolve(
      optionValue("--output-manifest") ||
        path.join(
          projectRoot,
          "debug/contract-ocr-holdout-private/contract-ocr-v6-holdout-50-manifest.tsv",
        ),
    ),
    outputMetadataPath: path.resolve(
      optionValue("--output-metadata") ||
        path.join(
          projectRoot,
          "debug/contract-ocr-v6-holdout-50-anonymous.json",
        ),
    ),
    targetSize: positiveIntegerOption("--size", 50),
    expectedCandidateCount: positiveIntegerOption("--expected-candidates", 74),
    seed: optionValue("--seed") || DEFAULT_SEED,
    datasetVersion: optionValue("--dataset-version") || DEFAULT_DATASET_VERSION,
  });

  console.log(
    `留出集生成完成：源合同 ${result.sourceUniqueContractCount} 份，冻结 ${result.frozenCount} 份，候选 ${result.candidateCount} 份，选中 ${result.selectedCount} 份。`,
  );
  console.log(`审计清单摘要：${result.manifestSha256}`);
  if (result.candidateCount < 100) {
    console.log(
      `容量说明：当前只有 ${result.candidateCount} 份候选，不能声称已建立 100 份严格盲测集。`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
