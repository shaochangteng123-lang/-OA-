import path from "node:path";
import {
  prepareContractOcrExternalIntake,
  type ContractExternalNativeTextMode,
} from "./lib/contractOcrExternalIntake.js";

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === name && process.argv[index + 1]) {
      return process.argv[index + 1];
    }
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return undefined;
}

function requiredOption(name: string): string {
  const value = optionValue(name)?.trim();
  if (!value) throw new Error(`缺少必填参数 ${name}`);
  return value;
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

function printHelp(): void {
  console.log(`外部合同盲测数据离线导入准备

用法：
  npx tsx server/scripts/prepare-contract-ocr-external-intake.ts \\
    --input-root <外部合同只读目录> \\
    --output-root <本次私有输出目录> \\
    --source-id <来源批次编号> \\
    --history-config <历史曝光来源配置> \\
    --baseline <冻结版本基线> \\
    [--family-registry <12列权威合同族注册表>] \\
    [--minimum-final-families 150] \\
    [--native-text-mode off|assist] \\
    [--workspace-root <仓库根目录>]

说明：
  首次不传 --family-registry 时生成待核验注册表，不把启发式合同族直接计入盲测候选。
  核验注册表后再次运行，才统计最终可用合同族。全过程不运行文字识别。`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  const nativeTextModeValue = optionValue("--native-text-mode") || "off";
  if (nativeTextModeValue !== "off" && nativeTextModeValue !== "assist") {
    throw new Error("--native-text-mode 只能是 off 或 assist");
  }
  const workspaceRoot = path.resolve(
    optionValue("--workspace-root") || process.cwd(),
  );
  const familyRegistry = optionValue("--family-registry");
  const result = await prepareContractOcrExternalIntake({
    inputRoot: path.resolve(requiredOption("--input-root")),
    outputRoot: path.resolve(requiredOption("--output-root")),
    sourceId: requiredOption("--source-id"),
    historyConfigPath: path.resolve(requiredOption("--history-config")),
    baselinePath: path.resolve(requiredOption("--baseline")),
    ...(familyRegistry
      ? { familyRegistryPath: path.resolve(familyRegistry) }
      : {}),
    minimumFinalFamilies: positiveIntegerOption(
      "--minimum-final-families",
      150,
    ),
    nativeTextMode: nativeTextModeValue as ContractExternalNativeTextMode,
    workspaceRoot,
  });
  console.log(
    JSON.stringify(
      {
        来源批次: result.summary.sourceId,
        候选合同族数量:
          result.summary.counts.candidateFamiliesBeforeExposure,
        曝光排除数量: result.summary.counts.exposureExcludedFamilies,
        最终盲测候选数量:
          result.summary.counts.finalBlindCandidateFamilies,
        待核验合同族数量: result.summary.counts.unresolvedFamilies,
        目标数量: result.summary.target.minimumFinalFamilies,
        是否达标: result.summary.target.met,
        缺口: result.summary.target.shortfall,
      },
      null,
      2,
    ),
  );
  if (!result.summary.target.met) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
