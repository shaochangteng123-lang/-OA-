import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { PDFDocument } from "pdf-lib";
import {
  analyzePageXml,
  recognizeBankReceiptImage,
  splitImage,
} from "./bankReceiptProcessor.js";
import { parseAndValidatePaymentProofText } from "./paymentProofOcr.js";
import {
  buildHumanCostReceiptRecognition,
  isSalaryPaymentProofText,
  type HumanCostReceiptRecognition,
} from "../utils/human-cost-receipt.js";

export type HumanCostReceiptCategory =
  | "social_security"
  | "housing_fund"
  | "income_tax"
  | "net_salary";

interface ReceiptImageItem {
  pageNo: number;
  position: "full" | "top" | "bottom";
  imagePath: string;
}

interface ReceiptImageRecognition {
  amounts: Array<number | null>;
  ignoredItemCount: number;
  validationErrors: string[];
  items: RecognizedHumanCostReceiptItem[];
}

export interface RecognizedHumanCostReceiptItem {
  pageNo: number;
  position: "full" | "top" | "bottom";
  payeeName: string;
  payeeAccount: string;
  amount: number;
  proofNo: string;
}

export interface HumanCostReceiptProcessingResult extends HumanCostReceiptRecognition {
  items: RecognizedHumanCostReceiptItem[];
}

async function convertPdfToReceiptImages(
  pdfPath: string,
  outputDir: string,
  totalPages: number,
): Promise<ReceiptImageItem[]> {
  const prefix = path.join(outputDir, "page");
  execFileSync("pdftoppm", ["-r", "160", "-jpeg", pdfPath, prefix], {
    timeout: 120_000,
  });

  const pageImages = new Map<number, string>();
  for (const fileName of fs.readdirSync(outputDir)) {
    const match = fileName.match(/^page-(\d+)\.jpg$/);
    if (!match) continue;
    pageImages.set(Number(match[1]), path.join(outputDir, fileName));
  }

  const items: ReceiptImageItem[] = [];
  for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
    const imagePath = pageImages.get(pageNo);
    if (!imagePath) continue;

    const { splitY } = analyzePageXml(pdfPath, pageNo);
    if (!splitY) {
      items.push({ pageNo, position: "full", imagePath });
      continue;
    }

    try {
      const split = await splitImage(
        imagePath,
        splitY,
        1262,
        outputDir,
        `page${pageNo}`,
      );
      items.push(
        { pageNo, position: "top", imagePath: split.top },
        { pageNo, position: "bottom", imagePath: split.bottom },
      );
    } catch {
      items.push({ pageNo, position: "full", imagePath });
    }
  }

  return items;
}

async function recognizeReceiptImages(
  items: ReceiptImageItem[],
  category: HumanCostReceiptCategory,
): Promise<ReceiptImageRecognition> {
  const amounts: Array<number | null> = [];
  const validationErrors: string[] = [];
  const recognizedItems: RecognizedHumanCostReceiptItem[] = [];
  let ignoredItemCount = 0;

  for (const item of items) {
    try {
      const rawResult = await recognizeBankReceiptImage(item.imagePath);
      if (
        category === "net_salary" &&
        !isSalaryPaymentProofText(rawResult.rawText)
      ) {
        ignoredItemCount += 1;
        continue;
      }
      const result = parseAndValidatePaymentProofText(rawResult.rawText, {
        allowMissingPayeeAccount: category === "net_salary",
      });
      amounts.push(result.amount);
      recognizedItems.push({
        pageNo: item.pageNo,
        position: item.position,
        payeeName: result.payee,
        payeeAccount: result.payeeAccount,
        amount: result.amount,
        proofNo: result.proofNo,
      });
    } catch (error) {
      amounts.push(null);
      validationErrors.push(
        error instanceof Error ? error.message : "银行回单校验失败",
      );
    }
  }

  return {
    amounts,
    ignoredItemCount,
    validationErrors,
    items: recognizedItems,
  };
}

export async function recognizeHumanCostReceipt(
  filePath: string,
  mimeType: string,
  receiptId: string,
  category: HumanCostReceiptCategory,
): Promise<HumanCostReceiptProcessingResult> {
  if (mimeType !== "application/pdf") {
    const recognition = await recognizeReceiptImages(
      [{ pageNo: 1, position: "full", imagePath: filePath }],
      category,
    );
    return {
      ...buildHumanCostReceiptRecognition(recognition.amounts, {
        ...recognition,
        acceptRecognizedItemsWithoutReview: category === "net_salary",
      }),
      items: recognition.items,
    };
  }

  const tempDirectory = path.join(
    process.cwd(),
    "uploads",
    "temp",
    `human-cost-${receiptId}`,
  );
  fs.mkdirSync(tempDirectory, { recursive: true });

  try {
    const document = await PDFDocument.load(fs.readFileSync(filePath));
    const totalPages = document.getPageCount();
    if (totalPages < 1) {
      return { ...buildHumanCostReceiptRecognition([]), items: [] };
    }

    const items = await convertPdfToReceiptImages(
      filePath,
      tempDirectory,
      totalPages,
    );
    const recognition = await recognizeReceiptImages(items, category);

    // 转换失败的页面也计入失败数，避免把不完整汇总标记为全部成功。
    const processedPageCount = new Set(items.map((item) => item.pageNo)).size;
    for (
      let missingPage = processedPageCount;
      missingPage < totalPages;
      missingPage += 1
    ) {
      recognition.amounts.push(null);
      recognition.validationErrors.push("回单页面转换失败");
    }
    return {
      ...buildHumanCostReceiptRecognition(recognition.amounts, {
        ...recognition,
        acceptRecognizedItemsWithoutReview: category === "net_salary",
      }),
      items: recognition.items,
    };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}
