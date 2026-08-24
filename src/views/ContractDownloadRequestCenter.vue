<template>
  <div
    class="download-request-center"
    :class="{
      embedded: props.embedded,
      'manager-approval-page': mode === 'manager' && !props.embedded,
    }"
  >
    <header v-if="!props.embedded && mode === 'manager'" class="approval-hero">
      <div>
        <span class="hero-kicker"><i></i>下载审批工作台</span>
        <h1>合同下载申请审批</h1>
        <p>系统只展示提交时锁定给当前总经理的下载申请及本人审批记录。</p>
      </div>
      <div class="hero-actions">
        <div class="pending-total">
          <span>{{ managerView === "pending" ? "待审批" : "审批记录" }}</span>
          <strong>{{ total }}</strong>
          <small>条记录</small>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="loadRequests">
          刷新
        </el-button>
      </div>
    </header>

    <header v-else-if="!props.embedded" class="page-heading">
      <div>
        <span>合同管理</span>
        <h1>{{ heading.title }}</h1>
        <p>{{ heading.description }}</p>
      </div>
      <el-button v-if="mode === 'mine'" @click="router.push('/contracts')">
        返回合同台账
      </el-button>
    </header>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      show-icon
      closable
      @close="errorMessage = ''"
    />

    <section
      v-loading="loading"
      class="request-list-card"
      :class="{ 'approval-card': mode === 'manager' && !props.embedded }"
    >
      <template v-if="mode === 'manager' && !props.embedded">
        <el-tabs
          :model-value="managerView"
          class="approval-tabs"
          @tab-change="handleManagerTabChange"
        >
          <el-tab-pane label="待我审批" name="pending" />
          <el-tab-pane label="审批记录" name="history" />
        </el-tabs>
        <div class="card-heading">
          <div>
            <h2>{{ heading.listTitle }}</h2>
            <span>{{ heading.listDescription }}</span>
          </div>
          <div class="manager-history-tools">
            <el-input
              v-model="keyword"
              class="search-input"
              clearable
              :prefix-icon="Search"
              placeholder="搜索合同、编号、申请人或用途"
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            />
            <el-button :icon="Download" @click="exportManagerHistory">
              导出Excel
            </el-button>
          </div>
        </div>
      </template>

      <div v-else class="list-toolbar">
        <strong>{{ heading.listTitle }}</strong>
        <div class="toolbar-actions">
          <div
            v-if="mode === 'mine'"
            class="manager-view-switch"
            role="tablist"
            aria-label="我的下载申请视图"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="employeeView === 'pending'"
              :class="{ active: employeeView === 'pending' }"
              @click="setEmployeeView('pending')"
            >
              当前申请
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="employeeView === 'history'"
              :class="{ active: employeeView === 'history' }"
              @click="setEmployeeView('history')"
            >
              历史申请
            </button>
          </div>
          <div
            v-if="mode === 'manager'"
            class="manager-view-switch"
            role="tablist"
            aria-label="下载申请审批视图"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="managerView === 'pending'"
              :class="{ active: managerView === 'pending' }"
              @click="setManagerView('pending')"
            >
              待我审批
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="managerView === 'history'"
              :class="{ active: managerView === 'history' }"
              @click="setManagerView('history')"
            >
              审批记录
            </button>
          </div>
          <div
            v-if="mode === 'admin'"
            class="manager-view-switch"
            role="tablist"
            aria-label="下载任务处理视图"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="adminView === 'pending'"
              :class="{ active: adminView === 'pending' }"
              @click="setAdminView('pending')"
            >
              待我处理
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="adminView === 'history'"
              :class="{ active: adminView === 'history' }"
              @click="setAdminView('history')"
            >
              处理记录
            </button>
          </div>
          <el-input
            v-if="mode === 'admin'"
            v-model="keyword"
            class="search-input admin-history-search"
            clearable
            :prefix-icon="Search"
            placeholder="搜索合同、编号、申请人或用途"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <el-button
            v-if="mode === 'admin'"
            :icon="Download"
            @click="exportAdminHistory"
          >
            导出Excel
          </el-button>
          <el-button :loading="loading" @click="loadRequests">刷新</el-button>
        </div>
      </div>

      <div v-if="items.length && isHistoryView" class="history-table-shell">
        <el-table
          :data="items"
          row-key="id"
          class="history-table"
          :class="{
            'history-table-center-all': isHistoryView,
          }"
          :expand-row-keys="
            expandedHistoryRequestId ? [expandedHistoryRequestId] : []
          "
          @expand-change="handleHistoryExpand"
        >
          <el-table-column type="expand" width="42">
            <template #default="{ row }">
              <div class="history-expanded-content">
                <ContractDownloadRequestReadonlyDetails
                  :item="row"
                  :show-manager-decision-time="isManagerHistory"
                  @preview-application="previewApplication"
                  @preview-file="previewRequestedFile"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column
            type="index"
            label="序号"
            width="58"
            align="center"
            :index="historyIndex"
          />
          <el-table-column label="合同信息" min-width="280">
            <template #default="{ row }">
              <button
                type="button"
                class="table-contract-link"
                @click="router.push(`/contracts/${row.contractId}`)"
              >
                {{ row.contractName }}
              </button>
              <small>{{ row.contractNo || "合同编号待归档" }}</small>
            </template>
          </el-table-column>
          <el-table-column label="申请人" min-width="150">
            <template #default="{ row }">
              {{ row.applicant.label }}
            </template>
          </el-table-column>
          <el-table-column
            :label="
              isManagerHistory
                ? '审批结果'
                : isAdminHistory
                  ? '处理结果'
                  : '申请状态'
            "
            width="100"
            align="center"
          >
            <template #default="{ row }">
              <el-tag :type="historyResultTagType(row)" effect="light">
                {{ historyResultLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            :label="
              isManagerHistory
                ? '签字时间'
                : isAdminHistory
                  ? '完成时间'
                  : '更新时间'
            "
            min-width="175"
          >
            <template #default="{ row }">
              {{ formatDateTime(historyDecisionTime(row)) }}
            </template>
          </el-table-column>
          <el-table-column
            :label="
              isManagerHistory
                ? '审批意见'
                : isAdminHistory
                  ? '处理说明'
                  : '下载用途'
            "
            min-width="240"
          >
            <template #default="{ row }">
              <span class="table-opinion">
                {{ historyDecisionOpinion(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="申请轮次／编号" min-width="190">
            <template #default="{ row }">
              <strong>第 {{ row.attemptNo }} 次</strong>
              <small>{{ row.requestNo }}</small>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-else-if="items.length" class="request-list">
        <article
          v-for="(item, index) in items"
          :key="item.id"
          class="request-card"
        >
          <header>
            <span
              v-if="mode === 'manager' && managerView === 'pending'"
              class="approval-serial"
              :aria-label="`序号 ${historyIndex(index)}`"
            >
              {{ historyIndex(index) }}
            </span>
            <div class="request-heading-copy">
              <small>{{ item.contractNo || "合同编号待归档" }}</small>
              <button
                type="button"
                class="contract-link"
                @click="router.push(`/contracts/${item.contractId}`)"
              >
                {{ item.contractName }}
              </button>
              <span>
                {{ item.contractArea }} ·
                {{ contractStatusLabel(item.contractStatus) }}
              </span>
            </div>
            <el-tag :type="statusTagType(item.status)" effect="light">
              {{ statusLabel(item.status) }}
            </el-tag>
          </header>

          <el-alert
            v-if="mode === 'mine' && item.status === 'rejected'"
            type="error"
            title="下载申请已被总经理驳回"
            :description="
              item.approver.comment || '请查看审批记录并修改后重新提交。'
            "
            :closable="false"
            show-icon
            class="rejection-alert"
          />

          <ContractDownloadRequestReadonlyDetails
            :item="item"
            :can-download-files="mode === 'admin' && adminView === 'pending'"
            :optimistic-downloaded-keys="downloadedFiles"
            @preview-application="previewApplication"
            @preview-file="previewRequestedFile"
            @download-file="downloadApprovedFile"
          />

          <section
            v-if="
              mode === 'manager' &&
              managerView === 'pending' &&
              item.status === 'pending_approval' &&
              inlineApprovalRequestId === item.id
            "
            :id="`manager-approval-${item.id}`"
            class="manager-inline-approval"
          >
            <div class="inline-approval-heading">
              <div>
                <small>总经理审批</small>
                <strong>申请单总经理审批签字区</strong>
              </div>
              <el-tag type="warning" effect="light">待本人签字</el-tag>
            </div>

            <el-form label-position="top" class="inline-approval-form">
              <el-form-item label="审批意见（选填）">
                <el-input
                  v-model="decisionOpinion"
                  type="textarea"
                  :rows="3"
                  maxlength="500"
                  show-word-limit
                  placeholder="可填写批准意见"
                />
              </el-form-item>
            </el-form>

            <ContractDownloadApplicationApprovalPreview
              :url="getContractDownloadApplicationPreviewUrl(item.id)"
              signable
              :disabled="actionLoading"
              :signature-loading="managerSignatureLoading"
              :signature-data-url="managerSignatureDataUrl"
              @sign="confirmManagerSignature"
            />

            <div class="inline-approval-actions">
              <el-button
                :disabled="actionLoading"
                @click="cancelInlineApproval"
              >
                取消
              </el-button>
              <el-button
                type="primary"
                :loading="actionLoading"
                :disabled="!managerSignatureDataUrl"
                @click="submitDecision"
              >
                签字并批准
              </el-button>
            </div>
          </section>

          <footer
            v-if="
              mode === 'mine' &&
              (item.canWithdraw || item.canResubmit || item.canDelete)
            "
          >
            <span class="employee-action-tip">
              {{
                item.canWithdraw
                  ? "总经理尚未处理，可撤回本次申请"
                  : item.canDelete
                    ? "已撤回，可重新提交或删除本次申请"
                    : "可修改下载用途和附件后重新提交"
              }}
            </span>
            <div class="employee-actions">
              <el-button
                v-if="item.canWithdraw"
                type="danger"
                plain
                :loading="employeeActionRequestId === item.id"
                @click="withdrawRequest(item)"
              >
                撤回申请
              </el-button>
              <el-button
                v-if="item.canResubmit"
                type="primary"
                @click="startResubmit(item)"
              >
                修改并重新提交
              </el-button>
              <el-button
                v-if="item.canDelete"
                type="danger"
                plain
                :loading="employeeActionRequestId === item.id"
                @click="deleteWithdrawnRequest(item)"
              >
                删除申请
              </el-button>
            </div>
          </footer>
          <footer
            v-else-if="
              mode === 'manager' &&
              managerView === 'pending' &&
              item.status === 'pending_approval' &&
              inlineApprovalRequestId !== item.id
            "
            class="manager-decision-footer"
          >
            <el-button
              type="danger"
              plain
              @click="openDecision(item, 'reject')"
            >
              驳回
            </el-button>
            <el-button type="primary" @click="openDecision(item, 'approve')">
              同意
            </el-button>
          </footer>
          <footer
            v-else-if="
              mode === 'admin' &&
              adminView === 'pending' &&
              ['approved', 'processing'].includes(item.status)
            "
          >
            <span class="download-progress">
              已下载 {{ downloadedCount(item) }} /
              {{ item.files.length }} 份指定文件
            </span>
            <el-button
              type="primary"
              :disabled="downloadedCount(item) < item.files.length"
              @click="openComplete(item)"
            >
              标记已处理
            </el-button>
          </footer>
        </article>
      </div>
      <el-empty
        v-else-if="!loading && !errorMessage"
        :description="heading.emptyText"
        :image-size="100"
      />

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        class="pagination"
        :page-size="pageSize"
        layout="total, prev, pager, next"
        :total="total"
        @current-change="handlePageChange"
      />
    </section>

    <el-dialog
      v-model="decisionVisible"
      title="驳回合同下载申请"
      width="520px"
      destroy-on-close
    >
      <el-input
        v-model="decisionOpinion"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="请填写驳回原因，员工将在我的下载申请中查看"
      />
      <template #footer>
        <el-button @click="decisionVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="actionLoading"
          @click="submitDecision"
        >
          确认驳回
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="completeVisible"
      title="标记下载申请已处理"
      width="520px"
      destroy-on-close
    >
      <el-input
        v-model="processingNote"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="可填写交付方式或其他处理说明"
      />
      <template #footer>
        <el-button @click="completeVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="actionLoading"
          @click="completeRequest"
        >
          确认已处理
        </el-button>
      </template>
    </el-dialog>

    <ContractReadOnlyPreview
      :visible="readonlyPreviewVisible"
      :url="readonlyPreviewUrl"
      :file-name="readonlyPreviewFileName"
      :mime-type="readonlyPreviewMimeType"
      :can-download="readonlyPreviewCanDownload"
      @close="readonlyPreviewVisible = false"
      @download="downloadReadonlyPreview"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { Download, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ContractDownloadApplicationApprovalPreview from "@/components/contracts/ContractDownloadApplicationApprovalPreview.vue";
import ContractReadOnlyPreview from "@/components/contracts/ContractReadOnlyPreview.vue";
import ContractDownloadRequestReadonlyDetails from "@/components/contracts/ContractDownloadRequestReadonlyDetails.vue";
import type {
  ContractDownloadRequest,
  ContractDownloadRequestFile,
  ContractDownloadRequestStatus,
} from "@/types/contractDownload";
import { CONTRACT_DOWNLOAD_REQUEST_STATUS_LABELS } from "@/types/contractDownload";
import {
  approveContractDownloadRequest,
  acknowledgeContractDownloadResults,
  completeContractDownloadRequest,
  deleteWithdrawnContractDownloadRequest,
  getAdminContractDownloadHistoryExportUrl,
  getApprovedContractDownloadFileUrl,
  getContractDownloadApplicationPreviewUrl,
  getContractDownloadRequestFilePreviewUrl,
  getContractDownloadRequestErrorMessage,
  getContractDownloadRequests,
  getManagerContractDownloadHistoryExportUrl,
  rejectContractDownloadRequest,
  requestContractDownloadBadgeRefresh,
  withdrawContractDownloadRequest,
} from "@/utils/contractDownloadApi";
import { CONTRACT_STATUS_LABELS } from "@/utils/contractPresentation";
import { loadPersonalSignature } from "@/utils/personalSignature";

type CenterMode = "mine" | "manager" | "admin";
type ManagerView = "pending" | "history";
type AdminView = "pending" | "history";
type EmployeeView = "pending" | "history";
const props = withDefaults(
  defineProps<{ embedded?: boolean; centerMode?: CenterMode }>(),
  {
    embedded: false,
    centerMode: undefined,
  },
);
const route = useRoute();
const router = useRouter();
const mode = computed<CenterMode>(() => {
  if (props.centerMode) return props.centerMode;
  if (route.name === "ContractDownloadRequestApproval") return "manager";
  if (route.name === "ContractDownloadTaskList") return "admin";
  return "mine";
});
const managerView = computed<ManagerView>(() =>
  route.query.view === "history" ? "history" : "pending",
);
const adminView = computed<AdminView>(() =>
  route.query.view === "history" ? "history" : "pending",
);
const employeeView = computed<EmployeeView>(() =>
  route.query.view === "history" ? "history" : "pending",
);
const isManagerHistory = computed(
  () => mode.value === "manager" && managerView.value === "history",
);
const isAdminHistory = computed(
  () => mode.value === "admin" && adminView.value === "history",
);
const isEmployeeHistory = computed(
  () => mode.value === "mine" && employeeView.value === "history",
);
const isHistoryView = computed(
  () =>
    isManagerHistory.value || isAdminHistory.value || isEmployeeHistory.value,
);
const heading = computed(() => {
  if (mode.value === "manager") {
    if (managerView.value === "history") {
      return {
        title: "合同下载申请审批",
        description: "查看本人已经批准及后续处理中或已完成的下载申请。",
        listTitle: "审批记录",
        listDescription: "按审批时间倒序，最近处理优先",
        emptyText: "当前没有已批准的合同下载申请",
      };
    }
    return {
      title: "合同下载申请审批",
      description: "总经理统一审批员工提交的合同附件下载申请。",
      listTitle: "待我审批",
      listDescription: "按提交时间升序，最早提交优先",
      emptyText: "当前没有待审批的合同下载申请",
    };
  }
  if (mode.value === "admin") {
    if (adminView.value === "history") {
      return {
        title: "合同下载待办",
        description: "查看本人已经完成的合同附件下载任务。",
        listTitle: "处理记录",
        listDescription: "",
        emptyText: "当前没有已完成的合同下载任务",
      };
    }
    return {
      title: "合同下载待办",
      description: "仅执行总经理已批准的下载任务，不进行二次审批。",
      listTitle: "等待管理员执行下载",
      listDescription: "",
      emptyText: "当前没有待执行的合同下载任务",
    };
  }
  if (employeeView.value === "history") {
    return {
      title: "我的下载申请",
      description: "查看已经完成的申请及同一申请链中以前的提交记录。",
      listTitle: "历史申请",
      listDescription: "",
      emptyText: "当前没有历史下载申请",
    };
  }
  return {
    title: "我的下载申请",
    description: "查看当前审批、处理或待修改重提的下载申请。",
    listTitle: "当前申请",
    listDescription: "",
    emptyText: "当前没有进行中的下载申请",
  };
});
const items = ref<ContractDownloadRequest[]>([]);
const total = ref(0);
const keyword = ref("");
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref("");
const decisionVisible = ref(false);
const decisionAction = ref<"approve" | "reject">("approve");
const decisionOpinion = ref("");
const currentRequest = ref<ContractDownloadRequest | null>(null);
const completeVisible = ref(false);
const processingNote = ref("");
const downloadedFiles = ref(new Set<string>());
const managerSignatureLoading = ref(false);
const managerSignatureDataUrl = ref("");
const inlineApprovalRequestId = ref("");
const expandedHistoryRequestId = ref("");
let managerSignatureSequence = 0;
const readonlyPreviewVisible = ref(false);
const readonlyPreviewUrl = ref("");
const readonlyPreviewFileName = ref("");
const readonlyPreviewMimeType = ref("");
const readonlyPreviewCanDownload = ref(false);
const readonlyPreviewDownloadUrl = ref("");
const readonlyPreviewAdminDownload = ref(false);
const employeeActionRequestId = ref("");
let disposed = false;
let loadSequence = 0;

function statusLabel(status: ContractDownloadRequestStatus) {
  return CONTRACT_DOWNLOAD_REQUEST_STATUS_LABELS[status];
}
function statusTagType(status: ContractDownloadRequestStatus) {
  if (status === "completed") return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "withdrawn") return "info" as const;
  if (status === "approved" || status === "processing")
    return "primary" as const;
  return "warning" as const;
}
function contractStatusLabel(
  status: ContractDownloadRequest["contractStatus"],
) {
  return CONTRACT_STATUS_LABELS[status] || status;
}
function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
function historyIndex(itemIndex: number) {
  return (page.value - 1) * pageSize + itemIndex + 1;
}

function historyDecisionTime(item: ContractDownloadRequest) {
  if (isManagerHistory.value) return item.approver.decidedAt;
  if (isAdminHistory.value) return item.executor.completedAt;
  return item.updatedAt;
}

function historyDecisionOpinion(item: ContractDownloadRequest) {
  if (isManagerHistory.value) return item.approver.comment || "无审批意见";
  if (isAdminHistory.value) return item.executor.note || "无处理说明";
  return item.purpose;
}

function historyResultLabel(item: ContractDownloadRequest) {
  if (isManagerHistory.value) return "已批准";
  if (isAdminHistory.value) return "已处理";
  return statusLabel(item.status);
}

function historyResultTagType(item: ContractDownloadRequest) {
  if (isManagerHistory.value || isAdminHistory.value) return "success" as const;
  return statusTagType(item.status);
}

function handleHistoryExpand(
  item: ContractDownloadRequest,
  expandedRows: ContractDownloadRequest[],
) {
  expandedHistoryRequestId.value = expandedRows.some(
    (expanded) => expanded.id === item.id,
  )
    ? item.id
    : "";
}

async function withdrawRequest(item: ContractDownloadRequest) {
  try {
    await ElMessageBox.confirm(
      "撤回后，总经理的待审批任务会立即取消；申请记录和审批历史仍会保留，之后可以修改并重新提交。",
      "确认撤回下载申请",
      {
        confirmButtonText: "确认撤回",
        cancelButtonText: "暂不撤回",
        type: "warning",
      },
    );
  } catch {
    return;
  }
  employeeActionRequestId.value = item.id;
  try {
    await withdrawContractDownloadRequest(item.id, item.version);
    ElMessage.success("下载申请已撤回");
    requestContractDownloadBadgeRefresh();
    await loadRequests();
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "撤回下载申请失败"),
    );
  } finally {
    employeeActionRequestId.value = "";
  }
}

async function deleteWithdrawnRequest(item: ContractDownloadRequest) {
  try {
    await ElMessageBox.confirm(
      "删除后，本次已撤回申请及其专属申请单文件将永久移除，原合同附件不会删除。是否继续？",
      "确认删除下载申请",
      {
        confirmButtonText: "确认删除",
        cancelButtonText: "暂不删除",
        type: "warning",
      },
    );
  } catch {
    return;
  }
  employeeActionRequestId.value = item.id;
  try {
    await deleteWithdrawnContractDownloadRequest(item.id, item.version);
    ElMessage.success("已删除撤回的下载申请");
    requestContractDownloadBadgeRefresh();
    await loadRequests();
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "删除下载申请失败"),
    );
  } finally {
    employeeActionRequestId.value = "";
  }
}

function startResubmit(item: ContractDownloadRequest) {
  void router.push({
    path: "/contract-download-requests/new",
    query: {
      contractId: item.contractId,
      resubmitRequestId: item.id,
    },
  });
}

async function setManagerView(view: ManagerView) {
  if (managerView.value === view) return;
  if (inlineApprovalRequestId.value) cancelInlineApproval();
  expandedHistoryRequestId.value = "";
  keyword.value = "";
  page.value = 1;
  await router.replace({
    query: { ...route.query, view },
  });
}

function handleManagerTabChange(view: string | number) {
  if (view === "pending" || view === "history") {
    void setManagerView(view);
  }
}

function handleSearch() {
  page.value = 1;
  expandedHistoryRequestId.value = "";
  void loadRequests();
}

async function setAdminView(view: AdminView) {
  if (adminView.value === view) return;
  expandedHistoryRequestId.value = "";
  keyword.value = "";
  page.value = 1;
  await router.replace({
    query: { ...route.query, view },
  });
}

async function setEmployeeView(view: EmployeeView) {
  if (employeeView.value === view) return;
  expandedHistoryRequestId.value = "";
  page.value = 1;
  await router.replace({
    query: { ...route.query, view },
  });
}

function handlePageChange(currentPage: number) {
  expandedHistoryRequestId.value = "";
  page.value = currentPage;
  void loadRequests();
}

async function loadRequests() {
  const sequence = ++loadSequence;
  loading.value = true;
  errorMessage.value = "";
  let visibleResultIds: string[] = [];
  try {
    const result = await getContractDownloadRequests({
      scope:
        mode.value === "manager"
          ? managerView.value === "history"
            ? "manager_processed"
            : "manager_pending"
          : mode.value === "admin"
            ? adminView.value === "history"
              ? "admin_processed"
              : "admin_pending"
            : employeeView.value === "history"
              ? "employee_history"
              : "mine",
      page: page.value,
      pageSize,
      keyword:
        mode.value === "manager" || mode.value === "admin"
          ? keyword.value.trim()
          : undefined,
    });
    if (disposed || sequence !== loadSequence) return;
    items.value = result.items;
    total.value = result.total;
    if (
      expandedHistoryRequestId.value &&
      !result.items.some((item) => item.id === expandedHistoryRequestId.value)
    ) {
      expandedHistoryRequestId.value = "";
    }
    if (mode.value === "mine") {
      visibleResultIds = result.items
        .filter((item) => item.status !== "pending_approval")
        .map((item) => item.id);
    }
  } catch (error) {
    if (disposed || sequence !== loadSequence) return;
    items.value = [];
    total.value = 0;
    errorMessage.value = getContractDownloadRequestErrorMessage(
      error,
      "获取合同下载申请失败",
    );
  } finally {
    if (!disposed && sequence === loadSequence) loading.value = false;
  }
  if (visibleResultIds.length > 0) {
    await nextTick();
    if (disposed || sequence !== loadSequence) return;
    try {
      await acknowledgeContractDownloadResults(visibleResultIds);
      if (disposed || sequence !== loadSequence) return;
      requestContractDownloadBadgeRefresh();
    } catch {
      // 已读确认失败不影响员工查看结果；下次刷新会再次幂等确认当前页。
    }
  }
}

function exportAdminHistory() {
  window.open(
    getAdminContractDownloadHistoryExportUrl(keyword.value),
    "_blank",
    "noopener,noreferrer",
  );
}

function exportManagerHistory() {
  window.open(
    getManagerContractDownloadHistoryExportUrl(keyword.value),
    "_blank",
    "noopener,noreferrer",
  );
}

async function openDecision(
  item: ContractDownloadRequest,
  action: "approve" | "reject",
) {
  managerSignatureSequence += 1;
  managerSignatureLoading.value = false;
  currentRequest.value = item;
  decisionAction.value = action;
  decisionOpinion.value = "";
  managerSignatureDataUrl.value = "";
  if (action === "approve") {
    decisionVisible.value = false;
    inlineApprovalRequestId.value = item.id;
    await nextTick();
    document
      .getElementById(`manager-approval-${item.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  inlineApprovalRequestId.value = "";
  decisionVisible.value = true;
}

function cancelInlineApproval() {
  managerSignatureSequence += 1;
  managerSignatureLoading.value = false;
  inlineApprovalRequestId.value = "";
  currentRequest.value = null;
  decisionOpinion.value = "";
  managerSignatureDataUrl.value = "";
}

async function submitDecision() {
  if (!currentRequest.value) return;
  if (decisionAction.value === "reject" && !decisionOpinion.value.trim()) {
    ElMessage.warning("驳回申请时必须填写驳回原因");
    return;
  }
  if (decisionAction.value === "approve" && !managerSignatureDataUrl.value) {
    ElMessage.warning("批准前请由总经理本人完成电子签名");
    return;
  }
  actionLoading.value = true;
  try {
    if (decisionAction.value === "approve") {
      await approveContractDownloadRequest(
        currentRequest.value.id,
        decisionOpinion.value.trim(),
        currentRequest.value.version,
      );
      ElMessage.success("已批准，下一步由管理员吴静雯执行下载");
    } else {
      await rejectContractDownloadRequest(
        currentRequest.value.id,
        decisionOpinion.value.trim(),
        currentRequest.value.version,
      );
      ElMessage.success("下载申请已驳回");
    }
    decisionVisible.value = false;
    managerSignatureSequence += 1;
    inlineApprovalRequestId.value = "";
    requestContractDownloadBadgeRefresh();
    await loadRequests();
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "处理下载申请失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}

function downloadKey(requestId: string, fileId: string) {
  return `${requestId}:${fileId}`;
}
function downloadApprovedFile(item: ContractDownloadRequest, fileId: string) {
  window.open(
    getApprovedContractDownloadFileUrl(item.id, fileId),
    "_blank",
    "noopener,noreferrer",
  );
  downloadedFiles.value = new Set([
    ...downloadedFiles.value,
    downloadKey(item.id, fileId),
  ]);
  window.setTimeout(() => void loadRequests(), 800);
}
function downloadedCount(item: ContractDownloadRequest) {
  return item.files.filter((file) => Boolean(file.downloadedAt)).length;
}

async function confirmManagerSignature() {
  const requestId = inlineApprovalRequestId.value;
  if (!requestId || currentRequest.value?.id !== requestId) return;
  const sequence = ++managerSignatureSequence;
  managerSignatureLoading.value = true;
  try {
    const signature = await loadPersonalSignature();
    if (
      sequence !== managerSignatureSequence ||
      inlineApprovalRequestId.value !== requestId ||
      currentRequest.value?.id !== requestId
    ) {
      return;
    }
    if (!signature) {
      ElMessage.warning("尚未设置本人电子签名，请先在个人设置中上传并锁定签名");
      return;
    }
    managerSignatureDataUrl.value = signature.dataUrl;
    ElMessage.success("总经理本人签名已确认，尚未提交审批");
  } catch (error) {
    if (
      sequence !== managerSignatureSequence ||
      inlineApprovalRequestId.value !== requestId ||
      currentRequest.value?.id !== requestId
    ) {
      return;
    }
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "调用总经理本人签名失败"),
    );
  } finally {
    if (sequence === managerSignatureSequence) {
      managerSignatureLoading.value = false;
    }
  }
}

function previewApplication(item: ContractDownloadRequest) {
  const previewUrl = getContractDownloadApplicationPreviewUrl(item.id);
  if (mode.value !== "mine") {
    window.open(previewUrl, "_blank", "noopener,noreferrer");
    return;
  }
  readonlyPreviewUrl.value = previewUrl;
  readonlyPreviewFileName.value = item.applicationFileName;
  readonlyPreviewMimeType.value = "application/pdf";
  readonlyPreviewCanDownload.value = false;
  readonlyPreviewDownloadUrl.value = "";
  readonlyPreviewAdminDownload.value = false;
  readonlyPreviewVisible.value = true;
}

function previewRequestedFile(
  item: ContractDownloadRequest,
  file: ContractDownloadRequestFile,
) {
  const previewUrl = getContractDownloadRequestFilePreviewUrl(item.id, file.id);
  if (mode.value !== "mine") {
    window.open(previewUrl, "_blank", "noopener,noreferrer");
    return;
  }
  readonlyPreviewUrl.value = previewUrl;
  readonlyPreviewFileName.value = file.fileName;
  readonlyPreviewMimeType.value = file.mimeType;
  readonlyPreviewCanDownload.value = false;
  readonlyPreviewDownloadUrl.value = "";
  readonlyPreviewAdminDownload.value = false;
  readonlyPreviewVisible.value = true;
}

function downloadReadonlyPreview() {
  if (!readonlyPreviewCanDownload.value || !readonlyPreviewDownloadUrl.value) {
    return;
  }
  window.open(
    readonlyPreviewDownloadUrl.value,
    "_blank",
    "noopener,noreferrer",
  );
  if (readonlyPreviewAdminDownload.value) {
    window.setTimeout(() => void loadRequests(), 800);
  }
}
function openComplete(item: ContractDownloadRequest) {
  currentRequest.value = item;
  processingNote.value = "";
  completeVisible.value = true;
}
async function completeRequest() {
  if (!currentRequest.value) return;
  actionLoading.value = true;
  try {
    await completeContractDownloadRequest(
      currentRequest.value.id,
      processingNote.value.trim(),
      currentRequest.value.version,
    );
    ElMessage.success("已标记处理完成");
    completeVisible.value = false;
    requestContractDownloadBadgeRefresh();
    await loadRequests();
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "标记下载任务失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}

watch([mode, managerView, adminView, employeeView], () => {
  managerSignatureSequence += 1;
  managerSignatureLoading.value = false;
  inlineApprovalRequestId.value = "";
  currentRequest.value = null;
  decisionOpinion.value = "";
  managerSignatureDataUrl.value = "";
  expandedHistoryRequestId.value = "";
  page.value = 1;
  void loadRequests();
});
onMounted(() => void loadRequests());
onBeforeUnmount(() => {
  disposed = true;
  loadSequence += 1;
  managerSignatureSequence += 1;
});
</script>

<style scoped>
.download-request-center {
  display: grid;
  gap: 20px;
  padding: 20px;
  background: #f4f7f9;
}
.download-request-center.embedded {
  min-height: 0;
  padding: 0;
  background: transparent;
}
.download-request-center.manager-approval-page {
  display: block;
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px 32px 48px;
  color: #1d354b;
  background:
    radial-gradient(circle at 6% 2%, rgb(41 109 151 / 8%), transparent 24%),
    #f5f7fa;
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
  color: #71878a;
  background: #f0f8f6;
}
.pending-total strong {
  color: #167a79;
  font-size: 25px;
}
.pending-total small,
.pending-total span {
  font-size: 11px;
}
.manager-approval-page > :deep(.el-alert) {
  margin-top: 14px;
}
.page-heading,
.request-list-card {
  border: 1px solid #dfe8ed;
  border-radius: 16px;
  background: #fff;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 26px;
}
.page-heading span {
  color: #168c83;
}
.page-heading h1 {
  margin: 5px 0;
  color: #17364b;
}
.page-heading p {
  margin: 0;
  color: #71808b;
}
.request-list-card {
  min-height: 320px;
  padding: 22px;
}
.request-list-card.approval-card {
  min-height: 300px;
  margin-top: 14px;
  padding: 19px;
  border: 1px solid #e0e7ed;
  border-radius: 13px;
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
.card-heading > div:not(.manager-history-tools) {
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
.manager-history-tools {
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
}
.manager-history-tools .search-input {
  width: 320px;
  min-width: 220px;
}
.manager-history-tools :deep(.el-button) {
  flex: 0 0 auto;
  margin-left: 0;
  white-space: nowrap;
}
.admin-history-search {
  width: min(300px, 100%);
}
.search-input :deep(.el-input__wrapper) {
  min-height: 38px;
  border-radius: 9px;
}
.list-toolbar,
.request-card > header,
.request-card > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.toolbar-actions,
.manager-view-switch {
  display: flex;
  align-items: center;
}
.toolbar-actions {
  gap: 12px;
}
.manager-view-switch {
  flex: 0 0 auto;
  gap: 3px;
  padding: 3px;
  border: 1px solid #dce6ea;
  border-radius: 9px;
  background: #f2f6f7;
}
.manager-view-switch button {
  flex: 0 0 auto;
  padding: 6px 14px;
  border: 0;
  border-radius: 7px;
  color: #657680;
  background: transparent;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
  transition:
    color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease;
}
.manager-view-switch button:hover,
.manager-view-switch button:focus-visible {
  color: #087b72;
  outline: none;
}
.manager-view-switch button.active {
  color: #087b72;
  background: #fff;
  box-shadow: 0 2px 8px rgb(28 91 87 / 12%);
}
.request-list {
  display: grid;
  gap: 16px;
  margin: 18px 0;
}
.request-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid #e0e9ed;
  border-radius: 12px;
}
.approval-serial {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  color: #087d76;
  background: #e7f5f2;
  font-size: 13px;
  font-weight: 700;
}
.request-heading-copy {
  min-width: 0;
  flex: 1;
}
.rejection-alert {
  border: 1px solid #efc0bb;
  background: #fff4f3;
}
.history-table-shell {
  width: 100%;
  max-width: 100%;
  margin: 18px 0;
  overflow-x: auto;
  border: 1px solid #e0e9ed;
  border-radius: 12px;
  background: #fff;
}
.history-table {
  min-width: 1180px;
}
.history-expanded-content {
  min-width: 0;
  overflow: hidden;
}
.table-contract-link {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: #17364b;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  margin: 0 auto;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-contract-link:hover,
.table-contract-link:focus-visible {
  color: #168c83;
  outline: none;
}
.history-table small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #81909a;
  font-size: 12px;
  text-overflow: ellipsis;
  text-align: center;
  white-space: nowrap;
}
.history-table :deep(.el-table__header-wrapper th .cell) {
  text-align: center;
}
.history-table-center-all :deep(.el-table__body-wrapper td .cell) {
  text-align: center;
}
.history-table strong {
  color: #314c5b;
  font-size: 13px;
}
.table-opinion {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}
:deep(.history-table .el-table__expanded-cell) {
  padding: 0;
  background: #f5f8f9;
}
.contract-link {
  display: block;
  margin: 4px 0;
  padding: 0;
  border: 0;
  color: #17364b;
  font-size: 18px;
  font-weight: 700;
  text-align: left;
  background: transparent;
  cursor: pointer;
}
.contract-link:hover {
  color: #168c83;
}
.request-card header small,
.request-card header span,
.download-progress {
  color: #71808b;
  font-size: 13px;
}
.manager-inline-approval {
  padding: 18px;
  border: 1px solid #b8d9d5;
  border-radius: 12px;
  background: linear-gradient(135deg, #f5fbfa 0%, #ffffff 78%);
  box-shadow: 0 8px 24px rgb(27 108 101 / 8%);
}
.inline-approval-heading,
.inline-approval-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.inline-approval-heading > div {
  display: grid;
  gap: 4px;
}
.inline-approval-heading small {
  color: #71808b;
  font-size: 12px;
}
.inline-approval-heading strong {
  color: #17364b;
}
.inline-approval-form {
  margin-top: 16px;
}
.inline-approval-actions {
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #dfeae8;
}
.employee-action-tip {
  color: #71808b;
  font-size: 13px;
}
.employee-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
}
.employee-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.request-card > footer.manager-decision-footer {
  justify-content: flex-end;
}
.pagination {
  justify-content: flex-end;
  margin-top: 18px;
}
@media (max-width: 760px) {
  .download-request-center {
    padding: 12px;
  }
  .page-heading,
  .approval-hero,
  .hero-actions,
  .card-heading,
  .list-toolbar,
  .request-card > header,
  .request-card > footer,
  .inline-approval-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .download-request-center.manager-approval-page {
    margin: -12px;
    padding: 12px;
  }
  .search-input {
    width: 100%;
  }
  .manager-history-tools {
    width: 100%;
    flex-wrap: nowrap;
    margin-left: 0;
  }
  .manager-history-tools .search-input {
    min-width: 0;
    flex: 1 1 auto;
  }
  .admin-history-search {
    width: 100%;
  }
  .toolbar-actions {
    width: 100%;
    justify-content: space-between;
    overflow-x: auto;
  }
  .employee-actions {
    width: 100%;
    flex-wrap: wrap;
    margin-left: 0;
  }
  .request-list-card {
    padding: 14px;
  }
  .history-table-shell {
    width: 100%;
    max-width: 100%;
  }
}
</style>
