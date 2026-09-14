<template>
  <section class="personnel-details" aria-label="人员费用明细与自然年汇总">
    <header class="personnel-details-heading">
      <div>
        <h4>人员费用明细</h4>
        <p>逐人核对费用分项；点击人员姓名可查询该人员并查看成本构成。</p>
      </div>
      <div class="personnel-details-actions">
        <button
          v-if="query.personId"
          type="button"
          class="personnel-reset-selection"
          :disabled="!active"
          @click="emit('clear-person')"
        >
          返回全部人员
        </button>
        <div
          class="personnel-view-tabs"
          role="group"
          aria-label="人员明细显示方式"
        >
          <button
            type="button"
            :aria-pressed="view === 'annual'"
            @click="view = 'annual'"
          >
            自然年汇总
          </button>
          <button
            type="button"
            :aria-pressed="view === 'period'"
            @click="view = 'period'"
          >
            {{ periodLabel }}分项明细
          </button>
        </div>
      </div>
    </header>
    <p class="personnel-table-scope">
      {{
        view === "annual"
          ? "按自然年独立汇总，不重复累加各期显示的年度金额；本年截至当前业务月份，未来费用不预估。"
          : `${query.from} 至 ${query.to} · ${periodLabel}分项明细`
      }}
    </p>
    <p
      v-if="module.payrollDetailsVisible === false"
      class="personnel-table-note"
      role="status"
    >
      当前账号无工资分项权限，仅显示已授权的工资成本合计与费用明细。
    </p>
    <div
      v-if="rows.length"
      class="personnel-table-scroll"
      tabindex="0"
      :aria-label="tableTitle + '，可横向滚动'"
    >
      <table class="personnel-cost-table">
        <caption>
          {{
            tableTitle
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="personnel-name-cell">人员</th>
            <th scope="col">
              {{ view === "annual" ? "自然年／实际范围" : "期间" }}
            </th>
            <th
              v-for="column in amountColumns"
              :key="column.key"
              scope="col"
              :class="{ 'personnel-total-cell': column.key === 'total' }"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :data-person-id="row.personId"
            :data-period="row.period"
          >
            <th scope="row" class="personnel-name-cell">
              <button
                v-if="row.personId && !row.personId.startsWith('unknown:')"
                type="button"
                :disabled="!active"
                :aria-label="`查看${row.person || '该人员'}成本构成`"
                @click="emit('select-person', row.personId)"
              >
                {{ row.person || "未记录姓名" }}
              </button>
              <span v-else>{{ row.person || "人员未确认" }}</span>
            </th>
            <td class="personnel-period-cell">
              <strong>{{
                view === "annual"
                  ? `${row.year || row.from?.slice(0, 4) || "未确认"}年`
                  : row.period
              }}</strong
              ><small v-if="row.from && row.to"
                >{{ row.from }} 至 {{ row.to }}</small
              >
            </td>
            <td
              v-for="column in amountColumns"
              :key="column.key"
              :data-cost-key="column.key"
              :class="{ 'personnel-total-cell': column.key === 'total' }"
            >
              <strong
                :class="{ 'is-unknown': cellAmount(row, column.key) === null }"
                >{{ displayAmount(cellAmount(row, column.key)) }}</strong
              >
              <small v-if="isPartial(row, column.key)" class="personnel-partial"
                >已知部分</small
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="personnel-empty" role="status">
      {{
        view === "annual"
          ? "当前没有可展示的自然年人员费用汇总，不以月度金额拼出未经核验的全年总额。"
          : "当前统计期间没有可展示的人员费用明细。"
      }}
    </p>
    <section
      v-if="module.housingCostBreakdown?.length"
      class="housing-cost-summary"
      aria-label="房屋租赁分摊基数"
    >
      <p class="personnel-table-scope">
        房屋租赁分摊基数（公司费用） · {{ query.from }} 至
        {{ query.to }}；以下为分摊前金额，不与个人合计重复相加。
      </p>
      <p class="housing-cost-total">
        {{ housingSummary.partial ? "已知费用合计" : "费用合计" }}：<strong>{{
          displayAmount(housingSummary.amount)
        }}</strong>
      </p>
      <dl>
        <div v-for="item in module.housingCostBreakdown" :key="item.key">
          <dt>{{ item.label }}</dt>
          <dd>
            {{ displayAmount(known(item.amount) ?? known(item.knownAmount))
            }}<small
              v-if="
                known(item.amount) === null && known(item.knownAmount) !== null
              "
              >已知部分</small
            >
          </dd>
        </div>
      </dl>
    </section>
    <div class="personnel-table-notes">
      <p v-if="module.personnelReimbursementBasis === 'reimbursement-month'">
        人力报销按系统已确认的报销月份统计，不以缺失付款日期排除已有费用；不修改银行付款日期或其他模块的现金收支口径。
      </p>
      <p>
        合计＝工资总成本＋基础报销＋大额报销＋商务报销＋{{
          module.housingCostBreakdown ? "房屋租赁成本分摊" : "房租分摊"
        }}；工资总成本已包含公司社保、公积金及实际调整，不与分项重复相加。
      </p>
      <p v-if="module.housingCostBasis === 'invoice-lease'">
        房屋租赁成本以每份合同全部已上传并确认的有效发票为基数，按该合同实际租赁天数分摊到各月，首尾月份按有效天数计算，当前月截至当天。分类费用先合并，再按当月人员名单分摊；不再叠加合同月租计提或银行回单金额。未到期份额留在后续期间，新上传发票会更新该合同全租期分摊基数；可退押金不计成本。
      </p>
      <p v-else-if="module.housingCostBreakdown">
        房屋租赁成本包括该住房合同的租金、物业管理费、电费、系统维护费及已确认的其他住房费用。租金和固定物业按租期计提，本月截至当天；电费等按原票明确收费月份归集。费用合并后按当月工资名单分摊，年度累计平衡尾差，不重复计算固定费用；可退押金和其他资产合同不作为住房成本。
      </p>
      <p v-if="module.housingCostBreakdown">
        跨合同汇总保留旧址历史费用，新址按新合同起租日接续，不按签订月份替代起租月份。各合同按自己的费用项目计入，明确不收取的项目为零，不沿用旧址收费；同月实际发生的多处住房费用合并后仅分摊一次。
      </p>
      <p v-else>
        房租按已生效租约的独立月租及实际租赁期间逐月计提，按当月有效工资名单等份，分币尾差按自然年累计精确应摊额平衡，各月合计保持一致；不集中到付款月份，不含物业、押金、电费、维护费或其他资产。离职人员历史费用保留，未知不按零处理。
      </p>
    </div>
    <section
      v-if="unassigned.length"
      class="personnel-unassigned"
      aria-label="未归期报销清单"
    >
      <header class="personnel-details-heading">
        <div>
          <h4>未归期报销 · {{ unassigned.length }}笔</h4>
          <p>
            {{
              module.personnelReimbursementBasis === "reimbursement-month"
                ? "以下为全历史已确认但缺少有效报销月份的记录"
                : "以下为全历史已付款但缺少有效付款日期的记录"
            }}，不受上方月份筛选，也没有计入月度、年度合计或饼图。
          </p>
        </div>
        <strong>{{ displayAmount(unassignedTotal) }}</strong>
      </header>
      <div class="personnel-table-scroll">
        <table class="personnel-cost-table">
          <caption>
            待核对的原始报销记录
          </caption>
          <thead>
            <tr>
              <th scope="col">人员</th>
              <th scope="col">报销类型</th>
              <th scope="col">金额</th>
              <th scope="col">归期状态</th>
              <th scope="col">记录编号</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in unassigned"
              :key="`${row.sourceId}:${index}`"
            >
              <td>{{ row.personName || "人员待确认" }}</td>
              <td>{{ reimbursementLabels[row.type] }}</td>
              <td>{{ displayAmount(known(row.amount)) }}</td>
              <td>
                {{
                  row.reason ||
                  (module.personnelReimbursementBasis === "reimbursement-month"
                    ? "报销月份缺失或无效"
                    : "缺少有效付款日期")
                }}
              </td>
              <td>{{ row.sourceId }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="personnel-table-note">
        金额来自原报销记录；归期信息或人员归属未确认前不分配到任意月份，也不把其他人员的归期缺失当作本人费用缺失。
      </p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisQuery,
} from "@/types/monthlyFinancialAnalysis";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";

const props = withDefaults(
  defineProps<{
    module: FinancialAnalysisModule;
    query: FinancialAnalysisQuery;
    active?: boolean;
  }>(),
  { active: true },
);
const emit = defineEmits<{
  "select-person": [personId: string];
  "clear-person": [];
}>();
const view = ref<"annual" | "period">("annual");
const periodLabel = computed(
  () =>
    ({ month: "月度", quarter: "季度", year: "年度" })[props.query.granularity],
);
const tableTitle = computed(() =>
  view.value === "annual"
    ? "自然年人员费用汇总"
    : `${periodLabel.value}人员费用分项明细`,
);
const labels = [
  ["salary", "应发工资"],
  ["social", "公司社保"],
  ["housing", "公司公积金"],
  ["adjustment", "实际发生调整"],
  ["payrollCost", "工资总成本（含公司缴费）"],
  ["basic", "基础报销"],
  ["large", "大额报销"],
  ["business", "商务报销"],
  ["overhead", "房租分摊"],
  ["total", "合计"],
] as const;
const privateKeys = new Set(["salary", "social", "housing", "adjustment"]);
const amountColumns = computed(() =>
  labels
    .filter(
      ([key]) =>
        props.module.columns.some((column) => column.key === key) &&
        !(props.module.payrollDetailsVisible === false && privateKeys.has(key)),
    )
    .map(([key, label]) => ({
      key,
      label:
        key === "overhead" && props.module.housingCostBreakdown
          ? "房屋租赁成本分摊"
          : label,
    })),
);
const rows = computed(() => {
  const source =
    view.value === "annual"
      ? props.module.personnelAnnualDetails || []
      : props.module.details;
  return source.filter(
    (row) =>
      row.personId &&
      (!props.query.personId || row.personId === props.query.personId),
  );
});
const reimbursementLabels = {
  basic: "基础报销",
  large: "大额报销",
  business: "商务报销",
};
const housingSummary = computed(() => {
  const items = props.module.housingCostBreakdown || [];
  const amounts = items.map(
    (item) => known(item.amount) ?? known(item.knownAmount),
  );
  return {
    partial: items.some((item) => known(item.amount) === null),
    amount: amounts.some((value) => value !== null)
      ? amounts.reduce<string>(
          (sum, value) =>
            value === null ? sum : addFinancialAmountTexts(sum, value),
          "0",
        )
      : null,
  };
});
const unassigned = computed(() =>
  (props.module.personnelUnassignedReimbursements || []).filter(
    (row) =>
      !props.query.personId ||
      !row.personId ||
      row.personId === props.query.personId,
  ),
);
const unassignedTotal = computed(() => {
  if (
    new Set(unassigned.value.map((row) => row.sourceId)).size !==
      unassigned.value.length ||
    unassigned.value.some((row) => known(row.amount) === null)
  )
    return null;
  return unassigned.value.reduce(
    (total, row) => addFinancialAmountTexts(total, row.amount),
    "0",
  );
});
function known(value: string | null | undefined): string | null {
  return typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/u.test(value.trim())
    ? value.trim()
    : null;
}
function cellAmount(row: FinancialAnalysisDetail, key: string): string | null {
  return (
    known(row[key]) ??
    known(key === "total" ? row.knownTotal : row[`known_${key}`])
  );
}
function isPartial(row: FinancialAnalysisDetail, key: string): boolean {
  return known(row[key]) === null && cellAmount(row, key) !== null;
}
function displayAmount(value: string | null): string {
  return value === null ? "未知／未核算" : formatMonthlyFinancialAmount(value);
}
</script>

<style scoped>
.personnel-details {
  margin-top: 18px;
  padding: 18px;
  border: 1px solid #dde8ee;
  border-radius: 12px;
  background: #fff;
  min-width: 0;
}
.personnel-details-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.personnel-details h4 {
  margin: 0;
  color: #284e60;
  font-size: 15px;
}
.personnel-details-heading p,
.personnel-table-scope,
.personnel-table-notes p,
.personnel-table-note {
  margin: 8px 0;
  color: #6b8190;
  font-size: 12px;
  line-height: 1.7;
}
.personnel-view-tabs {
  display: flex;
  flex-shrink: 0;
  padding: 3px;
  border: 1px solid #dce7ec;
  border-radius: 8px;
  background: #f5f9fa;
}
.personnel-details-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.personnel-reset-selection {
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid #b8d8dc;
  border-radius: 8px;
  background: #f5fbfb;
  color: #147d87;
  white-space: nowrap;
  cursor: pointer;
}
.personnel-reset-selection:disabled {
  opacity: 0.55;
  cursor: default;
}
.personnel-view-tabs button {
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #526c7a;
  cursor: pointer;
  white-space: nowrap;
}
.personnel-view-tabs button[aria-pressed="true"] {
  background: #147d87;
  color: white;
}
.personnel-table-scroll {
  overflow-x: auto;
  max-width: 100%;
  border: 1px solid #e1e9ef;
  border-radius: 8px;
}
.personnel-cost-table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.personnel-cost-table caption {
  text-align: center;
  padding: 10px 12px;
  color: #3c6173;
  font-weight: 600;
  background: #f5f9fb;
}
.personnel-cost-table th,
.personnel-cost-table td {
  padding: 13px 14px;
  border-bottom: 1px solid #eaf0f3;
  white-space: nowrap;
  text-align: center;
  vertical-align: middle;
  min-width: 130px;
}
.personnel-cost-table thead th {
  background: #f5f9fb;
  color: #4b697a;
  font-weight: 500;
}
.personnel-cost-table tbody tr:last-child > * {
  border-bottom: 0;
}
.personnel-cost-table .personnel-name-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 96px;
  background: #fff;
  text-align: center;
  box-shadow: 1px 0 #e1e9ef;
}
.personnel-cost-table thead .personnel-name-cell {
  background: #f5f9fb;
}
.personnel-name-cell button {
  background: none;
  border: 0;
  padding: 0;
  color: #137d87;
  font-weight: 600;
  cursor: pointer;
}
.personnel-name-cell button:disabled {
  cursor: default;
  color: #667b88;
}
.personnel-cost-table .personnel-period-cell {
  text-align: center;
}
.personnel-cost-table td strong {
  font-weight: 500;
  color: #355668;
}
.personnel-cost-table td .is-unknown {
  color: #8495a0;
}
.personnel-cost-table small {
  display: block;
  margin-top: 5px;
  font-size: 10px;
  color: #8193a0;
}
.personnel-cost-table .personnel-partial {
  color: #9b772f;
}
.personnel-cost-table .personnel-total-cell {
  background: #eef8f7;
}
.personnel-cost-table .personnel-total-cell strong {
  color: #117b83;
  font-weight: 700;
}
.personnel-empty {
  color: #748995;
  font-size: 13px;
  padding: 18px 0;
}
.personnel-table-notes {
  margin-top: 12px;
}
.personnel-unassigned {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e1e9ef;
}
.housing-cost-summary {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f4f9fa;
}
.housing-cost-summary dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin: 8px 0 0;
  text-align: center;
}
.housing-cost-total {
  margin: 6px 0;
  color: #28576b;
  font-size: 13px;
}
.housing-cost-summary dt {
  color: #6b8190;
  font-size: 12px;
}
.housing-cost-summary dd {
  margin: 6px 0;
  color: #28576b;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.housing-cost-summary small {
  display: block;
  margin-top: 4px;
  color: #9b772f;
  font-weight: 400;
}
.personnel-unassigned header > strong {
  color: #987535;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.personnel-details button:focus-visible,
.personnel-table-scroll:focus-visible {
  outline: 2px solid #16848d;
  outline-offset: 3px;
}
@media (max-width: 680px) {
  .personnel-details {
    padding: 12px;
  }
  .personnel-details-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .personnel-details-actions,
  .personnel-view-tabs {
    width: 100%;
  }
  .personnel-view-tabs button {
    flex: 1;
  }
}
</style>
