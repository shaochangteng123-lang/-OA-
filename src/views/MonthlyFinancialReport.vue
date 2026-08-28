<template>
  <div class="monthly-financial-report">
    <section class="report-hero">
      <div class="hero-copy">
        <span class="hero-kicker">财务区 · 月度资金结算</span>
        <div class="hero-title-row">
          <h1>月度财务报表</h1>
          <el-tag v-if="report" :type="statusMeta.type" effect="light" round>
            {{ statusMeta.label }}
          </el-tag>
        </div>
        <p>
          汇总四个资金账户的期初、收入、支出和期末余额；管理员负责维护与月结，总经理只读查看。
        </p>
        <div v-if="report" class="hero-meta">
          <span>工作版本 {{ report.version }}</span>
          <span v-if="report.snapshotVersion !== null">
            月结版本 {{ report.snapshotVersion }}
          </span>
          <span>{{ reportTimeText }}</span>
        </div>
      </div>

      <div class="hero-actions">
        <el-date-picker
          v-model="selectedMonth"
          type="month"
          value-format="YYYY-MM"
          format="YYYY年MM月"
          :clearable="false"
          :disabled="loading || actionLoading"
          class="month-picker"
          @change="handleMonthChange"
        />
        <el-button
          v-if="canRefresh"
          :icon="RefreshRight"
          :loading="activeAction === 'refresh'"
          :disabled="actionLoading || hasUnsavedChanges"
          @click="handleRefreshSources"
        >
          同步自动数据
        </el-button>
        <el-button
          v-if="isAdminRole"
          type="primary"
          plain
          :icon="UploadFilled"
          :loading="bankReceiptBusy"
          :disabled="
            actionLoading || hasUnsavedChanges || !canUploadBankReceipts
          "
          @click="openBankReceiptUpload"
        >
          上传银行回单
        </el-button>
        <el-button
          v-if="canEdit"
          type="primary"
          plain
          :icon="DocumentChecked"
          :loading="activeAction === 'save'"
          :disabled="actionLoading || !hasUnsavedChanges"
          @click="handleSaveManualItems"
        >
          保存维护数据
        </el-button>
        <el-button
          v-if="canDownload"
          type="success"
          plain
          :icon="Download"
          :loading="activeAction === 'download'"
          :disabled="actionLoading || hasUnsavedChanges"
          @click="handleDownload"
        >
          下载全部报表
        </el-button>
        <el-button
          v-if="canShowClose"
          type="primary"
          :icon="CircleCheck"
          :loading="activeAction === 'close'"
          :disabled="actionLoading || hasUnsavedChanges || !canClose"
          :aria-describedby="
            closeActionReason ? 'monthly-close-action-reason' : undefined
          "
          @click="handleCloseReport"
        >
          执行月结
        </el-button>
        <div
          v-if="canShowClose && closeActionReason"
          id="monthly-close-action-reason"
          class="close-action-reason"
          role="status"
        >
          <el-icon aria-hidden="true"><WarningFilled /></el-icon>
          <span>暂不可月结：{{ closeActionReason }}</span>
        </div>
        <el-button
          v-if="canReopen"
          type="warning"
          plain
          :icon="Unlock"
          :loading="activeAction === 'reopen'"
          :disabled="actionLoading"
          @click="handleReopenReport"
        >
          重新开启
        </el-button>
      </div>
    </section>

    <el-alert
      v-if="hasUnsavedChanges"
      class="page-alert"
      title="月报有未保存修改"
      description="请先保存或撤销修改，再切换月份、同步自动数据或执行月结。"
      type="warning"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="loadError"
      class="page-alert"
      title="月度财务报表加载失败"
      :description="loadError"
      type="error"
      :closable="false"
      show-icon
    >
      <template #default>
        <el-button type="danger" link @click="handleReloadReport">
          重新加载
        </el-button>
      </template>
    </el-alert>

    <div v-if="loading && !report" class="loading-shell">
      <el-skeleton :rows="9" animated />
    </div>

    <el-empty
      v-else-if="!report && !loadError"
      class="empty-report"
      description="该月份尚无月度财务报表"
    >
      <p class="empty-hint">
        {{
          isAdminRole
            ? "报表将在管理员首次读取或后端完成月份初始化后显示。"
            : "请联系管理员完成该月份初始化。"
        }}
      </p>
      <el-button type="primary" :icon="Refresh" @click="handleReloadReport">
        重新检查
      </el-button>
    </el-empty>

    <template v-else-if="report">
      <el-tabs v-model="activeTab" class="report-tabs">
        <el-tab-pane label="财务趋势" name="trend">
          <MonthlyFinancialTrendChart
            :selected-year="trendSelectedYear"
            :selected-month="selectedMonth"
            :comparison-year="trendComparisonYear"
            :available-years="trendAvailableYears"
            :points="trendPoints"
            :warnings="trendWarnings"
            :loading="trendLoading"
            :error="trendError"
            @comparison-year-change="handleTrendComparisonYearChange"
            @retry="handleTrendRetry"
          />
        </el-tab-pane>

        <el-tab-pane label="账户与结算" name="summary">
          <section class="metric-grid" aria-label="月度资金核心指标">
            <article
              v-for="metric in totalMetrics"
              :key="metric.key"
              class="metric-card"
              :class="`metric-card--${metric.tone}`"
            >
              <span>{{ metric.label }}</span>
              <strong :class="{ 'is-negative': isNegative(metric.value) }">
                {{ formatAmount(metric.value) }}
              </strong>
              <small>{{ metric.note }}</small>
            </article>
          </section>

          <el-alert
            v-if="report.validations.blockers.length > 0"
            class="page-alert"
            title="当前存在月结阻断项"
            :description="
              report.validations.blockers.map((item) => item.message).join('；')
            "
            type="error"
            :closable="false"
            show-icon
          />
          <el-alert
            v-else-if="report.validations.warnings.length > 0"
            class="page-alert"
            title="当前存在需要复核的提示"
            :description="
              report.validations.warnings.map((item) => item.message).join('；')
            "
            type="warning"
            :closable="false"
            show-icon
          />

          <section class="account-grid">
            <article
              v-for="account in report.accounts"
              :key="account.code"
              class="account-card"
            >
              <div class="account-heading">
                <span class="account-mark">{{
                  accountShortName(account.code)
                }}</span>
                <div>
                  <h2>{{ account.name }}</h2>
                  <p>{{ accountFormula(account.code) }}</p>
                </div>
                <el-button
                  link
                  type="primary"
                  class="account-detail-toggle"
                  @click="toggleAccountDetails(account.code)"
                >
                  {{
                    isAccountDetailsExpanded(account.code)
                      ? "收起明细"
                      : "展开明细"
                  }}
                </el-button>
              </div>
              <dl class="account-values">
                <div>
                  <dt>期初</dt>
                  <dd
                    v-if="canEdit && report.isFirstMonth"
                    class="opening-input"
                  >
                    <el-input
                      v-model="openingBalances[account.code]"
                      inputmode="decimal"
                      maxlength="32"
                      aria-label="首月期初余额"
                      @input="openingBalancesDirty = true"
                    >
                      <template #prefix>¥</template>
                    </el-input>
                  </dd>
                  <dd v-else>{{ formatAmount(account.opening) }}</dd>
                </div>
                <div>
                  <dt>流入</dt>
                  <dd class="is-income">+{{ formatAmount(account.inflow) }}</dd>
                </div>
                <div>
                  <dt>流出</dt>
                  <dd class="is-expense">
                    -{{ formatAmount(account.outflow) }}
                  </dd>
                </div>
                <div class="closing-value">
                  <dt>期末</dt>
                  <dd :class="{ 'is-negative': isNegative(account.closing) }">
                    {{ formatAmount(account.closing) }}
                  </dd>
                </div>
              </dl>
              <div
                v-if="isAccountDetailsExpanded(account.code)"
                class="flow-columns account-card-flows"
              >
                <section class="flow-panel flow-panel--income">
                  <header>
                    <strong>流入明细</strong>
                    <span>+{{ formatAmount(account.inflow) }}</span>
                  </header>
                  <div
                    v-for="row in accountDetail(account.code).inflows"
                    :key="row.label"
                    class="flow-group"
                  >
                    <div class="flow-row">
                      <div>
                        <strong>{{ row.label }}</strong>
                        <small>{{ row.source }}</small>
                      </div>
                      <span>{{ formatAmount(row.value) }}</span>
                    </div>
                  </div>
                </section>
                <section class="flow-panel flow-panel--expense">
                  <header>
                    <strong>流出明细</strong>
                    <span>-{{ formatAmount(account.outflow) }}</span>
                  </header>
                  <div
                    v-for="row in accountDetail(account.code).outflows"
                    :key="row.label"
                    class="flow-group"
                  >
                    <div class="flow-row">
                      <div>
                        <strong>{{ row.label }}</strong>
                        <small>{{ row.source }}</small>
                      </div>
                      <span>{{ formatAmount(row.value) }}</span>
                    </div>
                    <div v-if="row.people?.length" class="person-detail-list">
                      <div
                        v-for="person in row.people"
                        :key="person.sourceId"
                        class="person-detail-row"
                      >
                        <div>
                          <strong>{{
                            person.personName || "未记录姓名"
                          }}</strong>
                          <small
                            >{{ formatDetailMonth(person.occurredOn) }} ·
                            {{ row.peopleCaption }}</small
                          >
                        </div>
                        <span>{{ formatAmount(person.amount) }}</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </article>
          </section>
        </el-tab-pane>

        <el-tab-pane label="手工项目" name="manual">
          <el-card shadow="never" class="manual-card">
            <template #header>
              <div class="card-heading manual-heading">
                <div>
                  <h2>手工录入项目</h2>
                  <p>
                    按账户和项目找到对应区域，直接在表格中录入；金额整数最多18位、小数最多12位，不自动补零。
                  </p>
                </div>
                <div v-if="canEdit" class="manual-actions">
                  <el-button :icon="RefreshLeft" @click="resetManualItems">
                    撤销修改
                  </el-button>
                  <el-button
                    type="primary"
                    :icon="DocumentChecked"
                    :loading="activeAction === 'save'"
                    :disabled="!hasUnsavedChanges || actionLoading"
                    @click="handleSaveManualItems"
                  >
                    保存维护数据
                  </el-button>
                </div>
                <el-tag v-else type="info" effect="plain">只读</el-tag>
              </div>
            </template>

            <div class="manual-sheet">
              <section
                v-for="group in manualSheetGroups"
                :key="group.accountCode"
                class="manual-sheet-section"
              >
                <header>
                  <span class="account-mark">{{
                    accountShortName(group.accountCode)
                  }}</span>
                  <div>
                    <h3>{{ group.label }}</h3>
                    <p>在对应项目行内直接填写，无需先选择项目。</p>
                  </div>
                </header>
                <div class="manual-sheet-scroll">
                  <table :key="`manual-sheet-layout-v2-${group.accountCode}`">
                    <tbody>
                      <tr class="manual-table-header-row">
                        <th>项目</th>
                        <th>方向</th>
                        <th>类型</th>
                        <th rowspan="2" class="header-rowspan-cell">
                          发生日期
                        </th>
                        <th rowspan="2" class="header-rowspan-cell">金额</th>
                        <th rowspan="2" class="header-rowspan-cell">说明</th>
                        <th rowspan="2" class="header-rowspan-cell">
                          凭证引用
                        </th>
                        <th>项目合计</th>
                        <th>操作</th>
                      </tr>
                      <template
                        v-for="(category, categoryIndex) in group.categories"
                        :key="category.value"
                      >
                        <tr class="manual-category-row">
                          <td
                            class="category-cell category-merged-cell"
                            :rowspan="category.entries.length + 1"
                          >
                            {{ category.label }}
                          </td>
                          <td
                            class="category-merged-cell"
                            :rowspan="category.entries.length + 1"
                          >
                            <el-tag
                              :type="
                                category.direction === 'income'
                                  ? 'success'
                                  : 'warning'
                              "
                              effect="plain"
                              size="small"
                            >
                              {{
                                category.direction === "income"
                                  ? "流入"
                                  : "流出"
                              }}
                            </el-tag>
                          </td>
                          <td class="category-entry-count">
                            已添加 {{ category.entries.length }} 条明细
                          </td>
                          <td
                            v-if="categoryIndex > 0"
                            colspan="4"
                            class="category-empty-merged-cell"
                            aria-label="日期金额说明凭证合并区域"
                          ></td>
                          <td class="category-total-cell">
                            {{ formatAmount(category.totalAmount) }}
                          </td>
                          <td class="operation-cell">
                            <el-tag
                              v-if="category.bankControlled"
                              class="manual-bank-match-tag"
                              type="success"
                              effect="plain"
                              size="small"
                            >
                              回单自动匹配
                            </el-tag>
                            <el-button
                              v-else-if="canEdit"
                              link
                              type="primary"
                              :icon="Plus"
                              @click="addManualItem(category)"
                            >
                              添加
                            </el-button>
                            <span v-else>—</span>
                          </td>
                        </tr>
                        <tr
                          v-for="(entry, entryIndex) in category.entries"
                          :key="entry.item.clientKey"
                          class="manual-entry-row"
                        >
                          <td class="manual-detail-label">
                            明细 {{ entryIndex + 1 }}
                          </td>
                          <td>
                            <el-date-picker
                              v-if="canEdit && !entry.bankDerived"
                              v-model="entry.item.occurredOn"
                              type="date"
                              value-format="YYYY-MM-DD"
                              format="YYYY-MM-DD"
                              :clearable="false"
                              :disabled-date="disableDateOutsideSelectedMonth"
                              @change="markManualItemsDirty"
                            />
                            <span v-else>{{ entry.item.occurredOn }}</span>
                          </td>
                          <td>
                            <el-input
                              v-if="canEdit && !entry.bankDerived"
                              v-model="entry.item.amount"
                              inputmode="decimal"
                              maxlength="31"
                              placeholder="请输入金额"
                              @input="markManualItemsDirty"
                            >
                              <template #prefix>¥</template>
                            </el-input>
                            <span v-else class="table-amount">{{
                              formatAmount(entry.item.amount)
                            }}</span>
                          </td>
                          <td>
                            <el-input
                              v-if="canEdit && !entry.bankDerived"
                              v-model="entry.item.description"
                              :placeholder="
                                category.descriptionRequired
                                  ? '必填：业务说明'
                                  : '选填'
                              "
                              maxlength="300"
                              @input="markManualItemsDirty"
                            />
                            <span v-else>{{
                              entry.item.description || "—"
                            }}</span>
                          </td>
                          <td>
                            <el-input
                              v-if="canEdit && !entry.bankDerived"
                              v-model="entry.item.voucherReference"
                              placeholder="选填"
                              maxlength="120"
                              @input="markManualItemsDirty"
                            />
                            <span v-else>{{
                              entry.item.voucherReference || "—"
                            }}</span>
                          </td>
                          <td class="category-total-cell manual-line-amount">
                            {{ formatAmount(entry.item.amount) }}
                          </td>
                          <td class="operation-cell">
                            <el-link
                              v-if="entry.previewUrl"
                              class="manual-proof-preview"
                              :href="entry.previewUrl"
                              target="_blank"
                              rel="noopener noreferrer"
                              type="primary"
                            >
                              在线预览
                            </el-link>
                            <el-button
                              v-else-if="canEdit && !entry.bankDerived"
                              link
                              type="danger"
                              @click="removeManualItem(entry.index)"
                              >删除</el-button
                            >
                            <span v-else>—</span>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="数据来源与校验" name="quality">
          <section class="quality-grid">
            <el-card shadow="never" class="quality-card">
              <template #header>
                <div class="card-heading">
                  <div>
                    <h2>自动数据来源</h2>
                    <p>月结后数据使用快照，业务源变化只做差异提示。</p>
                  </div>
                </div>
              </template>
              <div class="source-list">
                <article v-for="source in report.sources" :key="source.key">
                  <div class="source-main">
                    <span class="source-icon">
                      <el-icon><Connection /></el-icon>
                    </span>
                    <div>
                      <strong>{{ sourceName(source.key) }}</strong>
                      <small>{{
                        source.message || sourceStatusText(source.status)
                      }}</small>
                    </div>
                  </div>
                  <div class="source-stats">
                    <span>{{ source.recordCount }} 条</span>
                    <strong>{{ formatAmount(source.amount) }}</strong>
                    <el-tag
                      :type="sourceStatusMeta(source.status).type"
                      size="small"
                    >
                      {{ sourceStatusMeta(source.status).label }}
                    </el-tag>
                  </div>
                  <time>{{ formatDateTime(source.lastUpdatedAt) }}</time>
                </article>
              </div>
            </el-card>

            <el-card shadow="never" class="quality-card validation-card">
              <template #header>
                <div class="card-heading">
                  <div>
                    <h2>月结校验</h2>
                    <p>阻断项必须处理后才能月结，警告项需要管理员复核。</p>
                  </div>
                  <el-tag
                    :type="report.validations.canClose ? 'success' : 'danger'"
                    effect="plain"
                  >
                    {{ report.validations.canClose ? "可月结" : "不可月结" }}
                  </el-tag>
                </div>
              </template>
              <div v-if="validationRows.length" class="validation-list">
                <article
                  v-for="item in validationRows"
                  :key="`${item.level}-${item.code}`"
                  :class="`validation-item--${item.level}`"
                >
                  <el-icon>
                    <CircleCloseFilled v-if="item.level === 'blocker'" />
                    <WarningFilled v-else />
                  </el-icon>
                  <div>
                    <strong>{{
                      item.level === "blocker" ? "阻断" : "警告"
                    }}</strong>
                    <p>{{ item.message }}</p>
                  </div>
                </article>
              </div>
              <el-empty
                v-else
                description="当前没有阻断或警告"
                :image-size="80"
              />

              <el-descriptions class="report-metadata" :column="1" border>
                <el-descriptions-item label="统计月份">
                  {{ formatMonth(report.month) }}
                </el-descriptions-item>
                <el-descriptions-item label="当前状态">
                  {{ statusMeta.label }}
                </el-descriptions-item>
                <el-descriptions-item label="最后保存">
                  {{ formatDateTime(report.savedAt) }}
                </el-descriptions-item>
                <el-descriptions-item label="月结信息">
                  <template v-if="report.closedAt">
                    {{ report.closedByName || "管理员" }} ·
                    {{ formatDateTime(report.closedAt) }}
                  </template>
                  <template v-else>尚未月结</template>
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </section>
        </el-tab-pane>

        <el-tab-pane label="银行回单识别" name="bankReceipt">
          <MonthlyBankReceiptPanel
            ref="bankReceiptPanelRef"
            :month="report.month"
            :expected-version="report.version"
            :can-upload="canUploadBankReceipts"
            :disabled="actionLoading || hasUnsavedChanges"
            @busy-change="bankReceiptBusy = $event"
            @pending-change="bankReceiptPending = $event"
            @uncertain-change="bankReceiptOutcomeUncertain = $event"
            @report-refreshed="handleBankReceiptReportRefreshed"
            @uploaded="handleBankReceiptUploaded"
          />
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import {
  CircleCheck,
  CircleCloseFilled,
  Connection,
  DocumentChecked,
  Download,
  Plus,
  Refresh,
  RefreshLeft,
  RefreshRight,
  Unlock,
  UploadFilled,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import MonthlyBankReceiptPanel from "@/components/monthly-financial/MonthlyBankReceiptPanel.vue";
import MonthlyFinancialTrendChart from "@/components/monthly-financial/MonthlyFinancialTrendChart.vue";
import { useAuthStore } from "@/stores/auth";
import {
  addFinancialAmountTexts,
  aggregateAutomaticDetailsByPerson,
  isMonthlyFinancialAmountText,
  isPositiveMonthlyFinancialAmountText,
  monthlyFinancialBankSourceLabel,
} from "@/utils/monthlyFinancialReportPresentation";
import {
  closeMonthlyFinancialReport,
  downloadMonthlyFinancialReport,
  getMonthlyFinancialReport,
  getMonthlyFinancialReportErrorMessage,
  getMonthlyFinancialReportTrend,
  isMonthlyFinancialReportNotFound,
  isMonthlyFinancialReportVersionConflict,
  refreshMonthlyFinancialReport,
  reopenMonthlyFinancialReport,
  saveMonthlyFinancialManualItems,
  type MonthlyFinancialBankReceiptUploadResult,
} from "@/utils/monthlyFinancialReportApi";
import type {
  MonthlyFinancialAccountCode,
  MonthlyFinancialAmount,
  MonthlyFinancialManualCategory,
  MonthlyFinancialManualDirection,
  MonthlyFinancialManualItem,
  MonthlyFinancialManualItemInput,
  MonthlyFinancialOpeningBalances,
  MonthlyFinancialReport,
  MonthlyFinancialSourceStatus,
  MonthlyFinancialTrendPoint,
  MonthlyFinancialTrendWarning,
} from "@/types/monthlyFinancialReport";

type ReportTab = "trend" | "summary" | "manual" | "quality" | "bankReceipt";
type ActiveAction = "" | "save" | "refresh" | "close" | "reopen" | "download";

interface ManualCategoryOption {
  value: MonthlyFinancialManualCategory;
  label: string;
  accountCode: MonthlyFinancialAccountCode;
  accountName: string;
  direction: MonthlyFinancialManualDirection;
  descriptionRequired?: boolean;
}

interface EditableManualItem extends MonthlyFinancialManualItem {
  clientKey: string;
}

interface ManualSheetEntry {
  item: EditableManualItem;
  index: number;
  bankDerived: boolean;
  previewUrl: string | null;
}

interface MonthActionContext {
  month: string;
  version: number;
  viewSequence: number;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const report = ref<MonthlyFinancialReport | null>(null);
const selectedMonth = ref(currentMonthKey());
const loadedMonth = ref("");
const loading = ref(false);
const loadError = ref("");
const activeAction = ref<ActiveAction>("");
const activeTab = ref<ReportTab>("trend");
const trendSelectedYear = ref(currentYearNumber());
const trendComparisonYear = ref<number | null>(null);
const trendAvailableYears = ref<number[]>([]);
const trendPoints = ref<MonthlyFinancialTrendPoint[]>([]);
const trendWarnings = ref<MonthlyFinancialTrendWarning[]>([]);
const trendLoading = ref(false);
const trendError = ref("");
const bankReceiptBusy = ref(false);
const bankReceiptPending = ref(false);
const bankReceiptOutcomeUncertain = ref(false);
const bankReceiptPanelRef = ref<InstanceType<
  typeof MonthlyBankReceiptPanel
> | null>(null);
const expandedAccountCodes = ref<MonthlyFinancialAccountCode[]>([]);
const manualItems = ref<EditableManualItem[]>([]);
const manualItemsDirty = ref(false);
const openingBalances = reactive<Record<MonthlyFinancialAccountCode, string>>({
  general: "",
  business: "",
  welfare_one: "",
  welfare_two: "",
});
const openingBalancesDirty = ref(false);
let requestSequence = 0;
let clientKeySequence = 0;
let monthViewSequence = 0;
let allowNextMonthRouteChange = false;
let trendRequestSequence = 0;

const manualCategoryGroups: Array<{
  label: string;
  options: ManualCategoryOption[];
}> = [
  {
    label: "一般账户",
    options: [
      categoryOption("general_interest", "一般账户利息", "general", "income"),
      categoryOption(
        "general_bank_fee",
        "一般账户跨行手续费",
        "general",
        "expense",
      ),
      categoryOption(
        "general_other",
        "一般账户其他支出",
        "general",
        "expense",
        true,
      ),
    ],
  },
  {
    label: "商务账户",
    options: [
      categoryOption("business_interest", "商务账户利息", "business", "income"),
      categoryOption(
        "business_bank_fee",
        "商务账户跨行手续费",
        "business",
        "expense",
      ),
    ],
  },
  {
    label: "福利账户一",
    options: [
      categoryOption(
        "welfare_one_supplement",
        "福利账户一补充收入",
        "welfare_one",
        "income",
      ),
      categoryOption(
        "welfare_one_drinking_water",
        "饮用水",
        "welfare_one",
        "expense",
      ),
      categoryOption("welfare_one_office", "办公", "welfare_one", "expense"),
      categoryOption(
        "welfare_one_electricity",
        "电费",
        "welfare_one",
        "expense",
      ),
      categoryOption("welfare_one_407_ai", "407-AI", "welfare_one", "expense"),
      categoryOption("welfare_one_8h_ai", "8H-AI", "welfare_one", "expense"),
    ],
  },
  {
    label: "福利账户二",
    options: [
      categoryOption(
        "welfare_two_supplement",
        "福利账户二补充收入",
        "welfare_two",
        "income",
      ),
      categoryOption(
        "welfare_two_refreshment",
        "茶歇",
        "welfare_two",
        "expense",
      ),
      categoryOption(
        "welfare_two_team_building",
        "团建",
        "welfare_two",
        "expense",
      ),
      categoryOption(
        "welfare_two_physical_exam",
        "体检",
        "welfare_two",
        "expense",
      ),
    ],
  },
];

const manualCategoryOptions = manualCategoryGroups.flatMap(
  (group) => group.options,
);

const bankChargeCategories = new Set<MonthlyFinancialManualCategory>([
  "general_interest",
  "general_bank_fee",
  "business_interest",
  "business_bank_fee",
]);

function bankControlsManualCategory(category: ManualCategoryOption): boolean {
  if (!bankChargeCategories.has(category.value)) return false;
  const bankAccountCode = category.accountCode;
  return Boolean(
    (bankAccountCode === "general" || bankAccountCode === "business") &&
    report.value?.bank?.chargeAccounts?.includes(bankAccountCode),
  );
}

function bankChargeEntries(category: ManualCategoryOption): ManualSheetEntry[] {
  if (!bankChargeCategories.has(category.value)) return [];
  return (report.value?.manualItems || [])
    .filter(
      (item) =>
        item.category === category.value &&
        item.sourceType === "monthly_bank_transaction" &&
        item.readOnly === true &&
        item.effective !== false,
    )
    .map((item) => ({
      item: {
        ...item,
        clientKey: item.id || nextClientKey(),
      },
      index: -1,
      bankDerived: true,
      previewUrl: item.previewUrl || null,
    }));
}

const manualSheetGroups = computed(() =>
  manualCategoryGroups.map((group) => ({
    label: group.label,
    accountCode: group.options[0].accountCode,
    categories: group.options.map((category) => {
      const bankControlled = bankControlsManualCategory(category);
      const entries: ManualSheetEntry[] = bankControlled
        ? bankChargeEntries(category)
        : manualItems.value
            .map((item, index) => ({
              item,
              index,
              bankDerived: false,
              previewUrl: null,
            }))
            .filter(({ item }) => item.category === category.value);
      return {
        ...category,
        bankControlled,
        entries,
        totalAmount: entries.reduce(
          (total, entry) =>
            isMonthlyFinancialAmountText(entry.item.amount)
              ? addFinancialAmountTexts(total, entry.item.amount)
              : total,
          "0",
        ),
      };
    }),
  })),
);

const isAdminRole = computed(() => authStore.user?.role === "admin");
const isGeneralManagerRole = computed(
  () => authStore.user?.role === "general_manager",
);
const actionLoading = computed(
  () => activeAction.value !== "" || bankReceiptBusy.value,
);
const hasUnsavedChanges = computed(
  () => manualItemsDirty.value || openingBalancesDirty.value,
);
const canEdit = computed(
  () =>
    isAdminRole.value &&
    Boolean(report.value) &&
    report.value?.status !== "closed" &&
    report.value?.permissions?.canEdit !== false,
);
const canRefresh = computed(
  () => canEdit.value && report.value?.permissions?.canRefresh !== false,
);
const canShowClose = computed(
  () =>
    isAdminRole.value &&
    Boolean(report.value) &&
    report.value?.status !== "closed",
);
const canClose = computed(
  () =>
    isAdminRole.value &&
    Boolean(report.value) &&
    report.value?.status !== "closed" &&
    report.value?.validations.canClose &&
    report.value?.permissions?.canClose !== false,
);
const closeActionReason = computed(() => {
  if (!canShowClose.value || !report.value) return "";
  const reasons = [
    ...(hasUnsavedChanges.value ? ["存在未保存修改，请先保存或撤销修改"] : []),
    ...new Set(
      report.value.validations.blockers
        .map((item) => item.message.trim())
        .filter(Boolean),
    ),
  ];
  if (!canClose.value && reasons.length === 0) {
    reasons.push("当前账号或报表状态暂不允许执行月结");
  }
  return [...new Set(reasons)].join("；");
});
const canReopen = computed(
  () =>
    isAdminRole.value &&
    report.value?.status === "closed" &&
    report.value?.permissions?.canReopen !== false,
);
const canDownload = computed(
  () =>
    (isAdminRole.value || isGeneralManagerRole.value) &&
    Boolean(report.value) &&
    report.value?.permissions?.canDownload !== false,
);
const canUploadBankReceipts = computed(() => canEdit.value);

const statusMeta = computed(() => {
  const metadata = {
    draft: { label: "草稿", type: "info" as const },
    pending_review: { label: "待复核", type: "warning" as const },
    closed: { label: "已月结", type: "success" as const },
    reopened: { label: "已重新开启", type: "warning" as const },
  };
  return metadata[report.value?.status || "draft"];
});

const reportTimeText = computed(() => {
  if (!report.value) return "";
  if (report.value.status === "reopened" && report.value.reopenedAt) {
    return `重新开启于 ${formatDateTime(report.value.reopenedAt)}`;
  }
  if (report.value.closedAt) {
    return `月结于 ${formatDateTime(report.value.closedAt)}`;
  }
  if (report.value.savedAt) {
    return `保存于 ${formatDateTime(report.value.savedAt)}`;
  }
  return `生成于 ${formatDateTime(report.value.generatedAt)}`;
});

const totalMetrics = computed(() => {
  const totals = report.value?.totals;
  if (!totals) return [];
  return [
    {
      key: "opening",
      label: "期初资金合计",
      value: totals.opening,
      note: "四账户期初",
      tone: "slate",
    },
    {
      key: "income",
      label: "当月实际到账合计",
      value: totals.income,
      note: "仅统计已确认主营业务银行回款",
      tone: "green",
    },
    {
      key: "expense",
      label: "当月流出合计",
      value: totals.expense,
      note: "四账户全部支出",
      tone: "amber",
    },
    {
      key: "closing",
      label: "期末资金合计",
      value: totals.closing,
      note: report.value?.status === "closed" ? "月结快照" : "当前值（未月结）",
      tone: "blue",
    },
    {
      key: "net",
      label: "四账户净变化",
      value: totals.netChange,
      note: "账户期末减期初，不等同于到账减支出",
      tone: "violet",
    },
  ];
});

const accountFlowDetails = computed(() => {
  if (!report.value) return [];
  const { income, expenses, accounts } = report.value;
  const automaticDetails = report.value.automaticDetails || [];
  const account = (code: MonthlyFinancialAccountCode) =>
    accounts.find((item) => item.code === code)!;
  const bankAccountSource = (code: "basic" | "general" | "business") =>
    monthlyFinancialBankSourceLabel(
      report.value?.bank?.activeAccounts,
      code,
      report.value?.bank?.chargeAccounts,
    );
  const row = (
    label: string,
    value: MonthlyFinancialAmount,
    source: string,
    personMetric?: string,
    aggregateByPerson = false,
  ) => ({
    label,
    value,
    source,
    people: personMetric
      ? aggregateByPerson
        ? aggregateAutomaticDetailsByPerson(
            automaticDetails,
            personMetric,
            report.value!.month,
          )
        : automaticDetails.filter((detail) => detail.metric === personMetric)
      : [],
    peopleCaption: aggregateByPerson ? "该类型当月总计" : "人力成本",
  });

  return [
    {
      ...account("general"),
      inflowTotal: account("general").inflow,
      outflowTotal: account("general").outflow,
      inflows: [
        row("主营核算基数", income.accountingBase, "合同已确认回款"),
        row(
          "一般账户利息",
          income.generalInterest,
          bankAccountSource("general"),
        ),
      ],
      outflows: [
        row(
          "薪资／人力成本",
          expenses.humanCost,
          "人力成本",
          "human_cost",
          true,
        ),
        row(
          "基础报销",
          expenses.basicReimbursement,
          "已支付报销",
          "basic_reimbursement",
          true,
        ),
        row(
          "大额报销",
          expenses.largeReimbursement,
          "已支付报销",
          "large_reimbursement",
          true,
        ),
        row("资产行政支出", expenses.assetAdministration, "资产合同付款"),
        row(
          "一般账户跨行手续费",
          expenses.generalBankFee,
          bankAccountSource("general"),
        ),
        row("其他支出", expenses.generalOther, "手工录入"),
      ],
    },
    {
      ...account("business"),
      inflowTotal: account("business").inflow,
      outflowTotal: account("business").outflow,
      inflows: [
        row("预扣营销", income.marketingReserve, "合同已确认回款"),
        row("商务费用计提", income.businessCost, "合同已确认回款"),
        row(
          "商务账户利息",
          income.businessInterest,
          bankAccountSource("business"),
        ),
      ],
      outflows: [
        row(
          "商务报销",
          expenses.businessReimbursement,
          "已支付报销",
          "business_reimbursement",
          true,
        ),
        row(
          "商务账户跨行手续费",
          expenses.businessBankFee,
          bankAccountSource("business"),
        ),
      ],
    },
    {
      ...account("welfare_one"),
      inflowTotal: account("welfare_one").inflow,
      outflowTotal: account("welfare_one").outflow,
      inflows: [row("补充收入", income.welfareOneSupplement, "手工录入")],
      outflows: [
        row("饮用水", expenses.welfareOneDrinkingWater, "手工录入"),
        row("办公", expenses.welfareOneOffice, "手工录入"),
        row("电费", expenses.welfareOneElectricity, "手工录入"),
        row("407-AI", expenses.welfareOne407Ai, "手工录入"),
        row("8H-AI", expenses.welfareOne8hAi, "手工录入"),
      ],
    },
    {
      ...account("welfare_two"),
      inflowTotal: account("welfare_two").inflow,
      outflowTotal: account("welfare_two").outflow,
      inflows: [row("补充收入", income.welfareTwoSupplement, "手工录入")],
      outflows: [
        row("茶歇", expenses.welfareTwoRefreshment, "手工录入"),
        row("团建", expenses.welfareTwoTeamBuilding, "手工录入"),
        row("体检", expenses.welfareTwoPhysicalExam, "手工录入"),
      ],
    },
  ];
});

function accountDetail(code: MonthlyFinancialAccountCode) {
  return accountFlowDetails.value.find((detail) => detail.code === code)!;
}

function isAccountDetailsExpanded(code: MonthlyFinancialAccountCode): boolean {
  return expandedAccountCodes.value.includes(code);
}

function toggleAccountDetails(code: MonthlyFinancialAccountCode) {
  expandedAccountCodes.value = isAccountDetailsExpanded(code)
    ? expandedAccountCodes.value.filter((item) => item !== code)
    : [...expandedAccountCodes.value, code];
}

const validationRows = computed(() => [
  ...(report.value?.validations.blockers || []).map((item) => ({
    ...item,
    level: "blocker" as const,
  })),
  ...(report.value?.validations.warnings || []).map((item) => ({
    ...item,
    level: "warning" as const,
  })),
]);

watch(
  () => route.query.month,
  (value) => {
    const month = queryText(value);
    const normalizedMonth = validMonth(month) ? month : currentMonthKey();
    if (!validMonth(month)) {
      void router.replace({
        query: { ...route.query, month: normalizedMonth },
      });
      return;
    }
    monthViewSequence += 1;
    selectedMonth.value = normalizedMonth;
    void ensureTrendForMonth(normalizedMonth);
    if (report.value && loadedMonth.value === normalizedMonth) return;
    void loadReport(normalizedMonth, monthViewSequence);
  },
  { immediate: true },
);

onBeforeRouteUpdate(async (to, from) => {
  const nextMonth = normalizedQueryMonth(to.query.month);
  const currentMonth = normalizedQueryMonth(from.query.month);
  if (nextMonth === currentMonth || allowNextMonthRouteChange) return true;
  if (bankReceiptOutcomeUncertain.value) {
    selectedMonth.value = loadedMonth.value || currentMonth;
    ElMessage.warning("上一批银行回单结果仍待确认，请刷新回单状态后再切换月份");
    return false;
  }
  if (bankReceiptBusy.value) {
    selectedMonth.value = loadedMonth.value || currentMonth;
    ElMessage.warning("银行回单仍在识别中，暂时不能切换月份");
    return false;
  }
  const bankSelectionConfirmed =
    await confirmDiscardPendingBankReceipts("切换月份");
  if (!bankSelectionConfirmed) {
    selectedMonth.value = loadedMonth.value || currentMonth;
    return false;
  }
  const confirmed = await confirmDiscardUnsavedChanges("切换月份");
  if (!confirmed) {
    selectedMonth.value = loadedMonth.value || currentMonth;
  }
  return confirmed;
});

onBeforeRouteLeave(async () => {
  if (bankReceiptOutcomeUncertain.value) {
    ElMessage.warning(
      "上一批银行回单结果仍待确认，请刷新回单状态后再离开月度财务报表",
    );
    return false;
  }
  if (bankReceiptBusy.value) {
    ElMessage.warning("银行回单仍在识别中，暂时不能离开月度财务报表");
    return false;
  }
  if (!(await confirmDiscardPendingBankReceipts("离开月度财务报表"))) {
    return false;
  }
  return confirmDiscardUnsavedChanges("离开月度财务报表");
});

function handleBeforeUnload(event: globalThis.BeforeUnloadEvent) {
  if (
    !hasUnsavedChanges.value &&
    !bankReceiptBusy.value &&
    !bankReceiptPending.value
  )
    return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => window.addEventListener("beforeunload", handleBeforeUnload));
onBeforeUnmount(() =>
  window.removeEventListener("beforeunload", handleBeforeUnload),
);

async function ensureTrendForMonth(month: string) {
  const year = yearFromMonth(month);
  if (year === null) return;
  const alreadyLoaded = trendPoints.value.some((point) =>
    point.month.startsWith(`${year}-`),
  );
  if (
    year === trendSelectedYear.value &&
    (trendLoading.value || alreadyLoaded)
  ) {
    return;
  }
  trendSelectedYear.value = year;
  trendComparisonYear.value = null;
  await loadTrend(year);
}

async function loadTrend(
  selectedYear = trendSelectedYear.value,
  requestedComparisonYear = trendComparisonYear.value,
) {
  const sequence = ++trendRequestSequence;
  trendLoading.value = true;
  trendError.value = "";
  try {
    const selectedData = await getMonthlyFinancialReportTrend(
      `${selectedYear}-01`,
      `${selectedYear}-12`,
    );
    if (
      sequence !== trendRequestSequence ||
      selectedYear !== trendSelectedYear.value
    ) {
      return;
    }

    const availableYears = normalizeTrendYears(selectedData.availableYears);
    const comparisonYear = resolveTrendComparisonYear(
      selectedYear,
      availableYears,
      requestedComparisonYear,
    );
    const comparisonData =
      comparisonYear === null
        ? null
        : await getMonthlyFinancialReportTrend(
            `${comparisonYear}-01`,
            `${comparisonYear}-12`,
          );
    if (
      sequence !== trendRequestSequence ||
      selectedYear !== trendSelectedYear.value
    ) {
      return;
    }

    trendAvailableYears.value = normalizeTrendYears([
      ...availableYears,
      ...(comparisonData?.availableYears || []),
    ]);
    trendComparisonYear.value = comparisonYear;
    trendPoints.value = mergeTrendPoints([
      ...selectedData.points,
      ...(comparisonData?.points || []),
    ]);
    trendWarnings.value = mergeTrendWarnings([
      ...selectedData.warnings,
      ...(comparisonData?.warnings || []),
    ]);
  } catch (error) {
    if (
      sequence !== trendRequestSequence ||
      selectedYear !== trendSelectedYear.value
    ) {
      return;
    }
    trendError.value = getMonthlyFinancialReportErrorMessage(
      error,
      "暂时无法获取年度趋势，请稍后重试。",
    );
  } finally {
    if (sequence === trendRequestSequence) trendLoading.value = false;
  }
}

function handleTrendComparisonYearChange(year: number | null) {
  trendComparisonYear.value = year;
  void loadTrend(trendSelectedYear.value, year);
}

function handleTrendRetry() {
  void loadTrend(trendSelectedYear.value, trendComparisonYear.value);
}

function refreshTrendAfterReportMutation(month: string) {
  if (yearFromMonth(month) !== trendSelectedYear.value) return;
  void loadTrend(trendSelectedYear.value, trendComparisonYear.value);
}

function resolveTrendComparisonYear(
  selectedYear: number,
  availableYears: number[],
  requestedYear: number | null,
): number | null {
  const historicalYears = availableYears.filter((year) => year < selectedYear);
  if (requestedYear !== null && historicalYears.includes(requestedYear)) {
    return requestedYear;
  }
  return historicalYears.at(-1) ?? null;
}

function normalizeTrendYears(years: number[]): number[] {
  return [...new Set(years)]
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 9999)
    .sort((left, right) => left - right);
}

function mergeTrendPoints(
  points: MonthlyFinancialTrendPoint[],
): MonthlyFinancialTrendPoint[] {
  const pointByMonth = new Map<string, MonthlyFinancialTrendPoint>();
  for (const point of points) pointByMonth.set(point.month, point);
  return [...pointByMonth.values()].sort((left, right) =>
    left.month.localeCompare(right.month),
  );
}

function mergeTrendWarnings(
  warnings: MonthlyFinancialTrendWarning[],
): MonthlyFinancialTrendWarning[] {
  const warningByKey = new Map<string, MonthlyFinancialTrendWarning>();
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    const existing = warningByKey.get(key);
    warningByKey.set(key, {
      ...warning,
      months: [
        ...new Set([...(existing?.months || []), ...warning.months]),
      ].sort(),
    });
  }
  return [...warningByKey.values()];
}

async function handleReloadReport() {
  const confirmed = await confirmDiscardUnsavedChanges("重新加载");
  if (!confirmed) return;
  await loadReport(loadedMonth.value || selectedMonth.value, monthViewSequence);
}

function openBankReceiptUpload() {
  if (!report.value || !canUploadBankReceipts.value) {
    if (report.value?.status === "closed") {
      ElMessage.warning("已月结报表不能再上传银行回单，请先重新开启");
    }
    return;
  }
  if (hasUnsavedChanges.value) {
    ElMessage.warning("请先保存或撤销当前维护数据，再上传银行回单");
    return;
  }
  bankReceiptPanelRef.value?.openUploadDialog();
}

function handleBankReceiptUploaded(
  result: MonthlyFinancialBankReceiptUploadResult,
) {
  if (
    !report.value ||
    result.report.month !== report.value.month ||
    normalizedQueryMonth(route.query.month) !== result.report.month
  ) {
    return;
  }
  requestSequence += 1;
  loading.value = false;
  applyReport(result.report);
  refreshTrendAfterReportMutation(result.report.month);
}

function handleBankReceiptReportRefreshed(
  latestReport: MonthlyFinancialReport,
) {
  if (
    !report.value ||
    latestReport.month !== report.value.month ||
    normalizedQueryMonth(route.query.month) !== latestReport.month
  ) {
    return;
  }
  requestSequence += 1;
  loading.value = false;
  applyReport(latestReport);
  refreshTrendAfterReportMutation(latestReport.month);
}

async function loadReport(
  targetMonth = selectedMonth.value,
  targetViewSequence = monthViewSequence,
) {
  if (!validMonth(targetMonth)) return;
  const sequence = ++requestSequence;
  loading.value = true;
  loadError.value = "";
  try {
    const nextReport = await getMonthlyFinancialReport(targetMonth);
    if (
      sequence !== requestSequence ||
      targetViewSequence !== monthViewSequence ||
      normalizedQueryMonth(route.query.month) !== targetMonth
    ) {
      return;
    }
    applyReport(nextReport);
  } catch (error) {
    if (
      sequence !== requestSequence ||
      targetViewSequence !== monthViewSequence
    ) {
      return;
    }
    if (!isMonthlyFinancialReportNotFound(error)) {
      loadError.value = getMonthlyFinancialReportErrorMessage(
        error,
        "暂时无法获取月度财务报表，请稍后重试。",
      );
    }
    if (report.value && loadedMonth.value !== targetMonth) {
      selectedMonth.value = loadedMonth.value;
      await replaceMonthRouteWithoutPrompt(loadedMonth.value);
    }
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

async function handleMonthChange(value: string | null) {
  if (!value || !validMonth(value)) return;
  const previousMonth =
    loadedMonth.value || normalizedQueryMonth(route.query.month);
  selectedMonth.value = previousMonth;
  if (value === normalizedQueryMonth(route.query.month)) return;
  if (bankReceiptOutcomeUncertain.value) {
    ElMessage.warning("上一批银行回单结果仍待确认，请刷新回单状态后再切换月份");
    return;
  }
  if (bankReceiptBusy.value) {
    ElMessage.warning("银行回单仍在处理中，暂时不能切换月份");
    return;
  }
  if (!(await confirmDiscardPendingBankReceipts("切换月份"))) return;
  const confirmed = await confirmDiscardUnsavedChanges("切换月份");
  if (!confirmed) return;
  await replaceMonthRouteWithoutPrompt(value);
}

async function handleRefreshSources() {
  if (!report.value) return;
  const context = captureMonthActionContext(report.value);
  activeAction.value = "refresh";
  try {
    const result = await refreshMonthlyFinancialReport(
      context.month,
      context.version,
    );
    const applied = applyActionReport(result.report, context);
    if (applied) {
      await bankReceiptPanelRef.value?.refreshBankState();
    }
    notifyActionResult(
      applied,
      mutationSuccessMessage(result, "自动数据已同步"),
      context.month,
    );
  } catch (error) {
    await handleActionError(error, "同步自动数据失败");
  } finally {
    activeAction.value = "";
  }
}

async function handleSaveManualItems() {
  if (!report.value || !canEdit.value) return;
  const context = captureMonthActionContext(report.value);
  const nextOpeningBalances = report.value.isFirstMonth
    ? ({ ...openingBalances } satisfies MonthlyFinancialOpeningBalances)
    : undefined;
  if (
    nextOpeningBalances &&
    Object.values(nextOpeningBalances).some(
      (value) => !isMonthlyFinancialAmountText(value, true),
    )
  ) {
    ElMessage.warning(
      "请完整填写四个账户的首月期初余额，金额整数最多18位、小数最多12位",
    );
    return;
  }
  const manualValidationMessage = validateManualItems();
  if (manualValidationMessage) {
    activeTab.value = "manual";
    ElMessage.warning(manualValidationMessage);
    return;
  }
  activeAction.value = "save";
  try {
    const inputs: MonthlyFinancialManualItemInput[] = manualItems.value.map(
      (item) => ({
        id: item.id.startsWith("local-") ? undefined : item.id,
        category: item.category,
        occurredOn: item.occurredOn,
        amount: item.amount,
        description: item.description?.trim() || null,
        voucherReference: item.voucherReference?.trim() || null,
      }),
    );
    const result = await saveMonthlyFinancialManualItems(
      context.month,
      context.version,
      inputs,
      nextOpeningBalances,
    );
    notifyActionResult(
      applyActionReport(result.report, context),
      mutationSuccessMessage(result, "手工项目已保存"),
      context.month,
    );
  } catch (error) {
    await handleActionError(error, "保存手工项目失败");
  } finally {
    activeAction.value = "";
  }
}

async function handleCloseReport() {
  if (!report.value || !canClose.value) return;
  const context = captureMonthActionContext(report.value);
  const hasNegativeBalanceWarning = report.value.validations.warnings.some(
    (item) => item.code.toLowerCase().includes("negative"),
  );
  try {
    const prompt = await ElMessageBox.prompt(
      hasNegativeBalanceWarning
        ? "当前存在负余额警告。确认真实无误后请输入月结说明。"
        : "月结后本月数据将锁定。如有补充，请输入月结说明。",
      `确认月结 ${formatMonth(context.month)}`,
      {
        type: hasNegativeBalanceWarning ? "warning" : "info",
        inputType: "textarea",
        inputPlaceholder: "选填：本次复核或月结说明",
        confirmButtonText: hasNegativeBalanceWarning
          ? "确认负余额并月结"
          : "确认月结",
        cancelButtonText: "取消",
      },
    );
    if (!isMonthActionContextCurrent(context)) {
      ElMessage.info("当前月份已切换，本次月结未提交");
      return;
    }
    activeAction.value = "close";
    const nextReport = await closeMonthlyFinancialReport(context.month, {
      expectedVersion: context.version,
      negativeBalanceConfirmed: hasNegativeBalanceWarning || undefined,
      note: String(prompt.value || "").trim() || undefined,
    });
    notifyActionResult(
      applyActionReport(nextReport, context),
      "月结完成，当前版本已锁定",
      context.month,
    );
  } catch (error) {
    if (isMessageBoxCancel(error)) return;
    await handleActionError(error, "月结失败");
  } finally {
    activeAction.value = "";
  }
}

async function handleReopenReport() {
  if (!report.value || !canReopen.value) return;
  const context = captureMonthActionContext(report.value);
  try {
    const prompt = await ElMessageBox.prompt(
      "重新开启后可修正本月数据，原月结快照仍将保留。请输入原因。",
      `重新开启 ${formatMonth(context.month)}`,
      {
        type: "warning",
        inputType: "textarea",
        inputPlaceholder: "必填：说明重新开启原因，最多500字",
        inputValidator: validateReopenReason,
        confirmButtonText: "确认重新开启",
        cancelButtonText: "取消",
      },
    );
    if (!isMonthActionContextCurrent(context)) {
      ElMessage.info("当前月份已切换，本次重新开启未提交");
      return;
    }
    activeAction.value = "reopen";
    const result = await reopenMonthlyFinancialReport(
      context.month,
      context.version,
      String(prompt.value).trim(),
    );
    notifyActionResult(
      applyActionReport(result.report, context),
      mutationSuccessMessage(result, "月报已重新开启，可继续维护"),
      context.month,
    );
  } catch (error) {
    if (isMessageBoxCancel(error)) return;
    await handleActionError(error, "重新开启失败");
  } finally {
    activeAction.value = "";
  }
}

async function handleDownload() {
  if (!report.value || !canDownload.value) return;
  activeAction.value = "download";
  try {
    const file = await downloadMonthlyFinancialReport(report.value.month);
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    ElMessage.success("月度财务报表已开始下载");
  } catch (error) {
    ElMessage.error(
      getMonthlyFinancialReportErrorMessage(error, "下载月度财务报表失败"),
    );
  } finally {
    activeAction.value = "";
  }
}

function applyReport(nextReport: MonthlyFinancialReport) {
  report.value = nextReport;
  selectedMonth.value = nextReport.month;
  loadedMonth.value = nextReport.month;
  manualItems.value = nextReport.manualItems
    .filter(
      (item) =>
        item.sourceType !== "monthly_bank_transaction" &&
        item.readOnly !== true,
    )
    .map((item) => ({
      ...item,
      clientKey: item.id || nextClientKey(),
    }));
  for (const account of nextReport.accounts) {
    openingBalances[account.code] = account.opening;
  }
  manualItemsDirty.value = false;
  openingBalancesDirty.value = false;
}

function captureMonthActionContext(
  currentReport: MonthlyFinancialReport,
): MonthActionContext {
  return {
    month: currentReport.month,
    version: currentReport.version,
    viewSequence: monthViewSequence,
  };
}

function isMonthActionContextCurrent(context: MonthActionContext): boolean {
  return (
    context.viewSequence === monthViewSequence &&
    report.value?.month === context.month &&
    selectedMonth.value === context.month &&
    normalizedQueryMonth(route.query.month) === context.month
  );
}

function applyActionReport(
  nextReport: MonthlyFinancialReport,
  context: MonthActionContext,
): boolean {
  if (
    nextReport.month !== context.month ||
    !isMonthActionContextCurrent(context)
  ) {
    return false;
  }
  requestSequence += 1;
  loading.value = false;
  applyReport(nextReport);
  refreshTrendAfterReportMutation(nextReport.month);
  return true;
}

function notifyActionResult(
  applied: boolean,
  successMessage: string,
  actionMonth: string,
) {
  if (applied) {
    ElMessage.success(successMessage);
    return;
  }
  ElMessage.info(
    `${formatMonth(actionMonth)}的操作已完成；当前页面月份已变化，未用旧响应覆盖页面`,
  );
}

function mutationSuccessMessage(
  result: {
    affectedMonths: string[];
    message?: string;
  },
  fallback: string,
): string {
  if (result.affectedMonths.length === 0) return result.message || fallback;
  const serverMessage = String(result.message || "");
  if (serverMessage.includes("待重新核算")) return serverMessage;
  return `${result.message || fallback}；${result.affectedMonths.join("、")}已标记为待重新核算`;
}

function resetManualItems() {
  if (!report.value) return;
  manualItems.value = report.value.manualItems
    .filter(
      (item) =>
        item.sourceType !== "monthly_bank_transaction" &&
        item.readOnly !== true,
    )
    .map((item) => ({
      ...item,
      clientKey: item.id || nextClientKey(),
    }));
  for (const account of report.value.accounts) {
    openingBalances[account.code] = account.opening;
  }
  manualItemsDirty.value = false;
  openingBalancesDirty.value = false;
}

function addManualItem(category: ManualCategoryOption) {
  if (manualItems.value.length >= 500) {
    ElMessage.warning("单月手工项目不能超过500条");
    return;
  }
  const clientKey = nextClientKey();
  manualItems.value.push({
    id: `local-${Date.now()}-${clientKey}`,
    clientKey,
    category: category.value,
    categoryLabel: category.label,
    accountCode: category.accountCode,
    direction: category.direction,
    occurredOn: `${selectedMonth.value}-01`,
    amount: "",
    description: null,
    voucherReference: null,
  });
  markManualItemsDirty();
}

function markManualItemsDirty() {
  manualItemsDirty.value = true;
}

async function removeManualItem(index: number) {
  try {
    await ElMessageBox.confirm(
      "删除后需点击“保存全部修改”才会生效。",
      "删除手工项目",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
      },
    );
    manualItems.value.splice(index, 1);
    manualItemsDirty.value = true;
  } catch {
    // 用户取消删除时保持原数据。
  }
}

function validateManualItems(): string {
  for (const [index, item] of manualItems.value.entries()) {
    const category = manualCategoryOptions.find(
      (option) => option.value === item.category,
    );
    if (!category) return `第${index + 1}行项目分类无效`;
    if (!item.occurredOn.startsWith(`${selectedMonth.value}-`)) {
      return `${category.label}的发生日期必须位于当前报表月份`;
    }
    if (!isPositiveMonthlyFinancialAmountText(item.amount)) {
      return `${category.label}请输入大于零的十进制金额，整数最多18位、小数最多12位`;
    }
    if (category.descriptionRequired && !item.description?.trim()) {
      return `${category.label}必须填写业务说明`;
    }
  }
  return "";
}

function disableDateOutsideSelectedMonth(date: Date): boolean {
  const dateMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return dateMonth !== selectedMonth.value;
}

async function handleActionError(error: unknown, fallback: string) {
  if (isMonthlyFinancialReportVersionConflict(error)) {
    ElMessage.warning(
      "该月报已被其他操作更新，本地未保存内容已保留；请核对后手动重新加载",
    );
    return;
  }
  ElMessage.error(getMonthlyFinancialReportErrorMessage(error, fallback));
}

function categoryOption(
  value: MonthlyFinancialManualCategory,
  label: string,
  accountCode: MonthlyFinancialAccountCode,
  direction: MonthlyFinancialManualDirection,
  descriptionRequired = false,
): ManualCategoryOption {
  return {
    value,
    label,
    accountCode,
    accountName: accountName(accountCode),
    direction,
    descriptionRequired,
  };
}

function accountName(code: MonthlyFinancialAccountCode): string {
  return {
    general: "一般账户",
    business: "商务账户",
    welfare_one: "福利账户一",
    welfare_two: "福利账户二",
  }[code];
}

function accountShortName(code: MonthlyFinancialAccountCode): string {
  return {
    general: "般",
    business: "商",
    welfare_one: "福一",
    welfare_two: "福二",
  }[code];
}

function accountFormula(code: MonthlyFinancialAccountCode): string {
  return {
    general: "期初＋核算基数＋利息－一般账户支出",
    business: "期初＋营销及商务计提＋利息－商务支出",
    welfare_one: "期初＋补充收入－福利一分类支出",
    welfare_two: "期初＋补充收入－福利二分类支出",
  }[code];
}

function sourceName(key: string): string {
  return (
    {
      contract_receipts: "主营合同回款",
      payroll: "人力成本",
      reimbursements: "报销付款",
      asset_payments: "资产合同付款",
      monthly_bank_receipts: "月度银行回单",
    }[key] || key
  );
}

function sourceStatusMeta(status: MonthlyFinancialSourceStatus) {
  return {
    ready: { label: "正常", type: "success" as const },
    empty: { label: "无记录", type: "info" as const },
    missing: { label: "数据缺失", type: "danger" as const },
    changed: { label: "来源已变化", type: "warning" as const },
  }[status];
}

function sourceStatusText(status: MonthlyFinancialSourceStatus): string {
  return {
    ready: "数据已同步",
    empty: "本月确认无业务记录",
    missing: "数据源暂不可用",
    changed: "业务源与当前月报版本存在差异",
  }[status];
}

function formatAmount(
  value: MonthlyFinancialAmount | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  const match = text.match(/^([+-]?)(\d+)(\.\d+)?$/);
  if (!match) return text;
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${match[1]}${integer}${match[3] || ""}`;
}

function isNegative(value: MonthlyFinancialAmount): boolean {
  return String(value).trim().startsWith("-");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMonth(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}年${Number(match[2])}月` : value;
}

function formatDetailMonth(value: string): string {
  return formatMonth(String(value || "").slice(0, 7));
}

function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function currentMonthKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentYearNumber(): number {
  return new Date().getFullYear();
}

function yearFromMonth(month: string): number | null {
  if (!validMonth(month)) return null;
  const year = Number(month.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function normalizedQueryMonth(value: unknown): string {
  const month = queryText(value);
  return validMonth(month) ? month : currentMonthKey();
}

async function replaceMonthRouteWithoutPrompt(month: string) {
  allowNextMonthRouteChange = true;
  try {
    await router.replace({ query: { ...route.query, month } });
  } finally {
    allowNextMonthRouteChange = false;
  }
}

async function confirmDiscardUnsavedChanges(action: string): Promise<boolean> {
  if (!hasUnsavedChanges.value) return true;
  try {
    await ElMessageBox.confirm(
      `${action}将丢弃尚未保存的维护数据，是否继续？`,
      "存在未保存修改",
      {
        type: "warning",
        confirmButtonText: "丢弃并继续",
        cancelButtonText: "继续编辑",
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function confirmDiscardPendingBankReceipts(
  action: string,
): Promise<boolean> {
  if (!bankReceiptPending.value) return true;
  try {
    await ElMessageBox.confirm(
      `${action}将丢弃已经选择但尚未上传的银行回单，是否继续？`,
      "存在未上传银行回单",
      {
        type: "warning",
        confirmButtonText: "丢弃并继续",
        cancelButtonText: "继续上传",
      },
    );
    return true;
  } catch {
    return false;
  }
}

function validateReopenReason(value: string): boolean | string {
  const reason = String(value || "").trim();
  if (!reason) return "请输入重新开启原因";
  if (reason.length > 500) return "重新开启原因不能超过500字";
  return true;
}

function nextClientKey(): string {
  clientKeySequence += 1;
  return `manual-item-${clientKeySequence}`;
}

function isMessageBoxCancel(error: unknown): boolean {
  return error === "cancel" || error === "close";
}
</script>

<style scoped>
.monthly-financial-report {
  --report-border: #dfe7ef;
  --report-text: #172033;
  --report-muted: #64748b;
  color: var(--report-text);
  min-width: 0;
}

.report-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  padding: 26px 28px;
  border: 1px solid var(--report-border);
  border-radius: 18px;
  background:
    radial-gradient(
      circle at 88% 12%,
      rgba(59, 130, 246, 0.12),
      transparent 32%
    ),
    linear-gradient(135deg, #f8fbff 0%, #eef5fb 100%);
  box-shadow: 0 12px 30px rgba(31, 63, 98, 0.08);
}

.hero-copy {
  max-width: 690px;
}

.hero-kicker {
  display: inline-block;
  margin-bottom: 8px;
  color: #2563a8;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.hero-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hero-title-row h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
}

.hero-copy p {
  margin: 12px 0 0;
  color: var(--report-muted);
  line-height: 1.7;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 14px;
  color: #52637a;
  font-size: 13px;
}

.hero-meta span {
  position: relative;
}

.hero-meta span + span::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 6px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #91a2b7;
}

.hero-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 12px;
  width: min(100%, 480px);
}

.hero-actions > * {
  min-width: 0 !important;
  max-width: 100%;
  box-sizing: border-box;
}

.hero-actions :deep(.el-button) {
  width: 100%;
}

.hero-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.close-action-reason {
  display: flex;
  min-width: 0;
  grid-column: 1 / -1;
  align-items: flex-start;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid #f0d7a8;
  border-radius: 8px;
  background: #fff9ec;
  color: #8b641c;
  font-size: 11px;
  line-height: 1.5;
}

.close-action-reason :deep(.el-icon) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.close-action-reason span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.month-picker {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.hero-actions :deep(.el-date-editor.el-input),
.hero-actions :deep(.el-date-editor.el-input__wrapper) {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.page-alert {
  margin-top: 18px;
}

.loading-shell,
.empty-report {
  margin-top: 20px;
  padding: 42px;
  border: 1px solid var(--report-border);
  border-radius: 16px;
  background: #fff;
}

.empty-hint {
  margin: -8px 0 18px;
  color: var(--report-muted);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}

.metric-card {
  position: relative;
  overflow: hidden;
  padding: 18px;
  border: 1px solid var(--report-border);
  border-radius: 14px;
  background: #fff;
}

.metric-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: #64748b;
}

.metric-card--green::before {
  background: #0f9f6e;
}
.metric-card--amber::before {
  background: #d97706;
}
.metric-card--blue::before {
  background: #2563eb;
}
.metric-card--violet::before {
  background: #7c3aed;
}

.metric-card span,
.metric-card small {
  display: block;
  color: var(--report-muted);
}

.metric-card strong {
  display: block;
  margin: 10px 0 8px;
  overflow: hidden;
  color: #172033;
  font-size: clamp(20px, 2vw, 28px);
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-card strong.is-negative,
.account-values dd.is-negative {
  color: #c2413b;
}

.report-tabs {
  margin-top: 20px;
}

.report-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
}

.report-tabs :deep(.el-tabs__item) {
  height: 44px;
  font-size: 15px;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.account-card {
  padding: 20px;
  border: 1px solid var(--report-border);
  border-radius: 15px;
  background: #fff;
}

.account-heading {
  display: flex;
  gap: 12px;
  align-items: center;
}

.account-mark {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #eaf3fc;
  color: #2563a8;
  font-size: 13px;
  font-weight: 800;
}

.account-heading h2,
.card-heading h2 {
  margin: 0;
  font-size: 17px;
}

.account-heading p,
.card-heading p {
  margin: 4px 0 0;
  color: var(--report-muted);
  font-size: 12px;
  line-height: 1.5;
}

.account-detail-toggle {
  flex: none;
  margin-left: auto;
}

.account-values {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 18px 0 0;
}

.account-values div {
  min-width: 0;
  padding: 10px;
  border-radius: 10px;
  background: #f7f9fc;
}

.account-values dt {
  color: var(--report-muted);
  font-size: 12px;
}

.account-values dd {
  margin: 6px 0 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-values .is-income {
  color: #087a55;
}
.account-values .is-expense {
  color: #b45309;
}
.account-values .closing-value {
  background: #edf5ff;
}

.quality-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 18px;
}

.manual-card,
.quality-card {
  border-color: var(--report-border);
  border-radius: 15px;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.table-amount {
  color: #172033;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
}

.manual-heading {
  align-items: flex-start;
}

.manual-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.manual-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.flow-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.account-card-flows {
  margin-top: 16px;
}

.flow-panel {
  overflow: hidden;
  border: 1px solid #e4eaf1;
  border-radius: 12px;
}

.flow-panel header,
.flow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
}

.flow-panel header {
  background: #f7f9fc;
}

.flow-panel--income header {
  color: #087a55;
  background: #edf9f4;
}

.flow-panel--expense header {
  color: #b45309;
  background: #fff7e8;
}

.flow-group + .flow-group {
  border-top: 1px solid #edf1f5;
}

.flow-row strong,
.flow-row small {
  display: block;
}

.flow-row small {
  margin-top: 3px;
  color: var(--report-muted);
  font-size: 12px;
}

.flow-row > span {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.person-detail-list {
  margin: 0 10px 10px;
  border: 1px solid #e5eaf0;
  border-radius: 9px;
  background: #fafcff;
}

.person-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
}

.person-detail-row + .person-detail-row {
  border-top: 1px dashed #dce4ed;
}

.person-detail-row strong,
.person-detail-row small {
  display: block;
}

.person-detail-row small {
  margin-top: 2px;
  color: var(--report-muted);
  font-size: 11px;
}

.person-detail-row > span {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.manual-sheet {
  display: grid;
  gap: 18px;
}

.manual-sheet-section {
  overflow: hidden;
  border: 1px solid var(--report-border);
  border-radius: 12px;
}

.manual-sheet-section > header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #f7fafd;
}

.manual-sheet-section h3,
.manual-sheet-section p {
  margin: 0;
}

.manual-sheet-section p {
  margin-top: 3px;
  color: var(--report-muted);
  font-size: 12px;
}

.manual-sheet-scroll {
  overflow-x: auto;
}

.manual-sheet table {
  width: 100%;
  min-width: 1260px;
  border-collapse: collapse;
  table-layout: fixed;
}

.manual-sheet th,
.manual-sheet td {
  padding: 9px 10px;
  border-top: 1px solid #e5eaf0;
  border-right: 1px solid #e5eaf0;
  text-align: center !important;
  vertical-align: middle;
}

.manual-sheet th:last-child,
.manual-sheet td:last-child {
  border-right: 0;
}

.manual-sheet th {
  color: #52637a;
  background: #f2f5f8;
  font-size: 12px;
  font-weight: 700;
}

.manual-table-header-row .header-rowspan-cell {
  vertical-align: middle !important;
}

.manual-sheet th:nth-child(1) {
  width: 150px;
}
.manual-sheet th:nth-child(2) {
  width: 72px;
}
.manual-sheet th:nth-child(3) {
  width: 110px;
}
.manual-sheet th:nth-child(4) {
  width: 150px;
}
.manual-sheet th:nth-child(5) {
  width: 170px;
}
.manual-sheet th:nth-child(8) {
  width: 130px;
}
.manual-sheet th:nth-child(9) {
  width: 144px;
}

.manual-entry-row:hover td,
.manual-category-row:hover td {
  background: #fbfdff;
}

.category-cell {
  color: #26364d;
  font-weight: 600;
}

.manual-category-row td {
  background: #f8fbfe;
}

.category-entry-count,
.manual-detail-label {
  color: var(--report-muted);
  font-size: 12px;
}

.manual-detail-label {
  padding-left: 10px !important;
}

.category-merged-cell {
  vertical-align: middle !important;
}

.category-total-cell {
  color: #172033;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
}

.manual-line-amount {
  font-weight: 400;
}

.operation-cell {
  padding-right: 12px !important;
  padding-left: 12px !important;
  text-align: center !important;
  white-space: nowrap;
}

.manual-bank-match-tag {
  min-width: 108px;
  justify-content: center;
  white-space: nowrap;
}

.manual-proof-preview {
  display: inline-flex;
  min-width: 88px;
  height: 28px;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid #a8ccf4;
  border-radius: 6px;
  background: #f1f7ff;
  line-height: 26px;
  white-space: nowrap;
}

.manual-proof-preview:hover {
  border-color: #409eff;
  background: #e8f3ff;
  text-decoration: none;
}

.manual-proof-preview :deep(.el-link__inner) {
  white-space: nowrap;
}

.manual-sheet :deep(.el-date-editor.el-input) {
  width: 100%;
}

.manual-sheet :deep(.el-input__inner) {
  text-align: center !important;
}

.manual-sheet :deep(.el-input__wrapper),
.manual-sheet :deep(.el-tag),
.manual-sheet .operation-cell {
  justify-content: center;
}

.source-list {
  display: grid;
  gap: 12px;
}

.source-list article {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 8px 16px;
  align-items: center;
  padding: 14px;
  border: 1px solid #e7edf4;
  border-radius: 12px;
  background: #fafcff;
}

.source-main,
.source-stats {
  display: flex;
  align-items: center;
  gap: 10px;
}

.source-main small {
  display: block;
  margin-top: 3px;
  color: var(--report-muted);
}

.source-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eaf3fc;
  color: #2563a8;
}

.source-stats strong {
  min-width: 100px;
  text-align: right;
}

.source-list time {
  grid-column: 1 / -1;
  color: #8492a6;
  font-size: 12px;
}

.validation-list {
  display: grid;
  gap: 10px;
}

.validation-list article {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
}

.validation-item--blocker {
  background: #fff1f0;
  color: #b42318;
}

.validation-item--warning {
  background: #fff8e8;
  color: #a15c00;
}

.validation-list strong,
.validation-list p {
  margin: 0;
}

.validation-list p {
  margin-top: 3px;
  line-height: 1.5;
}

.report-metadata {
  margin-top: 18px;
}

.form-tip {
  margin-top: 5px;
  color: var(--report-muted);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1380px) {
  .report-hero {
    flex-direction: column;
  }

  .hero-actions {
    width: min(100%, 480px);
  }

  .metric-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1080px) {
  .account-grid,
  .quality-grid {
    grid-template-columns: 1fr;
  }

  .account-values {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .report-hero {
    padding: 20px;
  }

  .hero-title-row h1 {
    font-size: 24px;
  }

  .hero-actions,
  .hero-actions :deep(.el-button) {
    width: 100%;
  }

  .hero-actions {
    grid-template-columns: 1fr;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .account-values {
    grid-template-columns: 1fr 1fr;
  }

  .flow-columns {
    grid-template-columns: 1fr;
  }

  .card-heading,
  .manual-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .manual-actions,
  .manual-actions :deep(.el-button) {
    width: 100%;
  }

  .source-list article {
    grid-template-columns: 1fr;
  }

  .source-stats {
    justify-content: space-between;
  }
}
</style>
