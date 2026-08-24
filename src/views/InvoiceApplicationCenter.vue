<template>
  <div
    class="invoice-application-center"
    :class="{
      embedded: props.embedded,
      'manager-approval-page': mode === 'manager' && !props.embedded,
    }"
  >
    <header v-if="!props.embedded && mode === 'manager'" class="approval-hero">
      <div>
        <span class="hero-kicker"><i></i>开票审批工作台</span>
        <h1>开票申请审批</h1>
        <p>系统只展示提交时锁定给当前总经理的开票申请及本人审批记录。</p>
      </div>
      <div class="hero-actions">
        <div class="pending-total">
          <span>{{ managerView === "pending" ? "待审批" : "审批记录" }}</span>
          <strong>{{ total }}</strong>
          <small>条记录</small>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="loadApplications">
          刷新
        </el-button>
      </div>
    </header>

    <header v-else-if="!props.embedded" class="page-heading">
      <div>
        <span>合同管理 · 开票申请</span>
        <h1>{{ heading.title }}</h1>
        <p>{{ heading.description }}</p>
      </div>
      <div>
        <el-button v-if="mode === 'mine'" @click="router.push('/contracts')"
          >返回合同台账</el-button
        >
        <el-button :loading="loading" @click="loadApplications">刷新</el-button>
      </div>
    </header>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      show-icon
      closable
      @close="errorMessage = ''"
    />

    <el-alert
      v-if="mode === 'manager' && managerPendingCount > 0"
      class="pending-reminder"
      type="warning"
      :title="`您有 ${managerPendingCount} 条开票申请待审批`"
      show-icon
      :closable="false"
    />

    <section
      v-loading="loading"
      class="list-card"
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
          <el-input
            v-model="keyword"
            class="search-input"
            clearable
            :prefix-icon="Search"
            placeholder="搜索合同、编号、甲方或申请人"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
        </div>
      </template>

      <div v-else class="list-toolbar">
        <strong>{{ heading.listTitle }}</strong>
        <div class="toolbar-actions">
          <div
            v-if="mode === 'mine'"
            class="employee-view-switch"
            role="tablist"
            aria-label="我的开票申请视图"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="employeeView === 'current'"
              :class="{ active: employeeView === 'current' }"
              @click="setEmployeeView('current')"
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
          <el-select
            v-if="mode !== 'mine' || employeeView === 'current'"
            v-model="statusFilter"
            class="status-filter"
            @change="handleFilterChange"
          >
            <el-option label="全部状态" value="" />
            <el-option
              v-for="status in availableStatuses"
              :key="status"
              :label="INVOICE_APPLICATION_STATUS_LABELS[status]"
              :value="status"
            />
          </el-select>
          <el-button
            v-if="props.embedded"
            :loading="loading"
            @click="loadApplications"
          >
            刷新
          </el-button>
        </div>
      </div>

      <div v-if="items.length" class="application-list">
        <article
          v-for="(item, index) in items"
          :key="item.id"
          class="application-item"
        >
          <span
            v-if="mode === 'mine' || mode === 'manager'"
            class="application-serial"
            :aria-label="`序号 ${serialNumber(index)}`"
          >
            {{ serialNumber(index) }}
          </span>
          <button
            type="button"
            class="application-summary"
            @click="openDetail(item)"
          >
            <span class="summary-icon"
              ><el-icon><Tickets /></el-icon
            ></span>
            <span class="summary-copy">
              <span class="summary-title">
                <strong>{{ item.contractTitle }}</strong>
                <el-tag
                  v-if="mode === 'manager' && managerView === 'history'"
                  :type="item.status === 'rejected' ? 'danger' : 'success'"
                  effect="light"
                >
                  {{ item.status === "rejected" ? "已驳回" : "已通过" }}
                </el-tag>
                <el-tag :type="statusTagType(item.status)" effect="light">
                  {{ statusLabel(item) }}
                </el-tag>
                <el-tag
                  :type="
                    item.materialMode === 'material_need_seal'
                      ? 'warning'
                      : 'info'
                  "
                  effect="plain"
                >
                  {{
                    item.materialMode === "material_need_seal"
                      ? "流程：开票＋用印"
                      : "流程：仅开票"
                  }}
                </el-tag>
              </span>
              <small
                >{{ item.contractNo || "合同编号待归档" }} ·
                {{ categoryLabel(item.category) }}</small
              >
              <span>甲方：{{ item.partyA || "—" }}</span>
              <span>申请人：{{ partyName(item.applicant) }}</span>
              <span
                v-if="mode === 'mine' && item.status === 'rejected'"
                class="employee-rejection-message"
              >
                <strong>总经理驳回：</strong>
                {{ managerDecisionLog(item)?.comment || "未填写驳回原因" }}
              </span>
              <span
                v-if="mode === 'manager' && managerView === 'history'"
                class="manager-decision-line"
              >
                审批时间：{{ dateTime(managerDecisionLog(item)?.createdAt) }} ·
                审批意见：{{
                  managerDecisionLog(item)?.comment || "无审批意见"
                }}
              </span>
            </span>
          </button>
          <div class="amount-block">
            <span>本次申请开票</span>
            <strong>{{ money(item.amount) }}</strong>
            <small>{{ item.invoiceType || "发票类型待完善" }}</small>
          </div>
          <div class="item-actions">
            <el-button @click="openDetail(item)">查看详情</el-button>
            <el-button
              v-if="
                mode === 'mine' && ['draft', 'rejected'].includes(item.status)
              "
              type="primary"
              @click="editApplication(item)"
              >{{
                item.status === "rejected" ? "修改重提" : "继续填写"
              }}</el-button
            >
            <el-button
              v-if="mode === 'mine' && item.status === 'pending_approval'"
              type="warning"
              plain
              :loading="actionLoading"
              @click="withdrawApplication(item)"
              >撤回申请</el-button
            >
            <el-button
              v-if="mode === 'admin' && item.status === 'pending_seal'"
              type="warning"
              @click="openAdminProcessing(item)"
              >盖章并交付</el-button
            >
            <el-button
              v-if="
                mode === 'admin' &&
                item.status === 'pending_invoice' &&
                !item.issuedAt
              "
              type="primary"
              @click="openAdminProcessing(item)"
              >登记已开具</el-button
            >
            <el-button
              v-if="
                mode === 'admin' &&
                item.status === 'pending_invoice' &&
                Boolean(item.issuedAt)
              "
              type="success"
              plain
              @click="openAdminProcessing(item)"
              >查看开具记录</el-button
            >
          </div>
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
        @current-change="loadApplications"
      />
    </section>

    <el-drawer
      v-model="detailVisible"
      class="application-drawer"
      size="min(760px, 92vw)"
      :title="drawerTitle"
      destroy-on-close
      @closed="resetWorkspace"
    >
      <div v-if="selected" v-loading="detailLoading" class="detail-workspace">
        <div class="detail-heading">
          <div>
            <small>
              申请编号 {{ selected.applicationNo || "—" }} · 合同编号
              {{ selected.contractNo || "待归档" }}
            </small>
            <h2>{{ selected.contractTitle }}</h2>
          </div>
          <div class="detail-heading-actions">
            <strong>{{ money(selected.amount) }}</strong>
            <el-button
              v-if="selected.applicantSignedFileId || selected.approvedFileId"
              type="primary"
              plain
              @click="previewApplication(selected)"
              >查看签字申请单</el-button
            >
          </div>
        </div>

        <el-alert
          v-if="mode === 'mine' && selected.status === 'rejected'"
          class="employee-rejection-alert"
          type="error"
          show-icon
          :closable="false"
          title="开票申请已被总经理驳回"
          :description="`驳回原因：${managerDecisionLog(selected)?.comment || '未填写驳回原因'}。请修改申请并重新提交，侧栏提醒将在重提后消除。`"
        />

        <el-steps
          :active="workflowStep(selected)"
          finish-status="success"
          align-center
        >
          <el-step title="员工签字提交" />
          <el-step title="总经理审批签字" />
          <el-step
            v-if="selected.materialMode === 'material_need_seal'"
            title="管理员盖章交付"
          />
          <el-step title="管理员开具发票" />
          <el-step title="财务登记匹配完成" />
        </el-steps>

        <div class="detail-amount-grid" aria-label="申请额度与正式发票匹配">
          <article>
            <span>提交时合同有效金额</span>
            <strong>{{
              money(
                selected.submittedAmounts?.currentEffectiveAmount ??
                  selected.contractAmount,
              )
            }}</strong>
          </article>
          <article>
            <span>提交时剩余可申请额度</span>
            <strong>{{
              money(selected.submittedAmounts?.remainingAmount)
            }}</strong>
          </article>
          <article>
            <span>已匹配正式发票金额</span>
            <strong>{{ money(selected.allocatedInvoiceAmount) }}</strong>
          </article>
          <article>
            <span>当前合同剩余额度</span>
            <strong>{{
              money(selected.currentAmounts?.remainingAmount)
            }}</strong>
          </article>
        </div>

        <section class="detail-section">
          <h3>申请内容</h3>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="合同分类">{{
              categoryLabel(selected.category)
            }}</el-descriptions-item>
            <el-descriptions-item label="行政区域">{{
              selected.area || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="开票金额">{{
              money(selected.amount)
            }}</el-descriptions-item>
            <el-descriptions-item label="发票类型">{{
              selected.invoiceType || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="说明及特殊情况" :span="2">{{
              selected.description || "无"
            }}</el-descriptions-item>
          </el-descriptions>
        </section>

        <section class="detail-section">
          <h3>甲方开票信息</h3>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="名称">{{
              selected.billingInfo.name || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="税号">{{
              selected.billingInfo.taxNumber || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="地址">{{
              selected.billingInfo.address || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="电话">{{
              selected.billingInfo.phone || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="开户行">{{
              selected.billingInfo.bankName || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="账号">{{
              selected.billingInfo.bankAccount || "—"
            }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{
              selected.billingInfo.remark || "无"
            }}</el-descriptions-item>
          </el-descriptions>
        </section>

        <section class="detail-section">
          <div class="detail-section-heading">
            <h3>三联单及甲方材料</h3>
            <small>共 {{ selected.materials.length }} 份材料</small>
          </div>
          <div v-if="selected.materials.length" class="material-list">
            <article v-for="material in selected.materials" :key="material.id">
              <span class="material-info">
                <el-icon><Document /></el-icon>
                <span>
                  <strong>{{ material.fileName }}</strong>
                  <small v-if="selected.category === 'main_business'">{{
                    material.isSystemGeneratedTriplicate
                      ? "系统生成第一联、第二联、第三联三页打印件"
                      : "历史三联单仅预览和打印“其他费用”工作表"
                  }}</small>
                </span>
              </span>
              <el-tag
                class="material-seal-status"
                :type="material.requiresSeal ? 'warning' : 'info'"
                size="small"
                effect="light"
              >
                {{ material.requiresSeal ? "需要盖章" : "无需盖章" }}
              </el-tag>
              <div class="material-card-actions">
                <el-button
                  link
                  type="primary"
                  @click="previewMaterial(selected, material.id)"
                  >{{
                    materialActionLabel(selected, material.mimeType)
                  }}</el-button
                >
                <el-button
                  v-if="
                    mode === 'admin' &&
                    selected.status === 'pending_seal' &&
                    material.requiresSeal
                  "
                  link
                  type="warning"
                  @click="printMaterial(selected, material.id)"
                  >{{
                    selected.category === "main_business"
                      ? material.isSystemGeneratedTriplicate
                        ? "打印三联单"
                        : "打印其他费用工作表"
                      : "下载盖章材料"
                  }}</el-button
                >
              </div>
            </article>
          </div>
          <el-empty
            v-else
            description="本次申请没有甲方材料"
            :image-size="64"
          />
        </section>

        <section
          v-if="
            workspace === 'manager' && selected.status === 'pending_approval'
          "
          class="action-workspace"
        >
          <h3>总经理审批并签字</h3>
          <el-input
            v-model="decisionComment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="批准可填写审批意见；驳回时必须填写原因"
          />
          <button
            type="button"
            class="signature-slot"
            :class="{ signed: Boolean(managerSignatureDataUrl) }"
            :disabled="signatureLoading || Boolean(managerSignatureDataUrl)"
            @click="confirmManagerSignature"
          >
            <img
              v-if="managerSignatureDataUrl"
              :src="managerSignatureDataUrl"
              alt="总经理本人电子签名"
            />
            <span v-else>{{
              signatureLoading
                ? "正在调用本人签名…"
                : "点击此处完成总经理本人签名"
            }}</span>
          </button>
          <footer>
            <el-button
              type="danger"
              plain
              :loading="actionLoading"
              @click="submitDecision('reject')"
              >驳回</el-button
            >
            <el-button
              type="success"
              :loading="actionLoading"
              :disabled="!managerSignatureDataUrl"
              @click="submitDecision('approve')"
              >签字并批准</el-button
            >
          </footer>
        </section>

        <section v-if="workspace === 'admin_seal'" class="action-workspace">
          <h3>管理员盖章交付</h3>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="只处理上方标记为“需要盖章”的材料"
            description="主营项目只打印“其他费用”工作表，完整原始 Excel 仅留作审计，不用于盖章。"
          />
          <div class="sealed-triplicate-upload">
            <div>
              <strong>盖章后三联单</strong>
              <small>上传后将作为“三联单”归档并显示在合同附件中</small>
            </div>
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              accept=".pdf,application/pdf"
              :on-change="selectSealedTriplicate"
            >
              <el-button type="primary" plain :icon="Upload">
                选择盖章后三联单
              </el-button>
            </el-upload>
          </div>
          <div v-if="sealedTriplicateFile" class="sealed-triplicate-file">
            <el-icon><Document /></el-icon>
            <span>{{ sealedTriplicateFile.name }}</span>
            <el-button
              link
              type="danger"
              :disabled="actionLoading"
              @click="clearSealedTriplicate"
            >
              移除
            </el-button>
          </div>
          <el-input
            v-model="actionNote"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="可填写盖章交付方式、时间或接收人"
          />
          <footer>
            <el-button
              type="primary"
              :loading="actionLoading"
              :disabled="!sealedTriplicateFile"
              @click="deliverMaterials"
              >确认已盖章并交付申请人</el-button
            >
          </footer>
        </section>

        <section v-if="workspace === 'admin_invoice'" class="action-workspace">
          <h3>管理员开具发票</h3>
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="此处只记录“已开具”，不上传正式发票"
            description="正式发票继续在合同详情的财务登记中上传；系统匹配足额后自动完成本申请。"
          />
          <el-descriptions v-if="selected.issuedAt" :column="1" border>
            <el-descriptions-item label="登记时间">
              {{ dateTime(selected.issuedAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="开具说明">
              {{ selected.invoiceNote || "无" }}
            </el-descriptions-item>
          </el-descriptions>
          <el-input
            v-else
            v-model="actionNote"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="可填写开具日期、发票号码或交付说明"
          />
          <footer>
            <el-button
              v-if="selected.issuedAt"
              @click="openContractFinance(selected)"
            >
              前往合同财务登记上传正式发票
            </el-button>
            <el-button
              type="primary"
              :loading="actionLoading"
              :disabled="Boolean(selected.issuedAt)"
              @click="markIssued"
              >{{
                selected.issuedAt ? "已登记开具" : "确认已开具发票"
              }}</el-button
            >
          </footer>
        </section>

        <section
          v-if="approvalFlowLogs.length || showPendingApprover"
          class="detail-section approval-flow"
        >
          <h3>审批流程</h3>
          <article v-for="log in approvalFlowLogs" :key="log.id">
            <div>
              <strong>{{ approvalActorLabel(log) }}</strong>
              <span>{{ approvalActionText(log) }}</span>
            </div>
            <time>{{ dateTime(log.createdAt) }}</time>
          </article>
          <article v-if="showPendingApprover">
            <div>
              <strong>{{ workflowPartyLabel(selected.approver) }}</strong>
              <span>待总经理审批签字</span>
            </div>
            <time>等待处理</time>
          </article>
        </section>
      </div>
    </el-drawer>

    <ContractReadOnlyPreview
      :visible="applicationPreviewVisible"
      :url="applicationPreviewUrl"
      :file-name="applicationPreviewFileName"
      mime-type="application/pdf"
      :can-download="false"
      @close="applicationPreviewVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Document,
  Refresh,
  Search,
  Tickets,
  Upload,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import ContractReadOnlyPreview from "@/components/contracts/ContractReadOnlyPreview.vue";
import type {
  InvoiceApplication,
  InvoiceApplicationAuditLog,
  InvoiceApplicationEmployeeView,
  InvoiceApplicationManagerView,
  InvoiceApplicationPartySnapshot,
  InvoiceApplicationStatus,
} from "@/types/invoiceApplication";
import { INVOICE_APPLICATION_STATUS_LABELS } from "@/types/invoiceApplication";
import {
  decideInvoiceApplication,
  deliverInvoiceApplication,
  getInvoiceApplication,
  getInvoiceApplicationErrorMessage,
  getInvoiceApplicationMaterialDownloadUrl,
  getInvoiceApplicationMaterialPrintUrl,
  getInvoiceApplicationPendingCounts,
  getInvoiceApplicationMaterialPreviewUrl,
  getInvoiceApplicationPreviewUrl,
  getInvoiceApplications,
  markInvoiceApplicationIssued,
  withdrawInvoiceApplication,
} from "@/utils/invoiceApplicationApi";
import { formatContractMoney } from "@/utils/contractPresentation";
import { requestContractDownloadBadgeRefresh } from "@/utils/contractDownloadApi";
import { uploadContractFile } from "@/utils/contractApi";
import { loadPersonalSignature } from "@/utils/personalSignature";

type CenterMode = "mine" | "manager" | "admin";
type WorkspaceMode = "detail" | "manager" | "admin_seal" | "admin_invoice";
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
  if (route.name === "InvoiceApplicationApproval") return "manager";
  if (route.name === "InvoiceApplicationTasks") return "admin";
  return "mine";
});
const employeeView = computed<InvoiceApplicationEmployeeView>(() =>
  route.query.view === "history" ? "history" : "current",
);
const managerView = computed<InvoiceApplicationManagerView>(() =>
  route.query.view === "history" ? "history" : "pending",
);
const heading = computed(() => {
  if (mode.value === "manager" && managerView.value === "history")
    return {
      title: "开票申请审批",
      description: "查看当前总经理本人已经处理的开票申请。",
      listTitle: "审批记录",
      listDescription: "按审批时间倒序，最近处理优先",
      emptyText: "当前没有开票审批记录",
    };
  if (mode.value === "manager")
    return {
      title: "开票申请审批",
      description: "总经理审批员工提交的收入合同开票申请，并完成本人电子签名。",
      listTitle: "待我审批",
      listDescription: "按提交时间升序，最早提交优先",
      emptyText: "当前没有待审批的开票申请",
    };
  if (mode.value === "admin")
    return {
      title: "开票与用印待办",
      description:
        "管理员不是审批人；只执行已批准申请的材料盖章交付和发票开具登记。",
      listTitle: "管理员开票待办",
      listDescription: "",
      emptyText: "当前没有开票或用印待办",
    };
  if (employeeView.value === "history")
    return {
      title: "我的开票及用印申请",
      description: "查看已经完成的开票及用印申请。",
      listTitle: "历史申请",
      listDescription: "",
      emptyText: "当前没有历史开票及用印申请",
    };
  return {
    title: "我的开票及用印申请",
    description: "查看草稿、审批、盖章及待开票中的当前申请。",
    listTitle: "当前申请",
    listDescription: "",
    emptyText: "当前没有进行中的开票及用印申请",
  };
});
const availableStatuses = computed<InvoiceApplicationStatus[]>(() => {
  if (mode.value === "manager")
    return [
      "pending_approval",
      "rejected",
      "pending_seal",
      "pending_invoice",
      "completed",
    ];
  if (mode.value === "admin")
    return ["pending_seal", "pending_invoice", "completed"];
  if (employeeView.value === "history") return ["completed"];
  return [
    "draft",
    "pending_approval",
    "rejected",
    "pending_seal",
    "pending_invoice",
  ];
});
const items = ref<InvoiceApplication[]>([]);
const total = ref(0);
const managerPendingCount = ref(0);
const keyword = ref("");
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const detailLoading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref("");
const statusFilter = ref<InvoiceApplicationStatus | "">("");
const selected = ref<InvoiceApplication | null>(null);
const HIDDEN_APPROVAL_FLOW_ACTIONS = new Set([
  "draft_created",
  "draft_updated",
  "material_uploaded",
  "material_deleted",
]);
const approvalFlowLogs = computed(() =>
  (selected.value?.auditLogs || []).filter(
    (log) => !HIDDEN_APPROVAL_FLOW_ACTIONS.has(log.action),
  ),
);
const showPendingApprover = computed(
  () =>
    selected.value?.status === "pending_approval" &&
    Boolean(selected.value.approver) &&
    !selected.value.approverSignedAt,
);
const detailVisible = ref(false);
const workspace = ref<WorkspaceMode>("detail");
const decisionComment = ref("");
const actionNote = ref("");
const sealedTriplicateFile = ref<File | null>(null);
const sealedTriplicateUploadedFileId = ref("");
const signatureLoading = ref(false);
const managerSignatureDataUrl = ref("");
const applicationPreviewVisible = ref(false);
const applicationPreviewUrl = ref("");
const applicationPreviewFileName = ref("");
const drawerTitle = computed(() => {
  if (workspace.value === "manager") return "审批开票申请";
  if (workspace.value === "admin_seal") return "执行材料盖章交付";
  if (workspace.value === "admin_invoice") return "登记发票已开具";
  return "开票申请详情";
});

function money(value: string | number | null | undefined) {
  return formatContractMoney(value, "¥0.00");
}
function serialNumber(index: number) {
  return (page.value - 1) * pageSize + index + 1;
}
function categoryLabel(category: InvoiceApplication["category"]) {
  return category === "main_business"
    ? "主营项目合同"
    : category === "non_main"
      ? "非主营项目合同"
      : "资产类合同";
}
function partyName(party?: InvoiceApplicationPartySnapshot | null) {
  return party?.name || "—";
}
function workflowPartyLabel(
  party?: InvoiceApplicationPartySnapshot | null,
): string {
  if (!party) return "—";
  return [party.department, party.position, party.name]
    .filter(Boolean)
    .join(" ");
}
function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
function statusTagType(status: InvoiceApplicationStatus) {
  if (status === "completed") return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "draft") return "info" as const;
  return "warning" as const;
}
function statusLabel(item: InvoiceApplication) {
  if (item.status === "pending_invoice" && item.issuedAt) {
    return "已开具，待财务登记";
  }
  return INVOICE_APPLICATION_STATUS_LABELS[item.status];
}
function workflowStep(item: InvoiceApplication) {
  const requiresSeal = item.materialMode === "material_need_seal";
  if (item.status === "completed") return requiresSeal ? 5 : 4;
  if (item.status === "pending_invoice") {
    if (item.issuedAt) return requiresSeal ? 4 : 3;
    return requiresSeal ? 3 : 2;
  }
  if (item.status === "pending_seal") return 2;
  if (item.status === "pending_approval") return 1;
  return 0;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  draft_created: "创建草稿",
  draft_updated: "更新草稿",
  material_uploaded: "上传申请材料",
  material_deleted: "删除申请材料",
  submit: "员工提交",
  withdraw: "员工撤回申请",
  approve: "总经理审批通过",
  reject: "总经理审批驳回",
  deliver: "登记盖章材料交付",
  mark_issued: "登记发票已开具",
  invoice_allocated: "匹配正式发票",
  invoice_allocation_reversed: "撤回正式发票匹配",
  auto_complete: "正式发票足额，申请自动完成",
  auto_reopen: "正式发票不足，恢复待财务登记",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

function approvalActorLabel(log: InvoiceApplicationAuditLog): string {
  if ((log.actorName || "") === "系统") return "系统";
  const department =
    log.actorName && log.actorName === selected.value?.applicant?.name
      ? selected.value?.applicant?.department || ""
      : "";
  const position = log.actorPosition || "";
  return [
    department && !position.includes(department) ? department : "",
    position,
    log.actorName || "未知人员",
  ]
    .filter(Boolean)
    .join(" ");
}

function approvalActionText(log: InvoiceApplicationAuditLog): string {
  const auditLogs = selected.value?.auditLogs || [];
  const logIndex = auditLogs.findIndex((item) => item.id === log.id);
  const isResubmission =
    log.action === "submit" &&
    logIndex > 0 &&
    auditLogs
      .slice(0, logIndex)
      .some((previousLog) => previousLog.action === "reject");
  const action = isResubmission ? "员工重新提交" : auditActionLabel(log.action);
  return log.comment ? `${action}：${log.comment}` : action;
}

function managerDecisionLog(
  item: InvoiceApplication,
): InvoiceApplicationAuditLog | undefined {
  return [...(item.auditLogs || [])]
    .reverse()
    .find((log) => log.action === "approve" || log.action === "reject");
}

async function loadApplications() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [result, pendingCounts] = await Promise.all([
      getInvoiceApplications({
        scope:
          mode.value === "manager"
            ? managerView.value === "history"
              ? "manager_processed"
              : "manager_pending"
            : mode.value,
        view: mode.value === "mine" ? employeeView.value : undefined,
        status: mode.value === "manager" ? undefined : statusFilter.value,
        keyword: mode.value === "manager" ? keyword.value.trim() : undefined,
        page: page.value,
        pageSize,
      }),
      mode.value === "manager"
        ? getInvoiceApplicationPendingCounts().catch(() => null)
        : Promise.resolve(null),
    ]);
    items.value = result.items;
    total.value = result.total;
    managerPendingCount.value = pendingCounts?.managerPending || 0;
  } catch (error) {
    items.value = [];
    total.value = 0;
    managerPendingCount.value = 0;
    errorMessage.value = getInvoiceApplicationErrorMessage(
      error,
      "获取开票申请失败",
    );
  } finally {
    loading.value = false;
  }
}

function handleFilterChange() {
  page.value = 1;
  void loadApplications();
}
function handleSearch() {
  page.value = 1;
  void loadApplications();
}
async function setManagerView(view: InvoiceApplicationManagerView) {
  if (managerView.value === view && route.query.view === view) return;
  detailVisible.value = false;
  resetWorkspace();
  statusFilter.value = "";
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
async function setEmployeeView(view: InvoiceApplicationEmployeeView) {
  if (employeeView.value === view && route.query.view === view) return;
  statusFilter.value = "";
  page.value = 1;
  await router.replace({
    query: { ...route.query, view },
  });
}
function editApplication(item: InvoiceApplication) {
  void router.push({
    path: "/invoice-applications/new",
    query: { contractId: item.contractId, applicationId: item.id },
  });
}

async function withdrawApplication(item: InvoiceApplication) {
  try {
    await ElMessageBox.confirm(
      "撤回后申请恢复为草稿，需要重新签名并提交审批。是否继续？",
      "撤回开票申请",
      {
        type: "warning",
        confirmButtonText: "确认撤回",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  actionLoading.value = true;
  try {
    await withdrawInvoiceApplication(item.id, item.version);
    ElMessage.success("开票申请已撤回，可继续修改后重新提交");
    requestContractDownloadBadgeRefresh();
    await loadApplications();
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "撤回开票申请失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}
async function loadDetail(
  item: InvoiceApplication,
  nextWorkspace: WorkspaceMode,
) {
  selected.value = item;
  workspace.value = nextWorkspace;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    selected.value = await getInvoiceApplication(item.id);
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "读取开票申请详情失败"),
    );
  } finally {
    detailLoading.value = false;
  }
}
function openDetail(item: InvoiceApplication) {
  void loadDetail(
    item,
    mode.value === "manager" &&
      managerView.value === "pending" &&
      item.status === "pending_approval"
      ? "manager"
      : "detail",
  );
}
function openAdminProcessing(item: InvoiceApplication) {
  void loadDetail(
    item,
    item.status === "pending_seal" ? "admin_seal" : "admin_invoice",
  );
}
function resetWorkspace() {
  selected.value = null;
  workspace.value = "detail";
  decisionComment.value = "";
  actionNote.value = "";
  sealedTriplicateFile.value = null;
  sealedTriplicateUploadedFileId.value = "";
  managerSignatureDataUrl.value = "";
}

function selectSealedTriplicate(file: UploadFile) {
  const rawFile = file.raw;
  if (!rawFile) return;
  if (!/\.pdf$/i.test(rawFile.name)) {
    ElMessage.warning("盖章后三联单仅支持 PDF 格式");
    return;
  }
  if (rawFile.size > 30 * 1024 * 1024) {
    ElMessage.warning("盖章后三联单单个文件不能超过 30MB");
    return;
  }
  sealedTriplicateFile.value = rawFile;
  sealedTriplicateUploadedFileId.value = "";
}

function clearSealedTriplicate() {
  sealedTriplicateFile.value = null;
  sealedTriplicateUploadedFileId.value = "";
}
function previewMaterial(item: InvoiceApplication, materialId: string) {
  const material = item.materials.find((entry) => entry.id === materialId);
  const useDownload =
    item.category === "non_main" &&
    isSpreadsheetMaterial(material?.mimeType || "");
  window.open(
    useDownload
      ? getInvoiceApplicationMaterialDownloadUrl(item.id, materialId)
      : getInvoiceApplicationMaterialPreviewUrl(item.id, materialId),
    "_blank",
    "noopener,noreferrer",
  );
}

function isSpreadsheetMaterial(mimeType: string): boolean {
  return /excel|spreadsheet|sheet/i.test(mimeType);
}

function materialActionLabel(
  item: InvoiceApplication,
  mimeType: string,
): string {
  return item.category === "non_main" && isSpreadsheetMaterial(mimeType)
    ? "下载查看"
    : "预览";
}
function previewApplication(item: InvoiceApplication) {
  const url = getInvoiceApplicationPreviewUrl(item.id);
  if (mode.value !== "mine") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  applicationPreviewUrl.value = url;
  applicationPreviewFileName.value =
    item.applicationFileName || `${item.contractTitle}-开票申请单.pdf`;
  applicationPreviewVisible.value = true;
}
function printMaterial(item: InvoiceApplication, materialId: string) {
  window.open(
    getInvoiceApplicationMaterialPrintUrl(item.id, materialId),
    "_blank",
    "noopener,noreferrer",
  );
}
function openContractFinance(item: InvoiceApplication) {
  detailVisible.value = false;
  void router.push({
    path: `/contracts/${item.contractId}`,
    query: { tab: "finance", action: "record" },
  });
}
async function confirmManagerSignature() {
  signatureLoading.value = true;
  try {
    const signature = await loadPersonalSignature();
    if (!signature) {
      ElMessage.warning("尚未设置本人电子签名，请先在个人设置中上传并锁定签名");
      return;
    }
    managerSignatureDataUrl.value = signature.dataUrl;
    ElMessage.success("总经理本人签名已确认，尚未提交审批");
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "调用总经理本人签名失败"),
    );
  } finally {
    signatureLoading.value = false;
  }
}
async function submitDecision(decision: "approve" | "reject") {
  if (!selected.value) return;
  if (decision === "reject" && !decisionComment.value.trim()) {
    ElMessage.warning("驳回时必须填写原因");
    return;
  }
  if (decision === "approve" && !managerSignatureDataUrl.value) {
    ElMessage.warning("批准前请完成总经理本人电子签名");
    return;
  }
  actionLoading.value = true;
  try {
    await decideInvoiceApplication(selected.value.id, {
      decision,
      comment: decisionComment.value.trim(),
      expectedVersion: selected.value.version,
    });
    ElMessage.success(
      decision === "approve" ? "开票申请已批准并完成签字" : "开票申请已驳回",
    );
    detailVisible.value = false;
    requestContractDownloadBadgeRefresh();
    await loadApplications();
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "处理开票申请失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}
async function deliverMaterials() {
  if (!selected.value) return;
  if (!sealedTriplicateFile.value) {
    ElMessage.warning("请先选择本次申请盖章后的三联单");
    return;
  }
  actionLoading.value = true;
  try {
    if (!sealedTriplicateUploadedFileId.value) {
      const uploaded = await uploadContractFile(
        selected.value.contractId,
        sealedTriplicateFile.value,
        "triplicate",
      );
      sealedTriplicateUploadedFileId.value = uploaded.fileId;
    }
    await deliverInvoiceApplication(
      selected.value.id,
      actionNote.value.trim(),
      selected.value.version,
      sealedTriplicateUploadedFileId.value,
    );
    ElMessage.success("盖章后三联单已归档至合同附件，下一步由管理员开具发票");
    detailVisible.value = false;
    requestContractDownloadBadgeRefresh();
    await loadApplications();
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "登记盖章交付失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}
async function markIssued() {
  if (!selected.value || selected.value.issuedAt) return;
  actionLoading.value = true;
  try {
    await markInvoiceApplicationIssued(
      selected.value.id,
      actionNote.value.trim(),
      selected.value.version,
    );
    ElMessage.success("已记录发票开具；请继续在合同财务登记上传正式发票");
    detailVisible.value = false;
    requestContractDownloadBadgeRefresh();
    await loadApplications();
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "登记发票已开具失败"),
    );
  } finally {
    actionLoading.value = false;
  }
}

watch(
  [
    mode,
    () =>
      mode.value === "mine"
        ? employeeView.value
        : mode.value === "manager"
          ? managerView.value
          : "current",
  ],
  () => {
    statusFilter.value = "";
    page.value = 1;
    void loadApplications();
  },
);
onMounted(loadApplications);
</script>

<style scoped>
.invoice-application-center {
  min-height: 100%;
  padding: 24px;
  color: #17324d;
  background: #f4f8fb;
}
.invoice-application-center.embedded {
  min-height: 0;
  padding: 0;
  background: transparent;
}
.invoice-application-center.manager-approval-page {
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
.page-heading,
.list-toolbar,
.application-item,
.detail-heading,
.detail-section-heading,
.material-list article,
.approval-flow article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-heading {
  margin-bottom: 18px;
}
.page-heading > div:last-child {
  display: flex;
  gap: 10px;
}
.page-heading span {
  color: #0d8a83;
  font-weight: 700;
}
.page-heading h1 {
  margin: 5px 0;
  font-size: 28px;
}
.page-heading p {
  margin: 0;
  color: #74869a;
}
.list-card {
  min-height: 360px;
  padding: 20px;
  border: 1px solid #dce7ee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 30px rgb(37 62 86 / 7%);
}
.list-card.approval-card {
  min-height: 300px;
  margin-top: 14px;
  padding: 19px;
  border: 1px solid #e0e7ed;
  border-radius: 13px;
  box-shadow: 0 10px 30px rgb(31 49 68 / 5%);
}
.pending-reminder {
  margin-top: 14px;
}
.manager-approval-page > :deep(.el-alert) {
  margin-top: 14px;
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
.list-toolbar {
  padding-bottom: 15px;
  border-bottom: 1px solid #e7eef2;
}
.toolbar-actions,
.employee-view-switch {
  display: flex;
  align-items: center;
}
.toolbar-actions {
  gap: 12px;
}
.employee-view-switch {
  gap: 3px;
  padding: 3px;
  border: 1px solid #dce6ea;
  border-radius: 9px;
  background: #f2f6f7;
}
.employee-view-switch button {
  padding: 6px 14px;
  border: 0;
  border-radius: 7px;
  color: #657680;
  background: transparent;
  cursor: pointer;
  font: inherit;
  transition:
    color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease;
}
.employee-view-switch button:hover,
.employee-view-switch button:focus-visible {
  color: #087b72;
  outline: none;
}
.employee-view-switch button.active {
  color: #087b72;
  background: #fff;
  box-shadow: 0 2px 8px rgb(28 91 87 / 12%);
}
.status-filter {
  width: 220px;
}
.application-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.pagination {
  justify-content: flex-end;
  margin-top: 18px;
}
.application-item {
  padding: 16px;
  border: 1px solid #dce8ed;
  border-radius: 13px;
  background: #fbfdfd;
}
.application-serial {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  color: #087d76;
  background: #e7f5f2;
  font-size: 13px;
  font-weight: 700;
}
.application-summary {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 13px;
  text-align: left;
  border: 0;
  background: none;
  cursor: pointer;
}
.summary-icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  color: #09877f;
  background: #e7f5f2;
  font-size: 22px;
}
.summary-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
  color: #51687e;
}
.manager-decision-line {
  overflow: hidden;
  color: #657989;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.employee-rejection-message {
  margin-top: 3px;
  padding: 7px 9px;
  border-left: 3px solid #d94d4d;
  border-radius: 5px;
  color: #a83232;
  background: #fff1f0;
  line-height: 1.55;
}
.employee-rejection-message strong {
  color: #c52f2f;
}
.summary-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.summary-title strong {
  overflow: hidden;
  color: #17324d;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-copy small {
  color: #8998a8;
}
.amount-block {
  display: grid;
  min-width: 170px;
  gap: 3px;
  text-align: right;
}
.amount-block span,
.amount-block small {
  color: #7d8fa1;
}
.amount-block strong {
  color: #087d76;
  font-size: 21px;
}
.item-actions {
  display: flex;
  gap: 6px;
}
.detail-workspace {
  padding: 0 4px 30px;
}
.employee-rejection-alert {
  margin-bottom: 18px;
}
.detail-heading {
  margin-bottom: 20px;
}
.detail-heading small {
  color: #8495a5;
}
.detail-heading h2 {
  margin: 5px 0 0;
  font-size: 21px;
}
.detail-heading > strong {
  color: #078178;
  font-size: 25px;
}
.detail-heading-actions {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.detail-heading-actions > strong {
  color: #078178;
  font-size: 25px;
}
.detail-section,
.action-workspace {
  margin-top: 18px;
  padding: 18px;
  border: 1px solid #dfe9ee;
  border-radius: 12px;
  background: #fff;
}
.detail-amount-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 18px;
}
.detail-amount-grid article {
  padding: 12px;
  border-radius: 9px;
  background: #f2f8f8;
}
.detail-amount-grid span {
  display: block;
  margin-bottom: 7px;
  color: #7c8e9f;
  font-size: 12px;
}
.detail-amount-grid strong {
  color: #087d76;
}
.detail-section h3,
.action-workspace h3 {
  margin: 0 0 14px;
  font-size: 17px;
}
.detail-section-heading small {
  color: #7f91a2;
}
.material-list {
  display: grid;
  gap: 8px;
}
.material-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px 16px;
  padding: 12px;
  border-radius: 9px;
  background: #f5f9fa;
}
.material-info {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.material-info > span {
  display: grid;
  gap: 2px;
}
.material-card-actions {
  display: flex;
  grid-column: 1 / -1;
  width: 100%;
  flex: 0 0 auto;
  min-height: 30px;
  margin-left: 0;
  padding-top: 8px;
  align-items: center;
  justify-content: flex-end;
  justify-self: stretch;
  gap: 8px;
  border-top: 1px solid #dfe9ec;
  background: transparent;
  box-shadow: none;
  white-space: nowrap;
}
.material-seal-status {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
}
.material-card-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.material-list small {
  color: #8697a8;
}
.signature-slot {
  display: flex;
  width: 100%;
  min-height: 110px;
  margin-top: 14px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px dashed #7fc7c2;
  border-radius: 11px;
  color: #087d76;
  background: #f2faf9;
  cursor: pointer;
}
.signature-slot img {
  max-width: 210px;
  max-height: 70px;
}
.signature-slot.signed {
  border-style: solid;
  cursor: default;
}
.action-workspace :deep(.el-alert),
.action-workspace :deep(.el-textarea) {
  margin-bottom: 14px;
}
.sealed-triplicate-upload {
  display: flex;
  margin-bottom: 12px;
  padding: 14px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 1px dashed #8bc9c4;
  border-radius: 10px;
  background: #f5fbfa;
}
.sealed-triplicate-upload > div {
  display: grid;
  gap: 4px;
}
.sealed-triplicate-upload small {
  color: #7d8f9f;
}
.sealed-triplicate-file {
  display: flex;
  margin-bottom: 14px;
  padding: 10px 12px;
  align-items: center;
  gap: 9px;
  border-radius: 8px;
  color: #176f70;
  background: #edf8f7;
}
.sealed-triplicate-file span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-workspace footer {
  display: flex;
  margin-top: 24px;
  justify-content: flex-end;
  gap: 8px;
}
.approval-flow article {
  padding: 10px 0;
  border-top: 1px dashed #dce7ec;
}
.approval-flow article > div {
  display: grid;
  gap: 3px;
}
.approval-flow article span,
.approval-flow time {
  color: #8797a7;
}
@media (max-width: 800px) {
  .invoice-application-center {
    padding: 12px;
  }
  .page-heading,
  .approval-hero,
  .hero-actions,
  .card-heading,
  .application-item {
    align-items: stretch;
    flex-direction: column;
  }
  .invoice-application-center.manager-approval-page {
    margin: -12px;
    padding: 12px;
  }
  .search-input {
    width: 100%;
  }
  .page-heading > div:last-child,
  .item-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .amount-block {
    text-align: left;
  }
  .detail-amount-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
