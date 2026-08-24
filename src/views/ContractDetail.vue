<template>
  <div class="contract-detail-page">
    <div class="detail-topbar">
      <el-button :icon="ArrowLeft" @click="handleDetailBack">{{
        detailBackLabel
      }}</el-button>
      <div
        v-if="detail && !errorMessage && !detailManagerSealApprovalActive"
        class="detail-actions"
      >
        <el-button
          :icon="Refresh"
          :loading="loading"
          :disabled="detailApprovalWorkspaceVisible"
          @click="loadDetail"
          >刷新</el-button
        >
        <el-button
          v-if="canEdit && detail.contract.status === 'draft'"
          type="primary"
          :icon="EditPen"
          @click="
            router.push(`/contracts/create?contractId=${detail.contract.id}`)
          "
          >继续编辑</el-button
        >
        <el-button
          v-if="canEdit && detail.contract.status === 'draft'"
          plain
          :icon="Promotion"
          :loading="actionLoading"
          @click="handleSubmitDraft"
          >{{ approvalSubmitLabel }}</el-button
        >
        <el-button
          v-if="canEdit && detail.contract.status === 'draft'"
          type="danger"
          plain
          :icon="Delete"
          :loading="actionLoading"
          @click="handleDeleteDraft"
          >删除草稿</el-button
        >
        <el-button
          v-if="
            canEdit &&
            detail.contract.status === 'approving' &&
            detail.contract.pendingAction === 'seal' &&
            detail.contract.previousStatus === 'draft'
          "
          type="warning"
          plain
          :loading="actionLoading"
          @click="handleWithdrawApproval"
          >撤回审批</el-button
        >
        <template v-if="canApprove && detail.contract.status === 'approving'">
          <el-button
            type="danger"
            plain
            :disabled="detailApprovalWorkspaceVisible"
            @click="openDetailApproval('reject')"
            >{{ detailApprovalRejectLabel }}</el-button
          >
          <el-button
            type="primary"
            :icon="Promotion"
            :disabled="detailApprovalWorkspaceVisible"
            @click="openDetailApproval('approve')"
            >{{ detailApprovalPrimaryLabel }}</el-button
          >
        </template>
        <el-button
          v-if="canEdit && detail.contract.status === 'pending_seal'"
          type="primary"
          :icon="Stamp"
          @click="openSealedWorkspace"
          >上传盖章合同</el-button
        >
        <el-button
          v-if="canManageRentalLifecycle"
          type="success"
          plain
          @click="openRentalRenewal"
          >续签</el-button
        >
        <el-button
          v-if="canManageRentalLifecycle"
          type="danger"
          plain
          :loading="rentalExitConfirming"
          @click="openRentalExit"
          >{{ rentalExitLabel }}</el-button
        >
        <el-button
          v-if="canUploadSupplement"
          type="warning"
          plain
          :icon="UploadFilled"
          @click="openSupplementUpload"
          >上传补充协议</el-button
        >
        <el-button
          v-if="canUploadTermination && !isRentalLifecycleContract"
          type="danger"
          plain
          :icon="UploadFilled"
          @click="openTerminationUpload"
          >上传解除协议书</el-button
        >
      </div>
    </div>

    <div
      v-if="sealVerificationError"
      ref="sealPageErrorRef"
      class="seal-page-error"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <el-alert
        type="error"
        show-icon
        closable
        title="盖章合同处理失败"
        :description="sealVerificationError"
        @close="clearSealVerificationError"
      />
    </div>

    <el-alert
      v-if="errorMessage"
      type="error"
      :closable="false"
      show-icon
      title="合同详情加载失败"
      :description="errorMessage"
    >
      <template #default
        ><el-button type="danger" link @click="loadDetail"
          >重新加载</el-button
        ></template
      >
    </el-alert>

    <div v-if="loading && !detail" class="detail-skeleton">
      <el-skeleton :rows="12" animated />
    </div>

    <template v-else-if="detail && !errorMessage">
      <header v-if="!detailManagerSealApprovalActive" class="detail-hero">
        <div class="hero-main">
          <span class="hero-kicker">{{
            detail.contract.category
              ? CONTRACT_CATEGORY_LABELS[detail.contract.category]
              : "待识别"
          }}</span>
          <div class="title-row">
            <h1>{{ detail.contract.name || detail.contract.projectName }}</h1>
            <ContractStatusTag :status="detail.contract.status" />
            <el-tag
              v-if="detail.contract.status === 'approving'"
              :type="isTerminationApproval ? 'danger' : 'warning'"
              effect="light"
            >
              {{
                isTerminationApproval
                  ? "终止审批"
                  : isSealDifferenceApproval
                    ? "盖章差异复审"
                    : "用印审批"
              }}
            </el-tag>
          </div>
          <p>
            {{
              detail.contract.contractNo ||
              (detail.contract.declaredCategory === "main_business"
                ? "原件合同编号待识别"
                : "系统编号待生成")
            }}
          </p>
          <div class="hero-meta">
            <span
              ><el-icon><OfficeBuilding /></el-icon
              >{{ detail.contract.partyA }}</span
            >
            <span
              ><el-icon><Connection /></el-icon
              >{{ detail.contract.partyB }}</span
            >
            <span
              ><el-icon><Location /></el-icon
              >{{ detail.contract.area || "城区" }}</span
            >
          </div>
        </div>
        <div
          class="hero-amount"
          :class="{ 'has-pending-change': hasPendingSupplementAmountChange }"
        >
          <template v-if="isTerminationContract">
            <span>解除协议结算结果</span>
            <strong>{{
              formatContractMoney(detail.contract.terminationFinalAmount, "—")
            }}</strong>
            <div class="supplement-amount-summary">
              <small
                >解除前合同有效金额
                {{
                  formatContractMoney(detail.contract.amountBeforeChange, "—")
                }}</small
              >
              <small
                >已履行金额
                {{
                  formatContractMoney(detail.contract.fulfilledAmount, "—")
                }}</small
              >
              <small
                >解除后不再履行金额
                {{
                  formatContractMoney(detail.contract.unperformedAmount, "—")
                }}</small
              >
              <small
                >解除后最终合同金额
                {{
                  formatContractMoney(
                    detail.contract.terminationFinalAmount,
                    "—",
                  )
                }}</small
              >
            </div>
          </template>
          <template v-else-if="isSupplementContract">
            <span>{{ supplementChangeTypeLabel }}</span>
            <strong>{{ formatContractMoney(displayedCurrentAmount) }}</strong>
            <div class="supplement-amount-summary">
              <small
                >主合同原始
                {{
                  formatContractMoney(
                    detail.contract.originalContractAmount,
                    "—",
                  )
                }}</small
              >
              <small
                >生效前
                {{
                  formatContractMoney(detail.contract.amountBeforeChange, "—")
                }}</small
              >
              <small
                >本次增减
                {{ formatContractMoney(supplementAmountDelta) }}</small
              >
              <small
                >生效后
                {{
                  formatContractMoney(detail.contract.amountAfterChange, "—")
                }}</small
              >
              <small
                >当前有效
                {{
                  formatContractMoney(
                    detail.contract.currentEffectiveAmount,
                    "—",
                  )
                }}</small
              >
            </div>
          </template>
          <template v-else-if="hasPendingSupplementAmountChange">
            <span>补充协议变更后合同金额</span>
            <strong>{{ formatContractMoney(displayedCurrentAmount) }}</strong>
            <small class="amount-before"
              >变更前
              {{ formatContractMoney(pendingAmountBeforeChange) }}</small
            >
            <small class="amount-adjustment"
              >本次增减
              {{ formatContractMoney(pendingAmountAdjustment) }}</small
            >
            <small
              >{{ pendingSupplementDisplayCount }} 份补充协议待生效 ·
              回款暂按变更后金额展示</small
            >
          </template>
          <template v-else>
            <span>当前合同总额</span>
            <strong>{{ formatContractMoney(displayedCurrentAmount) }}</strong>
            <small
              >{{ CONTRACT_RELATION_LABELS[detail.contract.relationType] }} ·
              服务端实时核算</small
            >
          </template>
        </div>
      </header>

      <el-alert
        v-if="hasPendingSupplementAmountChange"
        class="pending-supplement-amount-alert"
        type="warning"
        show-icon
        :closable="false"
        :title="`补充协议待生效：${formatContractMoney(pendingAmountBeforeChange)} ${pendingAmountAdjustment >= 0 ? '+' : '−'} ${formatContractMoney(Math.abs(pendingAmountAdjustment))} = ${formatContractMoney(displayedCurrentAmount)}`"
        description="本页未回款（未付款）金额和完成率暂按变更后金额展示；补充协议生效后转为正式合同金额，驳回后恢复原金额。"
      />

      <el-alert
        v-if="!detailManagerSealApprovalActive && overSettlementAmount > 0"
        class="settlement-warning"
        type="warning"
        show-icon
        :closable="false"
        :title="`结算金额已超出当前合同总额 ${formatContractMoney(overSettlementAmount)}`"
        description="系统允许保留超额回款或付款，请财务复核合同调整协议与凭证。"
      />

      <el-alert
        v-if="
          !detailManagerSealApprovalActive &&
          sealVerification &&
          sealVerification.status !== 'archived' &&
          sealVerification.status !== 'superseded'
        "
        class="seal-workflow-alert"
        :type="sealStatusAlertType"
        show-icon
        :closable="false"
        :title="sealStatusTitle"
        :description="sealStatusDescription"
      >
        <template #default>
          <el-button link type="primary" @click="openSealedWorkspace"
            >查看核验详情</el-button
          >
        </template>
      </el-alert>

      <section
        v-if="!detailManagerSealApprovalActive"
        class="metric-grid"
        aria-label="合同执行指标"
      >
        <ContractMetricCard
          :label="
            isAssetContract
              ? isInternalFundingMode
                ? '工程已支出'
                : '已付款'
              : '已上传有效回单'
          "
          :value="
            formatContractMoney(
              isAssetContract
                ? detail.contract.paidAmount
                : detail.contract.receivedAmount,
            )
          "
          :note="
            isAssetContract
              ? isInternalFundingMode
                ? '按工程咨询转给科技的回单日期计支出'
                : '已上传有效付款凭证口径'
              : '作为收入核算 X 值'
          "
          :icon="CircleCheck"
          tone="green"
        />
        <ContractMetricCard
          v-if="isAssetContract && isInternalFundingMode"
          label="科技已对外付款"
          :value="formatContractMoney(detail.contract.externalPaidAmount)"
          note="仅用于合同履约核销，不重复增加经营支出"
          :icon="CircleCheck"
          tone="cyan"
        />
        <ContractMetricCard
          :label="
            isAssetContract
              ? isInternalFundingMode
                ? '待工程划拨'
                : '未付款金额'
              : '未回款金额'
          "
          :value="
            formatContractMoney(
              isAssetContract
                ? detail.accounting?.unpaidAmount
                : detail.accounting?.unreceivedAmount,
              '—',
            )
          "
          note="由服务端合同核算返回"
          :icon="WarningFilled"
          tone="amber"
        />
        <ContractMetricCard
          :label="
            isAssetContract && isInternalFundingMode
              ? '履约支付完成率'
              : isAssetContract
                ? '付款完成率'
                : '合同完成率'
          "
          :value="`${normalizedProgress}%`"
          :note="
            isAssetContract
              ? `${isInternalFundingMode ? '科技对外付款' : '有效付款'} / ${hasPendingSupplementAmountChange ? '变更后合同金额' : '当前合同总额'}`
              : `有效回单 / ${hasPendingSupplementAmountChange ? '变更后合同金额' : '当前合同总额'}`
          "
          :icon="TrendCharts"
          tone="cyan"
        />
        <ContractMetricCard
          :label="
            detail.contract.category === 'asset' ? '本月支出' : '核算基数'
          "
          :value="
            formatContractMoney(
              detail.contract.category === 'asset'
                ? detail.accounting?.monthExpense
                : detail.accounting?.basis,
            )
          "
          note="直接展示服务端核算结果"
          :icon="DataAnalysis"
          tone="navy"
        />
      </section>

      <section
        v-if="!detailManagerSealApprovalActive"
        class="lifecycle-card"
        aria-label="合同生命周期"
      >
        <div class="lifecycle-heading">
          <div>
            <strong>合同主流程</strong>
            <small>终止作为独立状态介入，不占用主流程节点</small>
          </div>
          <el-tag
            v-if="terminationLifecycleNotice"
            type="danger"
            effect="light"
          >
            {{ terminationLifecycleNotice }}
          </el-tag>
        </div>
        <div
          class="lifecycle-track"
          :class="{
            'rejected-lifecycle': detail.contract.status === 'rejected',
          }"
        >
          <div
            v-for="(stage, index) in lifecycleStages"
            :key="stage.value"
            class="lifecycle-stage"
            :class="{
              active:
                !terminationLifecycleNotice &&
                lifecycleDisplayStatus === stage.value,
              complete: currentLifecycleIndex > index,
              interrupted:
                Boolean(terminationLifecycleNotice) &&
                lifecycleDisplayStatus === stage.value,
              terminal:
                stage.value === 'rejected' &&
                detail.contract.status === stage.value,
            }"
          >
            <span>{{ index + 1 }}</span>
            <strong>{{ stage.label }}</strong>
          </div>
        </div>
      </section>

      <div
        v-if="detailApprovalWorkspaceVisible"
        ref="detailApprovalWorkspaceRef"
        class="detail-approval-workspace-host"
      >
        <ContractApprovalWorkspace
          :key="detailApprovalWorkspaceKey"
          :contract="detail.contract"
          :initial-action="detailApprovalAction"
          close-label="返回合同详情"
          @close="closeDetailApprovalWorkspace"
          @completed="handleDetailApprovalCompleted"
        />
      </div>

      <el-tabs
        v-if="!detailManagerSealApprovalActive"
        v-model="activeTab"
        class="detail-tabs"
      >
        <el-tab-pane label="合同总览" name="overview">
          <div class="overview-grid">
            <section class="content-card">
              <div class="card-heading">
                <h2>基础信息</h2>
                <span>识别结果已归档</span>
              </div>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="甲方单位">{{
                  detail.contract.partyA
                }}</el-descriptions-item>
                <el-descriptions-item label="乙方单位">{{
                  detail.contract.partyB
                }}</el-descriptions-item>
                <el-descriptions-item
                  :label="
                    detail.contract.category === 'asset'
                      ? '合同名称'
                      : '项目名称'
                  "
                  >{{ detail.contract.projectName }}</el-descriptions-item
                >
                <el-descriptions-item label="合同签订日期">{{
                  formatContractDate(detail.contract.contractDate)
                }}</el-descriptions-item>
                <el-descriptions-item label="合同分类">{{
                  detail.contract.category
                    ? CONTRACT_CATEGORY_LABELS[detail.contract.category]
                    : "待识别"
                }}</el-descriptions-item>
                <el-descriptions-item label="合同关系">{{
                  CONTRACT_RELATION_LABELS[detail.contract.relationType]
                }}</el-descriptions-item>
                <el-descriptions-item label="合同说明">{{
                  detail.contract.description || "—"
                }}</el-descriptions-item>
                <el-descriptions-item label="是否需要辅助材料">
                  <el-switch
                    v-if="canEdit"
                    :model-value="
                      Boolean(detail.contract.requiresAuxiliaryMaterials)
                    "
                    :loading="auxiliarySettingLoading"
                    :disabled="
                      auxiliarySettingLoading ||
                      (Boolean(detail.contract.requiresAuxiliaryMaterials) &&
                        auxiliaryHasContent)
                    "
                    active-text="是"
                    inactive-text="否"
                    @change="updateAuxiliaryMaterialRequirement"
                  />
                  <small
                    v-if="
                      detail.contract.requiresAuxiliaryMaterials &&
                      auxiliaryHasContent
                    "
                    class="auxiliary-setting-tip"
                  >
                    请先删除全部辅助材料后再关闭
                  </small>
                  <span v-else>{{
                    detail.contract.requiresAuxiliaryMaterials ? "是" : "否"
                  }}</span>
                </el-descriptions-item>
                <el-descriptions-item
                  :label="isSupplementContract ? '本次增减' : '合同金额'"
                  >{{
                    formatContractMoney(
                      isSupplementContract
                        ? supplementAmountDelta
                        : detail.contract.amount,
                    )
                  }}</el-descriptions-item
                >
                <el-descriptions-item
                  v-if="isSupplementContract"
                  label="补充协议变更类型"
                  >{{ supplementChangeTypeLabel }}</el-descriptions-item
                >
                <template
                  v-if="
                    detail.contract.leaseStartDate ||
                    detail.contract.leaseEndDate
                  "
                >
                  <el-descriptions-item label="租赁开始日">{{
                    formatContractDate(detail.contract.leaseStartDate)
                  }}</el-descriptions-item>
                  <el-descriptions-item label="租赁到期日">{{
                    formatContractDate(detail.contract.leaseEndDate)
                  }}</el-descriptions-item>
                  <el-descriptions-item label="租赁金额口径" :span="2">
                    <span
                      v-if="
                        detail.contract.leaseAmountSource ===
                          'monthly_rent_calculated' ||
                        detail.contract.leaseAmountSource ===
                          'monthly_rent_property_fee_calculated'
                      "
                    >
                      月租金
                      {{
                        formatContractMoney(detail.contract.leaseMonthlyRent)
                      }}
                      <template
                        v-if="detail.contract.leaseMonthlyPropertyManagementFee"
                      >
                        + 月物业管理费
                        {{
                          formatContractMoney(
                            detail.contract.leaseMonthlyPropertyManagementFee,
                          )
                        }}，合计每月
                        {{ formatContractMoney(leaseMonthlyFixedFeeTotal) }}
                      </template>
                      × {{ detail.contract.leaseTermMonths || 12 }} 个月 =
                      合同总金额
                      {{ formatContractMoney(leaseCalculatedContractTotal) }}
                    </span>
                    <span v-else>
                      合同正文明确综合总金额
                      {{
                        formatContractMoney(
                          detail.contract.originalContractAmount ??
                            detail.contract.currentEffectiveAmount,
                        )
                      }}
                    </span>
                  </el-descriptions-item>
                </template>
                <el-descriptions-item
                  v-if="detail.contract.previousLeaseContractId"
                  label="续签来源"
                  :span="2"
                >
                  <el-button
                    type="primary"
                    link
                    @click="
                      openRelatedContract(
                        detail.contract.previousLeaseContractId,
                      )
                    "
                  >
                    查看原租赁主合同
                  </el-button>
                </el-descriptions-item>
                <el-descriptions-item
                  v-if="detail.contract.renewalContractId"
                  label="续签去向"
                  :span="2"
                >
                  <el-button
                    type="success"
                    link
                    @click="
                      openRelatedContract(detail.contract.renewalContractId)
                    "
                  >
                    {{
                      detail.contract.renewalContractName ||
                      "查看续签后的新主合同"
                    }}
                  </el-button>
                  <ContractStatusTag
                    v-if="detail.contract.renewalContractStatus"
                    :status="detail.contract.renewalContractStatus"
                    size="small"
                  />
                </el-descriptions-item>
                <el-descriptions-item label="负责人">{{
                  detail.contract.ownerName || "财务"
                }}</el-descriptions-item>
              </el-descriptions>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane
          v-if="detail.contract.requiresAuxiliaryMaterials"
          label="辅助材料"
          name="auxiliary"
        >
          <ContractAuxiliaryPackageManager
            :contract-id="contractId"
            @content-state="auxiliaryHasContent = $event"
          />
        </el-tab-pane>

        <el-tab-pane
          :label="`合同关系（${detail.relations.length}）`"
          name="relations"
        >
          <section class="content-card">
            <div class="card-heading">
              <h2>主合同与协议关系</h2>
              <span>金额累计以服务端核算为准</span>
            </div>
            <div v-if="detail.relations.length" class="relation-tree">
              <button
                v-for="relation in orderedRelations"
                :key="relation.id"
                type="button"
                @click="openRelatedContract(relation.contractId)"
              >
                <span class="relation-node"
                  ><el-icon><Connection /></el-icon
                ></span>
                <span
                  ><strong>{{ relation.contractName }}</strong
                  ><small
                    >{{ CONTRACT_RELATION_LABELS[relation.relationType] }} ·
                    {{ relation.contractNo || "暂无编号" }}</small
                  ></span
                >
                <span
                  v-if="relation.relationType === 'supplement'"
                  class="relation-amount-chain"
                >
                  <em
                    v-if="
                      relation.supplementChangeType === 'payment_terms_only'
                    "
                    >仅变更付款方式</em
                  >
                  <small
                    >原始
                    {{
                      formatContractMoney(relation.originalContractAmount, "—")
                    }}</small
                  >
                  <small
                    >生效前
                    {{
                      formatContractMoney(relation.amountBeforeChange, "—")
                    }}</small
                  >
                  <small
                    >本次增减
                    {{
                      formatContractMoney(
                        relationSupplementAmountDelta(relation),
                      )
                    }}</small
                  >
                  <small
                    >生效后
                    {{
                      formatContractMoney(relation.amountAfterChange, "—")
                    }}</small
                  >
                  <b
                    >当前有效
                    {{
                      formatContractMoney(relation.currentEffectiveAmount, "—")
                    }}</b
                  >
                </span>
                <span
                  v-else-if="relation.relationType === 'termination'"
                  class="relation-amount-chain"
                >
                  <small
                    >解除对象：{{
                      relationTerminationTargetName(relation)
                    }}</small
                  >
                  <small
                    >解除前合同有效金额
                    {{
                      formatContractMoney(relation.amountBeforeChange, "—")
                    }}</small
                  >
                  <small
                    >已履行金额
                    {{
                      formatContractMoney(relation.fulfilledAmount, "—")
                    }}</small
                  >
                  <small
                    >解除后不再履行金额
                    {{
                      formatContractMoney(relation.unperformedAmount, "—")
                    }}</small
                  >
                  <b
                    >解除后最终合同金额
                    {{
                      formatContractMoney(relation.terminationFinalAmount, "—")
                    }}</b
                  >
                </span>
                <b v-else>{{ formatContractMoney(relation.amount) }}</b>
                <ContractStatusTag
                  v-if="
                    relation.status && relation.relationType !== 'termination'
                  "
                  :status="relation.status"
                  size="small"
                />
              </button>
            </div>
            <el-empty v-else description="暂无关联合同或协议" />
          </section>
        </el-tab-pane>

        <el-tab-pane
          :label="`审批流程（${approvalFlowNodeCount}）`"
          name="approval"
        >
          <section class="content-card">
            <div class="card-heading">
              <h2>审批流程</h2>
            </div>
            <el-timeline
              v-if="detail.approvals.length || approvalFlowPendingTitle"
              class="approval-timeline"
            >
              <el-timeline-item
                v-for="record in detail.approvals"
                :key="record.id"
                :timestamp="
                  record.createdAt
                    ? formatContractDateTime(record.createdAt)
                    : '时间未记录'
                "
                placement="top"
                :type="
                  record.action === 'approve'
                    ? 'success'
                    : record.action === 'reject'
                      ? 'danger'
                      : 'primary'
                "
              >
                <div class="timeline-record">
                  <strong>{{
                    record.actionLabel || approvalActionLabel(record.action)
                  }}</strong>
                  <span
                    >{{
                      approvalPersonPosition(
                        record.approverPosition,
                        record.approverRole,
                      )
                    }}
                    {{ record.approverName || "系统" }}</span
                  >
                </div>
              </el-timeline-item>
              <el-timeline-item
                v-if="approvalFlowPendingTitle"
                timestamp="待处理"
                placement="top"
                type="warning"
              >
                <div class="timeline-record approval-next-record">
                  <strong>{{ approvalFlowPendingTitle }}</strong>
                </div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="当前没有待处理的审批节点" />
          </section>
        </el-tab-pane>

        <el-tab-pane
          v-if="detail.contract.relationType === 'main'"
          :label="`合同附件（${displayedContractFiles.length}）`"
          name="files"
        >
          <section class="content-card">
            <div class="card-heading">
              <div>
                <h2>合同文件归档</h2>
                <span>{{
                  canDirectDownload
                    ? "点击文件可在线预览或下载"
                    : isEmployee
                      ? "点击文件可在线预览；下载需提交申请并经总经理审批"
                      : "点击文件可在线预览"
                }}</span>
              </div>
              <el-button
                v-if="isEmployee && displayedContractFiles.length"
                type="success"
                plain
                @click="openDownloadRequest"
              >
                申请下载
              </el-button>
            </div>
            <div v-if="contractFileGroups.length" class="attachment-groups">
              <section
                v-for="group in contractFileGroups"
                :key="group.key"
                class="attachment-group"
              >
                <div class="attachment-group-heading">
                  <h3>{{ group.label }}（{{ group.files.length }}）</h3>
                </div>
                <div v-if="group.key === 'invoice'" class="file-grid">
                  <article
                    v-for="file in group.files"
                    :key="file.id"
                    class="file-card"
                  >
                    <button
                      type="button"
                      class="file-card-preview"
                      @click="openFile(file.id)"
                    >
                      <span class="file-icon"
                        ><el-icon><Document /></el-icon
                      ></span>
                      <span
                        ><strong :title="file.fileName">{{
                          file.fileName
                        }}</strong
                        ><small
                          >{{ fileTypeLabel(file.fileType) }} ·
                          {{ formatContractDateTime(file.createdAt) }}</small
                        ></span
                      >
                    </button>
                    <div class="file-actions">
                      <el-button link :icon="View" @click="openFile(file.id)"
                        >预览</el-button
                      >
                      <el-button
                        v-if="canDirectDownload"
                        link
                        :icon="Download"
                        @click="downloadFile(file.id)"
                        >下载</el-button
                      >
                    </div>
                  </article>
                </div>
                <section
                  v-for="source in group.sources"
                  v-else
                  :key="source.sourceContractId"
                  class="attachment-source-group"
                >
                  <div class="attachment-source-heading">
                    <h4 :title="source.sourceContractName || source.label">
                      {{ source.label }}（{{ source.files.length }}）
                    </h4>
                    <span v-if="source.sourceContractName">
                      {{ source.sourceContractName }}
                    </span>
                  </div>
                  <div class="file-grid">
                    <article
                      v-for="file in source.files"
                      :key="file.id"
                      class="file-card"
                    >
                      <button
                        type="button"
                        class="file-card-preview"
                        @click="openFile(file.id)"
                      >
                        <span class="file-icon"
                          ><el-icon><Document /></el-icon
                        ></span>
                        <span
                          ><strong :title="file.fileName">{{
                            file.fileName
                          }}</strong
                          ><small
                            >{{ fileTypeLabel(file.fileType) }} ·
                            {{ formatContractDateTime(file.createdAt) }}</small
                          ></span
                        >
                      </button>
                      <div class="file-actions">
                        <el-button link :icon="View" @click="openFile(file.id)"
                          >预览</el-button
                        >
                        <el-button
                          v-if="canDirectDownload"
                          link
                          :icon="Download"
                          @click="downloadFile(file.id)"
                          >下载</el-button
                        >
                      </div>
                    </article>
                  </div>
                </section>
              </section>
            </div>
            <el-empty v-else description="暂无合同附件" />
          </section>
        </el-tab-pane>

        <el-tab-pane
          v-if="detail.contract.relationType === 'main'"
          label="财务闭环"
          name="finance"
        >
          <section
            v-if="detail.contract.category === 'asset'"
            class="content-card asset-financial-chain"
            aria-label="资产合同资金与经营核算链条"
          >
            <div class="card-heading">
              <div>
                <h2>资产合同资金与经营核算链条</h2>
                <span>票面与银行事实保持原主体，经营看板统一归集管理口径</span>
              </div>
              <el-tag type="success" effect="plain">
                {{ automaticFundingModeLabel }} · 系统自动判断
              </el-tag>
            </div>
            <div class="asset-chain-track">
              <article>
                <strong>{{ assetFundingSourceSubject }}</strong>
                <small>{{ assetFundingSourceDescription }}</small>
              </article>
              <span v-if="assetSubjectChainMode === 'technology'">
                <b>内部资金划拨</b>
                <small>按工程回单日期计入支出</small>
              </span>
              <article v-if="assetSubjectChainMode === 'technology'">
                <strong>北京羽隶科技有限公司</strong>
                <small>签约主体／发票购买方／付款主体</small>
              </article>
              <span>
                <b>对外付款</b>
                <small>{{ assetExternalPaymentDescription }}</small>
              </span>
              <article>
                <strong>{{ assetContractCounterparty }}</strong>
                <small>合同对方／发票销售方／收款方</small>
              </article>
              <span>
                <b>经营管理归集</b>
                <small>不改写法定票面主体</small>
              </span>
              <article class="accounting-result">
                <strong>工程咨询公司经营看板</strong>
                <small>资产合同支出</small>
              </article>
            </div>
            <p v-if="assetSubjectChainMode === 'technology'">
              工程咨询转给科技公司的款项是工程咨询的实际经营支出，按该回单付款日期入账；科技公司向合同对方的最终付款只用于履约核销，不再重复增加支出。
            </p>
            <p v-else-if="assetSubjectChainMode === 'accounting'">
              本合同由工程咨询公司直接签约和对外付款，不经过集团内部资金划拨；已确认且未冲正的对外付款进入资产合同支出。
            </p>
          </section>
          <ContractFinancialRegistrationPanel
            v-if="canManageFinancials && detail.contract.category"
            ref="financialRegistrationPanelRef"
            class="finance-registration-workspace"
            :contract-id="contractId"
            :category="detail.contract.category"
            :asset-funding-mode="
              assetSubjectChainMode === 'accounting'
                ? 'engineering_direct'
                : 'engineering_to_technology'
            "
            :contract-counterparty="assetContractCounterparty"
            :is-rental-lease="isHouseRentalLease"
            :registration-id="
              financialRegistrationTarget?.registrationId || undefined
            "
            :registered-invoices="financialRegistrationTargetInvoices"
            :registered-bank-documents="
              financialRegistrationTargetBankDocuments
            "
            :registered-external-payments="
              financialRegistrationTargetExternalPayments
            "
            :registration-financial-direction="
              financialRegistrationTargetDirection
            "
            @created="handleFinancialRegistrationCreated"
            @cancel-continuation="cancelFinancialRegistrationContinuation"
          />
          <div class="finance-layout">
            <section class="content-card finance-records">
              <div class="card-heading">
                <h2>发票、回款与付款</h2>
                <span
                  >银行凭证保存后立即计入已回款或已付款，最终金额闭合后确认整笔配对；冲销保留审计痕迹</span
                >
              </div>
              <div
                v-if="financialRegistrationCards.length"
                class="record-columns"
              >
                <article
                  v-for="card in financialRegistrationCards"
                  :key="card.key"
                  class="record-group financial-registration-record"
                  :class="{ reversed: card.status === 'reversed' }"
                >
                  <div class="record-group-heading">
                    <span>
                      <el-icon><Connection /></el-icon>
                      {{
                        card.registrationId
                          ? isAwaitingSettlement(card)
                            ? isInternalFundingMode
                              ? "发票与付款待闭环"
                              : "待回款发票登记"
                            : "发票与回单财务登记"
                          : "历史财务记录"
                      }}
                    </span>
                    <el-tag
                      :type="financeRecordStatusTagType(card.status)"
                      size="small"
                      >{{
                        isAwaitingSettlement(card)
                          ? isInternalFundingMode
                            ? financialCardInternalPendingLabel(card)
                            : "待补回单"
                          : financeRecordStatusLabel(card.status)
                      }}</el-tag
                    >
                  </div>
                  <div class="registration-record-documents">
                    <div
                      v-for="document in card.documents"
                      :key="document.record.id"
                      class="registration-record-document"
                    >
                      <span class="document-kind">{{ document.label }}</span>
                      <span class="document-summary">
                        <strong>{{
                          formatContractMoney(document.record.amount)
                        }}</strong>
                        <small>
                          {{ financeRecordOccurredAt(document.record) }} ·
                          {{ financeRecordDescription(document.record) }}
                        </small>
                      </span>
                      <el-button
                        v-if="document.record.fileId"
                        link
                        type="primary"
                        @click="openFile(document.record.fileId)"
                        >在线预览</el-button
                      >
                    </div>
                  </div>
                  <div
                    v-if="card.registrationId"
                    class="registration-balance-summary"
                  >
                    <span
                      >发票合计
                      <strong>{{
                        formatContractMoney(financialCardInvoiceAmount(card))
                      }}</strong></span
                    >
                    <span
                      >累计{{
                        isInternalFundingMode
                          ? "工程咨询划拨"
                          : financialCardSettlementAction(card)
                      }}
                      <strong>{{
                        formatContractMoney(financialCardSettlementAmount(card))
                      }}</strong></span
                    >
                    <span v-if="isInternalFundingMode"
                      >科技已对外付款
                      <strong>{{
                        formatContractMoney(financialCardExternalAmount(card))
                      }}</strong></span
                    >
                    <span
                      v-if="
                        isInternalFundingMode &&
                        financialCardExternalRemainingAmount(card) > 0
                      "
                      class="is-pending"
                      >待对外付款
                      <strong>{{
                        formatContractMoney(
                          financialCardExternalRemainingAmount(card),
                        )
                      }}</strong></span
                    >
                    <span
                      v-if="
                        isInternalFundingMode &&
                        financialCardInvoiceRemainingAmount(card) > 0
                      "
                      class="is-pending"
                      >待补发票
                      <strong>{{
                        formatContractMoney(
                          financialCardInvoiceRemainingAmount(card),
                        )
                      }}</strong></span
                    >
                    <span
                      v-if="
                        !isInternalFundingMode && isAwaitingSettlement(card)
                      "
                      class="is-pending"
                      >待{{ financialCardSettlementAction(card) }}
                      <strong>{{
                        formatContractMoney(financialCardRemainingAmount(card))
                      }}</strong></span
                    >
                  </div>
                  <div
                    v-if="card.matches.length"
                    class="registration-match-list"
                  >
                    <strong>发票与回单对应关系</strong>
                    <div
                      v-for="(match, index) in card.matches"
                      :key="`${match.invoiceRecordId}:${match.settlementRecordId}`"
                      class="registration-match-row"
                    >
                      <span>{{ index + 1 }}</span>
                      <span>{{ financialMatchInvoiceLabel(card, match) }}</span>
                      <span class="match-arrow">对应</span>
                      <span>{{
                        financialMatchSettlementLabel(card, match)
                      }}</span>
                      <strong>{{
                        formatContractMoney(match.allocatedAmount)
                      }}</strong>
                    </div>
                  </div>
                  <div
                    v-if="canEdit"
                    class="record-actions registration-record-actions"
                  >
                    <el-button
                      v-if="
                        card.status === 'draft' && isAwaitingSettlement(card)
                      "
                      link
                      type="primary"
                      :disabled="actionLoading"
                      @click="continueFinancialRegistration(card)"
                      >补充发票／回单</el-button
                    >
                    <el-button
                      v-if="
                        card.status === 'draft' && canConfirmFinancialCard(card)
                      "
                      link
                      type="success"
                      :disabled="actionLoading"
                      @click="confirmFinancialCard(card)"
                      >确认整笔登记</el-button
                    >
                    <el-tag
                      v-else-if="card.status === 'draft'"
                      :type="isAwaitingSettlement(card) ? 'warning' : 'danger'"
                      size="small"
                      >{{
                        isAwaitingSettlement(card)
                          ? `尚待${financialCardSettlementAction(card)}，暂不可确认`
                          : "金额或验证链未闭合，不可确认"
                      }}</el-tag
                    >
                    <el-button
                      v-if="
                        card.status === 'draft' && !hasConfirmedSettlement(card)
                      "
                      link
                      type="danger"
                      :disabled="actionLoading"
                      @click="deleteFinancialCard(card)"
                      >删除整笔登记</el-button
                    >
                    <el-button
                      v-if="
                        card.status === 'confirmed' ||
                        (card.status === 'draft' &&
                          hasConfirmedSettlement(card))
                      "
                      link
                      type="danger"
                      :disabled="actionLoading"
                      @click="reverseFinancialCard(card)"
                      >{{
                        card.status === "draft"
                          ? `冲销已${financialCardSettlementAction(card)}登记`
                          : "冲销整笔登记"
                      }}</el-button
                    >
                  </div>
                </article>
              </div>
              <el-empty
                v-else
                description="暂无财务登记记录"
                :image-size="72"
              />
            </section>

            <section class="content-card accounting-card">
              <div class="card-heading">
                <h2>合同核算</h2>
                <span>仅展示后端结果</span>
              </div>
              <template v-if="detail.accounting">
                <div
                  v-if="isAssetContract && !isRentalLease"
                  class="accounting-summary"
                >
                  <div>
                    <span>本月支出</span
                    ><strong>{{
                      formatContractMoney(detail.accounting.monthExpense)
                    }}</strong>
                  </div>
                  <div>
                    <span>{{
                      isInternalFundingMode ? "工程已支出" : "已付款"
                    }}</span
                    ><strong>{{
                      formatContractMoney(detail.contract.paidAmount)
                    }}</strong>
                  </div>
                  <div>
                    <span>{{
                      isInternalFundingMode ? "待工程划拨" : "未付款"
                    }}</span
                    ><strong>{{
                      formatContractMoney(detail.accounting.unpaidAmount, "—")
                    }}</strong>
                  </div>
                </div>
                <div
                  v-if="isVehicleRentalLease"
                  class="accounting-summary vehicle-rental-accounting-summary"
                >
                  <div>
                    <span>合同总金额</span>
                    <strong>{{
                      formatContractMoney(
                        detail.contract.currentEffectiveAmount ??
                          detail.contract.currentAmount ??
                          detail.contract.amount,
                      )
                    }}</strong>
                  </div>
                </div>
                <div v-if="isHouseRentalLease" class="rental-cost-groups">
                  <section class="rental-cost-group contract-scope">
                    <header>
                      <span>合同内核算</span>
                      <strong>{{
                        formatContractMoney(
                          detail.rentalInvoiceSummary.contractAccountingExpense,
                        )
                      }}</strong>
                    </header>
                    <div>
                      <span>租金</span>
                      <strong>{{
                        formatContractMoney(detail.rentalInvoiceSummary.rent)
                      }}</strong>
                    </div>
                    <div>
                      <span>物业管理费</span>
                      <strong>{{
                        formatContractMoney(
                          detail.rentalInvoiceSummary.propertyManagement,
                        )
                      }}</strong>
                    </div>
                  </section>
                  <section class="rental-cost-group outside-scope">
                    <header>
                      <span>合同外成本</span>
                      <strong>{{
                        formatContractMoney(
                          detail.rentalInvoiceSummary.outsideContractCost,
                        )
                      }}</strong>
                    </header>
                    <div>
                      <span>电费</span>
                      <strong>{{
                        formatContractMoney(
                          detail.rentalInvoiceSummary.electricity,
                        )
                      }}</strong>
                    </div>
                    <div>
                      <span>系统维护费</span>
                      <strong>{{
                        formatContractMoney(
                          detail.rentalInvoiceSummary.systemMaintenance,
                        )
                      }}</strong>
                    </div>
                  </section>
                </div>
                <div v-if="!isAssetContract" class="accounting-summary">
                  <div>
                    <span>本月收入</span
                    ><strong>{{
                      formatContractMoney(detail.accounting.monthIncome)
                    }}</strong>
                  </div>
                  <div>
                    <span>本年累计</span
                    ><strong>{{
                      formatContractMoney(detail.accounting.yearIncome)
                    }}</strong>
                  </div>
                  <div>
                    <span>未回款</span
                    ><strong>{{
                      formatContractMoney(detail.accounting.unreceivedAmount)
                    }}</strong>
                  </div>
                </div>
                <div
                  v-if="!isRentalLease && relatedAccountingLines.length"
                  class="accounting-lines"
                >
                  <div
                    v-for="line in relatedAccountingLines"
                    :key="line.key"
                    :class="{ emphasized: line.emphasized }"
                  >
                    <span
                      >{{ line.label
                      }}<small
                        v-if="line.rate !== null && line.rate !== undefined"
                        >{{ line.rate }}%</small
                      ></span
                    >
                    <strong>{{ formatContractMoney(line.amount) }}</strong>
                  </div>
                </div>
                <el-empty
                  v-else-if="isAssetContract && !isRentalLease"
                  description="暂无本合同相关支出记录"
                  :image-size="52"
                />
                <el-alert
                  v-if="
                    !isRentalLease &&
                    detail.accounting.note &&
                    (!isAssetContract || relatedAccountingLines.length)
                  "
                  type="info"
                  :closable="false"
                  :title="detail.accounting.note"
                />
              </template>
              <el-empty v-else description="暂无核算结果" />
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="sealWorkspaceVisible" label="盖章核验" name="seal">
          <section class="content-card seal-workspace-card">
            <div class="seal-workspace-heading">
              <div>
                <span class="seal-workspace-kicker">正式合同归档</span>
                <h2>盖章合同核验与归档</h2>
                <p>
                  上传盖章版后，系统将逐项核对草拟审批版与盖章版的甲乙双方名称。
                </p>
              </div>
              <el-tag
                v-if="sealVerification"
                :type="sealStatusTagType"
                effect="light"
                round
              >
                {{ sealStatusTitle }}
              </el-tag>
            </div>

            <el-steps
              class="seal-workflow-steps"
              :active="sealWorkflowStep"
              finish-status="success"
              align-center
            >
              <el-step title="上传盖章版" />
              <el-step title="自动识别" />
              <el-step title="甲乙方核对" />
              <el-step title="归档生效" />
            </el-steps>

            <div v-if="sealLoading" v-loading="true" class="seal-loading">
              正在读取盖章合同核验结果
            </div>

            <template v-else-if="!sealVerification || sealReplacing">
              <div class="seal-upload-stage">
                <el-alert
                  type="info"
                  :closable="false"
                  show-icon
                  title="上传后由系统自动识别并核验，不会直接让合同生效"
                  description="甲方、乙方或合同金额无法可靠识别时，只能重新识别或重新上传；合同签订日期缺失时采用上传日期兜底。"
                  class="seal-workspace-alert"
                />
                <el-form label-position="top">
                  <el-form-item label="盖章版合同" required>
                    <div
                      class="seal-upload-box"
                      :class="{
                        'is-selected': sealedForm.file,
                        'is-uploading': sealUploading,
                      }"
                    >
                      <el-upload
                        v-if="!sealedForm.file"
                        ref="sealedUploadRef"
                        class="seal-upload-control"
                        drag
                        :auto-upload="false"
                        :show-file-list="false"
                        :disabled="sealUploading"
                        :limit="1"
                        :on-change="handleSealedFile"
                        accept=".pdf,.jpg,.jpeg,.png"
                      >
                        <div class="seal-upload-empty">
                          <span
                            class="seal-upload-empty-icon"
                            aria-hidden="true"
                          >
                            <el-icon><UploadFilled /></el-icon>
                          </span>
                          <strong>拖拽或点击选择盖章合同</strong>
                          <span>选择后可先在线预览，再开始上传核验</span>
                        </div>
                      </el-upload>

                      <article
                        v-else
                        class="seal-selected-file-card"
                        role="group"
                        aria-label="已选择的盖章合同"
                      >
                        <span
                          class="seal-selected-file-icon"
                          aria-hidden="true"
                        >
                          <el-icon><Document /></el-icon>
                          <small>{{ sealedFileExtension }}</small>
                        </span>
                        <div class="seal-selected-file-info">
                          <div class="seal-selected-file-title">
                            <strong :title="sealedForm.file.name">{{
                              sealedForm.file.name
                            }}</strong>
                            <el-tag size="small" type="success" effect="light"
                              >待上传</el-tag
                            >
                          </div>
                          <span>
                            {{ sealedFileTypeLabel }} ·
                            {{ formatUploadFileSize(sealedForm.file.size) }}
                          </span>
                          <small>文件已保留在当前页面，尚未提交到系统</small>
                        </div>
                        <div
                          class="seal-selected-file-actions"
                          aria-label="盖章合同文件操作"
                        >
                          <el-button
                            type="primary"
                            plain
                            :icon="View"
                            :disabled="sealUploading"
                            @click="openSealedLocalPreview"
                            >在线预览</el-button
                          >
                          <el-button
                            type="danger"
                            plain
                            :icon="Delete"
                            :disabled="sealUploading"
                            aria-label="移除已选择的盖章合同"
                            @click="clearSealedFile"
                            >移除</el-button
                          >
                        </div>
                      </article>
                    </div>
                    <div class="seal-upload-tip">
                      支持 PDF、JPG、JPEG、PNG，单个文件不超过 30MB
                    </div>
                  </el-form-item>
                </el-form>
                <el-alert
                  v-if="sealUploading"
                  type="info"
                  show-icon
                  :closable="false"
                  title="正在上传并识别，请勿关闭页面"
                  description="系统将在核验完成后显示甲乙双方名称、合同金额和签订日期的对照结果。"
                  class="seal-upload-status"
                />
              </div>
            </template>

            <template v-else>
              <el-alert
                :type="sealStatusAlertType"
                show-icon
                :closable="false"
                :title="sealStatusTitle"
                :description="sealStatusDescription"
                class="seal-workspace-alert"
              />

              <div class="seal-file-summary">
                <span
                  ><el-icon><Document /></el-icon
                  >{{ sealVerification.fileName || "盖章合同" }}</span
                >
                <el-button
                  tag="a"
                  link
                  :icon="View"
                  :href="getContractFileUrl(sealVerification.fileId)"
                  target="_blank"
                  rel="noopener noreferrer"
                  >预览原件</el-button
                >
              </div>

              <div class="seal-party-section">
                <div class="seal-section-heading">
                  <div>
                    <h3>甲乙双方名称核对</h3>
                    <p>
                      分别比较审批版与盖章版；任一方不一致都会明确提示并阻止直接归档。
                    </p>
                  </div>
                </div>
                <div class="seal-party-grid">
                  <article
                    v-for="party in sealPartyComparisons"
                    :key="party.field"
                    class="seal-party-card"
                    :class="`is-${party.state}`"
                  >
                    <div class="seal-party-card-heading">
                      <strong>{{ sealFieldLabel(party.field) }}</strong>
                      <el-tag
                        :type="sealPartyStateTagType(party.state)"
                        effect="light"
                        round
                      >
                        {{ sealPartyStateLabel(party.state) }}
                      </el-tag>
                    </div>
                    <dl>
                      <div>
                        <dt>草拟审批版</dt>
                        <dd>{{ party.approvedValue || "—" }}</dd>
                      </div>
                      <div>
                        <dt>盖章版识别</dt>
                        <dd>{{ party.sealedValue || "—" }}</dd>
                      </div>
                    </dl>
                    <p v-if="party.state === 'missing'">
                      未识别到该方名称，暂时无法判断是否一致。
                    </p>
                    <p v-else-if="party.state === 'mismatch'">
                      该方名称与草拟审批版不一致，不能直接归档生效。
                    </p>
                    <p v-else-if="party.requiresRecognitionRetry">
                      识别内容与草拟审批版一致；自动核验依据不足，暂不能归档。
                    </p>
                    <p v-else>该方名称与草拟审批版一致，已通过主体核对。</p>
                  </article>
                </div>
              </div>

              <div
                v-if="
                  detail.contract.leaseStartDate || detail.contract.leaseEndDate
                "
                class="seal-lease-period"
              >
                <strong>租赁期限</strong>
                <span>
                  {{ formatContractDate(detail.contract.leaseStartDate) }} 至
                  {{ formatContractDate(detail.contract.leaseEndDate) }}（共
                  {{ detail.contract.leaseTermMonths || 12 }} 个月）
                </span>
                <small>下表核验的是合同签订日期，不是租赁起始日期。</small>
              </div>

              <div class="seal-field-list">
                <div class="seal-field-header">
                  <span>字段</span><span>审批版本</span><span>盖章版识别值</span
                  ><span>核验状态</span>
                </div>
                <div
                  v-for="field in sealSecondaryFields"
                  :key="field.field"
                  class="seal-field-row"
                  :class="{
                    mismatch:
                      field.field !== 'contract_date' &&
                      sealFieldComparisonState(field) === 'mismatch',
                    missing:
                      field.field !== 'contract_date' &&
                      sealFieldComparisonState(field) === 'missing',
                  }"
                >
                  <span>
                    <strong>{{ sealFieldLabel(field.field) }}</strong>
                    <el-tag
                      v-if="field.field === 'contract_date'"
                      size="small"
                      :type="field.finalValue ? 'success' : 'info'"
                      >{{ sealContractDateStateLabel(field) }}</el-tag
                    >
                    <el-tag
                      v-else
                      size="small"
                      :type="sealFieldComparisonTagType(field)"
                      >{{ sealFieldComparisonLabel(field) }}</el-tag
                    >
                  </span>
                  <span>{{ field.approvedValue || "—" }}</span>
                  <span>{{ field.finalValue || "—" }}</span>
                  <span>{{ sealVerificationQualityText(field) }}</span>
                </div>
              </div>

              <div
                v-if="sealVerification.mismatches.length"
                class="seal-mismatch-list"
              >
                <strong>发现关键差异</strong>
                <p
                  v-for="mismatch in sealVerification.mismatches"
                  :key="mismatch.field"
                >
                  {{ mismatch.label }}：审批版“{{ mismatch.approvedValue }}” →
                  盖章版“{{ mismatch.sealedValue }}”
                </p>
              </div>

              <el-form
                v-if="
                  sealVerification.status === 'difference_explanation_required'
                "
                label-position="top"
                class="seal-difference-form"
              >
                <el-form-item label="差异说明" required>
                  <el-input
                    v-model="sealDifferenceExplanation"
                    type="textarea"
                    :rows="3"
                    maxlength="500"
                    show-word-limit
                    :placeholder="`请说明盖章版为何与审批版本不同，提交${approvalTargetLabel}复审`"
                  />
                </el-form-item>
              </el-form>
            </template>

            <div v-if="!sealLoading" class="seal-workspace-actions">
              <el-button
                v-if="
                  sealVerification &&
                  !sealReplacing &&
                  sealVerification.status !== 'archived' &&
                  sealVerification.status !== 'difference_approving'
                "
                @click="startReplacingSealedFile"
                >重新上传文件</el-button
              >
              <el-button v-if="sealReplacing" @click="cancelReplacingSealedFile"
                >返回核验结果</el-button
              >
              <el-button
                v-if="!sealVerification || sealReplacing"
                type="primary"
                :loading="sealUploading"
                @click="submitSealedContract"
                >上传并开始核验</el-button
              >
              <el-button
                v-if="
                  !sealReplacing &&
                  sealVerification &&
                  [
                    'infrastructure_failed',
                    'review_required',
                    'ready_to_archive',
                  ].includes(sealVerification.status)
                "
                type="warning"
                :loading="actionLoading"
                @click="retrySealedVerification"
                >重新识别</el-button
              >
              <el-button
                v-if="
                  !sealReplacing &&
                  sealVerification?.status === 'difference_explanation_required'
                "
                type="warning"
                :loading="actionLoading"
                @click="submitSealDifferenceApproval"
                >提交差异复审</el-button
              >
              <el-button
                v-if="sealCanArchive && !sealArchiveConfirming"
                type="success"
                @click="beginSealArchiveConfirmation"
                >准备归档生效</el-button
              >
            </div>

            <div
              v-if="sealCanArchive && sealArchiveConfirming"
              class="seal-archive-confirmation"
            >
              <div>
                <strong>确认归档盖章合同？</strong>
                <p>归档后合同将正式生效，核验结果和盖章文件会进入审计记录。</p>
              </div>
              <div>
                <el-button @click="cancelSealArchiveConfirmation"
                  >取消</el-button
                >
                <el-button
                  type="success"
                  :loading="actionLoading"
                  @click="archiveSealedVerification"
                  >确认归档生效</el-button
                >
              </div>
            </div>
          </section>
        </el-tab-pane>
      </el-tabs>
    </template>

    <ContractReadOnlyPreview
      :visible="readonlyPreviewVisible"
      :url="readonlyPreviewUrl"
      :file-name="readonlyPreviewFileName"
      :mime-type="readonlyPreviewMimeType"
      :can-download="canDirectDownload"
      @close="closeReadonlyPreview"
      @download="downloadReadonlyPreview"
    />

    <div class="sr-live" aria-live="polite">{{ liveStatus }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { UploadFile, UploadInstance } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowLeft,
  CircleCheck,
  Connection,
  DataAnalysis,
  Delete,
  Document,
  Download,
  EditPen,
  Location,
  OfficeBuilding,
  Promotion,
  Refresh,
  Stamp,
  TrendCharts,
  UploadFilled,
  View,
  WarningFilled,
} from "@element-plus/icons-vue";
import ContractMetricCard from "@/components/contracts/ContractMetricCard.vue";
import ContractAuxiliaryPackageManager from "@/components/contracts/ContractAuxiliaryPackageManager.vue";
import ContractStatusTag from "@/components/contracts/ContractStatusTag.vue";
import ContractApprovalWorkspace from "@/components/contracts/ContractApprovalWorkspace.vue";
import ContractFinancialRegistrationPanel from "@/components/contracts/ContractFinancialRegistrationPanel.vue";
import ContractReadOnlyPreview from "@/components/contracts/ContractReadOnlyPreview.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractApprovalAction,
  ContractDetailResponse,
  ContractFinanceRecord,
  ContractFinanceRecordStatus,
  ContractFinancialRegistrationMatch,
  ContractRelation,
  ContractSealVerification,
  ContractSealVerificationField,
  ContractSealVerificationFieldKey,
  ContractSealWorkflowResponse,
  ContractStatus,
} from "@/types/contract";
import {
  archiveSealedContractVerification,
  confirmCompletedRentalExit,
  confirmContractFinancialRegistration,
  confirmContractRecord,
  deleteContractFinancialRegistration,
  deleteContractRecordDraft,
  deleteContractDraft,
  getContract,
  getContractErrorCode,
  getContractErrorMessage,
  getContractFileUrl,
  getLatestSealedContractVerification,
  reapproveSealedContractDifference,
  retrySealedContractVerification,
  reverseContractFinancialRegistration,
  reverseContractRecord,
  submitContract,
  updateContractAuxiliaryMaterialSetting,
  uploadSealedContract,
  withdrawContractApproval,
} from "@/utils/contractApi";
import {
  CONTRACT_CATEGORY_LABELS,
  CONTRACT_RELATION_LABELS,
  formatContractDate,
  formatContractDateTime,
  formatContractMoney,
  moneyToNumber,
  normalizeContractPercent,
  shouldDisplayContractCurrentAmount,
} from "@/utils/contractPresentation";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const contractId = computed(() => String(route.params.id || ""));
const adminRoles = new Set(["super_admin", "chairman", "admin"]);
const contractLedgerRoles = new Set([
  "super_admin",
  "chairman",
  "admin",
  "general_manager",
  "boss",
  "user",
]);
const contractApproverRoles = new Set(["general_manager"]);
const canEdit = computed(() => adminRoles.has(authStore.user?.role || ""));
const isEmployee = computed(() => authStore.user?.role === "user");
const canDirectDownload = computed(
  () =>
    adminRoles.has(authStore.user?.role || "") ||
    authStore.user?.role === "general_manager",
);
const canReadContractLedger = computed(() =>
  contractLedgerRoles.has(authStore.user?.role || ""),
);
const canApprove = computed(
  () =>
    Boolean(authStore.user?.id) &&
    contractApproverRoles.has(authStore.user?.role || "") &&
    detail.value?.contract.approvalTargetId === authStore.user?.id,
);
const approvalUsesProjectOwner = computed(() => {
  return false;
});
const approvalTargetLabel = computed(() =>
  approvalUsesProjectOwner.value ? "项目负责人" : "总经理",
);
const approvalSubmitLabel = computed(
  () => `提交${approvalTargetLabel.value}审批`,
);
const detailReturnsToApprovalCenter = computed(
  () =>
    route.query.from === "contract-approvals" || !canReadContractLedger.value,
);
const detailHasPreviousPage = computed(() =>
  Boolean(routeQueryText(route.query.backContractId)),
);
const detailApprovalSourceTab = computed(() =>
  routeQueryText(route.query.fromTab) === "processed" ? "processed" : "pending",
);
const detailBackPath = computed(() =>
  detailReturnsToApprovalCenter.value
    ? `/contract-approvals?tab=${detailApprovalSourceTab.value}`
    : "/contracts",
);
const detailBackLabel = computed(() =>
  detailHasPreviousPage.value
    ? "返回上一个页面"
    : detailReturnsToApprovalCenter.value
      ? "返回审批中心"
      : "返回台账",
);

function handleDetailBack() {
  if (detailHasPreviousPage.value) {
    router.back();
    return;
  }
  void router.push(detailBackPath.value);
}

function openRelatedContract(relatedContractId: string) {
  if (!relatedContractId || relatedContractId === contractId.value) return;
  void router.push({
    path: `/contracts/${relatedContractId}`,
    query: { backContractId: contractId.value },
  });
}
const canManageFinancials = computed(
  () =>
    canEdit.value &&
    Boolean(
      detail.value &&
      detail.value.contract.relationType === "main" &&
      ["effective", "executing"].includes(detail.value.contract.status),
    ),
);
const canUploadSupplement = computed(
  () =>
    canEdit.value &&
    detail.value?.contract.relationType === "main" &&
    !detail.value.contract.renewalContractId &&
    ["effective", "executing", "completed"].includes(
      detail.value.contract.status,
    ),
);
const canUploadTermination = computed(
  () =>
    canEdit.value &&
    Boolean(detail.value) &&
    detail.value?.contract.relationType !== "termination" &&
    ["effective", "executing", "completed"].includes(
      detail.value?.contract.status || "",
    ),
);
const isSupplementContract = computed(
  () => detail.value?.contract.relationType === "supplement",
);
const isTerminationContract = computed(
  () => detail.value?.contract.relationType === "termination",
);
const orderedRelations = computed(() =>
  [...(detail.value?.relations || [])].sort(compareContractRelations),
);
const supplementChangeTypeLabel = computed(() => {
  const changeType = detail.value?.contract.supplementChangeType;
  return {
    payment_terms_only: "仅变更付款方式",
    amount_adjustment: "合同金额变更",
    amount_and_payment: "金额及付款方式变更",
    legacy_unresolved: "历史补充协议",
  }[changeType || "legacy_unresolved"];
});
const supplementAmountDelta = computed(() =>
  detail.value?.contract.supplementChangeType === "payment_terms_only"
    ? 0
    : moneyToNumber(detail.value?.contract.amount),
);
const isAssetContract = computed(
  () => detail.value?.contract.category === "asset",
);
const isRentalLifecycleContract = computed(
  () =>
    isAssetContract.value &&
    ["house_rental", "vehicle_rental", "parking_space"].includes(
      detail.value?.contract.declaredSubtype || "",
    ),
);
const isRentalLease = computed(
  () =>
    isAssetContract.value &&
    ["house_rental", "vehicle_rental"].includes(
      detail.value?.contract.declaredSubtype || "",
    ),
);
const canManageRentalLifecycle = computed(
  () =>
    canEdit.value &&
    isRentalLifecycleContract.value &&
    detail.value?.contract.relationType === "main" &&
    Boolean(detail.value.contract.leaseEndDate) &&
    !detail.value.contract.renewalContractId &&
    ["effective", "executing", "completed"].includes(
      detail.value.contract.status,
    ),
);
const rentalExitLabel = computed(() =>
  detail.value?.contract.declaredSubtype === "vehicle_rental" ? "还车" : "退租",
);
const isVehicleRentalLease = computed(
  () => detail.value?.contract.declaredSubtype === "vehicle_rental",
);
const isHouseRentalLease = computed(
  () => detail.value?.contract.declaredSubtype === "house_rental",
);
const relatedAccountingLines = computed(() => {
  const lines = detail.value?.accounting?.lines || [];
  return isAssetContract.value
    ? lines.filter((line) => Math.abs(moneyToNumber(line.amount)) > 0)
    : lines;
});
const isInternalFundingMode = computed(
  () => detail.value?.contract.assetFundingMode === "engineering_to_technology",
);
const overSettlementAmount = computed(() =>
  moneyToNumber(detail.value?.accounting?.overAmount),
);
const hasPendingSupplementAmountChange = computed(() => {
  const contract = detail.value?.contract;
  if (
    contract?.relationType === "supplement" &&
    ["approving", "pending_seal"].includes(contract.status)
  ) {
    return (
      moneyToNumber(contract.amountAfterChange) !==
      moneyToNumber(contract.amountBeforeChange)
    );
  }
  return Boolean(
    contract?.relationType === "main" &&
    Number(contract.pendingSupplementCount || 0) > 0 &&
    moneyToNumber(contract.projectedAmount) !==
      moneyToNumber(contract.currentAmount),
  );
});
const pendingAmountBeforeChange = computed(() => {
  const contract = detail.value?.contract;
  return contract?.relationType === "supplement"
    ? contract.amountBeforeChange
    : contract?.currentAmount;
});
const pendingAmountAdjustment = computed(() => {
  const contract = detail.value?.contract;
  return contract?.relationType === "supplement"
    ? supplementAmountDelta.value
    : moneyToNumber(contract?.projectedAmount) -
        moneyToNumber(contract?.currentAmount);
});
const pendingSupplementDisplayCount = computed(() =>
  detail.value?.contract.relationType === "supplement"
    ? 1
    : Number(detail.value?.contract.pendingSupplementCount || 0),
);
const displayedCurrentAmount = computed(() => {
  if (!detail.value) return 0;
  if (hasPendingSupplementAmountChange.value) {
    return detail.value.contract.relationType === "supplement"
      ? (detail.value.contract.amountAfterChange ?? 0)
      : (detail.value.contract.projectedAmount ?? 0);
  }
  if (detail.value.contract.relationType === "supplement") {
    return (
      detail.value.contract.currentEffectiveAmount ??
      detail.value.contract.amountAfterChange ??
      detail.value.contract.amountBeforeChange ??
      detail.value.contract.originalContractAmount ??
      detail.value.contract.amount
    );
  }
  const { currentAmount, status, relationType, pendingAction, amount } =
    detail.value.contract;
  return shouldDisplayContractCurrentAmount(
    currentAmount,
    status,
    relationType,
    pendingAction,
  )
    ? currentAmount!
    : amount;
});

function relationSupplementAmountDelta(
  relation: ContractDetailResponse["relations"][number],
): string | number {
  return relation.supplementChangeType === "payment_terms_only"
    ? 0
    : (relation.amount ?? 0);
}

function relationTerminationTargetName(relation: ContractRelation): string {
  if (!relation.terminationTargetContractId) return "未识别";
  return (
    detail.value?.relations.find(
      (item) => item.contractId === relation.terminationTargetContractId,
    )?.contractName || "目标合同"
  );
}

function compareContractRelations(
  left: ContractRelation,
  right: ContractRelation,
): number {
  if (left.relationType === "main" || right.relationType === "main") {
    if (left.relationType === right.relationType) return 0;
    return left.relationType === "main" ? -1 : 1;
  }
  const leftEffective = String(left.effectiveAt || "");
  const rightEffective = String(right.effectiveAt || "");
  if (Boolean(leftEffective) !== Boolean(rightEffective)) {
    return leftEffective ? -1 : 1;
  }
  if (leftEffective && rightEffective && leftEffective !== rightEffective) {
    return leftEffective.localeCompare(rightEffective);
  }
  const leftSequence = Number.isFinite(Number(left.supplementSequence))
    ? Number(left.supplementSequence)
    : Number.MAX_SAFE_INTEGER;
  const rightSequence = Number.isFinite(Number(right.supplementSequence))
    ? Number(right.supplementSequence)
    : Number.MAX_SAFE_INTEGER;
  return (
    leftSequence - rightSequence ||
    left.contractId.localeCompare(right.contractId)
  );
}

function openSupplementUpload() {
  if (!canUploadSupplement.value || !detail.value) return;
  void router.push({
    path: "/contracts/create",
    query: {
      parentContractId: detail.value.contract.id,
      quickSupplement: "1",
    },
  });
}

function openRentalRenewal() {
  if (!canManageRentalLifecycle.value || !detail.value) return;
  void router.push({
    path: "/contracts/create",
    query: {
      rentalRenewal: "1",
      sourceContractId: detail.value.contract.id,
    },
  });
}

async function openRentalExit() {
  if (
    !canManageRentalLifecycle.value ||
    !detail.value ||
    rentalExitConfirming.value
  ) {
    return;
  }
  const currentContract = detail.value.contract;
  if (normalizedProgress.value < 100) {
    openRentalExitAgreementUpload(currentContract);
    return;
  }
  const operationLabel = rentalExitLabel.value;
  try {
    await ElMessageBox.confirm(
      `当前合同履行进度为 ${normalizedProgress.value}%，确认${operationLabel}后将直接结束合同，不需要上传解除协议。是否继续？`,
      `确认${operationLabel}`,
      {
        type: "warning",
        confirmButtonText: `确认${operationLabel}`,
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  rentalExitConfirming.value = true;
  try {
    await confirmCompletedRentalExit(
      currentContract.id,
      currentContract.version,
    );
    ElMessage.success(`${operationLabel}已确认，合同已结束`);
    await loadDetail();
  } catch (error) {
    if (
      getContractErrorCode(error) === "CONTRACT_RENTAL_EXIT_AGREEMENT_REQUIRED"
    ) {
      ElMessage.warning(
        "服务端复核确认合同尚未全部履行，请继续上传解除协议办理",
      );
      openRentalExitAgreementUpload(currentContract);
      return;
    }
    ElMessage.error(
      getContractErrorMessage(error, `${operationLabel}确认失败，请稍后重试`),
    );
  } finally {
    rentalExitConfirming.value = false;
  }
}

function openRentalExitAgreementUpload(
  contract: ContractDetailResponse["contract"],
) {
  void router.push({
    path: "/contracts/create",
    query: {
      quickTermination: "1",
      targetContractId: contract.id,
      rentalAction:
        contract.declaredSubtype === "vehicle_rental"
          ? "vehicle_return"
          : "move_out",
    },
  });
}

function openTerminationUpload() {
  if (!canUploadTermination.value || !detail.value) return;
  void router.push({
    path: "/contracts/create",
    query: {
      quickTermination: "1",
      targetContractId: detail.value.contract.id,
    },
  });
}
const isTerminationApproval = computed(
  () => detail.value?.contract.pendingAction === "termination",
);
const isSealDifferenceApproval = computed(
  () =>
    detail.value?.contract.status === "approving" &&
    detail.value.contract.pendingAction === "seal" &&
    detail.value.contract.previousStatus === "pending_seal",
);
const detail = ref<ContractDetailResponse | null>(null);
const leaseMonthlyFixedFeeTotal = computed(() => {
  const contract = detail.value?.contract;
  return (
    Number(contract?.leaseMonthlyRent || 0) +
    Number(contract?.leaseMonthlyPropertyManagementFee || 0)
  );
});
const leaseCalculatedContractTotal = computed(
  () =>
    leaseMonthlyFixedFeeTotal.value *
    Number(detail.value?.contract.leaseTermMonths || 12),
);
const GROUP_ACCOUNTING_SUBJECT = "北京羽隶工程咨询有限公司";
const MANAGED_CONTRACT_SUBJECTS = new Set([
  GROUP_ACCOUNTING_SUBJECT,
  "北京羽隶科技有限公司",
]);
const assetSigningSubject = computed<string | null>(() => {
  const contract = detail.value?.contract;
  if (!contract) return null;
  const matched = [contract.partyA, contract.partyB]
    .map((party) => String(party || "").trim())
    .filter((party) => MANAGED_CONTRACT_SUBJECTS.has(party));
  return matched.length === 1 ? matched[0]! : null;
});
const assetSubjectChainMode = computed<"technology" | "accounting">(() =>
  [detail.value?.contract.partyA, detail.value?.contract.partyB].some(
    (party) =>
      String(party || "")
        .normalize("NFKC")
        .replace(/\s+/gu, "") === GROUP_ACCOUNTING_SUBJECT,
  )
    ? "accounting"
    : "technology",
);
const automaticFundingModeLabel = computed(() =>
  assetSubjectChainMode.value === "accounting"
    ? "工程咨询直接付款"
    : "工程咨询划拨科技支付",
);
const assetFundingSourceSubject = computed(() => {
  return GROUP_ACCOUNTING_SUBJECT;
});
const assetFundingSourceDescription = computed(() => {
  return {
    technology: "实际经营支出主体／资金来源",
    accounting: "签约主体／直接付款主体",
  }[assetSubjectChainMode.value];
});
const assetExternalPaymentDescription = computed(() =>
  assetSubjectChainMode.value === "technology"
    ? "只做履约核销，不重复计支出"
    : "已确认且未冲正才计支出",
);
const assetContractCounterparty = computed(() => {
  const contract = detail.value?.contract;
  if (!contract || !assetSigningSubject.value) return "合同对方待核对";
  return (
    [contract.partyA, contract.partyB].find(
      (party) =>
        String(party || "").trim() &&
        String(party || "").trim() !== assetSigningSubject.value,
    ) || "合同对方／供应商"
  );
});
type CentralizedContractFile = ContractDetailResponse["files"][number];
function sourceContractId(file: CentralizedContractFile): string {
  return (
    file.sourceContractId || file.contractId || detail.value?.contract.id || ""
  );
}
function sourceContractRelation(file: CentralizedContractFile) {
  const ownerId = sourceContractId(file);
  return detail.value?.relations.find(
    (relation) => relation.contractId === ownerId,
  );
}
const displayedContractFiles = computed(() => {
  const files = (detail.value?.files || []) as CentralizedContractFile[];
  const sealApplicationsByOwner = new Map<string, CentralizedContractFile[]>();
  for (const file of files) {
    if (file.fileType === "seal_application") {
      const ownerId = sourceContractId(file);
      const ownerFiles = sealApplicationsByOwner.get(ownerId) || [];
      ownerFiles.push(file);
      sealApplicationsByOwner.set(ownerId, ownerFiles);
    }
  }
  const displayedSealApplicationIds = new Set<string>();
  for (const ownerFiles of sealApplicationsByOwner.values()) {
    const ordered = [...ownerFiles].sort(
      (left, right) =>
        String(right.createdAt || "").localeCompare(
          String(left.createdAt || ""),
        ) || right.id.localeCompare(left.id),
    );
    const displayed = ordered.find((file) => file.isCurrent) || ordered[0];
    if (displayed) displayedSealApplicationIds.add(displayed.id);
  }
  return files.filter(
    (file) =>
      file.fileType !== "seal_application" ||
      displayedSealApplicationIds.has(file.id),
  );
});
const contractFileGroups = computed(() => {
  const definitions = [
    { key: "contract", label: "合同" },
    { key: "invoice", label: "发票" },
    { key: "receipt", label: "回单" },
    { key: "seal", label: "用印申请单" },
  ] as const;
  const groupKey = (file: (typeof displayedContractFiles.value)[number]) => {
    if (file.fileType === "invoice") return "invoice";
    if (["receipt", "payment"].includes(file.fileType)) return "receipt";
    if (file.fileType === "seal_application") return "seal";
    return "contract";
  };
  const sourceLabel = (file: CentralizedContractFile) => {
    const relation = sourceContractRelation(file);
    const relationType =
      file.sourceRelationType || relation?.relationType || "main";
    const supplementSequence =
      file.sourceSupplementSequence ?? relation?.supplementSequence;
    if (relationType === "supplement") {
      return Number.isFinite(Number(supplementSequence))
        ? `补充协议（${Number(supplementSequence)}）`
        : "补充协议";
    }
    if (relationType === "termination") return "解除协议";
    return "主合同";
  };
  const sourceOrder = (file: CentralizedContractFile) => {
    const relation = sourceContractRelation(file);
    const relationType =
      file.sourceRelationType || relation?.relationType || "main";
    if (relationType === "main") return [0, 0] as const;
    if (relationType === "supplement") {
      return [
        1,
        Number(
          file.sourceSupplementSequence ??
            relation?.supplementSequence ??
            Number.MAX_SAFE_INTEGER,
        ),
      ] as const;
    }
    return [2, 0] as const;
  };
  return definitions
    .map((definition) => {
      const files = displayedContractFiles.value.filter(
        (file) => groupKey(file) === definition.key,
      );
      if (definition.key === "invoice") {
        return { ...definition, files, sources: [] };
      }
      const filesBySource = new Map<string, CentralizedContractFile[]>();
      for (const file of files) {
        const ownerId = sourceContractId(file);
        const ownerFiles = filesBySource.get(ownerId) || [];
        ownerFiles.push(file);
        filesBySource.set(ownerId, ownerFiles);
      }
      const sources = [...filesBySource.entries()]
        .map(([ownerId, ownerFiles]) => {
          const representative = ownerFiles[0]!;
          const relation = sourceContractRelation(representative);
          return {
            sourceContractId: ownerId,
            sourceContractName:
              representative.sourceContractName ||
              relation?.contractName ||
              detail.value?.contract.name ||
              null,
            label: sourceLabel(representative),
            order: sourceOrder(representative),
            files: ownerFiles,
          };
        })
        .sort(
          (left, right) =>
            left.order[0] - right.order[0] ||
            left.order[1] - right.order[1] ||
            left.sourceContractId.localeCompare(right.sourceContractId),
        );
      return { ...definition, files, sources };
    })
    .filter((group) => group.files.length > 0);
});
const loading = ref(false);
const actionLoading = ref(false);
const rentalExitConfirming = ref(false);
const auxiliarySettingLoading = ref(false);
const auxiliaryHasContent = ref(false);
const readonlyPreviewVisible = ref(false);
const readonlyPreviewUrl = ref("");
const readonlyPreviewFileName = ref("");
const readonlyPreviewMimeType = ref("");
const readonlyPreviewFileId = ref("");
const errorMessage = ref("");
const liveStatus = ref("");
const activeTab = ref("overview");
const detailApprovalWorkspaceVisible = ref(false);
const detailApprovalAction = ref<ContractApprovalAction>("approve");
const detailApprovalWorkspaceRef = ref<HTMLElement | null>(null);
const detailApprovalWorkspaceSession = ref(0);
const detailApprovalNeedsRefresh = ref(false);
const detailManagerSealApprovalActive = computed(() => {
  const contract = detail.value?.contract;
  return Boolean(
    detailApprovalWorkspaceVisible.value &&
    detailApprovalAction.value === "approve" &&
    contract?.status === "approving" &&
    contract.pendingAction === "seal" &&
    contract.previousStatus === "draft" &&
    contract.approvalTargetSource === "general_manager",
  );
});
const detailApprovalWorkspaceKey = computed(
  () =>
    `${detail.value?.contract.id || "contract"}:${detailApprovalAction.value}:${detailApprovalWorkspaceSession.value}`,
);
const detailApprovalPrimaryLabel = computed(() => {
  const contract = detail.value?.contract;
  if (!contract) return "通过";
  if (contract.pendingAction === "termination") return "同意终止";
  if (
    contract.pendingAction === "seal" &&
    contract.previousStatus === "pending_seal"
  ) {
    return "同意差异";
  }
  if (contract.approvalTargetSource === "general_manager") {
    return "审批并签名";
  }
  return "通过";
});
const detailApprovalRejectLabel = computed(() => {
  const contract = detail.value?.contract;
  if (contract?.pendingAction === "termination") return "驳回终止";
  if (
    contract?.pendingAction === "seal" &&
    contract.previousStatus === "pending_seal"
  ) {
    return "驳回差异";
  }
  return "驳回";
});
const APPROVAL_ROLE_LABELS: Record<string, string> = {
  super_admin: "超级管理员",
  chairman: "董事长",
  admin: "管理员",
  general_manager: "总经理",
  boss: "经营管理",
  user: "员工",
};

function approvalPersonPosition(
  position?: string | null,
  role?: string | null,
) {
  if (role === "general_manager") return "总经理";
  return (
    position?.trim() || (role ? APPROVAL_ROLE_LABELS[role] : "") || "职位未设置"
  );
}

const approvalFlowPendingTitle = computed(() => {
  const contract = detail.value?.contract;
  if (!contract || contract.status !== "approving") return "";
  const name = contract.approvalTargetName?.trim();
  const position = approvalPersonPosition(
    contract.approvalTargetPosition,
    contract.approvalTargetRole,
  );
  return name ? `等待${position} ${name}审批` : `等待${position}审批`;
});
const approvalFlowNodeCount = computed(
  () =>
    (detail.value?.approvals.length || 0) +
    (approvalFlowPendingTitle.value ? 1 : 0),
);
const sealVerification = ref<ContractSealVerification | null>(null);
const sealLoading = ref(false);
const sealVerificationError = ref("");
const sealUploading = ref(false);
const sealReplacing = ref(false);
const sealArchiveConfirming = ref(false);
const sealDifferenceExplanation = ref("");
const sealedForm = reactive({ file: null as File | null });
const sealedUploadRef = ref<UploadInstance>();
const sealPageErrorRef = ref<HTMLElement | null>(null);
const sealedLocalPreviewUrl = ref("");
const financialRegistrationPanelRef = ref<{
  focus: () => void;
  reset: () => void;
  reloadPendingUploads: () => Promise<void>;
} | null>(null);
const financialRegistrationTargetId = ref("");

const sealedFileExtension = computed(() => {
  const extension = sealedForm.file?.name.split(".").pop()?.trim();
  return extension ? extension.toUpperCase() : "文件";
});

const sealedFileTypeLabel = computed(() =>
  sealedForm.file?.type === "application/pdf" ||
  sealedForm.file?.name.toLowerCase().endsWith(".pdf")
    ? "PDF 文件"
    : "图片文件",
);

type SealPartyFieldKey = Extract<
  ContractSealVerificationFieldKey,
  "party_a" | "party_b"
>;
type SealContentComparisonState = "match" | "mismatch" | "missing";
type SealPartyComparisonState = SealContentComparisonState;

const sealWorkspaceVisible = computed(() => {
  const contract = detail.value?.contract;
  return Boolean(
    contract &&
    (sealVerification.value ||
      contract.status === "pending_seal" ||
      (contract.status === "approving" &&
        contract.pendingAction === "seal" &&
        contract.previousStatus === "pending_seal")),
  );
});

const sealWorkflowStep = computed(() => {
  const status = sealVerification.value?.status;
  if (!status || sealReplacing.value) return 0;
  if (status === "archived") return 4;
  if (status === "ready_to_archive" || status === "difference_approved") {
    return 3;
  }
  if (
    [
      "difference_explanation_required",
      "difference_approving",
      "difference_rejected",
    ].includes(status)
  ) {
    return 2;
  }
  return 1;
});

const sealCanArchive = computed(
  () =>
    !sealReplacing.value &&
    Boolean(
      sealVerification.value &&
      ["ready_to_archive", "difference_approved"].includes(
        sealVerification.value.status,
      ),
    ),
);

const sealPartyComparisons = computed(() => {
  const verification = sealVerification.value;
  if (!verification) return [];
  return (["party_a", "party_b"] as const).map((fieldCode) => {
    const field = verification.fields.find(
      (candidate) => candidate.field === fieldCode,
    );
    const approvedSnapshotValue =
      fieldCode === "party_a"
        ? verification.approvedSnapshot.partyA
        : verification.approvedSnapshot.partyB;
    const approvedValue = field?.approvedValue || approvedSnapshotValue || null;
    const sealedValue = field?.recognizedValue || field?.finalValue || null;
    const state = sealContentComparisonState(
      fieldCode,
      approvedValue,
      sealedValue,
    );
    return {
      field: fieldCode as SealPartyFieldKey,
      approvedValue,
      sealedValue,
      state,
      requiresRecognitionRetry: Boolean(field?.requiresRecognitionRetry),
    };
  });
});

const sealSecondaryFields = computed(
  () =>
    sealVerification.value?.fields.filter(
      (field) => field.field !== "party_a" && field.field !== "party_b",
    ) || [],
);

const sealReviewCoreFields = computed(() => {
  const verification = sealVerification.value;
  if (!verification) return [];
  return (["party_a", "party_b", "amount"] as const).map((fieldCode) => {
    const field = verification.fields.find(
      (candidate) => candidate.field === fieldCode,
    );
    const approvedValue =
      field?.approvedValue ||
      (fieldCode === "party_a"
        ? verification.approvedSnapshot.partyA
        : fieldCode === "party_b"
          ? verification.approvedSnapshot.partyB
          : verification.approvedSnapshot.amount);
    const sealedValue = field?.recognizedValue || field?.finalValue || null;
    return {
      fieldCode,
      field,
      state: sealContentComparisonState(fieldCode, approvedValue, sealedValue),
    };
  });
});

const sealReviewBlockingReasons = computed(() =>
  sealReviewCoreFields.value
    .filter(
      ({ field, state }) =>
        field?.requiresRecognitionRetry || state !== "match",
    )
    .map(({ fieldCode, state }) => {
      const label = sealFieldLabel(fieldCode);
      if (state === "missing") return `${label}未识别到内容，无法判断`;
      if (state === "mismatch") return `${label}识别内容与审批版不一致`;
      return `${label}识别内容一致，但自动核验依据不足`;
    }),
);

const sealReviewRequiredTitle = computed(() => {
  const states = sealReviewCoreFields.value.map(({ state }) => state);
  if (states.includes("missing")) return "部分关键字段缺失，暂无法完成核验";
  if (states.includes("mismatch")) {
    return "识别内容存在差异，且自动核验依据不足";
  }
  return "识别内容一致，自动核验依据不足";
});

const normalLifecycleStages = [
  { value: "draft", label: "草拟中" },
  { value: "approving", label: "审批中" },
  { value: "pending_seal", label: "待盖章" },
  { value: "effective", label: "生效中" },
  { value: "executing", label: "执行中" },
  { value: "completed", label: "已完成" },
] as const;

const terminationEntryStatuses = new Set<ContractStatus>([
  "effective",
  "executing",
  "completed",
]);

const terminationEntryStatus = computed<ContractStatus | null>(() => {
  const currentDetail = detail.value;
  if (!currentDetail) return null;
  const contract = currentDetail.contract;
  if (
    contract.pendingAction === "termination" &&
    contract.previousStatus &&
    terminationEntryStatuses.has(contract.previousStatus)
  ) {
    return contract.previousStatus;
  }
  if (contract.status !== "terminated") return null;
  const request = [...currentDetail.approvals]
    .reverse()
    .find(
      (approval) =>
        approval.action === "termination_request" &&
        approval.fromStatus &&
        terminationEntryStatuses.has(approval.fromStatus),
    );
  if (request?.fromStatus) return request.fromStatus;
  if (contract.completedAt) return "completed";
  return "effective";
});

const lifecycleDisplayStatus = computed<ContractStatus>(() =>
  terminationEntryStatus.value
    ? terminationEntryStatus.value
    : detail.value?.contract.status || "draft",
);

const terminationLifecycleNotice = computed(() => {
  const contract = detail.value?.contract;
  const entryStatus = terminationEntryStatus.value;
  if (!contract || !entryStatus) return "";
  const entryLabel = normalLifecycleStages.find(
    (stage) => stage.value === entryStatus,
  )?.label;
  const statusLabel =
    contract.status === "terminated" ? "已终止" : "终止审批中";
  return entryLabel ? `${statusLabel} · 从${entryLabel}介入` : statusLabel;
});

const lifecycleStages = computed(() =>
  detail.value?.contract.status === "rejected"
    ? [
        { value: "draft", label: "草拟中" },
        { value: "approving", label: "审批中" },
        { value: "rejected", label: "已拒绝" },
      ]
    : normalLifecycleStages,
);

const currentLifecycleIndex = computed(() => {
  if (!detail.value) return 0;
  const index = lifecycleStages.value.findIndex(
    (stage) => stage.value === lifecycleDisplayStatus.value,
  );
  return index < 0 ? 0 : index;
});

const normalizedProgress = computed(() => {
  return normalizeContractPercent(detail.value?.contract.completionRate);
});

function normalizedSealComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function sealContentComparisonState(
  field: Exclude<ContractSealVerificationFieldKey, "contract_date">,
  approvedValue: string | number | null | undefined,
  sealedValue: string | number | null | undefined,
): SealContentComparisonState {
  if (
    approvedValue === null ||
    approvedValue === undefined ||
    approvedValue === "" ||
    sealedValue === null ||
    sealedValue === undefined ||
    sealedValue === ""
  ) {
    return "missing";
  }
  if (field === "amount") {
    return moneyToNumber(approvedValue) === moneyToNumber(sealedValue)
      ? "match"
      : "mismatch";
  }
  return normalizedSealComparableText(String(approvedValue)) ===
    normalizedSealComparableText(String(sealedValue))
    ? "match"
    : "mismatch";
}

function sealFieldComparisonState(
  field: ContractSealVerificationField,
): SealContentComparisonState {
  return sealContentComparisonState(
    field.field as Exclude<ContractSealVerificationFieldKey, "contract_date">,
    field.approvedValue,
    field.recognizedValue || field.finalValue,
  );
}

function sealFieldComparisonLabel(
  field: ContractSealVerificationField,
): string {
  return {
    match: "内容一致",
    mismatch: "内容不一致",
    missing: "缺失，无法判断",
  }[sealFieldComparisonState(field)];
}

function sealFieldComparisonTagType(
  field: ContractSealVerificationField,
): "success" | "danger" | "warning" {
  return {
    match: "success",
    mismatch: "danger",
    missing: "warning",
  }[sealFieldComparisonState(field)] as "success" | "danger" | "warning";
}

function sealContractDateStateLabel(
  field: ContractSealVerificationField,
): string {
  if (field.source === "upload_date") return "采用上传日期";
  return field.finalValue ? "已识别" : "选填，归档时兜底";
}

function sealVerificationQualityText(
  field: ContractSealVerificationField,
): string {
  if (field.field === "contract_date") {
    if (field.source === "upload_date") {
      return "草拟阶段日期选填，已采用盖章合同上传日期";
    }
    return field.finalValue
      ? "已识别盖章合同签订日期"
      : "签订日期选填，归档时采用上传日期";
  }
  const comparisonState = sealFieldComparisonState(field);
  if (comparisonState === "missing") return "未识别到内容，无法判断";
  if (comparisonState === "mismatch") return "识别内容与审批版不一致";
  return field.requiresRecognitionRetry
    ? "内容一致，自动核验依据不足"
    : "内容一致，精准核验通过";
}

function sealPartyStateLabel(state: SealPartyComparisonState): string {
  return {
    match: "内容一致",
    mismatch: "内容不一致",
    missing: "缺失，无法判断",
  }[state];
}

function sealPartyStateTagType(
  state: SealPartyComparisonState,
): "success" | "danger" | "warning" {
  return (
    {
      match: "success",
      mismatch: "danger",
      missing: "warning",
    } as const satisfies Record<
      SealPartyComparisonState,
      "success" | "danger" | "warning"
    >
  )[state];
}

const sealStatusAlertType = computed<"success" | "warning" | "error" | "info">(
  () => {
    const status = sealVerification.value?.status;
    if (status === "infrastructure_failed" || status === "difference_rejected")
      return "error";
    if (
      status === "review_required" ||
      status === "difference_explanation_required" ||
      status === "difference_approving"
    ) {
      return "warning";
    }
    if (status === "ready_to_archive" || status === "difference_approved") {
      return "success";
    }
    return "info";
  },
);

const sealStatusTagType = computed<"success" | "warning" | "danger" | "info">(
  () =>
    sealStatusAlertType.value === "error"
      ? "danger"
      : sealStatusAlertType.value,
);

const sealStatusTitle = computed(() => {
  const status = sealVerification.value?.status;
  if (!status) return "尚未上传盖章合同";
  if (status === "difference_approving") {
    return `盖章版差异正在等待${approvalTargetLabel.value}复审`;
  }
  return (
    {
      infrastructure_failed: "识别服务暂时不可用，禁止直接归档",
      review_required: sealReviewRequiredTitle.value,
      difference_explanation_required: "盖章版与审批版本存在关键差异",
      difference_approved: "盖章版差异已通过复审，可以归档生效",
      difference_rejected: "盖章版差异复审已拒绝，合同不可归档",
      ready_to_archive: "核验已通过，可以归档生效",
      archived: "盖章合同已归档生效",
      superseded: "该核验记录已被新文件替代",
    } as const
  )[status];
});

const sealStatusDescription = computed(() => {
  const status = sealVerification.value?.status;
  if (status === "review_required") {
    const blockers = sealReviewBlockingReasons.value;
    return `${
      blockers.length
        ? `当前阻断：${blockers.join("；")}`
        : "关键字段尚未满足自动归档门禁"
    }。合同签订日期为选填项，未识别时采用盖章合同上传日期。`;
  }
  if (status === "difference_explanation_required") {
    return `高置信度关键差异不可人工改写，请填写差异说明并重新提交${approvalTargetLabel.value}审批。`;
  }
  if (status === "difference_approving")
    return "复审完成前合同保持审批中，不能归档生效。";
  if (status === "difference_rejected")
    return "本轮差异复审已拒绝，合同进入已拒绝终态；识别记录仅保留用于审计。";
  if (status === "infrastructure_failed")
    return "请稍后重新识别或重新上传文件，系统不会以人工录入绕过识别故障。";
  return "甲乙方、合同金额和合同签订日期均以系统自动识别结果为归档依据；签订日期缺失时采用上传日期。";
});

type FinancialRecordCollection =
  | "invoices"
  | "receipts"
  | "payments"
  | "externalPayments";
interface FinancialRegistrationDocument {
  type: FinancialRecordCollection;
  label: string;
  record: ContractFinanceRecord;
}
interface FinancialRegistrationCard {
  key: string;
  registrationId: string | null;
  status: ContractFinanceRecordStatus;
  documents: FinancialRegistrationDocument[];
  matches: ContractFinancialRegistrationMatch[];
}

const financialRegistrationCards = computed<FinancialRegistrationCard[]>(() => {
  const documents: FinancialRegistrationDocument[] = [
    ...(detail.value?.invoices || []).map((record) => ({
      type: "invoices" as const,
      label: "发票",
      record,
    })),
    ...(detail.value?.receipts || []).map((record) => ({
      type: "receipts" as const,
      label: "回款回单",
      record,
    })),
    ...(detail.value?.payments || []).map((record) => ({
      type: "payments" as const,
      label:
        detail.value?.contract.assetFundingMode === "engineering_to_technology"
          ? "工程咨询→科技划拨回单"
          : "付款凭证",
      record,
    })),
    ...(detail.value?.externalPayments || []).map((record) => ({
      type: "externalPayments" as const,
      label: "科技→合同对方付款回单",
      record,
    })),
  ];
  const cards = new Map<string, FinancialRegistrationCard>();
  for (const document of documents) {
    const registrationId = document.record.financialRegistrationId || null;
    const key = registrationId
      ? `registration:${registrationId}`
      : `${document.type}:${document.record.id}`;
    const current = cards.get(key);
    if (current) {
      current.documents.push(document);
      continue;
    }
    cards.set(key, {
      key,
      registrationId,
      status: document.record.status,
      documents: [document],
      matches: registrationId
        ? (detail.value?.financialRegistrationMatches || []).filter(
            (match) => match.registrationId === registrationId,
          )
        : [],
    });
  }
  for (const card of cards.values()) {
    if (card.registrationId && !card.matches.length) {
      card.matches = deriveLegacyFinancialMatches(card);
    }
  }
  return [...cards.values()].sort((left, right) => {
    const leftDate = left.documents[0]?.record.createdAt || "";
    const rightDate = right.documents[0]?.record.createdAt || "";
    return rightDate.localeCompare(leftDate);
  });
});

const financialRegistrationTarget = computed(
  () =>
    financialRegistrationCards.value.find(
      (card) => card.registrationId === financialRegistrationTargetId.value,
    ) || null,
);
const financialRegistrationTargetInvoices = computed(() =>
  (financialRegistrationTarget.value?.documents || [])
    .filter((document) => document.type === "invoices")
    .map((document) => ({
      id: document.record.id,
      label:
        document.record.invoiceNo || document.record.fileName || "未命名发票",
      amount: Number(document.record.amount),
      buyer: document.record.buyer,
      seller: document.record.seller,
      itemName: document.record.itemName,
      invoiceNo: document.record.invoiceNo,
      recordDate: document.record.recordDate,
      fileName: document.record.fileName,
      previewUrl: document.record.fileId
        ? getContractFileUrl(document.record.fileId)
        : "",
      financialDirection: document.record.financialDirection,
      lineItems: document.record.lineItems || [],
    })),
);
const financialRegistrationTargetBankDocuments = computed(() =>
  (financialRegistrationTarget.value?.documents || [])
    .filter(
      (document) =>
        document.type === "receipts" || document.type === "payments",
    )
    .map((document) => ({
      id: document.record.id,
      label:
        document.record.electronicReceiptNo ||
        document.record.fileName ||
        "未命名银行凭证",
      amount: Number(document.record.amount),
      payer: document.record.payer,
      payerAccount: document.record.payerAccount,
      payee: document.record.payee,
      payeeAccount: document.record.payeeAccount,
      referenceNo: document.record.electronicReceiptNo,
      paymentTime: document.record.paymentTime,
      fileName: document.record.fileName,
      previewUrl: document.record.fileId
        ? getContractFileUrl(document.record.fileId)
        : "",
    })),
);
const financialRegistrationTargetExternalPayments = computed(() =>
  (financialRegistrationTarget.value?.documents || [])
    .filter((document) => document.type === "externalPayments")
    .map((document) => ({
      id: document.record.id,
      label:
        document.record.electronicReceiptNo ||
        document.record.fileName ||
        "未命名对外付款",
      amount: Number(document.record.amount),
      payer: document.record.payer,
      payerAccount: document.record.payerAccount,
      payee: document.record.payee,
      payeeAccount: document.record.payeeAccount,
      referenceNo: document.record.electronicReceiptNo,
      paymentTime: document.record.paymentTime,
      fileName: document.record.fileName,
      previewUrl: document.record.fileId
        ? getContractFileUrl(document.record.fileId)
        : "",
    })),
);
const financialRegistrationTargetDirection = computed<"income" | "cost" | null>(
  () => {
    const directions = new Set(
      (financialRegistrationTarget.value?.documents || [])
        .filter((document) => document.type === "invoices")
        .map((document) => document.record.financialDirection)
        .filter((direction) => direction === "input" || direction === "output"),
    );
    if (
      directions.size === 0 &&
      isInternalFundingMode.value &&
      (financialRegistrationTarget.value?.documents || []).some(
        (document) => document.type === "externalPayments",
      )
    )
      return "cost";
    if (directions.size !== 1) return null;
    return directions.has("output") ? "income" : "cost";
  },
);

watch(
  financialRegistrationCards,
  async (cards) => {
    if (
      financialRegistrationTargetId.value &&
      cards.some(
        (card) => card.registrationId === financialRegistrationTargetId.value,
      )
    )
      return;
    const openRegistrations = cards.filter(
      (card) =>
        card.registrationId &&
        card.status === "draft" &&
        isAwaitingSettlement(card),
    );
    if (openRegistrations.length !== 1) return;
    financialRegistrationTargetId.value =
      openRegistrations[0]!.registrationId || "";
    await nextTick();
    await financialRegistrationPanelRef.value?.reloadPendingUploads();
  },
  { immediate: true },
);

function financialRegistrationAmountSummary(card: FinancialRegistrationCard) {
  const invoiceCents = card.documents
    .filter((document) => document.type === "invoices")
    .reduce(
      (sum, document) => sum + Math.round(Number(document.record.amount) * 100),
      0,
    );
  const settlementCents = card.documents
    .filter(
      (document) =>
        document.type === "receipts" || document.type === "payments",
    )
    .reduce(
      (sum, document) => sum + Math.round(Number(document.record.amount) * 100),
      0,
    );
  const externalCents = card.documents
    .filter((document) => document.type === "externalPayments")
    .reduce(
      (sum, document) => sum + Math.round(Number(document.record.amount) * 100),
      0,
    );
  const matchedCents = card.matches
    .filter((match) => match.settlementKind !== "external_payment")
    .reduce(
      (sum, match) => sum + Math.round(Number(match.allocatedAmount) * 100),
      0,
    );
  const externalMatchedCents = card.matches
    .filter((match) => match.settlementKind === "external_payment")
    .reduce(
      (sum, match) => sum + Math.round(Number(match.allocatedAmount) * 100),
      0,
    );
  return {
    invoiceCents,
    settlementCents,
    externalCents,
    matchedCents,
    externalMatchedCents,
  };
}

function financialCardInvoiceAmount(card: FinancialRegistrationCard): number {
  return financialRegistrationAmountSummary(card).invoiceCents / 100;
}

function financialCardSettlementAmount(
  card: FinancialRegistrationCard,
): number {
  return financialRegistrationAmountSummary(card).settlementCents / 100;
}

function financialCardRemainingAmount(card: FinancialRegistrationCard): number {
  const { invoiceCents, settlementCents } =
    financialRegistrationAmountSummary(card);
  return Math.max(0, invoiceCents - settlementCents) / 100;
}

function financialCardExternalAmount(card: FinancialRegistrationCard): number {
  return financialRegistrationAmountSummary(card).externalCents / 100;
}

function financialCardExternalRemainingAmount(
  card: FinancialRegistrationCard,
): number {
  const { invoiceCents, externalCents } =
    financialRegistrationAmountSummary(card);
  return Math.max(0, invoiceCents - externalCents) / 100;
}

function financialCardInvoiceRemainingAmount(
  card: FinancialRegistrationCard,
): number {
  const { invoiceCents, externalCents } =
    financialRegistrationAmountSummary(card);
  return Math.max(0, externalCents - invoiceCents) / 100;
}

function financialCardInternalPendingLabel(
  card: FinancialRegistrationCard,
): string {
  const { invoiceCents, externalCents } =
    financialRegistrationAmountSummary(card);
  return externalCents > invoiceCents ? "待补发票" : "待补对外付款";
}

function financialCardSettlementAction(card: FinancialRegistrationCard) {
  if (isInternalFundingMode.value) return "工程咨询划拨";
  return card.documents.some((document) => document.type === "payments")
    ? "付款"
    : "回款";
}

function hasConfirmedSettlement(card: FinancialRegistrationCard): boolean {
  return card.documents.some(
    (document) =>
      (document.type === "receipts" || document.type === "payments") &&
      document.record.status === "confirmed",
  );
}

function isAwaitingSettlement(card: FinancialRegistrationCard): boolean {
  if (!card.registrationId) return false;
  const { invoiceCents, settlementCents } =
    financialRegistrationAmountSummary(card);
  const externalCents = financialRegistrationAmountSummary(card).externalCents;
  const usesExternalSettlement =
    detail.value?.contract.assetFundingMode === "engineering_to_technology";
  return (
    (usesExternalSettlement && externalCents > 0 && invoiceCents === 0) ||
    (invoiceCents > 0 &&
      (usesExternalSettlement
        ? externalCents !== invoiceCents
        : settlementCents < invoiceCents))
  );
}

async function continueFinancialRegistration(card: FinancialRegistrationCard) {
  if (!card.registrationId) return;
  financialRegistrationPanelRef.value?.reset();
  financialRegistrationTargetId.value = card.registrationId;
  await nextTick();
  await financialRegistrationPanelRef.value?.reloadPendingUploads();
  financialRegistrationPanelRef.value?.focus();
}

function cancelFinancialRegistrationContinuation() {
  financialRegistrationPanelRef.value?.reset();
  financialRegistrationTargetId.value = "";
}

function deriveLegacyFinancialMatches(
  card: FinancialRegistrationCard,
): ContractFinancialRegistrationMatch[] {
  const registrationId = card.registrationId;
  if (!registrationId) return [];
  const invoices = card.documents.filter(
    (document) => document.type === "invoices",
  );
  const settlements = card.documents.filter(
    (document) => document.type === "receipts" || document.type === "payments",
  );
  const invoiceTotal = invoices.reduce(
    (sum, document) => sum + Math.round(Number(document.record.amount) * 100),
    0,
  );
  const settlementTotal = settlements.reduce(
    (sum, document) => sum + Math.round(Number(document.record.amount) * 100),
    0,
  );
  if (
    !invoices.length ||
    !settlements.length ||
    invoiceTotal !== settlementTotal
  )
    return [];
  const matches: ContractFinancialRegistrationMatch[] = [];
  const invoiceRemaining = invoices.map((document) =>
    Math.round(Number(document.record.amount) * 100),
  );
  const settlementRemaining = settlements.map((document) =>
    Math.round(Number(document.record.amount) * 100),
  );
  const appendMatch = (
    invoiceIndex: number,
    settlementIndex: number,
    allocated: number,
  ) =>
    matches.push({
      registrationId,
      invoiceRecordId: invoices[invoiceIndex]!.record.id,
      settlementRecordId: settlements[settlementIndex]!.record.id,
      allocatedAmount: allocated / 100,
    });
  for (
    let invoiceIndex = 0;
    invoiceIndex < invoiceRemaining.length;
    invoiceIndex += 1
  ) {
    const settlementIndex = settlementRemaining.findIndex(
      (amount) => amount > 0 && amount === invoiceRemaining[invoiceIndex],
    );
    if (settlementIndex < 0) continue;
    appendMatch(invoiceIndex, settlementIndex, invoiceRemaining[invoiceIndex]!);
    invoiceRemaining[invoiceIndex] = 0;
    settlementRemaining[settlementIndex] = 0;
  }
  let invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
  let settlementIndex = settlementRemaining.findIndex((amount) => amount > 0);
  while (invoiceIndex >= 0 && settlementIndex >= 0) {
    const allocated = Math.min(
      invoiceRemaining[invoiceIndex]!,
      settlementRemaining[settlementIndex]!,
    );
    appendMatch(invoiceIndex, settlementIndex, allocated);
    invoiceRemaining[invoiceIndex] -= allocated;
    settlementRemaining[settlementIndex] -= allocated;
    invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
    settlementIndex = settlementRemaining.findIndex((amount) => amount > 0);
  }
  return matches.sort(
    (left, right) =>
      invoices.findIndex((item) => item.record.id === left.invoiceRecordId) -
        invoices.findIndex(
          (item) => item.record.id === right.invoiceRecordId,
        ) ||
      settlements.findIndex(
        (item) => item.record.id === left.settlementRecordId,
      ) -
        settlements.findIndex(
          (item) => item.record.id === right.settlementRecordId,
        ),
  );
}

function financialMatchInvoiceLabel(
  card: FinancialRegistrationCard,
  match: ContractFinancialRegistrationMatch,
): string {
  const invoice = card.documents.find(
    (document) => document.record.id === match.invoiceRecordId,
  )?.record;
  return `发票 ${invoice?.invoiceNo || invoice?.fileName || "—"}`;
}

function financialMatchSettlementLabel(
  card: FinancialRegistrationCard,
  match: ContractFinancialRegistrationMatch,
): string {
  const settlement = card.documents.find(
    (document) => document.record.id === match.settlementRecordId,
  )?.record;
  const label = card.documents.find(
    (document) => document.record.id === match.settlementRecordId,
  )?.label;
  return `${label || "回单"} ${
    settlement?.electronicReceiptNo || settlement?.fileName || "—"
  }`;
}

const FINANCE_TABS = new Set([
  "overview",
  "relations",
  "approval",
  "files",
  "finance",
]);

function financeRecordStatusLabel(status: ContractFinanceRecordStatus): string {
  return { draft: "草稿", confirmed: "已确认", reversed: "已冲销" }[status];
}

function financeRecordStatusTagType(
  status: ContractFinanceRecordStatus,
): "warning" | "success" | "info" {
  return { draft: "warning", confirmed: "success", reversed: "info" }[
    status
  ] as "warning" | "success" | "info";
}

function financeRecordDescription(record: ContractFinanceRecord): string {
  const identity =
    record.type === "invoice"
      ? [
          record.buyer ? `购买方：${record.buyer}` : "",
          record.seller ? `销售方：${record.seller}` : "",
          record.itemName ? `开票名称：${record.itemName}` : "",
          record.invoiceNo ? `发票号码：${record.invoiceNo}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          record.transactionSerialNo
            ? `流水号：${record.transactionSerialNo}`
            : "",
          record.electronicReceiptNo
            ? `回单号：${record.electronicReceiptNo}`
            : record.bankReference,
          record.bankName,
          [record.payer, record.payee].filter(Boolean).join(" → "),
        ]
          .filter(Boolean)
          .join(" · ");
  return identity || record.note || "无备注";
}

function financeRecordOccurredAt(record: ContractFinanceRecord): string {
  if (record.type !== "invoice" && record.paymentTime) {
    return record.paymentTime;
  }
  return formatContractDate(record.recordDate);
}

function canConfirmFinancialRecord(record: ContractFinanceRecord): boolean {
  return (
    record.financialValidationStatus === "verified" &&
    record.financialDocumentStatus === "normal" &&
    record.financialCanAutoPost === true
  );
}

function canConfirmFinancialCard(card: FinancialRegistrationCard): boolean {
  if (card.registrationId) {
    const {
      invoiceCents,
      settlementCents,
      externalCents,
      matchedCents,
      externalMatchedCents,
    } = financialRegistrationAmountSummary(card);
    if (
      invoiceCents <= 0 ||
      invoiceCents !== settlementCents ||
      invoiceCents !== matchedCents
    ) {
      return false;
    }
    if (
      isInternalFundingMode.value &&
      (invoiceCents !== externalCents || invoiceCents !== externalMatchedCents)
    ) {
      return false;
    }
  }
  return card.documents.every(
    (document) =>
      ["draft", "confirmed"].includes(document.record.status) &&
      canConfirmFinancialRecord(document.record),
  );
}

function routeQueryText(value: unknown): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  return typeof resolved === "string" ? resolved : "";
}

function applyRouteIntent() {
  if (!detail.value) return;
  const requestedTab = routeQueryText(route.query.tab);
  const requestedAction = routeQueryText(route.query.action);
  const requestedType = routeQueryText(
    route.query.type || route.query.recordType,
  );
  const intentKey = [
    contractId.value,
    requestedTab,
    requestedAction,
    requestedType,
  ].join(":");
  if (intentKey === appliedRouteIntentKey) return;
  appliedRouteIntentKey = intentKey;

  if (
    FINANCE_TABS.has(requestedTab) &&
    detail.value.contract.relationType === "main"
  ) {
    activeTab.value = requestedTab;
  }
  if (
    requestedTab === "auxiliary" &&
    detail.value.contract.requiresAuxiliaryMaterials
  ) {
    activeTab.value = "auxiliary";
  }
  if (requestedTab === "approval") activeTab.value = "approval";
  if (requestedTab === "seal" && sealWorkspaceVisible.value) {
    activeTab.value = "seal";
  }
  if (
    requestedAction === "seal" &&
    detail.value.contract.status === "pending_seal" &&
    canEdit.value
  ) {
    openSealedWorkspace();
    return;
  }
  if (requestedAction !== "record") return;
  activeTab.value = "finance";
  if (!canManageFinancials.value) {
    ElMessage.warning(
      detail.value.contract.status === "completed"
        ? "已完成合同不能新增财务记录"
        : "当前合同状态不能新增财务记录",
    );
    return;
  }
  void nextTick(() => financialRegistrationPanelRef.value?.focus());
}

let detailLoadSequence = 0;
let appliedRouteIntentKey = "";

function resetDetailViewState() {
  releaseSealedLocalPreview();
  detail.value = null;
  loading.value = false;
  actionLoading.value = false;
  rentalExitConfirming.value = false;
  auxiliarySettingLoading.value = false;
  readonlyPreviewVisible.value = false;
  readonlyPreviewFileId.value = "";
  errorMessage.value = "";
  liveStatus.value = "";
  activeTab.value = "overview";
  detailApprovalWorkspaceVisible.value = false;
  detailApprovalAction.value = "approve";
  detailApprovalWorkspaceSession.value += 1;
  detailApprovalNeedsRefresh.value = false;
  appliedRouteIntentKey = "";
  sealedForm.file = null;
  sealVerification.value = null;
  sealLoading.value = false;
  sealVerificationError.value = "";
  sealUploading.value = false;
  sealReplacing.value = false;
  sealArchiveConfirming.value = false;
  sealDifferenceExplanation.value = "";
  financialRegistrationPanelRef.value?.reset();
  financialRegistrationTargetId.value = "";
}

function hydrateSealVerification(next: ContractSealVerification | null) {
  sealVerification.value = next;
  sealArchiveConfirming.value = false;
  sealDifferenceExplanation.value = next?.differenceExplanation || "";
}

function clearSealVerificationError() {
  sealVerificationError.value = "";
}

function showSealVerificationError(error: unknown, fallback: string) {
  const message =
    typeof error === "string"
      ? error
      : getContractErrorMessage(error, fallback);
  sealVerificationError.value = message;
  ElMessage.error(message);
  void nextTick(() => {
    sealPageErrorRef.value?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function sealWorkflowRelevant(): boolean {
  const contract = detail.value?.contract;
  const hasSealedContractFile = Boolean(
    contract?.hasSealedContractFile ||
    detail.value?.files.some((file) =>
      ["sealed", "sealed_contract"].includes(file.fileType),
    ),
  );
  return Boolean(
    contract &&
    hasSealedContractFile &&
    (contract.status === "pending_seal" ||
      (contract.status === "approving" &&
        contract.pendingAction === "seal" &&
        contract.previousStatus === "pending_seal")),
  );
}

async function loadLatestSealVerification(
  requestedContractId = contractId.value,
  expectedDetailSequence = detailLoadSequence,
) {
  if (!requestedContractId || !sealWorkflowRelevant()) {
    hydrateSealVerification(null);
    return;
  }
  sealLoading.value = true;
  sealVerificationError.value = "";
  try {
    const verification =
      await getLatestSealedContractVerification(requestedContractId);
    if (
      requestedContractId !== contractId.value ||
      expectedDetailSequence !== detailLoadSequence
    ) {
      return;
    }
    hydrateSealVerification(verification);
  } catch (error) {
    if (
      requestedContractId !== contractId.value ||
      expectedDetailSequence !== detailLoadSequence
    ) {
      return;
    }
    const status = (error as { response?: { status?: number } }).response
      ?.status;
    if (status === 404) {
      hydrateSealVerification(null);
    } else {
      showSealVerificationError(error, "盖章合同核验结果加载失败");
    }
  } finally {
    if (expectedDetailSequence === detailLoadSequence)
      sealLoading.value = false;
  }
}

async function loadDetail() {
  const requestedContractId = contractId.value;
  if (!requestedContractId) return;
  const loadSequence = ++detailLoadSequence;
  loading.value = true;
  errorMessage.value = "";
  try {
    const nextDetail = await getContract(requestedContractId);
    if (
      loadSequence !== detailLoadSequence ||
      requestedContractId !== contractId.value
    ) {
      return;
    }
    detail.value = nextDetail;
    await loadLatestSealVerification(requestedContractId, loadSequence);
    if (
      loadSequence !== detailLoadSequence ||
      requestedContractId !== contractId.value
    ) {
      return;
    }
    liveStatus.value = "合同详情已更新";
    applyRouteIntent();
  } catch (error) {
    if (
      loadSequence !== detailLoadSequence ||
      requestedContractId !== contractId.value
    ) {
      return;
    }
    errorMessage.value = getContractErrorMessage(error, "无法获取合同详情");
    liveStatus.value = errorMessage.value;
  } finally {
    if (loadSequence === detailLoadSequence) loading.value = false;
  }
}

async function updateAuxiliaryMaterialRequirement(
  value: string | number | boolean,
) {
  if (!detail.value || auxiliarySettingLoading.value) return;
  const requiresAuxiliaryMaterials = value === true;
  auxiliarySettingLoading.value = true;
  try {
    const updated = await updateContractAuxiliaryMaterialSetting(
      contractId.value,
      requiresAuxiliaryMaterials,
      detail.value.contract.version,
    );
    detail.value.contract = { ...detail.value.contract, ...updated };
    ElMessage.success(
      requiresAuxiliaryMaterials
        ? "已开启辅助材料，可在合同台账添加"
        : "已关闭辅助材料入口",
    );
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "辅助材料设置更新失败"));
  } finally {
    auxiliarySettingLoading.value = false;
  }
}

function openDetailApproval(action: ContractApprovalAction) {
  if (
    !canApprove.value ||
    detail.value?.contract.status !== "approving" ||
    actionLoading.value
  ) {
    return;
  }
  detailApprovalAction.value = action;
  detailApprovalWorkspaceSession.value += 1;
  detailApprovalNeedsRefresh.value = false;
  detailApprovalWorkspaceVisible.value = true;
  void nextTick(() => {
    detailApprovalWorkspaceRef.value?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

async function closeDetailApprovalWorkspace() {
  detailApprovalWorkspaceVisible.value = false;
  detailApprovalWorkspaceSession.value += 1;
  if (!detailApprovalNeedsRefresh.value) return;
  detailApprovalNeedsRefresh.value = false;
  await loadDetail();
  activeTab.value = "approval";
}

async function handleDetailApprovalCompleted(payload: { keepOpen: boolean }) {
  detailApprovalNeedsRefresh.value = true;
  if (payload.keepOpen) return;
  detailApprovalWorkspaceVisible.value = false;
  detailApprovalWorkspaceSession.value += 1;
  detailApprovalNeedsRefresh.value = false;
  await loadDetail();
  activeTab.value = "approval";
}

async function handleSubmitDraft() {
  actionLoading.value = true;
  try {
    await submitContract(contractId.value);
    ElMessage.success(`合同已${approvalSubmitLabel.value}`);
    await loadDetail();
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "提交合同审批失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function handleDeleteDraft() {
  if (!detail.value || detail.value.contract.status !== "draft") return;
  try {
    await ElMessageBox.confirm(
      "删除后合同草稿、相关识别结果和附件将永久删除且无法恢复。是否确认删除？",
      "删除合同草稿",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
    actionLoading.value = true;
    const result = await deleteContractDraft(
      contractId.value,
      detail.value.contract.version,
    );
    if (result.failedFileCount > 0) {
      ElMessage.warning(
        `合同草稿已永久删除，${result.failedFileCount} 个附件文件清理异常，系统已记录告警`,
      );
    } else {
      ElMessage.success("合同草稿及相关数据已永久删除");
    }
    await router.replace("/contracts");
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "删除合同草稿失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function handleWithdrawApproval() {
  if (
    !detail.value ||
    detail.value.contract.status !== "approving" ||
    detail.value.contract.pendingAction !== "seal"
  ) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      "仅在总经理尚未处理本轮审批时可以撤回。撤回后合同将返回草拟中，是否继续？",
      "撤回合同审批",
      {
        type: "warning",
        confirmButtonText: "确认撤回",
        cancelButtonText: "取消",
      },
    );
    actionLoading.value = true;
    await withdrawContractApproval(
      contractId.value,
      detail.value.contract.version,
    );
    ElMessage.success("合同审批已撤回，可继续修改草稿");
    await loadDetail();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "撤回合同审批失败"));
  } finally {
    actionLoading.value = false;
  }
}

function handleSealedFile(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    resetSealedUpload();
    showSealVerificationError(
      "盖章合同仅支持 PDF、JPG、JPEG、PNG 文件",
      "盖章合同文件格式不支持",
    );
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    resetSealedUpload();
    showSealVerificationError("盖章合同不能超过 30MB", "盖章合同文件过大");
    return;
  }
  clearSealVerificationError();
  releaseSealedLocalPreview();
  sealedForm.file = file;
  sealedLocalPreviewUrl.value = URL.createObjectURL(file);
  liveStatus.value = `已选择盖章合同“${file.name}”，可在线预览或开始上传核验`;
}

function clearSealedFile() {
  const fileName = sealedForm.file?.name;
  releaseSealedLocalPreview();
  sealedForm.file = null;
  sealedUploadRef.value?.clearFiles();
  if (fileName) liveStatus.value = `已移除盖章合同“${fileName}”`;
}

function resetSealedUpload() {
  releaseSealedLocalPreview();
  sealedForm.file = null;
  sealedUploadRef.value?.clearFiles();
}

function releaseSealedLocalPreview() {
  if (sealedLocalPreviewUrl.value) {
    URL.revokeObjectURL(sealedLocalPreviewUrl.value);
    sealedLocalPreviewUrl.value = "";
  }
}

function openSealedLocalPreview() {
  if (!sealedForm.file || !sealedLocalPreviewUrl.value) return;
  const previewWindow = window.open(sealedLocalPreviewUrl.value, "_blank");
  if (!previewWindow) {
    showSealVerificationError(
      "浏览器阻止了预览页面，请允许本站打开新页面后重试",
      "盖章合同预览页面打开失败",
    );
    return;
  }
  previewWindow.opener = null;
  liveStatus.value = `已在新页面打开盖章合同“${sealedForm.file.name}”`;
}

function formatUploadFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function openSealedWorkspace() {
  clearSealVerificationError();
  sealReplacing.value = false;
  sealArchiveConfirming.value = false;
  resetSealedUpload();
  activeTab.value = "seal";
  if (!sealVerification.value && sealWorkflowRelevant()) {
    void loadLatestSealVerification();
  }
}

function startReplacingSealedFile() {
  clearSealVerificationError();
  sealReplacing.value = true;
  sealArchiveConfirming.value = false;
  resetSealedUpload();
}

function cancelReplacingSealedFile() {
  clearSealVerificationError();
  sealReplacing.value = false;
  sealArchiveConfirming.value = false;
  resetSealedUpload();
}

function preventExistingSealActionWhileReplacing(): boolean {
  if (!sealReplacing.value) return false;
  ElMessage.warning(
    "正在重新上传盖章合同，请先点击“上传并开始核验”或返回核验结果",
  );
  return true;
}

function applySealWorkflowResult(result: ContractSealWorkflowResponse) {
  clearSealVerificationError();
  if (detail.value) {
    detail.value.contract = {
      ...detail.value.contract,
      ...result.contract,
    };
  }
  hydrateSealVerification(result.verification);
  sealReplacing.value = false;
  resetSealedUpload();
}

async function submitSealedContract() {
  if (!sealedForm.file || !detail.value) {
    showSealVerificationError(
      "请先选择盖章版合同文件，再点击“上传并开始核验”",
      "请选择盖章版合同文件",
    );
    return;
  }
  clearSealVerificationError();
  sealUploading.value = true;
  actionLoading.value = true;
  try {
    const result = await uploadSealedContract(
      contractId.value,
      sealedForm.file,
      detail.value.contract.version,
    );
    applySealWorkflowResult(result);
    ElMessage.success("盖章合同已上传，请完成核验后再归档生效");
  } catch (error) {
    showSealVerificationError(error, "盖章合同上传或核验失败");
  } finally {
    sealUploading.value = false;
    actionLoading.value = false;
  }
}

async function retrySealedVerification() {
  if (preventExistingSealActionWhileReplacing()) return;
  if (!sealVerification.value || !detail.value) return;
  clearSealVerificationError();
  actionLoading.value = true;
  try {
    const result = await retrySealedContractVerification(
      contractId.value,
      sealVerification.value.id,
      detail.value.contract.version,
    );
    applySealWorkflowResult(result);
    ElMessage.success("盖章合同已重新识别，请复核结果");
  } catch (error) {
    showSealVerificationError(error, "重新识别盖章合同失败");
  } finally {
    actionLoading.value = false;
  }
}

function sealFieldLabel(field: ContractSealVerificationFieldKey): string {
  return {
    party_a: "甲方单位",
    party_b: "乙方单位",
    amount: "合同金额",
    contract_date: "合同签订日期",
  }[field];
}

async function submitSealDifferenceApproval() {
  if (preventExistingSealActionWhileReplacing()) return;
  if (!sealVerification.value || !detail.value) return;
  if (sealVerification.value.requiresRecognitionRetry) {
    ElMessage.warning("自动识别尚未通过，请重新识别或重新上传盖章合同");
    return;
  }
  const explanation = sealDifferenceExplanation.value.trim();
  if (!explanation) {
    ElMessage.warning("请填写盖章版关键差异说明");
    return;
  }
  clearSealVerificationError();
  actionLoading.value = true;
  try {
    const result = await reapproveSealedContractDifference(
      contractId.value,
      sealVerification.value.id,
      detail.value.contract.version,
      explanation,
    );
    applySealWorkflowResult(result);
    ElMessage.success(`盖章版差异已提交${approvalTargetLabel.value}复审`);
  } catch (error) {
    showSealVerificationError(error, "提交盖章版差异复审失败");
  } finally {
    actionLoading.value = false;
  }
}

function beginSealArchiveConfirmation() {
  if (preventExistingSealActionWhileReplacing()) return;
  if (!sealCanArchive.value) return;
  sealArchiveConfirming.value = true;
}

function cancelSealArchiveConfirmation() {
  sealArchiveConfirming.value = false;
}

async function archiveSealedVerification() {
  if (preventExistingSealActionWhileReplacing()) return;
  if (
    !sealVerification.value ||
    !detail.value ||
    !sealCanArchive.value ||
    !sealArchiveConfirming.value
  ) {
    return;
  }
  clearSealVerificationError();
  actionLoading.value = true;
  try {
    const result = await archiveSealedContractVerification(
      contractId.value,
      sealVerification.value.id,
      detail.value.contract.version,
    );
    applySealWorkflowResult(result);
    ElMessage.success("盖章合同已归档，合同正式生效");
    activeTab.value = "overview";
    await loadDetail();
  } catch (error) {
    showSealVerificationError(error, "归档盖章合同失败");
  } finally {
    actionLoading.value = false;
  }
}

async function handleFinancialRegistrationCreated() {
  financialRegistrationTargetId.value = "";
  await loadDetail();
}

async function confirmFinancialCard(card: FinancialRegistrationCard) {
  const first = card.documents[0];
  if (!first) return;
  if (actionLoading.value) return;
  actionLoading.value = true;
  try {
    await ElMessageBox.confirm(
      card.registrationId
        ? "确认后发票和银行凭证将作为同一笔登记计入合同核算，只能整笔冲销。是否继续？"
        : "确认后该历史记录将计入合同核算，只能通过冲销撤销。是否继续？",
      card.registrationId ? "确认整笔财务登记" : "确认财务记录",
      {
        type: "warning",
        confirmButtonText: "确认入账",
        cancelButtonText: "取消",
      },
    );
    if (card.registrationId) {
      await confirmContractFinancialRegistration(
        contractId.value,
        card.registrationId,
      );
    } else {
      if (first.type === "externalPayments") return;
      await confirmContractRecord(
        contractId.value,
        first.type,
        first.record.id,
      );
    }
    ElMessage.success(
      card.registrationId
        ? "整笔财务登记已确认并计入核算"
        : "财务记录已确认并计入核算",
    );
    await loadDetail();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "财务记录确认失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function deleteFinancialCard(card: FinancialRegistrationCard) {
  const first = card.documents[0];
  if (!first) return;
  if (actionLoading.value) return;
  actionLoading.value = true;
  try {
    await ElMessageBox.confirm(
      card.registrationId
        ? "删除后发票和银行凭证草稿会一并移除且无法恢复，是否继续？"
        : "删除后无法恢复，是否删除该财务草稿？",
      card.registrationId ? "删除整笔财务登记" : "删除财务草稿",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    );
    if (card.registrationId) {
      await deleteContractFinancialRegistration(
        contractId.value,
        card.registrationId,
      );
    } else {
      if (first.type === "externalPayments") return;
      await deleteContractRecordDraft(
        contractId.value,
        first.type,
        first.record.id,
      );
    }
    ElMessage.success(
      card.registrationId ? "整笔财务登记草稿已删除" : "财务草稿已删除",
    );
    await loadDetail();
    await nextTick();
    await financialRegistrationPanelRef.value?.reloadPendingUploads();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "删除财务草稿失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function reverseFinancialCard(card: FinancialRegistrationCard) {
  const first = card.documents[0];
  if (!first) return;
  if (actionLoading.value) return;
  const reversesPostedSettlement =
    card.status === "draft" && hasConfirmedSettlement(card);
  const settlementAction = financialCardSettlementAction(card);
  actionLoading.value = true;
  try {
    const result = await ElMessageBox.prompt(
      reversesPostedSettlement
        ? `冲销后已计入的${settlementAction}将失效，登记及凭证继续保留审计痕迹，请填写冲销原因。`
        : card.registrationId
          ? "冲销后发票和银行凭证会作为同一笔登记一并失效，请填写冲销原因。"
          : "冲销后原记录会保留并标记失效，请填写冲销原因。",
      reversesPostedSettlement
        ? `冲销已${settlementAction}登记`
        : card.registrationId
          ? "冲销整笔财务登记"
          : "冲销财务记录",
      {
        type: "warning",
        inputType: "textarea",
        inputPlaceholder: "请输入冲销原因",
        inputValidator: (value) =>
          Boolean(String(value || "").trim()) || "冲销原因不能为空",
        confirmButtonText: "确认冲销",
        cancelButtonText: "取消",
      },
    );
    if (card.registrationId) {
      await reverseContractFinancialRegistration(
        contractId.value,
        card.registrationId,
        result.value.trim(),
      );
    } else {
      if (first.type === "externalPayments") return;
      await reverseContractRecord(
        contractId.value,
        first.type,
        first.record.id,
        result.value.trim(),
      );
    }
    ElMessage.success(
      reversesPostedSettlement
        ? `已${settlementAction}登记已冲销`
        : card.registrationId
          ? "整笔财务登记已冲销"
          : "财务记录已冲销",
    );
    await loadDetail();
  } catch (error) {
    if (error === "cancel" || error === "close") return;
    ElMessage.error(getContractErrorMessage(error, "财务记录冲销失败"));
  } finally {
    actionLoading.value = false;
  }
}

function openFile(fileId: string) {
  const file = detail.value?.files.find((item) => item.id === fileId);
  if (!file) return;
  if (canDirectDownload.value) {
    window.open(getContractFileUrl(file.id), "_blank", "noopener,noreferrer");
    liveStatus.value = `已在浏览器新页面打开“${file.fileName}”，可直接打印或保存`;
    return;
  }
  readonlyPreviewUrl.value = getContractFileUrl(file.id);
  readonlyPreviewFileName.value = file.fileName;
  readonlyPreviewMimeType.value = file.mimeType || "";
  readonlyPreviewFileId.value = file.id;
  readonlyPreviewVisible.value = true;
}

function closeReadonlyPreview() {
  readonlyPreviewVisible.value = false;
}

function downloadReadonlyPreview() {
  if (!canDirectDownload.value || !readonlyPreviewFileId.value) return;
  downloadFile(readonlyPreviewFileId.value);
}

function openDownloadRequest() {
  void router.push({
    path: "/contract-download-requests/new",
    query: { contractId: contractId.value },
  });
}

function downloadFile(fileId: string) {
  window.open(
    getContractFileUrl(fileId, true),
    "_blank",
    "noopener,noreferrer",
  );
}

function approvalActionLabel(action: string): string {
  return (
    {
      submit: "提交审批",
      approve: "审批通过",
      reject: "审批驳回",
      withdraw: "撤回审批",
      seal: "盖章归档",
      terminate: "合同终止",
      termination_request: "申请终止",
      seal_difference_submit: "提交盖章差异复审",
      comment: "审批备注",
    }[action] || action
  );
}

function fileTypeLabel(type: string): string {
  return (
    {
      source: "原始合同",
      draft_contract: "草拟合同",
      sealed: "盖章合同",
      sealed_contract: "盖章合同",
      seal_application: "用印申请单",
      triplicate: "三联单",
      payment_request: "请款单",
      invoice: "发票",
      receipt: "银行回单",
      payment: "银行回单",
      termination: "终止／解除协议",
      other: "补充资料",
    }[type] || type
  );
}

watch(
  contractId,
  (nextContractId) => {
    detailLoadSequence += 1;
    resetDetailViewState();
    if (nextContractId) void loadDetail();
  },
  { immediate: true },
);

watch(
  () => [
    route.query.tab,
    route.query.action,
    route.query.type,
    route.query.recordType,
  ],
  () => applyRouteIntent(),
);

onBeforeUnmount(() => {
  releaseSealedLocalPreview();
});
</script>

<style scoped>
.contract-detail-page {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 20px 30px 48px;
  background:
    radial-gradient(circle at 5% 2%, rgb(52 111 154 / 8%), transparent 22%),
    #f5f7fa;
  color: #1c3349;
}
.detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.detail-actions :deep(.el-button) {
  border-radius: 9px;
}
.seal-page-error {
  width: 100%;
  margin-bottom: 14px;
  scroll-margin-top: 12px;
}
.seal-page-error :deep(.el-alert) {
  border-radius: 12px;
  box-shadow: 0 8px 24px rgb(198 67 67 / 12%);
}
.seal-page-error :deep(.el-alert__content),
.seal-page-error :deep(.el-alert__description) {
  min-width: 0;
  overflow-wrap: anywhere;
}
.detail-skeleton {
  padding: 28px;
  border-radius: 12px;
  background: #fff;
}
.detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 26px 30px;
  overflow: hidden;
  border: 1px solid #dfe7ee;
  border-radius: 20px;
  background:
    radial-gradient(circle at 93% 5%, rgb(57 185 166 / 14%), transparent 32%),
    linear-gradient(135deg, #fff, #f6f9fc);
  box-shadow: 0 14px 36px rgb(31 55 78 / 8%);
}
.settlement-warning,
.seal-workflow-alert {
  margin-top: 14px;
  border-radius: 10px;
}
.seal-workspace-card {
  position: relative;
  overflow: hidden;
  padding: 24px;
  border-color: #d9e7e8;
  background:
    radial-gradient(circle at 96% 0%, rgb(49 155 144 / 11%), transparent 30%),
    linear-gradient(145deg, #fff, #f7fafb);
}
.seal-workspace-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.seal-workspace-kicker {
  color: #28847d;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.12em;
}
.seal-workspace-heading h2 {
  margin: 5px 0 0;
  color: #1e4057;
  font-size: 21px;
}
.seal-workspace-heading p {
  margin: 7px 0 0;
  color: #728697;
  font-size: 13px;
}
.seal-workflow-steps {
  margin: 26px 0 22px;
  padding: 18px 12px;
  border: 1px solid #e1eaec;
  border-radius: 14px;
  background: rgb(255 255 255 / 82%);
}
.seal-workspace-alert {
  margin-bottom: 16px;
  border-radius: 10px;
}
.seal-upload-status {
  margin-top: 4px;
  border-radius: 10px;
}
.seal-loading {
  min-height: 160px;
}
.seal-upload-stage {
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 0 4px;
}
.seal-upload-stage :deep(.el-form-item__content) {
  display: block;
}
.seal-upload-box {
  width: 100%;
  overflow: hidden;
  border: 1px dashed #a7c4cc;
  border-radius: 16px;
  background:
    radial-gradient(circle at 8% 10%, rgb(47 151 142 / 9%), transparent 34%),
    #fbfdfd;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}
.seal-upload-box:hover,
.seal-upload-box:focus-within {
  border-color: #39968e;
  box-shadow: 0 10px 28px rgb(41 105 119 / 11%);
}
.seal-upload-box.is-selected {
  border-style: solid;
  border-color: #b8d7d2;
  background: linear-gradient(135deg, #f7fcfb, #fff);
}
.seal-upload-box.is-uploading {
  opacity: 0.72;
}
.seal-upload-control,
.seal-upload-control :deep(.el-upload),
.seal-upload-control :deep(.el-upload-dragger) {
  width: 100%;
}
.seal-upload-control :deep(.el-upload-dragger) {
  min-height: 190px;
  padding: 0;
  border: 0;
  border-radius: 16px;
  background: transparent;
}
.seal-upload-empty {
  display: flex;
  min-height: 190px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 28px;
  text-align: center;
}
.seal-upload-empty-icon {
  display: inline-flex;
  width: 60px;
  height: 60px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  color: #2e8d85;
  background: #e8f5f3;
  box-shadow: inset 0 0 0 1px rgb(46 141 133 / 11%);
  font-size: 30px;
}
.seal-upload-empty strong {
  color: #264f5d;
  font-size: 15px;
}
.seal-upload-empty > span:last-child {
  color: #7b8f9a;
  font-size: 12px;
}
.seal-selected-file-card {
  display: grid;
  min-height: 164px;
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 18px;
  padding: 24px;
}
.seal-selected-file-icon {
  position: relative;
  display: inline-flex;
  width: 68px;
  height: 76px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 16px;
  color: #2c817b;
  background: linear-gradient(145deg, #e6f4f2, #d9eeeb);
  box-shadow: inset 0 0 0 1px rgb(44 129 123 / 10%);
  font-size: 31px;
}
.seal-selected-file-icon small {
  position: absolute;
  right: 7px;
  bottom: 7px;
  max-width: 52px;
  padding: 2px 5px;
  overflow: hidden;
  border-radius: 5px;
  color: #fff;
  background: #377f79;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-selected-file-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}
.seal-selected-file-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}
.seal-selected-file-title strong {
  min-width: 0;
  overflow: hidden;
  color: #244959;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-selected-file-info > span {
  color: #6f8491;
  font-size: 12px;
}
.seal-selected-file-info > small {
  color: #91a0aa;
  font-size: 11px;
}
.seal-selected-file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seal-selected-file-actions :deep(.el-button) {
  min-height: 40px;
  margin-left: 0;
}
.seal-upload-tip {
  margin-top: 8px;
  color: #85939d;
  font-size: 12px;
  line-height: 1.6;
}
.seal-file-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #e1e8ed;
  border-radius: 9px;
  background: #f7f9fb;
}
.seal-file-summary > span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  color: #38566d;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-party-section {
  margin: 20px 0;
}
.seal-section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.seal-section-heading h3 {
  margin: 0;
  color: #294b63;
  font-size: 16px;
}
.seal-section-heading p {
  margin: 5px 0 0;
  color: #7a8d9c;
  font-size: 12px;
}
.seal-party-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.seal-party-card {
  padding: 17px;
  border: 1px solid #dfe7eb;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 20px rgb(33 66 85 / 5%);
}
.seal-party-card.is-match {
  border-color: #bfdfd1;
  background: linear-gradient(145deg, #fff, #f3fbf7);
}
.seal-party-card.is-mismatch {
  border-color: #efc6bd;
  background: linear-gradient(145deg, #fff, #fff5f2);
}
.seal-party-card.is-missing {
  border-color: #ead9ad;
  background: linear-gradient(145deg, #fff, #fffbef);
}
.seal-party-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.seal-party-card-heading strong {
  color: #26475e;
  font-size: 15px;
}
.seal-party-card dl {
  display: grid;
  gap: 9px;
  margin: 15px 0 10px;
}
.seal-party-card dl > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
}
.seal-party-card dt {
  color: #8a99a5;
  font-size: 12px;
}
.seal-party-card dd {
  margin: 0;
  color: #29485e;
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.seal-party-card > p {
  margin: 0;
  color: #738693;
  font-size: 12px;
}
.seal-field-list {
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid #dfe6eb;
  border-radius: 10px;
}
.seal-lease-period {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 4px 12px;
  margin-bottom: 12px;
  padding: 11px 14px;
  border: 1px solid #cfe5e2;
  border-radius: 10px;
  background: #f3fbfa;
  color: #476979;
  font-size: 13px;
}
.seal-lease-period strong {
  color: #167d77;
}
.seal-lease-period small {
  grid-column: 2;
  color: #7a8d98;
  font-size: 11px;
}
.seal-field-header,
.seal-field-row {
  display: grid;
  min-width: 780px;
  grid-template-columns:
    110px minmax(160px, 1fr) minmax(180px, 1.1fr)
    minmax(260px, max-content);
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  text-align: center;
}
.seal-field-header {
  background: #eef3f6;
  color: #63798a;
  font-size: 12px;
  font-weight: 650;
}
.seal-field-row {
  border-top: 1px solid #e4e9ed;
  color: #607485;
  font-size: 12px;
}
.seal-field-row.mismatch {
  background: #fff8f4;
}
.seal-field-row.missing {
  background: #fffbef;
}
.seal-field-header > span,
.seal-field-row > span {
  min-width: 0;
  text-align: center;
}
.seal-field-row > span:first-child {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 4px;
}
.seal-field-header > span:last-child,
.seal-field-row > span:last-child {
  white-space: nowrap;
}
.seal-field-row strong {
  color: #294861;
}
.seal-mismatch-list {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid #f1c9bd;
  border-radius: 9px;
  background: #fff7f3;
  color: #9a4f3b;
}
.seal-mismatch-list > strong {
  color: #8b3f2d;
}
.seal-mismatch-list p {
  margin: 7px 0 0;
}
.seal-difference-form {
  margin-top: 16px;
}
.seal-workspace-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #e1e8eb;
}
.seal-archive-confirmation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 16px;
  padding: 15px 17px;
  border: 1px solid #bcdccd;
  border-radius: 12px;
  background: #f1faf6;
}
.seal-archive-confirmation strong {
  color: #2b6c58;
}
.seal-archive-confirmation p {
  margin: 4px 0 0;
  color: #6e877e;
  font-size: 12px;
}
.seal-archive-confirmation > div:last-child {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.hero-kicker {
  color: #238478;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.12em;
}
.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 5px;
}
.title-row h1 {
  margin: 0;
  color: #19344d;
  font-size: clamp(25px, 2.4vw, 34px);
}
.hero-main > p {
  margin: 5px 0 0;
  color: #8c98a4;
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 18px;
  margin-top: 18px;
  color: #687b8b;
  font-size: 12px;
}
.hero-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hero-amount {
  display: flex;
  min-width: 260px;
  flex-direction: column;
  align-items: flex-end;
  padding: 17px;
  border: 1px solid rgb(210 229 229 / 90%);
  border-radius: 15px;
  background: rgb(255 255 255 / 75%);
}
.hero-amount span {
  color: #7e909b;
  font-size: 12px;
}
.hero-amount strong {
  margin: 3px 0;
  color: #147b81;
  font-size: clamp(25px, 3vw, 38px);
}
.hero-amount small {
  color: #8b98a3;
}
.hero-amount.has-pending-change {
  min-width: 330px;
  border-color: #f2ce8f;
  background: #fffbf2;
}
.hero-amount .amount-before {
  color: #7b8790;
  text-decoration: line-through;
}
.hero-amount .amount-adjustment {
  color: #b7791f;
  font-weight: 600;
}
.supplement-amount-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, auto));
  gap: 3px 12px;
  margin-top: 5px;
  text-align: right;
}
.pending-supplement-amount-alert {
  margin-top: 15px;
}
.metric-grid {
  display: grid;
  grid-auto-columns: minmax(190px, 1fr);
  grid-auto-flow: column;
  gap: 12px;
  margin-top: 15px;
  overflow-x: auto;
}
.lifecycle-card {
  margin-top: 15px;
  padding: 15px;
  border: 1px solid #e0e7ed;
  border-radius: 12px;
  background: #fff;
}
.lifecycle-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 13px;
}
.lifecycle-heading > div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.lifecycle-heading strong {
  color: #344f61;
  font-size: 13px;
}
.lifecycle-heading small {
  color: #8a98a4;
  font-size: 11px;
}
.lifecycle-track {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.lifecycle-track.rejected-lifecycle {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.lifecycle-stage {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #98a2ac;
  font-size: 12px;
}
.lifecycle-stage::after {
  height: 1px;
  flex: 1;
  margin-right: 8px;
  background: #e0e6eb;
  content: "";
}
.lifecycle-stage:last-child::after {
  display: none;
}
.lifecycle-stage > span {
  display: inline-flex;
  width: 25px;
  height: 25px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #edf1f4;
  font-size: 11px;
}
.lifecycle-stage.complete,
.lifecycle-stage.active {
  color: #277b7d;
}
.lifecycle-stage.complete > span {
  background: #dff0e7;
  color: #42865c;
}
.lifecycle-stage.active > span {
  background: #247d82;
  color: #fff;
  box-shadow: 0 0 0 5px rgb(36 125 130 / 10%);
}
.lifecycle-stage.interrupted {
  color: #b84949;
}
.lifecycle-stage.interrupted > span {
  background: #c84f4f;
  color: #fff;
  box-shadow: 0 0 0 5px rgb(200 79 79 / 10%);
}
.lifecycle-stage.terminal {
  color: #b84949;
}
.lifecycle-stage.terminal > span {
  background: #c84f4f;
  color: #fff;
  box-shadow: 0 0 0 5px rgb(200 79 79 / 10%);
}
.detail-tabs {
  margin-top: 15px;
  padding: 4px 18px 18px;
  border: 1px solid #e1e7ed;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 30px rgb(31 49 68 / 5%);
}
.detail-tabs :deep(.el-tabs__header) {
  margin-bottom: 17px;
}
.overview-grid,
.finance-layout {
  display: grid;
  gap: 14px;
}
.overview-grid {
  grid-template-columns: minmax(0, 1fr);
}
.finance-layout {
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.55fr);
}
.content-card {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e4e9ee;
  border-radius: 12px;
  background: #fbfcfd;
}
.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 15px;
}
.card-heading > div {
  min-width: 0;
}
.card-heading h2 {
  margin: 0;
  color: #284760;
  font-size: 17px;
}
.card-heading span,
.card-heading div > span {
  color: #8d99a4;
  font-size: 11px;
}
.relation-tree {
  position: relative;
  display: grid;
  gap: 10px;
}
.relation-tree::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 20px;
  width: 2px;
  background: #dce8e8;
  content: "";
}
.relation-tree button {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid #e2e8ed;
  border-radius: 11px;
  background: #fff;
  color: #708090;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.relation-tree button:hover,
.relation-tree button:focus-visible {
  border-color: #79b6b3;
  outline: none;
  box-shadow: 0 6px 16px rgb(36 113 118 / 8%);
}
.relation-node {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: #e4f2f0;
  color: #237f80;
}
.relation-tree button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.relation-tree strong {
  overflow: hidden;
  color: #294961;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.relation-tree small {
  color: #8c99a5;
}
.relation-tree b {
  color: #1b7c82;
}
.relation-amount-chain {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-style: normal;
  white-space: nowrap;
}
.relation-amount-chain em {
  color: #277f73;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
.timeline-record {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 13px;
  border: 1px solid #e3e8ed;
  border-radius: 10px;
  background: #fff;
}
.timeline-record strong {
  color: #294861;
}
.timeline-record span {
  color: #85929e;
  font-size: 12px;
}
.approval-next-record {
  border-color: #efd6ae;
  background: #fffaf2;
}
.detail-approval-workspace-host {
  margin: 14px 0;
  scroll-margin-top: 84px;
}
.attachment-groups {
  display: grid;
  gap: 18px;
}
.attachment-group {
  display: grid;
  gap: 10px;
}
.attachment-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5ecef;
}
.attachment-group-heading h3 {
  margin: 0;
  color: #294860;
  font-size: 16px;
}
.attachment-group-heading span {
  color: #8494a2;
  font-size: 12px;
}
.attachment-source-group {
  display: grid;
  gap: 9px;
}
.attachment-source-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #f2f7f8;
}
.attachment-source-heading h4 {
  margin: 0;
  color: #356078;
  font-size: 13px;
  white-space: nowrap;
}
.attachment-source-heading span {
  overflow: hidden;
  color: #7e909e;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.file-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e2e8ed;
  border-radius: 11px;
  background: #fff;
}
.file-card:hover,
.file-card:focus-within {
  border-color: #79b6b3;
}
.file-card-preview {
  display: grid;
  min-width: 0;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: #8996a2;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.file-card-preview:focus-visible {
  border-radius: 8px;
  outline: 2px solid #79b6b3;
  outline-offset: 2px;
}
.file-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.file-actions :deep(.el-button) {
  margin-left: 0;
}
.file-icon {
  display: inline-flex;
  width: 46px;
  height: 46px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: #e8f2f2;
  color: #247e81;
  font-size: 21px;
}
.file-card-preview > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.file-grid strong {
  overflow: hidden;
  color: #294860;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-grid small {
  color: #929da7;
}
.finance-layout {
  grid-template-columns: minmax(0, 1.35fr) minmax(330px, 0.65fr);
}
.record-columns {
  display: grid;
  gap: 12px;
}
.record-group {
  padding: 13px;
  border: 1px solid #e4e9ee;
  border-radius: 11px;
  background: #fff;
}
.financial-registration-record.reversed {
  opacity: 0.66;
}
.registration-record-documents {
  display: grid;
  gap: 8px;
}
.registration-record-document {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 9px;
  background: #f6f8fa;
}
.document-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  border-radius: 7px;
  background: #e7f3f2;
  color: #287e7b;
  font-size: 12px;
  font-weight: 650;
}
.document-summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.document-summary small {
  color: #8996a2;
  overflow-wrap: anywhere;
  white-space: normal;
}
.registration-balance-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #d9e9e7;
  border-radius: 9px;
  background: #f4faf9;
  color: #536978;
}
.registration-balance-summary span {
  display: inline-flex;
  gap: 6px;
}
.registration-balance-summary strong {
  color: #0b7d78;
}
.registration-balance-summary .is-pending strong {
  color: #bd7b16;
}
.registration-record-actions {
  margin-top: 10px;
}
.registration-match-list {
  display: grid;
  gap: 7px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #d9e9e7;
  border-radius: 9px;
  background: #f4faf9;
}
.registration-match-list > strong {
  color: #31536a;
}
.registration-match-row {
  display: grid;
  grid-template-columns: 28px minmax(160px, 1fr) auto minmax(160px, 1fr) auto;
  align-items: center;
  gap: 10px;
  color: #536978;
}
.registration-match-row > span:first-child {
  text-align: center;
  color: #8a99a4;
}
.registration-match-row > strong {
  color: #0b7d78;
  white-space: nowrap;
}
.match-arrow {
  color: #2f908b;
  font-size: 12px;
  white-space: nowrap;
}
.record-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}
.record-group-heading > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #31536a;
  font-weight: 650;
}
.record-list {
  display: grid;
  gap: 7px;
}
.record-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  background: #f6f8fa;
}
.record-list > div.reversed {
  opacity: 0.62;
  text-decoration: line-through;
}
.record-list > div > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.record-list strong {
  color: #217a80;
}
.record-list small {
  overflow: hidden;
  color: #8996a2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
}
.accounting-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.accounting-summary > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 11px;
  border-radius: 9px;
  background: #edf6f5;
}
.accounting-summary span {
  color: #72898d;
  font-size: 11px;
}
.accounting-summary strong {
  overflow: hidden;
  color: #247a7e;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rental-cost-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.vehicle-rental-accounting-summary {
  grid-template-columns: minmax(0, 1fr);
}
.rental-cost-group {
  overflow: hidden;
  border: 1px solid #dce9e7;
  border-radius: 10px;
  background: #fafdfc;
}
.rental-cost-group header,
.rental-cost-group > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  color: #647b85;
  font-size: 12px;
}
.rental-cost-group header {
  background: #edf7f5;
  color: #355e66;
  font-weight: 700;
}
.rental-cost-group.outside-scope header {
  background: #fff7ea;
  color: #8a6428;
}
.rental-cost-group > div + div {
  border-top: 1px dashed #dce9e7;
}
.rental-cost-group strong {
  color: #176f72;
  font-size: 13px;
  white-space: nowrap;
}
.rental-cost-group header strong {
  font-size: 18px;
}
.rental-cost-group.outside-scope strong {
  color: #9b681d;
}
.accounting-lines {
  display: grid;
  gap: 2px;
  margin: 14px 0;
}
.accounting-lines > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 1px dashed #e0e6ea;
}
.accounting-lines span {
  color: #667987;
}
.accounting-lines small {
  margin-left: 5px;
  color: #9aa4ae;
}
.accounting-lines strong {
  color: #31536a;
}
.accounting-lines .emphasized {
  margin-top: 4px;
  padding: 11px;
  border: 0;
  border-radius: 8px;
  background: #e5f2ef;
}
.accounting-lines .emphasized strong {
  color: #147b79;
  font-size: 16px;
}
.finance-registration-workspace {
  margin-bottom: 14px;
}
.asset-financial-chain {
  margin-bottom: 14px;
  border-color: #cfe4e1;
  background: linear-gradient(135deg, #f8fcfb, #f3f8fb);
}
.asset-chain-track {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.asset-chain-track article {
  display: flex;
  min-width: 190px;
  flex: 1 0 190px;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 13px;
  border: 1px solid #d9e8e6;
  border-radius: 10px;
  background: #fff;
  text-align: center;
}
.asset-chain-track article.accounting-result {
  border-color: #9fd2ca;
}
.asset-chain-track article strong {
  color: #294e61;
  font-size: 13px;
}
.asset-chain-track article small {
  color: #7f929c;
  font-size: 11px;
}
.asset-chain-track > span {
  display: flex;
  min-width: 118px;
  flex: 0 0 118px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #268b84;
  text-align: center;
}
.asset-chain-track > span::after {
  color: #54aaa3;
  content: "→";
  font-size: 22px;
  line-height: 1;
}
.asset-chain-track > span b {
  font-size: 11px;
}
.asset-chain-track > span small {
  color: #8a9aa3;
  font-size: 10px;
}
.asset-financial-chain > p {
  margin: 10px 0 0;
  color: #748992;
  font-size: 11px;
  line-height: 1.7;
}
.sr-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.auxiliary-setting-tip {
  display: inline-block;
  margin-left: 10px;
  color: #b56b18;
  font-size: 12px;
}

@media (max-width: 1366px) {
  .contract-detail-page {
    margin: -16px -20px;
    padding: 18px 20px 42px;
  }
}

@media (max-width: 980px) {
  .detail-hero,
  .overview-grid,
  .finance-layout {
    grid-template-columns: 1fr;
  }
  .hero-amount {
    min-width: 0;
    align-items: flex-start;
  }
  .lifecycle-track {
    overflow-x: auto;
    grid-template-columns: repeat(6, minmax(130px, 1fr));
  }
  .lifecycle-track.rejected-lifecycle {
    grid-template-columns: repeat(3, minmax(130px, 1fr));
  }
}

@media (max-width: 768px) {
  .contract-detail-page {
    margin: -16px -20px;
    padding: 14px;
  }
  .asset-chain-track {
    align-items: stretch;
    flex-direction: column;
    overflow-x: visible;
  }
  .asset-chain-track article,
  .asset-chain-track > span {
    min-width: 0;
    flex: none;
    width: 100%;
  }
  .asset-chain-track > span::after {
    content: "↓";
  }
  .detail-topbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .detail-actions {
    justify-content: flex-start;
  }
  .detail-hero {
    padding: 20px;
    border-radius: 16px;
  }
  .hero-meta {
    flex-direction: column;
  }
  .detail-tabs {
    padding: 4px 12px 12px;
  }
  .detail-tabs :deep(.el-tabs__nav-wrap) {
    overflow-x: auto;
  }
  .content-card {
    padding: 13px;
  }
  .attachment-groups {
    gap: 15px;
  }
  .attachment-group-heading {
    align-items: flex-start;
  }
  .attachment-source-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
  .attachment-source-heading span {
    max-width: 100%;
  }
  .seal-workspace-heading,
  .seal-archive-confirmation {
    align-items: flex-start;
    flex-direction: column;
  }
  .seal-workspace-heading :deep(.el-tag) {
    white-space: normal;
  }
  .seal-workflow-steps {
    padding: 14px 0;
  }
  .seal-workflow-steps :deep(.el-step__title) {
    font-size: 11px;
  }
  .seal-selected-file-card {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 13px;
    padding: 18px;
  }
  .seal-selected-file-icon {
    width: 58px;
    height: 66px;
  }
  .seal-selected-file-actions {
    grid-column: 1 / -1;
  }
  .seal-selected-file-actions :deep(.el-button) {
    flex: 1;
  }
  .seal-party-grid {
    grid-template-columns: 1fr;
  }
  .seal-party-card dl > div {
    grid-template-columns: 1fr;
    gap: 3px;
  }
  .seal-workspace-actions {
    justify-content: stretch;
  }
  .seal-workspace-actions :deep(.el-button) {
    flex: 1 1 140px;
    margin-left: 0;
  }
  .seal-archive-confirmation > div:last-child {
    width: 100%;
    flex-wrap: wrap;
  }
  .relation-tree button {
    grid-template-columns: 42px minmax(0, 1fr);
  }
  .relation-tree button > b,
  .relation-tree button > .relation-amount-chain,
  .relation-tree button > .el-tag {
    grid-column: 2;
  }
  .accounting-summary {
    grid-template-columns: 1fr;
  }
  .rental-cost-groups {
    grid-template-columns: 1fr;
  }
  .registration-record-document {
    grid-template-columns: 1fr;
  }
  .document-kind {
    justify-self: flex-start;
  }
  .seal-file-summary {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .relation-tree button,
  .file-card {
    transition: none;
  }
}
</style>
