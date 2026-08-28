import crypto from "crypto";
import fs from "fs";
import path from "path";

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import {
  lockPaymentProofIdentities,
  normalizePaymentProofNo,
} from "../utils/payment-proof-identity.js";

type ReimbursementType = "basic" | "large" | "business";

interface MonthlyTransaction {
  id: string;
  cropPath: string;
  proofNo: string;
  normalizedProofNo: string;
  transactionDate: string;
  amount: string;
  amountCents: bigint;
  reimbursementType: ReimbursementType;
  employeeId: string;
  employeeUserId: string;
}

interface ReimbursementRow {
  id: string;
  type: ReimbursementType;
  title: string;
  status: string;
  totalAmount: string;
  amountCents: bigint;
  userId: string;
  employeeId: string;
  paymentBatchId: string | null;
  paymentProofPath: string | null;
  paymentBusinessDate: string | null;
  paymentUploadTime: string | null;
  completedTime: string | null;
  receiptConfirmedBy: string | null;
}

interface BatchItemRow extends ReimbursementRow {
  batchId: string;
  batchStatus: string;
  batchAmount: string;
  batchProofPath: string | null;
  batchBusinessDate: string | null;
  itemAmount: string;
  itemAmountCents: bigint;
}

interface BatchItemQueryRow {
  batch_id: string;
  batch_status: string;
  batch_amount: string;
  batch_proof_path: string | null;
  batch_business_date: string | null;
  item_amount: string;
  id: string;
  type: ReimbursementType;
  title: string;
  status: string;
  total_amount: string;
  user_id: string;
  employee_id: string;
  payment_batch_id: string | null;
  payment_proof_path: string | null;
  payment_business_date: string | null;
  payment_upload_time: string | null;
  completed_time: string | null;
  receipt_confirmed_by: string | null;
}

interface MatchOption {
  transactionIds: string[];
  reimbursementIds: string[];
  pendingBatchId: string | null;
  allocations?: Array<{
    transactionId: string;
    reimbursementId: string;
    amount: string;
  }>;
  batchScope?: boolean;
}

export interface MonthlyReimbursementLinkWrite {
  transactionId: string;
  businessObjectType: "reimbursement" | "payment_batch";
  businessObjectId: string;
  allocatedAmount: string | null;
  displayAction: "attached" | "replaced";
  matchKey: Record<string, unknown>;
}

export interface MonthlyReimbursementMatchedGroup {
  transactionIds: string[];
  reimbursementIds: string[];
  paymentBatchId: string;
  displayAction: "attached" | "replaced";
}

export interface MonthlyReimbursementPendingGroup {
  transactionIds: string[];
  reason: string;
}

export interface MonthlyReimbursementReplacedEvidence {
  transactionIds: string[];
  paymentBatchId: string;
  previousBatchProofPath: string | null;
  previousBatchBusinessDate: string | null;
  previousReimbursements: Array<{
    id: string;
    status: string;
    paymentProofPath: string | null;
    paymentBusinessDate: string | null;
    completedTime: string | null;
    receiptConfirmedBy: string | null;
  }>;
}

export interface MonthlyReimbursementReconciliationResult {
  links: MonthlyReimbursementLinkWrite[];
  matchedGroups: MonthlyReimbursementMatchedGroup[];
  pendingTransactions: MonthlyReimbursementPendingGroup[];
  replacedEvidence: MonthlyReimbursementReplacedEvidence[];
}

function moneyToCents(value: unknown): bigint {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[,，￥¥\s]/gu, "");
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/u);
  if (!match) throw new Error("月报报销回单金额必须精确到分");
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function centsToAmount(value: bigint): string {
  const integer = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return fraction === "00" ? integer.toString() : `${integer}.${fraction}`;
}

function latestTransactionDate(transactions: MonthlyTransaction[]): string {
  return transactions.reduce(
    (latest, transaction) =>
      transaction.transactionDate > latest
        ? transaction.transactionDate
        : latest,
    transactions[0]!.transactionDate,
  );
}

function reimbursementTypeForCategory(value: string): ReimbursementType | null {
  if (value === "basic_reimbursement") return "basic";
  if (value === "large_reimbursement") return "large";
  if (value === "business_reimbursement") return "business";
  return null;
}

function uniqueSubsets<T extends { amountCents: bigint }>(
  rows: T[],
  target: bigint,
  maxItems = 5,
): T[][] {
  const matches: T[][] = [];
  const chosen: T[] = [];
  const walk = (start: number, remaining: bigint): void => {
    if (matches.length > 1) return;
    if (remaining === 0n) {
      matches.push([...chosen]);
      return;
    }
    if (remaining < 0n || chosen.length >= maxItems) return;
    for (let index = start; index < rows.length; index += 1) {
      chosen.push(rows[index]!);
      walk(index + 1, remaining - rows[index]!.amountCents);
      chosen.pop();
      if (matches.length > 1) return;
    }
  };
  walk(0, target);
  return matches;
}

function buildPaidOptions(
  transactions: MonthlyTransaction[],
  reimbursements: ReimbursementRow[],
): MatchOption[] {
  const options: MatchOption[] = [];
  for (const transaction of transactions) {
    for (const reimbursement of reimbursements) {
      if (transaction.amountCents === reimbursement.amountCents) {
        options.push({
          transactionIds: [transaction.id],
          reimbursementIds: [reimbursement.id],
          pendingBatchId: null,
        });
      }
    }
    const reimbursementSubsets = uniqueSubsets(
      reimbursements,
      transaction.amountCents,
    );
    if (
      reimbursementSubsets.length === 1 &&
      reimbursementSubsets[0]!.length > 1
    ) {
      options.push({
        transactionIds: [transaction.id],
        reimbursementIds: reimbursementSubsets[0]!.map((row) => row.id).sort(),
        pendingBatchId: null,
      });
    }
  }
  for (const reimbursement of reimbursements) {
    const transactionSubsets = uniqueSubsets(
      transactions,
      reimbursement.amountCents,
    );
    if (transactionSubsets.length === 1 && transactionSubsets[0]!.length > 1) {
      options.push({
        transactionIds: transactionSubsets[0]!.map((row) => row.id).sort(),
        reimbursementIds: [reimbursement.id],
        pendingBatchId: null,
      });
    }
  }
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.transactionIds.join(",")}|${option.reimbursementIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function onlyUnambiguousOptions(options: MatchOption[]): MatchOption[] {
  const transactionUse = new Map<string, number>();
  const reimbursementUse = new Map<string, number>();
  for (const option of options) {
    for (const id of option.transactionIds) {
      transactionUse.set(id, (transactionUse.get(id) || 0) + 1);
    }
    for (const id of option.reimbursementIds) {
      reimbursementUse.set(id, (reimbursementUse.get(id) || 0) + 1);
    }
  }
  return options.filter(
    (option) =>
      option.transactionIds.every((id) => transactionUse.get(id) === 1) &&
      option.reimbursementIds.every((id) => reimbursementUse.get(id) === 1),
  );
}

function uniqueWholeItemAllocation(
  transactions: MonthlyTransaction[],
  reimbursements: BatchItemRow[],
): MatchOption["allocations"] | null {
  if (transactions.length < 2 || reimbursements.length < 2) return null;
  if (transactions.length > 12 || reimbursements.length > 12) return null;
  const remaining = transactions.map((row) => row.amountCents);
  const assignments: number[] = Array(reimbursements.length).fill(-1);
  const solutions: number[][] = [];
  const walk = (itemIndex: number): void => {
    if (solutions.length > 1) return;
    if (itemIndex === reimbursements.length) {
      if (remaining.every((value) => value === 0n)) {
        solutions.push([...assignments]);
      }
      return;
    }
    const item = reimbursements[itemIndex]!;
    for (
      let transactionIndex = 0;
      transactionIndex < transactions.length;
      transactionIndex += 1
    ) {
      if (remaining[transactionIndex]! < item.itemAmountCents) continue;
      remaining[transactionIndex] -= item.itemAmountCents;
      assignments[itemIndex] = transactionIndex;
      walk(itemIndex + 1);
      assignments[itemIndex] = -1;
      remaining[transactionIndex] += item.itemAmountCents;
      if (solutions.length > 1) return;
    }
  };
  walk(0);
  if (solutions.length !== 1) return null;
  return reimbursements.map((reimbursement, index) => ({
    transactionId: transactions[solutions[0]![index]!]!.id,
    reimbursementId: reimbursement.id,
    amount: reimbursement.itemAmount,
  }));
}

function cropHash(cropPath: string): string {
  const absolutePath = path.resolve(process.cwd(), cropPath);
  if (!fs.existsSync(absolutePath)) throw new Error("月报银行回单裁片不存在");
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absolutePath))
    .digest("hex");
}

async function loadMonthlyTransactions(
  client: PoolClient,
  reportMonth: string,
): Promise<MonthlyTransaction[]> {
  const result = await client.query<{
    id: string;
    crop_path: string;
    electronic_receipt_no: string | null;
    normalized_electronic_receipt_no: string | null;
    transaction_date: string;
    amount: string;
    category: string;
    employee_id: string;
    employee_user_id: string;
  }>(
    `SELECT bank_transaction.id, bank_transaction.crop_path,
            bank_transaction.electronic_receipt_no,
            bank_transaction.normalized_electronic_receipt_no,
            bank_transaction.transaction_date,
            bank_transaction.amount::text AS amount,
            bank_transaction.category,
            employee.id AS employee_id,
            employee.user_id AS employee_user_id
       FROM monthly_financial_bank_transactions bank_transaction
       JOIN monthly_financial_bank_files bank_file
         ON bank_file.id = bank_transaction.current_file_id
        AND bank_file.is_active = TRUE
       JOIN monthly_financial_bank_transaction_links employee_link
         ON employee_link.transaction_id = bank_transaction.id
        AND employee_link.business_object_type = 'employee_profile'
        AND employee_link.link_kind = 'classification_basis'
        AND employee_link.match_status = 'active'
        AND employee_link.is_active = TRUE
       JOIN employee_profiles employee
         ON employee.id = employee_link.business_object_id
      WHERE bank_transaction.report_month = $1
        AND bank_transaction.is_current = TRUE
        AND bank_transaction.recognition_status = 'recognized'
        AND bank_transaction.category IN (
          'basic_reimbursement', 'large_reimbursement', 'business_reimbursement'
        )
      ORDER BY employee.id, bank_transaction.category,
               bank_transaction.transaction_date, bank_transaction.id
      FOR UPDATE OF bank_transaction`,
    [reportMonth],
  );
  return result.rows.flatMap((row) => {
    const reimbursementType = reimbursementTypeForCategory(row.category);
    if (!reimbursementType || !row.crop_path || !row.employee_user_id)
      return [];
    return [
      {
        id: row.id,
        cropPath: row.crop_path,
        proofNo: row.electronic_receipt_no || "",
        normalizedProofNo:
          normalizePaymentProofNo(row.normalized_electronic_receipt_no) ||
          normalizePaymentProofNo(row.electronic_receipt_no),
        transactionDate: row.transaction_date,
        amount: row.amount,
        amountCents: moneyToCents(row.amount),
        reimbursementType,
        employeeId: row.employee_id,
        employeeUserId: row.employee_user_id,
      },
    ];
  });
}

async function loadPaidReimbursements(
  client: PoolClient,
  employeeIds: string[],
): Promise<ReimbursementRow[]> {
  if (!employeeIds.length) return [];
  const result = await client.query<{
    id: string;
    type: ReimbursementType;
    title: string;
    status: string;
    total_amount: string;
    user_id: string;
    employee_id: string;
    payment_batch_id: string | null;
    payment_proof_path: string | null;
    payment_business_date: string | null;
    payment_upload_time: string | null;
    completed_time: string | null;
    receipt_confirmed_by: string | null;
  }>(
    `SELECT reimbursement.id, reimbursement.type, reimbursement.title,
            reimbursement.status, reimbursement.total_amount::text AS total_amount,
            reimbursement.user_id, employee.id AS employee_id,
            reimbursement.payment_batch_id, reimbursement.payment_proof_path,
            reimbursement.payment_business_date::text AS payment_business_date,
            reimbursement.payment_upload_time, reimbursement.completed_time,
            reimbursement.receipt_confirmed_by
       FROM reimbursements reimbursement
       JOIN employee_profiles employee ON employee.user_id = reimbursement.user_id
      WHERE employee.id = ANY($1::text[])
        AND reimbursement.status = 'paid'
        AND reimbursement.payment_batch_id IS NULL
        AND reimbursement.is_deleted = FALSE
      ORDER BY reimbursement.approve_time, reimbursement.id
      FOR UPDATE OF reimbursement`,
    [employeeIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    totalAmount: row.total_amount,
    amountCents: moneyToCents(row.total_amount),
    userId: row.user_id,
    employeeId: row.employee_id,
    paymentBatchId: row.payment_batch_id,
    paymentProofPath: row.payment_proof_path,
    paymentBusinessDate: row.payment_business_date,
    paymentUploadTime: row.payment_upload_time,
    completedTime: row.completed_time,
    receiptConfirmedBy: row.receipt_confirmed_by,
  }));
}

async function loadPendingBatchItems(
  client: PoolClient,
  employeeIds: string[],
): Promise<BatchItemRow[]> {
  if (!employeeIds.length) return [];
  const result = await client.query<BatchItemQueryRow>(
    `SELECT batch.id AS batch_id, batch.status AS batch_status,
            batch.total_amount::text AS batch_amount,
            batch.payment_proof_path AS batch_proof_path,
            batch.payment_business_date::text AS batch_business_date,
            item.amount::text AS item_amount,
            reimbursement.id, reimbursement.type, reimbursement.title,
            reimbursement.status, reimbursement.total_amount::text AS total_amount,
            reimbursement.user_id, employee.id AS employee_id,
            reimbursement.payment_batch_id, reimbursement.payment_proof_path,
            reimbursement.payment_business_date::text AS payment_business_date,
            reimbursement.payment_upload_time, reimbursement.completed_time,
            reimbursement.receipt_confirmed_by
       FROM payment_batches batch
       JOIN payment_batch_items item ON item.batch_id = batch.id
       JOIN reimbursements reimbursement ON reimbursement.id = item.reimbursement_id
       JOIN employee_profiles employee ON employee.user_id = reimbursement.user_id
      WHERE batch.status = 'pending'
        AND employee.id = ANY($1::text[])
        AND reimbursement.is_deleted = FALSE
      ORDER BY batch.id, item.created_at, item.id
      FOR UPDATE OF batch, item, reimbursement`,
    [employeeIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    totalAmount: row.total_amount,
    amountCents: moneyToCents(row.total_amount),
    userId: row.user_id,
    employeeId: row.employee_id,
    paymentBatchId: row.payment_batch_id,
    paymentProofPath: row.payment_proof_path,
    paymentBusinessDate: row.payment_business_date,
    paymentUploadTime: row.payment_upload_time,
    completedTime: row.completed_time,
    receiptConfirmedBy: row.receipt_confirmed_by,
    batchId: row.batch_id,
    batchStatus: row.batch_status,
    batchAmount: row.batch_amount,
    batchProofPath: row.batch_proof_path,
    batchBusinessDate: row.batch_business_date,
    itemAmount: row.item_amount,
    itemAmountCents: moneyToCents(row.item_amount),
  }));
}

async function upsertActiveLink(
  client: PoolClient,
  actorId: string,
  now: string,
  link: MonthlyReimbursementLinkWrite,
): Promise<void> {
  await client.query(
    `UPDATE monthly_financial_bank_transaction_links
        SET match_status = 'replaced', is_active = FALSE, updated_at = $4
      WHERE transaction_id = $1 AND business_object_type = $2
        AND business_object_id = $3 AND link_kind = 'display_replacement'
        AND match_status IN ('active', 'conflict')`,
    [link.transactionId, link.businessObjectType, link.businessObjectId, now],
  );
  await client.query(
    `INSERT INTO monthly_financial_bank_transaction_links(
       id, transaction_id, business_object_type, business_object_id,
       link_kind, match_method, match_status, match_key_json,
       allocated_amount, warnings_json, is_active, created_by,
       created_at, updated_at
     ) VALUES($1,$2,$3,$4,'display_replacement','account_date_amount',
              'active',$5::jsonb,$6::numeric,'[]'::jsonb,TRUE,$7,$8,$8)`,
    [
      `mfbl_${nanoid(16)}`,
      link.transactionId,
      link.businessObjectType,
      link.businessObjectId,
      JSON.stringify(link.matchKey),
      link.allocatedAmount,
      actorId,
      now,
    ],
  );
}

function linksForOption(
  option: MatchOption,
  transactions: MonthlyTransaction[],
  reimbursements: ReimbursementRow[],
  batchId: string,
  displayAction: "attached" | "replaced",
  extraMatchKey: Record<string, unknown> = {},
): MonthlyReimbursementLinkWrite[] {
  const transactionRows = transactions.filter((row) =>
    option.transactionIds.includes(row.id),
  );
  const reimbursementRows = reimbursements.filter((row) =>
    option.reimbursementIds.includes(row.id),
  );
  const output: MonthlyReimbursementLinkWrite[] = [];
  const previousEvidence = extraMatchKey.previousEvidence as
    | MonthlyReimbursementReplacedEvidence
    | undefined;
  for (const transaction of transactionRows) {
    for (const reimbursement of reimbursementRows) {
      const explicitAllocation = option.allocations?.find(
        (item) =>
          item.transactionId === transaction.id &&
          item.reimbursementId === reimbursement.id,
      );
      if (option.allocations && !explicitAllocation) continue;
      const allocated = option.batchScope
        ? null
        : explicitAllocation?.amount ||
          (transactionRows.length > 1
            ? transaction.amount
            : reimbursement.totalAmount);
      output.push({
        transactionId: transaction.id,
        businessObjectType: "reimbursement",
        businessObjectId: reimbursement.id,
        allocatedAmount: allocated,
        displayAction,
        matchKey: {
          paymentBatchId: batchId,
          reimbursementType: reimbursement.type,
          transactionDate: transaction.transactionDate,
          proofNo: transaction.normalizedProofNo,
          evidencePath: transaction.cropPath,
          displayAction,
          batchScope: Boolean(option.batchScope),
          allocationStatus: option.batchScope
            ? "batch_total_only"
            : "allocated",
          previousPaymentProofPath:
            previousEvidence?.previousReimbursements.find(
              (item) => item.id === reimbursement.id,
            )?.paymentProofPath || null,
          ...extraMatchKey,
        },
      });
    }
    output.push({
      transactionId: transaction.id,
      businessObjectType: "payment_batch",
      businessObjectId: batchId,
      allocatedAmount: transaction.amount,
      displayAction,
      matchKey: {
        paymentBatchId: batchId,
        transactionDate: transaction.transactionDate,
        proofNo: transaction.normalizedProofNo,
        evidencePath: transaction.cropPath,
        displayAction,
        batchScope: Boolean(option.batchScope),
        allocationStatus: option.batchScope ? "batch_total_only" : "allocated",
        ...extraMatchKey,
      },
    });
  }
  return output;
}

async function applyNewAttachment(
  client: PoolClient,
  option: MatchOption,
  transactions: MonthlyTransaction[],
  reimbursements: ReimbursementRow[],
  actorId: string,
  now: string,
  reportMonth: string,
): Promise<{ batchId: string; links: MonthlyReimbursementLinkWrite[] } | null> {
  const transactionRows = transactions.filter((row) =>
    option.transactionIds.includes(row.id),
  );
  const reimbursementRows = reimbursements.filter((row) =>
    option.reimbursementIds.includes(row.id),
  );
  if (!transactionRows.length || !reimbursementRows.length) return null;
  if (
    transactionRows.some(
      (row) => row.transactionDate.slice(0, 7) !== reportMonth,
    ) ||
    transactionRows.some((row) => !row.normalizedProofNo)
  ) {
    return null;
  }
  const identities = transactionRows.map((row) => ({
    fileHash: cropHash(row.cropPath),
    proofNo: row.normalizedProofNo,
  }));
  await lockPaymentProofIdentities(client, identities);
  const duplicate = await client.query<{ batch_id: string }>(
    `SELECT batch_id FROM payment_proof_hashes
      WHERE file_hash = ANY($1::text[])
         OR UPPER(REGEXP_REPLACE(
              NORMALIZE(BTRIM(proof_no), NFKC), '[^A-Za-z0-9]+', '', 'g'
            )) = ANY($2::text[])
      LIMIT 1`,
    [
      identities.map((row) => row.fileHash),
      identities.map((row) => row.proofNo),
    ],
  );
  if (duplicate.rows[0]) return null;

  const batchId = option.pendingBatchId || `pb_${nanoid(16)}`;
  const totalCents = transactionRows.reduce(
    (sum, row) => sum + row.amountCents,
    0n,
  );
  const proofPath = transactionRows.map((row) => row.cropPath).join(",");
  const businessDate = latestTransactionDate(transactionRows);
  if (option.pendingBatchId) {
    const updated = await client.query(
      `UPDATE payment_batches
          SET status = 'uploaded', payment_proof_path = $2,
              payment_business_date = $3::date,
              pay_time = COALESCE(pay_time, $4), updated_at = $4
        WHERE id = $1 AND status = 'pending'`,
      [batchId, proofPath, businessDate, now],
    );
    if (updated.rowCount !== 1) throw new Error("付款批次状态已变化");
  } else {
    await client.query(
      `INSERT INTO payment_batches(
         id, batch_no, total_amount, payer_id, payment_proof_path,
         pay_time, payment_business_date, status, created_at, updated_at
       ) VALUES($1,$2,$3::numeric,$4,$5,$6,$7::date,'uploaded',$6,$6)`,
      [
        batchId,
        `PAY${now.slice(0, 10).replace(/-/gu, "")}${nanoid(6).toUpperCase()}`,
        centsToAmount(totalCents),
        actorId,
        proofPath,
        now,
        businessDate,
      ],
    );
    for (const reimbursement of reimbursementRows) {
      await client.query(
        `INSERT INTO payment_batch_items(
           id, batch_id, reimbursement_id, amount, created_at
         ) VALUES($1,$2,$3,$4::numeric,$5)`,
        [
          `pbi_${nanoid(16)}`,
          batchId,
          reimbursement.id,
          reimbursement.totalAmount,
          now,
        ],
      );
    }
  }
  for (const identity of identities) {
    await client.query(
      `INSERT INTO payment_proof_hashes(id,file_hash,proof_no,batch_id,created_at)
       VALUES($1,$2,$3,$4,$5)`,
      [`pph_${nanoid(16)}`, identity.fileHash, identity.proofNo, batchId, now],
    );
  }
  const allowedStatuses = option.pendingBatchId
    ? ["approved", "paid"]
    : ["paid"];
  const reimbursementUpdate = await client.query(
    `UPDATE reimbursements
        SET status = 'payment_uploaded', payment_proof_path = $2,
            payment_business_date = $3::date, payment_batch_id = $4,
            payment_upload_time = $5, pay_time = COALESCE(pay_time, $5),
            updated_at = $5
      WHERE id = ANY($1::text[]) AND status = ANY($6::text[])
        AND is_deleted = FALSE
        AND (($7::text IS NULL AND payment_batch_id IS NULL)
          OR payment_batch_id = $7)`,
    [
      option.reimbursementIds,
      proofPath,
      businessDate,
      batchId,
      now,
      allowedStatuses,
      option.pendingBatchId,
    ],
  );
  if (reimbursementUpdate.rowCount !== reimbursementRows.length) {
    throw new Error("报销单状态已变化");
  }
  for (const reimbursement of reimbursementRows) {
    const approval = await client.query<{ id: string }>(
      `SELECT id FROM approval_instances
        WHERE target_id = $1 AND target_type = 'reimbursement'
        ORDER BY created_at DESC LIMIT 1`,
      [reimbursement.id],
    );
    if (approval.rows[0]) {
      await client.query(
        `INSERT INTO approval_records(
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES($1,$2,99,$3,'payment_uploaded',$4,$5)`,
        [
          `ar_${nanoid(12)}`,
          approval.rows[0].id,
          actorId,
          `月报银行回单自动挂载（${transactionRows.length}张）`,
          now,
        ],
      );
    }
  }
  return {
    batchId,
    links: linksForOption(
      option,
      transactionRows,
      reimbursementRows,
      batchId,
      "attached",
      { cropHashes: identities.map((row) => row.fileHash) },
    ),
  };
}

async function replacementGroups(
  client: PoolClient,
  transactions: MonthlyTransaction[],
): Promise<Array<{ batchId: string; transactions: MonthlyTransaction[] }>> {
  const proofNos = transactions
    .map((row) => row.normalizedProofNo)
    .filter(Boolean);
  if (!proofNos.length) return [];
  const owners = await client.query<{
    normalized_proof_no: string;
    batch_id: string;
  }>(
    `SELECT UPPER(REGEXP_REPLACE(
              NORMALIZE(BTRIM(proof_no), NFKC), '[^A-Za-z0-9]+', '', 'g'
            )) AS normalized_proof_no,
            batch_id
       FROM payment_proof_hashes
      WHERE proof_no IS NOT NULL
        AND UPPER(REGEXP_REPLACE(
              NORMALIZE(BTRIM(proof_no), NFKC), '[^A-Za-z0-9]+', '', 'g'
            )) = ANY($1::text[])
      FOR UPDATE`,
    [proofNos],
  );
  const byBatch = new Map<string, MonthlyTransaction[]>();
  const batchesByProof = new Map<string, Set<string>>();
  for (const owner of owners.rows) {
    const normalizedOwnerProofNo = normalizePaymentProofNo(
      owner.normalized_proof_no,
    );
    const batchIds = batchesByProof.get(normalizedOwnerProofNo) || new Set();
    batchIds.add(owner.batch_id);
    batchesByProof.set(normalizedOwnerProofNo, batchIds);
  }
  for (const transaction of transactions) {
    const batchIds = batchesByProof.get(transaction.normalizedProofNo);
    if (!batchIds || batchIds.size !== 1) continue;
    const batchId = [...batchIds][0]!;
    const rows = byBatch.get(batchId) || [];
    rows.push(transaction);
    byBatch.set(batchId, rows);
  }
  return [...byBatch.entries()].map(([batchId, rows]) => ({
    batchId,
    transactions: rows,
  }));
}

async function applyReplacement(
  client: PoolClient,
  batchId: string,
  transactions: MonthlyTransaction[],
  actorId: string,
  now: string,
  reportMonth: string,
): Promise<{
  group: MonthlyReimbursementMatchedGroup;
  links: MonthlyReimbursementLinkWrite[];
  evidence?: MonthlyReimbursementReplacedEvidence;
} | null> {
  const contextResult = await client.query<BatchItemQueryRow>(
    `SELECT batch.status AS batch_status, batch.total_amount::text AS batch_amount,
            batch.payment_proof_path AS batch_proof_path,
            batch.payment_business_date::text AS batch_business_date,
            item.amount::text AS item_amount,
            reimbursement.id, reimbursement.type, reimbursement.title,
            reimbursement.status, reimbursement.total_amount::text AS total_amount,
            reimbursement.user_id, employee.id AS employee_id,
            reimbursement.payment_batch_id, reimbursement.payment_proof_path,
            reimbursement.payment_business_date::text AS payment_business_date,
            reimbursement.payment_upload_time, reimbursement.completed_time,
            reimbursement.receipt_confirmed_by
       FROM payment_batches batch
       JOIN payment_batch_items item ON item.batch_id = batch.id
       JOIN reimbursements reimbursement ON reimbursement.id = item.reimbursement_id
       JOIN employee_profiles employee ON employee.user_id = reimbursement.user_id
      WHERE batch.id = $1 AND reimbursement.is_deleted = FALSE
      ORDER BY item.created_at, item.id
      FOR UPDATE OF batch, item, reimbursement`,
    [batchId],
  );
  if (!contextResult.rows.length) return null;
  const rows: BatchItemRow[] = contextResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    totalAmount: row.total_amount,
    amountCents: moneyToCents(row.total_amount),
    userId: row.user_id,
    employeeId: row.employee_id,
    paymentBatchId: row.payment_batch_id,
    paymentProofPath: row.payment_proof_path,
    paymentBusinessDate: row.payment_business_date,
    paymentUploadTime: row.payment_upload_time,
    completedTime: row.completed_time,
    receiptConfirmedBy: row.receipt_confirmed_by,
    batchId,
    batchStatus: row.batch_status,
    batchAmount: row.batch_amount,
    batchProofPath: row.batch_proof_path,
    batchBusinessDate: row.batch_business_date,
    itemAmount: row.item_amount,
    itemAmountCents: moneyToCents(row.item_amount),
  }));
  if (!["uploaded", "confirmed"].includes(rows[0]!.batchStatus)) return null;
  if (
    rows.some((row) => !["payment_uploaded", "completed"].includes(row.status))
  ) {
    return null;
  }
  const employees = new Set(transactions.map((row) => row.employeeId));
  const types = new Set(transactions.map((row) => row.reimbursementType));
  if (
    employees.size !== 1 ||
    types.size !== 1 ||
    transactions.some(
      (transaction) =>
        transaction.transactionDate.slice(0, 7) !== reportMonth,
    ) ||
    rows[0]!.batchBusinessDate?.slice(0, 7) !== reportMonth ||
    rows.some((row) => row.paymentBusinessDate?.slice(0, 7) !== reportMonth) ||
    rows.some(
      (row) =>
        row.employeeId !== transactions[0]!.employeeId ||
        row.type !== transactions[0]!.reimbursementType,
    )
  )
    return null;
  const transactionTotal = transactions.reduce(
    (sum, row) => sum + row.amountCents,
    0n,
  );
  const itemTotal = rows.reduce((sum, row) => sum + row.itemAmountCents, 0n);
  if (
    transactionTotal !== moneyToCents(rows[0]!.batchAmount) ||
    itemTotal !== transactionTotal ||
    rows.some((row) => row.itemAmountCents !== row.amountCents)
  )
    return null;
  let allocations: MatchOption["allocations"];
  let batchScope = false;
  if (transactions.length > 1 && rows.length > 1) {
    allocations = uniqueWholeItemAllocation(transactions, rows) || undefined;
    batchScope = !allocations;
  }
  const proofSet = await client.query<{ proof_no: string }>(
    `SELECT proof_no FROM payment_proof_hashes
      WHERE batch_id = $1 AND proof_no IS NOT NULL ORDER BY proof_no FOR UPDATE`,
    [batchId],
  );
  const existingProofs = [
    ...new Set(
      proofSet.rows.map((row) => normalizePaymentProofNo(row.proof_no)),
    ),
  ].sort();
  const incomingProofs = [
    ...new Set(transactions.map((row) => row.normalizedProofNo)),
  ].sort();
  if (JSON.stringify(existingProofs) !== JSON.stringify(incomingProofs))
    return null;
  const identities = transactions.map((row) => ({
    fileHash: cropHash(row.cropPath),
    proofNo: row.normalizedProofNo,
  }));
  await lockPaymentProofIdentities(client, identities);
  for (const identity of identities) {
    const hashOwner = await client.query<{ batch_id: string }>(
      `SELECT batch_id FROM payment_proof_hashes WHERE file_hash = $1`,
      [identity.fileHash],
    );
    if (hashOwner.rows[0] && hashOwner.rows[0].batch_id !== batchId)
      return null;
    if (!hashOwner.rows[0]) {
      await client.query(
        `INSERT INTO payment_proof_hashes(id,file_hash,proof_no,batch_id,created_at)
         VALUES($1,$2,NULL,$3,$4)`,
        [`pph_${nanoid(16)}`, identity.fileHash, batchId, now],
      );
    }
  }
  const proofPath = transactions.map((row) => row.cropPath).join(",");
  const businessDate = latestTransactionDate(transactions);
  const alreadyCurrent =
    rows[0]!.batchProofPath === proofPath &&
    rows[0]!.batchBusinessDate === businessDate &&
    rows.every(
      (row) =>
        row.paymentProofPath === proofPath &&
        row.paymentBusinessDate === businessDate,
    );
  if (alreadyCurrent) {
    const existingAction = await client.query<{
      display_action: string | null;
    }>(
      `SELECT link.match_key_json ->> 'displayAction' AS display_action
         FROM monthly_financial_bank_transaction_links link
        WHERE link.transaction_id = ANY($1::text[])
          AND link.business_object_type = 'reimbursement'
          AND link.link_kind = 'display_replacement'
          AND link.match_status = 'active' AND link.is_active = TRUE
        ORDER BY link.updated_at DESC, link.id DESC LIMIT 1`,
      [transactions.map((row) => row.id)],
    );
    const displayAction =
      existingAction.rows[0]?.display_action === "replaced"
        ? "replaced"
        : "attached";
    return {
      group: {
        transactionIds: transactions.map((row) => row.id),
        reimbursementIds: rows.map((row) => row.id),
        paymentBatchId: batchId,
        displayAction,
      },
      links: [],
    };
  }
  const previousEvidence: MonthlyReimbursementReplacedEvidence = {
    transactionIds: transactions.map((row) => row.id),
    paymentBatchId: batchId,
    previousBatchProofPath: rows[0]!.batchProofPath,
    previousBatchBusinessDate: rows[0]!.batchBusinessDate,
    previousReimbursements: rows.map((row) => ({
      id: row.id,
      status: row.status,
      paymentProofPath: row.paymentProofPath,
      paymentBusinessDate: row.paymentBusinessDate,
      completedTime: row.completedTime,
      receiptConfirmedBy: row.receiptConfirmedBy,
    })),
  };
  const batchUpdate = await client.query(
    `UPDATE payment_batches
        SET payment_proof_path = $2, payment_business_date = $3::date,
            updated_at = $4
      WHERE id = $1 AND status = ANY($5::text[])`,
    [batchId, proofPath, businessDate, now, ["uploaded", "confirmed"]],
  );
  if (batchUpdate.rowCount !== 1) throw new Error("付款批次状态已变化");
  const reimbursementUpdate = await client.query(
    `UPDATE reimbursements
        SET payment_proof_path = $2, payment_business_date = $3::date,
            updated_at = $4
      WHERE id = ANY($1::text[])
        AND status = ANY($5::text[]) AND is_deleted = FALSE
        AND payment_batch_id = $6`,
    [
      rows.map((row) => row.id),
      proofPath,
      businessDate,
      now,
      ["payment_uploaded", "completed"],
      batchId,
    ],
  );
  if (reimbursementUpdate.rowCount !== rows.length) {
    throw new Error("报销单状态已变化");
  }
  for (const row of rows) {
    const approval = await client.query<{ id: string }>(
      `SELECT id FROM approval_instances
        WHERE target_id = $1 AND target_type = 'reimbursement'
        ORDER BY created_at DESC LIMIT 1`,
      [row.id],
    );
    if (approval.rows[0]) {
      await client.query(
        `INSERT INTO approval_records(
           id, instance_id, step, approver_id, action, comment, action_time
         ) VALUES($1,$2,99,$3,'payment_proof_replaced',$4,$5)`,
        [
          `ar_${nanoid(12)}`,
          approval.rows[0].id,
          actorId,
          "月底银行裁片已替换当前付款凭证，原凭证保留审计",
          now,
        ],
      );
    }
  }
  const option: MatchOption = {
    transactionIds: transactions.map((row) => row.id),
    reimbursementIds: rows.map((row) => row.id),
    pendingBatchId: batchId,
    allocations,
    batchScope,
  };
  const links = linksForOption(
    option,
    transactions,
    rows,
    batchId,
    "replaced",
    {
      cropHashes: identities.map((row) => row.fileHash),
      previousEvidence,
    },
  );
  return {
    group: {
      transactionIds: option.transactionIds,
      reimbursementIds: option.reimbursementIds,
      paymentBatchId: batchId,
      displayAction: "replaced",
    },
    links,
    evidence: previousEvidence,
  };
}

export async function reconcileMonthlyReimbursementTransactions(
  client: PoolClient,
  input: { reportMonth: string; actorId: string; now: string },
): Promise<MonthlyReimbursementReconciliationResult> {
  const result: MonthlyReimbursementReconciliationResult = {
    links: [],
    matchedGroups: [],
    pendingTransactions: [],
    replacedEvidence: [],
  };
  const transactions = await loadMonthlyTransactions(client, input.reportMonth);
  if (!transactions.length) return result;
  // 与审批中心保持相同锁顺序：先锁全部付款凭证身份，再锁批次和报销行。
  // 后续分组内重复取得同一事务级咨询锁是幂等的。
  await lockPaymentProofIdentities(
    client,
    transactions.map((transaction) => ({
      fileHash: cropHash(transaction.cropPath),
      proofNo: transaction.normalizedProofNo,
    })),
  );
  const assignedTransactions = new Set<string>();
  const assignedReimbursements = new Set<string>();

  for (const replacement of await replacementGroups(client, transactions)) {
    if (
      replacement.transactions.some((row) => assignedTransactions.has(row.id))
    )
      continue;
    const applied = await applyReplacement(
      client,
      replacement.batchId,
      replacement.transactions,
      input.actorId,
      input.now,
      input.reportMonth,
    );
    if (!applied) continue;
    applied.group.transactionIds.forEach((id) => assignedTransactions.add(id));
    applied.group.reimbursementIds.forEach((id) =>
      assignedReimbursements.add(id),
    );
    result.links.push(...applied.links);
    result.matchedGroups.push(applied.group);
    if (applied.evidence) result.replacedEvidence.push(applied.evidence);
  }

  const remaining = transactions.filter(
    (row) => !assignedTransactions.has(row.id),
  );
  const employeeIds = [...new Set(remaining.map((row) => row.employeeId))];
  const pendingItems = await loadPendingBatchItems(client, employeeIds);
  const pendingOptions: MatchOption[] = [];
  const pendingByBatch = new Map<string, BatchItemRow[]>();
  for (const item of pendingItems) {
    const rows = pendingByBatch.get(item.batchId) || [];
    rows.push(item);
    pendingByBatch.set(item.batchId, rows);
  }
  for (const [batchId, items] of pendingByBatch) {
    if (!items.length) continue;
    if (
      items.some(
        (row) =>
          !["approved", "paid"].includes(row.status) ||
          row.employeeId !== items[0]!.employeeId ||
          row.type !== items[0]!.type,
      )
    )
      continue;
    const candidates = remaining.filter(
      (row) =>
        row.employeeId === items[0]!.employeeId &&
        row.reimbursementType === items[0]!.type,
    );
    const target = moneyToCents(items[0]!.batchAmount);
    const snapshotTotal = items.reduce(
      (sum, row) => sum + row.itemAmountCents,
      0n,
    );
    if (
      snapshotTotal !== target ||
      items.some(
        (row) =>
          row.paymentBatchId !== batchId ||
          row.itemAmountCents !== row.amountCents,
      )
    )
      continue;
    const subsets = uniqueSubsets(candidates, target);
    if (subsets.length === 1) {
      pendingOptions.push({
        transactionIds: subsets[0]!.map((row) => row.id).sort(),
        reimbursementIds: items.map((row) => row.id).sort(),
        pendingBatchId: batchId,
      });
    }
  }
  for (const option of onlyUnambiguousOptions(pendingOptions)) {
    if (option.transactionIds.some((id) => assignedTransactions.has(id)))
      continue;
    const itemRows = pendingItems.filter((row) =>
      option.reimbursementIds.includes(row.id),
    );
    const applied = await applyNewAttachment(
      client,
      option,
      remaining,
      itemRows,
      input.actorId,
      input.now,
      input.reportMonth,
    );
    if (!applied) continue;
    option.transactionIds.forEach((id) => assignedTransactions.add(id));
    option.reimbursementIds.forEach((id) => assignedReimbursements.add(id));
    const group: MonthlyReimbursementMatchedGroup = {
      transactionIds: option.transactionIds,
      reimbursementIds: option.reimbursementIds,
      paymentBatchId: applied.batchId,
      displayAction: "attached",
    };
    result.links.push(...applied.links);
    result.matchedGroups.push(group);
  }

  const paid = await loadPaidReimbursements(client, employeeIds);
  const groupKeys = new Set(
    remaining
      .filter((row) => !assignedTransactions.has(row.id))
      .map((row) => `${row.employeeId}|${row.reimbursementType}`),
  );
  const paidOptions: MatchOption[] = [];
  for (const key of groupKeys) {
    const [employeeId, type] = key.split("|");
    const transactionRows = remaining.filter(
      (row) =>
        !assignedTransactions.has(row.id) &&
        row.employeeId === employeeId &&
        row.reimbursementType === type,
    );
    const reimbursementRows = paid.filter(
      (row) =>
        !assignedReimbursements.has(row.id) &&
        row.employeeId === employeeId &&
        row.type === type,
    );
    paidOptions.push(...buildPaidOptions(transactionRows, reimbursementRows));
  }
  for (const option of onlyUnambiguousOptions(paidOptions)) {
    if (
      option.transactionIds.some((id) => assignedTransactions.has(id)) ||
      option.reimbursementIds.some((id) => assignedReimbursements.has(id))
    )
      continue;
    const applied = await applyNewAttachment(
      client,
      option,
      remaining,
      paid,
      input.actorId,
      input.now,
      input.reportMonth,
    );
    if (!applied) continue;
    option.transactionIds.forEach((id) => assignedTransactions.add(id));
    option.reimbursementIds.forEach((id) => assignedReimbursements.add(id));
    result.links.push(...applied.links);
    result.matchedGroups.push({
      transactionIds: option.transactionIds,
      reimbursementIds: option.reimbursementIds,
      paymentBatchId: applied.batchId,
      displayAction: "attached",
    });
  }

  for (const transaction of transactions) {
    if (assignedTransactions.has(transaction.id)) continue;
    result.pendingTransactions.push({
      transactionIds: [transaction.id],
      reason: "已匹配员工，暂未找到可唯一关联的报销单",
    });
  }
  for (const link of result.links) {
    await upsertActiveLink(client, input.actorId, input.now, link);
  }
  return result;
}
