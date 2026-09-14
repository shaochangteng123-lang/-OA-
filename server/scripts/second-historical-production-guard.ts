import crypto from "node:crypto";

import type { SecondHistoricalImportPlan } from "./second-historical-import-plan.js";
import { SECOND_HISTORICAL_IMPORT_BATCH_KEY } from "./second-historical-import-config.js";

interface QueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const NON_SEMANTIC_CONTRACT_FIELDS = new Set([
  "created_at",
  "updated_at",
  "submitted_at",
  "approved_at",
  "rejected_at",
  "sealed_at",
  "effective_at",
  "executing_at",
  "completed_at",
  "terminated_at",
  "deleted_at",
  "financial_direction_confirmed_at",
]);

const DRAGON_MUTABLE_FIELDS = new Set([
  "status",
  "version",
  "is_deleted",
  "updated_by",
]);

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error("第二批语义摘要包含不支持的值类型");
}

function digest(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function amount(value: number | null | undefined): string | null {
  return value == null ? null : Number(value).toFixed(2);
}

function quantity(value: number | null | undefined): string | null {
  return value == null ? null : Number(value).toFixed(4);
}

export function secondHistoricalStableId(scope: string, key: string): string {
  const value = crypto
    .createHash("sha256")
    .update(`${SECOND_HISTORICAL_IMPORT_BATCH_KEY}\0${scope}\0${key}`)
    .digest("base64url")
    .slice(0, 20);
  return `h2_${value}`;
}

export function buildSecondHistoricalSemanticManifest(
  plan: SecondHistoricalImportPlan,
): CanonicalValue {
  return canonicalize({
    version: "second-historical-semantic-v1",
    batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    sourceManifestSha256: plan.manifestHash,
    roots: [...plan.roots]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((root) => ({
        key: root.key,
        targetContractId:
          root.restoreContractId ||
          secondHistoricalStableId("contract", root.key),
        restoredContractId: root.restoreContractId,
        projectName: root.projectName,
        partyA: root.family.partyA,
        partyB: root.family.partyB,
        partyC: root.family.partyC || null,
        category: root.family.category,
        subtype: root.family.declaredSubtype,
        area: root.family.area,
        contractDate: root.contractDate,
        originalAmount: amount(root.originalAmount),
        currentAmount: amount(root.currentAmount),
        financialDirection: root.financialDirection,
        businessContractNo: root.businessContractNo,
        pricing: root.family.target
          ? {
              mode: "target",
              targetAmount: amount(root.family.target.amount),
              targetQuantity: quantity(root.family.target.quantity),
              unitPrice: amount(root.family.target.unitPrice),
              confirmedAmount: amount(root.family.target.confirmedAmount),
              confirmedQuantity: quantity(root.family.target.confirmedQuantity),
              quantityUnit: root.family.target.quantityUnit,
            }
          : { mode: "fixed" },
        source: {
          path: root.source.relativePath,
          sha256: root.source.hash,
          bytes: root.source.bytes,
        },
        agreements: root.agreements.map((agreement) => ({
          targetContractId: secondHistoricalStableId(
            "agreement",
            agreement.source.relativePath,
          ),
          relationType: agreement.relationType,
          sequence: agreement.sequence,
          contractDate: agreement.contractDate,
          amountBefore: amount(agreement.amountBefore),
          amountDelta: amount(agreement.amountDelta),
          amountAfter: amount(agreement.amountAfter),
          sourcePath: agreement.source.relativePath,
          sourceSha256: agreement.source.hash,
          sourceBytes: agreement.source.bytes,
        })),
        financialFacts: root.financialFacts.map((fact) => ({
          targetRecordId: secondHistoricalStableId(
            "financial",
            fact.source.relativePath,
          ),
          ownerContractId:
            root.restoreContractId ||
            secondHistoricalStableId("contract", root.key),
          kind: fact.kind,
          amount: amount(fact.amount),
          businessDate: fact.businessDate,
          invoiceNo: fact.invoiceNo,
          sourcePath: fact.source.relativePath,
          sourceSha256: fact.source.hash,
          sourceBytes: fact.source.bytes,
        })),
        archiveFiles: root.archiveFiles.map((file) => ({
          path: file.relativePath,
          kind: file.kind,
          sha256: file.hash,
          bytes: file.bytes,
        })),
        auxiliaryFiles: root.auxiliaryFiles.map((file) => ({
          path: file.relativePath,
          kind: file.kind,
          sha256: file.hash,
          bytes: file.bytes,
        })),
      })),
    assignments: [...plan.assignments]
      .sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      )
      .map((assignment) => ({
        sourcePath: assignment.relativePath,
        sourceSha256: assignment.hash,
        familyId: assignment.familyId,
        rootKey: assignment.rootKey,
        target: assignment.target,
        accountingIncluded: assignment.accountingIncluded,
      })),
  });
}

export function calculateSecondHistoricalSemanticSha256(
  plan: SecondHistoricalImportPlan,
): string {
  return digest(buildSecondHistoricalSemanticManifest(plan));
}

function plannedNewContractIds(plan: SecondHistoricalImportPlan): string[] {
  return plan.roots.flatMap((root) => [
    ...(root.restoreContractId
      ? []
      : [secondHistoricalStableId("contract", root.key)]),
    ...root.agreements.map((agreement) =>
      secondHistoricalStableId("agreement", agreement.source.relativePath),
    ),
  ]);
}

function stableExistingContractSnapshot(
  id: string,
  snapshot: Record<string, unknown>,
): CanonicalValue {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (NON_SEMANTIC_CONTRACT_FIELDS.has(key)) continue;
    // 原生产基线计算时该字段为 false。更正后必须允许龙潭湖启用辅助材料，
    // 但仍规范化回原基线值，保持既有生产目标库指纹不变。
    if (
      id === "sdylIKVZJDN8jYQ342rOL" &&
      key === "requires_auxiliary_materials"
    ) {
      output[key] = false;
      continue;
    }
    if (id === "sdylIKVZJDN8jYQ342rOL" && DRAGON_MUTABLE_FIELDS.has(key)) {
      output[key] = "第二批恢复允许变化";
      continue;
    }
    output[key] = value;
  }
  return canonicalize(output);
}

export async function calculateSecondHistoricalTargetDatabaseSha256(
  client: QueryClient,
  plan: SecondHistoricalImportPlan,
): Promise<string> {
  const identity = await client.query<{
    database_name: string;
    database_oid: string;
    database_user: string;
    system_identifier: string;
  }>(
    `SELECT current_database() AS database_name,
       (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
       current_user AS database_user,
       (pg_control_system()).system_identifier::text AS system_identifier`,
  );
  if (!identity.rows[0]?.system_identifier) {
    throw new Error("无法读取生产数据库系统身份");
  }
  const contracts = await client.query<{
    id: string;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT id,to_jsonb(contracts.*) AS snapshot
       FROM contracts
      WHERE NOT (id=ANY($1::text[]))
      ORDER BY id`,
    [plannedNewContractIds(plan)],
  );
  return digest({
    version: "second-historical-target-database-v1",
    identity: identity.rows[0],
    existingContracts: contracts.rows.map((row) => ({
      id: row.id,
      snapshot: stableExistingContractSnapshot(row.id, row.snapshot),
    })),
  });
}
