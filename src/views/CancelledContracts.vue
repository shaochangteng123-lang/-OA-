<template>
  <div class="cancelled-contract-page">
    <header class="page-heading">
      <div>
        <span>合同管理</span>
        <h1>已撤销合同</h1>
        <p>仅供管理员追溯查看，不允许恢复、编辑、审批或财务登记。</p>
      </div>
      <el-button @click="router.push('/contracts')">返回合同台账</el-button>
    </header>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      show-icon
      closable
      @close="errorMessage = ''"
    />

    <section v-loading="loading" class="archive-card">
      <el-table :data="items" row-key="id" stripe>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="cancelled-detail">
              <dl>
                <div>
                  <dt>甲方单位</dt>
                  <dd>{{ row.partyA || "—" }}</dd>
                </div>
                <div>
                  <dt>乙方单位</dt>
                  <dd>{{ row.partyB || "—" }}</dd>
                </div>
                <div>
                  <dt>项目名称</dt>
                  <dd>{{ row.projectName || "—" }}</dd>
                </div>
                <div>
                  <dt>合同金额</dt>
                  <dd>{{ formatContractMoney(row.amount) }}</dd>
                </div>
                <div class="cancellation-reason-detail">
                  <dt>撤销原因</dt>
                  <dd>
                    {{ row.cancellationReason || "历史记录未填写撤销原因" }}
                  </dd>
                </div>
              </dl>
              <div class="file-section">
                <strong>保留的合同文件（{{ row.files.length }}）</strong>
                <div v-if="row.files.length" class="file-list">
                  <button
                    v-for="file in row.files"
                    :key="file.id"
                    type="button"
                    class="file-item"
                    @click="previewFile(file.id)"
                  >
                    <Document aria-hidden="true" />
                    <span
                      ><b>{{ file.fileName }}</b
                      ><small
                        >{{ fileTypeLabel(file.fileType) }} ·
                        {{ formatFileSize(file.fileSize) }}</small
                      ></span
                    >
                    <em>在线预览</em>
                  </button>
                </div>
                <el-empty
                  v-else
                  description="该合同没有保留文件"
                  :image-size="64"
                />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="序号" width="72" align="center">
          <template #default="{ $index }">{{
            (page - 1) * pageSize + $index + 1
          }}</template>
        </el-table-column>
        <el-table-column
          label="合同编号"
          prop="contractNo"
          min-width="170"
          align="center"
        />
        <el-table-column
          label="合同名称"
          min-width="280"
          align="center"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{
            row.name || row.projectName
          }}</template>
        </el-table-column>
        <el-table-column label="撤销前状态" width="120" align="center">
          <template #default="{ row }">{{
            statusLabel(row.cancelledFromStatus)
          }}</template>
        </el-table-column>
        <el-table-column label="撤销人" width="140" align="center">
          <template #default="{ row }">{{
            row.cancelledByName || "—"
          }}</template>
        </el-table-column>
        <el-table-column label="撤销时间" width="180" align="center">
          <template #default="{ row }">{{
            formatContractDateTime(row.cancelledAt)
          }}</template>
        </el-table-column>
        <el-table-column
          label="撤销原因"
          min-width="240"
          align="center"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{
            row.cancellationReason || "历史记录未填写"
          }}</template>
        </el-table-column>
        <el-table-column label="文件" width="90" align="center">
          <template #default="{ row }">{{ row.files.length }} 个</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !items.length" description="暂无已撤销合同" />
      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        class="pagination"
        layout="total, prev, pager, next"
        :page-size="pageSize"
        :total="total"
        @current-change="loadItems"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Document } from "@element-plus/icons-vue";
import type { CancelledContractItem, ContractStatus } from "@/types/contract";
import {
  getCancelledContracts,
  getContractErrorMessage,
  getContractFileUrl,
} from "@/utils/contractApi";
import {
  CONTRACT_STATUS_LABELS,
  formatContractDateTime,
  formatContractMoney,
} from "@/utils/contractPresentation";

const router = useRouter();
const items = ref<CancelledContractItem[]>([]);
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const loading = ref(false);
const errorMessage = ref("");

async function loadItems() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await getCancelledContracts({ page: page.value, pageSize });
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    errorMessage.value = getContractErrorMessage(error, "无法获取已撤销合同");
  } finally {
    loading.value = false;
  }
}

function previewFile(fileId: string) {
  const previewWindow = window.open(getContractFileUrl(fileId), "_blank");
  if (!previewWindow) {
    errorMessage.value = "浏览器阻止了新窗口，请允许弹出窗口后重试";
    return;
  }
  previewWindow.opener = null;
}

function fileTypeLabel(type: string): string {
  return (
    (
      {
        draft_contract: "草拟合同",
        seal_application: "用印申请单",
        triplicate: "三联单",
        payment_request: "付款申请",
        invoice: "发票",
        receipt: "回款回单",
        payment: "付款回单",
        termination: "终止材料",
        other: "其他附件",
      } as Record<string, string>
    )[type] || type
  );
}

function statusLabel(status: unknown): string {
  return (
    CONTRACT_STATUS_LABELS[status as ContractStatus] || String(status || "—")
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(loadItems);
</script>

<style scoped>
.cancelled-contract-page {
  min-height: 100%;
  padding: 24px;
  background: #f5f8fa;
}
.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-heading span {
  color: #16867d;
  font-size: 13px;
}
.page-heading h1 {
  margin: 5px 0;
  color: #203b53;
  font-size: 26px;
}
.page-heading p {
  margin: 0;
  color: #7f8e9c;
}
.archive-card {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid #e3eaee;
  border-radius: 14px;
  background: #fff;
}
.cancelled-detail {
  padding: 10px 26px 22px;
}
.cancelled-detail dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 0 0 18px;
}
.cancelled-detail dl div {
  padding: 12px;
  border-radius: 8px;
  background: #f7fafb;
}
.cancelled-detail dt {
  color: #8493a1;
  font-size: 12px;
}
.cancelled-detail dd {
  margin: 5px 0 0;
  color: #294960;
  overflow-wrap: anywhere;
}
.cancelled-detail .cancellation-reason-detail {
  grid-column: 1 / -1;
}
.file-section > strong {
  color: #294960;
}
.file-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.file-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dce7ea;
  border-radius: 9px;
  background: #fff;
  color: #294960;
  text-align: left;
  cursor: pointer;
}
.file-item:hover {
  border-color: #64b9b0;
  background: #f3fbfa;
}
.file-item svg {
  width: 24px;
  color: #16867d;
}
.file-item span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.file-item b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-item small {
  color: #8a98a5;
}
.file-item em {
  color: #16867d;
  font-style: normal;
  white-space: nowrap;
}
.pagination {
  justify-content: flex-end;
  margin-top: 18px;
}
@media (max-width: 768px) {
  .cancelled-contract-page {
    padding: 14px;
  }
  .page-heading {
    gap: 12px;
  }
  .cancelled-detail {
    padding-inline: 8px;
  }
  .cancelled-detail dl {
    grid-template-columns: 1fr;
  }
  .file-item {
    grid-template-columns: 34px minmax(0, 1fr);
  }
  .file-item em {
    grid-column: 2;
  }
}
</style>
