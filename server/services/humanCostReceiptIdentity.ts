import type { PoolClient } from "pg";
import { normalizePaymentProofNo } from "../utils/payment-proof-identity.js";

interface ReceiptNumberItem {
  electronicReceiptNo: string;
  amount: number;
}

export class HumanCostReceiptIdentityError extends Error {}

/** 调用方必须在保存识别金额的同一事务中执行，保证回单号与金额同步提交。 */
export async function reserveHumanCostReceiptNumbers(
  client: PoolClient,
  receiptId: string,
  items: readonly ReceiptNumberItem[],
): Promise<boolean> {
  // 跨进程串行认领号码；数据库主键是最后一道并发防线。
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('human-cost-receipt-number'))",
  );
  const receipt = await client.query(
    "SELECT id FROM human_cost_receipts WHERE id = $1 AND recognition_status = 'processing' FOR UPDATE",
    [receiptId],
  );
  if (receipt.rows.length === 0) return false;

  const numbers = items.map((item) => ({
    number: normalizePaymentProofNo(item.electronicReceiptNo),
    amount: item.amount,
  }));
  const seen = new Set<string>();
  for (const item of numbers) {
    if (!item.number)
      throw new HumanCostReceiptIdentityError(
        "未识别到电子回单号，无法查重，该文件不计入汇总",
      );
    if (seen.has(item.number)) {
      throw new HumanCostReceiptIdentityError(
        `文件内电子回单号 ${item.number} 重复，该文件不计入汇总，请移除重复页后重新上传`,
      );
    }
    seen.add(item.number);
  }
  const existing = await client.query<{
    electronic_receipt_no: string;
    payroll_month: string;
    file_name: string;
  }>(
    `SELECT n.electronic_receipt_no, r.payroll_month, r.file_name
     FROM human_cost_receipt_numbers n
     JOIN human_cost_receipts r ON r.id = n.receipt_id
     WHERE n.electronic_receipt_no = ANY($1::text[]) AND n.receipt_id <> $2
     ORDER BY n.electronic_receipt_no LIMIT 1`,
    [[...seen], receiptId],
  );
  if (existing.rows.length > 0) {
    const other = existing.rows[0];
    throw new HumanCostReceiptIdentityError(
      `电子回单号 ${other.electronic_receipt_no} 已在 ${other.payroll_month} 的“${other.file_name}”中登记，该文件不计入汇总`,
    );
  }
  // 自身重识别可重建占用；删除原文件通过外键级联释放，失败事务不抢占号码。
  await client.query(
    "DELETE FROM human_cost_receipt_numbers WHERE receipt_id = $1",
    [receiptId],
  );
  for (const item of numbers) {
    await client.query(
      "INSERT INTO human_cost_receipt_numbers (electronic_receipt_no, receipt_id, amount) VALUES ($1, $2, $3::numeric)",
      [item.number, receiptId, item.amount.toFixed(2)],
    );
  }
  return true;
}
