import fs from "node:fs";
import path from "node:path";
import { summarizeContractOcrHoldoutShards } from "../services/contractOcrHoldoutSummary.js";

function optionValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function optionValue(name: string): string | undefined {
  return optionValues(name)[0];
}

function parseExpectedCount(): number {
  const value = optionValue("--expected-count") || "50";
  if (!/^\d+$/u.test(value)) {
    throw new Error("--expected-count（预期数量）必须是正整数");
  }
  const count = Number.parseInt(value, 10);
  if (count <= 0) {
    throw new Error("--expected-count（预期数量）必须是正整数");
  }
  return count;
}

function writePrivateJson(outputPath: string, value: unknown): void {
  if (fs.existsSync(outputPath) && !process.argv.includes("--overwrite")) {
    throw new Error(
      "输出文件已存在；如确认覆盖脱敏汇总，请显式传入 --overwrite（覆盖）",
    );
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function main(): void {
  const inputPaths = optionValues("--input");
  const outputPath = optionValue("--output");
  if (inputPaths.length === 0) {
    throw new Error(
      "至少重复传入一次 --input（输入分片），每次对应一个 JSONL（逐行 JSON）文件",
    );
  }
  if (!outputPath) {
    throw new Error("必须传入 --output（输出文件）");
  }
  const summary = summarizeContractOcrHoldoutShards({
    inputPaths,
    expectedCount: parseExpectedCount(),
  });
  writePrivateJson(outputPath, summary);
  console.log(
    `已生成 ${summary.totals.documents} 份合同的脱敏聚合汇总，自动采用 ${summary.automaticReadyCounts.ready} 份，输出权限为 0600`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "留出集汇总失败");
  process.exitCode = 1;
}
