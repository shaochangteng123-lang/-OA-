<template>
  <div class="contract-approval-page">
    <header v-if="!managerSealApprovalActive" class="approval-hero">
      <div>
        <span class="hero-kicker"><i></i>合同审批工作台</span>
        <h1>合同审批</h1>
        <p>
          系统只展示提交时已锁定给当前账号的合同审批，不随项目负责人后续变更而改派。
        </p>
      </div>
      <div class="hero-actions">
        <div class="pending-total">
          <span>{{ activeTab === "pending" ? "待审批" : "已处理" }}</span
          ><strong>{{ total }}</strong
          ><small>条记录</small>
        </div>
        <el-button
          :icon="Refresh"
          :loading="loading"
          @click="loadActiveContracts()"
          >刷新</el-button
        >
      </div>
    </header>

    <el-alert
      v-if="errorMessage && !managerSealApprovalActive"
      class="role-alert"
      type="error"
      show-icon
      :closable="false"
      :title="errorMessage"
    >
      <template #default
        ><el-button type="danger" link @click="loadActiveContracts()"
          >重新加载</el-button
        ></template
      >
    </el-alert>

    <section
      v-if="!approvalWorkspaceVisible"
      v-loading="loading"
      class="approval-card"
      :aria-busy="loading"
    >
      <el-tabs
        v-model="activeTab"
        class="approval-tabs"
        @tab-change="handleTabChange"
      >
        <el-tab-pane label="待我审批" name="pending" />
        <el-tab-pane label="我已处理" name="processed" />
      </el-tabs>
      <div class="card-heading">
        <div>
          <h2>{{ listTitle }}</h2>
          <span>{{ listDescription }}</span>
        </div>
        <el-input
          v-model="keyword"
          class="search-input"
          clearable
          :prefix-icon="Search"
          placeholder="搜索合同、项目或甲方"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
      </div>

      <div
        v-if="activeTab === 'pending' && pendingItems.length"
        class="approval-list"
      >
        <article
          v-for="(item, index) in pendingItems"
          :key="item.id"
          class="approval-item"
        >
          <span
            class="approval-serial"
            :aria-label="`序号 ${approvalListIndex(index)}`"
          >
            {{ approvalListIndex(index) }}
          </span>
          <button
            class="contract-summary"
            type="button"
            @click="openContractDetail(item.id)"
          >
            <span class="category-mark"
              ><el-icon><DocumentChecked /></el-icon
            ></span>
            <span class="summary-copy">
              <span class="summary-title">
                <strong>{{ item.name || item.projectName }}</strong>
                <el-tag
                  v-if="item.relationType === 'supplement'"
                  type="warning"
                  size="small"
                  effect="dark"
                >
                  补充协议审批
                </el-tag>
                <ContractStatusTag :status="item.status" size="small" />
                <el-tag
                  v-if="requiresManagerSignature(item)"
                  type="warning"
                  size="small"
                  effect="light"
                >
                  需本人签名
                </el-tag>
              </span>
              <small
                >{{
                  item.category
                    ? CONTRACT_CATEGORY_LABELS[item.category]
                    : "待识别"
                }}
                · {{ CONTRACT_RELATION_LABELS[item.relationType] }} ·
                {{ pendingActionLabel(item) }} ·
                {{ approvalRoleLabel(item) }}</small
              >
              <span class="parties"
                >{{ item.partyA || "甲方待完善" }} <b>→</b>
                {{ item.partyB || "乙方待完善" }}</span
              >
              <span
                v-if="item.relationType === 'supplement'"
                class="parent-contract-line"
              >
                所属主合同：{{ item.parentContractName || "主合同" }}
              </span>
            </span>
          </button>
          <div
            class="amount-block"
            :class="{
              'supplement-amount-block': item.relationType === 'supplement',
            }"
          >
            <template v-if="item.relationType === 'supplement'">
              <span>{{ supplementChangeTypeLabel(item) }}</span>
              <strong>{{ formatSupplementAfterAmount(item) }}</strong>
              <small
                >变更前
                {{ formatContractMoney(item.amountBeforeChange, "—") }}</small
              >
              <small
                >{{ adjustmentLabel(item) }}
                {{ formatContractMoney(supplementAmountDelta(item)) }}</small
              >
            </template>
            <template v-else>
              <span>本次审批金额</span
              ><strong>{{ formatContractMoney(approvalAmount(item)) }}</strong
              ><small>{{ item.projectName || "未关联项目" }}</small>
            </template>
          </div>
          <div class="item-actions">
            <el-button @click="openContractDetail(item.id)">查看详情</el-button>
            <template v-if="canApproveItem(item)">
              <el-button
                type="danger"
                plain
                @click="openApproval(item, 'reject')"
                >{{ approvalButtonLabel(item, "reject") }}</el-button
              >
              <el-button
                type="success"
                @click="openApproval(item, 'approve')"
                >{{ approvalButtonLabel(item, "approve") }}</el-button
              >
            </template>
          </div>
        </article>
      </div>

      <div
        v-else-if="activeTab === 'processed' && processedItems.length"
        class="approval-list"
      >
        <article
          v-for="(item, index) in processedItems"
          :key="item.approvalRecordId"
          class="approval-item processed-item"
        >
          <span
            class="approval-serial processed"
            :aria-label="`序号 ${approvalListIndex(index)}`"
          >
            {{ approvalListIndex(index) }}
          </span>
          <button
            class="contract-summary"
            type="button"
            @click="openContractDetail(item.id)"
          >
            <span class="category-mark processed"
              ><el-icon><DocumentChecked /></el-icon
            ></span>
            <span class="summary-copy">
              <span class="summary-title">
                <strong>{{ item.name || item.projectName }}</strong>
                <el-tag
                  v-if="item.relationType === 'supplement'"
                  type="warning"
                  size="small"
                  effect="dark"
                >
                  补充协议
                </el-tag>
                <el-tag
                  :type="
                    item.approvalAction === 'approve' ? 'success' : 'danger'
                  "
                  size="small"
                  effect="light"
                >
                  {{ item.approvalAction === "approve" ? "已通过" : "已驳回" }}
                </el-tag>
              </span>
              <small
                >{{
                  item.category
                    ? CONTRACT_CATEGORY_LABELS[item.category]
                    : "待识别"
                }}
                · {{ CONTRACT_RELATION_LABELS[item.relationType] }} ·
                {{ formatContractDateTime(item.processedAt) }}</small
              >
              <span class="parties"
                >{{ item.partyA || "甲方待完善" }} <b>→</b>
                {{ item.partyB || "乙方待完善" }}</span
              >
              <span class="processed-status-transition">
                处理前状态：{{
                  item.approvalFromStatus
                    ? CONTRACT_STATUS_LABELS[item.approvalFromStatus]
                    : "—"
                }}
                <b>→</b>
                处理后状态：{{
                  item.approvalToStatus
                    ? CONTRACT_STATUS_LABELS[item.approvalToStatus]
                    : "—"
                }}
              </span>
              <span
                v-if="item.relationType === 'supplement'"
                class="parent-contract-line"
              >
                所属主合同：{{ item.parentContractName || "主合同" }}
              </span>
              <span v-if="item.approvalComment" class="processed-comment"
                >审批意见：{{ item.approvalComment }}</span
              >
            </span>
          </button>
          <div
            class="amount-block"
            :class="{
              'supplement-amount-block': item.relationType === 'supplement',
            }"
          >
            <template v-if="item.relationType === 'supplement'">
              <span>{{ supplementChangeTypeLabel(item) }}</span>
              <strong>{{ formatSupplementAfterAmount(item) }}</strong>
              <small
                >变更前
                {{ formatContractMoney(item.amountBeforeChange, "—") }}</small
              >
              <small
                >{{ adjustmentLabel(item) }}
                {{ formatContractMoney(supplementAmountDelta(item)) }}</small
              >
            </template>
            <template v-else>
              <span>合同 / 协议金额</span
              ><strong>{{ formatContractMoney(item.amount) }}</strong
              ><small>{{ item.projectName || "未关联项目" }}</small>
            </template>
          </div>
          <div class="item-actions">
            <el-button @click="openContractDetail(item.id)">查看详情</el-button>
          </div>
        </article>
      </div>

      <el-empty
        v-else-if="!loading && !errorMessage"
        :description="emptyDescription"
        :image-size="100"
      >
        <el-button
          v-if="canReadContractLedger"
          @click="router.push('/contracts')"
          >查看合同台账</el-button
        >
      </el-empty>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        class="pagination"
        layout="total, prev, pager, next"
        :page-size="pageSize"
        :total="total"
        @current-change="handlePageChange"
      />
    </section>

    <section v-else ref="approvalWorkspaceRef" class="approval-workspace-host">
      <ContractApprovalWorkspace
        v-if="selectedContract"
        :key="`${selectedContract.id}:${approvalAction}:${approvalWorkspaceSession}`"
        :contract="selectedContract"
        :initial-action="approvalAction"
        close-label="返回审批列表"
        @close="closeApprovalWorkspace"
        @completed="handleApprovalCompleted"
      />
    </section>

    <span class="sr-live" aria-live="polite">{{ liveStatus }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DocumentChecked, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import ContractApprovalWorkspace from "@/components/contracts/ContractApprovalWorkspace.vue";
import ContractStatusTag from "@/components/contracts/ContractStatusTag.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractApprovalAction,
  ContractListItem,
  ContractProcessedApprovalItem,
} from "@/types/contract";
import {
  getContractErrorMessage,
  getPendingContractApprovals,
  getProcessedContractApprovals,
} from "@/utils/contractApi";
import {
  CONTRACT_CATEGORY_LABELS,
  CONTRACT_RELATION_LABELS,
  CONTRACT_STATUS_LABELS,
  formatContractDateTime,
  formatContractMoney,
} from "@/utils/contractPresentation";
import { requestContractDownloadBadgeRefresh } from "@/utils/contractDownloadApi";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const contractLedgerRoles = new Set([
  "super_admin",
  "chairman",
  "admin",
  "general_manager",
  "boss",
]);
const canReadContractLedger = computed(() =>
  contractLedgerRoles.has(authStore.user?.role || ""),
);
const activeTab = ref<"pending" | "processed">(
  route.query.tab === "processed" ? "processed" : "pending",
);
const pendingItems = ref<ContractListItem[]>([]);
const processedItems = ref<ContractProcessedApprovalItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const keyword = ref("");

function approvalListIndex(index: number): number {
  return (page.value - 1) * pageSize + index + 1;
}
const loading = ref(false);
const errorMessage = ref("");
const liveStatus = ref("");
const approvalWorkspaceVisible = ref(false);
const approvalWorkspaceRef = ref<HTMLElement | null>(null);
const approvalAction = ref<ContractApprovalAction>("approve");
const selectedContract = ref<ContractListItem | null>(null);
const approvalWorkspaceSession = ref(0);
const managerSealApprovalActive = computed(() => {
  const contract = selectedContract.value;
  return Boolean(
    approvalWorkspaceVisible.value &&
    approvalAction.value === "approve" &&
    contract?.approvalTargetSource === "general_manager" &&
    contract.pendingAction !== "termination" &&
    !isSealDifferenceReview(contract),
  );
});
const listTitle = computed(() =>
  activeTab.value === "pending" ? "待我审批" : "我的审批处理记录",
);
const listDescription = computed(() =>
  activeTab.value === "pending"
    ? "按提交时间升序排列，最早提交优先"
    : "按处理时间倒序排列",
);
const emptyDescription = computed(() =>
  activeTab.value === "pending" ? "当前没有待审批合同" : "当前没有已处理审批",
);

function pendingActionLabel(item: ContractListItem): string {
  if (item.pendingAction === "termination") return "终止审批";
  return isSealDifferenceReview(item) ? "盖章差异复审" : "用印审批";
}

function approvalRoleLabel(_item: ContractListItem): string {
  return "总经理审批";
}

function canApproveItem(item: ContractListItem): boolean {
  return Boolean(
    authStore.user?.id && item.approvalTargetId === authStore.user.id,
  );
}

function openContractDetail(contractId: string) {
  void router.push({
    path: `/contracts/${contractId}`,
    query: {
      from: "contract-approvals",
      fromTab: activeTab.value,
      tab: "overview",
    },
  });
}

function isSealDifferenceReview(item: ContractListItem): boolean {
  return (
    item.pendingAction === "seal" && item.previousStatus === "pending_seal"
  );
}

function requiresManagerSignature(item: ContractListItem): boolean {
  return (
    item.approvalTargetSource === "general_manager" &&
    item.pendingAction !== "termination" &&
    !isSealDifferenceReview(item)
  );
}

function approvalButtonLabel(
  item: ContractListItem,
  action: ContractApprovalAction,
): string {
  if (item.pendingAction === "termination") {
    return action === "approve" ? "同意终止" : "驳回终止";
  }
  if (isSealDifferenceReview(item)) {
    return action === "approve" ? "同意差异" : "驳回差异";
  }
  if (action === "approve" && requiresManagerSignature(item)) {
    return "审批并签名";
  }
  return action === "approve" ? "通过" : "驳回";
}

function approvalAmount(item: ContractListItem): string | number {
  if (item.pendingAction === "termination" && item.relationType === "main") {
    return item.currentAmount ?? item.amount;
  }
  return item.amount;
}

function supplementChangeTypeLabel(item: ContractListItem): string {
  if (item.supplementChangeType === "payment_terms_only") {
    return "仅变更付款方式";
  }
  return "变更后合同金额（回款口径）";
}

function supplementAmountDelta(item: ContractListItem): string | number {
  return item.supplementChangeType === "payment_terms_only" ? 0 : item.amount;
}

function formatSupplementAfterAmount(item: ContractListItem): string {
  return formatContractMoney(
    item.amountAfterChange ??
      item.currentEffectiveAmount ??
      item.amountBeforeChange,
    "—",
  );
}

function adjustmentLabel(item: ContractListItem): string {
  if (item.supplementChangeType === "payment_terms_only") return "本次增减";
  return Number(item.amount || 0) < 0 ? "本次核减" : "本次增加";
}

let loadSequence = 0;

async function loadActiveContracts(allowPageFallback = true) {
  const requestedTab = activeTab.value;
  const requestedPage = page.value;
  const currentLoadSequence = ++loadSequence;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result =
      requestedTab === "pending"
        ? await getPendingContractApprovals({
            page: requestedPage,
            pageSize,
            keyword: keyword.value.trim() || undefined,
          })
        : await getProcessedContractApprovals({
            page: requestedPage,
            pageSize,
            keyword: keyword.value.trim() || undefined,
          });
    if (
      currentLoadSequence !== loadSequence ||
      requestedTab !== activeTab.value
    ) {
      return;
    }
    if (
      allowPageFallback &&
      requestedPage > 1 &&
      result.total > 0 &&
      result.items.length === 0
    ) {
      page.value = requestedPage - 1;
      ElMessage.warning("当前页已无数据，已回退到上一页");
      await loadActiveContracts(false);
      return;
    }
    if (requestedTab === "pending") {
      pendingItems.value = result.items as ContractListItem[];
    } else {
      processedItems.value = result.items as ContractProcessedApprovalItem[];
    }
    total.value = result.total;
    liveStatus.value = `已加载 ${result.items.length} 条${requestedTab === "pending" ? "待审批" : "已处理"}记录`;
  } catch (error) {
    if (
      currentLoadSequence !== loadSequence ||
      requestedTab !== activeTab.value
    ) {
      return;
    }
    if (allowPageFallback && requestedPage > 1) {
      page.value = requestedPage - 1;
      ElMessage.warning("当前页加载失败，已回退到上一页重试");
      await loadActiveContracts(false);
      return;
    }
    errorMessage.value = getContractErrorMessage(
      error,
      requestedTab === "pending" ? "待审批合同加载失败" : "已处理审批加载失败",
    );
    liveStatus.value = errorMessage.value;
  } finally {
    if (currentLoadSequence === loadSequence) loading.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  void loadActiveContracts();
}

function handleTabChange() {
  closeApprovalWorkspace();
  page.value = 1;
  errorMessage.value = "";
  void loadActiveContracts();
}

function handlePageChange() {
  void loadActiveContracts();
}

function resetApprovalWorkspaceState() {
  approvalWorkspaceSession.value += 1;
  selectedContract.value = null;
}

function resetAndHideApprovalWorkspace() {
  approvalWorkspaceVisible.value = false;
  resetApprovalWorkspaceState();
}

function closeApprovalWorkspace() {
  resetAndHideApprovalWorkspace();
}

function openApproval(item: ContractListItem, action: ContractApprovalAction) {
  if (!canApproveItem(item)) return;
  resetApprovalWorkspaceState();
  selectedContract.value = item;
  approvalAction.value = action;
  approvalWorkspaceVisible.value = true;
  void nextTick(() => {
    approvalWorkspaceRef.value?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

async function handleApprovalCompleted(payload: { keepOpen: boolean }) {
  if (!payload.keepOpen) {
    resetAndHideApprovalWorkspace();
  }
  requestContractDownloadBadgeRefresh();
  await loadActiveContracts();
}

onMounted(loadActiveContracts);
onBeforeUnmount(() => {
  approvalWorkspaceVisible.value = false;
  resetApprovalWorkspaceState();
});
</script>

<style scoped>
.contract-approval-page {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px 32px 48px;
  background:
    radial-gradient(circle at 6% 2%, rgb(41 109 151 / 8%), transparent 24%),
    #f5f7fa;
  color: #1d354b;
}
.approval-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 25px 28px;
  border: 1px solid #dfe7ee;
  border-radius: 18px;
  background:
    radial-gradient(circle at 92% 0, rgb(59 184 164 / 14%), transparent 34%),
    #fff;
  box-shadow: 0 14px 36px rgb(31 55 78 / 7%);
}
.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #258279;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.hero-kicker i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5ed8c1;
  box-shadow: 0 0 0 5px rgb(94 216 193 / 12%);
}
.approval-hero h1 {
  margin: 5px 0;
  color: #19364f;
  font-size: 30px;
}
.approval-hero p {
  margin: 0;
  color: #718190;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pending-total {
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: baseline;
  gap: 6px;
  padding: 10px 14px;
  border: 1px solid #dce9e6;
  border-radius: 11px;
  background: #f0f8f6;
  color: #71878a;
}
.pending-total strong {
  color: #167a79;
  font-size: 25px;
}
.pending-total small,
.pending-total span {
  font-size: 11px;
}
.role-alert {
  margin-top: 14px;
  border-radius: 10px;
}
.approval-card {
  min-height: 300px;
  margin-top: 14px;
  padding: 19px;
  border: 1px solid #e0e7ed;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 10px 30px rgb(31 49 68 / 5%);
}
.approval-tabs {
  margin: -5px 0 14px;
}
.approval-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.card-heading > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.card-heading h2 {
  margin: 0;
  color: #294a64;
  font-size: 18px;
}
.card-heading span {
  color: #8d99a4;
  font-size: 11px;
}
.search-input {
  width: min(320px, 100%);
}
.search-input :deep(.el-input__wrapper) {
  min-height: 38px;
  border-radius: 9px;
}
.approval-list {
  display: grid;
  gap: 10px;
}
.approval-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(190px, 0.34fr) auto;
  align-items: center;
  gap: 18px;
  padding: 15px;
  border: 1px solid #e3e9ee;
  border-radius: 12px;
  background: #fbfcfd;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.approval-serial {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  color: #087d76;
  background: #e7f5f2;
  font-size: 13px;
  font-weight: 700;
}
.approval-serial.processed {
  color: #54758e;
  background: #eaf0f6;
}
.approval-item:hover {
  border-color: #add0cc;
  box-shadow: 0 8px 22px rgb(32 103 108 / 7%);
}
.contract-summary {
  display: grid;
  min-width: 0;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.category-mark {
  display: inline-flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #e4f2ef;
  color: #247e7d;
  font-size: 21px;
}
.category-mark.processed {
  background: #eaf0f6;
  color: #54758e;
}
.summary-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.summary-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}
.summary-title strong {
  overflow: hidden;
  color: #294861;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-copy small {
  color: #8795a1;
}
.parties {
  overflow: hidden;
  color: #667a89;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parties b {
  margin: 0 5px;
  color: #3f9b91;
}
.parent-contract-line {
  overflow: hidden;
  color: #9a6a20;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.processed-comment {
  overflow: hidden;
  color: #657989;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.processed-status-transition {
  overflow: hidden;
  color: #527879;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.processed-status-transition b {
  margin: 0 5px;
  color: #3f9b91;
}
.amount-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.amount-block span,
.amount-block small {
  max-width: 100%;
  overflow: hidden;
  color: #8996a1;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amount-block strong {
  color: #177b80;
  font-size: 18px;
}
.supplement-amount-block {
  padding: 9px 11px;
  border: 1px solid #f0d5a7;
  border-radius: 10px;
  background: #fffaf0;
}
.supplement-amount-block strong {
  color: #a86116;
}
.item-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}
.item-actions :deep(.el-button) {
  margin: 0;
  border-radius: 8px;
}
.pagination {
  justify-content: flex-end;
  margin-top: 18px;
}
.approval-workspace-host {
  scroll-margin-top: 16px;
}
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 1100px) {
  .approval-item {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .amount-block {
    display: none;
  }
}
@media (max-width: 768px) {
  .contract-approval-page {
    margin: -16px -20px;
    padding: 14px;
  }
  .approval-hero,
  .card-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .hero-actions,
  .search-input {
    width: 100%;
  }
  .approval-item {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .amount-block,
  .item-actions {
    grid-column: 2;
  }
  .item-actions {
    justify-content: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .approval-item {
    transition: none;
  }
}
</style>
