<template>
  <div class="download-request-create">
    <header class="page-heading">
      <div>
        <span>合同下载申请</span>
        <h1>{{ isResubmission ? "修改并重新提交" : "申请下载合同附件" }}</h1>
        <p>
          {{
            isResubmission
              ? "请根据驳回或撤回情况重新选择附件、修改用途并完成本人签名。"
              : "申请表信息由系统自动生成；请勾选文件、填写用途并完成本人签名。"
          }}
        </p>
      </div>
      <el-button @click="returnToSource"> 返回我的申请 </el-button>
    </header>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      show-icon
      :closable="false"
    />

    <section v-loading="loading" class="application-card">
      <template v-if="detail">
        <div class="application-title">
          <div>
            <small>在线申请表</small>
            <h2>合同附件下载申请单</h2>
          </div>
          <el-tag type="warning" effect="light">
            {{ isResubmission ? "待重新签署" : "待申请人签署" }}
          </el-tag>
        </div>

        <el-alert
          v-if="isResubmission && resubmitSource"
          type="info"
          :closable="false"
          show-icon
          class="resubmit-alert"
          :title="`正在修改第 ${resubmitSource.attemptNo} 次申请；提交后将作为同一申请链的第 ${resubmitSource.attemptNo + 1} 次申请重新进入总经理审批。`"
          :description="resubmitReason"
        />

        <el-descriptions :column="2" border class="contract-summary">
          <el-descriptions-item label="申请人">
            {{ authStore.user?.name || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="申请时间">
            提交后由系统生成
          </el-descriptions-item>
          <el-descriptions-item label="合同编号">
            {{ detail.contract.contractNo || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="合同名称">
            {{ detail.contract.contractName || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="行政区域">
            {{ detail.contract.area || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="合同当前状态">
            {{ contractStatusLabel }}
          </el-descriptions-item>
        </el-descriptions>

        <section class="form-section">
          <div class="section-heading">
            <div>
              <strong>申请下载的具体附件</strong>
              <span>系统已按合同当前状态列出可申请的文件，可多选。</span>
            </div>
            <b>已选择 {{ selectedFileIds.length }} 份</b>
          </div>
          <el-checkbox-group v-model="selectedFileIds" class="file-options">
            <label
              v-for="file in eligibleFiles"
              :key="file.id"
              class="file-option"
            >
              <el-checkbox :value="file.id">
                <span class="file-copy">
                  <strong>{{ file.fileName }}</strong>
                  <small>{{ file.fileTypeLabel }}</small>
                </span>
              </el-checkbox>
              <el-button link type="primary" @click.prevent="previewFile(file)">
                在线预览
              </el-button>
            </label>
          </el-checkbox-group>
          <el-empty
            v-if="!eligibleFiles.length"
            description="当前合同状态下暂无可申请下载的附件"
            :image-size="72"
          />
        </section>

        <section class="form-section">
          <el-form label-position="top">
            <el-form-item label="下载用途" required>
              <el-input
                v-model="purpose"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
                placeholder="请如实填写合同附件的具体使用目的"
              />
            </el-form-item>
          </el-form>
        </section>

        <section class="signature-section">
          <div class="section-heading">
            <div>
              <strong>申请人电子签名</strong>
              <span>点击签署区域调用当前账号已锁定的本人签名。</span>
            </div>
          </div>
          <button
            type="button"
            class="signature-slot"
            :class="{ signed: Boolean(signatureDataUrl) }"
            :disabled="signatureLoading || Boolean(signatureDataUrl)"
            @click="confirmPersonalSignature"
          >
            <img
              v-if="signatureDataUrl"
              :src="signatureDataUrl"
              alt="申请人本人电子签名"
            />
            <span v-else>
              {{
                signatureLoading ? "正在调用本人签名…" : "点击此处完成本人签名"
              }}
            </span>
            <small>{{
              signatureOwner || authStore.user?.name || "申请人本人"
            }}</small>
          </button>
        </section>

        <section class="flow-section" aria-label="下载申请流程">
          <strong>申请流程</strong>
          <div class="flow-line">
            <span class="active"
              >员工 {{ authStore.user?.name || "申请人" }}</span
            >
            <i>→</i>
            <span>总经理 刘行</span>
            <i>→</i>
            <span>管理员 吴静雯</span>
            <i>→</i>
            <span>申请完成</span>
          </div>
          <small>下一步：提交后等待“总经理 刘行”审批</small>
        </section>

        <footer class="submit-bar">
          <span>{{ submitHint }}</span>
          <el-button
            type="primary"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submitRequest"
          >
            {{ isResubmission ? "签名并重新提交" : "签名并提交申请" }}
          </el-button>
        </footer>
      </template>
    </section>

    <ContractReadOnlyPreview
      :visible="readonlyPreviewVisible"
      :url="readonlyPreviewUrl"
      :file-name="readonlyPreviewFileName"
      :mime-type="readonlyPreviewMimeType"
      @close="readonlyPreviewVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import ContractReadOnlyPreview from "@/components/contracts/ContractReadOnlyPreview.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  AvailableContractDownloadFiles,
  ContractDownloadRequest,
} from "@/types/contractDownload";
import { getContractFileUrl } from "@/utils/contractApi";
import {
  createContractDownloadRequest,
  getAvailableContractDownloadFiles,
  getContractDownloadRequest,
  getContractDownloadRequestErrorMessage,
  resubmitContractDownloadRequest,
} from "@/utils/contractDownloadApi";
import { loadPersonalSignature } from "@/utils/personalSignature";
import { CONTRACT_STATUS_LABELS } from "@/utils/contractPresentation";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const detail = ref<AvailableContractDownloadFiles | null>(null);
const resubmitSource = ref<ContractDownloadRequest | null>(null);
const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const purpose = ref("");
const selectedFileIds = ref<string[]>([]);
const signatureLoading = ref(false);
const signatureDataUrl = ref("");
const signatureOwner = ref("");
const readonlyPreviewVisible = ref(false);
const readonlyPreviewUrl = ref("");
const readonlyPreviewFileName = ref("");
const readonlyPreviewMimeType = ref("");

const resubmitRequestId = computed(() =>
  String(route.query.resubmitRequestId || "").trim(),
);
const isResubmission = computed(() => Boolean(resubmitRequestId.value));

const eligibleFiles = computed(() => detail.value?.files || []);
const contractStatusLabel = computed(() =>
  detail.value ? CONTRACT_STATUS_LABELS[detail.value.contract.status] : "—",
);
const canSubmit = computed(
  () =>
    (!isResubmission.value || Boolean(resubmitSource.value?.canResubmit)) &&
    selectedFileIds.value.length > 0 &&
    purpose.value.trim().length > 0 &&
    Boolean(signatureDataUrl.value),
);
const submitHint = computed(() => {
  if (isResubmission.value && !resubmitSource.value?.canResubmit) {
    return "该申请状态已发生变化，请返回我的申请刷新后重试";
  }
  if (!selectedFileIds.value.length) return "请至少选择一份合同附件";
  if (!purpose.value.trim()) return "请填写下载用途";
  if (!signatureDataUrl.value) return "请由申请人本人点击签署区域完成签名";
  return isResubmission.value
    ? "修改内容和签名已完整，重新提交后进入总经理审批"
    : "申请信息已完整，提交后进入总经理审批";
});
const resubmitReason = computed(() => {
  if (!resubmitSource.value) return "";
  if (
    resubmitSource.value.status === "rejected" &&
    resubmitSource.value.approver.comment
  ) {
    return `总经理驳回原因：${resubmitSource.value.approver.comment}`;
  }
  return "原申请已撤回，可调整申请内容后重新提交。";
});

function returnToSource() {
  void router.push("/contract-applications/mine?tab=download");
}

function previewFile(file: AvailableContractDownloadFiles["files"][number]) {
  readonlyPreviewUrl.value = getContractFileUrl(file.id);
  readonlyPreviewFileName.value = file.fileName;
  readonlyPreviewMimeType.value = file.mimeType;
  readonlyPreviewVisible.value = true;
}

async function confirmPersonalSignature() {
  signatureLoading.value = true;
  try {
    const signature = await loadPersonalSignature();
    if (!signature) {
      ElMessage.warning("尚未设置本人电子签名，请先在个人设置中上传并锁定签名");
      return;
    }
    signatureDataUrl.value = signature.dataUrl;
    signatureOwner.value = signature.ownerName;
    ElMessage.success("本人签名已确认，尚未提交申请");
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "调用本人电子签名失败"),
    );
  } finally {
    signatureLoading.value = false;
  }
}

async function submitRequest() {
  if (!detail.value || !canSubmit.value) return;
  submitting.value = true;
  try {
    if (isResubmission.value && resubmitSource.value) {
      await resubmitContractDownloadRequest(resubmitSource.value.id, {
        fileIds: selectedFileIds.value,
        purpose: purpose.value.trim(),
        expectedVersion: resubmitSource.value.version,
      });
      ElMessage.success("下载申请已重新提交，下一步由总经理审批");
    } else {
      await createContractDownloadRequest({
        contractId: detail.value.contract.id,
        fileIds: selectedFileIds.value,
        purpose: purpose.value.trim(),
      });
      ElMessage.success("下载申请已提交，下一步由总经理刘行审批");
    }
    await router.push("/contract-applications/mine?tab=download");
  } catch (error) {
    ElMessage.error(
      getContractDownloadRequestErrorMessage(error, "提交合同下载申请失败"),
    );
  } finally {
    submitting.value = false;
  }
}

async function loadContract() {
  let contractId = String(route.query.contractId || "").trim();
  let sourceRequest: ContractDownloadRequest | null = null;
  if (isResubmission.value) {
    try {
      sourceRequest = await getContractDownloadRequest(resubmitRequestId.value);
      contractId = sourceRequest.contractId;
    } catch (error) {
      errorMessage.value = getContractDownloadRequestErrorMessage(
        error,
        "读取原下载申请失败",
      );
      return;
    }
  }
  if (!contractId) {
    errorMessage.value = "缺少需要申请下载的合同编号";
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  try {
    detail.value = await getAvailableContractDownloadFiles(contractId);
    if (detail.value.contract.area === "全部") {
      throw new Error("全域合同仅限总经理和管理员查看，员工不能提交下载申请");
    }
    if (sourceRequest) {
      resubmitSource.value = sourceRequest;
      purpose.value = sourceRequest.purpose;
      const availableIds = new Set(detail.value.files.map((file) => file.id));
      const previousFileIds = sourceRequest.files.map(
        (file) => file.contractFileId,
      );
      selectedFileIds.value = previousFileIds.filter((id) =>
        availableIds.has(id),
      );
      const unavailableCount =
        previousFileIds.length - selectedFileIds.value.length;
      if (unavailableCount > 0) {
        ElMessage.warning(
          `原申请中有 ${unavailableCount} 份附件已失效，请重新选择当前可申请的附件`,
        );
      }
      if (!sourceRequest.canResubmit) {
        errorMessage.value =
          "该申请已被重新提交或状态已发生变化，请返回我的申请刷新后重试";
      }
    }
  } catch (error) {
    detail.value = null;
    errorMessage.value = getContractDownloadRequestErrorMessage(
      error,
      "读取合同附件失败",
    );
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadContract());
</script>

<style scoped>
.download-request-create {
  display: grid;
  gap: 20px;
  padding: 20px;
  background: #f4f7f9;
}
.page-heading,
.application-card {
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
.page-heading span,
.application-title small {
  color: #168c83;
}
.page-heading h1,
.application-title h2 {
  margin: 5px 0;
  color: #17364b;
}
.page-heading p {
  margin: 0;
  color: #71808b;
}
.application-card {
  min-height: 360px;
  padding: 26px;
}
.application-title,
.section-heading,
.submit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.contract-summary {
  margin-top: 20px;
}
.resubmit-alert {
  margin-top: 18px;
}
.form-section,
.signature-section,
.flow-section {
  margin-top: 22px;
  padding: 20px;
  border: 1px solid #e1e9ee;
  border-radius: 12px;
}
.section-heading div {
  display: grid;
  gap: 5px;
}
.section-heading span,
.flow-section small,
.submit-bar span {
  color: #72818b;
  font-size: 13px;
}
.file-options {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}
.file-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid #e4ebef;
  border-radius: 9px;
}
.file-copy {
  display: inline-grid;
  gap: 3px;
  margin-left: 8px;
}
.file-copy small {
  color: #85919a;
}
.signature-slot {
  display: grid;
  place-items: center;
  width: min(460px, 100%);
  min-height: 150px;
  margin-top: 16px;
  border: 1px dashed #9abdb8;
  border-radius: 12px;
  color: #168c83;
  background: #f4fbfa;
  cursor: pointer;
}
.signature-slot img {
  max-width: 220px;
  max-height: 86px;
}
.signature-slot small {
  color: #6f7f89;
}
.flow-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 10px;
  overflow-x: auto;
  white-space: nowrap;
}
.flow-line span {
  padding: 8px 12px;
  border-radius: 18px;
  background: #edf2f5;
}
.flow-line span.active {
  color: #087b72;
  background: #e4f6f3;
}
.submit-bar {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5ecef;
}
@media (max-width: 760px) {
  .download-request-create {
    padding: 12px;
  }
  .page-heading,
  .application-title,
  .section-heading,
  .submit-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .application-card {
    padding: 16px;
  }
  .file-option {
    align-items: flex-start;
  }
}
</style>
