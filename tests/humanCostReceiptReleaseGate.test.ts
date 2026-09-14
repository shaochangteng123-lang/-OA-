import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function section(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
}

describe("人力成本社保回单发布回归门禁", () => {
  const payrollRoute = source("server/routes/payroll.ts");
  const receiptOcr = source("server/services/humanCostReceiptOcr.ts");
  const receiptIdentity = source("server/services/humanCostReceiptIdentity.ts");
  const database = source("server/db/index.ts");
  const productionEntrypoint = source("docker-entrypoint.sh");

  it("固定社保识别版本为6并自动重跑旧版本", () => {
    const versionPolicy = section(
      payrollRoute,
      "const HUMAN_COST_RECEIPT_RECOGNITION_VERSIONS",
      "function getHumanCostReceiptRecognitionVersion",
    );
    const summaryLoader = section(
      payrollRoute,
      "async function loadHumanCostReceiptSummary",
      "async function processHumanCostReceiptRecord",
    );

    expect(versionPolicy).toMatch(/social_security:\s*6\b/u);
    expect(summaryLoader).toContain(
      "(category = 'social_security' AND recognition_version < 6)",
    );
    expect(summaryLoader).toContain(
      "getHumanCostReceiptRecognitionVersion(receipt.category)",
    );
  });

  it("社保识别继续启用国库回单遮挡收款账号兼容", () => {
    const imageRecognition = section(
      receiptOcr,
      "async function recognizeReceiptImages",
      "export async function recognizeHumanCostReceipt",
    );

    expect(imageRecognition).toContain("parseAndValidatePaymentProofText");
    expect(imageRecognition).toMatch(
      /allowMaskedTaxPayeeAccount:\s*\n?\s*category === "income_tax" \|\| category === "social_security"/u,
    );
  });

  it("社保与公积金在金额落库前于同一事务登记电子回单号", () => {
    const processor = section(
      payrollRoute,
      "async function processHumanCostReceiptRecord",
      "interface QueuedHumanCostReceipt",
    );
    const transactionStart = processor.indexOf(
      "await db.transaction(async (client)",
    );
    const identityReservation = processor.indexOf(
      "await reserveHumanCostReceiptNumbers",
      transactionStart,
    );
    const receiptUpdate = processor.indexOf(
      "UPDATE human_cost_receipts",
      identityReservation,
    );

    expect(transactionStart).toBeGreaterThanOrEqual(0);
    expect(identityReservation).toBeGreaterThan(transactionStart);
    expect(receiptUpdate).toBeGreaterThan(identityReservation);
    expect(processor.slice(transactionStart, identityReservation)).toContain(
      'category === "social_security" || category === "housing_fund"',
    );
    expect(processor.slice(identityReservation, receiptUpdate)).toContain(
      "recognition.items",
    );
  });

  it("电子回单号保持规范化、跨文件查重和数据库唯一约束", () => {
    expect(receiptIdentity).toContain("normalizePaymentProofNo");
    expect(receiptIdentity).toContain("pg_advisory_xact_lock");
    expect(receiptIdentity).toContain(
      "n.electronic_receipt_no = ANY($1::text[])",
    );
    expect(receiptIdentity).toContain("n.receipt_id <> $2");
    expect(database).toContain(
      "CREATE TABLE IF NOT EXISTS human_cost_receipt_numbers",
    );
    expect(database).toContain("electronic_receipt_no TEXT PRIMARY KEY");
    expect(database).toContain(
      "REFERENCES human_cost_receipts(id) ON DELETE CASCADE",
    );
  });

  it("生产容器启动时拒绝社保旧版本或缺少关键识别服务", () => {
    expect(productionEntrypoint).toContain("社保回单识别版本低于 6");
    expect(productionEntrypoint).toContain("allowMaskedTaxPayeeAccount");
    expect(productionEntrypoint).toContain("humanCostReceiptIdentity.js");
    expect(productionEntrypoint).toContain("拒绝启动生产服务");
  });
});
