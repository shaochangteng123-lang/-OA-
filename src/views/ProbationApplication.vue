<template>
  <div class="probation-application-page">
    <header class="application-header">
      <el-button :icon="ArrowLeft" @click="returnToProbation"> 返回 </el-button>
      <div>
        <h1>{{ readonlyMode ? "查看转正申请单" : "填写转正申请单" }}</h1>
        <p v-if="myStatus?.profile">
          {{ displayedApplicantName }} · {{ displayedDepartment || "-" }} ·
          {{ displayedPosition || "-" }}
        </p>
      </div>
    </header>

    <div v-if="loading" class="loading-panel">
      <el-skeleton :rows="10" animated />
    </div>

    <el-result
      v-else-if="unavailableMessage"
      icon="warning"
      title="暂不能申请转正"
      :sub-title="unavailableMessage"
    >
      <template #extra>
        <el-button type="primary" @click="returnToProbation">
          返回转正页面
        </el-button>
      </template>
    </el-result>

    <template v-else-if="myStatus?.profile">
      <section class="application-workspace">
        <ProbationTemplateEditor
          v-model:conversion-type="applicationForm.conversionType"
          v-model:conversion-type-other="applicationForm.conversionTypeOther"
          v-model:self-statement="applicationForm.selfStatement"
          v-model:signature-data-url="applicationForm.signatureDataUrl"
          v-model:signature-type="applicationForm.signatureType"
          :mode="readonlyMode ? 'readonly' : 'employee'"
          :applicant-name="displayedApplicantName"
          :department="displayedDepartment"
          :position="displayedPosition"
          :hire-date="displayedHireDate"
          :signatures="readonlyMode ? myStatus.signatures : []"
          @ready="templateReady = $event"
        />
      </section>

      <footer class="application-actions">
        <template v-if="readonlyMode">
          <el-button type="primary" @click="returnToProbation">
            返回转正页面
          </el-button>
        </template>
        <template v-else>
          <el-button @click="returnToProbation">取消</el-button>
          <el-button
            type="primary"
            :icon="Promotion"
            :loading="submitting"
            :disabled="!applicationFormValid"
            @click="submitOnlineApplication"
          >
            签名并提交
          </el-button>
        </template>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Promotion } from "@element-plus/icons-vue";
import { api } from "@/utils/api";
import { usePendingStore } from "@/stores/pending";
import ProbationTemplateEditor from "@/components/probation/ProbationTemplateEditor.vue";
import type { PersonalSignatureType } from "@/utils/personalSignature";

type ConversionType = "normal" | "early" | "extended" | "other";

interface Confirmation {
  id: string;
  status: "pending" | "submitted" | "approved" | "rejected";
  form_version: number;
  hire_date: string | null;
  probation_end_date: string | null;
  conversion_type: ConversionType;
  conversion_type_other: string | null;
  self_statement: string | null;
  applicant_name_snapshot: string | null;
  department_snapshot: string | null;
  position_snapshot: string | null;
}

interface SignatureRecord {
  id: string;
  stage: "employee" | "supervisor" | "hr" | "general_manager";
  signer_name: string;
  signature_type?: PersonalSignatureType;
  signature_owner_name?: string;
  opinion: string | null;
  decision: "submit" | "approve" | "reject";
  signed_at: string;
  signature_image_url?: string;
}

interface MyStatus {
  profile: {
    name: string;
    department: string | null;
    position: string | null;
    hire_date: string | null;
    employment_status: string;
  } | null;
  confirmation: Confirmation | null;
  signatures: SignatureRecord[];
}

const router = useRouter();
const pendingStore = usePendingStore();
const loading = ref(false);
const submitting = ref(false);
const templateReady = ref(false);
const myStatus = ref<MyStatus | null>(null);
const applicationForm = reactive({
  conversionType: "normal" as ConversionType,
  conversionTypeOther: "",
  selfStatement: "",
  signatureDataUrl: "",
  signatureType: "personal" as PersonalSignatureType,
});

const readonlyMode = computed(() => {
  const confirmation = myStatus.value?.confirmation;
  return Boolean(
    confirmation?.id &&
    confirmation.form_version > 0 &&
    confirmation.status === "submitted",
  );
});
const displayedApplicantName = computed(
  () =>
    (readonlyMode.value
      ? myStatus.value?.confirmation?.applicant_name_snapshot
      : null) ||
    myStatus.value?.profile?.name ||
    "",
);
const displayedDepartment = computed(
  () =>
    (readonlyMode.value
      ? myStatus.value?.confirmation?.department_snapshot
      : null) ||
    myStatus.value?.profile?.department ||
    "",
);
const displayedPosition = computed(
  () =>
    (readonlyMode.value
      ? myStatus.value?.confirmation?.position_snapshot
      : null) ||
    myStatus.value?.profile?.position ||
    "",
);
const displayedHireDate = computed(
  () =>
    (readonlyMode.value ? myStatus.value?.confirmation?.hire_date : null) ||
    myStatus.value?.profile?.hire_date ||
    "",
);

const unavailableMessage = computed(() => {
  const profile = myStatus.value?.profile;
  const confirmation = myStatus.value?.confirmation;
  if (!profile) return "尚未建立员工档案";
  if (readonlyMode.value) return "";
  if (profile.employment_status !== "probation") {
    return "当前员工状态不是实习期";
  }
  if (!profile.hire_date || !confirmation?.probation_end_date) {
    return "劳动合同及试用期信息尚未完整";
  }
  if (!confirmation.id) return "";
  if (!["pending", "rejected"].includes(confirmation.status)) {
    return confirmation.status === "approved"
      ? "该员工已经完成转正"
      : "转正申请正在签署，不能重复提交";
  }
  return "";
});

const applicationFormValid = computed(
  () =>
    templateReady.value &&
    Boolean(applicationForm.selfStatement.trim()) &&
    Boolean(applicationForm.signatureDataUrl) &&
    (applicationForm.conversionType !== "other" ||
      Boolean(applicationForm.conversionTypeOther.trim())),
);

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return (
    requestError.response?.data?.message || requestError.message || fallback
  );
}

async function fetchMyStatus() {
  loading.value = true;
  try {
    const response = await api.get("/api/probation/my-status");
    if (!response.data.success) {
      throw new Error(response.data.message || "获取转正状态失败");
    }
    myStatus.value = response.data.data;
    const confirmation = myStatus.value?.confirmation;
    applicationForm.conversionType = confirmation?.conversion_type || "normal";
    applicationForm.conversionTypeOther =
      confirmation?.conversion_type_other || "";
    applicationForm.selfStatement = confirmation?.self_statement || "";
    applicationForm.signatureDataUrl = "";
    applicationForm.signatureType = "personal";
    templateReady.value = false;
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "获取转正状态失败"));
  } finally {
    loading.value = false;
  }
}

function returnToProbation() {
  void router.push({ name: "Probation" });
}

async function submitOnlineApplication() {
  if (!applicationFormValid.value) return;
  try {
    await ElMessageBox.confirm(
      "确认提交本次述职和电子签名？提交后由总经理签署主管领导意见、管理员签署人事部意见，最后由董事长完成最终审批。",
      "提交转正申请",
      {
        confirmButtonText: "确认提交",
        cancelButtonText: "取消",
        type: "info",
      },
    );
    submitting.value = true;
    const response = await api.post("/api/probation/online-submit", {
      conversionType: applicationForm.conversionType,
      conversionTypeOther: applicationForm.conversionTypeOther,
      selfStatement: applicationForm.selfStatement,
      signatureType: applicationForm.signatureType,
    });
    if (!response.data.success) {
      ElMessage.error(response.data.message || "提交失败");
      return;
    }
    ElMessage.success(response.data.message);
    await pendingStore.refreshPendingCounts();
    await router.replace({ name: "Probation" });
  } catch (error: unknown) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error(requestErrorMessage(error, "提交失败"));
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(fetchMyStatus);
</script>

<style scoped>
.probation-application-page {
  min-height: 100%;
  background: #fff;
}

.application-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.application-header h1 {
  margin: 0;
  color: #303133;
  font-size: 20px;
}

.application-header p {
  margin: 6px 0 0;
  color: #909399;
  font-size: 13px;
}

.loading-panel {
  padding: 28px;
}

.application-workspace {
  padding: 24px;
}

.application-actions {
  position: sticky;
  z-index: 10;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid #e4e7ed;
  background: rgb(255 255 255 / 96%);
}

@media (max-width: 640px) {
  .application-header,
  .application-workspace,
  .application-actions {
    padding-right: 14px;
    padding-left: 14px;
  }
}
</style>
