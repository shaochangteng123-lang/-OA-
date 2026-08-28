<template>
  <section
    v-if="panelVisible"
    class="contract-deposit-management"
    aria-labelledby="contract-deposit-management-title"
  >
    <header class="deposit-heading">
      <div>
        <div class="deposit-title-row">
          <h2 id="contract-deposit-management-title">押金管理</h2>
          <el-tag type="warning" effect="plain">高概率存在押金</el-tag>
        </div>
        <p>
          {{
            subtypeLabel
          }}属于租赁类二级分类，系统优先提示核对押金；是否建立记录及金额仍以合同原文为准。
        </p>
      </div>
      <el-button
        v-if="snapshot.deposit && canManage && !editing"
        link
        type="primary"
        @click="startEditing"
      >
        修改登记
      </el-button>
    </header>

    <el-skeleton v-if="loading" :rows="4" animated />
    <el-alert
      v-else-if="loadError"
      type="error"
      show-icon
      :closable="false"
      :title="loadError"
    >
      <template #default>
        <el-button link type="danger" @click="loadDeposit">重新加载</el-button>
      </template>
    </el-alert>

    <template v-else>
      <el-alert
        v-if="!snapshot.deposit && !canManage"
        type="info"
        show-icon
        :closable="false"
        title="尚未建立押金记录"
        description="请由管理员核对合同原文；不能只因合同属于租赁类就直接确认押金。"
      />

      <form
        v-if="canManage && (!snapshot.deposit || editing)"
        class="deposit-form"
        @submit.prevent="saveDeposit"
      >
        <div class="deposit-form-heading">
          <strong>{{
            snapshot.deposit ? "修改押金登记" : "建立押金记录"
          }}</strong>
          <span>合同条款确认与实际付款信息分开留痕</span>
        </div>
        <div class="deposit-form-grid">
          <el-form-item label="押金金额（必填）">
            <el-input
              v-model="recordForm.amount"
              class="deposit-amount-input"
              inputmode="decimal"
              placeholder="请输入合同明确约定的押金金额"
              :disabled="saving"
            >
              <template #prepend>¥</template>
            </el-input>
          </el-form-item>
          <el-form-item label="支付用途">
            <el-input model-value="租赁押金" disabled />
          </el-form-item>
          <el-form-item label="资金来源">
            <el-select
              v-model="recordForm.fundingSource"
              class="funding-source-select"
              :disabled="saving"
            >
              <el-option
                v-for="option in fundingSourceOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <template v-if="recordForm.fundingSource === 'mixed'">
            <el-form-item label="工程划拨金额（必填）">
              <el-input
                v-model="recordForm.engineeringAllocationAmount"
                class="engineering-allocation-amount-input"
                inputmode="decimal"
                :disabled="saving"
              >
                <template #prepend>¥</template>
              </el-input>
            </el-form-item>
            <el-form-item
              :label="`${contractCompanyDisplayName}自有资金金额（必填）`"
            >
              <el-input
                v-model="recordForm.technologySelfFundedAmount"
                class="technology-self-funded-amount-input"
                inputmode="decimal"
                :disabled="saving"
              >
                <template #prepend>¥</template>
              </el-input>
            </el-form-item>
          </template>
          <el-form-item class="full-row" label="合同押金条款">
            <el-input
              v-model="recordForm.clauseText"
              class="deposit-clause-input"
              type="textarea"
              :rows="3"
              maxlength="1000"
              show-word-limit
              placeholder="摘录合同中的押金、保证金、押几付几或退还约定"
              :disabled="saving"
            />
          </el-form-item>
          <el-form-item class="full-row" label="计算依据">
            <el-input
              v-model="recordForm.basis"
              placeholder="例如：三个月租金及物业费"
              maxlength="300"
              :disabled="saving"
            />
          </el-form-item>
          <el-form-item class="full-row" label="备注">
            <el-input
              v-model="recordForm.note"
              type="textarea"
              :rows="2"
              maxlength="500"
              :disabled="saving"
            />
          </el-form-item>
        </div>
        <el-alert
          v-if="recordValidationMessage"
          type="warning"
          show-icon
          :closable="false"
          :title="recordValidationMessage"
        />
        <div class="deposit-form-actions">
          <el-button
            v-if="snapshot.deposit"
            :disabled="saving"
            @click="cancelEditing"
          >
            取消
          </el-button>
          <el-button
            native-type="submit"
            type="primary"
            :loading="saving"
            :disabled="!recordFormValid"
          >
            {{ snapshot.deposit ? "保存修改" : "确认建立" }}
          </el-button>
        </div>
      </form>

      <template v-if="snapshot.deposit && !editing">
        <div class="deposit-summary" aria-label="押金余额概览">
          <div>
            <span>押金金额</span>
            <strong>{{ formatContractMoney(snapshot.deposit.amount) }}</strong>
          </div>
          <div>
            <span>已结算</span>
            <strong>{{
              formatContractMoney(snapshot.deposit.settledAmount)
            }}</strong>
          </div>
          <div class="remaining">
            <span>待结算</span>
            <strong>{{
              formatContractMoney(snapshot.deposit.remainingAmount)
            }}</strong>
          </div>
          <div>
            <span>状态</span>
            <el-tag :type="depositStatusTagType" effect="plain">
              {{ depositStatusLabel }}
            </el-tag>
          </div>
          <div
            v-if="moneyToCents(snapshot.deposit.pendingEngineeringReturn) > 0"
            class="engineering-return"
          >
            <span>待退工程金额</span>
            <strong>{{
              formatContractMoney(snapshot.deposit.pendingEngineeringReturn)
            }}</strong>
          </div>
        </div>

        <dl class="deposit-facts">
          <div>
            <dt>二级分类判断</dt>
            <dd>{{ subtypeLabel }} · 优先核对押金</dd>
          </div>
          <div>
            <dt>合同计算依据</dt>
            <dd>{{ snapshot.deposit.basis || "未记录" }}</dd>
          </div>
          <div>
            <dt>支付用途</dt>
            <dd>租赁押金</dd>
          </div>
          <div>
            <dt>资金来源</dt>
            <dd>{{ fundingSourceLabel(snapshot.deposit.fundingSource) }}</dd>
          </div>
          <div v-if="snapshot.deposit.fundingSource === 'mixed'">
            <dt>混合来源拆分</dt>
            <dd>
              工程划拨
              {{
                formatContractMoney(
                  snapshot.deposit.engineeringAllocationAmount,
                )
              }}
              · {{ contractCompanyDisplayName }}自有
              {{
                formatContractMoney(snapshot.deposit.technologySelfFundedAmount)
              }}
            </dd>
          </div>
          <div>
            <dt>关联付款</dt>
            <dd>{{ paymentRecordLabel }}</dd>
          </div>
          <div>
            <dt>实际支付日期</dt>
            <dd>{{ formatContractDate(snapshot.deposit.paidAt) }}</dd>
          </div>
          <div class="full-row">
            <dt>合同押金条款</dt>
            <dd>{{ snapshot.deposit.clauseText || "未记录" }}</dd>
          </div>
        </dl>

        <el-alert
          v-if="snapshot.deposit.fundingSource === 'pending_review'"
          type="warning"
          show-icon
          :closable="false"
          title="资金来源待核对"
          :description="`请根据实际付款及划拨回单确认工程划拨、${contractCompanyDisplayName}自有或混合来源后，再办理押金结算。`"
        />

        <section
          v-if="canManage && moneyToCents(snapshot.deposit.remainingAmount) > 0"
          class="deposit-settlement"
          aria-labelledby="deposit-settlement-title"
        >
          <div class="deposit-form-heading">
            <strong id="deposit-settlement-title">押金结算</strong>
            <span>支持部分退回、扣款和抵租金组合，可分次登记直至结清</span>
          </div>
          <form class="settlement-form" @submit.prevent="submitSettlement">
            <el-form-item label="结算方式">
              <el-select
                v-model="settlementForm.type"
                class="settlement-type-select"
                :disabled="settling || !canSettle"
              >
                <el-option label="原路退回" value="refund" />
                <el-option label="扣款" value="deduction" />
                <el-option label="抵租金" value="rent_offset" />
              </el-select>
            </el-form-item>
            <el-form-item label="结算金额">
              <el-input
                v-model="settlementForm.amount"
                class="settlement-amount-input"
                inputmode="decimal"
                :placeholder="
                  settlementForm.type === 'refund'
                    ? '上传回单后自动识别'
                    : '请输入结算金额'
                "
                :disabled="
                  settling || !canSettle || settlementForm.type === 'refund'
                "
              >
                <template #prepend>¥</template>
              </el-input>
            </el-form-item>
            <el-form-item label="结算日期">
              <el-date-picker
                v-model="settlementForm.settlementDate"
                type="date"
                value-format="YYYY-MM-DD"
                :placeholder="
                  settlementForm.type === 'refund'
                    ? '上传回单后自动识别'
                    : '请选择结算日期'
                "
                :disabled="
                  settling || !canSettle || settlementForm.type === 'refund'
                "
              />
            </el-form-item>
            <el-form-item
              class="settlement-note"
              :label="
                settlementForm.type === 'refund'
                  ? '结算说明'
                  : '结算说明（必填）'
              "
            >
              <el-input
                v-model="settlementForm.note"
                :placeholder="
                  settlementForm.type === 'refund'
                    ? '退回说明（选填）'
                    : '请填写扣款或抵租金的依据'
                "
                maxlength="500"
                :disabled="settling || !canSettle"
              />
            </el-form-item>
            <el-form-item
              v-if="settlementForm.type === 'refund'"
              class="settlement-receipt-field"
              label="押金退回银行回单（必填）"
            >
              <div class="receipt-selector">
                <el-upload
                  ref="settlementUploadRef"
                  :auto-upload="false"
                  :show-file-list="false"
                  :disabled="
                    settling ||
                    !canSettle ||
                    settlementReceiptRecognizing ||
                    settlementReceiptRemoving
                  "
                  :on-change="handleSettlementReceiptChange"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                >
                  <el-button
                    :disabled="
                      settling ||
                      !canSettle ||
                      settlementReceiptRecognizing ||
                      settlementReceiptRemoving
                    "
                  >
                    <el-icon><Upload /></el-icon>
                    {{ settlementReceiptFile ? "重新选择" : "选择回单" }}
                  </el-button>
                </el-upload>
                <div
                  v-if="settlementReceiptFile"
                  class="selected-receipt-entry"
                >
                  <span class="selected-receipt">
                    <el-icon><Document /></el-icon>
                    {{ settlementReceiptFile.name }}
                  </span>
                  <a
                    v-if="settlementReceiptPreviewUrl"
                    class="local-receipt-preview-link"
                    :href="settlementReceiptPreviewUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    预览
                  </a>
                  <el-button
                    link
                    type="danger"
                    :loading="settlementReceiptRemoving"
                    :disabled="settling || settlementReceiptRemoving"
                    @click="removeSettlementReceipt()"
                  >
                    移除
                  </el-button>
                  <el-tag
                    v-if="settlementReceiptRecognizing"
                    type="warning"
                    effect="plain"
                  >
                    回单识别中
                  </el-tag>
                  <el-tag
                    v-else-if="settlementReceiptRecognition"
                    :type="
                      settlementReceiptRecognition.canConfirm
                        ? 'success'
                        : 'danger'
                    "
                    effect="plain"
                  >
                    {{
                      settlementReceiptRecognition.canConfirm
                        ? "回单校验通过"
                        : "回单校验未通过"
                    }}
                  </el-tag>
                </div>
                <small v-else class="receipt-help">
                  选择后自动识别，识别通过后才能确认结算
                </small>
              </div>
              <dl
                v-if="settlementReceiptRecognition"
                class="return-receipt-fields"
              >
                <div>
                  <dt>识别金额</dt>
                  <dd>
                    {{
                      formatContractMoney(
                        settlementReceiptRecognition.fields.amount,
                        "未识别",
                      )
                    }}
                  </dd>
                </div>
                <div>
                  <dt>交易日期</dt>
                  <dd>
                    {{
                      formatContractDate(
                        settlementReceiptRecognition.fields.paymentTime,
                      )
                    }}
                  </dd>
                </div>
                <div>
                  <dt>电子回单号</dt>
                  <dd>
                    {{
                      settlementReceiptRecognition.fields.electronicReceiptNo ||
                      "未识别"
                    }}
                  </dd>
                </div>
                <div>
                  <dt>付款方</dt>
                  <dd>
                    {{ settlementReceiptRecognition.fields.payer || "未识别" }}
                    ·
                    {{
                      settlementReceiptRecognition.fields.payerAccount ||
                      "未识别账号"
                    }}
                  </dd>
                </div>
                <div>
                  <dt>收款方</dt>
                  <dd>
                    {{ settlementReceiptRecognition.fields.payee || "未识别" }}
                    ·
                    {{
                      settlementReceiptRecognition.fields.payeeAccount ||
                      "未识别账号"
                    }}
                  </dd>
                </div>
              </dl>
              <small
                v-if="
                  settlementReceiptRecognition &&
                  !settlementReceiptRecognition.canConfirm
                "
                class="receipt-recognition-error"
              >
                {{
                  returnReceiptRecognitionMessage(settlementReceiptRecognition)
                }}
              </small>
            </el-form-item>
            <el-button
              native-type="submit"
              type="primary"
              :loading="settling"
              :disabled="!settlementFormValid"
            >
              确认结算
            </el-button>
          </form>
          <p v-if="settlementValidationMessage" class="validation-hint">
            {{ settlementValidationMessage }}
          </p>
        </section>

        <section
          v-if="snapshot.deposit.settlements.length"
          class="deposit-history"
          aria-label="押金结算记录"
        >
          <strong>结算记录</strong>
          <article v-for="item in snapshot.deposit.settlements" :key="item.id">
            <el-tag effect="plain">{{ settlementTypeLabel(item.type) }}</el-tag>
            <span>{{ formatContractDate(item.settlementDate) }}</span>
            <strong>{{ formatContractMoney(item.amount) }}</strong>
            <small>{{ item.note || "无备注" }}</small>
            <div v-if="item.refundReceipt" class="settlement-receipts">
              <span>押金退回银行回单</span>
              <div class="receipt-file-entry">
                <a
                  v-if="item.refundReceipt.fileUrl"
                  class="receipt-file-link"
                  :href="item.refundReceipt.fileUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <el-icon><Document /></el-icon>
                  <span>{{ item.refundReceipt.fileName }}</span>
                  <small>在线预览</small>
                </a>
                <span v-else class="receipt-file-link is-disabled">
                  <el-icon><Document /></el-icon>
                  {{ item.refundReceipt.fileName }} · 暂无预览地址
                </span>
                <el-button
                  v-if="canManage"
                  link
                  type="danger"
                  :disabled="Boolean(receiptDeletingKey)"
                  @click="requestReceiptDelete(item.id, item.refundReceipt.id)"
                >
                  删除回单
                </el-button>
                <div
                  v-if="
                    receiptDeleteConfirmationKey ===
                    settlementReceiptKey(item.id, item.refundReceipt.id)
                  "
                  class="receipt-delete-confirmation"
                >
                  <span>确认删除这张回单？结算记录仍会保留。</span>
                  <el-button
                    link
                    :disabled="Boolean(receiptDeletingKey)"
                    @click="cancelReceiptDelete"
                  >
                    取消
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    :loading="
                      receiptDeletingKey ===
                      settlementReceiptKey(item.id, item.refundReceipt.id)
                    "
                    @click="deleteSavedReceipt(item.id, item.refundReceipt.id)"
                  >
                    确认删除
                  </el-button>
                </div>
              </div>
            </div>
            <div
              v-else-if="item.type === 'refund' && canManage"
              class="settlement-receipts missing-refund-receipt"
            >
              <span>押金退回银行回单</span>
              <small
                >该历史退款尚未上传回单，支持图片或 PDF（便携式文档格式）</small
              >
              <el-upload
                :key="`${item.id}-${refundReceiptUploadVersions[item.id] || 0}`"
                :auto-upload="false"
                :show-file-list="false"
                :disabled="
                  Boolean(refundReceiptUploadingId) ||
                  settling ||
                  engineeringReturning
                "
                :on-change="
                  (uploadFile: UploadFile) =>
                    handleMissingRefundReceiptChange(item.id, uploadFile)
                "
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              >
                <el-button
                  link
                  type="primary"
                  :loading="refundReceiptUploadingId === item.id"
                  :disabled="
                    Boolean(refundReceiptUploadingId) ||
                    settling ||
                    engineeringReturning
                  "
                >
                  <el-icon><Upload /></el-icon>
                  补充退回回单
                </el-button>
              </el-upload>
            </div>
            <div
              v-if="item.engineeringReturnReceipts.length"
              class="settlement-receipts"
            >
              <span>退工程回单</span>
              <div
                v-for="receipt in item.engineeringReturnReceipts"
                :key="receipt.id"
                class="receipt-file-entry"
              >
                <a
                  class="receipt-file-link"
                  :class="{ 'is-disabled': !receipt.fileUrl }"
                  :href="receipt.fileUrl || undefined"
                  :target="receipt.fileUrl ? '_blank' : undefined"
                  :rel="receipt.fileUrl ? 'noopener noreferrer' : undefined"
                >
                  <el-icon><Document /></el-icon>
                  <span>{{ receipt.fileName }}</span>
                  <small>{{
                    receipt.fileUrl ? "在线预览" : "暂无预览地址"
                  }}</small>
                </a>
                <el-button
                  v-if="canManage"
                  link
                  type="danger"
                  :disabled="Boolean(receiptDeletingKey)"
                  @click="requestReceiptDelete(item.id, receipt.id)"
                >
                  删除回单
                </el-button>
                <div
                  v-if="
                    receiptDeleteConfirmationKey ===
                    settlementReceiptKey(item.id, receipt.id)
                  "
                  class="receipt-delete-confirmation"
                >
                  <span>确认删除这张回单？结算记录仍会保留。</span>
                  <el-button
                    link
                    :disabled="Boolean(receiptDeletingKey)"
                    @click="cancelReceiptDelete"
                  >
                    取消
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    :loading="
                      receiptDeletingKey ===
                      settlementReceiptKey(item.id, receipt.id)
                    "
                    @click="deleteSavedReceipt(item.id, receipt.id)"
                  >
                    确认删除
                  </el-button>
                </div>
              </div>
            </div>
            <small
              v-if="moneyToCents(item.engineeringReturnRequiredAmount) > 0"
              class="engineering-return-status"
            >
              应退工程
              {{
                formatContractMoney(item.engineeringReturnRequiredAmount)
              }}，已退工程
              {{ formatContractMoney(item.engineeringReturnedAmount) }}
            </small>
            <div
              v-if="engineeringReturnRemainingCents(item) > 0"
              class="engineering-return-workspace"
            >
              <div>
                <span>待退工程</span>
                <strong>{{
                  formatContractMoney(
                    engineeringReturnRemainingCents(item) / 100,
                  )
                }}</strong>
              </div>
              <el-button
                v-if="canManage && activeEngineeringReturnId !== item.id"
                link
                type="primary"
                @click="startEngineeringReturn(item)"
              >
                登记退工程
              </el-button>
              <form
                v-if="canManage && activeEngineeringReturnId === item.id"
                class="engineering-return-form"
                @submit.prevent="submitEngineeringReturn(item)"
              >
                <el-input
                  v-model="engineeringReturnForm.amount"
                  class="engineering-return-amount-input"
                  inputmode="decimal"
                  placeholder="上传回单后自动识别金额"
                  disabled
                >
                  <template #prepend>¥</template>
                </el-input>
                <el-date-picker
                  v-model="engineeringReturnForm.returnDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="上传回单后自动识别日期"
                  disabled
                />
                <el-input
                  v-model="engineeringReturnForm.note"
                  placeholder="退回说明（选填）"
                  maxlength="500"
                  :disabled="engineeringReturning"
                />
                <div class="engineering-return-receipt-field">
                  <span>退工程回单（必填）</span>
                  <div class="receipt-selector">
                    <el-upload
                      ref="engineeringReturnUploadRef"
                      :auto-upload="false"
                      :show-file-list="false"
                      :disabled="
                        engineeringReturning ||
                        engineeringReturnReceiptRecognizing ||
                        engineeringReturnReceiptRemoving
                      "
                      :on-change="handleEngineeringReturnReceiptChange"
                      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    >
                      <el-button
                        :disabled="
                          engineeringReturning ||
                          engineeringReturnReceiptRecognizing ||
                          engineeringReturnReceiptRemoving
                        "
                      >
                        <el-icon><Upload /></el-icon>
                        {{
                          engineeringReturnReceiptFile ? "重新选择" : "选择回单"
                        }}
                      </el-button>
                    </el-upload>
                    <div
                      v-if="engineeringReturnReceiptFile"
                      class="selected-receipt-entry"
                    >
                      <span class="selected-receipt">
                        <el-icon><Document /></el-icon>
                        {{ engineeringReturnReceiptFile.name }}
                      </span>
                      <a
                        v-if="engineeringReturnReceiptPreviewUrl"
                        class="local-receipt-preview-link"
                        :href="engineeringReturnReceiptPreviewUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        预览
                      </a>
                      <el-button
                        link
                        type="danger"
                        :loading="engineeringReturnReceiptRemoving"
                        :disabled="
                          engineeringReturning ||
                          engineeringReturnReceiptRemoving
                        "
                        @click="removeEngineeringReturnReceipt()"
                      >
                        移除
                      </el-button>
                      <el-tag
                        v-if="engineeringReturnReceiptRecognizing"
                        type="warning"
                        effect="plain"
                      >
                        回单识别中
                      </el-tag>
                      <el-tag
                        v-else-if="engineeringReturnReceiptRecognition"
                        :type="
                          engineeringReturnReceiptRecognition.canConfirm
                            ? 'success'
                            : 'danger'
                        "
                        effect="plain"
                      >
                        {{
                          engineeringReturnReceiptRecognition.canConfirm
                            ? "回单校验通过"
                            : "回单校验未通过"
                        }}
                      </el-tag>
                    </div>
                    <small v-else class="receipt-help">
                      选择后自动识别，识别通过后才能确认退回
                    </small>
                  </div>
                  <dl
                    v-if="engineeringReturnReceiptRecognition"
                    class="return-receipt-fields"
                  >
                    <div>
                      <dt>识别金额</dt>
                      <dd>
                        {{
                          formatContractMoney(
                            engineeringReturnReceiptRecognition.fields.amount,
                            "未识别",
                          )
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>交易日期</dt>
                      <dd>
                        {{
                          formatContractDate(
                            engineeringReturnReceiptRecognition.fields
                              .paymentTime,
                          )
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>电子回单号</dt>
                      <dd>
                        {{
                          engineeringReturnReceiptRecognition.fields
                            .electronicReceiptNo || "未识别"
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>付款方</dt>
                      <dd>
                        {{
                          engineeringReturnReceiptRecognition.fields.payer ||
                          "未识别"
                        }}
                        ·
                        {{
                          engineeringReturnReceiptRecognition.fields
                            .payerAccount || "未识别账号"
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>收款方</dt>
                      <dd>
                        {{
                          engineeringReturnReceiptRecognition.fields.payee ||
                          "未识别"
                        }}
                        ·
                        {{
                          engineeringReturnReceiptRecognition.fields
                            .payeeAccount || "未识别账号"
                        }}
                      </dd>
                    </div>
                  </dl>
                  <small
                    v-if="
                      engineeringReturnReceiptRecognition &&
                      !engineeringReturnReceiptRecognition.canConfirm
                    "
                    class="receipt-recognition-error"
                  >
                    {{
                      returnReceiptRecognitionMessage(
                        engineeringReturnReceiptRecognition,
                      )
                    }}
                  </small>
                </div>
                <div class="engineering-return-actions">
                  <small
                    v-if="engineeringReturnValidationMessage(item)"
                    class="validation-hint engineering-validation-hint"
                  >
                    {{ engineeringReturnValidationMessage(item) }}
                  </small>
                  <el-button
                    :disabled="engineeringReturning"
                    @click="cancelEngineeringReturn"
                  >
                    取消
                  </el-button>
                  <el-button
                    native-type="submit"
                    type="primary"
                    :loading="engineeringReturning"
                    :disabled="!engineeringReturnFormValid(item)"
                  >
                    确认退回
                  </el-button>
                </div>
              </form>
            </div>
          </article>
        </section>
      </template>

      <el-alert
        v-if="actionError"
        class="action-error"
        type="error"
        show-icon
        closable
        :title="actionError"
        @close="actionError = ''"
      />
      <p class="deposit-rule-note">
        二级分类只负责提示“最可能存在押金”；最终记录必须有合同原文，不能根据付款差额或文件名猜测。
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import type { Ref } from "vue";
import type { UploadFile, UploadInstance } from "element-plus";
import { Document, Upload } from "@element-plus/icons-vue";
import type {
  ContractDepositFundingSource,
  ContractDepositReturnReceiptRecognition,
  ContractDepositSettlement,
  ContractDepositSettlementType,
  ContractDepositSnapshot,
} from "@/types/contract";
import {
  deleteContractDepositReturnReceiptRecognition,
  deleteContractDepositSettlementReceipt,
  getContractDeposit,
  getContractErrorMessage,
  registerContractDepositEngineeringReturn,
  recognizeContractDepositReturnReceipt,
  settleContractDeposit,
  updateContractDeposit,
  uploadContractDepositRefundReceipt,
} from "@/utils/contractApi";
import {
  formatContractDate,
  formatContractMoney,
  getContractBusinessDate,
} from "@/utils/contractPresentation";

const props = withDefaults(
  defineProps<{
    contractId: string;
    subtypeLabel: string;
    canManage?: boolean;
    contractCompanySubject?: string;
    hideEmptyReadonly?: boolean;
  }>(),
  {
    canManage: false,
    contractCompanySubject: "",
    hideEmptyReadonly: false,
  },
);

const emit = defineEmits<{
  updated: [snapshot: ContractDepositSnapshot];
}>();

const contractCompanyDisplayName = computed(
  () => props.contractCompanySubject || "我方签约公司",
);
const fundingSourceOptions = computed<
  Array<{
    value: ContractDepositFundingSource;
    label: string;
  }>
>(() => [
  { value: "pending_review", label: "待回单核对" },
  { value: "engineering_allocation", label: "工程划拨" },
  {
    value: "technology_self_funded",
    label: `${contractCompanyDisplayName.value}自有`,
  },
  {
    value: "mixed",
    label: `工程划拨与${contractCompanyDisplayName.value}自有混合`,
  },
]);

const MAX_SETTLEMENT_RECEIPT_SIZE = 30 * 1024 * 1024;
const ALLOWED_SETTLEMENT_RECEIPT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];

const snapshot = ref<ContractDepositSnapshot>({
  eligibility: {
    likely: true,
    reason: "rental_subtype",
  },
  deposit: null,
});
const panelVisible = computed(
  () => !props.hideEmptyReadonly || Boolean(snapshot.value.deposit),
);
const loading = ref(false);
const saving = ref(false);
const settling = ref(false);
const engineeringReturning = ref(false);
const editing = ref(false);
const activeEngineeringReturnId = ref("");
const settlementUploadRef = ref<UploadInstance>();
const engineeringReturnUploadRef = ref<UploadInstance>();
const settlementReceiptFile = ref<File | null>(null);
const engineeringReturnReceiptFile = ref<File | null>(null);
const settlementReceiptPreviewUrl = ref("");
const engineeringReturnReceiptPreviewUrl = ref("");
const settlementReceiptRecognition =
  ref<ContractDepositReturnReceiptRecognition | null>(null);
const engineeringReturnReceiptRecognition =
  ref<ContractDepositReturnReceiptRecognition | null>(null);
const settlementReceiptRecognizing = ref(false);
const engineeringReturnReceiptRecognizing = ref(false);
const settlementReceiptRemoving = ref(false);
const engineeringReturnReceiptRemoving = ref(false);
const refundReceiptUploadingId = ref("");
const refundReceiptUploadVersions = reactive<Record<string, number>>({});
const historicalRefundRecognitionJobIds = reactive<Record<string, string>>({});
const receiptDeleteConfirmationKey = ref("");
const receiptDeletingKey = ref("");
const loadError = ref("");
const actionError = ref("");
let settlementReceiptSequence = 0;
let engineeringReturnReceiptSequence = 0;
const recordForm = reactive({
  amount: "",
  clauseText: "",
  basis: "",
  fundingSource: "pending_review" as ContractDepositFundingSource,
  engineeringAllocationAmount: "",
  technologySelfFundedAmount: "",
  note: "",
});
const settlementForm = reactive({
  type: "refund" as ContractDepositSettlementType,
  amount: "",
  settlementDate: getContractBusinessDate(),
  note: "",
});
const engineeringReturnForm = reactive({
  amount: "",
  returnDate: getContractBusinessDate(),
  note: "",
});

function moneyToCents(value: string | number | null | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function fundingSourceLabel(source: ContractDepositFundingSource): string {
  return (
    fundingSourceOptions.value.find((option) => option.value === source)
      ?.label || "待回单核对"
  );
}

function settlementTypeLabel(type: ContractDepositSettlementType): string {
  return {
    refund: "退回",
    deduction: "扣款",
    rent_offset: "抵租金",
  }[type];
}

const recordValidationMessage = computed(() => {
  if (moneyToCents(recordForm.amount) <= 0) return "押金金额必须大于零";
  if (!recordForm.clauseText.trim() && !recordForm.basis.trim()) {
    return "请至少填写合同押金条款或计算依据";
  }
  const settledCents = moneyToCents(snapshot.value.deposit?.settledAmount);
  if (settledCents > moneyToCents(recordForm.amount)) {
    return "押金金额不能低于已经结算的金额";
  }
  if (recordForm.fundingSource === "mixed") {
    const engineeringCents = moneyToCents(
      recordForm.engineeringAllocationAmount,
    );
    const technologyCents = moneyToCents(recordForm.technologySelfFundedAmount);
    if (engineeringCents <= 0 || technologyCents <= 0) {
      return `混合来源必须分别填写工程划拨和${contractCompanyDisplayName.value}自有资金金额`;
    }
    if (
      engineeringCents + technologyCents !==
      moneyToCents(recordForm.amount)
    ) {
      return "两项资金来源金额合计必须等于押金金额";
    }
  }
  return "";
});
const recordFormValid = computed(
  () => !saving.value && !recordValidationMessage.value,
);
const canSettle = computed(
  () =>
    props.canManage &&
    snapshot.value.deposit?.fundingSource !== "pending_review" &&
    snapshot.value.deposit?.status !== "pending_payment",
);
const settlementValidationMessage = computed(() => {
  if (snapshot.value.deposit?.fundingSource === "pending_review") {
    return "请先确认押金资金来源";
  }
  if (snapshot.value.deposit?.status === "pending_payment") {
    return "押金尚未支付，不能办理结算";
  }
  const remainingCents = moneyToCents(snapshot.value.deposit?.remainingAmount);
  const amountCents = moneyToCents(settlementForm.amount);
  if (settlementForm.type === "refund") {
    if (settlementReceiptRecognizing.value) return "押金退回回单正在识别";
    if (!settlementReceiptFile.value) return "请选择押金退回银行回单";
    if (!settlementReceiptRecognition.value) {
      return "押金退回回单尚未完成识别";
    }
    if (!settlementReceiptRecognition.value.canConfirm) {
      return returnReceiptRecognitionMessage(
        settlementReceiptRecognition.value,
      );
    }
    if (!settlementForm.settlementDate) return "未识别到有效交易日期";
    if (amountCents <= 0) return "未识别到有效退款金额";
  } else if (!settlementForm.settlementDate) {
    return "请选择结算日期";
  }
  if (amountCents <= 0) return "结算金额必须大于零";
  if (amountCents > remainingCents) return "结算金额不能超过待结算押金";
  if (settlementForm.type !== "refund" && !settlementForm.note.trim()) {
    return "扣款或抵租金必须填写结算说明";
  }
  return "";
});
const settlementFormValid = computed(
  () => !settling.value && !settlementValidationMessage.value,
);
const depositStatusLabel = computed(() => {
  const status = snapshot.value.deposit?.status || "pending_payment";
  return {
    pending_payment: "待支付",
    active: "保管中",
    partially_settled: "部分结算",
    settled: "已结清",
  }[status];
});
const depositStatusTagType = computed(() => {
  const status = snapshot.value.deposit?.status || "pending_payment";
  return {
    pending_payment: "warning",
    active: "primary",
    partially_settled: "warning",
    settled: "success",
  }[status] as "primary" | "success" | "warning";
});
const paymentRecordLabel = computed(() => {
  const deposit = snapshot.value.deposit;
  if (!deposit?.paymentRecordId) return "尚未关联实际付款回单";
  const kind =
    deposit.paymentRecordKind === "external_payment"
      ? `${contractCompanyDisplayName.value}对外付款回单`
      : "合同付款回单";
  return `${kind} · ${deposit.paymentRecordId}`;
});

function fillRecordForm() {
  const deposit = snapshot.value.deposit;
  recordForm.amount = deposit ? String(deposit.amount) : "";
  recordForm.clauseText = deposit?.clauseText || "";
  recordForm.basis = deposit?.basis || "";
  recordForm.fundingSource = deposit?.fundingSource || "pending_review";
  recordForm.engineeringAllocationAmount = deposit
    ? String(deposit.engineeringAllocationAmount)
    : "";
  recordForm.technologySelfFundedAmount = deposit
    ? String(deposit.technologySelfFundedAmount)
    : "";
  recordForm.note = deposit?.note || "";
}

function engineeringReturnRemainingCents(
  settlement: ContractDepositSettlement,
): number {
  return Math.max(
    0,
    moneyToCents(settlement.engineeringReturnRequiredAmount) -
      moneyToCents(settlement.engineeringReturnedAmount),
  );
}

function validateSettlementReceiptFile(file: File): string {
  const lowerName = file.name.toLowerCase();
  if (
    !ALLOWED_SETTLEMENT_RECEIPT_EXTENSIONS.some((extension) =>
      lowerName.endsWith(extension),
    )
  ) {
    return "回单只支持 JPEG（联合图像专家组）、JPG（图像格式）、PNG（便携式网络图形）或 PDF（便携式文档格式）";
  }
  if (file.size > MAX_SETTLEMENT_RECEIPT_SIZE) {
    return "回单文件不能超过 30MB";
  }
  return "";
}

async function handleSettlementReceiptChange(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  settlementUploadRef.value?.clearFiles();
  if (!file || settlementReceiptRecognizing.value) return;
  const validationMessage = validateSettlementReceiptFile(file);
  if (validationMessage) {
    actionError.value = validationMessage;
    return;
  }
  if (
    settlementReceiptRecognition.value?.jobId &&
    !(await deletePendingReturnReceiptRecognition(
      settlementReceiptRecognition.value.jobId,
      "原退款回单识别任务清理失败，请先移除后再重新选择",
    ))
  ) {
    return;
  }
  clearSettlementReceiptLocalState(true);
  setLocalReceiptFile(settlementReceiptFile, settlementReceiptPreviewUrl, file);
  const sequence = ++settlementReceiptSequence;
  settlementReceiptRecognizing.value = true;
  actionError.value = "";
  try {
    const result = await recognizeContractDepositReturnReceipt(
      props.contractId,
      "deposit_refund",
      file,
    );
    if (
      sequence !== settlementReceiptSequence ||
      settlementReceiptFile.value !== file
    ) {
      await quietlyDeleteReturnReceiptRecognition(result.jobId);
      return;
    }
    settlementReceiptRecognition.value = result;
    applySettlementReceiptRecognition(result);
    if (!result.canConfirm) {
      actionError.value = returnReceiptRecognitionMessage(result);
    }
  } catch (error) {
    if (
      sequence === settlementReceiptSequence &&
      settlementReceiptFile.value === file
    ) {
      actionError.value = getContractErrorMessage(
        error,
        "押金退回回单识别失败，请移除后重新上传",
      );
    }
  } finally {
    if (sequence === settlementReceiptSequence) {
      settlementReceiptRecognizing.value = false;
    }
  }
}

async function handleEngineeringReturnReceiptChange(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  engineeringReturnUploadRef.value?.clearFiles();
  const settlementId = activeEngineeringReturnId.value;
  if (!file || !settlementId || engineeringReturnReceiptRecognizing.value)
    return;
  const validationMessage = validateSettlementReceiptFile(file);
  if (validationMessage) {
    actionError.value = validationMessage;
    return;
  }
  if (
    engineeringReturnReceiptRecognition.value?.jobId &&
    !(await deletePendingReturnReceiptRecognition(
      engineeringReturnReceiptRecognition.value.jobId,
      "原退工程回单识别任务清理失败，请先移除后再重新选择",
    ))
  ) {
    return;
  }
  clearEngineeringReturnReceiptLocalState();
  setLocalReceiptFile(
    engineeringReturnReceiptFile,
    engineeringReturnReceiptPreviewUrl,
    file,
  );
  const sequence = ++engineeringReturnReceiptSequence;
  engineeringReturnReceiptRecognizing.value = true;
  actionError.value = "";
  try {
    const result = await recognizeContractDepositReturnReceipt(
      props.contractId,
      "engineering_return",
      file,
      settlementId,
    );
    if (
      sequence !== engineeringReturnReceiptSequence ||
      engineeringReturnReceiptFile.value !== file
    ) {
      await quietlyDeleteReturnReceiptRecognition(result.jobId);
      return;
    }
    engineeringReturnReceiptRecognition.value = result;
    applyEngineeringReturnReceiptRecognition(result);
    if (!result.canConfirm) {
      actionError.value = returnReceiptRecognitionMessage(result);
    }
  } catch (error) {
    if (
      sequence === engineeringReturnReceiptSequence &&
      engineeringReturnReceiptFile.value === file
    ) {
      actionError.value = getContractErrorMessage(
        error,
        "退工程回单识别失败，请移除后重新上传",
      );
    }
  } finally {
    if (sequence === engineeringReturnReceiptSequence) {
      engineeringReturnReceiptRecognizing.value = false;
    }
  }
}

function recognizedReturnDate(value: string): string {
  return value.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || "";
}

function applySettlementReceiptRecognition(
  result: ContractDepositReturnReceiptRecognition,
) {
  settlementForm.amount =
    result.fields.amount === null ? "" : String(result.fields.amount);
  settlementForm.settlementDate = recognizedReturnDate(
    result.fields.paymentTime,
  );
}

function applyEngineeringReturnReceiptRecognition(
  result: ContractDepositReturnReceiptRecognition,
) {
  engineeringReturnForm.amount =
    result.fields.amount === null ? "" : String(result.fields.amount);
  engineeringReturnForm.returnDate = recognizedReturnDate(
    result.fields.paymentTime,
  );
}

function returnReceiptRecognitionMessage(
  result: ContractDepositReturnReceiptRecognition,
): string {
  return (
    result.blockingReasons.map((reason) => reason.message).join("；") ||
    result.warnings.join("；") ||
    "回单未通过校验，不能确认结算"
  );
}

async function deletePendingReturnReceiptRecognition(
  jobId: string,
  fallback: string,
): Promise<boolean> {
  try {
    await deleteContractDepositReturnReceiptRecognition(
      props.contractId,
      jobId,
    );
    return true;
  } catch (error) {
    actionError.value = getContractErrorMessage(error, fallback);
    return false;
  }
}

async function quietlyDeleteReturnReceiptRecognition(jobId: string) {
  if (!jobId) return;
  try {
    await deleteContractDepositReturnReceiptRecognition(
      props.contractId,
      jobId,
    );
  } catch {
    // 组件状态已经失效，服务端会继续把未消费识别任务作为待清理记录保留。
  }
}

function releaseLocalReceiptPreview(previewUrl: Ref<string>) {
  if (previewUrl.value.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl.value);
  }
  previewUrl.value = "";
}

function setLocalReceiptFile(
  fileRef: Ref<File | null>,
  previewUrl: Ref<string>,
  file: File,
) {
  releaseLocalReceiptPreview(previewUrl);
  fileRef.value = file;
  previewUrl.value = URL.createObjectURL(file);
}

async function handleMissingRefundReceiptChange(
  settlementId: string,
  uploadFile: UploadFile,
) {
  const file = uploadFile.raw;
  if (
    !file ||
    !props.canManage ||
    refundReceiptUploadingId.value ||
    settling.value ||
    engineeringReturning.value
  ) {
    return;
  }
  const validationMessage = validateSettlementReceiptFile(file);
  if (validationMessage) {
    actionError.value = validationMessage;
    refundReceiptUploadVersions[settlementId] =
      (refundReceiptUploadVersions[settlementId] || 0) + 1;
    return;
  }
  refundReceiptUploadingId.value = settlementId;
  actionError.value = "";
  try {
    const previousJobId = historicalRefundRecognitionJobIds[settlementId];
    if (
      previousJobId &&
      !(await deletePendingReturnReceiptRecognition(
        previousJobId,
        "原历史退款回单识别任务清理失败，请稍后重试",
      ))
    ) {
      return;
    }
    delete historicalRefundRecognitionJobIds[settlementId];
    const recognition = await recognizeContractDepositReturnReceipt(
      props.contractId,
      "deposit_refund",
      file,
      settlementId,
    );
    historicalRefundRecognitionJobIds[settlementId] = recognition.jobId;
    if (!recognition.canConfirm) {
      actionError.value = returnReceiptRecognitionMessage(recognition);
      return;
    }
    snapshot.value = await uploadContractDepositRefundReceipt(
      props.contractId,
      settlementId,
      recognition.jobId,
    );
    delete historicalRefundRecognitionJobIds[settlementId];
    emit("updated", snapshot.value);
  } catch (error) {
    actionError.value = getContractErrorMessage(
      error,
      "押金退回银行回单上传失败，请重新选择后再试",
    );
  } finally {
    refundReceiptUploadingId.value = "";
    refundReceiptUploadVersions[settlementId] =
      (refundReceiptUploadVersions[settlementId] || 0) + 1;
  }
}

function clearSettlementReceiptLocalState(clearRecognizedFields: boolean) {
  releaseLocalReceiptPreview(settlementReceiptPreviewUrl);
  settlementReceiptFile.value = null;
  settlementReceiptRecognition.value = null;
  settlementReceiptRecognizing.value = false;
  settlementUploadRef.value?.clearFiles();
  if (clearRecognizedFields) {
    settlementForm.amount = "";
    settlementForm.settlementDate = "";
  }
}

function clearEngineeringReturnReceiptLocalState() {
  releaseLocalReceiptPreview(engineeringReturnReceiptPreviewUrl);
  engineeringReturnReceiptFile.value = null;
  engineeringReturnReceiptRecognition.value = null;
  engineeringReturnReceiptRecognizing.value = false;
  engineeringReturnUploadRef.value?.clearFiles();
  engineeringReturnForm.amount = "";
  engineeringReturnForm.returnDate = "";
}

async function removeSettlementReceipt(clearRecognizedFields = true) {
  if (settlementReceiptRemoving.value || settling.value) return false;
  const jobId = settlementReceiptRecognition.value?.jobId || "";
  ++settlementReceiptSequence;
  settlementReceiptRemoving.value = true;
  try {
    if (
      jobId &&
      !(await deletePendingReturnReceiptRecognition(
        jobId,
        "退款回单识别任务删除失败，当前文件和识别值已保留",
      ))
    ) {
      return false;
    }
    clearSettlementReceiptLocalState(clearRecognizedFields);
    actionError.value = "";
    return true;
  } finally {
    settlementReceiptRemoving.value = false;
  }
}

async function removeEngineeringReturnReceipt() {
  if (engineeringReturnReceiptRemoving.value || engineeringReturning.value) {
    return false;
  }
  const jobId = engineeringReturnReceiptRecognition.value?.jobId || "";
  ++engineeringReturnReceiptSequence;
  engineeringReturnReceiptRemoving.value = true;
  try {
    if (
      jobId &&
      !(await deletePendingReturnReceiptRecognition(
        jobId,
        "退工程回单识别任务删除失败，当前文件和识别值已保留",
      ))
    ) {
      return false;
    }
    clearEngineeringReturnReceiptLocalState();
    actionError.value = "";
    return true;
  } finally {
    engineeringReturnReceiptRemoving.value = false;
  }
}

function settlementReceiptKey(settlementId: string, receiptId: string) {
  return `${settlementId}:${receiptId}`;
}

function requestReceiptDelete(settlementId: string, receiptId: string) {
  if (!props.canManage || receiptDeletingKey.value) return;
  receiptDeleteConfirmationKey.value = settlementReceiptKey(
    settlementId,
    receiptId,
  );
  actionError.value = "";
}

function cancelReceiptDelete() {
  if (receiptDeletingKey.value) return;
  receiptDeleteConfirmationKey.value = "";
}

async function deleteSavedReceipt(settlementId: string, receiptId: string) {
  if (!props.canManage || receiptDeletingKey.value) return;
  const key = settlementReceiptKey(settlementId, receiptId);
  receiptDeletingKey.value = key;
  actionError.value = "";
  try {
    snapshot.value = await deleteContractDepositSettlementReceipt(
      props.contractId,
      settlementId,
      receiptId,
    );
    receiptDeleteConfirmationKey.value = "";
    emit("updated", snapshot.value);
  } catch (error) {
    actionError.value = getContractErrorMessage(
      error,
      "回单删除失败，原记录已保留，请稍后重试",
    );
  } finally {
    receiptDeletingKey.value = "";
  }
}

function startEngineeringReturn(settlement: ContractDepositSettlement) {
  activeEngineeringReturnId.value = settlement.id;
  engineeringReturnForm.note = "";
  clearEngineeringReturnReceiptLocalState();
  actionError.value = "";
}

async function cancelEngineeringReturn() {
  if (!(await removeEngineeringReturnReceipt())) return;
  activeEngineeringReturnId.value = "";
  engineeringReturnForm.note = "";
}

function engineeringReturnValidationMessage(
  settlement: ContractDepositSettlement,
): string {
  const amountCents = moneyToCents(engineeringReturnForm.amount);
  if (engineeringReturnReceiptRecognizing.value) return "退工程回单正在识别";
  if (!engineeringReturnReceiptFile.value) return "请选择退工程回单";
  if (!engineeringReturnReceiptRecognition.value) {
    return "退工程回单尚未完成识别";
  }
  if (!engineeringReturnReceiptRecognition.value.canConfirm) {
    return returnReceiptRecognitionMessage(
      engineeringReturnReceiptRecognition.value,
    );
  }
  if (!engineeringReturnForm.returnDate) return "未识别到有效交易日期";
  if (amountCents <= 0) return "未识别到有效退工程金额";
  if (amountCents > engineeringReturnRemainingCents(settlement)) {
    return "回单识别金额不能超过该笔待退工程金额";
  }
  return "";
}

function engineeringReturnFormValid(
  settlement: ContractDepositSettlement,
): boolean {
  return Boolean(
    !engineeringReturning.value &&
    !engineeringReturnValidationMessage(settlement),
  );
}

function resetSettlementForm() {
  settlementForm.type = "refund";
  settlementForm.note = "";
  clearSettlementReceiptLocalState(true);
}

async function loadDeposit() {
  if (!props.contractId || loading.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    snapshot.value = await getContractDeposit(props.contractId);
    fillRecordForm();
    resetSettlementForm();
  } catch (error) {
    loadError.value = getContractErrorMessage(
      error,
      "押金记录加载失败，请稍后重试",
    );
  } finally {
    loading.value = false;
  }
}

function startEditing() {
  fillRecordForm();
  editing.value = true;
  actionError.value = "";
}

function cancelEditing() {
  fillRecordForm();
  editing.value = false;
  actionError.value = "";
}

async function saveDeposit() {
  if (!recordFormValid.value) return;
  saving.value = true;
  actionError.value = "";
  try {
    snapshot.value = await updateContractDeposit(props.contractId, {
      amount: recordForm.amount,
      clauseText: recordForm.clauseText.trim() || undefined,
      basis: recordForm.basis.trim() || undefined,
      paymentPurpose: "lease_deposit",
      fundingSource: recordForm.fundingSource,
      engineeringAllocationAmount:
        recordForm.fundingSource === "engineering_allocation"
          ? recordForm.amount
          : recordForm.fundingSource === "mixed"
            ? recordForm.engineeringAllocationAmount
            : undefined,
      technologySelfFundedAmount:
        recordForm.fundingSource === "technology_self_funded"
          ? recordForm.amount
          : recordForm.fundingSource === "mixed"
            ? recordForm.technologySelfFundedAmount
            : undefined,
      note: recordForm.note.trim() || undefined,
    });
    editing.value = false;
    fillRecordForm();
    resetSettlementForm();
    emit("updated", snapshot.value);
  } catch (error) {
    actionError.value = getContractErrorMessage(
      error,
      "押金登记保存失败，请稍后重试",
    );
  } finally {
    saving.value = false;
  }
}

async function submitSettlement() {
  if (!settlementFormValid.value) return;
  settling.value = true;
  actionError.value = "";
  try {
    const type = settlementForm.type;
    const note = settlementForm.note.trim();
    if (type === "refund") {
      const recognition = settlementReceiptRecognition.value;
      if (!recognition?.canConfirm) return;
      snapshot.value = await settleContractDeposit(props.contractId, {
        type,
        ocrJobId: recognition.jobId,
        note: note || undefined,
      });
    } else {
      snapshot.value = await settleContractDeposit(props.contractId, {
        type,
        amount: settlementForm.amount,
        settlementDate: settlementForm.settlementDate,
        note,
      });
    }
    fillRecordForm();
    resetSettlementForm();
    emit("updated", snapshot.value);
  } catch (error) {
    actionError.value = getContractErrorMessage(
      error,
      "押金结算登记失败，请稍后重试",
    );
  } finally {
    settling.value = false;
  }
}

async function submitEngineeringReturn(settlement: ContractDepositSettlement) {
  if (!engineeringReturnFormValid(settlement)) return;
  const recognition = engineeringReturnReceiptRecognition.value;
  if (!recognition?.canConfirm) return;
  engineeringReturning.value = true;
  actionError.value = "";
  try {
    snapshot.value = await registerContractDepositEngineeringReturn(
      props.contractId,
      settlement.id,
      {
        ocrJobId: recognition.jobId,
        note: engineeringReturnForm.note.trim() || undefined,
      },
    );
    ++engineeringReturnReceiptSequence;
    activeEngineeringReturnId.value = "";
    engineeringReturnForm.note = "";
    clearEngineeringReturnReceiptLocalState();
    fillRecordForm();
    resetSettlementForm();
    emit("updated", snapshot.value);
  } catch (error) {
    actionError.value = getContractErrorMessage(
      error,
      "退回工程资金登记失败，请稍后重试",
    );
  } finally {
    engineeringReturning.value = false;
  }
}

watch(
  () => props.contractId,
  () => {
    ++settlementReceiptSequence;
    ++engineeringReturnReceiptSequence;
    clearSettlementReceiptLocalState(true);
    clearEngineeringReturnReceiptLocalState();
    snapshot.value.deposit = null;
    editing.value = false;
    activeEngineeringReturnId.value = "";
    receiptDeleteConfirmationKey.value = "";
    void loadDeposit();
  },
  { immediate: true },
);

watch(
  () => settlementForm.type,
  (type, previousType) => {
    if (type === "refund") {
      if (settlementReceiptRecognition.value) {
        applySettlementReceiptRecognition(settlementReceiptRecognition.value);
      } else {
        settlementForm.amount = "";
        settlementForm.settlementDate = "";
      }
    } else if (previousType === "refund") {
      void removeSettlementReceipt(false);
      settlementForm.amount = snapshot.value.deposit
        ? String(snapshot.value.deposit.remainingAmount)
        : "";
      settlementForm.settlementDate = getContractBusinessDate();
    }
  },
);

onBeforeUnmount(() => {
  ++settlementReceiptSequence;
  ++engineeringReturnReceiptSequence;
  releaseLocalReceiptPreview(settlementReceiptPreviewUrl);
  releaseLocalReceiptPreview(engineeringReturnReceiptPreviewUrl);
});
</script>

<style scoped>
.contract-deposit-management {
  margin-bottom: 14px;
  padding: 20px;
  border: 1px solid #eadcb9;
  border-radius: 14px;
  background: linear-gradient(135deg, #fffdf8, #f8fbfb);
}
.deposit-heading,
.deposit-title-row,
.deposit-form-heading,
.deposit-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.deposit-title-row {
  justify-content: flex-start;
}
.deposit-heading h2,
.deposit-heading p,
.deposit-form-heading strong,
.deposit-form-heading span {
  margin: 0;
}
.deposit-heading h2 {
  color: #31536a;
  font-size: 18px;
}
.deposit-heading p,
.deposit-form-heading span,
.deposit-rule-note {
  color: #7e8f98;
  font-size: 12px;
}
.deposit-heading p {
  margin-top: 6px;
}
.deposit-form,
.deposit-settlement {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #e5e8df;
  border-radius: 11px;
  background: rgb(255 255 255 / 82%);
}
.deposit-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
  margin-top: 14px;
}
.full-row {
  grid-column: 1 / -1;
}
.deposit-form :deep(.el-select),
.deposit-form :deep(.el-date-editor),
.settlement-form :deep(.el-select),
.settlement-form :deep(.el-date-editor) {
  width: 100%;
}
.deposit-form-actions {
  justify-content: flex-end;
  margin-top: 12px;
}
.deposit-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.deposit-summary > div {
  display: flex;
  min-height: 74px;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border: 1px solid #e3e9e8;
  border-radius: 10px;
  background: #fff;
}
.deposit-summary span,
.deposit-facts dt {
  color: #84929a;
  font-size: 11px;
}
.deposit-summary strong {
  color: #31536a;
  font-size: 17px;
}
.deposit-summary .remaining strong {
  color: #b36d19;
}
.deposit-summary .engineering-return strong {
  color: #b04f45;
}
.deposit-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin: 14px 0;
}
.deposit-facts > div {
  padding-bottom: 8px;
  border-bottom: 1px dashed #e0e6e5;
}
.deposit-facts dd {
  margin: 4px 0 0;
  color: #425e6d;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.settlement-form {
  display: grid;
  grid-template-columns:
    minmax(180px, 0.7fr) minmax(220px, 1fr) minmax(220px, 0.8fr)
    minmax(260px, 1.2fr) auto;
  align-items: end;
  gap: 10px;
  margin-top: 12px;
}
.settlement-form :deep(.el-form-item) {
  display: block;
  min-width: 0;
  margin-bottom: 0;
}
.settlement-form :deep(.el-form-item__label) {
  display: block;
  width: auto;
  height: auto;
  margin: 0 0 6px;
  padding: 0;
  line-height: 20px;
  white-space: nowrap;
}
.settlement-form :deep(.el-form-item__content) {
  width: 100%;
  min-width: 0;
}
.settlement-type-select,
.settlement-form :deep(.el-date-editor) {
  min-width: 0;
}
.settlement-receipt-field {
  grid-column: 1 / -2;
}
.settlement-receipt-field :deep(.el-form-item__content) {
  display: block;
}
.receipt-selector {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.selected-receipt,
.receipt-file-link {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.selected-receipt-entry,
.receipt-file-entry {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}
.selected-receipt {
  color: #42677a;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.local-receipt-preview-link {
  color: #267b82;
  font-size: 12px;
  text-decoration: none;
}
.local-receipt-preview-link:hover {
  text-decoration: underline;
}
.receipt-help {
  color: #84929a;
  font-size: 11px;
}
.return-receipt-fields {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin: 8px 0 0;
}
.return-receipt-fields > div {
  min-width: 0;
  padding: 7px;
  border: 1px solid #e0e9e8;
  border-radius: 7px;
  background: #f8fbfb;
}
.return-receipt-fields dt {
  color: #84929a;
  font-size: 10px;
}
.return-receipt-fields dd {
  margin: 3px 0 0;
  color: #3d606f;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.receipt-recognition-error {
  display: block;
  width: 100%;
  margin-top: 7px;
  color: #bd4e45;
  line-height: 1.5;
}
.validation-hint {
  margin: 10px 0 0;
  color: #b56b18;
  font-size: 12px;
}
.deposit-history {
  margin-top: 16px;
}
.deposit-history > article {
  display: grid;
  grid-template-columns: 88px 110px 130px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed #e0e6e5;
  color: #637983;
  font-size: 12px;
}
.deposit-history article > strong {
  color: #31536a;
}
.deposit-history article > small {
  overflow-wrap: anywhere;
}
.deposit-history .engineering-return-status {
  grid-column: 1 / -1;
  color: #a06420;
}
.settlement-receipts {
  display: flex;
  grid-column: 1 / -1;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.settlement-receipts > span:first-child {
  color: #627985;
  font-weight: 600;
}
.receipt-file-link {
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid #cddfdf;
  border-radius: 7px;
  color: #267b82;
  text-decoration: none;
}
.receipt-file-link:hover {
  border-color: #7fbdbe;
  background: #f2fafa;
}
.receipt-file-link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.receipt-file-link small {
  color: #6e9194;
  white-space: nowrap;
}
.receipt-file-link.is-disabled {
  border-color: #e2e7e7;
  color: #929e9f;
  cursor: default;
  pointer-events: none;
}
.receipt-delete-confirmation {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid #efc8c3;
  border-radius: 7px;
  background: #fff7f6;
  color: #a64e45;
}
.engineering-return-workspace {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 1px solid #efdfbd;
  border-radius: 9px;
  background: #fffaf0;
}
.engineering-return-workspace > div {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #8a6428;
}
.engineering-return-form {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: 140px 160px minmax(160px, 1fr);
  gap: 8px;
}
.engineering-return-form :deep(.el-date-editor) {
  width: 100%;
}
.engineering-return-receipt-field {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  color: #765c32;
  font-size: 12px;
}
.engineering-return-actions {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 8px;
}
.engineering-validation-hint {
  margin: 0 auto 0 0;
}
.action-error {
  margin-top: 14px;
}
.deposit-rule-note {
  margin: 14px 0 0;
  line-height: 1.7;
}
@media (max-width: 980px) {
  .deposit-summary,
  .deposit-form-grid,
  .deposit-facts,
  .settlement-form {
    grid-template-columns: 1fr 1fr;
  }
  .settlement-note,
  .settlement-receipt-field,
  .settlement-form > :deep(.el-button),
  .engineering-return-form {
    grid-column: 1 / -1;
  }
  .engineering-return-workspace {
    align-items: stretch;
    flex-direction: column;
  }
  .engineering-return-form {
    grid-template-columns: 1fr 1fr;
  }
  .return-receipt-fields {
    grid-template-columns: 1fr 1fr;
  }
  .engineering-return-receipt-field,
  .engineering-return-actions {
    grid-column: 1 / -1;
  }
}
@media (max-width: 768px) {
  .contract-deposit-management {
    padding: 14px;
  }
  .deposit-heading,
  .deposit-form-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .deposit-summary,
  .deposit-form-grid,
  .deposit-facts,
  .settlement-form {
    grid-template-columns: 1fr;
  }
  .full-row,
  .settlement-note,
  .settlement-receipt-field,
  .settlement-form > :deep(.el-button),
  .engineering-return-form {
    grid-column: 1;
  }
  .engineering-return-form {
    grid-template-columns: 1fr;
  }
  .return-receipt-fields {
    grid-template-columns: 1fr;
  }
  .engineering-return-receipt-field,
  .engineering-return-actions {
    grid-column: 1;
  }
  .receipt-selector,
  .engineering-return-receipt-field {
    align-items: flex-start;
    flex-direction: column;
  }
  .deposit-history > article {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
