import { createCanvas } from "canvas";
import { PDFDocument } from "pdf-lib";

export interface MainBusinessTriplicatePdfInput {
  projectName: string;
  contractAmount: number;
  currentPayment: number;
  previousPayment: number;
  cumulativePayment: number;
  expenseItem?: string;
}

const FONT = '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const SERIF_FONT = '"Noto Serif CJK SC", "Songti SC", serif';
const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

export function formatTriplicateAmount(value: number): string {
  const cents = Math.round(Number(value || 0) * 100);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function drawCentered(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  font: string,
): void {
  context.save();
  context.font = font;
  context.fillStyle = "#111111";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, top + height / 2, width - 12);
  context.restore();
}

function drawVerticalLabel(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  centerX: number,
  centerY: number,
): void {
  const characters = Array.from(text.replace(/\s+/g, ""));
  const gap = 32;
  const totalHeight = characters.length * gap;
  context.save();
  context.font = `22px ${SERIF_FONT}`;
  context.fillStyle = "#111111";
  context.textAlign = "center";
  context.textBaseline = "middle";
  characters.forEach((character, index) => {
    context.fillText(
      character,
      centerX,
      centerY - totalHeight / 2 + gap / 2 + index * gap,
    );
  });
  context.restore();
}

function projectFontSize(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  projectName: string,
  maximumWidth: number,
): number {
  for (let size = 26; size >= 18; size -= 1) {
    context.font = `bold ${size}px ${SERIF_FONT}`;
    if (context.measureText(projectName).width <= maximumWidth) return size;
  }
  return 18;
}

function renderTriplicatePage(
  input: MainBusinessTriplicatePdfInput,
  copyLabel: string,
): Buffer {
  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.strokeStyle = "#111111";
  context.fillStyle = "#111111";
  context.lineWidth = 1.6;
  const titleCenterY = 298;

  context.font = `bold 48px ${SERIF_FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("其他费用结算审定表", PAGE_WIDTH / 2, titleCenterY);

  const tableLeft = 148;
  const tableRight = 1046;
  const copyLeft = 1048;
  const copyRight = 1078;
  const projectTop = 338;
  const projectHeight = 68;

  const projectLabel = "工程项目名称：";
  const projectLabelLeft = tableLeft + 4;
  context.font = `bold 24px ${SERIF_FONT}`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(projectLabel, projectLabelLeft, projectTop + 36);
  const projectName = input.projectName.trim();
  const nameStart =
    projectLabelLeft + context.measureText(projectLabel).width + 2;
  context.font = `bold ${projectFontSize(context, projectName, tableRight - nameStart - 96)}px ${SERIF_FONT}`;
  context.fillText(
    projectName,
    nameStart,
    projectTop + 36,
    tableRight - nameStart - 96,
  );
  context.font = `22px ${SERIF_FONT}`;
  context.fillText("单位：元", tableRight - 84, projectTop + 36);

  const columns = [tableLeft, 388, 498, 646, 770, 908, tableRight];
  const headerTop = projectTop + projectHeight;
  const headerMid = headerTop + 44;
  const headerBottom = headerMid + 42;
  const rowHeight = 51;
  const detailRows = 15;
  const detailBottom = headerBottom + rowHeight * detailRows;
  const totalBottom = detailBottom + 44;

  context.strokeRect(
    tableLeft,
    headerTop,
    tableRight - tableLeft,
    totalBottom - headerTop,
  );
  for (const x of columns.slice(1, -1)) {
    context.beginPath();
    context.moveTo(x, x === columns[4] ? headerMid : headerTop);
    context.lineTo(x, totalBottom);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(columns[3], headerMid);
  context.lineTo(columns[5], headerMid);
  context.stroke();
  context.beginPath();
  context.moveTo(tableLeft, headerBottom);
  context.lineTo(tableRight, headerBottom);
  context.stroke();
  for (let row = 1; row <= detailRows; row += 1) {
    const y = headerBottom + row * rowHeight;
    context.beginPath();
    context.moveTo(tableLeft, y);
    context.lineTo(tableRight, y);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(tableLeft, detailBottom);
  context.lineTo(tableRight, detailBottom);
  context.stroke();

  drawCentered(
    context,
    "其他费用项目",
    columns[0],
    headerTop,
    columns[1] - columns[0],
    headerBottom - headerTop,
    `27px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "概算金额",
    columns[1],
    headerTop,
    columns[2] - columns[1],
    headerBottom - headerTop,
    `26px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "合同金额",
    columns[2],
    headerTop,
    columns[3] - columns[2],
    headerBottom - headerTop,
    `26px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "实际金额",
    columns[3],
    headerTop,
    columns[5] - columns[3],
    headerMid - headerTop,
    `27px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "本次付款",
    columns[3],
    headerMid,
    columns[4] - columns[3],
    headerBottom - headerMid,
    `25px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "累计付款",
    columns[4],
    headerMid,
    columns[5] - columns[4],
    headerBottom - headerMid,
    `25px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    "备注",
    columns[5],
    headerTop,
    columns[6] - columns[5],
    headerBottom - headerTop,
    `26px ${SERIF_FONT}`,
  );

  const firstRowTop = headerBottom;
  drawCentered(
    context,
    input.expenseItem || "前期手续技术咨询服务",
    columns[0],
    firstRowTop,
    columns[1] - columns[0],
    rowHeight,
    `22px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    formatTriplicateAmount(input.contractAmount),
    columns[2],
    firstRowTop,
    columns[3] - columns[2],
    rowHeight,
    `23px ${FONT}`,
  );
  drawCentered(
    context,
    formatTriplicateAmount(input.currentPayment),
    columns[3],
    firstRowTop,
    columns[4] - columns[3],
    rowHeight,
    `23px ${FONT}`,
  );
  drawCentered(
    context,
    formatTriplicateAmount(input.cumulativePayment),
    columns[4],
    firstRowTop,
    columns[5] - columns[4],
    rowHeight,
    `23px ${FONT}`,
  );

  drawCentered(
    context,
    "合计",
    columns[0],
    detailBottom,
    columns[1] - columns[0],
    totalBottom - detailBottom,
    `28px ${SERIF_FONT}`,
  );
  drawCentered(
    context,
    formatTriplicateAmount(input.currentPayment),
    columns[3],
    detailBottom,
    columns[4] - columns[3],
    totalBottom - detailBottom,
    `23px ${FONT}`,
  );
  drawCentered(
    context,
    formatTriplicateAmount(input.cumulativePayment),
    columns[4],
    detailBottom,
    columns[5] - columns[4],
    totalBottom - detailBottom,
    `23px ${FONT}`,
  );

  drawVerticalLabel(
    context,
    copyLabel,
    (copyLeft + copyRight) / 2,
    (headerTop + totalBottom) / 2 - 24,
  );

  const footerTop = totalBottom + 25;
  const footerWidth = tableRight - tableLeft;
  const footerColumnWidth = footerWidth / 3;
  const footerTitles = [
    "施工单位（盖章）",
    "二级组织单位（盖章）",
    "组织单位（盖章）",
  ];
  footerTitles.forEach((title, index) => {
    const x = tableLeft + footerColumnWidth * index + 12;
    context.font = `24px ${SERIF_FONT}`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(`${title}：`, x, footerTop + 35, footerColumnWidth - 24);
    context.fillText("负责人：", x, footerTop + 77);
    context.fillText("日  期：", x, footerTop + 119);
  });

  return canvas.toBuffer("image/png");
}

export async function renderMainBusinessTriplicatePdf(
  input: MainBusinessTriplicatePdfInput,
): Promise<Buffer> {
  const copies = [
    "第一联财务处留存",
    "第二联工程组织单位留存",
    "第三联施工单位留存",
  ];
  const document = await PDFDocument.create();
  for (const copy of copies) {
    const png = renderTriplicatePage(input, copy);
    const image = await document.embedPng(png);
    const page = document.addPage([PDF_WIDTH, PDF_HEIGHT]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: PDF_WIDTH,
      height: PDF_HEIGHT,
    });
  }
  return Buffer.from(await document.save());
}
