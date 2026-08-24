<template>
  <section
    class="contract-approval-workspace"
    :class="{ 'is-manager-signature': managerSealApplicationRequired }"
    :aria-busy="workspaceBusy"
    :aria-label="
      managerSealApplicationRequired ? '用印申请单审批签署' : workspaceTitle
    "
  >
    <header v-if="!managerSealApplicationRequired" class="workspace-heading">
      <el-button
        type="primary"
        plain
        :disabled="actionLoading"
        @click="requestClose"
      >
        {{ closeLabel }}
      </el-button>
      <div>
        <span>合同审批工作区</span>
        <h2 id="contract-approval-workspace-title">{{ workspaceTitle }}</h2>
        <small>审批材料、本人签名与处理意见均在当前页面完成</small>
      </div>
    </header>

    <div
      class="workspace-content"
      :class="{ 'manager-document-only': managerSealApplicationRequired }"
    >
      <section v-if="isSupplement" class="supplement-context">
        <div class="supplement-context-heading">
          <el-tag type="warning" effect="dark">补充协议审批</el-tag>
          <el-tag
            v-if="isPaymentTermsOnlySupplement"
            type="success"
            effect="light"
          >
            仅变更付款方式
          </el-tag>
          <strong>{{ contract.name || contract.projectName }}</strong>
        </div>
        <p>所属主合同：{{ contract.parentContractName || "主合同" }}</p>
        <div class="supplement-amount-flow" aria-label="补充协议金额变化">
          <span>
            <small>变更前合同金额</small>
            <b>{{ formatContractMoney(contract.amountBeforeChange, "—") }}</b>
          </span>
          <i>{{ supplementOperator }}</i>
          <span>
            <small>{{ supplementAdjustmentLabel }}</small>
            <b>{{ formatContractMoney(supplementAmountDelta) }}</b>
          </span>
          <i>＝</i>
          <span class="is-final">
            <small>变更后合同金额（回款口径）</small>
            <b>{{ formatContractMoney(supplementAfterAmount, "—") }}</b>
          </span>
        </div>
      </section>

      <template v-if="managerSealApplicationRequired">
        <el-alert
          v-if="sealApplicationError"
          type="error"
          show-icon
          :closable="false"
          :title="sealApplicationError"
        >
          <template v-if="managerApprovalCompleted" #default>
            <el-button
              type="danger"
              link
              :loading="sealApplicationLoading"
              @click="reloadApprovedSealApplication"
            >
              重新加载用印申请单
            </el-button>
          </template>
        </el-alert>

        <ContractSealApplicationApprovalPreview
          v-else
          :url="sealApplicationPreviewUrl"
          :loading="sealApplicationLoading"
          :signable="!managerApprovalCompleted"
          :disabled="!canApprove || actionLoading"
          :signature-loading="managerSignatureLoading"
          :signature-data-url="managerSignatureDataUrl"
          :signature-error="managerSignatureError"
          @sign="signManagerApprovalArea"
        />
      </template>

      <template v-else>
        <div v-if="!isSupplement" class="workspace-contract">
          <span>{{ contract.name || contract.projectName }}</span>
          <strong>{{ formatContractMoney(approvalAmount) }}</strong>
        </div>

        <el-alert
          v-if="!canApprove"
          type="error"
          show-icon
          :closable="false"
          title="当前账号不是本轮锁定的目标审批人"
          description="请刷新合同详情；审批权限以服务端当前待处理轮次为准。"
        />

        <section
          v-if="isSealDifferenceReview"
          v-loading="sealReviewLoading"
          class="seal-difference-review"
        >
          <el-alert
            type="warning"
            show-icon
            :closable="false"
            title="这是盖章版关键差异复审"
            description="请逐项核对审批版本与盖章版本；复审通过后财务仍需执行最终归档，合同才会生效。"
          />
          <el-alert
            v-if="sealReviewError"
            type="error"
            show-icon
            :closable="false"
            :title="sealReviewError"
          />
          <template v-else-if="sealVerification">
            <p
              v-if="sealVerification.differenceExplanation"
              class="difference-explanation"
            >
              差异说明：{{ sealVerification.differenceExplanation }}
            </p>
            <div
              v-for="mismatch in sealVerification.mismatches"
              :key="mismatch.field"
              class="difference-row"
            >
              <strong>{{ mismatch.label }}</strong>
              <span>审批版：{{ mismatch.approvedValue || "—" }}</span>
              <span>盖章版：{{ mismatch.sealedValue || "—" }}</span>
            </div>
          </template>
        </section>

        <el-form v-if="!managerApprovalCompleted" label-position="top">
          <el-form-item
            :label="approvalAction === 'reject' ? '驳回原因' : '审批意见'"
            :required="approvalAction === 'reject'"
          >
            <el-input
              v-model="comment"
              type="textarea"
              :rows="4"
              maxlength="500"
              show-word-limit
              :placeholder="
                approvalAction === 'reject'
                  ? '请说明驳回原因'
                  : '可填写审批意见'
              "
            />
          </el-form-item>
        </el-form>
      </template>
    </div>

    <footer class="workspace-actions">
      <el-button
        v-if="managerApprovalCompleted"
        type="primary"
        @click="requestClose"
      >
        完成并{{ closeLabel }}
      </el-button>
      <template v-else>
        <el-button :disabled="actionLoading" @click="requestClose"
          >取消</el-button
        >
        <el-button
          :type="approvalAction === 'approve' ? 'success' : 'danger'"
          :loading="actionLoading"
          :disabled="approvalConfirmDisabled"
          @click="submitApproval"
        >
          {{ confirmLabel }}
        </el-button>
      </template>
    </footer>

    <span class="sr-live" aria-live="polite">{{ liveStatus }}</span>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import ContractSealApplicationApprovalPreview from "@/components/contracts/ContractSealApplicationApprovalPreview.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractApprovalAction,
  ContractListItem,
  ContractSealApplication,
  ContractSealVerification,
} from "@/types/contract";
import {
  approveContract,
  getContractErrorMessage,
  getContractFileUrl,
  getContractSealApplication,
  getLatestSealedContractVerification,
} from "@/utils/contractApi";
import { formatContractMoney } from "@/utils/contractPresentation";
import { loadPersonalSignatureState } from "@/utils/personalSignature";

const props = defineProps<{
  contract: ContractListItem;
  initialAction: ContractApprovalAction;
  closeLabel: string;
}>();

const emit = defineEmits<{
  close: [];
  completed: [payload: { keepOpen: boolean }];
}>();

const authStore = useAuthStore();
const actionLoading = ref(false);
const sealVerification = ref<ContractSealVerification | null>(null);
const sealApplication = ref<ContractSealApplication | null>(null);
const sealReviewLoading = ref(false);
const sealReviewError = ref("");
const sealApplicationLoading = ref(false);
const sealApplicationError = ref("");
const managerSignatureLoading = ref(false);
const managerSignatureError = ref("");
const managerSignatureDataUrl = ref("");
const managerSignatureOwner = ref("");
const managerSignatureUpdatedAt = ref<string | null>(null);
const managerApprovalCompleted = ref(false);
const comment = ref("");
const liveStatus = ref("");
let workspaceSequence = 0;

const approvalAction = computed(() => props.initialAction);
const canApprove = computed(
  () =>
    Boolean(authStore.user?.id) &&
    props.contract.status === "approving" &&
    props.contract.approvalTargetId === authStore.user?.id,
);
const isTermination = computed(
  () => props.contract.pendingAction === "termination",
);
const isSupplement = computed(
  () => props.contract.relationType === "supplement",
);
const isPaymentTermsOnlySupplement = computed(
  () => props.contract.supplementChangeType === "payment_terms_only",
);
const supplementAmountDelta = computed(() =>
  isPaymentTermsOnlySupplement.value ? 0 : props.contract.amount,
);
const supplementAfterAmount = computed(
  () =>
    props.contract.amountAfterChange ??
    props.contract.currentEffectiveAmount ??
    props.contract.amountBeforeChange,
);
const supplementOperator = computed(() => {
  if (isPaymentTermsOnlySupplement.value) return "→";
  return Number(props.contract.amount || 0) < 0 ? "−" : "＋";
});
const supplementAdjustmentLabel = computed(() =>
  isPaymentTermsOnlySupplement.value
    ? "本次增减（付款方式）"
    : Number(props.contract.amount || 0) < 0
      ? "本次核减"
      : "本次增加",
);
const isSealDifferenceReview = computed(
  () =>
    props.contract.pendingAction === "seal" &&
    props.contract.previousStatus === "pending_seal",
);
const requiresManagerSignature = computed(
  () =>
    props.contract.approvalTargetSource === "general_manager" &&
    props.contract.pendingAction !== "termination" &&
    !isSealDifferenceReview.value,
);
const managerSealApplicationRequired = computed(
  () => approvalAction.value === "approve" && requiresManagerSignature.value,
);
const approvalAmount = computed(() => {
  if (isTermination.value && props.contract.relationType === "main") {
    return props.contract.currentAmount ?? props.contract.amount;
  }
  return props.contract.amount;
});
const sealApplicationPreviewUrl = computed(() => {
  const fileId = managerApprovalCompleted.value
    ? sealApplication.value?.approvedFileId
    : sealApplication.value?.signedFileId;
  return fileId ? `${getContractFileUrl(fileId)}#page=1&view=Fit` : "";
});
const workspaceBusy = computed(
  () =>
    actionLoading.value ||
    sealReviewLoading.value ||
    sealApplicationLoading.value ||
    managerSignatureLoading.value,
);
const approvalConfirmDisabled = computed(
  () =>
    !canApprove.value ||
    actionLoading.value ||
    (managerSealApplicationRequired.value &&
      (managerApprovalCompleted.value ||
        sealApplicationLoading.value ||
        Boolean(sealApplicationError.value) ||
        !sealApplicationPreviewUrl.value ||
        managerSignatureLoading.value ||
        Boolean(managerSignatureError.value) ||
        !managerSignatureDataUrl.value)) ||
    (isSealDifferenceReview.value &&
      (sealReviewLoading.value ||
        Boolean(sealReviewError.value) ||
        !sealVerification.value)),
);
const workspaceTitle = computed(() => {
  if (managerApprovalCompleted.value) return "审批与签名已完成";
  if (isTermination.value) {
    return approvalAction.value === "approve" ? "同意终止合同" : "驳回终止申请";
  }
  if (isSealDifferenceReview.value) {
    return approvalAction.value === "approve"
      ? "同意盖章版关键差异"
      : "驳回盖章版关键差异";
  }
  if (isSupplement.value) {
    return approvalAction.value === "approve"
      ? "审批通过补充协议"
      : "审批驳回补充协议";
  }
  return approvalAction.value === "approve" ? "审批通过合同" : "审批驳回合同";
});
const confirmLabel = computed(() => {
  if (isTermination.value) {
    return approvalAction.value === "approve" ? "确认终止" : "驳回终止";
  }
  if (isSealDifferenceReview.value) {
    return approvalAction.value === "approve" ? "确认同意差异" : "确认驳回差异";
  }
  if (managerSealApplicationRequired.value) return "确认审批并签名";
  return approvalAction.value === "approve" ? "确认通过" : "确认驳回";
});

function resetWorkspaceState() {
  sealVerification.value = null;
  sealApplication.value = null;
  sealReviewLoading.value = false;
  sealReviewError.value = "";
  sealApplicationLoading.value = false;
  sealApplicationError.value = "";
  managerSignatureLoading.value = false;
  managerSignatureError.value = "";
  managerSignatureDataUrl.value = "";
  managerSignatureOwner.value = "";
  managerSignatureUpdatedAt.value = null;
  managerApprovalCompleted.value = false;
  comment.value = "";
  liveStatus.value = "";
}

function isCurrentWorkspace(sequence: number, contractId: string) {
  return sequence === workspaceSequence && props.contract.id === contractId;
}

async function loadManagerSignaturePreview(
  sequence: number,
  contractId: string,
) {
  managerSignatureLoading.value = true;
  managerSignatureError.value = "";
  try {
    const state = await loadPersonalSignatureState();
    if (!isCurrentWorkspace(sequence, contractId)) return;
    if (!state.status.locked) {
      managerSignatureError.value = "请先前往个人设置上传并锁定本人电子签名";
      return;
    }
    if (!state.status.hasSignature || !state.signature) {
      managerSignatureError.value =
        "本人电子签名文件不可用，请联系系统管理员处理";
      return;
    }
    managerSignatureDataUrl.value = state.signature.dataUrl;
    managerSignatureOwner.value = state.signature.ownerName;
    managerSignatureUpdatedAt.value = state.signature.updatedAt;
    liveStatus.value = "本人电子签名已显示在审批签署区，请核对后确认审批";
  } catch (error) {
    if (!isCurrentWorkspace(sequence, contractId)) return;
    managerSignatureError.value = getContractErrorMessage(
      error,
      "本人电子签名加载失败，请稍后重试",
    );
  } finally {
    if (isCurrentWorkspace(sequence, contractId)) {
      managerSignatureLoading.value = false;
    }
  }
}

async function signManagerApprovalArea() {
  const contractId = props.contract.id;
  if (
    !canApprove.value ||
    !managerSealApplicationRequired.value ||
    managerApprovalCompleted.value ||
    actionLoading.value ||
    sealApplicationLoading.value ||
    managerSignatureLoading.value ||
    Boolean(managerSignatureDataUrl.value)
  ) {
    return;
  }
  managerSignatureDataUrl.value = "";
  managerSignatureOwner.value = "";
  managerSignatureUpdatedAt.value = null;
  await loadManagerSignaturePreview(workspaceSequence, contractId);
}

async function loadSealApplicationPreview(
  contractId: string,
  requireApprovedFile: boolean,
  sequence = workspaceSequence,
) {
  sealApplicationLoading.value = true;
  sealApplicationError.value = "";
  try {
    const application = await getContractSealApplication(contractId);
    if (!isCurrentWorkspace(sequence, contractId)) return;
    sealApplication.value = application;
    if (requireApprovedFile) {
      if (!application.fullySigned || !application.approvedFileId) {
        sealApplicationError.value =
          "审批签名已完成，但最终双签文件尚未就绪，请重新加载";
      }
      return;
    }
    if (application.fullySigned && application.approvedFileId) {
      managerApprovalCompleted.value = true;
      managerSignatureDataUrl.value = "";
      managerSignatureOwner.value = "";
      managerSignatureUpdatedAt.value = null;
      liveStatus.value = "合同审批与总经理电子签名已完成";
      emit("completed", { keepOpen: true });
      return;
    }
    if (!application.signedFileId) {
      sealApplicationError.value =
        "当前用印申请单缺少申请人签署文件，暂不能审批通过";
    }
  } catch (error) {
    if (!isCurrentWorkspace(sequence, contractId)) return;
    sealApplicationError.value = getContractErrorMessage(
      error,
      requireApprovedFile
        ? "审批签名已完成，但最终双签文件加载失败"
        : "用印申请单加载失败，请核对后再审批",
    );
  } finally {
    if (isCurrentWorkspace(sequence, contractId)) {
      sealApplicationLoading.value = false;
    }
  }
}

async function reloadApprovedSealApplication() {
  if (!managerApprovalCompleted.value) return;
  await loadSealApplicationPreview(props.contract.id, true);
}

async function recoverCompletedManagerApproval(
  contractId: string,
  sequence: number,
) {
  try {
    const application = await getContractSealApplication(contractId);
    if (!isCurrentWorkspace(sequence, contractId)) return false;
    if (!application.fullySigned || !application.approvedFileId) return false;
    sealApplication.value = application;
    managerApprovalCompleted.value = true;
    managerSignatureDataUrl.value = "";
    managerSignatureOwner.value = "";
    managerSignatureUpdatedAt.value = null;
    sealApplicationError.value = "";
    liveStatus.value = "合同审批与总经理电子签名已完成";
    emit("completed", { keepOpen: true });
    return true;
  } catch {
    return false;
  }
}

async function loadSealDifferenceReview(contractId: string, sequence: number) {
  sealReviewLoading.value = true;
  sealReviewError.value = "";
  try {
    const verification = await getLatestSealedContractVerification(contractId);
    if (!isCurrentWorkspace(sequence, contractId)) return;
    sealVerification.value = verification;
  } catch (error) {
    if (!isCurrentWorkspace(sequence, contractId)) return;
    sealReviewError.value = getContractErrorMessage(
      error,
      "盖章版差异加载失败，请核对后再审批",
    );
  } finally {
    if (isCurrentWorkspace(sequence, contractId)) {
      sealReviewLoading.value = false;
    }
  }
}

async function initializeWorkspace() {
  const sequence = ++workspaceSequence;
  const contractId = props.contract.id;
  resetWorkspaceState();
  if (!contractId || !canApprove.value) return;
  if (managerSealApplicationRequired.value) {
    await loadSealApplicationPreview(contractId, false, sequence);
    if (managerApprovalCompleted.value) {
      managerSignatureDataUrl.value = "";
      managerSignatureOwner.value = "";
      managerSignatureUpdatedAt.value = null;
    }
    return;
  }
  if (isSealDifferenceReview.value) {
    await loadSealDifferenceReview(contractId, sequence);
  }
}

function successMessage(action: ContractApprovalAction) {
  if (isTermination.value) {
    return action === "approve"
      ? "合同已终止"
      : "终止申请已驳回，合同已恢复申请前状态";
  }
  if (isSealDifferenceReview.value) {
    return action === "approve"
      ? "盖章版关键差异已通过复审"
      : "盖章版关键差异已拒绝，合同已进入已拒绝终态";
  }
  return action === "approve" ? "合同审批已通过" : "合同已拒绝";
}

async function submitApproval() {
  if (!canApprove.value || approvalConfirmDisabled.value) return;
  if (approvalAction.value === "reject" && !comment.value.trim()) {
    ElMessage.warning("请填写驳回原因");
    return;
  }
  const contractId = props.contract.id;
  const sequence = workspaceSequence;
  const currentAction = approvalAction.value;
  const completesManagerSignature = managerSealApplicationRequired.value;
  actionLoading.value = true;
  try {
    await approveContract(contractId, currentAction, comment.value.trim());
    if (!isCurrentWorkspace(sequence, contractId)) return;
    if (completesManagerSignature) {
      managerApprovalCompleted.value = true;
      managerSignatureDataUrl.value = "";
      managerSignatureOwner.value = "";
      managerSignatureUpdatedAt.value = null;
      liveStatus.value = "合同审批与总经理电子签名已完成";
      ElMessage.success("合同审批与电子签名已完成");
      emit("completed", { keepOpen: true });
      await loadSealApplicationPreview(contractId, true, sequence);
      return;
    }
    ElMessage.success(successMessage(currentAction));
    emit("completed", { keepOpen: false });
  } catch (error) {
    if (
      completesManagerSignature &&
      (await recoverCompletedManagerApproval(contractId, sequence))
    ) {
      ElMessage.success("审批已完成，已恢复最终双签结果");
      return;
    }
    ElMessage.error(getContractErrorMessage(error, "合同审批处理失败"));
  } finally {
    if (isCurrentWorkspace(sequence, contractId)) {
      actionLoading.value = false;
    }
  }
}

function requestClose() {
  if (actionLoading.value) return;
  emit("close");
}

watch(
  () => [
    props.contract.id,
    props.contract.approvalRoundId,
    props.contract.approvalTargetId,
    props.initialAction,
    authStore.user?.id,
  ],
  () => void initializeWorkspace(),
  { immediate: true },
);

onBeforeUnmount(() => {
  workspaceSequence += 1;
});
</script>

<style scoped>
.contract-approval-workspace {
  min-height: 520px;
  padding: 22px;
  border: 1px solid #dfe7ee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 30px rgb(31 55 78 / 7%);
  color: #1d354b;
  scroll-margin-top: 16px;
}
.contract-approval-workspace.is-manager-signature {
  min-height: 0;
  padding: 18px;
}
.workspace-heading {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: -2px -2px 18px;
  padding: 0 0 16px;
  border-bottom: 1px solid #e3ebe9;
}
.workspace-heading > div {
  min-width: 0;
}
.workspace-heading span,
.workspace-heading small {
  display: block;
  color: #7c8d98;
  font-size: 12px;
}
.workspace-heading h2 {
  margin: 3px 0;
  color: #244960;
  font-size: 20px;
}
.workspace-content,
.workspace-actions {
  width: min(980px, 100%);
  margin-right: auto;
  margin-left: auto;
}
.manager-document-only {
  width: min(900px, 100%);
}
.supplement-context {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #efcf98;
  border-radius: 12px;
  background: linear-gradient(135deg, #fffaf0, #fffdf9);
}
.supplement-context-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.supplement-context-heading strong {
  overflow-wrap: anywhere;
  color: #744817;
  font-size: 16px;
}
.supplement-context p {
  margin: 9px 0 12px;
  color: #806846;
  font-size: 12px;
}
.supplement-amount-flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1.2fr;
  align-items: stretch;
  gap: 8px;
}
.supplement-amount-flow > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid #eadcc6;
  border-radius: 9px;
  background: #fff;
}
.supplement-amount-flow > i {
  align-self: center;
  color: #b98a4c;
  font-size: 18px;
  font-style: normal;
}
.supplement-amount-flow small {
  color: #8d806e;
  font-size: 11px;
}
.supplement-amount-flow b {
  color: #4a5e68;
  font-size: 17px;
}
.supplement-amount-flow .is-final {
  border-color: #8ac9be;
  background: #eff9f6;
}
.supplement-amount-flow .is-final b {
  color: #147b73;
}
.workspace-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid #e3ebe9;
}
.workspace-actions :deep(.el-button) {
  min-width: 116px;
  margin: 0;
}
.workspace-contract {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 15px;
  padding: 13px;
  border-radius: 10px;
  background: #eef6f5;
  color: #4f6874;
}
.workspace-contract span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.workspace-contract strong {
  flex: none;
  color: #177b80;
}
.seal-difference-review {
  display: grid;
  min-height: 70px;
  gap: 10px;
  margin-bottom: 14px;
}
.difference-explanation {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff8eb;
  color: #7d5b22;
  font-size: 13px;
}
.difference-row {
  display: grid;
  grid-template-columns: minmax(80px, 0.4fr) 1fr 1fr;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid #f1d6aa;
  border-radius: 8px;
  background: #fffbf4;
  font-size: 12px;
}
.difference-row strong {
  color: #7a541c;
}
.difference-row span {
  overflow-wrap: anywhere;
  color: #6f7479;
}
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

@media (max-width: 640px) {
  .contract-approval-workspace {
    min-height: 0;
    padding: 16px;
  }
  .workspace-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .workspace-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }
  .workspace-actions :deep(.el-button) {
    width: 100%;
  }
  .difference-row {
    grid-template-columns: 1fr;
  }
  .supplement-amount-flow {
    grid-template-columns: 1fr;
  }
  .supplement-amount-flow > i {
    display: none;
  }
}
</style>
