<template>
  <div class="contract-create-page">
    <header class="create-header">
      <div class="header-copy">
        <el-button
          :icon="ArrowLeft"
          circle
          aria-label="返回合同台账"
          @click="router.push('/contracts')"
        />
        <div>
          <span class="header-kicker">智能合同录入</span>
          <h1>{{ quickAgreementMode ? quickUploadTitle : "新增合同" }}</h1>
          <p>
            {{
              quickAgreementMode
                ? quickUploadDescription
                : "上传合同后由系统自动识别并复核关键字段，不采用不可靠结果。"
            }}
          </p>
        </div>
      </div>
      <div class="header-actions">
        <el-button
          v-if="contractId"
          :loading="saving"
          @click="saveCurrentProgress(true)"
          >保存草稿</el-button
        >
        <el-button v-if="activeStep > 0" @click="previousStep"
          >上一步</el-button
        >
        <el-button
          v-if="activeStep < 4"
          type="primary"
          :disabled="!canContinue"
          :loading="saving"
          @click="nextStep"
        >
          下一步
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="submitting"
          @click="submitForApproval"
        >
          {{ approvalSubmitLabel }}
        </el-button>
      </div>
    </header>

    <el-steps
      class="create-steps"
      :active="activeStep"
      align-center
      finish-status="success"
    >
      <el-step title="上传合同" description="创建识别任务" />
      <el-step title="自动识别" description="系统复核结果" />
      <el-step
        :title="
          rentalRenewalMode
            ? '来源与新合同'
            : quickAgreementMode
              ? '继承信息'
              : '项目与层级'
        "
        :description="
          quickAgreementMode
            ? quickInheritanceStepText
            : '核对项目归属和上级合同'
        "
      />
      <el-step title="补充资料" description="完善用印附件" />
      <el-step title="确认提交" :description="approvalStepDescription" />
    </el-steps>

    <div class="live-region" aria-live="polite" aria-atomic="true">
      {{ liveStatus }}
    </div>

    <el-alert
      v-if="pageError"
      class="page-alert"
      type="error"
      show-icon
      :closable="false"
      :title="pageError"
    >
      <template #default>
        <el-button
          v-if="canResumeRecognition"
          type="primary"
          link
          @click="resumeRecognition"
        >
          继续查询识别进度
        </el-button>
        <el-button
          v-if="canRetryRecognition"
          type="danger"
          link
          @click="retryRecognition"
        >
          重新识别
        </el-button>
      </template>
    </el-alert>

    <main v-loading="uploading || saving || restoring" class="create-workspace">
      <section class="preview-column">
        <div class="column-heading">
          <div>
            <span>合同原文</span>
            <small>{{ sourceFileName || "尚未选择文件" }}</small>
          </div>
          <el-tag v-if="ocrJob" :type="ocrStatusType" effect="light">
            {{ ocrStatusLabel }}
          </el-tag>
        </div>

        <ContractFilePreview
          :url="previewUrl"
          :file-name="sourceFileName"
          :mime-type="sourceMimeType"
          :loading="recognizing && !previewUrl"
        />

        <div
          v-if="activeStep === 0 || (!selectedFile && !sourceFileId)"
          class="upload-overlay"
        >
          <button
            type="button"
            class="upload-dropzone"
            :class="{
              'is-dragging': isDragging,
              'is-disabled': !uploadSetupComplete,
            }"
            :disabled="!uploadSetupComplete || uploading"
            :aria-disabled="!uploadSetupComplete"
            @click="requestSourceFile"
            @keydown.enter.prevent="requestSourceFile"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleSourceDrop"
          >
            <span class="upload-icon"
              ><el-icon :size="34"><UploadFilled /></el-icon
            ></span>
            <strong>
              {{
                uploading
                  ? "正在上传合同…"
                  : uploadSetupComplete
                    ? "点击或拖拽上传合同"
                    : quickAgreementMode
                      ? quickTerminationMode
                        ? "正在读取解除对象与履行金额"
                        : rentalRenewalMode
                          ? "正在读取原租赁合同信息"
                          : "正在读取主合同信息"
                      : "请先完成行政区、合同类型与合同层级选择"
              }}
            </strong>
            <span>{{
              uploadSetupComplete
                ? "支持 PDF、DOC、DOCX，单个文件不超过 30MB"
                : quickAgreementMode
                  ? quickTerminationMode
                    ? "解除对象核对完成后开放文件上传"
                    : rentalRenewalMode
                      ? "原租赁合同核对完成后开放文件上传"
                      : "主合同信息读取完成后开放文件上传"
                  : "选择完成后开放文件上传"
            }}</span>
          </button>
          <input
            ref="sourceInput"
            hidden
            type="file"
            accept=".pdf,.doc,.docx"
            :disabled="!uploadSetupComplete || uploading"
            @change="handleSourceInput"
          />
        </div>
      </section>

      <section class="form-column">
        <template v-if="activeStep === 0">
          <div class="section-heading">
            <span class="section-index">01</span>
            <div>
              <h2>上传草拟合同</h2>
              <p>
                {{
                  quickAgreementMode
                    ? quickUploadDescription
                    : "文件上传后将自动创建合同草稿并进入识别队列。"
                }}
              </p>
            </div>
          </div>
          <div v-if="quickAgreementMode" class="supplement-inherited-panel">
            <el-skeleton v-if="supplementContextLoading" :rows="6" animated />
            <template
              v-else-if="quickTerminationMode && terminationUploadContext"
            >
              <el-alert
                v-if="!terminationUploadContext.canUpload"
                type="error"
                show-icon
                :closable="false"
                title="当前合同不能上传解除协议书"
                :description="
                  terminationUploadContext.blockingReason ||
                  '请返回合同详情核对当前状态'
                "
              />
              <el-descriptions v-else :column="2" border>
                <el-descriptions-item label="解除协议名称" :span="2">
                  {{ terminationAgreementName }}
                </el-descriptions-item>
                <el-descriptions-item label="解除对象" :span="2">
                  {{ terminationUploadContext.targetName }}
                </el-descriptions-item>
                <el-descriptions-item label="解除前合同有效金额" :span="2">
                  {{
                    formatContractMoney(
                      terminationUploadContext.currentEffectiveAmount,
                    )
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="已履行金额">
                  {{
                    formatContractMoney(terminationUploadContext.settledAmount)
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="解除后不再履行金额">
                  {{
                    formatContractMoney(
                      terminationUploadContext.unperformedAmount,
                    )
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="解除后最终合同金额" :span="2">
                  {{
                    formatContractMoney(terminationUploadContext.settledAmount)
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="甲方单位">
                  {{ terminationUploadContext.partyA }}
                </el-descriptions-item>
                <el-descriptions-item label="乙方单位">
                  {{ terminationUploadContext.partyB }}
                </el-descriptions-item>
              </el-descriptions>
            </template>
            <template
              v-else-if="rentalRenewalMode && rentalRenewalUploadContext"
            >
              <el-alert
                v-if="!rentalRenewalUploadContext.canUpload"
                type="error"
                show-icon
                :closable="false"
                title="当前租赁合同不能续签"
                :description="
                  rentalRenewalUploadContext.blockingReason ||
                  '请返回原合同详情核对当前状态'
                "
              />
              <el-descriptions v-else :column="2" border>
                <el-descriptions-item label="续签来源" :span="2">
                  {{ rentalRenewalUploadContext.sourceContractName }}
                </el-descriptions-item>
                <el-descriptions-item label="原合同当前到期日">
                  {{ rentalRenewalUploadContext.currentLeaseEndDate }}
                </el-descriptions-item>
                <el-descriptions-item label="新合同层级">
                  独立主合同
                </el-descriptions-item>
                <el-descriptions-item label="所属行政区">
                  {{ rentalRenewalUploadContext.area }}
                </el-descriptions-item>
                <el-descriptions-item label="合同类型">
                  {{
                    categoryLabel(rentalRenewalUploadContext.declaredCategory)
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="甲方单位">
                  {{ rentalRenewalUploadContext.partyA }}
                </el-descriptions-item>
                <el-descriptions-item label="乙方单位">
                  {{ rentalRenewalUploadContext.partyB }}
                </el-descriptions-item>
              </el-descriptions>
            </template>
            <template v-else-if="supplementUploadContext">
              <el-alert
                v-if="!supplementUploadContext.canUpload"
                type="error"
                show-icon
                :closable="false"
                title="当前主合同不能上传补充协议"
                :description="
                  supplementUploadContext.blockingReason ||
                  '请返回主合同核对当前状态'
                "
              />
              <el-descriptions v-else :column="2" border>
                <el-descriptions-item label="补充协议名称" :span="2">
                  {{ supplementUploadContext.generatedContractName }}
                </el-descriptions-item>
                <el-descriptions-item label="上级主合同">
                  {{ supplementUploadContext.parentContractName }}
                </el-descriptions-item>
                <el-descriptions-item label="补充协议序号">
                  补充协议（{{ supplementUploadContext.supplementSequence }}）
                </el-descriptions-item>
                <el-descriptions-item label="所属行政区">
                  {{ supplementUploadContext.area }}
                </el-descriptions-item>
                <el-descriptions-item label="合同类型">
                  {{ categoryLabel(supplementUploadContext.declaredCategory) }}
                </el-descriptions-item>
                <el-descriptions-item label="关联项目">
                  {{ supplementUploadContext.projectName || "—" }}
                </el-descriptions-item>
                <el-descriptions-item label="甲方单位">
                  {{ supplementUploadContext.partyA }}
                </el-descriptions-item>
                <el-descriptions-item label="乙方单位">
                  {{ supplementUploadContext.partyB }}
                </el-descriptions-item>
              </el-descriptions>
            </template>
          </div>
          <el-form v-else label-position="top" class="upload-prerequisite-form">
            <el-form-item label="所属行政区" required>
              <el-select
                v-model="form.area"
                placeholder="请先选择合同所属行政区"
                style="width: 100%"
                :disabled="
                  Boolean(contractId) || uploading || recognizing || !metaReady
                "
                @change="handleUploadContextChange"
              >
                <el-option
                  v-for="area in meta.areas"
                  :key="area"
                  :label="area"
                  :value="area"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="合同类型" required>
              <el-radio-group
                v-model="form.declaredCategory"
                class="upload-category-group"
                :disabled="
                  Boolean(contractId) || uploading || recognizing || !metaReady
                "
                @change="handleDeclaredCategoryChange"
              >
                <el-radio
                  v-for="option in uploadCategoryOptions"
                  :key="option.value"
                  :value="option.value"
                  border
                  class="upload-category-option"
                >
                  <span class="category-option-copy">
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                </el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="
                form.declaredCategory === 'asset' && !requiresParentContract
              "
              label="合同二级分类"
              required
            >
              <el-select
                v-model="form.declaredSubtype"
                placeholder="请选择资产合同二级分类"
                style="width: 100%"
                :disabled="
                  Boolean(contractId) || uploading || recognizing || !metaReady
                "
                @change="handleAssetSubtypeChange"
              >
                <el-option
                  v-for="option in meta.declaredSubtypeOptions.asset"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="合同层级关系" required>
              <el-radio-group
                v-model="form.relationType"
                class="relation-options"
                :disabled="
                  Boolean(contractId) || uploading || recognizing || !metaReady
                "
                @change="handleRelationTypeChange"
              >
                <el-radio-button value="main">主合同</el-radio-button>
                <el-radio-button value="supplement">补充协议</el-radio-button>
              </el-radio-group>
              <p class="locked-field-tip">
                合同层级决定金额识别口径，上传后锁定；主合同为一级合同，无需关联上级合同。
              </p>
            </el-form-item>
            <el-form-item
              v-if="requiresParentContract"
              label="关联上级合同（二级）"
              required
            >
              <el-select
                v-model="form.parentContractId"
                filterable
                placeholder="请在上传前选择一级主合同"
                style="width: 100%"
                :loading="relatedLoading"
                :disabled="
                  Boolean(contractId) ||
                  !uploadParentContextReady ||
                  uploading ||
                  recognizing
                "
                @change="handleParentContractChange"
              >
                <el-option
                  v-for="contract in relatedContracts"
                  :key="contract.id"
                  :label="`${contract.name}（${contract.contractNo || '暂无编号'}）`"
                  :value="contract.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="是否需要添加辅助材料" required>
              <el-radio-group
                v-model="form.requiresAuxiliaryMaterials"
                :disabled="Boolean(contractId) || uploading || recognizing"
              >
                <el-radio :value="false" border>否</el-radio>
                <el-radio :value="true" border>是</el-radio>
              </el-radio-group>
              <p class="locked-field-tip">
                默认选择“否”；选择“是”后，合同台账操作区会显示“添加辅助材料”。
              </p>
            </el-form-item>
          </el-form>
          <div class="feature-list">
            <article>
              <el-icon><MagicStick /></el-icon>
              <div>
                <strong>智能字段提取</strong
                ><span
                  >自动识别甲方、乙方、项目和金额；合同类型采用上传前选择值，草拟合同签订日期可留空，盖章归档时同步。</span
                >
              </div>
            </article>
            <article>
              <el-icon><Aim /></el-icon>
              <div>
                <strong>系统自动复核</strong
                ><span
                  >甲方、乙方、{{
                    subjectNameLabel
                  }}和金额四个识别必需字段均通过自动安全门禁且无候选冲突才会自动写入；合同类型采用上传前选择值，草拟签订日期可留空。</span
                >
              </div>
            </article>
            <article>
              <el-icon><Connection /></el-icon>
              <div>
                <strong>项目智能匹配</strong
                ><span>{{
                  projectAssociationAllowed
                    ? "根据项目名称推荐已有项目，项目归属仍可留空。"
                    : "资产类合同自动识别合同名称，不关联项目。"
                }}</span>
              </div>
            </article>
          </div>
        </template>

        <template v-else-if="activeStep === 1">
          <div class="section-heading">
            <span class="section-index">02</span>
            <div>
              <h2>自动识别结果</h2>
              <p v-if="ocrJob?.status === 'succeeded'">
                系统已完成字段精准识别与安全核验，以下内容可直接用于合同创建。
              </p>
              <p v-else>
                查看
                OCR（光学字符识别）转写；未自动通过时只能重新自动识别，合同字段不允许人工填写。合同类型采用上传前选择值，签订日期在草拟阶段可留空。
              </p>
            </div>
          </div>

          <div
            v-if="recognizing"
            class="recognition-progress"
            aria-live="polite"
          >
            <span class="recognition-orbit"
              ><el-icon class="is-loading"><Loading /></el-icon
            ></span>
            <div>
              <strong>正在智能识别合同</strong>
              <span>任务已进入处理队列，完成后会自动填充字段。</span>
            </div>
          </div>

          <ContractOcrFieldEditor
            :fields="displayedOcrFields"
            :accepted="ocrJob?.status === 'succeeded'"
            :declared-category="form.declaredCategory"
            :relation-type="form.relationType"
          />

          <el-alert
            v-if="relationRecognitionBlocker"
            type="error"
            show-icon
            :closable="false"
            title="补充协议关联的上级合同不正确"
            :description="relationRecognitionBlocker"
          />

          <div
            v-if="automaticRecognitionBlocked"
            class="recognition-blocked-panel"
          >
            <el-alert
              type="warning"
              show-icon
              :closable="false"
              title="自动识别未通过安全校验"
              :description="
                ocrJob?.errorMessage ||
                '当前结果不会写入合同字段，请重新自动识别。合同字段不允许手动填写或人工采用。'
              "
            />
            <div class="recognition-blocked-actions">
              <el-button
                type="primary"
                :disabled="recognizing"
                @click="retryRecognition"
              >
                重新自动识别
              </el-button>
            </div>
          </div>

          <el-alert
            v-if="form.partyA.trim() && form.partyB.trim() && !partiesDifferent"
            class="field-alert"
            type="error"
            :closable="false"
            show-icon
            title="甲方单位与乙方单位不能相同"
          />

          <el-alert
            v-if="form.amount && !amountPrecisionValid"
            class="field-alert"
            type="error"
            :closable="false"
            show-icon
            title="合同金额格式不正确"
            description="金额最多保留两位小数，且不能超过系统安全计算范围。"
          />
        </template>

        <template v-else-if="activeStep === 2">
          <div class="section-heading">
            <span class="section-index">03</span>
            <div>
              <h2>
                {{
                  quickAgreementMode
                    ? quickInheritanceStepText
                    : projectAssociationAllowed
                      ? "确认可选项目归属与合同层级"
                      : "确认合同层级"
                }}
              </h2>
              <p v-if="quickAgreementMode">
                {{ quickInheritanceDescription }}
              </p>
              <p v-else-if="projectAssociationAllowed">
                系统根据“{{
                  form.projectName || subjectNameLabel
                }}”推荐归属项目；主合同本身是一级合同。
              </p>
              <p v-else>资产类合同不关联项目，仅需核对合同层级与资产分类。</p>
            </div>
          </div>

          <div
            v-if="
              projectAssociationAllowed &&
              !quickAgreementMode &&
              suggestedProjects.length
            "
            class="project-suggestions"
          >
            <span class="suggestion-title"
              ><el-icon><MagicStick /></el-icon>智能匹配建议</span
            >
            <button
              v-for="project in suggestedProjects"
              :key="project.id"
              type="button"
              :class="{ selected: form.projectId === project.id }"
              @click="selectProject(project.id)"
            >
              <span>
                <strong>{{ project.name }}</strong>
                <small
                  >{{ project.clientName || "甲方待完善" }} ·
                  {{ project.matchReason }}</small
                >
              </span>
              <el-icon><Select /></el-icon>
            </button>
          </div>

          <el-form label-position="top" class="relation-form">
            <el-form-item
              v-if="projectAssociationAllowed && !quickAgreementMode"
              label="归属项目（可选，用于经营统计）"
            >
              <el-select
                v-model="form.projectId"
                filterable
                clearable
                placeholder="可暂不选择归属项目"
                style="width: 100%"
                @change="handleProjectChange"
              >
                <el-option
                  v-for="project in sameAreaProjects"
                  :key="project.id"
                  :label="project.name"
                  :value="project.id"
                />
              </el-select>
              <p class="locked-field-tip">
                关联项目为可选项；未选择时可继续完善合同，选择后用于项目金额累计和经营统计。
              </p>
            </el-form-item>
            <el-form-item label="合同层级关系" required>
              <el-input :model-value="relationTypeLabel" readonly />
              <p class="locked-field-tip">
                合同层级已在上传前锁定，确保识别金额使用正确的主合同或协议增减额口径。
              </p>
            </el-form-item>
            <el-alert
              class="hierarchy-alert"
              :type="requiresParentContract ? 'warning' : 'info'"
              :closable="false"
              show-icon
              :title="contractHierarchyTitle"
              :description="contractHierarchyDescription"
            />
            <el-alert
              v-if="supplementChangeType === 'payment_terms_only'"
              type="success"
              show-icon
              :closable="false"
              title="仅变更付款方式"
              description="本次增减为 0，合同当前有效总额保持不变，分期金额不会被当作新的合同总额。"
            />
            <el-descriptions
              v-if="form.relationType === 'supplement'"
              class="supplement-amount-details"
              :column="3"
              border
            >
              <el-descriptions-item label="主合同原始金额">
                {{
                  formatContractMoney(
                    supplementAmountContext.originalContractAmount,
                    "—",
                  )
                }}
              </el-descriptions-item>
              <el-descriptions-item label="本协议生效前金额">
                {{
                  formatContractMoney(
                    supplementAmountContext.amountBeforeChange,
                    "—",
                  )
                }}
              </el-descriptions-item>
              <el-descriptions-item label="本次增减">
                {{ formatContractMoney(displayedSupplementAmountDelta) }}
              </el-descriptions-item>
              <el-descriptions-item label="本协议生效后金额">
                {{
                  formatContractMoney(
                    supplementAmountContext.amountAfterChange,
                    "—",
                  )
                }}
              </el-descriptions-item>
              <el-descriptions-item label="当前有效合同总额">
                {{
                  formatContractMoney(
                    supplementAmountContext.currentEffectiveAmount,
                    "—",
                  )
                }}
              </el-descriptions-item>
            </el-descriptions>
            <el-descriptions
              v-if="quickTerminationMode && terminationUploadContext"
              class="supplement-amount-details"
              :column="2"
              border
            >
              <el-descriptions-item label="解除前合同有效金额">
                {{
                  formatContractMoney(
                    terminationUploadContext.currentEffectiveAmount,
                  )
                }}
              </el-descriptions-item>
              <el-descriptions-item label="已履行金额">
                {{
                  formatContractMoney(terminationUploadContext.settledAmount)
                }}
              </el-descriptions-item>
              <el-descriptions-item label="解除后不再履行金额">
                {{
                  formatContractMoney(
                    terminationUploadContext.unperformedAmount,
                  )
                }}
              </el-descriptions-item>
              <el-descriptions-item label="解除后最终合同金额">
                {{
                  formatContractMoney(terminationUploadContext.settledAmount)
                }}
              </el-descriptions-item>
            </el-descriptions>
            <el-form-item
              v-if="!paymentTermsOnlySupplement && !quickTerminationMode"
              :label="
                form.relationType === 'supplement' ? '本次增减金额' : '合同金额'
              "
              :required="supplementChangeType !== 'payment_terms_only'"
            >
              <el-input
                v-model="form.amount"
                inputmode="decimal"
                readonly
                placeholder="由合同自动识别"
              >
                <template #prepend>¥</template>
              </el-input>
              <p
                class="amount-rule-tip"
                :class="{ invalid: form.amount && !amountRelationValid }"
              >
                {{ amountRuleText }}
              </p>
            </el-form-item>
            <el-form-item
              v-if="requiresParentContract && !quickTerminationMode"
              label="关联上级合同（二级）"
              required
            >
              <el-input :model-value="selectedParentContractName" readonly />
              <p class="locked-field-tip">
                上级合同已在上传时锁定；如选择有误，请删除草稿后重新上传。
              </p>
            </el-form-item>
            <el-form-item v-if="quickTerminationMode" label="解除对象" required>
              <el-input :model-value="terminationTargetName" readonly />
              <p class="locked-field-tip">
                解除对象已从合同详情锁定；解除协议归档生效后，该合同不再付款并结束。
              </p>
            </el-form-item>
            <div class="form-grid">
              <el-form-item label="区域" required>
                <el-input :model-value="form.area" readonly />
                <p class="locked-field-tip">
                  {{
                    projectAssociationAllowed
                      ? "行政区已在上传前锁定；项目归属必须同区，只有二级协议需要同区上级合同。"
                      : "行政区已在上传前锁定；资产类合同不关联项目，只有二级协议需要同区上级合同。"
                  }}
                </p>
              </el-form-item>
            </div>
            <el-form-item label="合同说明">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                :placeholder="
                  rentalRenewalMode
                    ? '可补充本次续签新合同的说明'
                    : '可补充协议背景、金额增减原因等说明'
                "
              />
            </el-form-item>
          </el-form>
        </template>

        <template v-else-if="activeStep === 3">
          <div class="section-heading">
            <span class="section-index">04</span>
            <div>
              <h2>在线填写用印申请单</h2>
              <p>{{ supportingRequirementText }}</p>
            </div>
          </div>

          <el-alert
            v-if="sealApplicationError"
            type="error"
            show-icon
            :closable="false"
            :title="sealApplicationError"
            style="margin-bottom: 16px"
          />
          <ContractSealApplicationEditor
            v-model="sealApplicationFields"
            :contract="sealApplicationSummary"
            :disabled="sealApplicationLoading"
            :signing="sealApplicationSigning"
            :signed="sealApplicationSigned"
            :signed-by="sealApplication?.signerName"
            :signed-at="sealApplication?.signedAt"
            :signed-file-url="sealApplicationSignedFileUrl"
            generated-file-name="系统已生成并归档 PDF 用印申请单"
            @sign="signCurrentSealApplication"
          />

          <div class="optional-supporting-heading">
            <div>
              <strong>其他补充资料（可选）</strong>
              <p>三联单、请款资料在实际付款环节按需补充，本阶段不要求上传。</p>
            </div>
          </div>
          <div class="support-file-grid optional-support-file-grid">
            <article
              v-for="option in supportingFileOptions"
              :key="option.value"
              class="support-file-card"
            >
              <div class="support-file-title">
                <span class="support-icon"
                  ><el-icon><Document /></el-icon
                ></span>
                <div>
                  <strong>{{ option.label }}</strong
                  ><small>{{ option.description }}</small>
                </div>
                <el-tag v-if="option.required" type="danger" size="small"
                  >必传</el-tag
                >
              </div>
              <div
                v-if="findSupportingFile(option.value)"
                class="selected-file"
              >
                <el-icon><DocumentChecked /></el-icon>
                <span :title="findSupportingFile(option.value)?.fileName">
                  {{ findSupportingFile(option.value)?.fileName }}
                </span>
                <el-button
                  link
                  type="danger"
                  @click="removeSupportingFile(option.value)"
                  >移除</el-button
                >
              </div>
              <el-upload
                v-else
                :auto-upload="false"
                :show-file-list="false"
                :on-change="
                  (file: UploadFile) => selectSupportingFile(file, option.value)
                "
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              >
                <el-button :icon="Upload">选择文件</el-button>
              </el-upload>
            </article>
          </div>
        </template>

        <template v-else>
          <div class="section-heading">
            <span class="section-index">05</span>
            <div>
              <h2>确认并提交审批</h2>
              <p>
                提交后合同状态变为“审批中”，由系统锁定的{{
                  approvalTargetLabel
                }}审批。
              </p>
            </div>
          </div>

          <div class="confirmation-banner">
            <span
              ><el-icon><Stamp /></el-icon
            ></span>
            <div>
              <strong>审批人：{{ approvalTargetLabel }}</strong>
              <p>{{ approvalConfirmationDescription }}</p>
            </div>
          </div>

          <el-descriptions class="confirmation-details" :column="2" border>
            <el-descriptions-item label="甲方单位">{{
              form.partyA
            }}</el-descriptions-item>
            <el-descriptions-item label="乙方单位">{{
              form.partyB
            }}</el-descriptions-item>
            <el-descriptions-item :label="subjectNameLabel">{{
              form.projectName
            }}</el-descriptions-item>
            <el-descriptions-item
              :label="
                form.relationType === 'termination'
                  ? '合同金额'
                  : form.relationType === 'supplement'
                    ? '本次增减'
                    : '合同金额'
              "
            >
              <strong class="amount-text">{{
                form.relationType === "termination"
                  ? formatContractMoney(0)
                  : paymentTermsOnlySupplement
                    ? "仅变更付款方式"
                    : formatContractMoney(form.amount)
              }}</strong>
            </el-descriptions-item>
            <el-descriptions-item label="合同类型">
              {{ categoryLabel(form.category) }}
            </el-descriptions-item>
            <el-descriptions-item label="合同签订日期">
              {{ form.contractDate || "—" }}
            </el-descriptions-item>
            <el-descriptions-item label="合同关系">
              {{ relationTypeLabel }}
            </el-descriptions-item>
            <el-descriptions-item label="合同层级">
              {{
                quickTerminationMode
                  ? `解除协议（解除对象：${terminationTargetName}）`
                  : rentalRenewalMode
                    ? `一级独立主合同（续签自：${rentalRenewalUploadContext?.sourceContractName || "原租赁合同"}）`
                    : requiresParentContract
                      ? `二级（上级：${selectedParentContractName}）`
                      : "一级（无需关联上级合同）"
              }}
            </el-descriptions-item>
            <el-descriptions-item
              v-if="projectAssociationAllowed"
              label="归属项目（经营统计）"
              >{{ selectedProjectName }}</el-descriptions-item
            >
            <el-descriptions-item label="区域">{{
              form.area
            }}</el-descriptions-item>
            <el-descriptions-item label="辅助材料">{{
              form.requiresAuxiliaryMaterials ? "需要" : "不需要"
            }}</el-descriptions-item>
            <el-descriptions-item label="提交资料">
              申请人已签署用印申请单<span v-if="supportingFiles.length">
                · 另有 {{ supportingFiles.length }} 份补充资料</span
              >
            </el-descriptions-item>
          </el-descriptions>

          <el-checkbox v-model="finalConfirmed" class="final-confirmation">
            我已确认{{
              projectAssociationAllowed ? "项目归属（如有）、" : ""
            }}合同层级及用印资料，{{ approvalSubmitLabel }}
          </el-checkbox>
        </template>
      </section>
    </main>

    <div class="mobile-action-bar">
      <el-button v-if="activeStep > 0" @click="previousStep">上一步</el-button>
      <el-button
        v-if="activeStep < 4"
        type="primary"
        :disabled="!canContinue"
        @click="nextStep"
        >下一步</el-button
      >
      <el-button
        v-else
        type="primary"
        :loading="submitting"
        @click="submitForApproval"
      >
        {{ approvalSubmitLabel }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import type { UploadFile } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Aim,
  ArrowLeft,
  Connection,
  Document,
  DocumentChecked,
  Loading,
  MagicStick,
  Select,
  Stamp,
  Upload,
  UploadFilled,
} from "@element-plus/icons-vue";
import ContractFilePreview from "@/components/contracts/ContractFilePreview.vue";
import ContractOcrFieldEditor from "@/components/contracts/ContractOcrFieldEditor.vue";
import ContractSealApplicationEditor from "@/components/contracts/ContractSealApplicationEditor.vue";
import type {
  ContractAssetCategory,
  ContractCategory,
  ContractDeclaredSubtype,
  ContractFile,
  ContractListItem,
  ContractMeta,
  ContractOcrField,
  ContractOcrFieldKey,
  ContractOcrJob,
  ContractRentalRenewalUploadContext,
  ContractRelationType,
  ContractSealApplication,
  ContractSealApplicationFields,
  ContractUploadAssetCategory,
  ContractSupplementChangeType,
  ContractSupplementUploadContext,
  ContractTerminationUploadContext,
  ContractUpdatePayload,
} from "@/types/contract";
import {
  deleteContractDraft,
  deleteContractFile,
  getContractErrorMessage,
  getContract,
  getContractFileUrl,
  getContractMeta,
  getContractOcrJob,
  getContractRentalRenewalUploadContext,
  getContractSealApplication,
  getContractSupplementUploadContext,
  getContractTerminationUploadContext,
  getContracts,
  isOcrTerminal,
  normalizeOcrFields,
  recognizeContract,
  recognizeRentalRenewalContract,
  recognizeSupplementContract,
  recognizeTerminationContract,
  retryContractRecognition,
  signContractSealApplication,
  submitContract,
  updateContract,
  uploadContractFile,
} from "@/utils/contractApi";
import {
  CONTRACT_CATEGORY_LABELS,
  CONTRACT_RELATION_LABELS,
  FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS,
  formatContractMoney,
} from "@/utils/contractPresentation";

interface SupportingFile {
  fileType: string;
  file?: File;
  fileId?: string;
  fileName: string;
}

const router = useRouter();
const route = useRoute();
const activeStep = ref(0);
const uploading = ref(false);
const restoring = ref(false);
const recognizing = ref(false);
const saving = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const isDragging = ref(false);
const relatedLoading = ref(false);
const metaReady = ref(false);
const pageError = ref("");
const liveStatus = ref("等待上传合同文件");
const sourceInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const sourceFileId = ref("");
const sourceFileName = ref("");
const sourceMimeType = ref("");
const previewUrl = ref("");
const contractId = ref("");
const contractVersion = ref(1);
const createdDraftInCurrentSession = ref(false);
const jobId = ref("");
const ocrJob = ref<ContractOcrJob | null>(null);
const ocrFields = ref<ContractOcrField[]>(normalizeOcrFields(null));
const supportingFiles = ref<SupportingFile[]>([]);
const sealApplication = ref<ContractSealApplication | null>(null);
const sealApplicationFields = ref<ContractSealApplicationFields>({
  sealPurpose: "申请对本合同办理用印",
  sealType: "contract",
  copyCount: null,
  crossPageSeal: true,
  note: "",
});
const sealApplicationLoading = ref(false);
const sealApplicationSigning = ref(false);
const sealApplicationError = ref("");
const relatedContracts = ref<ContractListItem[]>([]);
const lockedParentContractName = ref("");
const supplementUploadContext = ref<ContractSupplementUploadContext | null>(
  null,
);
const rentalRenewalUploadContext =
  ref<ContractRentalRenewalUploadContext | null>(null);
const terminationUploadContext = ref<ContractTerminationUploadContext | null>(
  null,
);
const restoredTerminationTargetId = ref("");
const supplementContextLoading = ref(false);
const supplementChangeType = ref<ContractSupplementChangeType | null>(null);
const supplementAmountContext = ref<{
  originalContractAmount: string | number | null;
  amountBeforeChange: string | number | null;
  amountAfterChange: string | number | null;
  currentEffectiveAmount: string | number | null;
}>({
  originalContractAmount: null,
  amountBeforeChange: null,
  amountAfterChange: null,
  currentEffectiveAmount: null,
});
const finalConfirmed = ref(false);
const dirty = ref(false);
const meta = ref<ContractMeta>({
  projects: [],
  areas: [],
  assetCategories: [
    "procurement",
    "software",
    "equipment",
    "house_rental",
    "vehicle_rental",
    "parking_space",
    "office_asset",
    "other",
  ],
  declaredSubtypeOptions: FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS,
});
let pollingSequence = 0;
let relatedLoadSequence = 0;

function queryText(value: unknown): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  return typeof resolved === "string" ? resolved : "";
}

const quickSupplementParentId = computed(() =>
  queryText(route.query.quickSupplement) === "1"
    ? queryText(route.query.parentContractId)
    : "",
);
const quickSupplementMode = computed(() =>
  Boolean(quickSupplementParentId.value),
);
const rentalRenewalSourceId = computed(() =>
  queryText(route.query.rentalRenewal) === "1"
    ? queryText(route.query.sourceContractId)
    : "",
);
const rentalRenewalMode = computed(() => Boolean(rentalRenewalSourceId.value));
const quickTerminationTargetId = computed(() => {
  const routeTargetId =
    queryText(route.query.quickTermination) === "1"
      ? queryText(route.query.targetContractId)
      : "";
  return routeTargetId || restoredTerminationTargetId.value;
});
const quickTerminationMode = computed(() =>
  Boolean(quickTerminationTargetId.value),
);
const rentalExitAction = computed(() => queryText(route.query.rentalAction));
const rentalExitMode = computed(() =>
  ["move_out", "vehicle_return"].includes(rentalExitAction.value),
);
const quickAgreementMode = computed(
  () =>
    rentalRenewalMode.value ||
    quickSupplementMode.value ||
    quickTerminationMode.value,
);
const quickUploadTitle = computed(() =>
  quickTerminationMode.value
    ? rentalExitAction.value === "vehicle_return"
      ? "上传还车协议"
      : rentalExitAction.value === "move_out"
        ? "上传退租协议"
        : "上传解除协议书"
    : rentalRenewalMode.value
      ? "新增续签合同"
      : "上传补充协议",
);
const quickUploadDescription = computed(() =>
  quickTerminationMode.value
    ? rentalExitMode.value
      ? "原租赁合同和退出对象已锁定，只需上传退租／还车协议。"
      : "合同信息和解除对象由系统自动继承，只需上传解除协议书。"
    : rentalRenewalMode.value
      ? "原租赁合同仅作为续签来源；上传后创建金额、附件和审批均独立的新主合同。"
      : "已继承主合同信息，只需选择补充协议文件。",
);
const quickInheritanceStepText = computed(() =>
  quickTerminationMode.value
    ? "核对解除对象与结算结果"
    : rentalRenewalMode.value
      ? "核对独立新合同信息"
      : "核对主合同继承结果",
);
const quickInheritanceDescription = computed(() =>
  quickTerminationMode.value
    ? "行政区、分类、项目、甲乙方、所属主合同、解除对象及协议名称均已锁定，不需要再次选择。"
    : rentalRenewalMode.value
      ? "行政区与租赁分类从原合同带入用于创建；新合同按独立主合同识别合同名称、金额和签订日期，不挂在原合同金额链下。"
      : "行政区、分类、项目、甲乙方、上级合同及协议名称均已从主合同继承，不需要再次选择。",
);

const uploadCategoryOptions: Array<{
  value: ContractCategory;
  label: string;
  description: string;
}> = [
  {
    value: "main_business",
    label: "主营项目合同",
    description: "工程咨询服务、项目前期手续办理、技术咨询服务",
  },
  {
    value: "non_main",
    label: "非主营项目合同",
    description: "非主营业务收入合同、其他服务合同",
  },
  {
    value: "asset",
    label: "资产类合同",
    description: "采购、软件、设备、房屋租赁、汽车租赁、车位、办公资产合同",
  },
];

const DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY: Record<
  ContractCategory,
  ContractDeclaredSubtype
> = {
  main_business: "engineering_consulting",
  non_main: "non_main_income",
  asset: "procurement",
};
const uploadAssetCategoryOptions: Array<{
  value: ContractUploadAssetCategory;
  label: string;
}> = [
  { value: "procurement", label: "采购合同" },
  { value: "software", label: "软件合同" },
  { value: "equipment", label: "设备合同" },
  { value: "house_rental", label: "房屋租赁" },
  { value: "vehicle_rental", label: "汽车租赁" },
  { value: "parking_space", label: "车位租赁" },
  { value: "office_asset", label: "办公资产合同" },
];
const uploadAssetCategorySet = new Set<ContractAssetCategory>(
  uploadAssetCategoryOptions.map((option) => option.value),
);

const form = reactive<{
  partyA: string;
  partyB: string;
  projectName: string;
  amount: string;
  category: ContractCategory | "";
  declaredCategory: ContractCategory | "";
  declaredSubtype: ContractDeclaredSubtype | "";
  contractDate: string;
  relationType: ContractRelationType | "";
  projectId: string;
  parentContractId: string;
  area: string;
  assetCategory: ContractAssetCategory | "";
  requiresAuxiliaryMaterials: boolean;
  description: string;
}>({
  partyA: "",
  partyB: "",
  projectName: "",
  amount: "",
  category: "",
  declaredCategory: "",
  declaredSubtype: "",
  contractDate: "",
  relationType: "",
  projectId: "",
  parentContractId: "",
  area: "",
  assetCategory: "",
  requiresAuxiliaryMaterials: false,
  description: "",
});

const projectAssociationAllowed = computed(
  () => (form.category || form.declaredCategory) !== "asset",
);
const defaultSubjectNameLabel = computed(() =>
  projectAssociationAllowed.value ? "项目名称" : "合同名称",
);
const subjectNameLabel = computed(() =>
  quickTerminationMode.value ? "解除协议名称" : defaultSubjectNameLabel.value,
);
const approvalTargetLabel = computed(() => "总经理");
const approvalConfirmationDescription = computed(
  () => "合同统一提交唯一活动总经理审批，提交时锁定本轮审批人。",
);
const approvalSubmitLabel = computed(() => "提交总经理审批");
const approvalStepDescription = computed(() => "进入总经理审批");

const supportingFileOptions = computed(() => {
  return [
    {
      value: "other",
      label: "其他补充资料",
      description: "报价、会议纪要等附件",
      required: false,
    },
  ];
});

const supportingRequirementText = computed(
  () =>
    "用印申请单由系统自动生成，在线填写后必须由申请人本人点击签署栏完成电子签名；三联单和付款资料不在草拟用印阶段收取。",
);

const sealApplicationSigned = computed(
  () =>
    sealApplication.value?.status === "signed" &&
    !sealApplication.value.stale &&
    sealApplication.value.contractVersion === contractVersion.value,
);
const sealApplicationSignedFileUrl = computed(() => {
  const fileId = sealApplicationSigned.value
    ? sealApplication.value?.signedFileId
    : null;
  return fileId ? getContractFileUrl(fileId) : "";
});

const sealApplicationSummary = computed(() => ({
  contractNo: sealApplication.value?.contract?.contractNo || "草拟合同",
  contractTitle:
    sealApplication.value?.contract?.title || form.projectName || null,
  partyA: form.partyA,
  partyB: form.partyB,
  projectName: form.projectName || null,
  amount:
    form.relationType === "termination"
      ? formatContractMoney(0)
      : form.amount
        ? formatContractMoney(form.amount)
        : null,
  categoryLabel: form.category
    ? CONTRACT_CATEGORY_LABELS[form.category]
    : "待识别",
  isAssetContract: (form.category || form.declaredCategory) === "asset",
  relationLabel: form.relationType
    ? CONTRACT_RELATION_LABELS[form.relationType]
    : "待选择",
  area: form.area,
}));

const ocrStatusLabel = computed(() => {
  if (
    ocrJob.value?.status === "succeeded" &&
    ocrFields.value.some((field) => field.manuallyConfirmed)
  ) {
    return "财务已确认采用";
  }
  const labels: Record<ContractOcrJob["status"], string> = {
    queued: "排队等待识别",
    processing: "正在识别",
    succeeded: "识别完成",
    partial: "未达到自动采用标准",
    failed: "识别失败",
  };
  return ocrJob.value ? labels[ocrJob.value.status] : "等待识别";
});

const ocrStatusType = computed<"info" | "warning" | "success" | "danger">(
  () => {
    if (!ocrJob.value) return "info";
    if (ocrJob.value.status === "succeeded") return "success";
    if (ocrJob.value.status === "partial") return "warning";
    if (ocrJob.value.status === "failed") return "danger";
    return "info";
  },
);

const canRetryRecognition = computed(
  () =>
    Boolean(contractId.value && ocrJob.value) &&
    !recognizing.value &&
    ["partial", "failed"].includes(ocrJob.value?.status || ""),
);

const canResumeRecognition = computed(
  () =>
    Boolean(ocrJob.value?.id) &&
    !recognizing.value &&
    ["queued", "processing"].includes(ocrJob.value?.status || ""),
);

const paymentTermsOnlySupplement = computed(
  () =>
    form.relationType === "supplement" &&
    supplementChangeType.value === "payment_terms_only",
);
const supplementRecognitionStateReady = computed(
  () =>
    form.relationType !== "supplement" || Boolean(supplementChangeType.value),
);

const displayedOcrFields = computed(() =>
  paymentTermsOnlySupplement.value
    ? ocrFields.value.filter((field) => field.key !== "amount")
    : ocrFields.value,
);

const requiredFieldsComplete = computed(() =>
  ocrFields.value.every((field) => {
    if (!field.required || Boolean(String(field.value ?? "").trim())) {
      return true;
    }
    if (field.key === "amount" && paymentTermsOnlySupplement.value) {
      return true;
    }
    if (!quickAgreementMode.value) return false;
    if (field.key === "party_a") return Boolean(form.partyA.trim());
    if (field.key === "party_b") return Boolean(form.partyB.trim());
    if (field.key === "project_name") return Boolean(form.projectName.trim());
    if (field.key === "amount" && quickTerminationMode.value) {
      return amountRelationValid.value;
    }
    return false;
  }),
);

const automaticRecognitionBlocked = computed(
  () =>
    Boolean(contractId.value && ocrJob.value?.id) &&
    ocrJob.value?.status === "partial" &&
    !recognizing.value &&
    !relationRecognitionBlocker.value,
);

const relationRecognitionBlocker = computed(() => {
  const message = String(ocrJob.value?.errorMessage || "");
  return /(?:补充协议|解除协议)(?:引用原合同编号|未能从明确的“合同编号：”标签)|所选上级合同|解除对象|原合同当前已撤销或删除/u.test(
    message,
  )
    ? message
    : "";
});

const uploadSetupComplete = computed(() => {
  if (rentalRenewalMode.value) {
    return Boolean(
      !supplementContextLoading.value &&
      rentalRenewalUploadContext.value?.canUpload &&
      rentalRenewalUploadContext.value.sourceContractId ===
        rentalRenewalSourceId.value &&
      form.relationType === "main" &&
      !form.parentContractId,
    );
  }
  if (quickAgreementMode.value) {
    const contextReady = quickTerminationMode.value
      ? terminationUploadContext.value?.canUpload &&
        form.parentContractId === terminationUploadContext.value.rootContractId
      : supplementUploadContext.value?.canUpload &&
        form.parentContractId === quickSupplementParentId.value;
    return Boolean(!supplementContextLoading.value && contextReady);
  }
  if (!metaReady.value || !meta.value.areas.includes(form.area)) return false;
  if (!form.declaredCategory) return false;
  if (!form.declaredSubtype) {
    return false;
  }
  if (
    form.declaredCategory !== "asset" &&
    !requiresParentContract.value &&
    form.declaredSubtype !==
      DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY[form.declaredCategory]
  ) {
    return false;
  }
  if (!form.relationType) return false;
  if (
    form.declaredCategory === "asset" &&
    !(
      form.assetCategory &&
      uploadAssetCategorySet.has(form.assetCategory) &&
      form.assetCategory === form.declaredSubtype
    )
  ) {
    return false;
  }
  if (form.declaredCategory !== "asset" && form.assetCategory) return false;
  if (requiresParentContract.value) {
    return (
      !relatedLoading.value &&
      Boolean(form.parentContractId) &&
      relatedContracts.value.some(
        (contract) => contract.id === form.parentContractId,
      )
    );
  }
  return true;
});

const uploadParentContextReady = computed(() =>
  Boolean(form.area && form.declaredCategory),
);

const sameAreaProjects = computed(() =>
  meta.value.projects.filter(
    (project) => form.area === "全部" || project.area === form.area,
  ),
);

const partiesDifferent = computed(
  () =>
    form.partyA.trim().normalize("NFKC") !==
    form.partyB.trim().normalize("NFKC"),
);

function normalizeProjectMatchText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function textPairSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return (
      Math.min(left.length, right.length) / Math.max(left.length, right.length)
    );
  }
  const pairs = (text: string) =>
    new Set(
      Array.from({ length: Math.max(0, text.length - 1) }, (_, index) =>
        text.slice(index, index + 2),
      ),
    );
  const leftPairs = pairs(left);
  const rightPairs = pairs(right);
  if (!leftPairs.size || !rightPairs.size) return 0;
  const intersection = [...leftPairs].filter((pair) =>
    rightPairs.has(pair),
  ).length;
  return (2 * intersection) / (leftPairs.size + rightPairs.size);
}

const suggestedProjects = computed(() => {
  const projectName = normalizeProjectMatchText(form.projectName);
  const partyA = normalizeProjectMatchText(form.partyA);
  if (!projectName) return [];
  return sameAreaProjects.value
    .map((project) => {
      const nameScore = textPairSimilarity(
        projectName,
        normalizeProjectMatchText(project.name),
      );
      const clientScore = partyA
        ? textPairSimilarity(
            partyA,
            normalizeProjectMatchText(project.clientName),
          )
        : 0;
      const score = nameScore * 0.75 + clientScore * 0.25;
      return {
        ...project,
        score,
        matchReason:
          clientScore >= 0.8
            ? `项目名与甲方综合匹配 ${Math.round(score * 100)}%`
            : `项目名称匹配 ${Math.round(nameScore * 100)}%`,
      };
    })
    .filter((project) => project.score >= 0.45)
    .sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name),
    )
    .slice(0, 5);
});

const selectedProjectName = computed(
  () =>
    meta.value.projects.find((project) => project.id === form.projectId)
      ?.name ||
    terminationUploadContext.value?.projectName ||
    supplementUploadContext.value?.projectName ||
    "未归属",
);

const requiresParentContract = computed(() =>
  ["supplement", "termination"].includes(form.relationType),
);

const relationTypeLabel = computed(() =>
  form.relationType ? CONTRACT_RELATION_LABELS[form.relationType] : "未选择",
);

const contractHierarchyTitle = computed(() =>
  rentalRenewalMode.value
    ? "续签合同是新的独立一级合同"
    : quickTerminationMode.value
      ? "解除协议已锁定解除对象"
      : requiresParentContract.value
        ? "二级协议必须关联一级合同"
        : "一级合同，无需关联上级合同",
);

const contractHierarchyDescription = computed(() =>
  rentalRenewalMode.value
    ? "原租赁合同只记录续签来源；本合同拥有独立金额、附件、审批和生命周期。"
    : quickTerminationMode.value
      ? "解除协议归入原合同链，并指向当前详情中的合同或补充协议；无需再次选择。"
      : requiresParentContract.value
        ? "补充协议或解除协议只能关联同区、同分类且已生效的主合同。"
        : "主合同以自身作为合同组根节点，系统不会查询或保存上级合同。",
);

const selectedParentContractName = computed(() => {
  if (!requiresParentContract.value) return "无需关联";
  return (
    supplementUploadContext.value?.parentContractName ||
    relatedContracts.value.find(
      (contract) => contract.id === form.parentContractId,
    )?.name ||
    lockedParentContractName.value ||
    (form.parentContractId
      ? `已锁定上级合同（${form.parentContractId}）`
      : "未选择")
  );
});

function buildSupplementDisplayName(parentName: string): string {
  const normalized = parentName.normalize("NFKC").trim();
  if (!normalized) return "";
  return /补充协议书?$/u.test(normalized)
    ? normalized.replace(/补充协议书?$/u, "补充协议")
    : `${normalized}补充协议`;
}

function isPersistedSupplementName(value: unknown): boolean {
  return /补充协议\(\d+\)$/u.test(
    String(value || "")
      .normalize("NFKC")
      .trim(),
  );
}

const inheritedSupplementName = computed(() =>
  form.relationType === "supplement"
    ? supplementUploadContext.value?.generatedContractName ||
      buildSupplementDisplayName(selectedParentContractName.value)
    : "",
);

function buildTerminationDisplayName(targetName: string): string {
  const normalized = targetName.normalize("NFKC").trim();
  if (!normalized) return "";
  const subject = normalized.replace(/(?:合同|协议书)$/u, "");
  return `${subject}解除协议书`;
}
const terminationAgreementName = computed(
  () =>
    terminationUploadContext.value?.generatedContractName ||
    buildTerminationDisplayName(
      terminationUploadContext.value?.targetName || "",
    ),
);
const inheritedTerminationName = computed(() =>
  form.relationType === "termination" ? terminationAgreementName.value : "",
);
const terminationTargetName = computed(
  () => terminationUploadContext.value?.targetName || "—",
);

function preserveInheritedSupplementName() {
  if (form.relationType === "termination" && inheritedTerminationName.value) {
    if (
      contractId.value &&
      /解除协议书$/u.test(form.projectName.normalize("NFKC").trim())
    ) {
      return;
    }
    form.projectName = inheritedTerminationName.value;
    return;
  }
  if (form.relationType === "supplement" && inheritedSupplementName.value) {
    // 合同创建后，服务端已按当前有效序号生成权威名称；删除草稿后仍存在
    // 的草稿会按创建顺序紧凑重排，正式协议及非草稿撤销记录不回收序号。
    // 恢复草稿或轮询识别时不得再用上传前不带序号的前端预览名称覆盖它。
    if (contractId.value && isPersistedSupplementName(form.projectName)) {
      return;
    }
    form.projectName = inheritedSupplementName.value;
  }
}

const normalizedAmountText = computed(() =>
  String(form.amount).replace(/[,，￥¥\s]/g, ""),
);
const numericAmount = computed(() => Number(normalizedAmountText.value));
const displayedSupplementAmountDelta = computed(() =>
  paymentTermsOnlySupplement.value ? 0 : numericAmount.value,
);
const amountPrecisionValid = computed(() => {
  if (paymentTermsOnlySupplement.value) {
    return (
      (!normalizedAmountText.value || numericAmount.value === 0) &&
      Number.isSafeInteger(Math.round(numericAmount.value * 100))
    );
  }
  return (
    /^-?\d+(?:\.\d{1,2})?$/.test(normalizedAmountText.value) &&
    Number.isSafeInteger(Math.round(numericAmount.value * 100))
  );
});

const amountRelationValid = computed(() => {
  if (paymentTermsOnlySupplement.value) {
    return !normalizedAmountText.value || numericAmount.value === 0;
  }
  const amount = numericAmount.value;
  if (!amountPrecisionValid.value || !Number.isFinite(amount)) return false;
  if (form.relationType === "termination") return amount <= 0;
  if (amount === 0) return false;
  if (form.relationType === "main") return amount > 0;
  return true;
});

const amountRuleText = computed(() => {
  if (form.relationType === "termination") {
    return "解除后不再付款；已履行金额保留，未履行金额不再计入解除后的最终合同金额。";
  }
  if (form.relationType === "supplement") {
    return paymentTermsOnlySupplement.value
      ? "本协议仅变更付款方式，本次增减为 0，合同总金额保持不变。"
      : "金额变更补充协议必须识别出明确的增加或减少金额。";
  }
  return "主合同的合同金额必须大于 0。";
});

const relationComplete = computed(() => {
  if (!amountRelationValid.value) return false;
  if (!form.area) return false;
  if (!form.category || form.category !== form.declaredCategory) return false;
  if (quickAgreementMode.value) {
    if (rentalRenewalMode.value) {
      return Boolean(
        rentalRenewalUploadContext.value?.canUpload &&
        rentalRenewalUploadContext.value.sourceContractId ===
          rentalRenewalSourceId.value &&
        form.relationType === "main" &&
        !form.parentContractId &&
        form.declaredSubtype &&
        form.partyA.trim() &&
        form.partyB.trim() &&
        form.projectName.trim(),
      );
    }
    if (quickTerminationMode.value) {
      return Boolean(
        terminationUploadContext.value?.canUpload &&
        form.relationType === "termination" &&
        terminationUploadContext.value.targetContractId ===
          quickTerminationTargetId.value &&
        form.parentContractId ===
          terminationUploadContext.value.rootContractId &&
        form.declaredSubtype &&
        form.partyA.trim() &&
        form.partyB.trim() &&
        form.projectName.trim(),
      );
    }
    return Boolean(
      supplementUploadContext.value?.canUpload &&
      form.relationType === "supplement" &&
      form.parentContractId === quickSupplementParentId.value &&
      form.declaredSubtype &&
      form.partyA.trim() &&
      form.partyB.trim() &&
      form.projectName.trim(),
    );
  }
  if (!projectAssociationAllowed.value && form.projectId) return false;
  if (
    form.projectId &&
    !sameAreaProjects.value.some((project) => project.id === form.projectId)
  ) {
    return false;
  }
  if (["supplement", "termination"].includes(form.relationType)) {
    if (contractId.value) return Boolean(form.parentContractId);
    return (
      !relatedLoading.value &&
      Boolean(form.parentContractId) &&
      relatedContracts.value.some(
        (contract) => contract.id === form.parentContractId,
      )
    );
  }
  if (!form.declaredSubtype) return false;
  if (form.category === "asset") {
    return form.assetCategory === form.declaredSubtype;
  }
  return true;
});

const supportingFilesComplete = computed(() => {
  return sealApplicationSigned.value;
});

const hasPendingSupportingUploads = computed(() =>
  supportingFiles.value.some((item) => Boolean(item.file)),
);

const hasUnsavedChanges = computed(
  () => dirty.value || hasPendingSupportingUploads.value,
);

const canContinue = computed(() => {
  if (activeStep.value === 0) {
    return Boolean(
      (selectedFile.value || sourceFileId.value) && contractId.value,
    );
  }
  if (activeStep.value === 1) {
    return (
      !recognizing.value &&
      ocrJob.value?.status === "succeeded" &&
      requiredFieldsComplete.value &&
      partiesDifferent.value &&
      amountPrecisionValid.value &&
      supplementRecognitionStateReady.value
    );
  }
  if (activeStep.value === 2) return relationComplete.value;
  if (activeStep.value === 3) return supportingFilesComplete.value;
  return finalConfirmed.value;
});

function validateSourceFile(file: File): boolean {
  const extensionAllowed = /\.(pdf|doc|docx)$/i.test(file.name);
  if (!extensionAllowed) {
    ElMessage.error("仅支持 PDF、DOC、DOCX 合同文件");
    return false;
  }
  if (file.size > 30 * 1024 * 1024) {
    ElMessage.error("合同文件不能超过 30MB");
    return false;
  }
  return true;
}

function categoryLabel(category: ContractCategory | ""): string {
  return category ? CONTRACT_CATEGORY_LABELS[category] : "—";
}

function handleDeclaredCategoryChange() {
  if (form.declaredCategory === "asset") form.projectId = "";
  form.declaredSubtype =
    form.declaredCategory === "asset"
      ? ""
      : form.declaredCategory
        ? DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY[form.declaredCategory]
        : "";
  form.assetCategory =
    form.declaredCategory === "asset"
      ? (form.declaredSubtype as ContractUploadAssetCategory)
      : "";
  form.category = "";
  handleUploadContextChange();
}

function handleAssetSubtypeChange() {
  form.assetCategory = form.declaredSubtype as ContractUploadAssetCategory;
  handleUploadContextChange();
}

function handleUploadContextChange() {
  if (contractId.value) return;
  form.parentContractId = "";
  lockedParentContractName.value = "";
  relatedContracts.value = [];
  form.projectName = "";
  if (requiresParentContract.value && uploadParentContextReady.value) {
    void loadRelatedContracts();
  }
}

function applyRentalRenewalContext(
  context: ContractRentalRenewalUploadContext,
) {
  form.area = context.area;
  form.declaredCategory = context.declaredCategory;
  form.declaredSubtype = context.declaredSubtype;
  form.assetCategory = context.assetCategory || "";
  form.category = context.declaredCategory;
  form.relationType = "main";
  form.parentContractId = "";
  form.projectId =
    context.declaredCategory === "asset" ? "" : context.projectId || "";
  form.projectName = "";
  form.partyA = context.partyA;
  form.partyB = context.partyB;
  form.amount = "";
  lockedParentContractName.value = "";
}

function applyQuickSupplementContext(context: ContractSupplementUploadContext) {
  form.area = context.area;
  form.declaredCategory = context.declaredCategory;
  form.declaredSubtype = context.declaredSubtype;
  form.assetCategory = context.assetCategory || "";
  form.category = context.declaredCategory;
  form.relationType = "supplement";
  form.parentContractId = context.parentContractId;
  form.projectId =
    context.declaredCategory === "asset" ? "" : context.projectId || "";
  form.projectName = context.generatedContractName;
  form.partyA = context.partyA;
  form.partyB = context.partyB;
  lockedParentContractName.value = context.parentContractName;
  supplementAmountContext.value = {
    originalContractAmount: context.originalContractAmount,
    amountBeforeChange: context.currentEffectiveAmount,
    amountAfterChange: null,
    currentEffectiveAmount: context.currentEffectiveAmount,
  };
}

function applyQuickTerminationContext(
  context: ContractTerminationUploadContext,
) {
  form.area = context.area;
  form.declaredCategory = context.declaredCategory;
  form.declaredSubtype = context.declaredSubtype;
  form.assetCategory = context.assetCategory || "";
  form.category = context.declaredCategory;
  form.relationType = "termination";
  form.parentContractId = context.rootContractId;
  form.projectId =
    context.declaredCategory === "asset" ? "" : context.projectId || "";
  form.projectName =
    context.generatedContractName ||
    buildTerminationDisplayName(context.targetName);
  form.partyA = context.partyA;
  form.partyB = context.partyB;
  const unperformedAmount = Number(context.unperformedAmount || 0);
  form.amount = String(unperformedAmount > 0 ? -unperformedAmount : 0);
  lockedParentContractName.value = context.targetName;
}

async function loadQuickTerminationContext() {
  const targetContractId = quickTerminationTargetId.value;
  if (!targetContractId) {
    pageError.value = "缺少解除对象，无法上传解除协议书";
    return;
  }
  supplementContextLoading.value = true;
  pageError.value = "";
  liveStatus.value = "正在读取解除对象与履行金额";
  try {
    const context = await getContractTerminationUploadContext(
      targetContractId,
      targetContractId,
    );
    terminationUploadContext.value = context;
    applyQuickTerminationContext(context);
    if (!context.canUpload) {
      pageError.value =
        context.blockingReason || "当前合同状态不允许上传解除协议书";
      liveStatus.value = pageError.value;
      return;
    }
    liveStatus.value = "解除对象和履行金额已锁定，请选择解除协议书";
  } catch (error) {
    terminationUploadContext.value = null;
    pageError.value = getContractErrorMessage(
      error,
      "解除对象信息加载失败，暂不能上传解除协议书",
    );
    liveStatus.value = pageError.value;
  } finally {
    supplementContextLoading.value = false;
  }
}

async function loadQuickSupplementContext() {
  const parentContractId = quickSupplementParentId.value;
  if (!parentContractId) {
    pageError.value = "缺少主合同编号，无法上传补充协议";
    return;
  }
  supplementContextLoading.value = true;
  pageError.value = "";
  liveStatus.value = "正在读取主合同继承信息";
  try {
    const context = await getContractSupplementUploadContext(parentContractId);
    supplementUploadContext.value = context;
    applyQuickSupplementContext(context);
    if (!context.canUpload) {
      pageError.value =
        context.blockingReason || "当前主合同状态不允许上传补充协议";
      liveStatus.value = pageError.value;
      return;
    }
    liveStatus.value = "主合同信息已继承，请选择补充协议文件";
  } catch (error) {
    supplementUploadContext.value = null;
    pageError.value = getContractErrorMessage(
      error,
      "主合同继承信息加载失败，暂不能上传补充协议",
    );
    liveStatus.value = pageError.value;
  } finally {
    supplementContextLoading.value = false;
  }
}

async function loadRentalRenewalContext() {
  const sourceContractId = rentalRenewalSourceId.value;
  if (!sourceContractId) {
    pageError.value = "缺少原租赁合同，无法创建续签合同";
    return;
  }
  supplementContextLoading.value = true;
  pageError.value = "";
  liveStatus.value = "正在读取原租赁合同信息";
  try {
    const context =
      await getContractRentalRenewalUploadContext(sourceContractId);
    rentalRenewalUploadContext.value = context;
    applyRentalRenewalContext(context);
    if (!context.canUpload) {
      pageError.value = context.blockingReason || "当前租赁合同暂不能续签";
      liveStatus.value = pageError.value;
      return;
    }
    liveStatus.value =
      "原合同续签来源已锁定，请上传将作为独立主合同办理的新合同文件";
  } catch (error) {
    rentalRenewalUploadContext.value = null;
    pageError.value = getContractErrorMessage(
      error,
      "原租赁合同信息加载失败，暂不能创建续签合同",
    );
    liveStatus.value = pageError.value;
  } finally {
    supplementContextLoading.value = false;
  }
}

function requestSourceFile() {
  if (!uploadSetupComplete.value) {
    ElMessage.warning(
      rentalRenewalMode.value
        ? rentalRenewalUploadContext.value?.blockingReason ||
            "正在读取原租赁合同信息，请稍后再试"
        : quickTerminationMode.value
          ? terminationUploadContext.value?.blockingReason ||
            "正在读取解除对象，请稍后再试"
          : quickSupplementMode.value
            ? supplementUploadContext.value?.blockingReason ||
              "正在读取主合同信息，请稍后再试"
            : "请先选择所属行政区、合同类型和合同层级；二级协议还需选择上级合同",
    );
    return;
  }
  sourceInput.value?.click();
}

async function startRecognition(file: File) {
  if (!uploadSetupComplete.value) {
    ElMessage.warning(
      rentalRenewalMode.value
        ? "原租赁合同信息未准备完成，暂不能创建续签合同"
        : quickTerminationMode.value
          ? "解除对象信息未准备完成，暂不能上传解除协议书"
          : quickSupplementMode.value
            ? "主合同继承信息未准备完成，暂不能上传补充协议"
            : "行政区、合同类型和合同层级完成前不能上传合同文件",
    );
    return;
  }
  if (!validateSourceFile(file) || uploading.value) return;
  const selectedRelationType = form.relationType;
  if (!selectedRelationType) {
    ElMessage.warning("请先选择合同层级");
    return;
  }
  uploading.value = true;
  const selectedParentContract = relatedContracts.value.find(
    (contract) => contract.id === form.parentContractId,
  );
  pageError.value = "";
  liveStatus.value = "正在上传合同并创建识别任务";
  pollingSequence += 1;
  const currentSequence = pollingSequence;
  try {
    selectedFile.value = file;
    sourceFileName.value = file.name;
    sourceMimeType.value = file.type;
    if (previewUrl.value.startsWith("blob:"))
      URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(file);
    const result = rentalRenewalMode.value
      ? await recognizeRentalRenewalContract(rentalRenewalSourceId.value, file)
      : quickTerminationMode.value
        ? await recognizeTerminationContract(
            quickTerminationTargetId.value,
            terminationUploadContext.value?.targetContractId ||
              quickTerminationTargetId.value,
            file,
          )
        : quickSupplementMode.value
          ? await recognizeSupplementContract(
              quickSupplementParentId.value,
              file,
            )
          : await recognizeContract(file, {
              area: form.area,
              declaredCategory: form.declaredCategory as ContractCategory,
              declaredSubtype: form.declaredSubtype as ContractDeclaredSubtype,
              relationType: selectedRelationType,
              parentContractId: requiresParentContract.value
                ? form.parentContractId
                : null,
              assetCategory:
                form.declaredCategory === "asset" &&
                form.assetCategory &&
                uploadAssetCategorySet.has(form.assetCategory)
                  ? (form.assetCategory as ContractUploadAssetCategory)
                  : null,
              requiresAuxiliaryMaterials: form.requiresAuxiliaryMaterials,
            });
    contractId.value = result.contractId;
    createdDraftInCurrentSession.value = true;
    lockedParentContractName.value =
      terminationUploadContext.value?.targetName ||
      supplementUploadContext.value?.parentContractName ||
      selectedParentContract?.name ||
      "";
    preserveInheritedSupplementName();
    sourceFileId.value = "";
    jobId.value = result.jobId;
    activeStep.value = 1;
    dirty.value = true;
    // 上传请求已完成，识别轮询使用独立状态，避免长时间遮挡整个工作区。
    uploading.value = false;
    await pollRecognition(result.jobId, currentSequence);
  } catch (error) {
    pageError.value = getContractErrorMessage(
      error,
      "合同上传或识别任务创建失败",
    );
    liveStatus.value = pageError.value;
  } finally {
    uploading.value = false;
  }
}

async function pollRecognition(id: string, sequence: number) {
  recognizing.value = true;
  let attempts = 0;
  const maximumAttempts = 800;
  try {
    while (sequence === pollingSequence && attempts < maximumAttempts) {
      attempts += 1;
      const job = await getContractOcrJob(id);
      if (sequence !== pollingSequence) return;
      ocrJob.value = job;
      if (job.contractVersion) contractVersion.value = job.contractVersion;
      liveStatus.value = ocrStatusLabel.value;
      if (job.fields.length) applyRecognizedFields(job.fields);
      if (isOcrTerminal(job.status)) {
        if (job.status === "failed") {
          pageError.value =
            job.errorMessage ||
            "合同自动识别失败，系统未写入任何合同字段，请重新识别或重新上传清晰合同";
        } else if (job.status === "partial") {
          pageError.value = "";
          liveStatus.value =
            "自动识别未达到采用标准，请财务对照合同原文确认必需字段";
        } else {
          pageError.value = "";
          if (form.relationType === "supplement") {
            await syncSupplementContractState();
          }
          ElMessage.success("合同必需字段已自动识别并通过系统复核");
        }
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
    }
    if (attempts >= maximumAttempts) {
      pageError.value = "识别等待时间较长，草稿已保留，可稍后重试";
    }
  } catch (error) {
    pageError.value = getContractErrorMessage(
      error,
      "获取识别进度失败，草稿已保留",
    );
  } finally {
    recognizing.value = false;
    liveStatus.value = pageError.value || ocrStatusLabel.value;
  }
}

function applyRecognizedFields(fields: ContractOcrField[]) {
  ocrFields.value = fields;
  if (ocrJob.value?.status === "succeeded") {
    syncFormFromFields();
  } else {
    clearRecognizedFormValues();
  }
}

function syncFormFromFields() {
  const valueOf = (key: ContractOcrFieldKey) =>
    String(
      ocrFields.value.find((field) => field.key === key)?.value ?? "",
    ).trim();
  form.partyA =
    terminationUploadContext.value?.partyA ||
    supplementUploadContext.value?.partyA ||
    valueOf("party_a");
  form.partyB =
    terminationUploadContext.value?.partyB ||
    supplementUploadContext.value?.partyB ||
    valueOf("party_b");
  form.projectName =
    form.relationType === "termination" && inheritedTerminationName.value
      ? inheritedTerminationName.value
      : form.relationType === "supplement" && inheritedSupplementName.value
        ? inheritedSupplementName.value
        : valueOf("project_name");
  if (!quickTerminationMode.value) {
    form.amount = valueOf("amount").replace(/[^\d.-]/g, "");
  }
  form.category =
    terminationUploadContext.value?.declaredCategory ||
    supplementUploadContext.value?.declaredCategory ||
    form.declaredCategory;
  form.contractDate = valueOf("contract_date");
}

function clearRecognizedFormValues() {
  form.partyA =
    terminationUploadContext.value?.partyA ||
    supplementUploadContext.value?.partyA ||
    "";
  form.partyB =
    terminationUploadContext.value?.partyB ||
    supplementUploadContext.value?.partyB ||
    "";
  const systemInheritedProjectName = ocrFields.value.find(
    (field) => field.key === "project_name",
  )?.value;
  form.projectName = terminationAgreementName.value
    ? terminationAgreementName.value
    : isPersistedSupplementName(systemInheritedProjectName)
      ? String(systemInheritedProjectName).trim()
      : supplementUploadContext.value?.generatedContractName || "";
  preserveInheritedSupplementName();
  if (!quickTerminationMode.value) form.amount = "";
  form.category =
    terminationUploadContext.value?.declaredCategory ||
    supplementUploadContext.value?.declaredCategory ||
    form.declaredCategory;
  form.contractDate = "";
}

async function syncSupplementContractState() {
  if (!contractId.value || form.relationType !== "supplement") return;
  const contractDetail = await getContract(contractId.value);
  const contract = contractDetail.contract;
  supplementChangeType.value = contract.supplementChangeType || null;
  supplementAmountContext.value = {
    originalContractAmount:
      contract.originalContractAmount ??
      supplementUploadContext.value?.originalContractAmount ??
      null,
    amountBeforeChange:
      contract.amountBeforeChange ??
      supplementUploadContext.value?.currentEffectiveAmount ??
      null,
    amountAfterChange: contract.amountAfterChange ?? null,
    currentEffectiveAmount:
      contract.currentEffectiveAmount ??
      supplementUploadContext.value?.currentEffectiveAmount ??
      null,
  };
  contractVersion.value = contract.version;
  form.partyA = supplementUploadContext.value?.partyA || contract.partyA || "";
  form.partyB = supplementUploadContext.value?.partyB || contract.partyB || "";
  form.projectName =
    supplementUploadContext.value?.generatedContractName ||
    contract.projectName ||
    contract.name ||
    inheritedSupplementName.value;
  form.amount =
    supplementChangeType.value === "payment_terms_only"
      ? ""
      : String(contract.amount ?? "");
  form.category = contract.category || form.declaredCategory;
  form.contractDate = contract.contractDate || "";
  if (quickSupplementMode.value && supplementUploadContext.value) {
    form.projectId =
      form.declaredCategory === "asset"
        ? ""
        : supplementUploadContext.value.projectId || "";
    form.parentContractId = supplementUploadContext.value.parentContractId;
  }
}

async function retryRecognition() {
  if (!contractId.value || recognizing.value) return;
  pageError.value = "";
  pollingSequence += 1;
  const sequence = pollingSequence;
  try {
    const job = await retryContractRecognition(contractId.value);
    ocrJob.value = job;
    jobId.value = job.id;
    await pollRecognition(job.id, sequence);
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "重新识别失败");
  }
}

function resumeRecognition() {
  if (!ocrJob.value?.id || recognizing.value) return;
  pageError.value = "";
  pollingSequence += 1;
  void pollRecognition(ocrJob.value.id, pollingSequence);
}

function handleSourceInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void startRecognition(file);
}

function handleSourceDrop(event: DragEvent) {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void startRecognition(file);
}

function selectProject(projectId: string) {
  if (!projectAssociationAllowed.value) return;
  if (!validateProjectArea(projectId)) return;
  form.projectId = projectId;
  if (requiresParentContract.value && !contractId.value)
    void loadRelatedContracts();
  dirty.value = true;
}

function validateProjectArea(projectId: string): boolean {
  if (!projectId) return true;
  if (!projectAssociationAllowed.value) {
    form.projectId = "";
    ElMessage.error("资产类合同不能关联项目");
    return false;
  }
  const project = meta.value.projects.find((item) => item.id === projectId);
  if (form.area === "全部" || project?.area === form.area) return true;
  form.projectId = "";
  if (!contractId.value) form.parentContractId = "";
  ElMessage.error("只能选择上传时所选行政区内的归属项目");
  return false;
}

function handleProjectChange(projectId: string) {
  if (!validateProjectArea(projectId || "")) return;
  if (requiresParentContract.value && !contractId.value)
    void loadRelatedContracts();
}

function handleRelationTypeChange() {
  if (contractId.value) return;
  relatedLoadSequence += 1;
  form.parentContractId = "";
  lockedParentContractName.value = "";
  relatedContracts.value = [];
  form.projectName = "";
  relatedLoading.value = false;
  if (requiresParentContract.value && uploadParentContextReady.value) {
    void loadRelatedContracts();
  }
}

async function loadRelatedContracts(preserveSelection = false) {
  if (!requiresParentContract.value || !uploadParentContextReady.value) {
    relatedLoadSequence += 1;
    if (!preserveSelection) form.parentContractId = "";
    relatedContracts.value = [];
    relatedLoading.value = false;
    return;
  }
  const currentSequence = ++relatedLoadSequence;
  const previousParentContractId = form.parentContractId;
  if (!preserveSelection) form.parentContractId = "";
  relatedContracts.value = [];
  relatedLoading.value = true;
  try {
    const firstPage = await getContracts({
      projectId: form.projectId || undefined,
      area: form.area,
      page: 1,
      pageSize: 100,
    });
    const allItems = [...firstPage.items];
    const pageCount = Math.ceil(firstPage.total / 100);
    for (let page = 2; page <= pageCount; page += 1) {
      const nextPage = await getContracts({
        projectId: form.projectId || undefined,
        area: form.area,
        page,
        pageSize: 100,
      });
      allItems.push(...nextPage.items);
    }
    if (currentSequence !== relatedLoadSequence) return;
    relatedContracts.value = allItems.filter(
      (item) =>
        item.id !== contractId.value &&
        item.area === form.area &&
        item.category === form.declaredCategory &&
        item.relationType === "main" &&
        ["effective", "executing", "completed"].includes(item.status),
    );
    if (
      preserveSelection &&
      relatedContracts.value.some(
        (item) => item.id === previousParentContractId,
      )
    ) {
      form.parentContractId = previousParentContractId;
    } else if (preserveSelection && previousParentContractId) {
      form.parentContractId = previousParentContractId;
      ElMessage.warning(
        "未能从当前候选中读取已锁定上级合同，已保留上传时的关联关系",
      );
    }
  } catch {
    if (currentSequence !== relatedLoadSequence) return;
    if (preserveSelection) form.parentContractId = previousParentContractId;
    ElMessage.warning("上级合同候选加载失败，已保留上传时锁定的关联关系");
  } finally {
    if (currentSequence === relatedLoadSequence) relatedLoading.value = false;
  }
}

function handleParentContractChange(parentContractId: string) {
  if (contractId.value) {
    ElMessage.warning("上级合同已在上传时锁定，不能修改");
    return;
  }
  const parent = relatedContracts.value.find(
    (item) => item.id === parentContractId,
  );
  if (!parent) return;
  if (parent.area !== form.area || parent.category !== form.declaredCategory) {
    form.parentContractId = "";
    ElMessage.error("上级合同必须与当前草稿的行政区和合同类型一致");
    return;
  }
  form.declaredSubtype =
    parent.declaredSubtype ||
    DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY[form.declaredCategory];
  form.assetCategory =
    form.declaredCategory === "asset"
      ? parent.assetCategory ||
        (form.declaredSubtype as ContractUploadAssetCategory)
      : "";
  if (parent.projectId && !validateProjectArea(parent.projectId)) return;
  form.projectId = projectAssociationAllowed.value
    ? parent.projectId || ""
    : "";
  preserveInheritedSupplementName();
  dirty.value = true;
  ElMessage.info(
    projectAssociationAllowed.value
      ? "已关联同区、同分类的上级合同，并同步其关联项目"
      : "已关联同区、同分类的上级合同",
  );
}

function restoreSupportingFiles(files: ContractFile[]) {
  const editableTypes = new Set(["other"]);
  supportingFiles.value = files
    .filter((file) => editableTypes.has(file.fileType))
    .map((file) => ({
      fileType: file.fileType,
      fileId: file.id,
      fileName: file.fileName,
    }));
}

async function loadCurrentSealApplication() {
  if (!contractId.value || sealApplicationLoading.value) return;
  sealApplicationLoading.value = true;
  sealApplicationError.value = "";
  try {
    const application = await getContractSealApplication(contractId.value);
    sealApplication.value = application;
    sealApplicationFields.value = { ...application.fields };
    if (application.copyCountRecognition.status === "unrecognized") {
      sealApplicationError.value =
        application.copyCountRecognition.message ||
        "系统尚未形成唯一可信的用印总份数，暂不能办理用印";
    } else if (application.stale) {
      sealApplicationError.value =
        "合同内容已在上次签名后变化，请核对当前信息并重新电子签名。";
    }
  } catch (error) {
    sealApplicationError.value = getContractErrorMessage(
      error,
      "用印申请单加载失败",
    );
  } finally {
    sealApplicationLoading.value = false;
  }
}

async function signCurrentSealApplication(
  fields: ContractSealApplicationFields,
) {
  if (!contractId.value || sealApplicationSigning.value) return;
  sealApplicationSigning.value = true;
  sealApplicationError.value = "";
  try {
    const application = await signContractSealApplication(
      contractId.value,
      contractVersion.value,
      fields,
    );
    sealApplication.value = application;
    sealApplicationFields.value = { ...application.fields };
    ElMessage.success("用印申请单已生成并完成本人电子签名");
  } catch (error) {
    sealApplicationError.value = getContractErrorMessage(
      error,
      "用印申请单签名失败",
    );
    ElMessage.error(sealApplicationError.value);
  } finally {
    sealApplicationSigning.value = false;
  }
}

async function restoreDraft(id: string) {
  let refreshOutdatedRecognition = false;
  restoring.value = true;
  liveStatus.value = "正在恢复合同草稿";
  try {
    const detail = await getContract(id);
    if (detail.contract.status !== "draft") {
      ElMessage.warning("该合同已不在草拟状态，将为你打开合同详情");
      await router.replace(`/contracts/${id}`);
      return;
    }
    contractId.value = id;
    const recognitionSucceeded = detail.ocrJob?.status === "succeeded";
    const restoringSupplement = detail.contract.relationType === "supplement";
    const restoringTermination = detail.contract.relationType === "termination";
    restoredTerminationTargetId.value = restoringTermination
      ? detail.contract.terminationTargetContractId || ""
      : "";
    supplementChangeType.value = detail.contract.supplementChangeType || null;
    supplementAmountContext.value = {
      originalContractAmount: detail.contract.originalContractAmount ?? null,
      amountBeforeChange: detail.contract.amountBeforeChange ?? null,
      amountAfterChange: detail.contract.amountAfterChange ?? null,
      currentEffectiveAmount: detail.contract.currentEffectiveAmount ?? null,
    };
    form.partyA =
      recognitionSucceeded || restoringSupplement || restoringTermination
        ? detail.contract.partyA || ""
        : "";
    form.partyB =
      recognitionSucceeded || restoringSupplement || restoringTermination
        ? detail.contract.partyB || ""
        : "";
    form.projectName =
      recognitionSucceeded || restoringSupplement || restoringTermination
        ? detail.contract.projectName || ""
        : "";
    form.amount =
      supplementChangeType.value === "payment_terms_only"
        ? ""
        : recognitionSucceeded
          ? String(detail.contract.amount ?? "")
          : "";
    form.category =
      (recognitionSucceeded || restoringSupplement || restoringTermination) &&
      detail.contract.category &&
      ["main_business", "non_main", "asset"].includes(detail.contract.category)
        ? detail.contract.category
        : "";
    form.declaredCategory = detail.contract.declaredCategory || "";
    form.declaredSubtype = detail.contract.declaredSubtype || "";
    form.contractDate = recognitionSucceeded
      ? detail.contract.contractDate || ""
      : "";
    form.relationType = detail.contract.relationType;
    form.projectId =
      detail.contract.declaredCategory === "asset"
        ? ""
        : detail.contract.projectId || "";
    form.parentContractId = detail.contract.parentContractId || "";
    if (restoringTermination && restoredTerminationTargetId.value) {
      const targetRelation = detail.relations.find(
        (relation) => relation.contractId === restoredTerminationTargetId.value,
      );
      const currentEffectiveAmount = Number(
        detail.contract.amountBeforeChange || 0,
      );
      const settledAmount = Number(detail.contract.amountAfterChange || 0);
      terminationUploadContext.value = {
        rootContractId: detail.contract.rootContractId || form.parentContractId,
        parentContractId: form.parentContractId,
        targetContractId: restoredTerminationTargetId.value,
        targetRelationType: targetRelation?.relationType || "main",
        targetName: targetRelation?.contractName || "目标合同",
        generatedContractName: detail.contract.projectName || "解除协议书",
        area: detail.contract.area || "",
        declaredCategory: detail.contract.declaredCategory || "main_business",
        declaredSubtype:
          detail.contract.declaredSubtype || "engineering_consulting",
        assetCategory:
          detail.contract.assetCategory &&
          uploadAssetCategorySet.has(detail.contract.assetCategory)
            ? (detail.contract.assetCategory as ContractUploadAssetCategory)
            : null,
        projectId: detail.contract.projectId || null,
        projectName: detail.contract.projectName || "",
        partyA: detail.contract.partyA || "",
        partyB: detail.contract.partyB || "",
        currentEffectiveAmount,
        settledAmount,
        unperformedAmount: Math.max(0, currentEffectiveAmount - settledAmount),
        canUpload: true,
        blockingReason: null,
      };
    } else {
      terminationUploadContext.value = null;
    }
    lockedParentContractName.value =
      detail.relations.find(
        (relation) => relation.contractId === form.parentContractId,
      )?.contractName || "";
    preserveInheritedSupplementName();
    form.area =
      detail.contract.area && detail.contract.area !== "城区"
        ? detail.contract.area
        : "";
    form.assetCategory = detail.contract.assetCategory || "";
    form.requiresAuxiliaryMaterials = Boolean(
      detail.contract.requiresAuxiliaryMaterials,
    );
    form.description = detail.contract.description || "";

    if (form.projectId && !validateProjectArea(form.projectId)) {
      ElMessage.warning(
        "原关联项目不属于上传时锁定的行政区，已清除，请重新选择",
      );
    }

    ocrFields.value = detail.ocrFields;
    ocrJob.value = detail.ocrJob;
    contractVersion.value = detail.contract.version;
    jobId.value = detail.ocrJob?.id || "";
    restoreSupportingFiles(detail.files);

    const source = detail.files.find((file) =>
      ["draft_contract", "source"].includes(file.fileType),
    );
    if (!source) throw new Error("草稿缺少原始合同文件，请联系管理员处理");
    sourceFileId.value = source.id;
    sourceFileName.value = source.fileName;
    sourceMimeType.value = source.mimeType || "";
    previewUrl.value = getContractFileUrl(source.id);
    activeStep.value = 1;
    dirty.value = false;
    if (requiresParentContract.value) {
      await loadRelatedContracts(true);
    } else {
      form.parentContractId = "";
      relatedContracts.value = [];
    }
    liveStatus.value = recognitionSucceeded
      ? "合同草稿已恢复，可继续完善并提交"
      : "合同草稿已恢复，须先完成自动识别";

    if (!form.area || !form.declaredCategory) {
      pageError.value =
        "该历史草稿缺少上传时锁定的行政区或预选分类，不能继续识别；请重新上传合同";
    }

    if (detail.ocrJob?.requiresRefresh) {
      pageError.value = "";
      refreshOutdatedRecognition = true;
      liveStatus.value = "检测到旧版识别结果，系统将按最新规则自动重新识别";
    } else if (detail.ocrJob?.status === "partial") {
      pageError.value = "";
      liveStatus.value = "合同草稿已恢复，自动识别未通过，请重新自动识别";
    } else if (detail.ocrJob?.status === "failed") {
      pageError.value =
        detail.ocrJob.errorMessage ||
        "合同自动识别失败，系统未写入任何合同字段，请重新识别或重新上传清晰合同";
    }

    if (detail.ocrJob && !isOcrTerminal(detail.ocrJob.status)) {
      pollingSequence += 1;
      void pollRecognition(detail.ocrJob.id, pollingSequence);
    }
  } catch (error) {
    pageError.value = getContractErrorMessage(error, "恢复合同草稿失败");
    liveStatus.value = pageError.value;
  } finally {
    restoring.value = false;
  }
  if (refreshOutdatedRecognition) {
    await retryRecognition();
  }
}

function selectSupportingFile(uploadFile: UploadFile, fileType: string) {
  if (!uploadFile.raw) return;
  if (uploadFile.raw.size > 30 * 1024 * 1024) {
    ElMessage.error(`${uploadFile.name} 超过 30MB`);
    return;
  }
  supportingFiles.value = [
    ...supportingFiles.value.filter((item) => item.fileType !== fileType),
    { fileType, file: uploadFile.raw, fileName: uploadFile.name },
  ];
}

function findSupportingFile(fileType: string): SupportingFile | undefined {
  return supportingFiles.value.find((item) => item.fileType === fileType);
}

async function removeSupportingFile(fileType: string) {
  const current = findSupportingFile(fileType);
  if (!current) return;
  if (current.fileId && contractId.value) {
    try {
      await ElMessageBox.confirm(
        `确定移除“${current.fileName}”吗？`,
        "移除用印资料",
        {
          type: "warning",
          confirmButtonText: "确认移除",
          cancelButtonText: "取消",
        },
      );
      await deleteContractFile(contractId.value, current.fileId);
      ElMessage.success("用印资料已移除");
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      ElMessage.error(getContractErrorMessage(error, "移除用印资料失败"));
      return;
    }
  }
  supportingFiles.value = supportingFiles.value.filter(
    (item) => item.fileType !== fileType,
  );
}

async function nextStep() {
  if (!canContinue.value || activeStep.value >= 4) return;
  if (contractId.value && dirty.value) {
    const saved = await saveDraft(false);
    if (!saved) return;
  }
  if (activeStep.value === 3) {
    const uploaded = await uploadPendingSupportingFiles();
    if (!uploaded) return;
  }
  activeStep.value += 1;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function previousStep() {
  if (activeStep.value > 0) activeStep.value -= 1;
}

function buildPayload(): ContractUpdatePayload {
  return {
    expectedVersion: contractVersion.value,
    projectId: projectAssociationAllowed.value ? form.projectId || null : null,
    description: form.description.trim() || null,
  };
}

watch(
  form,
  () => {
    if (contractId.value && !restoring.value) dirty.value = true;
  },
  { deep: true },
);

async function saveDraft(showMessage: boolean) {
  if (!contractId.value) return false;
  if (!dirty.value) {
    if (showMessage) ElMessage.success("合同草稿已保存");
    return true;
  }
  saving.value = true;
  try {
    const updated = await updateContract(contractId.value, buildPayload());
    contractVersion.value = updated.version;
    dirty.value = false;
    if (showMessage) ElMessage.success("合同草稿已保存");
    return true;
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "保存合同草稿失败"));
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveCurrentProgress(showMessage: boolean): Promise<boolean> {
  if (!contractId.value) return false;
  if (dirty.value && !(await saveDraft(false))) return false;
  if (
    hasPendingSupportingUploads.value &&
    !(await uploadPendingSupportingFiles())
  ) {
    return false;
  }
  if (showMessage) ElMessage.success("合同草稿和待上传资料已保存");
  return true;
}

async function discardCurrentNewDraft(): Promise<boolean> {
  if (!createdDraftInCurrentSession.value || !contractId.value) return true;
  pollingSequence += 1;
  try {
    let version = contractVersion.value;
    try {
      const current = await getContract(contractId.value);
      if (current.contract.status !== "draft") {
        ElMessage.warning("合同状态已经变化，不能按新增草稿直接删除");
        return false;
      }
      version = current.contract.version;
    } catch {
      // 若识别任务尚未完成，继续使用创建时版本；服务端仍会执行版本门禁。
    }
    const result = await deleteContractDraft(contractId.value, version);
    if (result.failedFileCount > 0) {
      ElMessage.warning(
        "草稿数据库记录已删除，但部分附件文件清理异常，系统已记录告警",
      );
    }
    createdDraftInCurrentSession.value = false;
    contractId.value = "";
    dirty.value = false;
    selectedFile.value = null;
    supportingFiles.value = [];
    ElMessage.success("本次新增合同草稿已永久删除");
    return true;
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "删除本次新增草稿失败"));
    return false;
  }
}

async function uploadPendingSupportingFiles(): Promise<boolean> {
  if (!contractId.value) return false;
  saving.value = true;
  try {
    for (const item of supportingFiles.value) {
      if (!item.file) continue;
      liveStatus.value = `正在上传 ${item.fileName}`;
      const result = await uploadContractFile(
        contractId.value,
        item.file,
        item.fileType,
      );
      item.fileId = result.fileId;
      item.file = undefined;
    }
    liveStatus.value = "用印资料已保存";
    return true;
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "保存用印资料失败"));
    return false;
  } finally {
    saving.value = false;
  }
}

async function submitForApproval() {
  if (!finalConfirmed.value) {
    ElMessage.warning("请先勾选最终确认项");
    return;
  }
  if (
    !contractId.value ||
    !requiredFieldsComplete.value ||
    !relationComplete.value
  ) {
    ElMessage.warning("合同信息尚未填写完整");
    return;
  }
  if (!supportingFilesComplete.value) {
    ElMessage.warning(supportingRequirementText.value);
    return;
  }

  submitting.value = true;
  liveStatus.value = "正在核对合同与申请人已签署的用印申请单";
  try {
    if (dirty.value) {
      const updated = await updateContract(contractId.value, buildPayload());
      contractVersion.value = updated.version;
      sealApplicationError.value =
        "合同内容刚刚发生变化，请返回上一步重新确认并电子签名用印申请单。";
      throw new Error(sealApplicationError.value);
    }
    if (!(await uploadPendingSupportingFiles())) return;
    liveStatus.value = `正在${approvalSubmitLabel.value}`;
    await submitContract(contractId.value);
    submitted.value = true;
    dirty.value = false;
    ElMessage.success(`合同已${approvalSubmitLabel.value}`);
    await router.replace(`/contracts/${contractId.value}`);
  } catch (error) {
    pageError.value = getContractErrorMessage(
      error,
      "提交审批失败，合同草稿和已上传文件均已保留",
    );
    liveStatus.value = pageError.value;
  } finally {
    submitting.value = false;
  }
}

watch(activeStep, (step) => {
  if (step === 3) void loadCurrentSealApplication();
});

onMounted(async () => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  try {
    meta.value = await getContractMeta();
    metaReady.value = true;
  } catch (error) {
    metaReady.value = false;
    pageError.value = getContractErrorMessage(
      error,
      "合同基础数据加载失败，行政区和分类无法校验，已禁止上传",
    );
    ElMessage.error(pageError.value);
  }
  const resumeId = Array.isArray(route.query.contractId)
    ? route.query.contractId[0]
    : route.query.contractId;
  if (resumeId) {
    await restoreDraft(String(resumeId));
  } else if (rentalRenewalMode.value) {
    await loadRentalRenewalContext();
  } else if (quickTerminationMode.value) {
    await loadQuickTerminationContext();
  } else if (quickSupplementMode.value) {
    await loadQuickSupplementContext();
  }
});

onBeforeUnmount(() => {
  pollingSequence += 1;
  window.removeEventListener("beforeunload", handleBeforeUnload);
  if (previewUrl.value.startsWith("blob:"))
    URL.revokeObjectURL(previewUrl.value);
});

function handleBeforeUnload(event: Event) {
  if (!hasUnsavedChanges.value || submitted.value) return;
  event.preventDefault();
  (event as unknown as { returnValue: string }).returnValue = "";
}

onBeforeRouteLeave(async () => {
  if (submitted.value) return true;
  if (!createdDraftInCurrentSession.value && !hasUnsavedChanges.value) {
    return true;
  }
  try {
    await ElMessageBox.confirm(
      createdDraftInCurrentSession.value
        ? "当前合同是本次新建草稿。保存后离开将保留草稿；直接离开将永久删除本次草稿、识别结果和附件。"
        : "当前合同仍有未保存修改或待上传资料。保存后离开将保存本次修改；直接离开仅放弃本次修改并保留原草稿。",
      "离开新增合同",
      {
        type: "warning",
        distinguishCancelAndClose: true,
        confirmButtonText: "保存后离开",
        cancelButtonText: "直接离开",
      },
    );
    return await saveCurrentProgress(false);
  } catch (action) {
    if (action !== "cancel") return false;
    return createdDraftInCurrentSession.value
      ? await discardCurrentNewDraft()
      : true;
  }
});
</script>

<style scoped>
.contract-create-page {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 20px 28px 46px;
  background:
    radial-gradient(circle at 6% 2%, rgb(44 108 150 / 8%), transparent 22%),
    #f4f7f9;
  color: #1c3349;
}
.create-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.header-copy {
  display: flex;
  align-items: center;
  gap: 14px;
}
.header-copy h1 {
  margin: 2px 0 3px;
  color: #19344d;
  font-size: 27px;
}
.header-copy p {
  margin: 0;
  color: #7b8997;
  font-size: 12px;
}
.header-kicker {
  color: #26817d;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.header-actions :deep(.el-button) {
  border-radius: 9px;
}
.create-steps {
  margin: 20px 0 18px;
  padding: 17px 12px;
  border: 1px solid #dfe7ee;
  border-radius: 12px;
  background: rgb(255 255 255 / 90%);
}
.create-steps :deep(.el-step__title) {
  font-size: 13px;
}
.create-steps :deep(.el-step__description) {
  font-size: 10px;
}
.live-region {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.page-alert {
  margin-bottom: 14px;
  border-radius: 10px;
}
.create-workspace {
  display: grid;
  grid-template-columns: minmax(420px, 0.92fr) minmax(460px, 1.08fr);
  align-items: start;
  gap: 16px;
}
.preview-column,
.form-column {
  position: relative;
  min-width: 0;
  padding: 16px;
  border: 1px solid #dfe7ee;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 30px rgb(31 49 68 / 6%);
}
.preview-column {
  position: sticky;
  top: 76px;
}
.column-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.column-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.column-heading span {
  color: #25445f;
  font-weight: 650;
}
.column-heading small {
  overflow: hidden;
  color: #96a0aa;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-overlay {
  position: absolute;
  inset: 62px 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-radius: 12px;
  background: rgb(238 243 246 / 92%);
  backdrop-filter: blur(4px);
}
.upload-dropzone {
  display: flex;
  width: min(420px, 100%);
  min-height: 250px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding: 28px;
  border: 2px dashed #9ab7c7;
  border-radius: 16px;
  background: rgb(255 255 255 / 90%);
  color: #718090;
  cursor: pointer;
  font: inherit;
  transition:
    border-color 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
}
.upload-dropzone:hover,
.upload-dropzone:focus-visible,
.upload-dropzone.is-dragging {
  border-color: #168f92;
  box-shadow: 0 14px 32px rgb(28 110 118 / 12%);
  outline: none;
  transform: translateY(-2px);
}
.upload-dropzone.is-disabled,
.upload-dropzone:disabled {
  border-color: #c8d2da;
  background: rgb(246 248 250 / 96%);
  box-shadow: none;
  color: #9aa7b2;
  cursor: not-allowed;
  transform: none;
}
.upload-dropzone.is-disabled .upload-icon {
  background: #edf1f4;
  color: #9ca8b3;
}
.upload-dropzone strong {
  color: #25445f;
  font-size: 17px;
}
.upload-dropzone.is-disabled strong {
  color: #718090;
}
.upload-dropzone > span:last-child {
  font-size: 12px;
}
.upload-icon {
  display: inline-flex;
  width: 68px;
  height: 68px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: linear-gradient(145deg, #e3f3f1, #e7eef6);
  color: #1e8484;
}
.form-column {
  min-height: 694px;
}
.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e8edf1;
}
.section-index {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: linear-gradient(145deg, #e2f2f0, #e7eef6);
  color: #237e82;
  font-size: 12px;
  font-weight: 800;
}
.section-heading h2 {
  margin: 0 0 3px;
  color: #203e59;
  font-size: 20px;
}
.section-heading p {
  margin: 0;
  color: #84919e;
  font-size: 12px;
}
.upload-prerequisite-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.supplement-inherited-panel {
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid #d7e8e6;
  border-radius: 12px;
  background: linear-gradient(145deg, #f3faf9, #f8fafc);
}
.supplement-inherited-panel :deep(.el-alert) {
  margin: 0;
}
.upload-category-group {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}
.upload-category-option {
  width: 100%;
  height: auto;
  min-height: 94px;
  margin: 0;
  padding: 13px 12px;
  white-space: normal;
}
.upload-category-option :deep(.el-radio__label) {
  min-width: 0;
  padding-left: 8px;
  white-space: normal;
}
.category-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.category-option-copy strong {
  color: #284962;
  line-height: 1.35;
}
.category-option-copy small {
  color: #7c8995;
  font-size: 11px;
  line-height: 1.45;
}
.feature-list {
  display: grid;
  gap: 12px;
  margin-top: 22px;
}
.feature-list article {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid #e3e9ee;
  border-radius: 12px;
  background: #fafcfd;
}
.feature-list .el-icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 11px;
  background: #e8f4f3;
  color: #258886;
  font-size: 20px;
}
.feature-list article > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.feature-list strong {
  color: #284962;
}
.feature-list span {
  color: #82909e;
  font-size: 12px;
}
.recognition-progress {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid #cfe2e6;
  border-radius: 12px;
  background: #f1f8f8;
}
.recognition-orbit {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #dcefed;
  color: #1b807d;
}
.recognition-progress > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.recognition-progress strong {
  color: #246368;
}
.recognition-progress span {
  color: #779095;
  font-size: 12px;
}
.recognition-blocked-panel {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding: 14px;
  border: 1px solid #efd3a9;
  border-radius: 12px;
  background: #fffaf2;
}
.recognition-blocked-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}
.field-alert {
  margin-top: 12px;
}
.project-suggestions {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
  padding: 13px;
  border: 1px solid #d5e7e5;
  border-radius: 12px;
  background: #f3f9f8;
}
.suggestion-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #277d7c;
  font-size: 12px;
  font-weight: 700;
}
.project-suggestions button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #dfe9e8;
  border-radius: 10px;
  background: #fff;
  color: #718090;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.project-suggestions button:hover,
.project-suggestions button:focus-visible,
.project-suggestions button.selected {
  border-color: #53a8a2;
  outline: none;
  box-shadow: 0 4px 12px rgb(32 119 119 / 9%);
}
.project-suggestions button > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.project-suggestions strong {
  color: #25455f;
}
.project-suggestions small {
  color: #95a0aa;
}
.relation-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.hierarchy-alert {
  margin: 0 0 16px;
}
.supplement-amount-details {
  margin: 0 0 16px;
}
.supplement-amount-details :deep(.el-descriptions__label) {
  color: #718493;
}
.supplement-amount-details :deep(.el-descriptions__content) {
  color: #167f87;
  font-weight: 650;
}
.amount-rule-tip {
  width: 100%;
  margin: 7px 0 0;
  color: #708393;
  font-size: 12px;
  line-height: 1.55;
}
.amount-rule-tip.invalid {
  color: #d35c5c;
}
.locked-field-tip {
  width: 100%;
  margin: 6px 0 0;
  color: #708393;
  font-size: 11px;
  line-height: 1.5;
}
.relation-options {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.relation-options :deep(.el-radio-button__inner) {
  width: 100%;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.support-file-grid {
  display: grid;
  gap: 12px;
}
.support-file-card {
  padding: 16px;
  border: 1px solid #e2e8ed;
  border-radius: 12px;
  background: #fafcfd;
}
.support-file-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 13px;
}
.support-file-title > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.support-file-title strong {
  color: #294860;
}
.support-file-title small {
  color: #8a97a3;
}
.support-icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: #e7f2f2;
  color: #277f81;
}
.selected-file {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 9px;
  background: #eaf5ed;
  color: #4f8d64;
}
.selected-file span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.confirmation-banner {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #cce4e0;
  border-radius: 12px;
  background: linear-gradient(135deg, #edf8f6, #f1f6fb);
}
.confirmation-banner > span {
  display: inline-flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: #d9efeb;
  color: #237e7b;
  font-size: 23px;
}
.confirmation-banner strong {
  color: #24686a;
}
.confirmation-banner p {
  margin: 3px 0 0;
  color: #748b91;
  font-size: 12px;
}
.confirmation-details {
  margin-bottom: 14px;
}
.amount-text {
  color: #167f87;
}
.final-confirmation {
  height: auto;
  align-items: flex-start;
  padding: 13px;
  border: 1px solid #e2e8ed;
  border-radius: 10px;
  white-space: normal;
}
.mobile-action-bar {
  display: none;
}

@media (max-width: 1366px) {
  .contract-create-page {
    margin: -16px -20px;
    padding: 18px 20px 40px;
  }
  .create-workspace {
    grid-template-columns: minmax(360px, 0.88fr) minmax(430px, 1.12fr);
  }
}

@media (max-width: 980px) {
  .create-header {
    align-items: flex-start;
  }
  .header-actions {
    display: none;
  }
  .create-workspace {
    grid-template-columns: 1fr;
  }
  .preview-column {
    position: relative;
    top: auto;
  }
  .form-column {
    min-height: 0;
  }
}

@media (max-width: 768px) {
  .contract-create-page {
    margin: -16px -20px;
    padding: 14px 14px 86px;
  }
  .header-copy {
    align-items: flex-start;
  }
  .header-copy h1 {
    font-size: 22px;
  }
  .create-steps {
    overflow-x: auto;
    justify-content: flex-start;
    scrollbar-width: thin;
  }
  .create-steps :deep(.el-step) {
    min-width: 132px;
    flex: 0 0 132px;
  }
  .preview-column,
  .form-column {
    padding: 13px;
  }
  .form-grid,
  .relation-options,
  .upload-category-group {
    grid-template-columns: 1fr;
  }
  .confirmation-details :deep(.el-descriptions__body) {
    overflow-x: auto;
  }
  .mobile-action-bar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 120;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #dfe6ec;
    background: rgb(255 255 255 / 95%);
    box-shadow: 0 -8px 24px rgb(30 50 70 / 8%);
    backdrop-filter: blur(10px);
  }
  .mobile-action-bar :deep(.el-button) {
    min-width: 110px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .upload-dropzone {
    transition: none;
  }
}
</style>
