<template>
  <div class="my-contract-applications">
    <el-tabs
      :model-value="activeTab"
      class="application-tabs"
      @tab-change="handleTabChange"
    >
      <el-tab-pane label="合同下载申请" name="download" />
      <el-tab-pane label="开票及用印申请" name="invoice" />
    </el-tabs>

    <main class="application-content">
      <ContractDownloadRequestCenter v-if="activeTab === 'download'" embedded />
      <InvoiceApplicationCenter v-else embedded />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ContractDownloadRequestCenter from "@/views/ContractDownloadRequestCenter.vue";
import InvoiceApplicationCenter from "@/views/InvoiceApplicationCenter.vue";

type ApplicationTab = "download" | "invoice";

const route = useRoute();
const router = useRouter();
const activeTab = computed<ApplicationTab>(() =>
  route.query.tab === "invoice" ? "invoice" : "download",
);

function selectTab(tab: ApplicationTab) {
  if (tab === activeTab.value) return;
  void router.replace({
    path: "/contract-applications/mine",
    query: { ...route.query, tab },
  });
}

function handleTabChange(tab: string | number) {
  if (tab === "download" || tab === "invoice") selectTab(tab);
}
</script>

<style scoped>
.my-contract-applications {
  min-height: 100%;
  color: #17324d;
  background: #f4f8fb;
}
.application-tabs {
  padding: 0 18px;
  background: #fff;
}
.application-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.application-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #dfe5ec;
}
.application-tabs :deep(.el-tabs__item) {
  height: 54px;
  padding: 0 20px;
  color: #1f2937;
  font-size: 16px;
  font-weight: 600;
}
.application-tabs :deep(.el-tabs__item.is-active) {
  color: #409eff;
}
.application-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  background: #409eff;
  transition:
    width 0.3s cubic-bezier(0.645, 0.045, 0.355, 1),
    transform 0.3s cubic-bezier(0.645, 0.045, 0.355, 1);
}
.application-tabs :deep(.el-tabs__content) {
  display: none;
}
.application-content {
  padding-top: 16px;
}
@media (max-width: 640px) {
  .application-tabs {
    padding: 0 10px;
  }
}
</style>
