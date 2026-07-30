export type HumanCostReceiptRecognitionStatus =
  | "recognized"
  | "partial"
  | "failed";

export interface HumanCostReceiptRecognition {
  recognizedAmount: string;
  recognitionStatus: HumanCostReceiptRecognitionStatus;
  recognizedItemCount: number;
  totalItemCount: number;
  ignoredItemCount: number;
  recognitionError: string | null;
}

export interface HumanCostReceiptRecognitionOptions {
  ignoredItemCount?: number;
  validationErrors?: string[];
  acceptRecognizedItemsWithoutReview?: boolean;
}

function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function isSalaryPaymentProofText(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  // “备注”中明确出现“薪资”时，直接按工资用途候选回单处理。
  if (/(?:备注)[：:]?.{0,80}薪资/u.test(normalized)) return true;

  const salaryWords = "(?:工资|薪资|薪酬|代发工资|工资发放)";
  const patterns = [
    new RegExp(`(?:摘要|用途)[：:]?${salaryWords}`),
    new RegExp(`(?:备注|客户附言)[：:]?[^\\n]{0,80}${salaryWords}`),
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

export function buildHumanCostReceiptRecognition(
  amounts: Array<number | null>,
  options: HumanCostReceiptRecognitionOptions = {},
): HumanCostReceiptRecognition {
  const ignoredItemCount = Math.max(0, options.ignoredItemCount || 0);
  const validationErrors = options.validationErrors || [];
  const recognizedAmounts = amounts.filter(
    (amount): amount is number =>
      amount !== null && Number.isFinite(amount) && amount > 0,
  );
  const recognizedAmount = centsToAmount(
    recognizedAmounts.reduce(
      (total, amount) => total + Math.round(amount * 100),
      0,
    ),
  );

  if (recognizedAmounts.length === 0) {
    return {
      recognizedAmount,
      recognitionStatus: "failed",
      recognizedItemCount: 0,
      totalItemCount: amounts.length,
      ignoredItemCount,
      recognitionError:
        ignoredItemCount > 0
          ? `未识别到工资银行回单，已忽略 ${ignoredItemCount} 笔非工资回单`
          : validationErrors[0] ||
            "文件未通过银行回单校验，请上传真实、清晰的银行电子回单",
    };
  }

  if (
    recognizedAmounts.length < amounts.length &&
    !options.acceptRecognizedItemsWithoutReview
  ) {
    const invalidCount = amounts.length - recognizedAmounts.length;
    return {
      recognizedAmount,
      recognitionStatus: "partial",
      recognizedItemCount: recognizedAmounts.length,
      totalItemCount: amounts.length,
      ignoredItemCount,
      recognitionError: `有 ${invalidCount} 笔未通过银行回单校验，汇总仅包含校验成功的回单`,
    };
  }

  return {
    recognizedAmount,
    recognitionStatus: "recognized",
    recognizedItemCount: recognizedAmounts.length,
    totalItemCount: amounts.length,
    ignoredItemCount,
    recognitionError: null,
  };
}
