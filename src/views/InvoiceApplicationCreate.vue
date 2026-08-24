<template>
  <div class="invoice-application-create">
    <header class="page-heading">
      <div>
        <span>收入合同 · {{ flowTitle }}</span>
        <h1>{{ applicationId ? "编辑" + flowTitle : "发起" + flowTitle }}</h1>
        <p>{{ flowDescription }}</p>
      </div>
      <el-button
        @click="router.push('/contract-applications/mine?tab=invoice')"
      >
        返回我的申请
      </el-button>
    </header>

    <el-alert
      v-if="errorMessage"
      type="error"
      :title="errorMessage"
      show-icon
      :closable="false"
    />

    <section v-loading="loading" class="application-card">
      <template v-if="eligibility?.contract">
        <div class="card-title">
          <div>
            <small>合同开票额度</small>
            <h2>{{ eligibility.contract.title }}</h2>
          </div>
          <el-tag
            :type="
              eligibility.contract.category === 'main_business'
                ? 'success'
                : 'primary'
            "
            effect="light"
          >
            {{ categoryLabel }}
          </el-tag>
        </div>

        <el-descriptions :column="3" border class="contract-summary">
          <el-descriptions-item label="合同编号">
            {{ eligibility.contract.contractNo || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="行政区域">
            {{ eligibility.contract.area || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="甲方">
            {{ eligibility.contract.partyA || "—" }}
          </el-descriptions-item>
        </el-descriptions>

        <div
          v-show="!isMainBusiness || triplicateAmountConfirmed"
          class="amount-grid"
          aria-label="开票额度"
        >
          <article>
            <span>当前有效合同金额</span>
            <strong>{{
              money(eligibility.amounts.currentEffectiveAmount)
            }}</strong>
          </article>
          <article>
            <span>已开票金额</span>
            <strong>{{ money(eligibility.amounts.invoicedAmount) }}</strong>
          </article>
          <article>
            <span>审批、盖章及待开票占用</span>
            <strong>{{ money(eligibility.amounts.pendingAmount) }}</strong>
          </article>
          <article class="remaining">
            <span>剩余可申请额度</span>
            <strong>{{ money(eligibility.amounts.remainingAmount) }}</strong>
          </article>
        </div>

        <el-alert
          v-if="!eligibility.eligible"
          type="warning"
          :title="eligibility.reason || '当前合同暂不允许新增开票申请'"
          show-icon
          :closable="false"
        />

        <el-form
          label-position="top"
          class="application-form"
          :class="{ 'main-business-form': isMainBusiness }"
        >
          <section
            v-show="!isMainBusiness || triplicateAmountConfirmed"
            class="form-section content-section"
          >
            <div class="section-heading">
              <div>
                <b>{{ isMainBusiness ? "02" : "01" }}</b>
                <span
                  ><strong>开票申请内容</strong
                  ><small>填写本次拟向客户开票的信息</small></span
                >
              </div>
            </div>
            <div class="form-grid">
              <el-form-item
                v-if="!isMainBusiness"
                label="本次申请开票金额"
                required
              >
                <el-input
                  v-model="form.amount"
                  inputmode="decimal"
                  placeholder="请输入含税开票金额"
                  @input="markChangedAfterSignature"
                >
                  <template #prefix>¥</template>
                </el-input>
                <small class="field-tip"
                  >请输入本次拟向客户开具发票的含税金额。</small
                >
              </el-form-item>
              <el-form-item v-if="!isMainBusiness" label="发票类型" required>
                <el-select
                  v-model="form.invoiceType"
                  placeholder="请选择发票类型"
                  @change="markChangedAfterSignature"
                >
                  <el-option label="增值税专用发票" value="增值税专用发票" />
                  <el-option label="增值税普通发票" value="增值税普通发票" />
                </el-select>
              </el-form-item>
              <el-form-item label="开票说明及特殊情况" class="wide-field">
                <el-input
                  v-model="form.description"
                  type="textarea"
                  :rows="3"
                  maxlength="1000"
                  show-word-limit
                  placeholder="可填写本次开票的特殊要求或业务说明"
                  @input="markChangedAfterSignature"
                />
              </el-form-item>
            </div>
          </section>

          <section class="form-section material-section">
            <div class="section-heading">
              <div>
                <b>{{ isMainBusiness ? "01" : "02" }}</b>
                <span
                  ><strong>{{
                    isMainBusiness
                      ? "在线生成三联单并确认用印"
                      : "甲方材料与用印"
                  }}</strong
                  ><small>{{
                    isMainBusiness
                      ? "在线填写本次付款，系统自动计算合同金额与累计付款"
                      : "选择材料是否需要盖章"
                  }}</small></span
                >
              </div>
            </div>

            <el-alert
              v-if="isMainBusiness"
              type="info"
              :closable="false"
              show-icon
              title="主营项目合同：这一步同时申请三联单用印"
              description="工程项目名称可调整，本次付款由申请人在线填写；系统生成第一联、第二联、第三联三张A4三联单，总经理批准后由管理员打印并盖章。"
            />
            <div v-if="isMainBusiness" class="online-triplicate">
              <div class="triplicate-form-grid">
                <el-form-item label="工程项目名称" required>
                  <el-input
                    v-model="triplicateProjectName"
                    maxlength="300"
                    placeholder="请输入三联单显示的工程项目名称"
                    @input="markTriplicateChanged"
                  />
                  <small class="field-tip"
                    >默认带入合同名称；修改仅影响本次三联单，不修改合同台账。</small
                  >
                </el-form-item>
                <el-form-item label="本次付款金额" required>
                  <el-input
                    v-model="form.amount"
                    inputmode="decimal"
                    placeholder="请输入本次付款金额，例如47500.00"
                    @input="markTriplicateChanged"
                    @blur="normalizeTriplicatePayment"
                  />
                  <small class="field-tip"
                    >三联单将按两位小数原值打印，不增加千位分隔符。</small
                  >
                </el-form-item>
                <el-form-item label="发票类型" required>
                  <el-select
                    v-model="form.invoiceType"
                    placeholder="请选择发票类型"
                    @change="markTriplicateChanged"
                  >
                    <el-option label="增值税专用发票" value="增值税专用发票" />
                    <el-option label="增值税普通发票" value="增值税普通发票" />
                  </el-select>
                </el-form-item>
              </div>
              <div class="triplicate-amount-grid">
                <article>
                  <span>当前有效合同金额</span>
                  <strong>{{ plainAmount(triplicateContractAmount) }}</strong>
                </article>
                <article>
                  <span>之前累计付款</span>
                  <strong>{{ plainAmount(triplicatePreviousPayment) }}</strong>
                </article>
                <article class="current">
                  <span>本次付款</span>
                  <strong>{{ plainAmount(triplicateCurrentPayment) }}</strong>
                </article>
                <article class="cumulative">
                  <span>本次累计付款</span>
                  <strong>{{
                    plainAmount(triplicateCumulativePayment)
                  }}</strong>
                </article>
              </div>
              <el-alert
                v-if="triplicateCumulativeExceedsContract"
                type="error"
                show-icon
                :closable="false"
                title="本次累计付款超过当前有效合同金额"
              />
              <div class="triplicate-actions">
                <el-button
                  type="primary"
                  :loading="triplicateGenerating"
                  :disabled="!canGenerateTriplicate"
                  @click="generateOnlineTriplicate"
                >
                  {{ generatedTriplicate ? "重新生成三联单" : "生成三联单" }}
                </el-button>
                <span>生成一份三页PDF：第一联、第二联、第三联</span>
              </div>

              <el-alert
                v-if="triplicateAmountConfirmed"
                type="success"
                show-icon
                :closable="false"
                title="三联单已生成并保存"
                :description="triplicateRecognitionDescription"
                class="triplicate-result"
              />

              <div v-if="savedMaterials.length" class="saved-materials">
                <strong>已生成三联单</strong>
                <article v-for="material in savedMaterials" :key="material.id">
                  <span>
                    <el-icon><Document /></el-icon>
                    {{ material.fileName }}
                  </span>
                  <div>
                    <el-tag type="warning" size="small" effect="light"
                      >需要盖章</el-tag
                    >
                    <el-button
                      link
                      type="primary"
                      @click="previewMaterial(material.id)"
                      >预览三联单</el-button
                    >
                    <el-button
                      v-if="canEditApplication"
                      link
                      type="danger"
                      :loading="deletingMaterialId === material.id"
                      @click="removeSavedMaterial(material.id)"
                      >删除</el-button
                    >
                  </div>
                </article>
              </div>
            </div>
            <el-radio-group
              v-else
              v-model="form.materialMode"
              class="material-modes"
              @change="handleMaterialModeChange"
            >
              <el-radio-button value="material_need_seal"
                >有材料，需要盖章</el-radio-button
              >
              <el-radio-button value="material_no_seal"
                >有材料，不需要盖章</el-radio-button
              >
              <el-radio-button value="no_material">不需要材料</el-radio-button>
            </el-radio-group>

            <div
              v-if="!isMainBusiness && form.materialMode !== 'no_material'"
              class="material-upload"
            >
              <el-upload
                v-model:file-list="uploadFiles"
                drag
                :multiple="!isMainBusiness"
                :disabled="
                  isMainBusiness &&
                  savedMaterials.length + uploadFiles.length >= 1
                "
                :auto-upload="false"
                :show-file-list="false"
                :accept="materialAccept"
                :on-change="handleFileChange"
                :on-remove="markChangedAfterSignature"
              >
                <el-icon class="upload-icon"><UploadFilled /></el-icon>
                <div>将材料拖到这里，或点击选择文件</div>
                <template #tip>
                  <span>{{ materialUploadTip }}</span>
                </template>
              </el-upload>

              <div v-if="uploadFiles.length" class="pending-materials">
                <strong>待上传材料</strong>
                <article v-for="file in uploadFiles" :key="file.uid">
                  <span>
                    <el-icon><Document /></el-icon>
                    {{ file.name }}
                  </span>
                  <div>
                    <el-checkbox
                      :model-value="pendingFileRequiresSeal(file)"
                      :disabled="
                        isMainBusiness ||
                        form.materialMode === 'material_no_seal'
                      "
                      @change="togglePendingFileSeal(file)"
                      >需要盖章</el-checkbox
                    >
                    <el-button
                      link
                      type="danger"
                      @click="removePendingFile(file)"
                      >删除</el-button
                    >
                  </div>
                </article>
              </div>

              <el-alert
                v-if="isMainBusiness && triplicateAmountConfirmed"
                type="success"
                show-icon
                :closable="false"
                :title="triplicateResultTitle"
                :description="triplicateRecognitionDescription"
                class="triplicate-result"
              />

              <div v-if="savedMaterials.length" class="saved-materials">
                <strong>已保存材料</strong>
                <article v-for="material in savedMaterials" :key="material.id">
                  <span>
                    <el-icon><Document /></el-icon>
                    {{ material.fileName }}
                  </span>
                  <div>
                    <el-tag
                      :type="material.requiresSeal ? 'warning' : 'info'"
                      size="small"
                      effect="light"
                      >{{
                        material.requiresSeal ? "需要盖章" : "无需盖章"
                      }}</el-tag
                    >
                    <el-button
                      link
                      type="primary"
                      @click="previewMaterial(material.id)"
                      >{{ materialActionLabel(material.mimeType) }}</el-button
                    >
                    <el-button
                      v-if="canEditApplication"
                      link
                      type="danger"
                      :loading="deletingMaterialId === material.id"
                      @click="removeSavedMaterial(material.id)"
                      >删除</el-button
                    >
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section
            v-show="!isMainBusiness || triplicateAmountConfirmed"
            class="form-section billing-section"
          >
            <div class="section-heading">
              <div>
                <b>03</b>
                <span
                  ><strong>甲方完整开票信息</strong
                  ><small>名称和税号提交前必须由本人确认</small></span
                >
              </div>
              <el-tag v-if="prefillSourceId" type="success" effect="light">{{
                billingPrefillLabel
              }}</el-tag>
            </div>

            <el-alert
              v-if="billingInfoChangedFromHistory"
              type="warning"
              show-icon
              :closable="false"
              title="您已修改自动带入的开票信息"
              description="系统将在保存时保留修改记录，请再次核对名称、税号及银行信息。"
            />

            <div class="billing-grid">
              <el-form-item label="开票名称" required>
                <el-input
                  v-model="form.billingInfo.name"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="税号" required>
                <el-input
                  v-model="form.billingInfo.taxNumber"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="地址">
                <el-input
                  v-model="form.billingInfo.address"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="电话">
                <el-input
                  v-model="form.billingInfo.phone"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="开户行">
                <el-input
                  v-model="form.billingInfo.bankName"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="账号">
                <el-input
                  v-model="form.billingInfo.bankAccount"
                  @input="billingChanged"
                />
              </el-form-item>
              <el-form-item label="选填备注" class="wide-field">
                <el-input
                  v-model="form.billingInfo.remark"
                  type="textarea"
                  :rows="2"
                  maxlength="500"
                  show-word-limit
                  placeholder="可填写开票时需要注意的事项"
                  @input="billingChanged"
                />
              </el-form-item>
            </div>
            <el-checkbox
              v-model="form.confirmedBillingIdentity"
              class="identity-confirmation"
              @change="markChangedAfterSignature"
            >
              我已核对并确认开票名称和税号准确无误
            </el-checkbox>
          </section>

          <section
            v-show="!isMainBusiness || triplicateAmountConfirmed"
            class="form-section signature-section"
          >
            <div class="section-heading">
              <div>
                <b>04</b>
                <span
                  ><strong>申请人电子签名</strong
                  ><small>提交前由当前员工本人签署</small></span
                >
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
              <span v-else>{{
                signatureLoading ? "正在调用本人签名…" : "点击此处完成本人签名"
              }}</span>
              <small>{{
                signatureOwner || authStore.user?.name || "申请人本人"
              }}</small>
            </button>
            <el-alert
              v-if="signatureInvalidated"
              type="warning"
              show-icon
              :closable="false"
              title="申请内容已发生变化，请重新确认电子签名"
            />
          </section>
        </el-form>

        <footer
          v-show="!isMainBusiness || triplicateAmountConfirmed"
          class="submit-bar"
        >
          <span>{{ submitHint }}</span>
          <div>
            <el-button
              :loading="saving"
              :disabled="!canSaveDraft"
              @click="saveDraft()"
              >保存草稿</el-button
            >
            <el-button
              type="primary"
              :loading="submitting"
              :disabled="!canSubmit"
              @click="submitApplication"
              >签名并提交总经理审批</el-button
            >
          </div>
        </footer>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Document, UploadFilled } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadFile, UploadFiles, UploadUserFile } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import type {
  InvoiceApplication,
  InvoiceApplicationBillingInfo,
  InvoiceApplicationDraftPayload,
  InvoiceApplicationEligibility,
  InvoiceApplicationMaterialMode,
  MainTriplicateInspection,
} from "@/types/invoiceApplication";
import {
  createInvoiceApplication,
  deleteInvoiceApplicationMaterial,
  generateMainBusinessTriplicate,
  getInvoiceApplication,
  getInvoiceApplicationEligibility,
  getInvoiceApplicationErrorMessage,
  getInvoiceApplicationMaterialDownloadUrl,
  getInvoiceApplicationMaterialPreviewUrl,
  inspectMainTriplicate,
  submitInvoiceApplication,
  updateInvoiceApplication,
  uploadInvoiceApplicationMaterials,
} from "@/utils/invoiceApplicationApi";
import { formatContractMoney } from "@/utils/contractPresentation";
import { requestContractDownloadBadgeRefresh } from "@/utils/contractDownloadApi";
import { loadPersonalSignature } from "@/utils/personalSignature";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const eligibility = ref<InvoiceApplicationEligibility | null>(null);
const currentApplication = ref<InvoiceApplication | null>(null);
const loading = ref(false);
const saving = ref(false);
const submitting = ref(false);
const errorMessage = ref("");
const uploadFiles = ref<UploadUserFile[]>([]);
const pendingSealFileUids = ref(new Set<string>());
const deletingMaterialId = ref("");
const signatureLoading = ref(false);
const signatureDataUrl = ref("");
const signatureOwner = ref("");
const signatureInvalidated = ref(false);
const initialBillingInfo = ref<InvoiceApplicationBillingInfo | null>(null);
const prefillSourceId = ref("");
const triplicateInspecting = ref(false);
const triplicateInspection = ref<MainTriplicateInspection | null>(null);
const triplicateGenerating = ref(false);
const triplicateProjectName = ref("");
let triplicateInspectionSequence = 0;

const applicationId = computed(() =>
  String(route.query.applicationId || "").trim(),
);
const form = reactive<InvoiceApplicationDraftPayload>({
  contractId: "",
  amount: "",
  invoiceType: "",
  description: "",
  materialMode: "material_need_seal",
  billingInfo: emptyBillingInfo(),
  confirmedBillingIdentity: false,
});

const isMainBusiness = computed(
  () => eligibility.value?.contract?.category === "main_business",
);
const categoryLabel = computed(() =>
  isMainBusiness.value ? "主营项目合同" : "非主营项目合同",
);
const isSealApplication = computed(
  () => isMainBusiness.value || form.materialMode === "material_need_seal",
);
const flowTitle = computed(() =>
  isSealApplication.value ? "开票及用印申请" : "开票申请",
);
const flowDescription = computed(() =>
  isSealApplication.value
    ? "本次申请既向客户开票，也申请对上传材料盖章；不是我公司对外付款申请。"
    : "本次只向客户申请开票，不包含材料盖章，也不是我公司对外付款申请。",
);
const savedMaterials = computed(
  () => currentApplication.value?.materials || [],
);
const generatedTriplicate = computed(() =>
  savedMaterials.value.find(
    (material) => material.isSystemGeneratedTriplicate === true,
  ),
);
const legacyTriplicate = computed(() =>
  savedMaterials.value.find(
    (material) => material.isSystemGeneratedTriplicate !== true,
  ),
);
const triplicateContractAmount = computed(() =>
  Number(eligibility.value?.amounts.currentEffectiveAmount || 0),
);
const triplicatePreviousPayment = computed(() =>
  Number(
    currentApplication.value?.triplicatePreviousPayment ??
      eligibility.value?.triplicatePreviousPaymentAmount ??
      0,
  ),
);
const triplicateCurrentPayment = computed(() => cents(form.amount) / 100);
const triplicateCumulativePayment = computed(
  () => triplicatePreviousPayment.value + triplicateCurrentPayment.value,
);
const triplicateCumulativeExceedsContract = computed(
  () =>
    cents(triplicateCumulativePayment.value) >
    cents(triplicateContractAmount.value),
);
const generatedTriplicateMatchesForm = computed(
  () =>
    Boolean(generatedTriplicate.value) &&
    currentApplication.value?.triplicateProjectName ===
      triplicateProjectName.value.trim() &&
    cents(currentApplication.value?.amount || 0) === cents(form.amount) &&
    cents(currentApplication.value?.contractAmount || 0) ===
      cents(triplicateContractAmount.value),
);
const legacyTriplicateMatchesForm = computed(
  () =>
    Boolean(legacyTriplicate.value) &&
    cents(currentApplication.value?.amount || 0) === cents(form.amount),
);
const triplicateAmountConfirmed = computed(
  () =>
    !isMainBusiness.value ||
    legacyTriplicateMatchesForm.value ||
    generatedTriplicateMatchesForm.value,
);
const triplicateResultTitle = computed(
  () => "已识别本次申请开票金额 " + money(form.amount),
);
const triplicateRecognitionDescription = computed(() => {
  if (generatedTriplicate.value) {
    return `本次付款 ${plainAmount(triplicateCurrentPayment.value)}；之前累计 ${plainAmount(triplicatePreviousPayment.value)}；本次累计 ${plainAmount(triplicateCumulativePayment.value)}。PDF共3页，由管理员打印并盖章。`;
  }
  if (!triplicateInspection.value) {
    return "金额来自已保存三联单“其他费用”工作表，主营项目金额不可手工修改。";
  }
  return (
    "来源：" +
    triplicateInspection.value.sourceSheet +
    "工作表 " +
    triplicateInspection.value.headerCell +
    "“本次付款”列、" +
    triplicateInspection.value.totalCell +
    "合计单元格；已复核明细范围" +
    triplicateInspection.value.detailRange +
    "。"
  );
});
const editableExistingApplication = computed(() =>
  ["draft", "rejected"].includes(currentApplication.value?.status || ""),
);
const canEditApplication = computed(
  () => !currentApplication.value || editableExistingApplication.value,
);
const draftFieldsValid = computed(
  () => cents(form.amount) > 0 && Boolean(form.invoiceType),
);
const canGenerateTriplicate = computed(
  () =>
    isMainBusiness.value &&
    canEditApplication.value &&
    Boolean(triplicateProjectName.value.trim()) &&
    cents(form.amount) > 0 &&
    Boolean(form.invoiceType) &&
    !triplicateCumulativeExceedsContract.value &&
    (eligibility.value?.eligible === true || Boolean(currentApplication.value)),
);
const canSaveDraft = computed(
  () =>
    canEditApplication.value &&
    draftFieldsValid.value &&
    (eligibility.value?.eligible === true || Boolean(currentApplication.value)),
);
const materialAccept = computed(() =>
  isMainBusiness.value
    ? ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : ".xls,.xlsx,.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
);
const materialUploadTip = computed(() =>
  isMainBusiness.value
    ? "仅支持 xls、xlsx，必须保留完整原始三联单。"
    : "支持 xls、xlsx、PDF、JPG、JPEG、PNG，可一次选择多份。",
);
const billingInfoChangedFromHistory = computed(() => {
  if (!initialBillingInfo.value || !prefillSourceId.value) return false;
  return (
    JSON.stringify(form.billingInfo) !==
    JSON.stringify(initialBillingInfo.value)
  );
});
const billingPrefillLabel = computed(() =>
  prefillSourceId.value === currentApplication.value?.id
    ? "已带入当前申请已保存信息"
    : "已带入该甲方历史信息",
);

const amountValid = computed(() => {
  const amount = cents(form.amount);
  const remaining = cents(eligibility.value?.amounts.remainingAmount || 0);
  return amount > 0 && amount <= remaining;
});
const materialValid = computed(() => {
  if (form.materialMode === "no_material") {
    return savedMaterials.value.length === 0 && uploadFiles.value.length === 0;
  }
  const hasMaterial =
    savedMaterials.value.length + uploadFiles.value.length > 0;
  if (!hasMaterial) return false;
  if (isMainBusiness.value) {
    return (
      triplicateAmountConfirmed.value &&
      savedMaterials.value.length + uploadFiles.value.length === 1 &&
      (savedMaterials.value.some((material) => material.requiresSeal) ||
        uploadFiles.value.some((file) => pendingFileRequiresSeal(file)))
    );
  }
  if (form.materialMode === "material_no_seal") {
    return (
      !savedMaterials.value.some((material) => material.requiresSeal) &&
      !uploadFiles.value.some((file) => pendingFileRequiresSeal(file))
    );
  }
  return (
    savedMaterials.value.some((material) => material.requiresSeal) ||
    uploadFiles.value.some((file) => pendingFileRequiresSeal(file))
  );
});
const canSubmit = computed(
  () =>
    canEditApplication.value &&
    eligibility.value?.eligible === true &&
    amountValid.value &&
    Boolean(form.invoiceType) &&
    triplicateAmountConfirmed.value &&
    materialValid.value &&
    Boolean(form.billingInfo.name.trim()) &&
    Boolean(form.billingInfo.taxNumber.trim()) &&
    form.confirmedBillingIdentity &&
    Boolean(signatureDataUrl.value),
);
const submitHint = computed(() => {
  if (!canEditApplication.value) return "当前申请状态不能继续编辑";
  if (!draftFieldsValid.value) return "请填写本次付款金额并选择发票类型";
  if (!amountValid.value) return "请输入不超过剩余可申请额度的有效金额";
  if (!form.invoiceType) return "请选择发票类型";
  if (!materialValid.value) {
    if (form.materialMode === "no_material" && savedMaterials.value.length) {
      return "已选择不需要材料，请先删除此前保存的材料";
    }
    if (
      form.materialMode === "material_no_seal" &&
      savedMaterials.value.some((material) => material.requiresSeal)
    ) {
      return "已保存材料仍标记为需要盖章，请删除后按无需盖章方式重新上传";
    }
    return isMainBusiness.value
      ? "请先在线生成三联单"
      : "请上传已选择的甲方材料";
  }
  if (!form.billingInfo.name.trim() || !form.billingInfo.taxNumber.trim())
    return "请完整填写开票名称和税号";
  if (!form.confirmedBillingIdentity) return "请确认开票名称和税号";
  if (!signatureDataUrl.value) return "请由申请人本人完成电子签名";
  return "申请信息完整，提交后由总经理审批并签字";
});

function emptyBillingInfo(): InvoiceApplicationBillingInfo {
  return {
    name: "",
    taxNumber: "",
    address: "",
    phone: "",
    bankName: "",
    bankAccount: "",
    remark: "",
  };
}

function money(value: string | number | null | undefined) {
  return formatContractMoney(value, "¥0.00");
}

function plainAmount(value: string | number | null | undefined): string {
  return (cents(value || 0) / 100).toFixed(2);
}

function cents(value: string | number): number {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function markTriplicateChanged() {
  markChangedAfterSignature();
}

function normalizeTriplicatePayment() {
  if (!String(form.amount || "").trim()) return;
  form.amount = plainAmount(form.amount);
}

function applyBillingInfo(value: InvoiceApplicationBillingInfo) {
  Object.assign(form.billingInfo, emptyBillingInfo(), value);
  initialBillingInfo.value = { ...form.billingInfo };
}

function applyApplication(application: InvoiceApplication) {
  currentApplication.value = application;
  form.contractId = application.contractId;
  form.amount =
    application.category === "main_business"
      ? Number(application.amount || 0).toFixed(2)
      : String(application.amount || "");
  form.invoiceType = application.invoiceType || "";
  form.description = application.description || "";
  form.materialMode = application.materialMode;
  form.confirmedBillingIdentity = Boolean(application.confirmedBillingIdentity);
  triplicateProjectName.value =
    application.triplicateProjectName || application.contractTitle || "";
  applyBillingInfo(application.billingInfo || emptyBillingInfo());
}

function markChangedAfterSignature() {
  if (!signatureDataUrl.value) return;
  signatureDataUrl.value = "";
  signatureOwner.value = "";
  signatureInvalidated.value = true;
}

function billingChanged() {
  if (form.confirmedBillingIdentity) form.confirmedBillingIdentity = false;
  markChangedAfterSignature();
}

function handleMaterialModeChange(
  value: string | number | boolean | undefined,
) {
  const next = String(value || "") as InvoiceApplicationMaterialMode;
  form.materialMode = next;
  if (next === "no_material") uploadFiles.value = [];
  if (next === "material_no_seal") pendingSealFileUids.value = new Set();
  if (next === "material_need_seal") {
    pendingSealFileUids.value = new Set(uploadFiles.value.map(fileKey));
  }
  markChangedAfterSignature();
  if (
    next === "material_no_seal" &&
    savedMaterials.value.some((material) => material.requiresSeal)
  ) {
    ElMessage.warning("已保存的需盖章材料请先删除，再按无需盖章方式重新上传");
  }
}

async function handleFileChange(_file: UploadFile, files: UploadFiles) {
  const allowedExtensions = isMainBusiness.value
    ? ["xls", "xlsx"]
    : ["xls", "xlsx", "pdf", "jpg", "jpeg", "png"];
  let validFiles = files.filter((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    return allowedExtensions.includes(extension);
  });
  if (validFiles.length !== files.length) {
    ElMessage.warning(
      isMainBusiness.value
        ? "主营三联单仅支持 xls、xlsx 文件"
        : "甲方材料仅支持 xls、xlsx、PDF、JPG、JPEG、PNG 文件",
    );
  }
  if (isMainBusiness.value) {
    if (savedMaterials.value.length) {
      ElMessage.warning(
        "主营项目只能保留一份三联单，请先删除已保存文件后再替换",
      );
      validFiles = [];
    } else if (validFiles.length > 1) {
      ElMessage.warning("主营项目只能上传一份固定三联单");
      validFiles = validFiles.slice(0, 1);
    }
  }
  uploadFiles.value = validFiles;
  if (isMainBusiness.value || form.materialMode === "material_need_seal") {
    pendingSealFileUids.value = new Set([
      ...pendingSealFileUids.value,
      ...validFiles.map(fileKey),
    ]);
  }
  markChangedAfterSignature();
  if (isMainBusiness.value && validFiles.length === 1) {
    const selectedFile = validFiles[0];
    const raw = selectedFile.raw as File | undefined;
    if (!raw) {
      removePendingFile(selectedFile);
      ElMessage.error("三联单文件读取失败，请重新选择");
      return;
    }
    const sequence = ++triplicateInspectionSequence;
    triplicateInspection.value = null;
    form.amount = "";
    triplicateInspecting.value = true;
    try {
      const inspection = await inspectMainTriplicate(form.contractId, raw);
      if (
        sequence !== triplicateInspectionSequence ||
        !uploadFiles.value.some(
          (item) => fileKey(item) === fileKey(selectedFile),
        )
      ) {
        return;
      }
      if (
        !Number.isInteger(inspection.paymentAmountCents) ||
        inspection.paymentAmountCents <= 0
      ) {
        throw new Error("三联单本次付款金额无效");
      }
      triplicateInspection.value = inspection;
      form.amount = (inspection.paymentAmountCents / 100).toFixed(2);
      ElMessage.success("已从三联单自动填写本次申请开票金额");
    } catch (error) {
      if (sequence !== triplicateInspectionSequence) return;
      removePendingFile(selectedFile);
      form.amount = "";
      triplicateInspection.value = null;
      ElMessage.error(
        getInvoiceApplicationErrorMessage(error, "三联单金额识别失败"),
      );
    } finally {
      if (sequence === triplicateInspectionSequence) {
        triplicateInspecting.value = false;
      }
    }
  }
}

function pendingFileRequiresSeal(file: UploadUserFile): boolean {
  if (isMainBusiness.value) return true;
  if (form.materialMode === "material_no_seal") return false;
  return pendingSealFileUids.value.has(fileKey(file));
}

function fileKey(file: UploadUserFile): string {
  return String(file.uid ?? file.name);
}

function togglePendingFileSeal(file: UploadUserFile) {
  if (isMainBusiness.value || form.materialMode === "material_no_seal") return;
  const next = new Set(pendingSealFileUids.value);
  const key = fileKey(file);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  pendingSealFileUids.value = next;
  markChangedAfterSignature();
}

function removePendingFile(file: UploadUserFile) {
  const key = fileKey(file);
  uploadFiles.value = uploadFiles.value.filter((item) => fileKey(item) !== key);
  const next = new Set(pendingSealFileUids.value);
  next.delete(key);
  pendingSealFileUids.value = next;
  if (isMainBusiness.value) {
    triplicateInspectionSequence += 1;
    triplicateInspection.value = null;
    triplicateInspecting.value = false;
    form.amount = "";
  }
  markChangedAfterSignature();
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
    signatureInvalidated.value = false;
    ElMessage.success("本人签名已确认，尚未提交审批");
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "调用本人电子签名失败"),
    );
  } finally {
    signatureLoading.value = false;
  }
}

function payload(): InvoiceApplicationDraftPayload {
  return {
    contractId: form.contractId,
    amount: form.amount.trim(),
    invoiceType: form.invoiceType,
    description: form.description.trim(),
    materialMode: isMainBusiness.value
      ? "material_need_seal"
      : form.materialMode,
    billingInfo: Object.fromEntries(
      Object.entries(form.billingInfo).map(([key, value]) => [
        key,
        value.trim(),
      ]),
    ) as unknown as InvoiceApplicationBillingInfo,
    confirmedBillingIdentity: form.confirmedBillingIdentity,
  };
}

async function generateOnlineTriplicate() {
  if (!canGenerateTriplicate.value || !form.contractId) return;
  triplicateGenerating.value = true;
  try {
    normalizeTriplicatePayment();
    let application = currentApplication.value;
    if (!application) {
      application = await createInvoiceApplication(payload());
    } else if (
      savedMaterials.value.length === 0 ||
      cents(application.amount) === cents(form.amount)
    ) {
      application = await updateInvoiceApplication(application.id, {
        ...payload(),
        expectedVersion: application.version,
      });
    }
    application = await generateMainBusinessTriplicate(application.id, {
      projectName: triplicateProjectName.value.trim(),
      amount: form.amount.trim(),
      expectedVersion: application.version,
    });
    application = await updateInvoiceApplication(application.id, {
      ...payload(),
      expectedVersion: application.version,
    });
    applyApplication(application);
    signatureDataUrl.value = "";
    signatureOwner.value = "";
    signatureInvalidated.value = true;
    if (!applicationId.value) {
      await router.replace({
        path: "/invoice-applications/new",
        query: { contractId: form.contractId, applicationId: application.id },
      });
    }
    ElMessage.success("三页三联单已生成，可在线预览后提交审批");
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "在线生成三联单失败"),
    );
  } finally {
    triplicateGenerating.value = false;
  }
}

async function persistDraft(): Promise<InvoiceApplication> {
  let application: InvoiceApplication;
  if (currentApplication.value) {
    application = await updateInvoiceApplication(currentApplication.value.id, {
      ...payload(),
      expectedVersion: currentApplication.value.version,
    });
  } else {
    application = await createInvoiceApplication(payload());
  }
  currentApplication.value = application;
  if (uploadFiles.value.length) {
    const sealFiles = uploadFiles.value.filter((file) =>
      pendingFileRequiresSeal(file),
    );
    const ordinaryFiles = uploadFiles.value.filter(
      (file) => !pendingFileRequiresSeal(file),
    );
    if (sealFiles.length) {
      application = await uploadPendingMaterials(application, sealFiles, true);
    }
    if (ordinaryFiles.length) {
      application = await uploadPendingMaterials(
        application,
        ordinaryFiles,
        false,
      );
    }
  }
  return application;
}

async function uploadPendingMaterials(
  application: InvoiceApplication,
  files: UploadUserFile[],
  requiresSeal: boolean,
): Promise<InvoiceApplication> {
  const raw = rawFiles(files);
  if (raw.length !== files.length)
    throw new Error("部分材料文件读取失败，请重新选择");
  const updated = await uploadInvoiceApplicationMaterials(
    application.id,
    raw,
    requiresSeal,
  );
  currentApplication.value = updated;
  const uploadedKeys = new Set(files.map(fileKey));
  uploadFiles.value = uploadFiles.value.filter(
    (file) => !uploadedKeys.has(fileKey(file)),
  );
  pendingSealFileUids.value = new Set(
    [...pendingSealFileUids.value].filter((key) => !uploadedKeys.has(key)),
  );
  return updated;
}

function rawFiles(files: UploadUserFile[]): File[] {
  return files.flatMap((file) => (file.raw ? [file.raw as File] : []));
}

async function saveDraft(showSuccess = true) {
  if (!canSaveDraft.value || !form.contractId) return null;
  saving.value = true;
  try {
    const application = await persistDraft();
    if (showSuccess) ElMessage.success("开票申请草稿已保存");
    if (!applicationId.value) {
      await router.replace({
        path: "/invoice-applications/new",
        query: { contractId: form.contractId, applicationId: application.id },
      });
    }
    return application;
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "保存开票申请草稿失败"),
    );
    return null;
  } finally {
    saving.value = false;
  }
}

async function submitApplication() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const application = await persistDraft();
    await submitInvoiceApplication(application.id, application.version);
    ElMessage.success("开票申请已提交，下一步由总经理审批并签字");
    requestContractDownloadBadgeRefresh();
    await router.push("/contract-applications/mine?tab=invoice");
  } catch (error) {
    ElMessage.error(
      getInvoiceApplicationErrorMessage(error, "提交开票申请失败"),
    );
  } finally {
    submitting.value = false;
  }
}

function previewMaterial(materialId: string) {
  if (!currentApplication.value) return;
  const material = savedMaterials.value.find((item) => item.id === materialId);
  const useDownload =
    !isMainBusiness.value && isSpreadsheetMaterial(material?.mimeType || "");
  window.open(
    useDownload
      ? getInvoiceApplicationMaterialDownloadUrl(
          currentApplication.value.id,
          materialId,
        )
      : getInvoiceApplicationMaterialPreviewUrl(
          currentApplication.value.id,
          materialId,
        ),
    "_blank",
    "noopener,noreferrer",
  );
}

function isSpreadsheetMaterial(mimeType: string): boolean {
  return /excel|spreadsheet|sheet/i.test(mimeType);
}

function materialActionLabel(mimeType: string): string {
  return !isMainBusiness.value && isSpreadsheetMaterial(mimeType)
    ? "下载查看"
    : "预览";
}

async function removeSavedMaterial(materialId: string) {
  if (!currentApplication.value) return;
  const removedMaterial = savedMaterials.value.find(
    (material) => material.id === materialId,
  );
  try {
    await ElMessageBox.confirm("确认删除这份申请材料？", "删除材料", {
      type: "warning",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  deletingMaterialId.value = materialId;
  try {
    currentApplication.value = await deleteInvoiceApplicationMaterial(
      currentApplication.value.id,
      materialId,
      currentApplication.value.version,
    );
    if (isMainBusiness.value && !removedMaterial?.isSystemGeneratedTriplicate) {
      triplicateInspection.value = null;
      form.amount = "";
    }
    markChangedAfterSignature();
    ElMessage.success("材料已删除");
  } catch (error) {
    ElMessage.error(getInvoiceApplicationErrorMessage(error, "删除材料失败"));
  } finally {
    deletingMaterialId.value = "";
  }
}

async function loadPage() {
  loading.value = true;
  errorMessage.value = "";
  try {
    let application: InvoiceApplication | null = null;
    if (applicationId.value) {
      application = await getInvoiceApplication(applicationId.value);
      applyApplication(application);
      prefillSourceId.value = application.id;
    }
    const targetContractId =
      application?.contractId || String(route.query.contractId || "").trim();
    if (!targetContractId) throw new Error("缺少需要申请开票的合同编号");
    eligibility.value =
      await getInvoiceApplicationEligibility(targetContractId);
    form.contractId = targetContractId;
    if (!eligibility.value.contract) {
      throw new Error(eligibility.value.reason || "合同不存在或无权访问");
    }
    if (eligibility.value.contract.category === "main_business") {
      form.materialMode = "material_need_seal";
      if (!triplicateProjectName.value) {
        triplicateProjectName.value = eligibility.value.contract.title;
      }
    }
    if (!application && eligibility.value.billingPrefill) {
      const { sourceApplicationId, ...billingInfo } =
        eligibility.value.billingPrefill;
      prefillSourceId.value = sourceApplicationId || "history";
      applyBillingInfo(billingInfo);
    }
    if (!application && !eligibility.value.eligible) {
      errorMessage.value =
        eligibility.value.reason || "当前合同不能发起开票申请";
    }
  } catch (error) {
    errorMessage.value = getInvoiceApplicationErrorMessage(
      error,
      "读取开票申请页面失败",
    );
  } finally {
    loading.value = false;
  }
}

onMounted(loadPage);
</script>

<style scoped>
.invoice-application-create {
  min-height: 100%;
  padding: 24px;
  color: #17324d;
  background: #f4f8fb;
}
.page-heading,
.card-title,
.section-heading,
.submit-bar,
.saved-materials article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-heading {
  margin-bottom: 18px;
}
.page-heading span,
.card-title small {
  color: #0f8d87;
  font-weight: 700;
}
.page-heading h1 {
  margin: 5px 0;
  font-size: 28px;
}
.page-heading p {
  margin: 0;
  color: #718399;
}
.application-card {
  min-height: 360px;
  padding: 24px;
  border: 1px solid #dce7ef;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 30px rgb(37 62 86 / 7%);
}
.card-title h2 {
  margin: 5px 0 0;
  font-size: 22px;
}
.contract-summary {
  margin-top: 20px;
}
.amount-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0;
}
.amount-grid article {
  padding: 16px;
  border: 1px solid #deeaef;
  border-radius: 12px;
  background: #f8fbfc;
}
.amount-grid span {
  display: block;
  margin-bottom: 10px;
  color: #74869a;
}
.amount-grid strong {
  font-size: 21px;
  color: #17324d;
}
.amount-grid .remaining {
  background: #edf9f7;
  border-color: #bce5df;
}
.amount-grid .remaining strong {
  color: #087f77;
}
.application-form {
  display: flex;
  flex-direction: column;
  margin-top: 20px;
}
.main-business-form .material-section {
  order: 1;
}
.main-business-form .content-section {
  order: 2;
}
.main-business-form .billing-section {
  order: 3;
}
.main-business-form .signature-section {
  order: 4;
}
.form-section {
  margin-top: 16px;
  padding: 22px;
  border: 1px solid #dfe9ef;
  border-radius: 14px;
  background: #fff;
}
.section-heading {
  margin-bottom: 18px;
}
.section-heading > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.section-heading b {
  display: inline-grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  color: #07867f;
  background: #e5f5f2;
}
.section-heading strong,
.section-heading small {
  display: block;
}
.section-heading small {
  margin-top: 3px;
  color: #8291a2;
}
.form-grid,
.billing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}
.wide-field {
  grid-column: 1 / -1;
}
.field-tip {
  display: block;
  margin-top: 7px;
  color: #8493a4;
  line-height: 1.5;
}
.material-modes {
  margin-bottom: 16px;
}
.material-upload {
  margin-top: 16px;
}
.online-triplicate {
  margin-top: 16px;
}
.triplicate-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 18px;
}
.triplicate-amount-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 8px 0 16px;
}
.triplicate-amount-grid article {
  padding: 13px 14px;
  border: 1px solid #dce8ed;
  border-radius: 10px;
  background: #f7fafb;
}
.triplicate-amount-grid span {
  display: block;
  margin-bottom: 7px;
  color: #74869a;
  font-size: 12px;
}
.triplicate-amount-grid strong {
  color: #17324d;
  font-size: 19px;
  font-variant-numeric: tabular-nums;
}
.triplicate-amount-grid .current,
.triplicate-amount-grid .cumulative {
  border-color: #bce5df;
  background: #edf9f7;
}
.triplicate-amount-grid .current strong,
.triplicate-amount-grid .cumulative strong {
  color: #087f77;
}
.triplicate-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.triplicate-actions span {
  color: #7b8d9e;
  font-size: 12px;
}
.triplicate-result {
  margin-top: 16px;
}
.upload-icon {
  font-size: 38px;
  color: #23a29b;
}
.saved-materials,
.pending-materials {
  margin-top: 16px;
}
.saved-materials > strong,
.pending-materials > strong {
  display: block;
  margin-bottom: 8px;
}
.saved-materials article,
.pending-materials article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border-radius: 9px;
  background: #f4f9fa;
}
.saved-materials article > span,
.pending-materials article > span {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.pending-materials article + article,
.saved-materials article + article {
  margin-top: 6px;
}
.identity-confirmation {
  padding: 12px 14px;
  border-radius: 8px;
  background: #f0f8f7;
}
.signature-slot {
  display: flex;
  min-height: 118px;
  width: min(560px, 100%);
  margin: 0 auto;
  padding: 18px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #85c9c4;
  border-radius: 12px;
  color: #147f79;
  background: #f4fbfa;
  cursor: pointer;
}
.signature-slot img {
  max-width: 220px;
  max-height: 72px;
}
.signature-slot small {
  color: #7b8d9f;
}
.signature-slot.signed {
  border-style: solid;
  cursor: default;
}
.signature-section :deep(.el-alert) {
  margin-top: 12px;
}
.submit-bar {
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin-top: 18px;
  padding: 14px 16px;
  border: 1px solid #dce8ee;
  border-radius: 12px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 -8px 24px rgb(30 55 77 / 6%);
}
.submit-bar > span {
  color: #75869a;
}
@media (max-width: 980px) {
  .amount-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .contract-summary {
    --el-descriptions-table-border: 1px solid #dfe7ec;
  }
}
@media (max-width: 640px) {
  .invoice-application-create {
    padding: 12px;
  }
  .page-heading,
  .submit-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .application-card,
  .form-section {
    padding: 14px;
  }
  .amount-grid,
  .form-grid,
  .billing-grid,
  .triplicate-form-grid,
  .triplicate-amount-grid {
    grid-template-columns: 1fr;
  }
  .triplicate-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .wide-field {
    grid-column: auto;
  }
  .submit-bar > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
