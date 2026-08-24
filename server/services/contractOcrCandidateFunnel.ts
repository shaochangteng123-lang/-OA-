import {
  getContractAmountBreakdown,
  getContractAmountStatus,
  parseChineseUppercaseAmount,
  type ContractAmountBreakdown,
  type ContractAmountStatus,
  type ContractOcrCandidateFunnelTrace,
  type ContractOcrFieldName,
  type ContractRecognitionResult,
} from "./contractOcr.js";

export const CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION = 2;

export type ContractOcrDiagnosedField = Exclude<
  ContractOcrFieldName,
  "category"
>;

export type ContractOcrFunnelFailureStage =
  | "passed"
  | "ocr_raw"
  | "candidate_generation"
  | "candidate_filtering"
  | "candidate_ranking"
  | "post_ranking_validation"
  | "automatic_adoption"
  | "unknown";

export interface ContractOcrFunnelGroundTruth {
  party_a: string | null;
  party_b: string | null;
  project_name: string | null;
  amount: string | null;
  contract_date: string | null;
  amountStatus?: ContractAmountStatus;
  amountBreakdown?: ContractAmountBreakdown;
}

export interface ContractOcrAutomaticDecisionLike {
  accepted: boolean;
  status: "succeeded" | "partial" | "failed";
  values: Partial<Record<ContractOcrFieldName, string | null>>;
  legalEmptyFields: readonly string[];
  blockers: readonly string[];
  warnings: readonly string[];
}

export interface ContractOcrFieldFunnelDiagnostic {
  field: ContractOcrDiagnosedField;
  expectedValue: string | null;
  expectedIsNull: boolean;
  rawEvidenceKind: "ocr_lines" | "source_text" | "none";
  ocrLineContainsExpected: boolean | null;
  sourceRawContainsExpected: boolean;
  ocrRawContainsExpected: boolean;
  matchingGeneratedCandidateIds: string[];
  matchingRetainedCandidateIds: string[];
  matchingRankingSuppressedCandidateIds: string[];
  matchingRanks: number[];
  selectedValue: string | null;
  selectedMatchesExpected: boolean;
  automaticDecisionValue: string | null;
  automaticDecisionValueMatchesExpected: boolean;
  automaticDecisionAccepted: boolean;
  automaticDecisionBlockedForField: boolean;
  amountStatusMatchesExpected: boolean | null;
  amountBreakdownMatchesExpected: boolean | null;
  firstFailureStage: ContractOcrFunnelFailureStage;
  reasonCodes: string[];
}

const DIAGNOSED_FIELDS: readonly ContractOcrDiagnosedField[] = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "contract_date",
];

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s/gu, "")
    .toLowerCase();
}

function normalizedAmount(value: unknown): string | null {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[,，\s￥¥人民币元整]/gu, "")
    .trim();
  if (!text || !/^[-+]?\d+(?:\.\d+)?$/u.test(text)) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(2);
}

function normalizedDate(value: unknown): string | null {
  const text = String(value ?? "")
    .normalize("NFKC")
    .trim();
  const matched = text.match(
    /(?:^|\D)(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})(?:\s*日)?(?:\D|$)/u,
  );
  if (!matched) return null;
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(Number(matched[1]), month - 1, day));
  if (
    parsed.getUTCFullYear() !== Number(matched[1]) ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${matched[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const CHINESE_DATE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  "○": 0,
  O: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

function parseChineseDateNumber(value: string): number | null {
  const compact = value.replace(/\s+/gu, "");
  const tenIndex = compact.search(/[十拾]/u);
  if (tenIndex >= 0) {
    if ((compact.match(/[十拾]/gu) || []).length !== 1) return null;
    const before = compact.slice(0, tenIndex);
    const after = compact.slice(tenIndex + 1);
    const tens = before ? CHINESE_DATE_DIGITS[before] : 1;
    const ones = after ? CHINESE_DATE_DIGITS[after] : 0;
    return tens == null || ones == null ? null : tens * 10 + ones;
  }
  const digits = [...compact].map(
    (character) => CHINESE_DATE_DIGITS[character],
  );
  if (digits.length === 0 || digits.some((digit) => digit == null)) return null;
  return Number(digits.join(""));
}

function normalizedChineseDate(value: string): string | null {
  const matched = value.match(
    /([〇○零O一壹二两贰三叁四肆五伍六陆七柒八捌九玖]{4})\s*年\s*([〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*月\s*([〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3})\s*[日曰]/u,
  );
  if (!matched) return null;
  const yearDigits = [...matched[1]].map(
    (character) => CHINESE_DATE_DIGITS[character],
  );
  const month = parseChineseDateNumber(matched[2]);
  const day = parseChineseDateNumber(matched[3]);
  if (
    yearDigits.some((digit) => digit == null) ||
    month == null ||
    day == null ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return normalizedDate(
    `${yearDigits.join("")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

function valuesMatch(
  field: ContractOcrDiagnosedField,
  actual: unknown,
  expected: string | null,
): boolean {
  if (expected == null) {
    return actual == null || String(actual).trim() === "";
  }
  if (field === "amount") {
    const actualAmount = normalizedAmount(actual);
    const expectedAmount = normalizedAmount(expected);
    return actualAmount != null && actualAmount === expectedAmount;
  }
  if (field === "contract_date") {
    const actualDate = normalizedDate(actual);
    const expectedDate = normalizedDate(expected);
    return actualDate != null && actualDate === expectedDate;
  }
  const actualText = normalizedText(actual);
  return actualText.length > 0 && actualText === normalizedText(expected);
}

function rawTextContainsAmount(rawText: string, expected: string): boolean {
  const expectedAmount = normalizedAmount(expected);
  if (!expectedAmount) return false;
  const matches = rawText
    .normalize("NFKC")
    .matchAll(/[-+]?\d[\d,，]*(?:\.\d+)?\s*(?:万\s*元|万元|元)?/gu);
  for (const match of matches) {
    const token = match[0];
    const unitMultiplier = /万\s*元|万元/u.test(token) ? 10_000 : 1;
    const numeric = Number(
      token.replace(/[,，\s]/gu, "").replace(/(?:万元?|元)$/u, ""),
    );
    if (
      Number.isFinite(numeric) &&
      (numeric * unitMultiplier).toFixed(2) === expectedAmount
    ) {
      return true;
    }
  }
  const chineseMatches = rawText.matchAll(
    /负?[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆]{1,32}(?:元|圆|圓)(?:[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖]角)?(?:[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖]分)?[整正]?/gu,
  );
  for (const match of chineseMatches) {
    const numeric = parseChineseUppercaseAmount(match[0]);
    if (numeric != null && numeric.toFixed(2) === expectedAmount) return true;
  }
  return false;
}

function rawTextContainsExpected(
  field: ContractOcrDiagnosedField,
  rawText: string,
  expected: string | null,
): boolean {
  if (expected == null) return true;
  if (field === "amount") return rawTextContainsAmount(rawText, expected);
  if (field === "contract_date") {
    const expectedDate = normalizedDate(expected);
    if (!expectedDate) return false;
    const dateCandidates = rawText.matchAll(
      /\d{4}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*日?/gu,
    );
    if (
      [...dateCandidates].some(
        (candidate) => normalizedDate(candidate[0]) === expectedDate,
      )
    ) {
      return true;
    }
    const chineseDateCandidates = rawText.matchAll(
      /[〇○零O一壹二两贰三叁四肆五伍六陆七柒八捌九玖]{4}\s*年\s*[〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3}\s*月\s*[〇○零一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾]{1,3}\s*[日曰]/gu,
    );
    return [...chineseDateCandidates].some(
      (candidate) => normalizedChineseDate(candidate[0]) === expectedDate,
    );
  }
  const comparableRawText = normalizedText(rawText);
  const comparableExpected = normalizedText(expected);
  return (
    comparableExpected.length > 0 &&
    comparableRawText.includes(comparableExpected)
  );
}

function firstFailure(input: {
  expectedIsNull: boolean;
  ocrRawContainsExpected: boolean;
  generatedCount: number;
  passedFilteringCount: number;
  matchingRanks: readonly number[];
  selectedMatchesExpected: boolean;
  postRankingValidationMatchesExpected: boolean;
  automaticDecisionValueMatchesExpected: boolean;
  automaticDecisionBlockedForField: boolean;
}): Pick<
  ContractOcrFieldFunnelDiagnostic,
  "firstFailureStage" | "reasonCodes"
> {
  if (input.expectedIsNull) {
    if (!input.selectedMatchesExpected) {
      return {
        firstFailureStage: "candidate_ranking",
        reasonCodes: ["NULL_TRUTH_BUT_NONEMPTY_CANDIDATE_SELECTED"],
      };
    }
    if (!input.postRankingValidationMatchesExpected) {
      return {
        firstFailureStage: "post_ranking_validation",
        reasonCodes: ["AMOUNT_SEMANTICS_MISMATCH_AFTER_RANKING"],
      };
    }
    if (input.automaticDecisionBlockedForField) {
      return {
        firstFailureStage: "automatic_adoption",
        reasonCodes: ["LEGAL_EMPTY_VALUE_BLOCKED_BY_AUTOMATIC_DECISION"],
      };
    }
    return { firstFailureStage: "passed", reasonCodes: [] };
  }
  if (!input.ocrRawContainsExpected) {
    return {
      firstFailureStage: "ocr_raw",
      reasonCodes: ["EXPECTED_VALUE_NOT_FOUND_IN_OCR_RAW_TEXT"],
    };
  }
  if (input.generatedCount === 0) {
    return {
      firstFailureStage: "candidate_generation",
      reasonCodes: ["EXPECTED_VALUE_NOT_GENERATED_AS_CANDIDATE"],
    };
  }
  if (input.passedFilteringCount === 0) {
    return {
      firstFailureStage: "candidate_filtering",
      reasonCodes: ["EXPECTED_CANDIDATE_REMOVED_BEFORE_FINAL_RANKING"],
    };
  }
  if (!input.matchingRanks.includes(1)) {
    return {
      firstFailureStage: "candidate_ranking",
      reasonCodes: ["EXPECTED_CANDIDATE_NOT_RANKED_FIRST"],
    };
  }
  if (!input.selectedMatchesExpected) {
    return {
      firstFailureStage: "post_ranking_validation",
      reasonCodes: ["POST_RANKING_VALIDATION_CHANGED_SELECTED_VALUE"],
    };
  }
  if (!input.postRankingValidationMatchesExpected) {
    return {
      firstFailureStage: "post_ranking_validation",
      reasonCodes: ["AMOUNT_SEMANTICS_MISMATCH_AFTER_RANKING"],
    };
  }
  if (
    !input.automaticDecisionValueMatchesExpected ||
    input.automaticDecisionBlockedForField
  ) {
    return {
      firstFailureStage: "automatic_adoption",
      reasonCodes: [
        input.automaticDecisionBlockedForField
          ? "CORRECT_SELECTED_VALUE_BLOCKED_BY_FIELD_DECISION"
          : "AUTOMATIC_DECISION_VALUE_MISMATCH",
      ],
    };
  }
  return { firstFailureStage: "passed", reasonCodes: [] };
}

function automaticDecisionBlockedForField(
  field: ContractOcrDiagnosedField,
  blockers: readonly string[],
): boolean {
  const markers: Record<ContractOcrDiagnosedField, readonly string[]> = {
    party_a: ["甲方单位", "party_a", "甲方单位与乙方单位"],
    party_b: ["乙方单位", "party_b", "甲方单位与乙方单位"],
    project_name: ["项目名称", "project_name"],
    amount: ["合同金额", "amount", "金额状态", "金额格式"],
    contract_date: ["合同签订日期", "contract_date", "签订日期"],
  };
  return blockers.some((blocker) =>
    markers[field].some((marker) => blocker.includes(marker)),
  );
}

function amountValuesMatch(
  actual: number | null,
  expected: number | null,
): boolean {
  if (actual == null || expected == null) return actual === expected;
  return Math.abs(actual - expected) < 0.005;
}

function amountBreakdownsMatch(
  actual: ContractAmountBreakdown | null,
  expected: ContractAmountBreakdown | undefined,
): boolean {
  if (expected == null) return true;
  if (actual == null) return false;
  return (
    amountValuesMatch(actual.originalAmount, expected.originalAmount) &&
    amountValuesMatch(actual.changeAmount, expected.changeAmount) &&
    amountValuesMatch(actual.finalAmount, expected.finalAmount)
  );
}

function rawEvidenceForResult(result: ContractRecognitionResult): {
  kind: "ocr_lines" | "source_text" | "none";
  ocrText: string;
  sourceText: string;
} {
  const ocrText = result.ocrLines
    .map((line) => line.text)
    .filter(Boolean)
    .join("\n");
  if (normalizedText(ocrText)) {
    return { kind: "ocr_lines", ocrText, sourceText: result.rawText };
  }
  if (normalizedText(result.rawText)) {
    return { kind: "source_text", ocrText, sourceText: result.rawText };
  }
  return { kind: "none", ocrText, sourceText: result.rawText };
}

export function diagnoseContractOcrCandidateFunnel(
  result: ContractRecognitionResult,
  trace: ContractOcrCandidateFunnelTrace | null,
  expected: ContractOcrFunnelGroundTruth,
  automaticDecision: ContractOcrAutomaticDecisionLike,
): ContractOcrFieldFunnelDiagnostic[] {
  const rawEvidence = rawEvidenceForResult(result);
  if (!trace) {
    return DIAGNOSED_FIELDS.map((field) => {
      const ocrLineContainsExpected = rawEvidence.ocrText
        ? rawTextContainsExpected(field, rawEvidence.ocrText, expected[field])
        : null;
      const sourceRawContainsExpected = rawTextContainsExpected(
        field,
        rawEvidence.sourceText,
        expected[field],
      );
      return {
        field,
        expectedValue: expected[field],
        expectedIsNull: expected[field] == null,
        rawEvidenceKind: rawEvidence.kind,
        ocrLineContainsExpected,
        sourceRawContainsExpected,
        ocrRawContainsExpected:
          rawEvidence.kind === "ocr_lines"
            ? ocrLineContainsExpected === true
            : sourceRawContainsExpected,
        matchingGeneratedCandidateIds: [],
        matchingRetainedCandidateIds: [],
        matchingRankingSuppressedCandidateIds: [],
        matchingRanks: [],
        selectedValue:
          result.fields.find((candidate) => candidate.field === field)
            ?.normalizedValue || null,
        selectedMatchesExpected: false,
        automaticDecisionValue: automaticDecision.values[field] || null,
        automaticDecisionValueMatchesExpected: false,
        automaticDecisionAccepted: automaticDecision.accepted,
        automaticDecisionBlockedForField: automaticDecisionBlockedForField(
          field,
          automaticDecision.blockers,
        ),
        amountStatusMatchesExpected: null,
        amountBreakdownMatchesExpected: null,
        firstFailureStage: "unknown" as const,
        reasonCodes: ["CANDIDATE_FUNNEL_TRACE_NOT_CAPTURED"],
      };
    });
  }

  const decisionsById = new Map(
    trace.filteringDecisions.map((decision) => [
      decision.candidateId,
      decision,
    ]),
  );
  return DIAGNOSED_FIELDS.map((field) => {
    const expectedValue = expected[field];
    const generatedMatches = trace.generatedCandidates.filter(
      (candidate) =>
        candidate.field === field &&
        valuesMatch(field, candidate.normalizedValue, expectedValue),
    );
    const retainedMatches = generatedMatches.filter(
      (candidate) => decisionsById.get(candidate.candidateId)?.retained,
    );
    const rankingSuppressedMatches = generatedMatches.filter(
      (candidate) =>
        decisionsById.get(candidate.candidateId)?.rejectedAt ===
        "ranking_suppression",
    );
    const fieldRanking = trace.ranking.find(
      (candidate) => candidate.field === field,
    );
    const matchingRanks = (fieldRanking?.candidates || [])
      .filter((candidate) =>
        valuesMatch(field, candidate.normalizedValue, expectedValue),
      )
      .map((candidate) => candidate.rank);
    const selectedValue =
      result.fields.find((candidate) => candidate.field === field)
        ?.normalizedValue || null;
    const automaticDecisionValue = automaticDecision.values[field] || null;
    const selectedMatchesExpected = valuesMatch(
      field,
      selectedValue,
      expectedValue,
    );
    const automaticDecisionValueMatchesExpected = valuesMatch(
      field,
      automaticDecisionValue,
      expectedValue,
    );
    const sourceRawContainsExpected = rawTextContainsExpected(
      field,
      rawEvidence.sourceText,
      expectedValue,
    );
    const ocrLineContainsExpected = rawEvidence.ocrText
      ? rawTextContainsExpected(field, rawEvidence.ocrText, expectedValue)
      : null;
    const rawContains =
      rawEvidence.kind === "ocr_lines"
        ? ocrLineContainsExpected === true
        : sourceRawContainsExpected;
    const fieldBlocked = automaticDecisionBlockedForField(
      field,
      automaticDecision.blockers,
    );
    const amountStatusMatchesExpected =
      field === "amount" && expected.amountStatus != null
        ? getContractAmountStatus(result) === expected.amountStatus
        : null;
    const amountBreakdownMatchesExpected =
      field === "amount" && expected.amountBreakdown != null
        ? amountBreakdownsMatch(
            getContractAmountBreakdown(result),
            expected.amountBreakdown,
          )
        : null;
    const postRankingValidationMatchesExpected =
      amountStatusMatchesExpected !== false &&
      amountBreakdownMatchesExpected !== false;
    const failure = firstFailure({
      expectedIsNull: expectedValue == null,
      ocrRawContainsExpected: rawContains,
      generatedCount: generatedMatches.length,
      passedFilteringCount:
        retainedMatches.length + rankingSuppressedMatches.length,
      matchingRanks,
      selectedMatchesExpected,
      postRankingValidationMatchesExpected,
      automaticDecisionValueMatchesExpected,
      automaticDecisionBlockedForField: fieldBlocked,
    });
    return {
      field,
      expectedValue,
      expectedIsNull: expectedValue == null,
      rawEvidenceKind: rawEvidence.kind,
      ocrLineContainsExpected,
      sourceRawContainsExpected,
      ocrRawContainsExpected: rawContains,
      matchingGeneratedCandidateIds: generatedMatches.map(
        (candidate) => candidate.candidateId,
      ),
      matchingRetainedCandidateIds: retainedMatches.map(
        (candidate) => candidate.candidateId,
      ),
      matchingRankingSuppressedCandidateIds: rankingSuppressedMatches.map(
        (candidate) => candidate.candidateId,
      ),
      matchingRanks,
      selectedValue,
      selectedMatchesExpected,
      automaticDecisionValue,
      automaticDecisionValueMatchesExpected,
      automaticDecisionAccepted: automaticDecision.accepted,
      automaticDecisionBlockedForField: fieldBlocked,
      amountStatusMatchesExpected,
      amountBreakdownMatchesExpected,
      ...failure,
    };
  });
}

export function summarizeContractOcrCandidateFunnel(
  diagnostics: readonly ContractOcrFieldFunnelDiagnostic[],
): {
  totalFields: number;
  byFailureStage: Record<ContractOcrFunnelFailureStage, number>;
  byField: Record<
    ContractOcrDiagnosedField,
    Record<ContractOcrFunnelFailureStage, number>
  >;
} {
  const stages: readonly ContractOcrFunnelFailureStage[] = [
    "passed",
    "ocr_raw",
    "candidate_generation",
    "candidate_filtering",
    "candidate_ranking",
    "post_ranking_validation",
    "automatic_adoption",
    "unknown",
  ];
  const emptyStageCounts = () =>
    Object.fromEntries(stages.map((stage) => [stage, 0])) as Record<
      ContractOcrFunnelFailureStage,
      number
    >;
  const byFailureStage = emptyStageCounts();
  const byField = Object.fromEntries(
    DIAGNOSED_FIELDS.map((field) => [field, emptyStageCounts()]),
  ) as Record<
    ContractOcrDiagnosedField,
    Record<ContractOcrFunnelFailureStage, number>
  >;
  for (const diagnostic of diagnostics) {
    byFailureStage[diagnostic.firstFailureStage] += 1;
    byField[diagnostic.field][diagnostic.firstFailureStage] += 1;
  }
  return { totalFields: diagnostics.length, byFailureStage, byField };
}

const FAILURE_STAGE_PRIORITY: readonly ContractOcrFunnelFailureStage[] = [
  "ocr_raw",
  "candidate_generation",
  "candidate_filtering",
  "candidate_ranking",
  "post_ranking_validation",
  "automatic_adoption",
  "unknown",
  "passed",
];

/** 返回一份合同所有字段中，在漏斗流程里最早发生的失败阶段。 */
export function earliestContractOcrFunnelFailureStage(
  diagnostics: readonly ContractOcrFieldFunnelDiagnostic[],
): ContractOcrFunnelFailureStage {
  const stages = new Set(diagnostics.map((item) => item.firstFailureStage));
  return FAILURE_STAGE_PRIORITY.find((stage) => stages.has(stage)) || "passed";
}

/**
 * 字段均通过但整份合同仍被分类、层级或文件级门禁拒绝时，整单不能报告
 * 通过；这类全局阻断归入自动采用阶段，并保留原始 blockers（阻断原因）。
 */
export function contractOcrDocumentFailureStage(
  diagnostics: readonly ContractOcrFieldFunnelDiagnostic[],
  automaticDecision: ContractOcrAutomaticDecisionLike,
): ContractOcrFunnelFailureStage {
  const fieldStage = earliestContractOcrFunnelFailureStage(diagnostics);
  if (fieldStage === "passed" && !automaticDecision.accepted) {
    return "automatic_adoption";
  }
  return fieldStage;
}
