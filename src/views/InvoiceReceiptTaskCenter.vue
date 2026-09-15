<template>
  <div class="invoice-receipt-task-center">
    <header class="task-heading">
      <div>
        <span>开票完成后的票款提醒</span>
        <h2>待上传回单</h2>
        <p>只展示正式发票已足额覆盖开票申请、但有效回单尚未足额匹配的合同。</p>
      </div>
      <div class="pending-total">
        <span>待处理登记</span>
        <strong>{{ total }}</strong>
        <small>笔</small>
      </div>
    </header>

    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="发票与回单独立登记"
      description="先票后款会在此持续提醒；主营收入先款后票且足额匹配时不会进入；部分回款只显示尚未覆盖的金额。"
    />

    <section v-loading="loading" class="task-card">
      <div class="task-toolbar">
        <el-input
          v-model="keyword"
          clearable
          :prefix-icon="Search"
          placeholder="搜索项目、合同编号、甲方、申请号、发票号或金额"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button :icon="Refresh" :loading="loading" @click="loadTasks">
          刷新
        </el-button>
      </div>

      <el-alert
        v-if="errorMessage"
        class="load-error"
        type="error"
        show-icon
        :closable="false"
        :title="errorMessage"
      />

      <div v-if="items.length" class="task-list">
        <article
          v-for="(item, index) in items"
          :key="item.registrationId"
          class="receipt-task"
          :class="agingClass(item.waitingDays)"
        >
          <header class="receipt-task-heading">
            <span class="serial-number">{{ serialNumber(index) }}</span>
            <div>
              <div class="title-line">
                <strong>{{ item.projectName }}</strong>
                <el-tag type="success" effect="plain">开票流程已完成</el-tag>
                <el-tag
                  :type="
                    item.receiptStatus === 'partial' ? 'warning' : 'danger'
                  "
                  effect="light"
                >
                  {{
                    item.receiptStatus === "partial"
                      ? "当前登记部分回款"
                      : "当前登记尚未回款"
                  }}
                </el-tag>
              </div>
              <small>
                {{
                  item.businessContractNo || item.contractNo || "合同编号待归档"
                }}
                · {{ item.area || "区域未设置" }}
              </small>
              <span>甲方：{{ item.partyA || "—" }}</span>
              <span>
                关联 {{ item.applicationCount }} 笔开票申请 ·
                {{ item.invoiceCount }} 张当前登记发票
              </span>
            </div>
            <div class="aging-badge">
              <strong>{{ waitingLabel(item.waitingDays) }}</strong>
              <small
                >最早开票
                {{ formatContractDate(item.earliestInvoiceDate) }}</small
              >
            </div>
          </header>

          <div class="amount-grid">
            <div>
              <span>当前登记开票金额</span>
              <strong>{{ formatContractMoney(item.invoiceAmount) }}</strong>
            </div>
            <div>
              <span>当前登记已匹配回款</span>
              <strong>{{
                formatContractMoney(item.matchedReceiptAmount)
              }}</strong>
            </div>
            <div class="pending-amount">
              <span>待上传回单金额</span>
              <strong>{{
                formatContractMoney(item.pendingReceiptAmount)
              }}</strong>
            </div>
          </div>

          <div class="invoice-list" aria-label="关联发票明细">
            <div class="invoice-list-heading">
              <strong>关联发票明细</strong>
              <span>{{ applicationNumberText(item.applicationNumbers) }}</span>
            </div>
            <div
              v-for="(invoice, invoiceIndex) in item.invoices"
              :key="invoice.id"
              class="invoice-row"
            >
              <span>{{ invoiceIndex + 1 }}</span>
              <div>
                <strong>{{ invoice.invoiceNo || "发票号码待识别" }}</strong>
                <small>
                  {{ formatContractDate(invoice.invoiceDate) }} ·
                  {{ invoice.itemName || "开票名称未记录" }}
                </small>
              </div>
              <div>
                <span>对应申请</span>
                <strong>{{
                  formatContractMoney(invoice.applicationAmount)
                }}</strong>
              </div>
              <div>
                <span>待回款</span>
                <strong>{{
                  formatContractMoney(invoice.pendingReceiptAmount)
                }}</strong>
              </div>
            </div>
          </div>

          <footer>
            <span>
              系统将打开本合同现有的未闭合财务登记，不会新建重复登记。
            </span>
            <el-button type="primary" @click="openReceiptRegistration(item)">
              前往本合同财务登记上传回单
            </el-button>
          </footer>
        </article>
      </div>

      <el-empty
        v-else-if="!loading && !errorMessage"
        description="当前没有待上传回单的合同"
        :image-size="100"
      />

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        class="pagination"
        :page-size="pageSize"
        layout="total, prev, pager, next"
        :total="total"
        @current-change="loadTasks"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Refresh, Search } from "@element-plus/icons-vue";
import type { InvoiceReceiptTask } from "@/types/invoiceApplication";
import {
  getInvoiceApplicationErrorMessage,
  getInvoiceReceiptTasks,
} from "@/utils/invoiceApplicationApi";
import {
  formatContractDate,
  formatContractMoney,
} from "@/utils/contractPresentation";

const router = useRouter();
const items = ref<InvoiceReceiptTask[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const keyword = ref("");
const loading = ref(false);
const errorMessage = ref("");
let loadSequence = 0;

function serialNumber(index: number): number {
  return (page.value - 1) * pageSize + index + 1;
}

function waitingLabel(waitingDays: number): string {
  if (waitingDays <= 0) return "今天开票";
  return `已等待 ${waitingDays} 天`;
}

function agingClass(waitingDays: number): string {
  if (waitingDays >= 60) return "is-overdue";
  if (waitingDays >= 30) return "is-aging";
  return "";
}

function applicationNumberText(numbers: string[]): string {
  if (!numbers.length) return "申请编号未记录";
  return `申请：${numbers.join("、")}`;
}

async function loadTasks() {
  const currentSequence = ++loadSequence;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await getInvoiceReceiptTasks({
      page: page.value,
      pageSize,
      keyword: keyword.value.trim() || undefined,
    });
    if (currentSequence !== loadSequence) return;
    const maximumPage = Math.max(1, Math.ceil(result.total / pageSize));
    if (page.value > maximumPage) {
      page.value = maximumPage;
      await loadTasks();
      return;
    }
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    if (currentSequence !== loadSequence) return;
    errorMessage.value = getInvoiceApplicationErrorMessage(
      error,
      "无法读取待上传回单，请稍后重试",
    );
  } finally {
    if (currentSequence === loadSequence) loading.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  void loadTasks();
}

function openReceiptRegistration(item: InvoiceReceiptTask) {
  void router.push({
    path: `/contracts/${item.contractId}`,
    query: {
      tab: "finance",
      action: "record",
      recordType: "receipt",
      registrationId: item.registrationId,
      from: "contract-tasks",
      fromTab: "receipt",
      returnTo: "/contract-tasks?tab=receipt",
    },
  });
}

onMounted(() => {
  void loadTasks();
  window.addEventListener("focus", loadTasks);
});

onBeforeUnmount(() => {
  loadSequence += 1;
  window.removeEventListener("focus", loadTasks);
});
</script>

<style scoped>
.invoice-receipt-task-center {
  display: grid;
  gap: 16px;
  padding: 0 24px 32px;
  color: #17324d;
}

.task-heading,
.receipt-task-heading,
.task-toolbar,
.invoice-list-heading,
.receipt-task footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.task-heading > div:first-child {
  min-width: 0;
}

.task-heading span,
.task-heading p,
.receipt-task-heading small,
.receipt-task-heading span,
.receipt-task footer span,
.invoice-list-heading span,
.invoice-row small,
.invoice-row > div > span {
  color: #728197;
}

.task-heading h2 {
  margin: 4px 0;
  font-size: 24px;
}

.task-heading p {
  margin: 0;
}

.pending-total {
  display: grid;
  min-width: 112px;
  grid-template-columns: auto auto;
  align-items: end;
  padding: 12px 16px;
  border: 1px solid #dce8f2;
  border-radius: 12px;
  background: #fff;
  text-align: right;
}

.pending-total span {
  grid-column: 1 / -1;
  font-size: 12px;
}

.pending-total strong {
  color: #d35a54;
  font-size: 28px;
}

.pending-total small {
  margin: 0 0 5px 4px;
}

.task-card {
  min-height: 260px;
  padding: 18px;
  border: 1px solid #dfe8f0;
  border-radius: 14px;
  background: #fff;
}

.task-toolbar .el-input {
  max-width: 620px;
}

.load-error {
  margin-top: 14px;
}

.task-list {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.receipt-task {
  padding: 18px;
  border: 1px solid #dfe7ef;
  border-left: 4px solid #739bbd;
  border-radius: 12px;
  background: #fbfdff;
}

.receipt-task.is-aging {
  border-left-color: #d99a45;
}

.receipt-task.is-overdue {
  border-left-color: #d35a54;
}

.receipt-task-heading {
  align-items: flex-start;
}

.receipt-task-heading > div:nth-child(2) {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 5px;
}

.title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.title-line > strong {
  min-width: 180px;
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 17px;
}

.serial-number {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8f1f8;
  color: #32698f !important;
  font-weight: 700;
}

.aging-badge {
  display: grid;
  flex: 0 0 auto;
  gap: 4px;
  text-align: right;
}

.is-aging .aging-badge strong {
  color: #b97824;
}

.is-overdue .aging-badge strong {
  color: #c74742;
}

.amount-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.amount-grid > div {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f1f6fa;
}

.amount-grid span {
  color: #718096;
  font-size: 12px;
}

.amount-grid strong {
  font-size: 18px;
}

.amount-grid .pending-amount {
  background: #fff1ef;
  color: #c74742;
}

.invoice-list {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid #e1e8ef;
  border-radius: 10px;
}

.invoice-list-heading,
.invoice-row {
  padding: 10px 12px;
}

.invoice-list-heading {
  background: #f5f8fb;
}

.invoice-row {
  display: grid;
  grid-template-columns: 32px minmax(220px, 1fr) 150px 150px;
  align-items: center;
  gap: 12px;
  border-top: 1px solid #e8edf2;
}

.invoice-row > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.invoice-row strong,
.invoice-row small {
  overflow-wrap: anywhere;
}

.receipt-task footer {
  align-items: flex-end;
  margin-top: 16px;
}

.receipt-task footer span {
  font-size: 12px;
}

.pagination {
  justify-content: flex-end;
  margin-top: 18px;
}

@media (max-width: 800px) {
  .invoice-receipt-task-center {
    padding: 0 12px 24px;
  }

  .task-heading,
  .receipt-task-heading,
  .receipt-task footer {
    align-items: stretch;
    flex-direction: column;
  }

  .pending-total {
    align-self: flex-start;
  }

  .aging-badge {
    text-align: left;
  }

  .amount-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pending-amount {
    grid-column: 1 / -1;
  }

  .invoice-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .invoice-row > div:nth-child(n + 3) {
    grid-column: 2;
  }

  .receipt-task footer .el-button {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .task-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-toolbar .el-input {
    max-width: none;
  }

  .amount-grid {
    grid-template-columns: 1fr;
  }

  .pending-amount {
    grid-column: auto;
  }

  .receipt-task {
    padding: 14px;
  }
}
</style>
