import crypto from "node:crypto";

export const CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION = 1 as const;
export const CONTRACT_LEDGER_SNAPSHOT_KIND =
  "contract-ledger-snapshot" as const;
export const CONTRACT_LEDGER_SNAPSHOT_KEY =
  "contract-ledger-finalized-2026-08-28-v1";
export const CONTRACT_LEDGER_HISTORICAL_IMPORT_BATCH_KEY =
  "historical-import-2026-08-26-confirmed-v1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SnapshotRow = Record<string, JsonValue>;

export type ContractLedgerTableScope =
  | { kind: "contracts" }
  | { kind: "contract-column"; columnName: string }
  | {
      kind: "parent-table";
      columnName: string;
      parentTableName: string;
    };

export interface ContractLedgerTableDefinition {
  tableName: string;
  scope: ContractLedgerTableScope;
}

export const CONTRACT_LEDGER_SNAPSHOT_TABLES = [
  { tableName: "contracts", scope: { kind: "contracts" } },
  {
    tableName: "contract_files",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_auxiliary_packages",
    scope: { kind: "contract-column", columnName: "parent_contract_id" },
  },
  {
    tableName: "contract_auxiliary_files",
    scope: {
      kind: "parent-table",
      columnName: "package_id",
      parentTableName: "contract_auxiliary_packages",
    },
  },
  {
    tableName: "contract_ocr_jobs",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_ocr_fields",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_ocr_lines",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_financial_ocr_jobs",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_financial_file_hashes",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_invoices",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_invoice_line_items",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_receipts",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_payments",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_external_payments",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_payment_purpose_details",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_payment_deposit_receipts",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_deposits",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_deposit_settlements",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_deposit_settlement_receipts",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_financial_registrations",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_financial_registration_items",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_financial_registration_matches",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_approval_rounds",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_approval_records",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_seal_applications",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_seal_verifications",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_seal_verification_fields",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_download_requests",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "contract_download_request_files",
    scope: {
      kind: "parent-table",
      columnName: "request_id",
      parentTableName: "contract_download_requests",
    },
  },
  {
    tableName: "contract_download_request_audit_logs",
    scope: {
      kind: "parent-table",
      columnName: "request_id",
      parentTableName: "contract_download_requests",
    },
  },
  {
    tableName: "invoice_applications",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
  {
    tableName: "invoice_application_generated_files",
    scope: {
      kind: "parent-table",
      columnName: "application_id",
      parentTableName: "invoice_applications",
    },
  },
  {
    tableName: "invoice_application_materials",
    scope: {
      kind: "parent-table",
      columnName: "application_id",
      parentTableName: "invoice_applications",
    },
  },
  {
    tableName: "invoice_application_audit_logs",
    scope: {
      kind: "parent-table",
      columnName: "application_id",
      parentTableName: "invoice_applications",
    },
  },
  {
    tableName: "invoice_application_invoice_allocations",
    scope: {
      kind: "parent-table",
      columnName: "application_id",
      parentTableName: "invoice_applications",
    },
  },
  {
    tableName: "contract_audit_logs",
    scope: { kind: "contract-column", columnName: "contract_id" },
  },
] as const satisfies readonly ContractLedgerTableDefinition[];

export const CONTRACT_LEDGER_EXCLUDED_TABLES = [
  "users",
  "worklog_projects",
  "contract_rate_configs",
  "monthly_financial_reports",
  "monthly_financial_bank_files",
  "monthly_financial_bank_transactions",
  "monthly_financial_bank_transaction_links",
] as const;

export const CONTRACT_LEDGER_SEQUENCE_NAMES = [
  "contract_no_sequence",
  "contract_download_request_no_sequence",
  "invoice_application_no_sequence",
] as const;

export interface SnapshotColumnSchema {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultExpression: string | null;
  identity: string | null;
  generated: string | null;
}

export interface SnapshotConstraintSchema {
  constraintName: string;
  constraintType: "p" | "f" | "u" | "c" | "x";
  definition: string;
  referencedTableName: string | null;
  localColumns: string[];
  referencedColumns: string[];
}

export interface SnapshotIndexSchema {
  indexName: string;
  definition: string;
}

export interface SnapshotTableSchema {
  tableName: string;
  columns: SnapshotColumnSchema[];
  constraints: SnapshotConstraintSchema[];
  indexes: SnapshotIndexSchema[];
}

export interface SnapshotSchema {
  fingerprint: string;
  tables: SnapshotTableSchema[];
}

export function normalizeSchemaDefinition(definition: string): string {
  return definition.trim().replace(/\s+/gu, " ");
}

export function normalizeIndexDefinition(definition: string): string {
  const normalizedWhitespace = normalizeSchemaDefinition(definition);
  const matched = normalizedWhitespace.match(
    /^CREATE( UNIQUE)? INDEX \S+ ON (?:ONLY )?(?:\S+\.)?\S+ USING (.+)$/u,
  );
  if (!matched) return normalizedWhitespace;
  return `CREATE${matched[1] || ""} INDEX USING ${matched[2]}`;
}

function uniqueSortedCanonicalValues(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.map(canonicalJson))).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function calculateSchemaFingerprint(
  tables: readonly SnapshotTableSchema[],
): string {
  const semanticTables = tables
    .map((table) => ({
      tableName: table.tableName,
      columns: [...table.columns].sort(
        (left, right) => left.ordinalPosition - right.ordinalPosition,
      ),
      constraints: uniqueSortedCanonicalValues(
        table.constraints.map((constraint) => ({
          constraintType: constraint.constraintType,
          definition: normalizeSchemaDefinition(constraint.definition),
          referencedTableName: constraint.referencedTableName,
          localColumns: constraint.localColumns,
          referencedColumns: constraint.referencedColumns,
        })),
      ),
      indexes: Array.from(
        new Set(
          table.indexes.map((index) =>
            normalizeIndexDefinition(index.definition),
          ),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.tableName.localeCompare(right.tableName));
  return sha256Text(canonicalJson({ tables: semanticTables }));
}

export interface SnapshotReference {
  tableName: string;
  rowId: string;
  columnName: string;
}

export interface SnapshotAccountStableKey {
  username: string;
  name: string;
  role: string;
  status: string;
  department: string | null;
  position: string | null;
  employeeNo: string | null;
}

export interface SnapshotAccountMappingEntry {
  sourceUserId: string;
  stableKey: SnapshotAccountStableKey;
  matchFields: readonly ["username", "name", "role"];
  references: SnapshotReference[];
}

export interface SnapshotSequence {
  sequenceName: string;
  lastValue: string;
  isCalled: boolean;
  nextValue: string;
}

export interface SnapshotTableDataFile {
  tableName: string;
  rows: SnapshotRow[];
}

export interface SnapshotTableDataEntry {
  tableName: string;
  relativePath: string;
  rowCount: number;
  bytes: number;
  sha256: string;
}

export interface SnapshotFileEntry {
  storedPath: string;
  bundlePath: string;
  bytes: number;
  sha256: string;
  references: SnapshotReference[];
}

export interface SnapshotAmountSummary {
  rowCount: number;
  amount: string;
  cents: string;
}

export interface ContractLedgerSnapshotSummary {
  tableRowCounts: Record<string, number>;
  contractCounts: {
    total: number;
    roots: number;
    supplements: number;
    terminations: number;
    active: number;
    softDeleted: number;
  };
  financialAmounts: {
    confirmedInvoices: SnapshotAmountSummary;
    confirmedReceipts: SnapshotAmountSummary;
    confirmedPayments: SnapshotAmountSummary;
    confirmedExternalPayments: SnapshotAmountSummary;
    deposits: SnapshotAmountSummary;
    settledDeposits: SnapshotAmountSummary;
  };
  financialCounts: {
    registrations: number;
    registrationItems: number;
    registrationMatches: number;
    purposeDetails: number;
    depositReceipts: number;
  };
  accountCount: number;
  accountReferenceCount: number;
  storedFileCount: number;
  uniqueBlobCount: number;
  storedFileBytes: number;
  uniqueBlobBytes: number;
}

export interface ContractLedgerSnapshotExclusion {
  tableName: string;
  reason: string;
  rowCount?: number;
  sourceFingerprint?: string;
}

export interface ContractLedgerSnapshotManifest {
  formatVersion: typeof CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION;
  kind: typeof CONTRACT_LEDGER_SNAPSHOT_KIND;
  snapshotKey: string;
  exportedAt: string;
  source: {
    environment: "development";
    historicalImportBatchKey: string;
    contractCount: number;
    rootContractCount: number;
  };
  schema: SnapshotSchema;
  accounts: SnapshotAccountMappingEntry[];
  sequences: SnapshotSequence[];
  tables: SnapshotTableDataEntry[];
  files: SnapshotFileEntry[];
  summary: ContractLedgerSnapshotSummary;
  exclusions: ContractLedgerSnapshotExclusion[];
  contentSha256: string;
  manifestSha256: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export const canonicalJsonStringify = canonicalJson;

export function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function calculateSnapshotContentSha256(
  manifest: Omit<
    ContractLedgerSnapshotManifest,
    "contentSha256" | "manifestSha256"
  >,
): string {
  return sha256Text(
    canonicalJson({
      formatVersion: manifest.formatVersion,
      kind: manifest.kind,
      snapshotKey: manifest.snapshotKey,
      source: {
        historicalImportBatchKey: manifest.source.historicalImportBatchKey,
        contractCount: manifest.source.contractCount,
        rootContractCount: manifest.source.rootContractCount,
      },
      schemaFingerprint: manifest.schema.fingerprint,
      accounts: manifest.accounts,
      sequences: manifest.sequences,
      tables: manifest.tables,
      files: manifest.files,
      summary: manifest.summary,
      exclusions: manifest.exclusions,
    }),
  );
}

export function calculateSnapshotManifestSha256(
  manifest: Omit<ContractLedgerSnapshotManifest, "manifestSha256">,
): string {
  return sha256Text(canonicalJson(manifest));
}

export const calculateManifestSha256 = calculateSnapshotManifestSha256;
