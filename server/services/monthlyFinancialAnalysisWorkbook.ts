import { createHash } from "crypto";
import * as XLSX from "xlsx";
import type {
  FinancialAnalysisModuleKey,
  MonthlyFinancialAnalysisData,
} from "../types/monthly-financial-analysis.js";

export function monthlyFinancialAnalysisVersion(
  data: MonthlyFinancialAnalysisData,
): string {
  const stableData: Partial<MonthlyFinancialAnalysisData> = { ...data };
  delete stableData.generatedAt;
  delete stableData.dataVersion;
  return createHash("sha256").update(JSON.stringify(stableData)).digest("hex");
}

function amountText(value: string | null): string {
  if (value === null) return "未取得数据";
  const match = value.match(/^(-?\d+)(?:\.(\d+))?$/u);
  return match ? `${match[1]}.${(match[2] || "").padEnd(2, "0")}` : value;
}

function metricText(
  value: string | null,
  unit: "元" | "个" | "组" | undefined,
): string {
  return unit === "个" || unit === "组"
    ? (value ?? "未取得数据")
    : amountText(value);
}

function addTextSheet(
  workbook: XLSX.WorkBook,
  title: string,
  rows: string[][],
): void {
  // 所有单元格显式按文本写入，既保留大金额精度，也不执行用户文本中的公式。
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = Array.from(
    { length: rows.reduce((max, row) => Math.max(max, row.length), 1) },
    (_value, index) => ({ wch: index === 0 ? 25 : 30 }),
  );
  XLSX.utils.book_append_sheet(workbook, worksheet, title.slice(0, 31));
}

export function buildMonthlyFinancialAnalysisWorkbook(
  data: MonthlyFinancialAnalysisData,
  key: FinancialAnalysisModuleKey | "all" = "all",
): Buffer {
  const workbook = XLSX.utils.book_new();
  const modules =
    key === "all"
      ? data.modules
      : data.modules.filter((module) => module.key === key);
  if (modules.length === 0) throw new Error("没有可导出的分析模块");
  const comparisonModules = data.comparison
    ? data.comparison.modules.filter(
        (module) => key === "all" || module.key === key,
      )
    : [];
  if (data.comparison && comparisonModules.length !== modules.length)
    throw new Error("对比期分析模块不完整，无法导出两期报表");
  const query = data.query;
  addTextSheet(workbook, "查询说明", [
    ["项目", "内容"],
    ["开始月份", query.from],
    ["结束月份", query.to],
    [
      "统计周期",
      { month: "月度", quarter: "季度", year: "年度" }[query.granularity],
    ],
    ["合同甲方", query.partyA || "全部"],
    ["合同区域", query.contractRegion || "全部"],
    ["报销范围", query.reimbursementScope || "全部"],
    ["人员编号", query.personId || "全部"],
    ["生成时间", data.generatedAt],
    ["数据版本", data.dataVersion || monthlyFinancialAnalysisVersion(data)],
    ...(data.comparison
      ? [
          ["往年对比", data.comparison.label],
          ["对比开始月份", data.comparison.query.from],
          ["对比结束月份", data.comparison.query.to],
          ...data.comparison.warnings.map((warning) => ["对比期提示", warning]),
        ]
      : []),
    [
      "金额说明",
      "金额单元格以十进制文本保留精度，至少两位小数；未取得数据不按零处理。",
    ],
    ...data.warnings.map((warning) => ["提示", warning]),
  ]);
  const groups = [
    { prefix: "", label: "本期", query: data.query, modules },
    ...(data.comparison
      ? [
          {
            prefix: "对比期-",
            label: data.comparison.label,
            query: data.comparison.query,
            modules: comparisonModules,
          },
        ]
      : []),
  ];
  for (const group of groups) {
    for (const module of group.modules) {
      const sheetName = (suffix: string) =>
        `${group.prefix}${module.title.slice(0, 31 - group.prefix.length - suffix.length)}${suffix}`;
      const seriesColumns = module.series.flatMap((series) => [
        {
          label: series.label,
          values: series.values,
          unit: series.unit,
        },
        ...(series.segments || []).map((segment) => ({
          label: `${series.label} · ${segment.label}`,
          values: segment.values,
          unit: series.unit,
        })),
      ]);
      addTextSheet(workbook, sheetName("-统计"), [
        ...(data.comparison
          ? [
              [
                "分析期间",
                `${group.label}：${group.query.from}至${group.query.to}`,
              ],
            ]
          : []),
        ["口径", module.description],
        ["来源", module.sourceLabel],
        ["更新时间", module.updatedAt || "未记录"],
        ["适用筛选", module.appliedFilters.join("、") || "无额外筛选"],
        ...module.warnings.map((warning) => ["提示", warning]),
        [],
        ["指标", "金额／数量", "说明"],
        ...module.summaries.map((value) => [
          value.label,
          metricText(value.amount, value.unit),
          value.note || "",
        ]),
        [],
        ["统计期间", ...seriesColumns.map((series) => series.label)],
        ...module.periods.map((period, index) => [
          period.label,
          ...seriesColumns.map((series) =>
            metricText(series.values[index] ?? null, series.unit),
          ),
        ]),
        [],
        ["结构分类", "金额"],
        ...module.breakdown.map((value) => [
          value.label,
          amountText(value.amount),
        ]),
        [],
        ["对比项目", "金额"],
        ...module.comparison.map((value) => [
          value.label,
          amountText(value.amount),
        ]),
      ]);
      addTextSheet(workbook, sheetName("-明细"), [
        module.columns.map((column) => column.label),
        ...module.details.map((detail) =>
          module.columns.map((column) =>
            column.format === "amount"
              ? amountText(detail[column.key] ?? null)
              : (detail[column.key] ?? "—"),
          ),
        ),
      ]);
      if (module.key === "personnel" && module.personnelAnnualDetails)
        addTextSheet(workbook, sheetName("-年度"), [
          module.columns.map((column) => column.label),
          ...module.personnelAnnualDetails.map((detail) =>
            module.columns.map((column) =>
              column.format === "amount"
                ? amountText(detail[column.key] ?? null)
                : (detail[column.key] ?? "—"),
            ),
          ),
        ]);
      if (module.key === "personnel" && module.housingCostBreakdown?.length)
        addTextSheet(workbook, sheetName("-住房构成"), [
          [
            "口径",
            module.housingCostBasis === "invoice-lease"
              ? "所选期间房屋租赁公司成本（分摊前），不与个人费用重复相加。每份合同全部已上传并确认的有效发票按其实际租赁天数分摊，当前月截至当天；不叠加合同计提或银行回单金额。新发票会更新全租期基数，未到期份额留在后续期间；各合同分别计算后合并，可退押金不计费用。"
              : "所选期间房屋租赁公司成本（分摊前），仅用于核对分摊基数，不与个人费用重复相加；固定租金物业按租期，变量费用按原票收费月份。跨合同保留旧址历史费用，新址按起租日和各自收费项目接续，不按签订月替代起租月，不沿用旧址费用。",
          ],
          ["开始月份", group.query.from, "结束月份", group.query.to],
          ["费用分类", "确认金额", "已知金额", "说明"],
          ...module.housingCostBreakdown.map((item) => [
            item.label,
            amountText(item.amount),
            amountText(item.knownAmount),
            item.note || "",
          ]),
        ]);
      if (
        module.key === "personnel" &&
        module.personnelUnassignedReimbursements?.length
      )
        addTextSheet(workbook, sheetName("-未归期报销"), [
          [
            "口径",
            module.personnelReimbursementBasis === "reimbursement-month"
              ? "全历史已确认但缺少有效报销月份的记录；不属于当前查询月份，未计入期间或年度成本。"
              : "全历史已付款但缺少有效付款日期的记录；不属于当前查询月份，未计入期间或年度成本。",
          ],
          [
            "人员",
            "报销类型",
            "金额",
            "状态",
            module.personnelReimbursementBasis === "reimbursement-month"
              ? "归期说明"
              : "原付款日期",
            "记录编号",
          ],
          ...module.personnelUnassignedReimbursements.map((row) => [
            row.personName || "人员待确认",
            { basic: "基础报销", large: "大额报销", business: "商务报销" }[
              row.type
            ],
            amountText(row.amount),
            {
              approved: "已审批确认",
              paid: "已付款",
              payment_uploaded: "付款已上传",
              completed: "已完成",
            }[row.status] || "待核对",
            module.personnelReimbursementBasis === "reimbursement-month"
              ? row.reason || "报销月份缺失或无效"
              : row.date || "缺少有效付款日期",
            row.sourceId,
          ]),
        ]);
    }
  }
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  }) as Buffer;
}
