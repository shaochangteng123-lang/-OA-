import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { nanoid } from "nanoid";
import {
  EMPLOYEE_DOCUMENT_TYPE_LABELS,
  classifyEmployeeDocument,
  detectEmployeeDocumentPageBoundary,
  type EmployeeDocumentPageBoundary,
  type EmployeeDocumentType,
} from "./employeeDocumentClassifier.js";

const MAX_EMPLOYEE_DOCUMENT_BUNDLE_PAGES = 80;
const SINGLE_PAGE_EMPLOYEE_DOCUMENT_TYPES = new Set<EmployeeDocumentType>([
  "application",
  "declaration",
  "id_card",
  "bank_card",
]);

export interface EmployeeDocumentBundleBoundary extends EmployeeDocumentPageBoundary {
  pageNumber: number;
}

export interface EmployeeDocumentBundleSection {
  documentType: EmployeeDocumentType;
  label: string;
  pageNumbers: number[];
}

export interface UnsupportedEmployeeDocumentSegment {
  label: string;
  pageNumbers: number[];
}

export interface UncertainEmployeeDocumentPage {
  pageNumber: number;
  candidateTypes: EmployeeDocumentType[];
  candidateLabels: string[];
  message: string;
}

export interface EmployeeDocumentBundleAnalysis {
  status: "success" | "uncertain";
  pageCount: number;
  sections: EmployeeDocumentBundleSection[];
  unsupportedSegments: UnsupportedEmployeeDocumentSegment[];
  uncertainPages: UncertainEmployeeDocumentPage[];
  missingTypes: EmployeeDocumentType[];
  message: string;
}

export interface AnalyzeEmployeeDocumentBundleOptions {
  onPageRecognized?: (
    pageNumber: number,
    recognizedTextCandidates: string[],
  ) => void;
}

export interface SplitEmployeeDocumentFile {
  documentType: EmployeeDocumentType;
  label: string;
  pageNumbers: number[];
  filePath: string;
  originalFileName: string;
  fileSize: number;
  mimeType: "application/pdf";
}

export function assertEmployeeDocumentBundlePageCoverage(
  pageCount: number,
  sections: EmployeeDocumentBundleSection[],
): void {
  const pageNumbers = sections.flatMap((section) => section.pageNumbers);
  const uniquePageNumbers = new Set(pageNumbers);
  const hasEveryPage = Array.from(
    { length: pageCount },
    (_, index) => index + 1,
  ).every((pageNumber) => uniquePageNumbers.has(pageNumber));
  const hasOnlyValidPages = pageNumbers.every(
    (pageNumber) =>
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= pageCount,
  );

  if (
    pageNumbers.length !== pageCount ||
    uniquePageNumbers.size !== pageCount ||
    !hasEveryPage ||
    !hasOnlyValidPages
  ) {
    throw new Error("员工档案拆分页码存在遗漏、重复或越界，已停止归档");
  }
}

function buildMissingTypes(
  sections: EmployeeDocumentBundleSection[],
): EmployeeDocumentType[] {
  const detectedTypes = new Set(
    sections.map((section) => section.documentType),
  );
  return (
    Object.keys(EMPLOYEE_DOCUMENT_TYPE_LABELS) as EmployeeDocumentType[]
  ).filter((type) => type !== "other" && !detectedTypes.has(type));
}

export function groupEmployeeDocumentBundlePages(
  pageCount: number,
  boundaries: EmployeeDocumentBundleBoundary[],
): {
  sections: EmployeeDocumentBundleSection[];
  unsupportedSegments: UnsupportedEmployeeDocumentSegment[];
} {
  if (boundaries.some((boundary) => boundary.kind === "uncertain")) {
    throw new Error("存在分类不确定页面，不能自动归组");
  }

  const boundaryByPage = new Map(
    boundaries
      .filter(
        (boundary) =>
          Number.isInteger(boundary.pageNumber) &&
          boundary.pageNumber >= 1 &&
          boundary.pageNumber <= pageCount,
      )
      .map((boundary) => [boundary.pageNumber, boundary]),
  );
  const sections: EmployeeDocumentBundleSection[] = [];
  const unsupportedSegments: UnsupportedEmployeeDocumentSegment[] = [];

  let currentSection: EmployeeDocumentBundleSection | null = null;
  let currentUnsupported: UnsupportedEmployeeDocumentSegment | null = null;

  const createDocumentSection = (
    documentType: EmployeeDocumentType,
  ): EmployeeDocumentBundleSection => {
    const section = {
      documentType,
      label: EMPLOYEE_DOCUMENT_TYPE_LABELS[documentType],
      pageNumbers: [],
    };
    sections.push(section);
    return section;
  };

  const createOtherSection = (label: string): EmployeeDocumentBundleSection => {
    const section = {
      documentType: "other" as const,
      label,
      pageNumbers: [],
    };
    sections.push(section);
    return section;
  };

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const boundary = boundaryByPage.get(pageNumber);
    if (boundary?.kind === "document" && boundary.documentType) {
      if (
        !currentSection ||
        currentSection.documentType !== boundary.documentType
      ) {
        currentSection = createDocumentSection(boundary.documentType);
      }
      currentUnsupported = null;
    } else if (boundary?.kind === "unsupported") {
      const otherLabel = boundary.label || "其他材料";
      currentSection = createOtherSection(otherLabel);
      currentUnsupported = {
        label: otherLabel,
        pageNumbers: [],
      };
      unsupportedSegments.push(currentUnsupported);
    } else if (!currentSection) {
      currentSection = createOtherSection("其他");
      currentUnsupported = { label: "未识别材料", pageNumbers: [] };
      unsupportedSegments.push(currentUnsupported);
    }

    currentSection?.pageNumbers.push(pageNumber);
    if (currentSection?.documentType === "other") {
      currentUnsupported?.pageNumbers.push(pageNumber);
    }
  }

  return {
    sections: sections.filter((section) => section.pageNumbers.length > 0),
    unsupportedSegments: unsupportedSegments.filter(
      (segment) => segment.pageNumbers.length > 0,
    ),
  };
}

export async function analyzeEmployeeDocumentBundle(
  pdfPath: string,
  originalFileName: string,
  options: AnalyzeEmployeeDocumentBundleOptions = {},
): Promise<EmployeeDocumentBundleAnalysis> {
  const sourceBytes = fs.readFileSync(pdfPath);
  const sourceDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const pageCount = sourceDocument.getPageCount();

  if (pageCount === 0) {
    return {
      status: "uncertain",
      pageCount,
      sections: [],
      unsupportedSegments: [],
      uncertainPages: [],
      missingTypes: buildMissingTypes([]),
      message: "上传文件没有可识别页面",
    };
  }
  if (pageCount > MAX_EMPLOYEE_DOCUMENT_BUNDLE_PAGES) {
    return {
      status: "uncertain",
      pageCount,
      sections: [],
      unsupportedSegments: [],
      uncertainPages: [],
      missingTypes: buildMissingTypes([]),
      message: `合并档案最多支持${MAX_EMPLOYEE_DOCUMENT_BUNDLE_PAGES}页`,
    };
  }

  const boundaries: EmployeeDocumentBundleBoundary[] = [];
  const leadingUnclassifiedPages: number[] = [];
  let hasExplicitBoundary = false;
  let activeDocumentType: EmployeeDocumentType | null = null;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const boundary = await detectEmployeeDocumentPageBoundary(
      pdfPath,
      originalFileName,
      pageNumber,
      {
        onPageRecognized: (recognizedTextCandidates) => {
          options.onPageRecognized?.(pageNumber, recognizedTextCandidates);
        },
      },
    );
    if (
      boundary.kind === "none" &&
      boundary.source !== null &&
      !hasExplicitBoundary
    ) {
      leadingUnclassifiedPages.push(pageNumber);
    }
    if (boundary.kind !== "none") hasExplicitBoundary = true;

    if (boundary.kind === "document" && boundary.documentType) {
      activeDocumentType = boundary.documentType;
    } else if (boundary.kind === "unsupported") {
      activeDocumentType = "other";
    }

    if (boundary.kind === "none" && !boundary.source) {
      boundaries.push({
        pageNumber,
        kind: "uncertain",
        documentType: null,
        label: "本页没有足够的识别结果，无法确认档案边界",
        source: null,
        candidateTypes: [],
      });
    } else if (
      boundary.kind === "none" &&
      activeDocumentType &&
      SINGLE_PAGE_EMPLOYEE_DOCUMENT_TYPES.has(activeDocumentType)
    ) {
      boundaries.push({
        pageNumber,
        kind: "uncertain",
        documentType: null,
        label: `上一页已识别为${EMPLOYEE_DOCUMENT_TYPE_LABELS[activeDocumentType]}，本页虽有文字但未建立新的档案边界`,
        source: boundary.source,
        candidateTypes: [],
      });
    } else if (boundary.kind !== "none") {
      boundaries.push({ pageNumber, ...boundary });
    }
  }

  if (leadingUnclassifiedPages.length > 0 && hasExplicitBoundary) {
    const firstPage = leadingUnclassifiedPages[0];
    const lastPage = leadingUnclassifiedPages.at(-1) || firstPage;
    boundaries.push({
      pageNumber: firstPage,
      kind: "uncertain",
      documentType: null,
      label:
        firstPage === lastPage
          ? `第${firstPage}页位于首个明确档案之前，未识别出可靠首页类型`
          : `第${firstPage}至${lastPage}页位于首个明确档案之前，未识别出可靠首页类型`,
      source: null,
      candidateTypes: [],
    });
  }

  const uncertainPages = boundaries
    .filter((boundary) => boundary.kind === "uncertain")
    .map((boundary) => {
      const candidateTypes = boundary.candidateTypes || [];
      return {
        pageNumber: boundary.pageNumber,
        candidateTypes,
        candidateLabels: candidateTypes.map(
          (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
        ),
        message: boundary.label || "无法确定该页档案类型",
      };
    });
  if (uncertainPages.length > 0) {
    const conflictDetails = uncertainPages
      .map((page) =>
        page.candidateLabels.length > 0
          ? `第${page.pageNumber}页同时匹配${page.candidateLabels.join("、")}`
          : `第${page.pageNumber}页无法确定类型`,
      )
      .join("；");
    return {
      status: "uncertain",
      pageCount,
      sections: [],
      unsupportedSegments: [],
      uncertainPages,
      missingTypes: buildMissingTypes([]),
      message: `${conflictDetails}，为避免错误归档，本次未上传任何文件`,
    };
  }

  const grouped = groupEmployeeDocumentBundlePages(pageCount, boundaries);
  assertEmployeeDocumentBundlePageCoverage(pageCount, grouped.sections);
  if (!boundaries.some((boundary) => boundary.kind === "document")) {
    if (!boundaries.some((boundary) => boundary.kind === "unsupported")) {
      const fallbackClassification = await classifyEmployeeDocument(
        pdfPath,
        originalFileName,
      );
      if (pageCount > 1) {
        const candidateTypes =
          fallbackClassification.status === "success" &&
          fallbackClassification.documentType
            ? [fallbackClassification.documentType]
            : fallbackClassification.candidateTypes || [];
        const candidateLabels = candidateTypes.map(
          (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
        );
        return {
          status: "uncertain",
          pageCount,
          sections: [],
          unsupportedSegments: [],
          uncertainPages: [
            {
              pageNumber: 1,
              candidateTypes,
              candidateLabels,
              message:
                candidateLabels.length > 0
                  ? `多页文件未识别出可靠页段边界，整文件仅能判断为${candidateLabels.join("、")}`
                  : "多页文件未识别出可靠页段边界，无法确认每一页的档案类型",
            },
          ],
          missingTypes: buildMissingTypes([]),
          message:
            "多页文件未识别出可靠页段边界，为避免整份错误归档，本次未上传任何文件",
        };
      }

      if (
        fallbackClassification.status === "success" &&
        fallbackClassification.documentType
      ) {
        const sections = [
          {
            documentType: fallbackClassification.documentType,
            label:
              EMPLOYEE_DOCUMENT_TYPE_LABELS[
                fallbackClassification.documentType
              ],
            pageNumbers: Array.from(
              { length: pageCount },
              (_, index) => index + 1,
            ),
          },
        ];
        return {
          status: "success",
          pageCount,
          sections,
          unsupportedSegments: [],
          uncertainPages: [],
          missingTypes: buildMissingTypes(sections),
          message: `已识别1类档案，共${pageCount}页`,
        };
      }
      if (fallbackClassification.uncertaintyReason === "ambiguous") {
        const candidateTypes = fallbackClassification.candidateTypes || [];
        return {
          status: "uncertain",
          pageCount,
          sections: [],
          unsupportedSegments: [],
          uncertainPages: [
            {
              pageNumber: 1,
              candidateTypes,
              candidateLabels: candidateTypes.map(
                (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
              ),
              message: fallbackClassification.message,
            },
          ],
          missingTypes: buildMissingTypes([]),
          message: "第一页存在分类冲突，为避免错误归档，本次未上传任何文件",
        };
      }
    }

    return {
      status: "success",
      pageCount,
      sections: grouped.sections,
      unsupportedSegments: grouped.unsupportedSegments,
      uncertainPages: [],
      missingTypes: buildMissingTypes(grouped.sections),
      message: `未匹配固定类型的${pageCount}页资料已归档至其他`,
    };
  }

  return {
    status: "success",
    pageCount,
    sections: grouped.sections,
    unsupportedSegments: grouped.unsupportedSegments,
    uncertainPages: [],
    missingTypes: buildMissingTypes(grouped.sections),
    message: `已识别并拆分${grouped.sections.length}份档案，共${pageCount}页`,
  };
}

export function mapEmployeeDocumentSectionRecognizedTexts(
  sourcePageNumbers: number[],
  recognizedTextBySourcePage: ReadonlyMap<number, readonly string[]>,
): ReadonlyMap<number, readonly string[]> {
  const recognizedTextBySectionPage = new Map<number, readonly string[]>();
  sourcePageNumbers.forEach((sourcePageNumber, sectionPageIndex) => {
    const recognizedTextCandidates = (
      recognizedTextBySourcePage.get(sourcePageNumber) || []
    )
      .map((recognizedText) => recognizedText.trim())
      .filter(Boolean);
    if (recognizedTextCandidates.length > 0) {
      recognizedTextBySectionPage.set(
        sectionPageIndex + 1,
        recognizedTextCandidates,
      );
    }
  });
  return recognizedTextBySectionPage;
}

function buildSplitOriginalFileName(
  originalFileName: string,
  label: string,
): string {
  const baseName = path.basename(
    originalFileName,
    path.extname(originalFileName),
  );
  const employeePrefix = baseName.includes("-")
    ? baseName.slice(0, baseName.indexOf("-"))
    : baseName.slice(0, 60);
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  return `${employeePrefix}-${safeLabel}.pdf`;
}

export async function splitEmployeeDocumentBundle(
  sourcePath: string,
  originalFileName: string,
  sections: EmployeeDocumentBundleSection[],
): Promise<SplitEmployeeDocumentFile[]> {
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  assertEmployeeDocumentBundlePageCoverage(
    sourceDocument.getPageCount(),
    sections,
  );
  const outputFiles: SplitEmployeeDocumentFile[] = [];

  try {
    for (const section of sections) {
      const outputDocument = await PDFDocument.create();
      const copiedPages = await outputDocument.copyPages(
        sourceDocument,
        section.pageNumbers.map((pageNumber) => pageNumber - 1),
      );
      copiedPages.forEach((page) => outputDocument.addPage(page));
      const outputBytes = await outputDocument.save();
      const outputPath = path.join(
        path.dirname(sourcePath),
        `document-${Date.now()}-${nanoid(6)}-${section.documentType}.pdf`,
      );
      fs.writeFileSync(outputPath, outputBytes);
      outputFiles.push({
        documentType: section.documentType,
        label: section.label,
        pageNumbers: section.pageNumbers,
        filePath: outputPath,
        originalFileName: buildSplitOriginalFileName(
          originalFileName,
          section.label,
        ),
        fileSize: outputBytes.length,
        mimeType: "application/pdf",
      });
    }
    return outputFiles;
  } catch (error) {
    for (const file of outputFiles) {
      try {
        if (fs.existsSync(file.filePath)) fs.unlinkSync(file.filePath);
      } catch {
        // 忽略拆分失败后的文件清理错误
      }
    }
    throw error;
  }
}
