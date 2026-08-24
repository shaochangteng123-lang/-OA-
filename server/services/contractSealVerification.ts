import { toCents } from "./contractAccounting.js";
import type {
  ContractOcrField,
  ContractRecognitionResult,
} from "./contractOcr.js";

const RELIABLE_MIXED_MISMATCH_FIELD_SCORE = 90;
const FIELD_RISK_WARNING_PATTERN =
  /(?:候选冲突|低置信|不完整|截断|损坏|未识别到|识别风险)/u;

export type SealedVerificationField =
  | "party_a"
  | "party_b"
  | "amount"
  | "contract_date";

type SealedCoreVerificationField = Exclude<
  SealedVerificationField,
  "contract_date"
>;

const FIELD_WARNING_LABELS: Record<SealedCoreVerificationField, RegExp> = {
  party_a: /(?:甲方单位|甲方|委托方)/u,
  party_b: /(?:乙方单位|乙方|受托方)/u,
  amount: /(?:合同金额|金额)/u,
};

export interface ApprovedContractSnapshot {
  partyA: string;
  partyB: string;
  amount: string | number;
  amountVerificationRequired?: boolean;
  contractDate?: string | null;
}

export interface SealedVerificationValue {
  field: SealedVerificationField;
  value: string | null;
  confidence: number;
  source: string;
  requiresRecognitionRetry: boolean;
}

export interface SealedContractMismatch {
  field: Exclude<SealedVerificationField, "contract_date"> | "contract_date";
  label: string;
  approvedValue: string;
  sealedValue: string;
}

export interface SealedContractVerificationResult {
  values: SealedVerificationValue[];
  mismatches: SealedContractMismatch[];
  requiresRecognitionRetry: boolean;
  infrastructureFailure: boolean;
}

const LABELS: Record<SealedVerificationField, string> = {
  party_a: "甲方单位",
  party_b: "乙方单位",
  amount: "合同金额",
  contract_date: "合同签订日期",
};

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function fieldByName(
  recognition: ContractRecognitionResult,
  field: SealedVerificationField,
): ContractOcrField | undefined {
  return recognition.fields.find((item) => item.field === field);
}

function normalizedFieldValue(field?: ContractOcrField): string | null {
  const value = String(field?.normalizedValue || "").trim();
  return value || null;
}

function isValidRecognizedAmount(value: string): boolean {
  try {
    toCents(value);
    return true;
  } catch {
    return false;
  }
}

function isValidContractDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeLooseContractDate(value: string): string | null {
  const match = value.match(
    /(?<!\d)(2\d{3})\s*(?:年|[.．/\-])\s*(\d{1,2})\s*(?:月|[.．/\-])\s*(\d{1,2})\s*(?:日)?(?!\d)/u,
  );
  if (!match) return null;
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return isValidContractDate(normalized) ? normalized : null;
}

/** 盖章签署页原文精确出现审批日期时，以文件证据恢复被版面噪声打散的日期。 */
function approvedDateEvidenceOnSignaturePage(
  approvedDate: string | null | undefined,
  recognition: ContractRecognitionResult,
  uploadDate: string,
): { value: string; confidence: number; source: string } | null {
  if (
    !approvedDate ||
    !isValidContractDate(approvedDate) ||
    approvedDate > uploadDate ||
    !recognition.ocrLines?.length
  ) {
    return null;
  }
  const pages = new Map<number, typeof recognition.ocrLines>();
  for (const line of recognition.ocrLines) {
    const pageLines = pages.get(line.page) || [];
    pages.set(line.page, [...pageLines, line]);
  }
  for (const pageLines of pages.values()) {
    const pageText = pageLines.map((line) => line.text).join(" ");
    const isSignaturePage =
      /(?:甲方|出租方|委托方)/u.test(pageText) &&
      /(?:乙方|承租方|受托方)/u.test(pageText) &&
      /(?:盖章|合同专用章|法定代表人|授权代理人|授权代表)/u.test(pageText) &&
      /日期/u.test(pageText);
    if (!isSignaturePage) continue;
    const exactLine = pageLines.find(
      (line) => normalizeLooseContractDate(line.text) === approvedDate,
    );
    if (!exactLine) continue;
    const normalizedConfidence =
      exactLine.confidence <= 1
        ? exactLine.confidence * 100
        : exactLine.confidence;
    return {
      value: approvedDate,
      confidence: Math.max(0, Math.min(100, Math.round(normalizedConfidence))),
      source: "signature_page_ocr",
    };
  }
  return null;
}

function amountEquals(left: string | number, right: string): boolean {
  try {
    return toCents(left) === toCents(right);
  } catch {
    return false;
  }
}

export function sealedVerificationValuesEqual(
  field: SealedCoreVerificationField,
  approvedValue: string | number,
  recognizedValue: string,
): boolean {
  return field === "amount"
    ? amountEquals(approvedValue, recognizedValue)
    : normalizeComparableText(String(approvedValue)) ===
        normalizeComparableText(recognizedValue);
}

export function sealedRecognitionWarningsForField(
  field: SealedCoreVerificationField,
  fieldWarnings: readonly string[] | undefined,
  recognitionWarnings: readonly string[],
): string[] {
  if (fieldWarnings?.length) return [...fieldWarnings];
  return recognitionWarnings.filter((warning) =>
    FIELD_WARNING_LABELS[field].test(warning),
  );
}

export function sealedCoreFieldRequiresRecognitionRetry(input: {
  field: SealedCoreVerificationField;
  approvedValue: string | number;
  recognizedValue: string | null | undefined;
  fieldScore: unknown;
  source: unknown;
  warnings?: readonly string[];
}): boolean {
  const recognizedValue = String(input.recognizedValue || "").trim();
  const source = String(input.source || "").trim();
  if (
    !recognizedValue ||
    !source ||
    ["manual", "rule", "unknown"].includes(source)
  ) {
    return true;
  }
  if (input.field === "amount" && !isValidRecognizedAmount(recognizedValue)) {
    return true;
  }
  if (
    sealedVerificationValuesEqual(
      input.field,
      input.approvedValue,
      recognizedValue,
    )
  ) {
    return false;
  }
  const fieldScore = Number(input.fieldScore);
  if (fieldScore === 100) return false;
  return (
    source !== "mixed" ||
    !Number.isFinite(fieldScore) ||
    fieldScore < RELIABLE_MIXED_MISMATCH_FIELD_SCORE ||
    (input.warnings || []).some((warning) =>
      FIELD_RISK_WARNING_PATTERN.test(warning),
    )
  );
}

/** 按审批通过时的合同快照比较盖章版自动识别最终值。 */
export function findSealedContractMismatches(
  approved: ApprovedContractSnapshot,
  values: readonly Pick<SealedVerificationValue, "field" | "value">[],
): SealedContractMismatch[] {
  const byName = new Map(values.map((value) => [value.field, value]));
  const mismatches: SealedContractMismatch[] = [];
  const comparisons: Array<{
    field: SealedVerificationField;
    approvedValue: string;
    equal: (approvedValue: string, sealedValue: string) => boolean;
  }> = [
    {
      field: "party_a",
      approvedValue: approved.partyA,
      equal: (left, right) =>
        sealedVerificationValuesEqual("party_a", left, right),
    },
    {
      field: "party_b",
      approvedValue: approved.partyB,
      equal: (left, right) =>
        sealedVerificationValuesEqual("party_b", left, right),
    },
  ];
  if (approved.amountVerificationRequired !== false) {
    comparisons.push({
      field: "amount",
      approvedValue: String(approved.amount),
      equal: (left, right) =>
        sealedVerificationValuesEqual("amount", left, right),
    });
  }
  for (const comparison of comparisons) {
    const sealedValue = byName.get(comparison.field)?.value;
    if (
      sealedValue &&
      !comparison.equal(comparison.approvedValue, sealedValue)
    ) {
      mismatches.push({
        field: comparison.field,
        label: LABELS[comparison.field],
        approvedValue: comparison.approvedValue,
        sealedValue,
      });
    }
  }
  return mismatches;
}

export function compareSealedContract(
  approved: ApprovedContractSnapshot,
  recognition: ContractRecognitionResult,
  uploadDate: string,
): SealedContractVerificationResult {
  const infrastructureFailure =
    recognition.failureKind === "infrastructure" ||
    recognition.warnings.some((warning) =>
      /基础设施暂时不可用|渲染工具不可用|识别服务不可用/.test(warning),
    );
  const recognitionFailure = recognition.status === "failed";
  const approvedDateEvidence = approvedDateEvidenceOnSignaturePage(
    approved.contractDate,
    recognition,
    uploadDate,
  );
  const values = (
    ["party_a", "party_b", "amount", "contract_date"] as const
  ).map((fieldName): SealedVerificationValue => {
    if (
      fieldName === "amount" &&
      approved.amountVerificationRequired === false
    ) {
      return {
        field: fieldName,
        value: null,
        confidence: 0,
        source: "not_applicable",
        requiresRecognitionRetry: false,
      };
    }
    const field = fieldByName(recognition, fieldName);
    const rawRecognizedValue = normalizedFieldValue(field);
    const parsedRecognizedValue = rawRecognizedValue
      ? fieldName === "contract_date"
        ? isValidContractDate(rawRecognizedValue)
          ? rawRecognizedValue
          : null
        : fieldName === "amount" && !isValidRecognizedAmount(rawRecognizedValue)
          ? null
          : rawRecognizedValue
      : null;
    const recognizedValue =
      fieldName === "contract_date" && !parsedRecognizedValue
        ? approvedDateEvidence?.value || null
        : parsedRecognizedValue;
    const value =
      fieldName === "contract_date" && !recognizedValue
        ? uploadDate
        : recognizedValue;
    const coreField = fieldName === "contract_date" ? null : fieldName;
    const relevantWarnings = coreField
      ? sealedRecognitionWarningsForField(
          coreField,
          field?.warnings,
          recognition.warnings,
        )
      : [];
    return {
      field: fieldName,
      value,
      confidence:
        fieldName === "contract_date" && approvedDateEvidence
          ? approvedDateEvidence.confidence
          : Number(field?.confidence || 0),
      source:
        fieldName === "contract_date" && !recognizedValue
          ? "upload_date"
          : fieldName === "contract_date" && approvedDateEvidence
            ? approvedDateEvidence.source
            : field?.source || "unknown",
      requiresRecognitionRetry:
        fieldName !== "contract_date" &&
        (recognitionFailure ||
          sealedCoreFieldRequiresRecognitionRetry({
            field: fieldName,
            approvedValue:
              fieldName === "party_a"
                ? approved.partyA
                : fieldName === "party_b"
                  ? approved.partyB
                  : approved.amount,
            recognizedValue,
            fieldScore: field?.fieldScore ?? field?.confidence,
            source: field?.source,
            warnings: relevantWarnings,
          })),
    };
  });
  const requiresRecognitionRetry =
    recognitionFailure ||
    values.some((value) => value.requiresRecognitionRetry);
  const mismatches = infrastructureFailure
    ? []
    : findSealedContractMismatches(
        approved,
        values.filter((value) => !value.requiresRecognitionRetry),
      );
  return {
    values,
    mismatches,
    requiresRecognitionRetry,
    infrastructureFailure,
  };
}
