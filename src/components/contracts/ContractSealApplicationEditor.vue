<template>
  <section class="seal-application-editor">
    <header class="application-heading">
      <div class="heading-mark">
        <el-icon><Stamp /></el-icon>
      </div>
      <div class="heading-copy">
        <p>合同用印流程</p>
        <h2>用印申请单</h2>
        <span class="heading-description"
          >系统自动带入合同信息，在线补充用印事项；申请单为单页并预留总经理审批签字区。</span
        >
      </div>
      <el-tag
        v-if="signed"
        class="application-status"
        type="success"
        effect="light"
        >申请人已签署</el-tag
      >
      <el-tag v-else class="application-status" type="warning" effect="light"
        >待申请人签署</el-tag
      >
    </header>

    <div class="application-body">
      <section class="summary-panel">
        <div class="panel-title">
          <span>01</span>
          <div>
            <strong>合同信息</strong>
            <small>以下信息由合同识别结果自动带入</small>
          </div>
        </div>
        <dl class="contract-summary">
          <div>
            <dt>合同编号</dt>
            <dd>{{ contract.contractNo || "—" }}</dd>
          </div>
          <div>
            <dt>合同名称</dt>
            <dd>{{ contract.contractTitle || contract.projectName || "—" }}</dd>
          </div>
          <div>
            <dt>甲方单位</dt>
            <dd>{{ contract.partyA || "—" }}</dd>
          </div>
          <div>
            <dt>乙方单位</dt>
            <dd>{{ contract.partyB || "—" }}</dd>
          </div>
          <div v-if="!contract.isAssetContract">
            <dt>项目名称</dt>
            <dd>{{ contract.projectName || "—" }}</dd>
          </div>
          <div>
            <dt>合同金额</dt>
            <dd class="amount-value">{{ contract.amount || "—" }}</dd>
          </div>
          <div>
            <dt>合同分类</dt>
            <dd>{{ contract.categoryLabel || "—" }}</dd>
          </div>
          <div>
            <dt>合同关系 / 区域</dt>
            <dd>
              {{ contract.relationLabel || "—" }} · {{ contract.area || "—" }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="form-panel">
        <div class="panel-title">
          <span>02</span>
          <div>
            <strong>用印事项</strong>
            <small>标记为必填的内容将写入最终申请单</small>
          </div>
        </div>
        <el-form label-position="top" class="application-form">
          <el-form-item label="用印事由" required>
            <el-input
              :model-value="modelValue.sealPurpose"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="请说明本次合同用印事项"
              :disabled="formDisabled"
              @update:model-value="updateField('sealPurpose', String($event))"
            />
          </el-form-item>
          <div class="form-row">
            <el-form-item label="印章类型" required>
              <el-radio-group
                :model-value="modelValue.sealType"
                :disabled="formDisabled"
                @update:model-value="updateSealType"
              >
                <el-radio-button value="company">公司公章</el-radio-button>
                <el-radio-button value="contract">合同专用章</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="用印份数" required>
              <el-input
                :model-value="
                  modelValue.copyCount == null
                    ? '未识别'
                    : `${modelValue.copyCount} 份`
                "
                readonly
              />
              <p class="copy-count-hint">
                {{
                  modelValue.copyCount == null
                    ? "系统尚未形成唯一可信的用印总份数"
                    : "系统按合同正文“一式几份”精准识别，不允许人工修改"
                }}
              </p>
            </el-form-item>
          </div>
          <el-form-item>
            <el-checkbox
              :model-value="modelValue.crossPageSeal"
              :disabled="formDisabled"
              @update:model-value="updateCrossPageSeal"
            >
              需要加盖骑缝章
            </el-checkbox>
          </el-form-item>
          <el-form-item label="特殊说明">
            <el-input
              :model-value="modelValue.note"
              type="textarea"
              :rows="2"
              maxlength="1000"
              show-word-limit
              placeholder="可填写份数分配、用印位置或其他特殊情况"
              :disabled="formDisabled"
              @update:model-value="updateField('note', String($event))"
            />
          </el-form-item>
        </el-form>
      </section>

      <section class="signature-panel" :class="{ completed: signed }">
        <div class="panel-title">
          <span>03</span>
          <div>
            <strong>申请人电子签名</strong>
            <small>签署时服务端会重新读取当前账号已锁定的本人签名</small>
          </div>
        </div>

        <div v-if="signed" class="signed-result">
          <div class="signed-icon">
            <el-icon><CircleCheckFilled /></el-icon>
          </div>
          <div>
            <strong>{{ signedBy || "申请人" }}已完成申请人电子签名</strong>
            <span>{{ formattedSignedAt }}</span>
            <small>总经理审批通过后，将在同页预留栏完成审批签字</small>
            <small v-if="generatedFileName">{{ generatedFileName }}</small>
          </div>
        </div>

        <section v-if="signed && signedFileUrl" class="signed-file-preview">
          <div class="signed-file-heading">
            <div>
              <strong>本人签字位置</strong>
              <small
                >申请人签字位于单页底部左侧，右侧为总经理审批签字预留区</small
              >
            </div>
            <el-tag type="success" effect="light">已写入签名</el-tag>
          </div>
          <ContractSealApplicationApprovalPreview :url="signedFileUrl" />
        </section>

        <template v-else>
          <div class="signature-workspace">
            <button
              type="button"
              class="applicant-signature-slot"
              :class="{ 'is-loaded': Boolean(personalSignatureDataUrl) }"
              :disabled="
                signatureLoading ||
                disabled ||
                signing ||
                Boolean(personalSignatureDataUrl)
              "
              :aria-label="
                personalSignatureDataUrl
                  ? '申请人签署栏，本人签名已确认，等待生成申请单'
                  : '申请人签署栏，点击进行签名'
              "
              @click="signApplicantArea"
            >
              <span class="signature-slot-heading">
                <strong>申请人本人签字处</strong>
                <el-tag
                  size="small"
                  :type="personalSignatureDataUrl ? 'success' : 'warning'"
                  effect="plain"
                  >{{ personalSignatureDataUrl ? "待提交" : "待签署" }}</el-tag
                >
              </span>
              <span class="signature-preview">
                <img
                  v-if="personalSignatureDataUrl"
                  :src="personalSignatureDataUrl"
                  alt="本人电子签名预览"
                />
                <span v-else class="empty-signature">
                  <el-icon><EditPen /></el-icon>
                  <span v-if="signatureLoading">正在准备本人电子签名…</span>
                  <span v-else>点击签署区域进行签名</span>
                </span>
              </span>
            </button>
            <div class="signature-copy">
              <strong>{{ personalSignatureOwner || "申请人本人" }}</strong>
              <p>
                点击左侧申请人签署栏后显示本人锁定签名。确认生成时，服务端会重新读取签名档案并保存本次申请版本快照，前端不能替换签名图片。
              </p>
              <span class="signature-stage-hint">{{
                personalSignatureDataUrl
                  ? "本人签名已确认，尚未生成申请单"
                  : "请由申请人本人点击签署栏完成签名"
              }}</span>
            </div>
          </div>

          <div class="signature-actions">
            <span v-if="!formValid"
              >请先完整填写用印事由、印章类型和用印份数</span
            >
            <span v-else-if="!personalSignatureDataUrl"
              >请先在申请人签署栏完成本人签名</span
            >
            <span v-else>信息已完整，可以签名并生成用印申请单</span>
            <el-button
              type="primary"
              :icon="Promotion"
              :loading="signing"
              :disabled="!canSign"
              @click="requestSign"
            >
              确认签名并生成用印申请单
            </el-button>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import {
  CircleCheckFilled,
  EditPen,
  Promotion,
  Stamp,
} from "@element-plus/icons-vue";
import ContractSealApplicationApprovalPreview from "@/components/contracts/ContractSealApplicationApprovalPreview.vue";
import { loadPersonalSignature } from "@/utils/personalSignature";

export type ContractSealApplicationSealType = "company" | "contract";

export interface ContractSealApplicationFormValue {
  sealPurpose: string;
  sealType: ContractSealApplicationSealType;
  copyCount: number | null;
  crossPageSeal: boolean;
  note: string;
}

export interface ContractSealApplicationSummary {
  contractNo: string;
  contractTitle?: string | null;
  partyA: string;
  partyB: string;
  projectName?: string | null;
  amount?: string | null;
  categoryLabel: string;
  isAssetContract?: boolean;
  relationLabel: string;
  area: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: ContractSealApplicationFormValue;
    contract: ContractSealApplicationSummary;
    disabled?: boolean;
    signing?: boolean;
    signed?: boolean;
    signedBy?: string | null;
    signedAt?: string | null;
    generatedFileName?: string | null;
    signedFileUrl?: string | null;
  }>(),
  {
    disabled: false,
    signing: false,
    signed: false,
    signedBy: "",
    signedAt: "",
    generatedFileName: "",
    signedFileUrl: "",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: ContractSealApplicationFormValue): void;
  (event: "update:valid", value: boolean): void;
  (event: "sign", value: ContractSealApplicationFormValue): void;
}>();

const signatureLoading = ref(false);
const personalSignatureDataUrl = ref("");
const personalSignatureOwner = ref("");

const formDisabled = computed(
  () => props.disabled || props.signing || props.signed,
);
const formValid = computed(
  () =>
    Boolean(props.modelValue.sealPurpose.trim()) &&
    ["company", "contract"].includes(props.modelValue.sealType) &&
    typeof props.modelValue.copyCount === "number" &&
    Number.isInteger(props.modelValue.copyCount) &&
    props.modelValue.copyCount >= 1 &&
    props.modelValue.copyCount <= 20,
);
const canSign = computed(
  () =>
    formValid.value &&
    Boolean(personalSignatureDataUrl.value) &&
    !props.disabled &&
    !props.signing &&
    !props.signed,
);
const formattedSignedAt = computed(() => {
  if (!props.signedAt || !dayjs(props.signedAt).isValid())
    return "签署时间已记录";
  return dayjs(props.signedAt).format("YYYY年M月D日 HH:mm");
});

watch(
  formValid,
  (valid) => {
    emit("update:valid", valid);
  },
  { immediate: true },
);

function updateField<Key extends keyof ContractSealApplicationFormValue>(
  key: Key,
  value: ContractSealApplicationFormValue[Key],
) {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function updateSealType(value: string | number | boolean | undefined) {
  if (value === "company" || value === "contract") {
    updateField("sealType", value);
  }
}

function updateCrossPageSeal(value: string | number | boolean) {
  updateField("crossPageSeal", value === true);
}

async function signApplicantArea() {
  if (
    signatureLoading.value ||
    props.disabled ||
    props.signing ||
    props.signed ||
    personalSignatureDataUrl.value
  ) {
    return;
  }
  signatureLoading.value = true;
  try {
    const signature = await loadPersonalSignature();
    if (!signature) {
      ElMessage.warning("请先前往个人设置上传并锁定本人电子签名");
      return;
    }
    personalSignatureDataUrl.value = signature.dataUrl;
    personalSignatureOwner.value = signature.ownerName;
  } catch (error) {
    console.error("加载个人电子签名失败:", error);
    ElMessage.error("个人电子签名加载失败，请稍后重试");
  } finally {
    signatureLoading.value = false;
  }
}

function requestSign() {
  if (!canSign.value) return;
  // 事件只携带表单内容；签名图片必须由服务端从当前账号档案读取。
  emit("sign", {
    sealPurpose: props.modelValue.sealPurpose.trim(),
    sealType: props.modelValue.sealType,
    copyCount: props.modelValue.copyCount,
    crossPageSeal: props.modelValue.crossPageSeal === true,
    note: props.modelValue.note.trim(),
  });
}
</script>

<style scoped>
.seal-application-editor {
  overflow: hidden;
  border: 1px solid #dfeae8;
  border-radius: 18px;
  background: #f6faf9;
  box-shadow: 0 16px 44px rgb(32 92 83 / 8%);
}

.application-heading {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 24px 28px;
  background:
    radial-gradient(circle at 88% 18%, rgb(255 255 255 / 18%), transparent 26%),
    linear-gradient(135deg, #0f766e, #115e59);
  color: #fff;
}

.heading-mark {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 15px;
  background: rgb(255 255 255 / 12%);
  font-size: 24px;
}

.heading-copy {
  min-width: 0;
}

.heading-copy p,
.heading-copy h2,
.heading-description {
  margin: 0;
}

.heading-copy p {
  color: #baf2e9;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.heading-copy h2 {
  margin-top: 2px;
  font-size: 24px;
}

.heading-description {
  display: block;
  margin-top: 6px;
  color: #d4f4ef;
  font-size: 13px;
}

.application-status {
  min-width: 72px;
  justify-content: center;
  margin: 0;
  font-weight: 700;
  white-space: nowrap;
}

.application-status.el-tag--warning {
  border-color: #f6cd72;
  background-color: #fffbeb;
  color: #92400e;
}

.application-status.el-tag--success {
  border-color: #9bd8c3;
  background-color: #ecfdf5;
  color: #065f46;
}

.application-body {
  display: grid;
  gap: 18px;
  padding: 22px;
}

.summary-panel,
.form-panel,
.signature-panel {
  padding: 22px;
  border: 1px solid #e1ecea;
  border-radius: 14px;
  background: #fff;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.panel-title > span {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: #e7f6f3;
  color: #0f766e;
  font-size: 12px;
  font-weight: 700;
}

.panel-title strong,
.panel-title small {
  display: block;
}

.panel-title strong {
  color: #203331;
  font-size: 15px;
}

.panel-title small {
  margin-top: 3px;
  color: #879794;
  font-size: 12px;
}

.contract-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  margin: 0;
  border: 1px solid #e7efed;
  border-radius: 10px;
  background: #e7efed;
}

.contract-summary > div {
  min-width: 0;
  padding: 13px 15px;
  background: #fbfdfc;
}

.contract-summary dt {
  color: #80918e;
  font-size: 11px;
}

.contract-summary dd {
  overflow-wrap: anywhere;
  margin: 5px 0 0;
  color: #2d403d;
  font-size: 13px;
  font-weight: 500;
}

.contract-summary .amount-value {
  color: #0f766e;
  font-weight: 700;
}

.application-form {
  max-width: 860px;
}

.form-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.45fr);
  gap: 18px;
}
.copy-count-hint {
  margin: 7px 0 0;
  color: #7a8d91;
  font-size: 12px;
  line-height: 1.5;
}

.signature-panel.completed {
  border-color: #b8ddd5;
  background: #fbfefd;
}

.signature-workspace {
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(0, 1.2fr);
  gap: 20px;
  align-items: center;
}

.applicant-signature-slot {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 14px;
  border: 1px dashed #78bdb1;
  border-radius: 14px;
  background: #f7fcfa;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.applicant-signature-slot:hover:not(:disabled),
.applicant-signature-slot:focus-visible {
  border-color: #0f8d82;
  box-shadow: 0 0 0 3px rgb(15 141 130 / 12%);
  outline: none;
  transform: translateY(-1px);
}

.applicant-signature-slot.is-loaded {
  border-style: solid;
  background: #effaf7;
}

.applicant-signature-slot:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.applicant-signature-slot.is-loaded:disabled {
  cursor: default;
  opacity: 1;
}

.signature-slot-heading,
.signed-file-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.signature-slot-heading strong,
.signed-file-heading strong,
.signed-file-heading small {
  display: block;
}

.signature-slot-heading strong,
.signed-file-heading strong {
  color: #29403c;
  font-size: 14px;
}

.signed-file-heading small {
  margin-top: 4px;
  color: #718783;
  font-size: 12px;
}

.signature-preview {
  display: grid;
  min-height: 128px;
  place-items: center;
  padding: 15px;
  border: 1px dashed #b9ceca;
  border-radius: 12px;
  background:
    linear-gradient(#fff, #fff) padding-box,
    repeating-linear-gradient(0deg, #f6faf9 0 1px, transparent 1px 22px);
}

.signature-preview img {
  max-width: 100%;
  max-height: 96px;
  object-fit: contain;
}

.empty-signature {
  display: grid;
  place-items: center;
  gap: 7px;
  color: #9aaba8;
  font-size: 12px;
}

.empty-signature .el-icon {
  font-size: 30px;
}

.signature-copy strong,
.signature-copy p {
  margin: 0;
}

.signature-copy strong {
  color: #29403c;
  font-size: 15px;
}

.signature-copy p {
  margin: 7px 0 14px;
  color: #778884;
  font-size: 12px;
  line-height: 1.7;
}

.signature-stage-hint {
  display: inline-flex;
  padding: 7px 11px;
  border-radius: 999px;
  background: #edf7f4;
  color: #1f756d;
  font-size: 12px;
  font-weight: 600;
}

.signature-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding-top: 17px;
  border-top: 1px solid #edf2f1;
}

.signature-actions > span {
  color: #7b8d89;
  font-size: 12px;
}

.signed-result {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 12px;
  background: #edf9f6;
}

.signed-icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  color: #0f9f79;
  font-size: 25px;
}

.signed-result strong,
.signed-result span,
.signed-result small {
  display: block;
}

.signed-file-preview {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #cce2dd;
  border-radius: 12px;
  background: #fff;
}

.signed-result strong {
  color: #215047;
}

.signed-result span,
.signed-result small {
  margin-top: 4px;
  color: #6f8b85;
  font-size: 12px;
}

@media (max-width: 760px) {
  .application-heading {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 20px;
  }

  .application-heading > .application-status {
    grid-column: 2;
    justify-self: start;
  }

  .application-body,
  .summary-panel,
  .form-panel,
  .signature-panel {
    padding: 16px;
  }

  .contract-summary,
  .form-row,
  .signature-workspace {
    grid-template-columns: 1fr;
  }

  .signature-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .signed-file-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
