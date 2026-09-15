<template>
  <div class="admin-contract-tasks">
    <el-tabs
      :model-value="activeTab"
      class="task-tabs"
      @tab-change="handleTabChange"
    >
      <el-tab-pane v-if="isDownloadExecutor" name="download">
        <template #label>
          <span class="task-tab-label">
            合同下载待办
            <el-badge
              v-if="downloadPendingCount > 0"
              :value="downloadPendingCount"
              :max="99"
              type="danger"
            />
          </span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="invoice">
        <template #label>
          <span class="task-tab-label">
            开票与用印待办
            <el-badge
              v-if="invoicePendingCount > 0"
              :value="invoicePendingCount"
              :max="99"
              type="danger"
            />
          </span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="receipt">
        <template #label>
          <span class="task-tab-label">
            待上传回单
            <el-badge
              v-if="receiptPendingCount > 0"
              :value="receiptPendingCount"
              :max="99"
              type="danger"
            />
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <main class="task-content">
      <ContractDownloadRequestCenter
        v-if="isDownloadExecutor && activeTab === 'download'"
        embedded
        center-mode="admin"
      />
      <InvoiceApplicationCenter
        v-else-if="activeTab === 'invoice'"
        embedded
        center-mode="admin"
      />
      <InvoiceReceiptTaskCenter v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ContractDownloadRequestCenter from "@/views/ContractDownloadRequestCenter.vue";
import InvoiceApplicationCenter from "@/views/InvoiceApplicationCenter.vue";
import InvoiceReceiptTaskCenter from "@/views/InvoiceReceiptTaskCenter.vue";
import { useAuthStore } from "@/stores/auth";
import {
  CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT,
  getContractDownloadPendingCounts,
} from "@/utils/contractDownloadApi";
import { getInvoiceApplicationPendingCounts } from "@/utils/invoiceApplicationApi";

type TaskTab = "download" | "invoice" | "receipt";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const isDownloadExecutor = computed(
  () =>
    authStore.user?.role === "admin" || authStore.user?.role === "super_admin",
);
const downloadPendingCount = ref(0);
const invoicePendingCount = ref(0);
const receiptPendingCount = ref(0);
const activeTab = computed<TaskTab>(() => {
  if (route.query.tab === "receipt") return "receipt";
  if (route.query.tab === "invoice") return "invoice";
  return isDownloadExecutor.value ? "download" : "invoice";
});

function selectTab(tab: TaskTab) {
  if (tab === activeTab.value) return;
  void router.replace({
    path: "/contract-tasks",
    query: {
      ...route.query,
      tab,
      result: undefined,
      view: tab === "invoice" ? route.query.view : undefined,
    },
  });
}

function handleTabChange(tab: string | number) {
  if (tab === "download" || tab === "invoice" || tab === "receipt") {
    selectTab(tab);
  }
}

async function refreshTaskCounts() {
  const tasks: Promise<void>[] = [
    getInvoiceApplicationPendingCounts()
      .then((counts) => {
        invoicePendingCount.value = counts.pendingSeal + counts.pendingInvoice;
        receiptPendingCount.value = counts.pendingReceipt;
      })
      .catch(() => undefined),
  ];
  if (isDownloadExecutor.value) {
    tasks.push(
      getContractDownloadPendingCounts()
        .then((counts) => {
          downloadPendingCount.value = counts.executorPending;
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
}

onMounted(() => {
  void refreshTaskCounts();
  window.addEventListener(
    CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT,
    refreshTaskCounts,
  );
  window.addEventListener("focus", refreshTaskCounts);
});

onBeforeUnmount(() => {
  window.removeEventListener(
    CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT,
    refreshTaskCounts,
  );
  window.removeEventListener("focus", refreshTaskCounts);
});
</script>

<style scoped>
.admin-contract-tasks {
  min-height: 100%;
  color: #17324d;
  background: #f4f8fb;
}
.task-tabs {
  padding: 0 18px;
  background: #fff;
}
.task-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.task-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #dfe5ec;
}
.task-tabs :deep(.el-tabs__item) {
  height: 54px;
  padding: 0 20px;
  color: #1f2937;
  font-size: 16px;
  font-weight: 600;
}
.task-tabs :deep(.el-tabs__item.is-active) {
  color: #409eff;
}
.task-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.task-tab-label :deep(.el-badge__content) {
  border: 0;
  box-shadow: 0 0 0 2px #fff;
}
.task-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  background: #409eff;
  transition:
    width 0.3s cubic-bezier(0.645, 0.045, 0.355, 1),
    transform 0.3s cubic-bezier(0.645, 0.045, 0.355, 1);
}
.task-tabs :deep(.el-tabs__content) {
  display: none;
}
.task-content {
  padding-top: 16px;
}
@media (max-width: 640px) {
  .task-tabs {
    padding: 0 10px;
  }

  .task-tabs :deep(.el-tabs__nav-scroll) {
    overflow-x: auto;
  }

  .task-tabs :deep(.el-tabs__nav) {
    float: none;
    width: max-content;
  }
}
</style>
