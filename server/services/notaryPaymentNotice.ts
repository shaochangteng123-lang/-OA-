import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import type { PoolClient } from "pg";
import { nanoid } from "nanoid";
import { callPaddleOcrDetailed, type PaddleOcrLine } from "./ocrDaemon.js";

export interface NotaryNoticeValues {
  title: string;
  amount: string;
  counterparty: string;
  noticeDate: string;
}

/** 用户确认的公证费付款主体；不得从通知收件人反推付款单位。 */
export const NOTARY_NOTICE_PAYER = "北京羽隶工程咨询有限公司";

/** 只采用通知标题、明确合计、收款单位和落款日期，不猜测申请日期或我方单位。 */
export function parseNotaryPaymentNotice(text: string): NotaryNoticeValues {
  const lines = text
    .normalize("NFKC")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ""));
  const titles = [
    ...new Set(
      lines.slice(0, 8).filter((line) => /^.{0,40}公证费付款通知$/u.test(line)),
    ),
  ];
  const compact = lines.join("");
  const names = [
    ...new Set(
      [
        ...compact.matchAll(
          /单位名称[:：]([\u4e00-\u9fff]{2,35}公证处)[;；:：。]/gu,
        ),
      ].map((match) => match[1]),
    ),
  ];
  const amounts = [
    ...new Set(
      [
        ...compact.matchAll(
          /公证费用?合计[:：]?[¥￥]?([\d,]+(?:\.\d{1,2})?)元/gu,
        ),
      ].map((match) => Number(match[1].replace(/,/g, "")).toFixed(2)),
    ),
  ];
  if (
    titles.length !== 1 ||
    names.length !== 1 ||
    amounts.length !== 1 ||
    !Number.isFinite(Number(amounts[0])) ||
    Number(amounts[0]) <= 0
  ) {
    throw new Error(
      "付款通知的标题、合计金额或公证处名称缺失或存在冲突，请上传清晰的公证费付款通知原件",
    );
  }
  const footer = compact.slice(compact.lastIndexOf(names[0]) + names[0].length);
  const dates = [
    ...new Set(
      [...footer.matchAll(/(20\d{2})年(\d{1,2})月(\d{1,2})日/gu)].map(
        (match) =>
          `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
      ),
    ),
  ];
  const date = dates[0];
  if (
    dates.length !== 1 ||
    !date ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(
      "未能唯一识别付款通知落款日期，不能用表格申请日期或上传日期替代",
    );
  }
  return {
    title: titles[0],
    amount: amounts[0],
    counterparty: names[0],
    noticeDate: date,
  };
}

export async function recognizeNotaryPaymentNotice(
  filePath: string,
  mimeType: string,
) {
  if (mimeType !== "application/pdf")
    throw new Error("公证费付款通知仅支持PDF（便携式文档格式）原件");
  const pdf = await PDFDocument.load(fs.readFileSync(filePath));
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 20)
    throw new Error("付款通知页数必须为1至20页");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "notary-notice-"));
  const lines: Array<
    PaddleOcrLine & { pageNumber: number; modelVersion: string }
  > = [];
  try {
    execFileSync(
      "pdftoppm",
      ["-scale-to", "1800", "-png", filePath, path.join(temp, "page")],
      { timeout: 120000 },
    );
    const files = fs
      .readdirSync(temp)
      .filter((name) => /^page-\d+\.png$/u.test(name))
      .sort(
        (a, b) => Number(a.match(/\d+/u)?.[0]) - Number(b.match(/\d+/u)?.[0]),
      );
    if (files.length !== pdf.getPageCount())
      throw new Error("付款通知页面转换不完整，请重新上传");
    const texts: string[] = [];
    for (const [index, file] of files.entries()) {
      const result = await callPaddleOcrDetailed(path.join(temp, file));
      texts.push(result.fullText);
      lines.push(
        ...result.lines.map((line) => ({
          ...line,
          pageNumber: index + 1,
          modelVersion: result.modelVersion,
        })),
      );
    }
    const rawText = texts.join("\n");
    return { values: parseNotaryPaymentNotice(rawText), rawText, lines };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** 专用通知单事务：普通合同不得借此跳过审批。 */
export async function activateNotaryPaymentNotice(
  client: PoolClient,
  input: {
    contractId: string;
    jobId: string;
    fileId: string;
    workerToken: string;
  },
  result: Awaited<ReturnType<typeof recognizeNotaryPaymentNotice>>,
) {
  const current = await client.query<{ created_by: string; role: string }>(
    `SELECT c.created_by,u.role FROM contracts c JOIN users u ON u.id=c.created_by
     WHERE c.id=$1 AND c.status='draft' AND c.is_deleted=FALSE
       AND c.declared_category='asset' AND c.declared_subtype='notary_fee'
       AND c.asset_category='notary_fee' AND c.relation_type='main'
       AND c.parent_contract_id IS NULL AND c.project_id IS NULL FOR UPDATE OF c`,
    [input.contractId],
  );
  if (!current.rows[0])
    throw new Error("公证费通知单状态或分类已变化，不能直接生效");
  const job = await client.query(
    `SELECT j.id FROM contract_ocr_jobs j JOIN contract_files f ON f.id=j.file_id
     WHERE j.id=$1 AND j.contract_id=$2 AND j.file_id=$3 AND j.worker_token=$4
       AND j.status='processing' AND f.contract_id=$2 AND f.mime_type='application/pdf'
       AND f.file_type='draft_contract' AND f.is_current=TRUE FOR UPDATE OF j,f`,
    [input.jobId, input.contractId, input.fileId, input.workerToken],
  );
  if (!job.rows[0]) throw new Error("付款通知识别任务已失效，不能覆盖当前结果");
  const v = result.values;
  const now = new Date().toISOString();
  const actor = current.rows[0];
  await client.query(
    `UPDATE contracts SET title=$2,project_name=$2,party_a=$8,party_b=$3,
    category='asset',amount_delta=$4::numeric,original_contract_amount=$4::numeric,
    current_effective_amount=$4::numeric,contract_date=$5,contract_date_source='ocr',
    financial_direction='cost',asset_funding_mode='engineering_direct',
    requires_auxiliary_materials=FALSE,status='effective',
    effective_at=$6,sealed_at=$6,pending_action=NULL,previous_status=NULL,
    updated_at=$6,updated_by=$7,version=version+1 WHERE id=$1`,
    [
      input.contractId,
      v.title,
      v.counterparty,
      v.amount,
      v.noticeDate,
      now,
      actor.created_by,
      NOTARY_NOTICE_PAYER,
    ],
  );
  await client.query(
    "UPDATE contract_files SET file_type='sealed_contract' WHERE id=$1 AND contract_id=$2",
    [input.fileId, input.contractId],
  );
  await client.query(
    `UPDATE contract_ocr_jobs SET status='succeeded',method='paddleocr',
    parser_version='notary-notice-v1',raw_text=$2,warnings_json=$3::jsonb,error_message=NULL,
    finished_at=$4,updated_at=$4,worker_token=NULL,lease_expires_at=NULL WHERE id=$1`,
    [
      input.jobId,
      result.rawText,
      JSON.stringify([
        "公证费通知单按已盖章原件直接生效，不生成合同审批；我方单位不从通知收件人推断",
      ]),
      now,
    ],
  );
  await client.query("DELETE FROM contract_ocr_fields WHERE job_id=$1", [
    input.jobId,
  ]);
  for (const [field, value] of Object.entries({
    project_name: v.title,
    party_a: NOTARY_NOTICE_PAYER,
    party_b: v.counterparty,
    amount: v.amount,
    contract_date: v.noticeDate,
    category: "asset",
  })) {
    await client.query(
      `INSERT INTO contract_ocr_fields(id,job_id,contract_id,field_code,original_value,normalized_value,final_value,confidence,source,evidence,created_at,updated_at)
      VALUES($1,$2,$3,$4,CASE WHEN $4='party_a' THEN NULL ELSE $5 END,$5,$5,0,$8,$6,$7,$7)`,
      [
        nanoid(),
        input.jobId,
        input.contractId,
        field,
        value,
        field === "party_a"
          ? "用户确认由北京羽隶工程咨询有限公司缴纳，非通知抬头识别结果"
          : "通知单专用规则，原始逐行识别证据另存",
        now,
        field === "party_a" ? "business_rule" : "notary_notice_rule",
      ],
    );
  }
  await client.query("DELETE FROM contract_ocr_lines WHERE job_id=$1", [
    input.jobId,
  ]);
  for (const [index, line] of result.lines.entries()) {
    await client.query(
      `INSERT INTO contract_ocr_lines(id,job_id,contract_id,line_index,page_number,text,bbox,confidence,model_version,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        nanoid(),
        input.jobId,
        input.contractId,
        index,
        line.pageNumber,
        line.text,
        JSON.stringify(line.box),
        line.confidence,
        line.modelVersion,
        now,
      ],
    );
  }
  await client.query(
    `INSERT INTO contract_audit_logs(id,contract_id,action,actor_id,actor_role,from_status,to_status,changes_json,comment,created_at)
    VALUES($1,$2,'notary_notice_effective',$3,$4,'draft','effective',$5::jsonb,$6,$7)`,
    [
      nanoid(),
      input.contractId,
      actor.created_by,
      actor.role,
      JSON.stringify({
        fileId: input.fileId,
        jobId: input.jobId,
        values: v,
        payer: NOTARY_NOTICE_PAYER,
        payerSource: "business_rule",
        assetFundingMode: "engineering_direct",
      }),
      "已盖章公证费付款通知识别通过，按专用规则直接生效，无合同审批轮次",
      now,
    ],
  );
}
