<template>
  <div class="human-cost-panel">
    <div class="payroll-toolbar">
      <el-date-picker
        v-model="payrollMonth"
        type="month"
        value-format="YYYY-MM"
        format="YYYY年MM月"
        :clearable="false"
        style="width: 160px"
        @change="() => fetchPayroll()"
      />
      <el-button
        :icon="Refresh"
        :loading="loading"
        @click="() => fetchPayroll()"
        >刷新</el-button
      >
    </div>

    <div class="payroll-table-wrap">
      <el-table
        v-loading="loading"
        :data="payrollRows"
        border
        show-summary
        :summary-method="getSummaries"
        table-layout="fixed"
        class="payroll-table"
        empty-text="暂无工资数据"
      >
        <el-table-column
          type="index"
          label="序号"
          width="58"
          align="center"
          fixed="left"
        />
        <el-table-column
          prop="employee_name"
          label="姓名"
          width="92"
          align="center"
          fixed="left"
        />

        <el-table-column
          prop="monthly_salary"
          width="128"
          align="center"
          fixed="left"
        >
          <template #header>
            <div class="payroll-header">
              <span>本月工资</span>
              <small>可修改</small>
            </div>
          </template>
          <template #default="{ row }">
            <el-input
              v-model="row.monthly_salary"
              inputmode="decimal"
              :disabled="savingFields.size > 0"
              :class="{
                'missing-source-input':
                  !row.salary_recognized && !row.monthly_salary_is_manual,
              }"
              @change="saveField(row, 'monthly_salary')"
            />
          </template>
        </el-table-column>

        <el-table-column prop="contribution_base" width="128" align="center">
          <template #header>
            <div class="payroll-header">
              <span>缴费基数</span>
              <small>可修改</small>
            </div>
          </template>
          <template #default="{ row }">
            <el-input
              v-model="row.contribution_base"
              inputmode="decimal"
              :disabled="savingFields.size > 0"
              @change="saveField(row, 'contribution_base')"
            />
          </template>
        </el-table-column>

        <el-table-column label="本月扣除款项-单位" align="center">
          <el-table-column label="社保（单位承担）" align="center">
            <el-table-column prop="company_pension" width="116" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本养老</span><small>缴费基数×16%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_pension)
              }}</template>
            </el-table-column>
            <el-table-column prop="company_medical" width="124" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本医疗</span><small>缴费基数×9.8%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_medical)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="company_unemployment"
              width="116"
              align="center"
            >
              <template #header
                ><div class="payroll-header">
                  <span>失业保险</span><small>缴费基数×0.5%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_unemployment)
              }}</template>
            </el-table-column>
            <el-table-column prop="company_injury" width="116" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>工伤保险</span><small>缴费基数×0.4%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_injury)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="company_social_total"
              width="132"
              align="center"
            >
              <template #header
                ><div class="payroll-header">
                  <span>合计</span><small>养老+医疗+失业+工伤</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_social_total)
              }}</template>
            </el-table-column>
          </el-table-column>

          <el-table-column
            prop="company_housing_fund"
            width="120"
            align="center"
          >
            <template #header
              ><div class="payroll-header">
                <span>住房公积金</span><small>本月工资×6%</small>
              </div></template
            >
            <template #default="{ row }">{{
              formatExact(row.company_housing_fund)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="company_paid_total"
            label="实缴合计"
            width="120"
            align="center"
          >
            <template #default="{ row }">{{
              formatExact(row.company_paid_total)
            }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="本月扣除款项-个人" align="center">
          <el-table-column label="代扣" align="center">
            <el-table-column prop="withheld_social" width="126" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>社保</span><small>单位+个人社保合计</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.withheld_social)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="withheld_housing_fund"
              width="132"
              align="center"
            >
              <template #header
                ><div class="payroll-header">
                  <span>公积金</span><small>单位+个人公积金合计</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.withheld_housing_fund)
              }}</template>
            </el-table-column>
            <el-table-column prop="withheld_tax" width="106" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>个税</span><small>应纳个税</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.withheld_tax)
              }}</template>
            </el-table-column>
            <el-table-column prop="withheld_total" width="132" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>合计</span><small>社保+公积金+个税</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.withheld_total)
              }}</template>
            </el-table-column>
          </el-table-column>

          <el-table-column label="社保（个人承担）" align="center">
            <el-table-column prop="personal_pension" width="116" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本养老</span><small>缴费基数×8%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.personal_pension)
              }}</template>
            </el-table-column>
            <el-table-column prop="personal_medical" width="124" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本医疗</span><small>缴费基数×2%+3</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.personal_medical)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="personal_unemployment"
              width="116"
              align="center"
            >
              <template #header
                ><div class="payroll-header">
                  <span>失业保险</span><small>缴费基数×0.5%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.personal_unemployment)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="personal_social_total"
              width="132"
              align="center"
            >
              <template #header
                ><div class="payroll-header">
                  <span>合计</span><small>养老+医疗+失业</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.personal_social_total)
              }}</template>
            </el-table-column>
          </el-table-column>

          <el-table-column
            prop="personal_housing_fund"
            width="120"
            align="center"
          >
            <template #header
              ><div class="payroll-header">
                <span>住房公积金</span><small>本月工资×6%</small>
              </div></template
            >
            <template #default="{ row }">{{
              formatExact(row.personal_housing_fund)
            }}</template>
          </el-table-column>

          <el-table-column
            prop="individual_income_tax"
            width="128"
            align="center"
          >
            <template #header>
              <div class="payroll-header">
                <span>应纳个税</span>
                <small>可修改，空值按0</small>
              </div>
            </template>
            <template #default="{ row }">
              <el-input
                v-model="row.individual_income_tax"
                inputmode="decimal"
                :disabled="savingFields.size > 0"
                @change="saveField(row, 'individual_income_tax')"
              />
            </template>
          </el-table-column>

          <el-table-column
            prop="net_salary"
            label="本月实发工资"
            width="138"
            align="center"
            class-name="net-salary-column"
          >
            <template #default="{ row }"
              ><strong>{{ formatExact(row.net_salary) }}</strong></template
            >
          </el-table-column>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage, type TableColumnCtx } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import {
  getPayroll,
  updatePayrollField,
  type PayrollAmountField,
  type PayrollRow,
} from "@/utils/payrollApi";

const now = new Date();
const payrollMonth = ref(
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
);
const payrollRows = ref<PayrollRow[]>([]);
const payrollTotals = ref<Partial<Record<PayrollAmountField, string>>>({});
const loading = ref(false);
const savingFields = ref(new Set<string>());

function formatExact(value: string | null | undefined): string {
  if (!value) return "0.00";
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart] = unsigned.split(".");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${formattedInteger}${fractionPart !== undefined ? `.${fractionPart}` : ""}`;
}

async function fetchPayroll(showLoading = true) {
  if (!payrollMonth.value) return;
  if (showLoading) loading.value = true;
  try {
    const data = await getPayroll(payrollMonth.value);
    payrollRows.value = data.list;
    payrollTotals.value = data.totals;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "获取工资表失败");
  } finally {
    if (showLoading) loading.value = false;
  }
}

async function saveField(
  row: PayrollRow,
  field: "monthly_salary" | "contribution_base" | "individual_income_tax",
) {
  const value = String(row[field] ?? "").trim() || "0";
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value)) {
    ElMessage.error("金额必须是非负数字，整数最多12位，小数最多8位");
    await fetchPayroll(false);
    return;
  }

  const key = `${row.employee_id}:${field}`;
  savingFields.value = new Set(savingFields.value).add(key);
  try {
    await updatePayrollField(payrollMonth.value, row.employee_id, field, value);
    await fetchPayroll(false);
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "工资数据保存失败");
    await fetchPayroll(false);
  } finally {
    const next = new Set(savingFields.value);
    next.delete(key);
    savingFields.value = next;
  }
}

function getSummaries({
  columns,
}: {
  columns: TableColumnCtx<PayrollRow>[];
  data: PayrollRow[];
}) {
  return columns.map((column, index) => {
    if (index === 0) return "合计";
    if (index === 1) return "";
    const property = column.property as PayrollAmountField | undefined;
    return property && payrollTotals.value[property]
      ? formatExact(payrollTotals.value[property])
      : "";
  });
}

const handlePayrollSourceUpdated = () => {
  void fetchPayroll(false);
};

onMounted(() => {
  window.addEventListener(
    "employee-payroll-source-updated",
    handlePayrollSourceUpdated,
  );
  void fetchPayroll();
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "employee-payroll-source-updated",
    handlePayrollSourceUpdated,
  );
});
</script>

<style scoped>
.human-cost-panel {
  min-width: 0;
}

.payroll-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.payroll-table-wrap {
  width: 100%;
  min-width: 0;
}

.payroll-table {
  width: 100%;
  font-variant-numeric: tabular-nums;
}

.payroll-header {
  display: flex;
  min-height: 48px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  line-height: 1.2;
  white-space: normal;
}

.payroll-header small {
  color: #606266;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.25;
}

.payroll-table :deep(.el-table__header-wrapper th) {
  padding: 6px 0;
  background: #f7f8fa;
  color: #303133;
}

.payroll-table :deep(.el-table__cell) {
  padding: 8px 0;
}

.payroll-table :deep(.el-input__wrapper) {
  padding: 1px 7px;
  border-radius: 3px;
}

.payroll-table :deep(.el-input__inner) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.payroll-table :deep(.missing-source-input .el-input__wrapper) {
  box-shadow: 0 0 0 1px #e6a23c inset;
}

.payroll-table :deep(.net-salary-column) {
  background: #fffde7;
  color: #1f2937;
}

.payroll-table :deep(.el-table__footer-wrapper td) {
  background: #edf6e8;
  color: #1f2937;
  font-weight: 600;
}
</style>
