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

export interface EmployeeDocumentBundleAnalysis {
  status: "success" | "uncertain";
  pageCount: number;
  sections: EmployeeDocumentBundleSection[];
  unsupportedSegments: UnsupportedEmployeeDocumentSegment[];
  missingTypes: EmployeeDocumentType[];
  message: string;
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
  const sectionByType = new Map<
    EmployeeDocumentType,
    EmployeeDocumentBundleSection
  >();
  const sections: EmployeeDocumentBundleSection[] = [];
  const unsupportedSegments: UnsupportedEmployeeDocumentSegment[] = [];

  let currentSection: EmployeeDocumentBundleSection | null = null;
  let currentUnsupported: UnsupportedEmployeeDocumentSegment | null = null;

  const getOrCreateSection = (
    documentType: EmployeeDocumentType,
  ): EmployeeDocumentBundleSection => {
    const existing = sectionByType.get(documentType);
    if (existing) return existing;
    const section = {
      documentType,
      label: EMPLOYEE_DOCUMENT_TYPE_LABELS[documentType],
      pageNumbers: [],
    };
    sectionByType.set(documentType, section);
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
      currentSection = getOrCreateSection(boundary.documentType);
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
      missingTypes: buildMissingTypes([]),
      message: `合并档案最多支持${MAX_EMPLOYEE_DOCUMENT_BUNDLE_PAGES}页`,
    };
  }

  const boundaries: EmployeeDocumentBundleBoundary[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const boundary = await detectEmployeeDocumentPageBoundary(
      pdfPath,
      originalFileName,
      pageNumber,
    );
    if (boundary.kind !== "none") {
      boundaries.push({ pageNumber, ...boundary });
    }
  }

  const grouped = groupEmployeeDocumentBundlePages(pageCount, boundaries);
  if (!boundaries.some((boundary) => boundary.kind === "document")) {
    if (!boundaries.some((boundary) => boundary.kind === "unsupported")) {
      const fallbackClassification = await classifyEmployeeDocument(
        pdfPath,
        originalFileName,
      );
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
          missingTypes: buildMissingTypes(sections),
          message: `已识别1类档案，共${pageCount}页`,
        };
      }
    }

    return {
      status: "success",
      pageCount,
      sections: grouped.sections,
      unsupportedSegments: grouped.unsupportedSegments,
      missingTypes: buildMissingTypes(grouped.sections),
      message: `未匹配固定类型的${pageCount}页资料已归档至其他`,
    };
  }

  return {
    status: "success",
    pageCount,
    sections: grouped.sections,
    unsupportedSegments: grouped.unsupportedSegments,
    missingTypes: buildMissingTypes(grouped.sections),
    message: `已识别${grouped.sections.length}类档案，共${pageCount}页`,
  };
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
