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
        @change="handleMonthChange"
      />
      <el-button
        :icon="Refresh"
        :loading="loading"
        @click="() => fetchPayroll()"
        >刷新</el-button
      >
    </div>

    <section class="receipt-section">
      <div class="receipt-section-heading">
        <div class="receipt-section-title">
          <span class="receipt-section-mark">
            <el-icon><UploadFilled /></el-icon>
          </span>
          <div>
            <h3>月度银行回单</h3>
            <p>
              按工资归属月份保存，通常在次月上传上月资料；系统自动识别、汇总并核对账面金额。
            </p>
          </div>
        </div>
        <el-tag
          v-if="receiptSummary.processing_count > 0"
          class="receipt-processing-tag"
          type="warning"
          effect="light"
          round
        >
          {{ receiptSummary.processing_count }} 份正在识别
        </el-tag>
      </div>

      <div class="receipt-category-grid">
        <article
          v-for="category in receiptCategories"
          :key="category.value"
          class="receipt-category-card"
          :class="`receipt-category-card--${category.value}`"
        >
          <div class="receipt-category-heading">
            <div class="receipt-category-identity">
              <span class="receipt-category-icon">{{ category.icon }}</span>
              <div>
                <strong>{{ category.label }}</strong>
                <span>银行付款凭证</span>
              </div>
            </div>
            <el-tag
              class="receipt-status-tag"
              :type="getReconciliation(category).tagType"
              effect="light"
              round
            >
              {{ getReconciliation(category).label }}
            </el-tag>
          </div>

          <div class="receipt-amount-row">
            <div>
              <span>账面金额</span>
              <strong>¥{{ formatExact(getExpectedTotal(category)) }}</strong>
            </div>
            <span class="receipt-amount-divider"></span>
            <div class="receipt-amount-actual">
              <span>回单汇总</span>
              <strong
                >¥{{
                  formatExact(receiptSummary.totals[category.value])
                }}</strong
              >
            </div>
          </div>

          <div
            class="receipt-upload-group"
            :class="{ 'is-tax-group': category.value === 'income_tax' }"
          >
            <label
              class="receipt-drop-zone"
              :class="{
                'is-uploading': receiptUploading[category.value],
                'is-locked': isReceiptCategoryLocked(category.value),
              }"
              @dragover.prevent
              @drop.prevent="handleReceiptDrop(category.value, $event)"
            >
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                :disabled="
                  receiptUploading[category.value] ||
                  isReceiptCategoryLocked(category.value)
                "
                @change="handleReceiptInput(category.value, $event)"
              />
              <el-icon class="receipt-upload-icon">
                <Lock v-if="isReceiptCategoryLocked(category.value)" />
                <UploadFilled v-else />
              </el-icon>
              <span>{{
                receiptUploading[category.value]
                  ? "正在上传…"
                  : isReceiptCategoryLocked(category.value)
                    ? "已锁定，请先删除现有回单"
                    : category.value === "income_tax"
                      ? "上传个税银行回单"
                      : "点击或拖拽上传回单"
              }}</span>
              <small v-if="isReceiptCategoryLocked(category.value)">
                删除该类别全部文件后可重新上传
              </small>
              <small v-else-if="category.value === 'income_tax'">
                PDF（便携式文档格式）、JPEG（图像格式）、PNG（便携式网络图形），可多选
              </small>
              <small v-else>
                支持
                PDF（便携式文档格式）、JPEG（图像格式）、PNG（便携式网络图形）；可多选，单个文件不超过
                50MB
              </small>
            </label>

            <div
              v-if="category.value === 'income_tax'"
              class="tax-detail-panel"
            >
              <label
                class="receipt-drop-zone tax-detail-drop-zone"
                :class="{ 'is-uploading': taxDetailUploading }"
                @dragover.prevent
                @drop.prevent="handleTaxDetailDrop"
              >
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  :disabled="taxDetailUploading"
                  @change="handleTaxDetailInput"
                />
                <el-icon class="receipt-upload-icon"><UploadFilled /></el-icon>
                <span>{{
                  taxDetailUploading ? "正在识别并填充…" : "上传个人个税明细"
                }}</span>
                <small>识别“应纳个税”列并按姓名自动填充</small>
              </label>
              <div v-if="taxDetailFile" class="tax-detail-result">
                <a
                  :href="getPayrollTaxDetailPreviewUrl(taxDetailFile.id)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="`在线预览 ${taxDetailFile.file_name}`"
                >
                  {{ taxDetailFile.file_name }}
                </a>
                <span>
                  已填充 {{ taxDetailFile.recognized_count }} 人，其中
                  {{ taxDetailFile.zero_count }} 人为 0
                  <template
                    v-if="taxDetailFile.missing_employee_names.length > 0"
                  >
                    ，另有
                    {{ taxDetailFile.missing_employee_names.length }}
                    人未在明细中识别
                  </template>
                </span>
              </div>
            </div>
          </div>

          <div
            v-if="
              category.value === 'net_salary' &&
              receiptSummary.monthly_salary_bank
            "
            class="receipt-file-list monthly-salary-bank-file"
          >
            <div class="receipt-file-list-heading">
              <span>月报基本账户回单</span>
              <small>
                {{ receiptSummary.monthly_salary_bank.linked_item_count }}/{{
                  receiptSummary.monthly_salary_bank.total_item_count
                }}
                笔已挂载
              </small>
            </div>
            <div class="receipt-file-item">
              <div class="receipt-file-main">
                <a
                  :href="
                    getMonthlySalaryBankFilePreviewUrl(
                      receiptSummary.monthly_salary_bank.id,
                    )
                  "
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="receiptSummary.monthly_salary_bank.file_name"
                >
                  {{ receiptSummary.monthly_salary_bank.file_name }}
                </a>
                <small>
                  已按员工逐笔挂载 · ¥{{
                    formatExact(
                      receiptSummary.monthly_salary_bank.recognized_amount,
                    )
                  }}
                  <template
                    v-if="
                      receiptSummary.monthly_salary_bank.conflict_item_count > 0
                    "
                  >
                    ·
                    {{ receiptSummary.monthly_salary_bank.conflict_item_count }}
                    笔待严格核对
                  </template>
                </small>
              </div>
              <el-tag type="success" effect="plain">当前凭证</el-tag>
            </div>
          </div>

          <div
            v-if="getCategoryReceipts(category.value).length > 0"
            class="receipt-file-list"
          >
            <div class="receipt-file-list-heading">
              <span>已上传文件</span>
              <small>{{ getCategoryReceipts(category.value).length }} 份</small>
            </div>
            <div
              v-for="receipt in getCategoryReceipts(category.value)"
              :key="receipt.id"
              class="receipt-file-item"
            >
              <div class="receipt-file-main">
                <a
                  :href="getHumanCostReceiptPreviewUrl(receipt.id)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="receipt.file_name"
                  >{{ receipt.file_name }}</a
                >
                <small>
                  {{ getReceiptStatusText(receipt) }}
                  <template
                    v-if="
                      receipt.recognition_status === 'recognized' ||
                      receipt.recognition_status === 'partial'
                    "
                  >
                    · ¥{{ formatExact(receipt.recognized_amount) }}
                  </template>
                </small>
              </div>
              <el-button
                v-if="!receipt.audit_locked"
                link
                type="danger"
                :disabled="receipt.recognition_status === 'processing'"
                @click="removeReceipt(receipt)"
                >删除</el-button
              >
              <el-tag v-else type="info" effect="plain">审计留存</el-tag>
            </div>
          </div>
          <p
            v-if="
              getCategoryReceipts(category.value).length === 0 &&
              !receiptLoading &&
              !(
                category.value === 'net_salary' &&
                receiptSummary.monthly_salary_bank
              )
            "
            class="receipt-empty"
          >
            <span></span>本月尚未上传{{ category.label }}回单
          </p>
        </article>
      </div>
    </section>

    <div class="payroll-table-wrap">
      <el-table
        ref="payrollTableRef"
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

        <el-table-column prop="housing_fund_base" width="128" align="center">
          <template #header>
            <div class="payroll-header">
              <span>公积金缴费基数</span>
              <small>可修改</small>
            </div>
          </template>
          <template #default="{ row }">
            <el-input
              v-model="row.housing_fund_base"
              inputmode="decimal"
              :disabled="savingFields.size > 0"
              @change="saveField(row, 'housing_fund_base')"
            />
          </template>
        </el-table-column>

        <el-table-column prop="contribution_base" width="128" align="center">
          <template #header>
            <div class="payroll-header">
              <span>社保缴费基数</span>
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
                  <span>基本养老</span><small>社保缴费基数×16%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_pension)
              }}</template>
            </el-table-column>
            <el-table-column prop="company_medical" width="124" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本医疗</span><small>社保缴费基数×9.8%</small>
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
                  <span>失业保险</span><small>社保缴费基数×0.5%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.company_unemployment)
              }}</template>
            </el-table-column>
            <el-table-column prop="company_injury" width="116" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>工伤保险</span><small>社保缴费基数×0.4%</small>
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
                <span>住房公积金</span><small>公积金缴费基数×6%</small>
              </div></template
            >
            <template #default="{ row }">{{
              formatExact(row.company_housing_fund)
            }}</template>
          </el-table-column>
          <el-table-column prop="company_paid_total" width="120" align="center">
            <template #header>
              <div class="payroll-header">
                <span>实缴合计</span>
                <small>社保合计+住房公积金</small>
              </div>
            </template>
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
                  <span>基本养老</span><small>社保缴费基数×8%</small>
                </div></template
              >
              <template #default="{ row }">{{
                formatExact(row.personal_pension)
              }}</template>
            </el-table-column>
            <el-table-column prop="personal_medical" width="124" align="center">
              <template #header
                ><div class="payroll-header">
                  <span>基本医疗</span><small>社保缴费基数×2%+3</small>
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
                  <span>失业保险</span><small>社保缴费基数×0.5%</small>
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
                <span>住房公积金</span><small>公积金缴费基数×6%</small>
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
                <small>每月上个税局提取金额（空值默认为0）</small>
              </div>
            </template>
            <template #default="{ row }">
              <el-input
                v-model="row.individual_income_tax"
                inputmode="decimal"
                :disabled="savingFields.size > 0 || taxDetailUploading"
                @change="saveField(row, 'individual_income_tax')"
              />
            </template>
          </el-table-column>

          <el-table-column
            prop="net_salary"
            label="本月实发工资"
            width="138"
            align="right"
            header-align="center"
            class-name="net-salary-column"
          >
            <template #default="{ row }">
              <el-button
                v-if="row.salary_receipts.length > 0"
                link
                type="primary"
                class="salary-receipt-amount"
                :class="{
                  'is-mismatch': hasSalaryReceiptAmountMismatch(row),
                }"
                :title="getSalaryReceiptTitle(row)"
                @click="openSalaryReceipts(row)"
              >
                {{ formatExact(row.net_salary) }}
              </el-button>
              <strong v-else title="暂未匹配到该员工的工资银行回单">
                {{ formatExact(row.net_salary) }}
              </strong>
            </template>
          </el-table-column>
        </el-table-column>
      </el-table>
    </div>

    <div
      v-if="!loading"
      class="cost-total-bar"
      :style="{ marginRight: `${costTotalTrailingSpace}px` }"
    >
      <div class="cost-total-description">
        <span class="cost-total-title">成本合计</span>
        <span class="cost-total-formula"
          >社保＋公积金＋个税总额 + 本月实发工资总额</span
        >
      </div>
      <strong class="cost-total-value"
        >¥{{ formatExact(payrollTotals.cost_total) }}</strong
      >
    </div>

    <el-dialog
      v-model="salaryReceiptDialogVisible"
      :title="`${selectedPayrollRow?.employee_name || ''}的工资银行回单`"
      width="760px"
      destroy-on-close
    >
      <div v-if="selectedPayrollRow" class="salary-receipt-preview-list">
        <el-alert
          v-if="hasSalaryReceiptAmountMismatch(selectedPayrollRow)"
          type="error"
          :closable="false"
          show-icon
          :title="getSalaryReceiptTitle(selectedPayrollRow)"
        />
        <article
          v-for="receipt in selectedPayrollRow.salary_receipts"
          :key="receipt.id"
          class="salary-receipt-preview-card"
        >
          <img
            :src="getSalaryReceiptItemPreviewUrl(receipt)"
            :alt="`${selectedPayrollRow.employee_name}工资银行回单`"
          />
          <div>
            <strong>回单金额 ¥{{ formatExact(receipt.amount) }}</strong>
            <span>
              {{ receipt.file_name }} · 第 {{ receipt.page_no }} 页
              <template v-if="receipt.source === 'monthly_bank'">
                · 月报基本账户
              </template>
            </span>
            <span
              v-if="receipt.transaction_date || receipt.electronic_receipt_no"
            >
              {{ receipt.transaction_date || "交易日期未识别" }}
              <template v-if="receipt.electronic_receipt_no">
                · 电子回单号 {{ receipt.electronic_receipt_no }}
              </template>
            </span>
            <a
              v-if="receipt.previous_receipt_item_id"
              :href="
                getPreviousSalaryReceiptItemPreviewUrl(
                  receipt.previous_receipt_item_id,
                )
              "
              target="_blank"
              rel="noopener noreferrer"
            >
              查看替换前原回单
              <template v-if="receipt.previous_file_name">
                （{{ receipt.previous_file_name }}）
              </template>
            </a>
          </div>
        </article>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox, type TableColumnCtx } from "element-plus";
import { Lock, Refresh, UploadFilled } from "@element-plus/icons-vue";
import {
  deleteHumanCostReceipt,
  getHumanCostReceiptPreviewUrl,
  getHumanCostReceipts,
  getMonthlySalaryBankFilePreviewUrl,
  getPayrollTaxDetailPreviewUrl,
  getPayroll,
  getPreviousSalaryReceiptItemPreviewUrl,
  getSalaryReceiptItemPreviewUrl,
  uploadPayrollTaxDetail,
  uploadHumanCostReceipts,
  updatePayrollField,
  type HumanCostReceipt,
  type HumanCostReceiptCategory,
  type HumanCostReceiptSummary,
  type PayrollAmountField,
  type PayrollRow,
  type PayrollTaxDetailFile,
  type PayrollTotals,
} from "@/utils/payrollApi";

const now = new Date();
const payrollMonth = ref(
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
);
const payrollRows = ref<PayrollRow[]>([]);
const payrollTotals = ref<Partial<PayrollTotals>>({});
const loading = ref(false);
const savingFields = ref(new Set<string>());
const salaryReceiptDialogVisible = ref(false);
const selectedPayrollRow = ref<PayrollRow | null>(null);
const receiptLoading = ref(false);
const taxDetailUploading = ref(false);
const taxDetailFile = ref<PayrollTaxDetailFile | null>(null);
const receiptSummary = ref<HumanCostReceiptSummary>({
  month: payrollMonth.value,
  list: [],
  totals: {
    social_security: "0.00",
    housing_fund: "0.00",
    income_tax: "0.00",
    net_salary: "0.00",
  },
  processing_count: 0,
  monthly_salary_bank: null,
  tax_detail: null,
});
const receiptUploading = reactive<Record<HumanCostReceiptCategory, boolean>>({
  social_security: false,
  housing_fund: false,
  income_tax: false,
  net_salary: false,
});
const receiptCategories: Array<{
  value: HumanCostReceiptCategory;
  label: string;
  icon: string;
  expectedField:
    | "withheld_social"
    | "withheld_housing_fund"
    | "withheld_tax"
    | "net_salary";
}> = [
  {
    value: "social_security",
    label: "社保",
    icon: "社",
    expectedField: "withheld_social",
  },
  {
    value: "housing_fund",
    label: "公积金",
    icon: "金",
    expectedField: "withheld_housing_fund",
  },
  {
    value: "income_tax",
    label: "个税",
    icon: "税",
    expectedField: "withheld_tax",
  },
  {
    value: "net_salary",
    label: "实发工资",
    icon: "薪",
    expectedField: "net_salary",
  },
];
const payrollTableRef = ref<{ $el?: HTMLElement } | null>(null);
const costTotalTrailingSpace = ref(0);
let tableResizeObserver: {
  observe: (target: Element) => void;
  disconnect: () => void;
} | null = null;
let alignmentFrame: number | null = null;
let receiptPollingTimer: number | null = null;

function updateCostTotalAlignment() {
  const tableElement = payrollTableRef.value?.$el;
  if (!tableElement) return;

  const bodyTable = tableElement.querySelector<HTMLElement>(".el-table__body");
  const headerTable =
    tableElement.querySelector<HTMLElement>(".el-table__header");
  const contentWidth = Math.max(
    bodyTable?.offsetWidth ?? 0,
    headerTable?.offsetWidth ?? 0,
  );
  const trailingSpace = Math.max(0, tableElement.clientWidth - contentWidth);

  costTotalTrailingSpace.value = trailingSpace;
}

function scheduleCostTotalAlignment() {
  void nextTick(() => {
    if (alignmentFrame !== null) {
      cancelAnimationFrame(alignmentFrame);
    }
    alignmentFrame = requestAnimationFrame(() => {
      alignmentFrame = null;
      updateCostTotalAlignment();
    });
  });
}

function formatExact(value: string | null | undefined): string {
  if (!value) return "0.00";
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart] = unsigned.split(".");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${formattedInteger}${fractionPart !== undefined ? `.${fractionPart}` : ""}`;
}

function openSalaryReceipts(row: PayrollRow) {
  selectedPayrollRow.value = row;
  salaryReceiptDialogVisible.value = true;
}

function getSalaryReceiptTotal(row: PayrollRow): string {
  return scaledToAmount(
    row.salary_receipts.reduce(
      (total, receipt) => total + decimalToScaled(receipt.amount),
      0n,
    ),
  );
}

function hasSalaryReceiptAmountMismatch(row: PayrollRow): boolean {
  return (
    row.salary_receipts.length > 0 &&
    decimalToScaled(getSalaryReceiptTotal(row)) !==
      decimalToScaled(row.net_salary)
  );
}

function getSalaryReceiptTitle(row: PayrollRow): string {
  const receiptTotal = getSalaryReceiptTotal(row);
  return hasSalaryReceiptAmountMismatch(row)
    ? `回单合计 ¥${formatExact(receiptTotal)}，与账面实发 ¥${formatExact(row.net_salary)} 不一致；点击查看回单`
    : "查看该员工对应的工资银行回单";
}

function getRequestErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return fallback;
  }
  const response = (error as { response?: { data?: { message?: unknown } } })
    .response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : fallback;
}

function decimalToScaled(value: string | null | undefined): bigint {
  const normalized = String(value || "0").trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const scaled =
    BigInt(integerPart || "0") * 100_000_000n +
    BigInt(fractionPart.padEnd(8, "0").slice(0, 8) || "0");
  return negative ? -scaled : scaled;
}

function scaledToAmount(value: bigint): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const integerPart = unsigned / 100_000_000n;
  const fractionPart = (unsigned % 100_000_000n)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
}

function getExpectedTotal(
  category: (typeof receiptCategories)[number],
): string {
  return payrollTotals.value[category.expectedField] || "0.00";
}

function getCategoryReceipts(
  category: HumanCostReceiptCategory,
): HumanCostReceipt[] {
  return receiptSummary.value.list.filter(
    (receipt) => receipt.category === category,
  );
}

function isReceiptCategoryLocked(category: HumanCostReceiptCategory): boolean {
  return (
    getCategoryReceipts(category).length > 0 ||
    (category === "net_salary" &&
      Boolean(receiptSummary.value.monthly_salary_bank?.linked_item_count))
  );
}

function getReconciliation(category: (typeof receiptCategories)[number]) {
  const receipts = getCategoryReceipts(category.value);
  const monthlySalaryBank =
    category.value === "net_salary"
      ? receiptSummary.value.monthly_salary_bank
      : null;
  if (receipts.some((receipt) => receipt.recognition_status === "processing")) {
    return { label: "识别中", tagType: "warning" as const };
  }
  if (
    monthlySalaryBank &&
    (monthlySalaryBank.conflict_item_count > 0 ||
      monthlySalaryBank.linked_item_count < monthlySalaryBank.total_item_count)
  ) {
    return { label: "待严格核对", tagType: "warning" as const };
  }
  if (monthlySalaryBank && receipts.length === 0) {
    return { label: "已按员工挂载", tagType: "success" as const };
  }
  if (receipts.length === 0) {
    return { label: "待上传", tagType: "info" as const };
  }
  if (receipts.every((receipt) => receipt.recognition_status === "failed")) {
    return { label: "识别失败", tagType: "danger" as const };
  }
  if (receipts.some((receipt) => receipt.recognition_status === "partial")) {
    return { label: "待核对", tagType: "warning" as const };
  }

  const difference =
    decimalToScaled(receiptSummary.value.totals[category.value]) -
    decimalToScaled(getExpectedTotal(category));
  if (difference === 0n) {
    return { label: "金额一致", tagType: "success" as const };
  }
  return {
    label: `差额 ¥${formatExact(scaledToAmount(difference))}`,
    tagType: "danger" as const,
  };
}

function getReceiptStatusText(receipt: HumanCostReceipt): string {
  if (receipt.recognition_status === "processing") return "正在识别金额";
  if (receipt.recognition_status === "failed") {
    return receipt.recognition_error || "金额识别失败";
  }
  const employeeMatchText =
    receipt.category === "net_salary" && receipt.unmatched_employee_count > 0
      ? `，${receipt.unmatched_employee_count} 笔未匹配员工`
      : "";
  if (receipt.recognition_status === "partial") {
    const recognitionText =
      receipt.recognition_error ||
      `已识别 ${receipt.recognized_item_count}/${receipt.total_item_count} 笔，请核对`;
    return `${recognitionText}${employeeMatchText}`;
  }
  const recognizedText =
    receipt.total_item_count > 1
      ? `已识别 ${receipt.recognized_item_count} 笔`
      : "识别成功";
  const ignoredText =
    receipt.ignored_item_count > 0
      ? `${recognizedText}，已忽略 ${receipt.ignored_item_count} 笔非工资回单`
      : recognizedText;
  return `${ignoredText}${employeeMatchText}`;
}

function clearReceiptPolling() {
  if (receiptPollingTimer !== null) {
    window.clearTimeout(receiptPollingTimer);
    receiptPollingTimer = null;
  }
}

function scheduleReceiptPolling() {
  clearReceiptPolling();
  if (receiptSummary.value.processing_count === 0) return;
  receiptPollingTimer = window.setTimeout(() => {
    receiptPollingTimer = null;
    void fetchReceiptSummary(false);
  }, 1800);
}

async function fetchReceiptSummary(showLoading = true) {
  if (!payrollMonth.value) return;
  const requestedMonth = payrollMonth.value;
  const wasProcessing = receiptSummary.value.processing_count > 0;
  if (showLoading) receiptLoading.value = true;
  try {
    const data = await getHumanCostReceipts(requestedMonth);
    if (payrollMonth.value !== requestedMonth) return;
    receiptSummary.value = data;
    taxDetailFile.value = data.tax_detail;
    if (wasProcessing && data.processing_count === 0) {
      await fetchPayroll(false);
    }
    scheduleReceiptPolling();
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "获取月度回单失败"));
  } finally {
    if (showLoading) receiptLoading.value = false;
  }
}

async function fetchPayroll(showLoading = true) {
  if (!payrollMonth.value) return;
  const requestedMonth = payrollMonth.value;
  if (showLoading) loading.value = true;
  try {
    const data = await getPayroll(requestedMonth);
    if (payrollMonth.value !== requestedMonth) return;
    payrollRows.value = data.list;
    payrollTotals.value = data.totals;
    scheduleCostTotalAlignment();
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "获取工资表失败"));
  } finally {
    if (showLoading) loading.value = false;
  }
}

async function handleMonthChange() {
  clearReceiptPolling();
  taxDetailFile.value = null;
  await Promise.all([fetchPayroll(), fetchReceiptSummary()]);
}

function validateReceiptFiles(files: File[]): File[] | null {
  if (files.length === 0) return null;
  if (files.length > 20) {
    ElMessage.warning("一次最多上传 20 个回单文件");
    return null;
  }

  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ]);
  const allowedExtensions = /\.(pdf|jpe?g|png)$/i;
  const invalidType = files.find(
    (file) =>
      !allowedTypes.has(file.type) && !allowedExtensions.test(file.name),
  );
  if (invalidType) {
    ElMessage.warning(`${invalidType.name} 不是支持的回单格式`);
    return null;
  }
  const oversized = files.find((file) => file.size > 50 * 1024 * 1024);
  if (oversized) {
    ElMessage.warning(`${oversized.name} 超过 50MB`);
    return null;
  }
  return files;
}

async function submitReceiptFiles(
  category: HumanCostReceiptCategory,
  selectedFiles: File[],
) {
  if (isReceiptCategoryLocked(category)) {
    ElMessage.info("该类别已上传银行回单，请先删除现有文件后再上传");
    return;
  }
  const files = validateReceiptFiles(selectedFiles);
  if (!files || receiptUploading[category]) return;

  const uploadMonth = payrollMonth.value;
  receiptUploading[category] = true;
  try {
    const data = await uploadHumanCostReceipts(uploadMonth, category, files);
    if (payrollMonth.value !== uploadMonth) {
      await fetchReceiptSummary(false);
      return;
    }
    receiptSummary.value = data;
    if (data.duplicates?.length) {
      ElMessage.warning(
        `${data.duplicates.length} 个重复文件已跳过，其余回单正在识别`,
      );
    } else {
      ElMessage.success("回单上传成功，正在自动识别金额");
    }
    scheduleReceiptPolling();
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "回单上传失败"));
    await fetchReceiptSummary(false);
  } finally {
    receiptUploading[category] = false;
  }
}

function handleReceiptInput(category: HumanCostReceiptCategory, event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  void submitReceiptFiles(category, files);
}

function handleReceiptDrop(
  category: HumanCostReceiptCategory,
  event: DragEvent,
) {
  if (receiptUploading[category]) return;
  void submitReceiptFiles(
    category,
    Array.from(event.dataTransfer?.files || []),
  );
}

async function submitTaxDetailFile(file: File | undefined) {
  if (!file || taxDetailUploading.value) return;
  const files = validateReceiptFiles([file]);
  if (!files) return;

  const uploadMonth = payrollMonth.value;
  taxDetailUploading.value = true;
  try {
    const data = await uploadPayrollTaxDetail(uploadMonth, file);
    if (payrollMonth.value !== uploadMonth) return;
    taxDetailFile.value = data;
    payrollRows.value = data.payroll.list;
    payrollTotals.value = data.payroll.totals;
    scheduleCostTotalAlignment();
    const missingCount = data.missing_employee_names.length;
    if (missingCount > 0) {
      ElMessage.warning(
        `已填充 ${data.recognized_count} 人的应纳个税，另有 ${missingCount} 人未在明细中识别`,
      );
    } else {
      ElMessage.success(`已自动填充 ${data.recognized_count} 人的应纳个税`);
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "个人个税明细识别失败"));
  } finally {
    taxDetailUploading.value = false;
  }
}

function handleTaxDetailInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  void submitTaxDetailFile(file);
}

function handleTaxDetailDrop(event: DragEvent) {
  if (taxDetailUploading.value) return;
  void submitTaxDetailFile(event.dataTransfer?.files?.[0]);
}

async function removeReceipt(receipt: HumanCostReceipt) {
  try {
    await ElMessageBox.confirm(
      `确定删除“${receipt.file_name}”吗？删除后不再计入本月回单汇总。`,
      "删除人力成本回单",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    await deleteHumanCostReceipt(receipt.id);
    ElMessage.success("回单已删除");
    await Promise.all([
      fetchReceiptSummary(false),
      receipt.category === "net_salary"
        ? fetchPayroll(false)
        : Promise.resolve(),
    ]);
  } catch (error: unknown) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getRequestErrorMessage(error, "删除回单失败"));
  }
}

async function saveField(
  row: PayrollRow,
  field:
    | "monthly_salary"
    | "housing_fund_base"
    | "contribution_base"
    | "individual_income_tax",
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
    await updatePayrollField(
      payrollMonth.value,
      row.employee_id,
      field,
      value,
      row.version,
    );
    await fetchPayroll(false);
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "工资数据保存失败"));
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
  void Promise.all([fetchPayroll(), fetchReceiptSummary()]);
  void nextTick(() => {
    scheduleCostTotalAlignment();
    const tableElement = payrollTableRef.value?.$el;
    if (tableElement && typeof window.ResizeObserver !== "undefined") {
      tableResizeObserver = new window.ResizeObserver(
        scheduleCostTotalAlignment,
      );
      tableResizeObserver.observe(tableElement);
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "employee-payroll-source-updated",
    handlePayrollSourceUpdated,
  );
  tableResizeObserver?.disconnect();
  clearReceiptPolling();
  if (alignmentFrame !== null) {
    cancelAnimationFrame(alignmentFrame);
  }
});
</script>

<style scoped>
.human-cost-panel {
  min-width: 0;
}

.salary-receipt-amount {
  height: auto;
  padding: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.salary-receipt-amount.is-mismatch {
  color: #f56c6c;
  --el-button-text-color: #f56c6c;
  --el-button-hover-text-color: #f78989;
}

.salary-receipt-preview-list {
  display: grid;
  gap: 16px;
  max-height: 70vh;
  overflow-y: auto;
}

.salary-receipt-preview-card {
  overflow: hidden;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
}

.salary-receipt-preview-card img {
  display: block;
  width: 100%;
  min-height: 180px;
  object-fit: contain;
  background: #f5f7fa;
}

.salary-receipt-preview-card > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
}

.salary-receipt-preview-card span {
  overflow: hidden;
  color: #909399;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payroll-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.receipt-section {
  position: relative;
  overflow: hidden;
  margin-bottom: 18px;
  padding: 20px;
  border: 1px solid #dfe7f1;
  border-radius: 14px;
  background:
    radial-gradient(circle at 100% 0, rgb(64 158 255 / 8%), transparent 32%),
    linear-gradient(180deg, #f8fbff 0%, #f6f8fb 100%);
  box-shadow: 0 8px 24px rgb(31 45 61 / 5%);
}

.receipt-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.receipt-section-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.receipt-section-mark {
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(64 158 255 / 14%);
  border-radius: 11px;
  background: linear-gradient(145deg, #ecf6ff, #fff);
  box-shadow: 0 5px 14px rgb(64 158 255 / 12%);
  color: #409eff;
  font-size: 19px;
}

.receipt-section-heading h3 {
  margin: 0;
  color: #1f2d3d;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.receipt-section-heading p {
  margin: 4px 0 0;
  color: #7b8794;
  font-size: 12px;
  line-height: 1.5;
}

.receipt-processing-tag,
.receipt-status-tag {
  flex: none;
  border: 0;
  font-weight: 500;
}

.receipt-category-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(220px, 1fr));
  align-items: stretch;
  gap: 12px;
}

.receipt-category-card {
  --receipt-accent: #409eff;
  --receipt-soft: #ecf5ff;

  position: relative;
  display: flex;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  flex-direction: column;
  padding: 16px;
  border: 1px solid #e1e7ef;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 14px rgb(31 45 61 / 5%);
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
}

.receipt-category-card::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: var(--receipt-accent);
  content: "";
}

.receipt-category-card:hover {
  border-color: color-mix(in srgb, var(--receipt-accent) 34%, #e1e7ef);
  box-shadow: 0 10px 24px rgb(31 45 61 / 9%);
  transform: translateY(-1px);
}

.receipt-category-card--housing_fund {
  --receipt-accent: #7a67d8;
  --receipt-soft: #f2efff;
}

.receipt-category-card--income_tax {
  --receipt-accent: #e6a23c;
  --receipt-soft: #fdf5e6;
}

.receipt-category-card--net_salary {
  --receipt-accent: #36a269;
  --receipt-soft: #edf8f2;
}

.receipt-upload-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.receipt-upload-group.is-tax-group {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

.tax-detail-panel {
  display: contents;
}

.tax-detail-drop-zone {
  height: 100%;
  min-height: 92px;
  border-color: #e8c98f;
  background: #fffaf1;
}

.tax-detail-result {
  display: flex;
  min-width: 0;
  grid-column: 2;
  align-items: center;
  gap: 6px;
  padding: 1px 4px 0;
  font-size: 10px;
  line-height: 1.5;
}

.tax-detail-result a {
  overflow: hidden;
  flex: 0 1 auto;
  color: #d88b1f;
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tax-detail-result a:hover {
  text-decoration: underline;
}

.tax-detail-result span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #67c23a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-category-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.receipt-category-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.receipt-category-identity > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.receipt-category-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--receipt-soft);
  color: var(--receipt-accent);
  font-size: 14px;
  font-weight: 700;
}

.receipt-category-heading strong {
  color: #253142;
  font-size: 15px;
}

.receipt-category-heading span {
  color: #98a2ad;
  font-size: 10px;
}

.receipt-amount-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin: 15px 0 12px;
  padding: 11px 12px;
  border-radius: 9px;
  background: #f7f9fc;
}

.receipt-amount-row > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.receipt-amount-row span {
  color: #8a96a3;
  font-size: 10px;
}

.receipt-amount-divider {
  width: 1px;
  height: 28px;
  background: #e4e9f0;
}

.receipt-amount-row strong {
  overflow: hidden;
  color: #475569;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-amount-row .receipt-amount-actual {
  align-items: flex-end;
  text-align: right;
}

.receipt-amount-actual strong {
  color: var(--receipt-accent);
  font-size: 16px;
}

.receipt-drop-zone {
  display: flex;
  min-height: 92px;
  box-sizing: border-box;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 13px 12px;
  border: 1px dashed #c5ced9;
  border-radius: 9px;
  background: #fbfcfe;
  color: #596779;
  text-align: center;
  transition:
    border-color 0.2s,
    background-color 0.2s,
    box-shadow 0.2s;
}

.receipt-drop-zone:hover {
  border-color: var(--receipt-accent);
  background: var(--receipt-soft);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--receipt-accent) 8%, transparent);
}

.receipt-drop-zone.is-uploading {
  cursor: wait;
  opacity: 0.65;
}

.receipt-drop-zone.is-locked,
.receipt-drop-zone.is-locked:hover {
  cursor: not-allowed;
  border-color: #d8dde5;
  border-style: solid;
  background: #f3f5f7;
  box-shadow: none;
}

.receipt-drop-zone.is-locked .receipt-upload-icon,
.receipt-drop-zone.is-locked > span {
  color: #8b96a3;
}

.receipt-drop-zone input {
  display: none;
}

.receipt-upload-icon {
  margin-bottom: 5px;
  color: var(--receipt-accent);
  font-size: 24px;
}

.receipt-drop-zone > span {
  color: #4b596a;
  font-size: 12px;
  font-weight: 500;
}

.receipt-drop-zone > small {
  margin-top: 5px;
  color: #909399;
  font-size: 10px;
  line-height: 1.4;
}

.receipt-file-list {
  display: flex;
  max-height: 148px;
  margin-top: 12px;
  overflow-y: auto;
  flex-direction: column;
  gap: 6px;
}

.receipt-file-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #7b8794;
  font-size: 10px;
}

.receipt-file-list-heading small {
  padding: 1px 6px;
  border-radius: 8px;
  background: #f0f3f7;
  color: #8b96a3;
  font-size: 9px;
}

.receipt-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid #edf0f4;
  border-radius: 7px;
  background: #fbfcfd;
}

.receipt-file-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.receipt-file-main a {
  overflow: hidden;
  color: var(--receipt-accent);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-file-main small {
  overflow: hidden;
  color: #909399;
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  color: #a0a8b2;
  font-size: 10px;
}

.receipt-empty span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c9d0d8;
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

.payroll-table :deep(.net-salary-column .cell) {
  padding-right: 18px;
}

.payroll-table :deep(.el-table__footer-wrapper td) {
  background: #edf6e8;
  color: #1f2937;
  font-weight: 600;
}

.cost-total-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  min-width: 0;
  margin-top: 12px;
  box-sizing: border-box;
  padding: 14px 18px;
  border: 1px solid #d8e4d3;
  border-left: 4px solid #67c23a;
  background: #f5f9f2;
  font-variant-numeric: tabular-nums;
}

.cost-total-description {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.cost-total-title {
  color: #303133;
  font-size: 15px;
  font-weight: 700;
}

.cost-total-formula {
  color: #606266;
  font-size: 12px;
  line-height: 1.5;
}

.cost-total-value {
  color: #2f6f3e;
  font-size: 22px;
  line-height: 1.2;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .receipt-category-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .receipt-section-heading {
    align-items: flex-start;
  }

  .receipt-upload-group.is-tax-group {
    grid-template-columns: minmax(0, 1fr);
  }

  .tax-detail-result {
    grid-column: 1;
  }

  .cost-total-bar {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
}

@media (min-width: 769px) and (max-width: 1280px) {
  .receipt-category-grid {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}
</style>
