import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { db } from "../db/index.js";
import { requireRole } from "../middleware/auth.js";
import {
  cleanupContractSealApplicationArtifact,
  ContractSealApplicationError,
  generateSignedContractSealApplication,
  extractContractSealCopyCount,
  normalizeContractSealApplicationFields,
  type ContractSealApplicationArtifact,
  type ContractSealApplicationEditableFields,
} from "../services/contractSealApplication.js";
import { ContractDomainError } from "../services/contractService.js";

const router = Router();
const requireFinance = requireRole(["admin", "super_admin", "chairman"]);
const requireSealApplicationRead = requireRole([
  "admin",
  "super_admin",
  "chairman",
  "general_manager",
]);

interface ContractSealApplicationContractRow {
  id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  title: string | null;
  project_name: string | null;
  party_a: string | null;
  party_b: string | null;
  amount_delta: number | null;
  category: "main_business" | "non_main" | "asset" | null;
  relation_type: "main" | "supplement" | "termination";
  area: string;
  status: string;
  version: number;
  created_by: string;
}

interface ContractSealApplicationRow {
  id: string;
  contract_id: string;
  form_version: number;
  contract_version: number;
  form_data_json: unknown;
  status: "draft" | "signed" | "superseded";
  signed_file_id: string | null;
  signer_id: string | null;
  signer_name: string | null;
  signer_role: string | null;
  signer_department: string | null;
  signed_at: string | null;
  approved_file_id: string | null;
  approver_name: string | null;
  approver_role: string | null;
  approver_signed_at: string | null;
  updated_at: string;
}

const CATEGORY_LABELS = {
  main_business: "主营项目合同",
  non_main: "非主营项目合同",
  asset: "资产类合同",
} as const;

const RELATION_LABELS = {
  main: "主合同",
  supplement: "补充协议",
  termination: "解除协议书",
} as const;

const DEFAULT_FIELDS: ContractSealApplicationEditableFields = {
  sealPurpose: "申请对本合同办理用印",
  sealType: "contract",
  copyCount: 0,
  crossPageSeal: true,
  note: "",
};

function actor(req: Request) {
  const id = req.session.userId || req.session.user?.id;
  const role = req.session.user?.role;
  if (!id || !role) {
    throw new ContractDomainError(401, "登录状态已失效");
  }
  return { id, role };
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof ContractDomainError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
  if (error instanceof ContractSealApplicationError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function parseStoredFields(
  value: unknown,
): ContractSealApplicationEditableFields {
  if (!value || typeof value !== "object") return { ...DEFAULT_FIELDS };
  const record = value as Record<string, unknown>;
  const candidate =
    record.fields && typeof record.fields === "object"
      ? (record.fields as ContractSealApplicationEditableFields)
      : (record as unknown as ContractSealApplicationEditableFields);
  try {
    return normalizeContractSealApplicationFields(candidate);
  } catch {
    return { ...DEFAULT_FIELDS };
  }
}

function toApplicationApi(
  row: ContractSealApplicationRow | undefined,
  contractVersion: number,
  recognizedCopyCount: number | null = null,
) {
  const storedFields = row
    ? parseStoredFields(row.form_data_json)
    : { ...DEFAULT_FIELDS };
  const signed = row?.status === "signed";
  const signedCopyCount =
    signed &&
    Number.isInteger(storedFields.copyCount) &&
    storedFields.copyCount >= 1 &&
    storedFields.copyCount <= 20
      ? storedFields.copyCount
      : null;
  const copyCount = signed ? signedCopyCount : recognizedCopyCount;
  const copyCountRecognition = signed
    ? {
        status: "signed_snapshot" as const,
        code: signedCopyCount
          ? null
          : "CONTRACT_SEAL_COPY_COUNT_SNAPSHOT_MISSING",
        message: signedCopyCount ? null : "已签用印申请单缺少可信份数快照",
      }
    : recognizedCopyCount
      ? {
          status: "recognized" as const,
          code: null,
          message: null,
        }
      : {
          status: "unrecognized" as const,
          code: "CONTRACT_SEAL_COPY_COUNT_NOT_RECOGNIZED",
          message: "系统未能从合同正文形成唯一可信的“一式几份”用印总份数",
        };
  return {
    id: row?.id || null,
    formVersion: row?.form_version || 0,
    contractVersion: row?.contract_version || contractVersion,
    status: row?.status || "draft",
    fields: {
      ...storedFields,
      copyCount,
    },
    copyCountRecognition,
    signedFileId: row?.signed_file_id || null,
    signerName: row?.signer_name || null,
    signerRole: row?.signer_role || null,
    signerDepartment: row?.signer_department || null,
    signedAt: row?.signed_at || null,
    approvedFileId: row?.approved_file_id || null,
    approverName: row?.approver_name || null,
    approverRole: row?.approver_role || null,
    approverSignedAt: row?.approver_signed_at || null,
    fullySigned: Boolean(row?.approved_file_id && row?.approver_signed_at),
    updatedAt: row?.updated_at || null,
    stale: Boolean(row && row.contract_version !== contractVersion),
  };
}

function requireRecognizedCopyCount(rawText: unknown): number {
  const copyCount = extractContractSealCopyCount(rawText);
  if (!copyCount) {
    throw new ContractSealApplicationError(
      "系统未能从合同正文形成唯一可信的“一式几份”用印总份数，暂不能办理用印",
      409,
      "CONTRACT_SEAL_COPY_COUNT_NOT_RECOGNIZED",
    );
  }
  return copyCount;
}

async function lockedRecognizedCopyCount(
  client: Pick<PoolClient, "query">,
  contractId: string,
): Promise<number> {
  const result = await client.query<{ raw_text: string | null }>(
    `SELECT job.raw_text FROM contract_ocr_jobs job
     JOIN contract_files file ON file.id = job.file_id
     WHERE job.contract_id = $1 AND job.status IN ('succeeded', 'partial')
       AND file.file_type = 'draft_contract' AND file.is_current = TRUE
       AND COALESCE(job.raw_text, '') <> ''
     ORDER BY job.created_at DESC, job.id DESC LIMIT 1`,
    [contractId],
  );
  return requireRecognizedCopyCount(result.rows[0]?.raw_text);
}

async function lockContract(client: PoolClient, contractId: string) {
  const result = await client.query<ContractSealApplicationContractRow>(
    `SELECT id, contract_no, business_contract_no, title, project_name, party_a, party_b,
            amount_delta, category, relation_type, area, status, version,
            created_by
     FROM contracts
     WHERE id = $1 AND is_deleted = FALSE
     FOR UPDATE`,
    [contractId],
  );
  const contract = result.rows[0];
  if (!contract) throw new ContractDomainError(404, "合同不存在");
  if (contract.status !== "draft") {
    throw new ContractDomainError(409, "仅草拟合同可以编辑和签署用印申请单");
  }
  if (!contract.party_a || !contract.party_b) {
    throw new ContractDomainError(
      409,
      "请先完成合同甲乙方识别再填写用印申请单",
    );
  }
  return contract;
}

async function currentApplication(
  client: PoolClient,
  contractId: string,
  lock = false,
) {
  const result = await client.query<ContractSealApplicationRow>(
    `SELECT id, contract_id, form_version, contract_version, form_data_json,
            status, signed_file_id, signer_id, signer_name, signer_role,
            signer_department, signed_at, approved_file_id, approver_name,
            approver_role, approver_signed_at, updated_at
     FROM contract_seal_applications
     WHERE contract_id = $1 AND is_current = TRUE
     ORDER BY form_version DESC, created_at DESC, id DESC
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [contractId],
  );
  return result.rows[0];
}

router.get(
  "/:id/seal-application",
  requireSealApplicationRead,
  async (req, res) => {
    try {
      const contract = await db.get<ContractSealApplicationContractRow>(
        `SELECT id, contract_no, business_contract_no, title, project_name, party_a, party_b,
              amount_delta, category, relation_type, area, status, version,
              created_by
       FROM contracts WHERE id = ? AND is_deleted = FALSE`,
        req.params.id,
      );
      if (!contract) throw new ContractDomainError(404, "合同不存在");
      const application = await db.get<ContractSealApplicationRow>(
        `SELECT id, contract_id, form_version, contract_version, form_data_json,
              status, signed_file_id, signer_id, signer_name, signer_role,
              signer_department, signed_at, approved_file_id, approver_name,
              approver_role, approver_signed_at, updated_at
       FROM contract_seal_applications
       WHERE contract_id = ? AND is_current = TRUE
       ORDER BY form_version DESC, created_at DESC, id DESC LIMIT 1`,
        req.params.id,
      );
      const latestRecognition =
        application?.status === "signed"
          ? undefined
          : await db.get<{ raw_text: string | null }>(
              `SELECT job.raw_text FROM contract_ocr_jobs job
             JOIN contract_files file ON file.id = job.file_id
             WHERE job.contract_id = ?
               AND job.status IN ('succeeded', 'partial')
               AND file.file_type = 'draft_contract'
               AND file.is_current = TRUE
               AND COALESCE(job.raw_text, '') <> ''
             ORDER BY job.created_at DESC, job.id DESC LIMIT 1`,
              req.params.id,
            );
      const recognizedCopyCount =
        application?.status === "signed"
          ? null
          : extractContractSealCopyCount(latestRecognition?.raw_text);
      res.json({
        success: true,
        data: {
          ...toApplicationApi(
            application,
            contract.version,
            recognizedCopyCount,
          ),
          contract: {
            contractNo:
              contract.business_contract_no ||
              contract.contract_no ||
              "草拟合同",
            title: contract.title,
            projectName: contract.project_name,
            partyA: contract.party_a,
            partyB: contract.party_b,
            amount:
              contract.relation_type === "termination"
                ? 0
                : contract.amount_delta,
            categoryLabel: contract.category
              ? CATEGORY_LABELS[contract.category]
              : "待识别",
            relationLabel: RELATION_LABELS[contract.relation_type],
            area: contract.area,
          },
        },
      });
    } catch (error) {
      sendError(res, error, "读取用印申请单失败");
    }
  },
);

router.put("/:id/seal-application", requireFinance, async (req, res) => {
  try {
    const currentActor = actor(req);
    const expectedVersion = Number(req.body?.expectedVersion);
    const result = await db.transaction(async (client) => {
      const contract = await lockContract(client, req.params.id);
      const copyCount = await lockedRecognizedCopyCount(client, contract.id);
      const fields = normalizeContractSealApplicationFields({
        ...req.body?.fields,
        copyCount,
      });
      if (contract.version !== expectedVersion) {
        throw new ContractDomainError(409, "合同版本已变化，请刷新后重试");
      }
      const existing = await currentApplication(client, contract.id, true);
      const now = new Date().toISOString();
      let applicationId = existing?.id || nanoid();
      let formVersion = existing?.form_version || 1;
      if (existing?.status === "signed") {
        await client.query(
          `UPDATE contract_seal_applications
           SET status = 'superseded', is_current = FALSE, updated_by = $2,
               updated_at = $3
           WHERE id = $1`,
          [existing.id, currentActor.id, now],
        );
        if (existing.signed_file_id) {
          await client.query(
            `UPDATE contract_files SET is_current = FALSE WHERE id = $1`,
            [existing.signed_file_id],
          );
        }
        applicationId = nanoid();
        formVersion += 1;
      }
      const data = JSON.stringify({ fields });
      if (!existing || existing.status === "signed") {
        await client.query(
          `INSERT INTO contract_seal_applications (
             id, contract_id, form_version, contract_version, form_data_json,
             status, created_by, updated_by, created_at, updated_at, is_current
           ) VALUES ($1,$2,$3,$4,$5::jsonb,'draft',$6,$6,$7,$7,TRUE)`,
          [
            applicationId,
            contract.id,
            formVersion,
            contract.version,
            data,
            currentActor.id,
            now,
          ],
        );
      } else {
        await client.query(
          `UPDATE contract_seal_applications
           SET contract_version = $2, form_data_json = $3::jsonb,
               updated_by = $4, updated_at = $5
           WHERE id = $1`,
          [applicationId, contract.version, data, currentActor.id, now],
        );
      }
      return {
        application: await currentApplication(client, contract.id),
        copyCount,
      };
    });
    res.json({
      success: true,
      data: toApplicationApi(
        result.application,
        expectedVersion,
        result.copyCount,
      ),
    });
  } catch (error) {
    sendError(res, error, "保存用印申请单失败");
  }
});

router.post("/:id/seal-application/sign", requireFinance, async (req, res) => {
  let artifact: ContractSealApplicationArtifact | null = null;
  try {
    const currentActor = actor(req);
    const expectedVersion = Number(req.body?.expectedVersion);
    const result = await db.transaction(async (client) => {
      const contract = await lockContract(client, req.params.id);
      const copyCount = await lockedRecognizedCopyCount(client, contract.id);
      const fields = normalizeContractSealApplicationFields({
        ...req.body?.fields,
        copyCount,
      });
      if (contract.version !== expectedVersion) {
        throw new ContractDomainError(409, "合同版本已变化，请刷新后重新签名");
      }
      if (contract.created_by !== currentActor.id) {
        throw new ContractDomainError(
          403,
          "用印申请单必须由合同创建人本人完成电子签名",
          "SEAL_APPLICATION_CREATOR_SIGNATURE_REQUIRED",
        );
      }
      const existing = await currentApplication(client, contract.id, true);
      const formVersion = existing
        ? existing.status === "draft"
          ? existing.form_version
          : existing.form_version + 1
        : 1;
      artifact = await generateSignedContractSealApplication(client, {
        contractId: contract.id,
        contractVersion: contract.version,
        formVersion,
        actorId: currentActor.id,
        contract: {
          contractNo:
            contract.business_contract_no ||
            contract.contract_no ||
            `草拟合同-${contract.id}`,
          contractTitle: contract.title,
          partyA: contract.party_a || "",
          partyB: contract.party_b || "",
          projectName: contract.project_name,
          amount:
            contract.relation_type === "termination"
              ? "0.00"
              : contract.amount_delta === null
                ? null
                : Number(contract.amount_delta).toFixed(2),
          categoryLabel: contract.category
            ? CATEGORY_LABELS[contract.category]
            : "待识别",
          relationLabel: RELATION_LABELS[contract.relation_type],
          area: contract.area,
        },
        fields,
      });
      const generated = artifact;
      const now = new Date().toISOString();

      if (existing) {
        await client.query(
          `UPDATE contract_seal_applications
           SET status = 'superseded', is_current = FALSE, updated_by = $2,
               updated_at = $3
           WHERE id = $1`,
          [existing.id, currentActor.id, now],
        );
      }
      await client.query(
        `UPDATE contract_files SET is_current = FALSE
         WHERE contract_id = $1 AND file_type = 'seal_application'
           AND is_current = TRUE`,
        [contract.id],
      );
      const fileId = nanoid();
      await client.query(
        `INSERT INTO contract_files (
           id, contract_id, file_type, file_name, file_path, file_size,
           mime_type, file_hash, version, is_current, uploaded_by, created_at
         ) VALUES ($1,$2,'seal_application',$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`,
        [
          fileId,
          contract.id,
          generated.file.fileName,
          generated.file.filePath,
          generated.file.fileSize,
          generated.file.mimeType,
          generated.file.fileHash,
          formVersion,
          currentActor.id,
          now,
        ],
      );
      const applicationId = nanoid();
      await client.query(
        `INSERT INTO contract_seal_applications (
           id, contract_id, form_version, contract_version, form_data_json,
           status, signed_file_id, signer_id, signer_name, signer_role,
           signer_department, signature_snapshot_path, signed_at, created_by,
           updated_by, created_at, updated_at, is_current
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,'signed',$6,$7,$8,$9,$10,$11,$12,
           $7,$7,$13,$13,TRUE
         )`,
        [
          applicationId,
          contract.id,
          formVersion,
          contract.version,
          JSON.stringify({ fields, contract: generated.contract }),
          fileId,
          generated.signer.id,
          generated.signer.name,
          generated.signer.role,
          generated.signer.department,
          generated.signer.signaturePath,
          generated.signer.signedAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO contract_audit_logs (
           id, contract_id, action, actor_id, actor_role, from_status,
           to_status, changes_json, created_at
         ) VALUES ($1,$2,'seal_application_signed',$3,$4,$5,$5,$6::jsonb,$7)`,
        [
          nanoid(),
          contract.id,
          currentActor.id,
          currentActor.role,
          contract.status,
          JSON.stringify({
            applicationId,
            formVersion,
            contractVersion: contract.version,
            fileId,
            signatureType: "personal",
          }),
          now,
        ],
      );
      return {
        application: await currentApplication(client, contract.id),
        copyCount,
      };
    });
    artifact = null;
    res.json({
      success: true,
      data: toApplicationApi(
        result.application,
        expectedVersion,
        result.copyCount,
      ),
      message: "用印申请单已生成并完成电子签名",
    });
  } catch (error) {
    cleanupContractSealApplicationArtifact(artifact);
    sendError(res, error, "签署用印申请单失败");
  }
});

export default router;
