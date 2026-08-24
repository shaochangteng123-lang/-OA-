<template>
  <section
    ref="panelRef"
    class="financial-registration-panel"
    tabindex="-1"
    aria-labelledby="financial-registration-title"
  >
    <header class="registration-heading">
      <div>
        <span class="registration-kicker">财务闭环</span>
        <h2 id="financial-registration-title">财务登记</h2>
        <p v-if="requiresExternalPayment">
          先上传工程咨询划拨回单和科技向合同对方付款回单；物业最后开票后补充发票，三类凭证金额闭合后统一保存。
        </p>
        <p v-else>
          发票识别通过后会按本公司在发票中的购销身份确定收支方向；收到{{
            bankDocumentLabel
          }}并保存后立即计入{{
            postedSettlementLabel
          }}，金额全部闭合后再确认整笔配对。
        </p>
      </div>
      <el-tag type="primary" effect="plain">多凭证配对登记</el-tag>
    </header>

    <el-alert
      v-if="registrationId"
      class="continuation-alert"
      type="info"
      show-icon
      :closable="false"
      title="正在补充待结清财务登记"
      :description="continuationDescription"
    />
    <div v-if="registrationId" class="continuation-actions">
      <el-button link type="primary" @click="emit('cancelContinuation')">
        返回新增发票登记
      </el-button>
    </div>

    <el-alert
      v-if="pageError"
      class="registration-page-error"
      type="error"
      show-icon
      closable
      :title="pageError"
      @close="pageError = ''"
    />
    <el-alert
      v-if="category === 'asset' && !fundingModeReady"
      class="registration-page-error"
      type="warning"
      show-icon
      :closable="false"
      title="请先在上方确认资金承担方式"
      description="资金方式待核对时可以识别发票，但不能上传或登记资产付款。"
    />

    <div class="credential-grid">
      <article
        class="credential-card invoice-card"
        :class="{ 'internal-invoice-card': requiresExternalPayment }"
      >
        <div class="credential-heading">
          <span class="credential-index">{{
            requiresExternalPayment ? "03" : "01"
          }}</span>
          <div>
            <h3>发票</h3>
            <p>必传 · 选择后自动识别</p>
          </div>
          <el-tag
            :type="credentialTagType(invoiceCredential.status)"
            size="small"
          >
            {{
              registrationId
                ? `已保存 ${registeredInvoices?.length || 0} 张${allInvoiceCredentials.length ? ` · 新增 ${allInvoiceCredentials.length} 张` : ""}`
                : allInvoiceCredentials.length
                  ? `已添加 ${allInvoiceCredentials.length} 张`
                  : "等待上传"
            }}
          </el-tag>
        </div>

        <div
          v-if="registrationId"
          class="credential-uploader registered-credential-uploader"
        >
          <div class="selected-file">
            <button
              type="button"
              class="selected-file-icon registered-file-icon"
              title="在新窗口预览已保存发票"
              :disabled="!registeredInvoices?.[0]?.previewUrl"
              @click="openRegisteredInvoicePreview(registeredInvoices?.[0])"
            >
              <el-icon><Document /></el-icon>
            </button>
            <strong>已保存 {{ registeredInvoices?.length || 0 }} 张发票</strong>
            <small>已保存发票保持只读；仍可在下方继续添加发票</small>
          </div>
        </div>
        <el-upload
          ref="invoiceUploadRef"
          class="credential-uploader"
          drag
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :disabled="submitting"
          :on-change="
            (file: UploadFile) => handleCredentialFile('invoice', file)
          "
          accept=".pdf,.jpg,.jpeg,.png"
        >
          <div v-if="invoiceCredential.file" class="selected-file">
            <span
              class="selected-file-icon"
              role="button"
              tabindex="0"
              title="在新窗口预览发票"
              aria-label="在新窗口预览当前发票"
              @click.stop.prevent="openCredentialPreview(invoiceCredential)"
              @keydown.enter.stop.prevent="
                openCredentialPreview(invoiceCredential)
              "
              ><el-icon><Document /></el-icon
            ></span>
            <strong :title="invoiceCredential.file.name">{{
              invoiceCredential.file.name
            }}</strong>
            <small>
              {{ formatFileSize(invoiceCredential.file.size) }} ·
              点击此区域继续添加，可一次选择多张
            </small>
            <span class="continue-upload-hint">
              <el-icon><UploadFilled /></el-icon>
              继续添加发票
            </span>
          </div>
          <div v-else class="empty-upload">
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <strong>{{
              invoiceCredentials.length ? "继续添加发票" : "拖拽或点击上传发票"
            }}</strong>
            <small
              >支持一次选择多张；PDF（便携式文档格式）、JPG、JPEG、PNG，单个文件不超过
              30MB</small
            >
          </div>
        </el-upload>
        <el-alert
          v-if="!invoiceContextReady"
          class="credential-guidance"
          :type="invoiceDirectionConflict ? 'error' : 'info'"
          show-icon
          :closable="false"
          :title="
            invoiceDirectionConflict
              ? '发票购销方向与合同类型不一致，不能登记'
              : '请先上传并通过发票识别，系统再确定应上传回款还是付款凭证'
          "
        />

        <div
          v-if="invoiceCredential.status === 'recognizing'"
          class="recognizing-state"
        >
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在识别发票，请稍候…</span>
        </div>
        <el-alert
          v-if="invoiceCredential.error"
          class="credential-error"
          type="error"
          show-icon
          closable
          :title="invoiceCredential.error"
          @close="invoiceCredential.error = ''"
        />

        <div v-if="registrationId" class="credential-table-wrap">
          <el-table
            :data="registeredInvoices || []"
            border
            class="credential-table"
            table-layout="fixed"
            aria-label="已保存发票明细"
          >
            <el-table-column label="序号" width="40" align="center">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="购买方名称" min-width="80" align="center">
              <template #default="{ row }">{{ row.buyer || "—" }}</template>
            </el-table-column>
            <el-table-column label="销售方名称" min-width="150" align="center">
              <template #default="{ row }">{{ row.seller || "—" }}</template>
            </el-table-column>
            <el-table-column
              label="开票名称"
              min-width="100"
              align="center"
              class-name="invoice-item-name-column"
            >
              <template #default="{ row }">{{ row.itemName || "—" }}</template>
            </el-table-column>
            <el-table-column
              label="发票号码"
              min-width="100"
              align="center"
              class-name="invoice-number-column"
            >
              <template #default="{ row }">{{ row.invoiceNo || "—" }}</template>
            </el-table-column>
            <el-table-column label="开票日期" width="75" align="center">
              <template #default="{ row }">{{
                row.recordDate || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="开票金额" width="105" align="center">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.amount)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="82" align="center">
              <template #default="{ row }">
                <button
                  type="button"
                  class="thumbnail-button"
                  :title="`在新窗口预览${row.fileName || '发票'}`"
                  :disabled="!row.previewUrl"
                  @click="openRegisteredInvoicePreview(row)"
                >
                  <el-icon><Document /></el-icon>
                </button>
              </template>
            </el-table-column>
          </el-table>
          <el-table
            v-if="props.isRentalLease && newInvoiceLineItems.length"
            :data="newInvoiceLineItems"
            border
            class="credential-table invoice-line-item-table"
            table-layout="fixed"
            aria-label="发票逐条明细"
          >
            <el-table-column label="发票号码" min-width="130">
              <template #default="{ row }">{{ row.invoiceNumber }}</template>
            </el-table-column>
            <el-table-column label="项目名称" min-width="190">
              <template #default="{ row }">{{ row.itemName }}</template>
            </el-table-column>
            <el-table-column label="不含税金额" width="105">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.netAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="税额" width="95">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.taxAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="含税金额" width="105">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.grossAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="自动支出分类" min-width="120">
              <template #default="{ row }">{{
                invoiceLineCategoryLabel(row.expenseCategory)
              }}</template>
            </el-table-column>
            <el-table-column label="计入合同核算" width="110">
              <template #default="{ row }">
                {{
                  row.recognitionStatus !== "verified"
                    ? "待核对"
                    : row.includeInContractAccounting
                      ? "是"
                      : "否"
                }}
              </template>
            </el-table-column>
          </el-table>
          <el-table
            v-if="props.isRentalLease && registeredInvoiceLineItems.length"
            :data="registeredInvoiceLineItems"
            border
            class="credential-table invoice-line-item-table"
            table-layout="fixed"
            aria-label="已保存发票逐条明细"
          >
            <el-table-column
              label="发票号码"
              min-width="130"
              prop="invoiceNumber"
            />
            <el-table-column label="项目名称" min-width="190" prop="itemName" />
            <el-table-column label="不含税金额" width="105">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.netAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="税额" width="95">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.taxAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="含税金额" width="105">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.grossAmount)
              }}</template>
            </el-table-column>
            <el-table-column label="自动支出分类" min-width="120">
              <template #default="{ row }">{{
                invoiceLineCategoryLabel(row.expenseCategory)
              }}</template>
            </el-table-column>
            <el-table-column label="计入合同核算" width="110">
              <template #default="{ row }">{{
                row.includeInContractAccounting ? "是" : "否"
              }}</template>
            </el-table-column>
          </el-table>
          <div class="table-total">
            发票共 {{ registeredInvoices?.length || 0 }} 张，总金额
            <strong>{{ formatRecognizedMoney(registeredInvoiceTotal) }}</strong>
          </div>
        </div>

        <div v-if="allInvoiceCredentials.length" class="credential-table-wrap">
          <el-table
            :data="allInvoiceCredentials"
            border
            class="credential-table"
            table-layout="fixed"
            aria-label="已上传发票识别明细"
          >
            <el-table-column label="序号" width="40" align="center">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="购买方名称" min-width="80" align="center">
              <template #default="{ row }">{{
                invoiceFieldsFor(row)?.buyer || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="销售方名称" min-width="150" align="center">
              <template #default="{ row }">{{
                invoiceFieldsFor(row)?.seller || "—"
              }}</template>
            </el-table-column>
            <el-table-column
              label="开票名称"
              min-width="100"
              align="center"
              class-name="invoice-item-name-column"
            >
              <template #default="{ row }">{{
                invoiceFieldsFor(row)?.itemName || "—"
              }}</template>
            </el-table-column>
            <el-table-column
              label="发票号码"
              min-width="100"
              align="center"
              class-name="invoice-number-column"
            >
              <template #default="{ row }">{{
                invoiceFieldsFor(row)?.invoiceNumber || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="开票日期" width="75" align="center">
              <template #default="{ row }">{{
                invoiceFieldsFor(row)?.invoiceDate || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="开票金额" width="105" align="center">
              <template #default="{ row }">{{
                formatRecognizedMoney(invoiceAmount(row))
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="82" align="center">
              <template #default="{ row }">
                <div class="thumbnail-actions">
                  <button
                    type="button"
                    class="thumbnail-button"
                    :title="`在新窗口预览${row.file?.name || '发票'}`"
                    :disabled="!row.previewUrl"
                    @click="openCredentialPreview(row)"
                  >
                    <el-icon><Document /></el-icon>
                  </button>
                  <button
                    type="button"
                    class="thumbnail-remove-button"
                    title="移除发票"
                    :disabled="
                      row.status === 'recognizing' ||
                      submitting ||
                      clearing ||
                      isRemovingCredential(row.key)
                    "
                    @click="removeCredentialByKey('invoice', row.key)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-total">
            本次新增发票共 {{ allInvoiceCredentials.length }} 张，总金额
            <strong>{{ formatRecognizedMoney(newInvoiceTotal) }}</strong>
          </div>
        </div>
      </article>

      <article
        class="credential-card bank-card"
        :class="{ 'funding-bank-card': requiresExternalPayment }"
      >
        <div class="credential-heading">
          <span class="credential-index">{{
            requiresExternalPayment ? "01" : "02"
          }}</span>
          <div>
            <h3>{{ bankDocumentLabel }}</h3>
            <p>必传 · 选择后自动识别</p>
          </div>
          <el-tag :type="bankCredentialTagType" size="small">
            {{
              registrationId
                ? `已保存 ${registeredBankDocuments?.length || 0} 张${allBankCredentials.length ? ` · 新增 ${allBankCredentials.length} 张` : ""}`
                : allBankCredentials.length
                  ? `已添加 ${allBankCredentials.length} 张`
                  : "等待上传"
            }}
          </el-tag>
        </div>

        <div
          v-if="registrationId && registeredBankDocuments?.length"
          class="credential-uploader registered-credential-uploader"
        >
          <div class="selected-file">
            <button
              type="button"
              class="selected-file-icon registered-file-icon"
              :title="`在新窗口预览已保存${bankDocumentLabel}`"
              :disabled="!registeredBankDocuments?.[0]?.previewUrl"
              @click="openRegisteredBankPreview(registeredBankDocuments?.[0])"
            >
              <el-icon><Document /></el-icon>
            </button>
            <strong
              >已保存 {{ registeredBankDocuments.length }} 张{{
                bankDocumentLabel
              }}</strong
            >
            <small>已保存凭证保持只读；仍可在下方继续补充</small>
          </div>
        </div>

        <el-upload
          ref="bankUploadRef"
          class="credential-uploader"
          drag
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :disabled="
            submitting ||
            (!invoiceContextReady && !requiresExternalPayment) ||
            !fundingModeReady
          "
          :on-change="(file: UploadFile) => handleCredentialFile('bank', file)"
          accept=".pdf,.jpg,.jpeg,.png"
        >
          <div v-if="bankCredential.file" class="selected-file">
            <span
              class="selected-file-icon"
              role="button"
              tabindex="0"
              :title="`在新窗口预览${bankDocumentLabel}`"
              :aria-label="`在新窗口预览当前${bankDocumentLabel}`"
              @click.stop.prevent="openCredentialPreview(bankCredential)"
              @keydown.enter.stop.prevent="
                openCredentialPreview(bankCredential)
              "
              ><el-icon><Document /></el-icon
            ></span>
            <strong :title="bankCredential.file.name">{{
              bankCredential.file.name
            }}</strong>
            <small>
              {{ formatFileSize(bankCredential.file.size) }} ·
              点击此区域继续添加，可一次选择多张
            </small>
            <span class="continue-upload-hint">
              <el-icon><UploadFilled /></el-icon>
              继续添加{{ bankDocumentLabel }}
            </span>
          </div>
          <div v-else class="empty-upload">
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <strong>{{
              bankCredentials.length
                ? `继续添加${bankDocumentLabel}`
                : `拖拽或点击上传${bankDocumentLabel}`
            }}</strong>
            <small
              >支持一次选择多张；PDF（便携式文档格式）、JPG、JPEG、PNG，单个文件不超过
              30MB</small
            >
          </div>
        </el-upload>

        <div
          v-if="bankCredential.status === 'recognizing'"
          class="recognizing-state"
        >
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在识别{{ bankDocumentLabel }}，请稍候…</span>
        </div>
        <el-alert
          v-if="bankCredential.error"
          class="credential-error"
          type="error"
          show-icon
          closable
          :title="bankCredential.error"
          @close="bankCredential.error = ''"
        />

        <div
          v-if="registrationId && registeredBankDocuments?.length"
          class="credential-table-wrap"
        >
          <el-table
            :data="registeredBankDocuments"
            border
            class="credential-table"
            table-layout="fixed"
            :aria-label="`已保存${bankDocumentLabel}明细`"
          >
            <el-table-column label="序号" width="40" align="center">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="付款人户名" min-width="90" align="center">
              <template #default="{ row }">{{ row.payer || "—" }}</template>
            </el-table-column>
            <el-table-column label="付款人账号" min-width="90" align="center">
              <template #default="{ row }">{{
                row.payerAccount || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="收款人户名" min-width="120" align="center">
              <template #default="{ row }">{{ row.payee || "—" }}</template>
            </el-table-column>
            <el-table-column label="收款人账号" min-width="90" align="center">
              <template #default="{ row }">{{
                row.payeeAccount || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="电子回单号码" min-width="90" align="center">
              <template #default="{ row }">{{
                row.referenceNo || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="付款时间" width="75" align="center">
              <template #default="{ row }">{{
                row.paymentTime || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="center">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.amount)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="82" align="center">
              <template #default="{ row }">
                <button
                  type="button"
                  class="thumbnail-button"
                  :title="`在新窗口预览${row.fileName || bankDocumentLabel}`"
                  :disabled="!row.previewUrl"
                  @click="openRegisteredBankPreview(row)"
                >
                  <el-icon><Document /></el-icon>
                </button>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-total">
            已保存{{ bankDocumentLabel }}共
            {{ registeredBankDocuments.length }} 张，总金额
            <strong>{{ formatRecognizedMoney(registeredBankTotal) }}</strong>
          </div>
        </div>

        <div v-if="allBankCredentials.length" class="credential-table-wrap">
          <el-table
            :data="allBankCredentials"
            border
            class="credential-table"
            table-layout="fixed"
            :aria-label="`已上传${bankDocumentLabel}识别明细`"
          >
            <el-table-column label="序号" width="40" align="center">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="付款人户名" min-width="90" align="center">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payer || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="付款人账号" min-width="90" align="center">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payerAccount || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="收款人户名" min-width="120" align="center">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payee || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="收款人账号" min-width="90" align="center">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payeeAccount || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="电子回单号码" min-width="90" align="center">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.electronicReceiptNo || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="付款时间" width="75" align="center">
              <template #default="{ row }">{{
                formatPaymentDate(bankFieldsFor(row)?.paymentTime)
              }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="center">
              <template #default="{ row }">{{
                formatRecognizedMoney(bankAmount(row))
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="82" align="center">
              <template #default="{ row }">
                <div class="thumbnail-actions">
                  <button
                    type="button"
                    class="thumbnail-button"
                    :title="`在新窗口预览${row.file?.name || bankDocumentLabel}`"
                    :disabled="!row.previewUrl"
                    @click="openCredentialPreview(row)"
                  >
                    <el-icon><Document /></el-icon>
                  </button>
                  <button
                    type="button"
                    class="thumbnail-remove-button"
                    :title="`移除${bankDocumentLabel}`"
                    :disabled="
                      row.status === 'recognizing' ||
                      submitting ||
                      clearing ||
                      isRemovingCredential(row.key)
                    "
                    @click="removeCredentialByKey('bank', row.key)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-total">
            本次新增{{ bankDocumentLabel }}共
            {{ allBankCredentials.length }} 张，总金额
            <strong>{{ formatRecognizedMoney(newBankTotal) }}</strong>
          </div>
        </div>

        <el-alert
          v-if="bankBlockingPresentation"
          :key="bankCredential.result?.id"
          class="credential-guidance"
          :type="bankBlockingPresentation.type"
          show-icon
          closable
          :title="bankBlockingPresentation.title"
        >
          <template #default>
            <p>{{ bankBlockingPresentation.message }}</p>
            <p class="credential-guidance-action">
              <strong>处理方式：</strong>{{ bankBlockingPresentation.action }}
            </p>
            <details v-if="bankBlockingPresentation.details.length">
              <summary>
                查看核验详情（{{ bankBlockingPresentation.details.length }}项）
              </summary>
              <ul>
                <li
                  v-for="reason in bankBlockingPresentation.details"
                  :key="reason"
                >
                  {{ reason }}
                </li>
              </ul>
            </details>
          </template>
        </el-alert>
      </article>

      <article
        v-if="requiresExternalPayment"
        class="credential-card external-card"
      >
        <div class="credential-heading">
          <span class="credential-index">02</span>
          <div>
            <h3>{{ externalPaymentLabel }}</h3>
            <p :title="externalPaymentCounterpartyDescription">
              {{ externalPaymentCounterpartyDescription }}
            </p>
          </div>
          <el-tag
            :type="credentialTagType(externalCredential.status)"
            size="small"
          >
            {{
              totalExternalDocumentCount
                ? `已添加 ${totalExternalDocumentCount} 张`
                : "等待上传"
            }}
          </el-tag>
        </div>

        <el-upload
          ref="externalUploadRef"
          class="credential-uploader"
          drag
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :disabled="submitting"
          :on-change="
            (file: UploadFile) => handleCredentialFile('external', file)
          "
          accept=".pdf,.jpg,.jpeg,.png"
        >
          <div v-if="externalCredential.file" class="selected-file">
            <span
              class="selected-file-icon"
              role="button"
              tabindex="0"
              :title="`预览${externalPaymentLabel}`"
              @click.stop.prevent="openCredentialPreview(externalCredential)"
              ><el-icon><Document /></el-icon
            ></span>
            <strong>{{ externalCredential.file.name }}</strong>
            <small>
              {{ formatFileSize(externalCredential.file.size) }} ·
              点击此区域继续添加，可一次选择多张
            </small>
            <span class="continue-upload-hint">
              <el-icon><UploadFilled /></el-icon>
              继续添加{{ externalPaymentLabel }}
            </span>
          </div>
          <div v-else class="empty-upload">
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <strong>
              {{
                allExternalCredentials.length
                  ? `继续添加${externalPaymentLabel}`
                  : `拖拽或点击上传${externalPaymentLabel}`
              }}
            </strong>
            <small>
              支持一次选择多张或分批追加；付款人必须为科技公司，收款人必须为本合同对方
            </small>
          </div>
        </el-upload>

        <div
          v-if="externalCredential.status === 'recognizing'"
          class="recognizing-state"
        >
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在识别{{ externalPaymentLabel }}，请稍候…</span>
        </div>
        <el-alert
          v-if="externalCredential.error"
          class="credential-error"
          type="error"
          show-icon
          closable
          :title="externalCredential.error"
          @close="externalCredential.error = ''"
        />

        <div
          v-if="registeredExternalPayments?.length"
          class="credential-table-wrap"
        >
          <el-table
            :data="registeredExternalPayments"
            border
            class="credential-table"
            table-layout="fixed"
          >
            <el-table-column label="付款人" min-width="170">
              <template #default="{ row }">{{ row.payer || "—" }}</template>
            </el-table-column>
            <el-table-column label="收款人" min-width="190">
              <template #default="{ row }">{{ row.payee || "—" }}</template>
            </el-table-column>
            <el-table-column label="电子回单号码" min-width="170">
              <template #default="{ row }">{{
                row.referenceNo || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="付款日期" width="120">
              <template #default="{ row }">{{
                row.paymentTime || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="金额" width="120">
              <template #default="{ row }">{{
                formatRecognizedMoney(row.amount)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="78">
              <template #default="{ row }">
                <button
                  type="button"
                  class="thumbnail-button"
                  :title="`在新窗口预览${row.fileName || externalPaymentLabel}`"
                  :disabled="!row.previewUrl"
                  @click="openRegisteredBankPreview(row)"
                >
                  <el-icon><Document /></el-icon>
                </button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="allExternalCredentials.length" class="credential-table-wrap">
          <el-table
            :data="allExternalCredentials"
            border
            class="credential-table"
            table-layout="fixed"
          >
            <el-table-column label="付款人" min-width="170">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payer || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="收款人" min-width="190">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.payee || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="电子回单号码" min-width="170">
              <template #default="{ row }">{{
                bankFieldsFor(row)?.electronicReceiptNo || "—"
              }}</template>
            </el-table-column>
            <el-table-column label="付款日期" width="120">
              <template #default="{ row }">{{
                formatPaymentDate(bankFieldsFor(row)?.paymentTime)
              }}</template>
            </el-table-column>
            <el-table-column label="金额" width="120">
              <template #default="{ row }">{{
                formatRecognizedMoney(bankAmount(row))
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="82" align="center">
              <template #default="{ row }">
                <div class="thumbnail-actions">
                  <button
                    type="button"
                    class="thumbnail-button"
                    :title="`在线预览${row.file?.name || externalPaymentLabel}`"
                    :aria-label="`在线预览${externalPaymentLabel}`"
                    :disabled="!row.previewUrl"
                    @click="openCredentialPreview(row)"
                  >
                    <el-icon><Document /></el-icon>
                  </button>
                  <button
                    type="button"
                    class="thumbnail-remove-button"
                    :title="`移除${externalPaymentLabel}`"
                    :disabled="row.status === 'recognizing' || submitting"
                    @click="removeCredentialByKey('external', row.key)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-total">
            {{ externalPaymentLabel }}合计
            <strong>{{ formatRecognizedMoney(externalTotal) }}</strong>
          </div>
        </div>
      </article>
    </div>

    <div
      class="registration-totals"
      :class="{
        mismatch: settlementOverAmount,
        partial: partialSettlement,
      }"
    >
      <span
        >发票合计
        <strong>{{ formatRecognizedMoney(invoiceTotal) }}</strong></span
      >
      <span
        >回单合计 <strong>{{ formatRecognizedMoney(bankTotal) }}</strong></span
      >
      <span v-if="requiresExternalPayment"
        >科技对外付款
        <strong>{{ formatRecognizedMoney(externalTotal) }}</strong></span
      >
      <el-tag
        :type="
          settlementOverAmount
            ? 'danger'
            : partialSettlement
              ? 'warning'
              : totalsComparable
                ? 'success'
                : 'info'
        "
      >
        {{
          settlementOverAmount
            ? `${bankDocumentLabel}金额超过发票`
            : partialSettlement
              ? `部分${settlementActionLabel}，待补 ${formatRecognizedMoney(remainingSettlementAmount)}`
              : totalsComparable
                ? "金额已对应"
                : canSaveInvoiceOnly
                  ? `可先保存待${settlementActionLabel}草稿`
                  : "等待识别完成"
        }}
      </el-tag>
    </div>

    <section v-if="allocationPreview.length" class="allocation-preview">
      <h3>发票与{{ bankDocumentLabel }}对应关系</h3>
      <div class="allocation-preview-header">
        <span>序号</span><span>发票</span><span>对应</span
        ><span>{{ bankDocumentLabel }}</span
        ><span>对应金额</span>
      </div>
      <div
        v-for="(allocation, index) in allocationPreview"
        :key="`${allocation.invoiceIndex}:${allocation.bankIndex}`"
        class="allocation-preview-row"
      >
        <span>{{ index + 1 }}</span>
        <span>{{ allocation.invoiceLabel }}</span>
        <span>对应</span>
        <span>{{ allocation.bankLabel }}</span>
        <strong>{{ formatRecognizedMoney(allocation.amount) }}</strong>
      </div>
    </section>

    <div class="registration-form">
      <el-form label-position="top">
        <div class="registration-form-grid single-field">
          <el-form-item label="备注">
            <el-input
              v-model="note"
              type="textarea"
              :rows="2"
              maxlength="300"
              show-word-limit
              placeholder="可填写本次财务登记的特殊情况"
            />
          </el-form-item>
        </div>
      </el-form>
    </div>

    <footer class="registration-actions">
      <div class="completion-hint">
        <el-icon :class="{ complete: canSubmit }"><CircleCheck /></el-icon>
        <span>{{ completionHint }}</span>
      </div>
      <div>
        <el-button
          :loading="clearing"
          :disabled="submitting || anyRecognizing || clearing"
          @click="clearWorkspace"
        >
          清空
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submitRegistration"
          >{{ submitButtonLabel }}</el-button
        >
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { UploadFile, UploadInstance } from "element-plus";
import { ElMessage } from "element-plus";
import {
  CircleCheck,
  Delete,
  Document,
  Loading,
  UploadFilled,
} from "@element-plus/icons-vue";
import type {
  ContractCategory,
  ContractFinancialBankFields,
  ContractFinancialBlockingReason,
  ContractFinancialDirection,
  ContractFinancialInvoiceFields,
  ContractInvoiceLineItem,
  ContractInvoiceLineExpenseCategory,
  ContractFinancialOcrResult,
} from "@/types/contract";

const INVOICE_LINE_CATEGORY_LABELS: Record<
  ContractInvoiceLineExpenseCategory,
  string
> = {
  rent: "租金",
  property_management: "物业管理费",
  electricity: "电费",
  system_maintenance: "系统维护费",
  other_cost: "其他成本",
  pending_review: "待核对",
};
function invoiceLineCategoryLabel(value: unknown): string {
  return (
    INVOICE_LINE_CATEGORY_LABELS[
      String(value || "pending_review") as ContractInvoiceLineExpenseCategory
    ] || "待核对"
  );
}
import {
  appendContractFinancialRegistrationExternalPayments,
  appendContractFinancialRegistrationSettlements,
  createContractExternalPaymentRegistration,
  createContractFinancialRegistration,
  deleteContractFinancialOcrUpload,
  getContractFileUrl,
  getContractErrorCode,
  getContractErrorMessage,
  getPendingContractFinancialOcrUploads,
  recognizeContractFinancialFile,
} from "@/utils/contractApi";

type CredentialKind = "invoice" | "bank" | "external";
type CredentialStatus =
  | "idle"
  | "recognizing"
  | "verified"
  | "blocked"
  | "error";

interface CredentialState {
  key: string;
  file: File | null;
  previewUrl: string;
  previewExpanded: boolean;
  status: CredentialStatus;
  result: ContractFinancialOcrResult | null;
  error: string;
  sequence: number;
}

interface BankBlockingPresentation {
  type: "warning" | "error";
  statusLabel: string;
  title: string;
  message: string;
  action: string;
  footerHint: string;
  details: string[];
}

interface RegisteredInvoice {
  id: string;
  label: string;
  amount: number;
  buyer?: string | null;
  seller?: string | null;
  itemName?: string | null;
  invoiceNo?: string | null;
  recordDate?: string | null;
  fileName?: string | null;
  previewUrl?: string;
  financialDirection?: ContractFinancialDirection | null;
  lineItems?: ContractInvoiceLineItem[];
}

interface RegisteredBankDocument {
  id: string;
  label: string;
  amount: number;
  payer?: string | null;
  payerAccount?: string | null;
  payee?: string | null;
  payeeAccount?: string | null;
  referenceNo?: string | null;
  paymentTime?: string | null;
  fileName?: string | null;
  previewUrl?: string;
}

const BANK_BUSINESS_REVIEW_CODES = new Set([
  "COMPANY_BANK_ACCOUNT_NOT_CONFIGURED",
  "COMPANY_BANK_ACCOUNT_MISMATCH",
  "BANK_DIRECTION_UNKNOWN",
  "FINANCIAL_DIRECTION_MISMATCH",
]);
const BANK_LEGACY_PARSER_CONFLICT_CODES = new Set([
  "FIELD_CONFLICT_PAYER",
  "FIELD_CONFLICT_PAYERACCOUNT",
  "FIELD_CONFLICT_PAYEE",
  "FIELD_CONFLICT_PAYEEACCOUNT",
]);
const INVOICE_DUPLICATE_CODES = new Set([
  "FINANCIAL_FILE_HASH_DUPLICATE",
  "DUPLICATE_CONTRACT_INVOICE",
  "INVOICE_ALREADY_USED_IN_OTHER_MODULE",
]);
const BANK_DUPLICATE_CODES = new Set([
  "FINANCIAL_FILE_HASH_DUPLICATE",
  "DUPLICATE_CONTRACT_BANK_DOCUMENT",
]);

const props = defineProps<{
  contractId: string;
  category: ContractCategory;
  assetFundingMode?:
    | "engineering_direct"
    | "engineering_to_technology"
    | "technology_direct"
    | "pending_review";
  contractCounterparty?: string;
  isRentalLease?: boolean;
  registrationId?: string;
  registeredInvoices?: RegisteredInvoice[];
  registeredBankDocuments?: RegisteredBankDocument[];
  registeredExternalPayments?: RegisteredBankDocument[];
  registrationFinancialDirection?: "income" | "cost" | null;
}>();

const emit = defineEmits<{
  created: [];
  cancelContinuation: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const invoiceUploadRef = ref<UploadInstance>();
const bankUploadRef = ref<UploadInstance>();
const externalUploadRef = ref<UploadInstance>();
const invoiceCredential = reactive<CredentialState>(createCredentialState());
const bankCredential = reactive<CredentialState>(createCredentialState());
const externalCredential = reactive<CredentialState>(createCredentialState());
const invoiceCredentials = reactive<CredentialState[]>([]);
const bankCredentials = reactive<CredentialState[]>([]);
const externalCredentials = reactive<CredentialState[]>([]);
const note = ref("");
const pageError = ref("");
const submitting = ref(false);
const clearing = ref(false);
const removingCredentialKeys = ref<string[]>([]);
const credentialQueues: Record<CredentialKind, Promise<void>> = {
  invoice: Promise.resolve(),
  bank: Promise.resolve(),
  external: Promise.resolve(),
};

const bankBlockingPresentation = computed<BankBlockingPresentation | null>(
  () => {
    if (bankCredential.status !== "blocked") return null;
    return presentBankBlockingReasons(
      bankCredential.result?.blockingReasons || [],
      bankDocumentLabel.value,
    );
  },
);
const bankCredentialTagType = computed<
  "info" | "warning" | "success" | "danger"
>(() => {
  if (bankBlockingPresentation.value?.type === "error") return "danger";
  return (
    bankBlockingPresentation.value?.type ||
    credentialTagType(bankCredential.status)
  );
});
const anyRecognizing = computed(
  () =>
    allInvoiceCredentials.value.some((item) => item.status === "recognizing") ||
    allBankCredentials.value.some((item) => item.status === "recognizing") ||
    allExternalCredentials.value.some((item) => item.status === "recognizing"),
);
const allInvoiceCredentials = computed(() => [
  ...invoiceCredentials,
  ...(invoiceCredential.file ? [invoiceCredential] : []),
]);
const allBankCredentials = computed(() => [
  ...bankCredentials,
  ...(bankCredential.file ? [bankCredential] : []),
]);
const allExternalCredentials = computed(() => [
  ...externalCredentials,
  ...(externalCredential.file ? [externalCredential] : []),
]);
const newInvoiceDocumentDirections = computed(() =>
  allInvoiceCredentials.value
    .filter((item) => item.status === "verified")
    .map((item) => item.result?.direction)
    .filter(
      (direction): direction is "input" | "output" =>
        direction === "input" || direction === "output",
    ),
);
const categoryBusinessDirection = computed<"income" | "cost">(() =>
  props.category === "asset" ? "cost" : "income",
);
const expectedInvoiceDocumentDirection = computed<"input" | "output">(() =>
  categoryBusinessDirection.value === "cost" ? "input" : "output",
);
const invoiceDirectionConflict = computed(() => {
  const directions = new Set(newInvoiceDocumentDirections.value);
  return (
    (props.registrationFinancialDirection != null &&
      props.registrationFinancialDirection !==
        categoryBusinessDirection.value) ||
    directions.size > 1 ||
    [...directions].some(
      (direction) => direction !== expectedInvoiceDocumentDirection.value,
    )
  );
});
const invoiceBusinessDirection = computed<"income" | "cost" | null>(() => {
  if (invoiceDirectionConflict.value) return null;
  return categoryBusinessDirection.value;
});
const invoiceContextReady = computed(
  () =>
    !invoiceDirectionConflict.value &&
    ((props.registeredInvoices?.length || 0) > 0 ||
      newInvoiceDocumentDirections.value.length > 0),
);
const isCostDirection = computed(
  () => invoiceBusinessDirection.value === "cost",
);
const fundingModeReady = computed(
  () =>
    !isCostDirection.value ||
    Boolean(
      props.assetFundingMode && props.assetFundingMode !== "pending_review",
    ),
);
const requiresExternalPayment = computed(
  () =>
    isCostDirection.value &&
    props.assetFundingMode === "engineering_to_technology",
);
const bankDocumentLabel = computed(() =>
  isCostDirection.value
    ? requiresExternalPayment.value
      ? "工程咨询→科技划拨回单"
      : "付款凭证"
    : "回款回单",
);
const externalPaymentLabel = computed(() => "科技→合同对方付款回单");
const externalPaymentCounterpartyDescription = computed(() =>
  props.contractCounterparty
    ? `收款方：${props.contractCounterparty} · 只核销履约，不重复计入工程咨询支出`
    : "收款方为合同对方 · 只核销履约，不重复计入工程咨询支出",
);
const bankOcrKind = computed(() =>
  isCostDirection.value ? ("payment" as const) : ("receipt" as const),
);
const settlementActionLabel = computed(() =>
  isCostDirection.value ? "付款" : "回款",
);
const postedSettlementLabel = computed(() =>
  isCostDirection.value
    ? requiresExternalPayment.value
      ? "工程已支出"
      : "已付款"
    : "已回款",
);
const continuationDescription = computed(
  () =>
    `已保存的发票和${bankDocumentLabel.value}会继续保留；${bankDocumentLabel.value}保存后立即计入${postedSettlementLabel.value}，累计金额未补齐时可继续添加凭证，全部对应后再确认整笔配对。`,
);
const registeredInvoiceTotal = computed(() =>
  props.registrationId
    ? (props.registeredInvoices || []).reduce(
        (sum, item) => sum + Number(item.amount),
        0,
      )
    : 0,
);
const registeredInvoiceLineItems = computed(() =>
  (props.registeredInvoices || []).flatMap((invoice) =>
    (invoice.lineItems || []).map((item) => ({
      ...item,
      invoiceNumber: invoice.invoiceNo || invoice.label,
    })),
  ),
);
const newInvoiceTotal = computed(() =>
  allInvoiceCredentials.value.reduce(
    (sum, item) => sum + invoiceAmount(item),
    0,
  ),
);
const newInvoiceLineItems = computed(() =>
  allInvoiceCredentials.value.flatMap((credential) => {
    const fields = invoiceFieldsFor(credential);
    return (fields?.lineItems || []).map((item) => ({
      ...item,
      invoiceNumber: fields?.invoiceNumber || "—",
    }));
  }),
);
const invoiceTotal = computed(
  () => registeredInvoiceTotal.value + newInvoiceTotal.value,
);
const registeredBankTotal = computed(() =>
  props.registrationId
    ? (props.registeredBankDocuments || []).reduce(
        (sum, item) => sum + Number(item.amount),
        0,
      )
    : 0,
);
const newBankTotal = computed(() =>
  allBankCredentials.value.reduce((sum, item) => sum + bankAmount(item), 0),
);
const bankTotal = computed(
  () => registeredBankTotal.value + newBankTotal.value,
);
const registeredExternalTotal = computed(() =>
  props.registrationId
    ? (props.registeredExternalPayments || []).reduce(
        (sum, item) => sum + Number(item.amount),
        0,
      )
    : 0,
);
const newExternalTotal = computed(() =>
  allExternalCredentials.value.reduce((sum, item) => sum + bankAmount(item), 0),
);
const externalTotal = computed(
  () => registeredExternalTotal.value + newExternalTotal.value,
);
const accountingDocumentLabel = computed(() =>
  requiresExternalPayment.value
    ? externalPaymentLabel.value
    : settlementActionLabel.value,
);
const accountingSettlementTotal = computed(() =>
  requiresExternalPayment.value ? externalTotal.value : bankTotal.value,
);
const totalsComparable = computed(
  () =>
    ((props.registeredInvoices || []).length > 0 ||
      allInvoiceCredentials.value.length > 0) &&
    (requiresExternalPayment.value
      ? (props.registeredExternalPayments || []).length > 0 ||
        allExternalCredentials.value.length > 0
      : (props.registeredBankDocuments || []).length > 0 ||
        allBankCredentials.value.length > 0) &&
    allInvoiceCredentials.value.every((item) => item.status === "verified") &&
    (requiresExternalPayment.value
      ? allExternalCredentials.value.every((item) => item.status === "verified")
      : allBankCredentials.value.every((item) => item.status === "verified")),
);
const settlementDifferenceCents = computed(
  () =>
    Math.round(invoiceTotal.value * 100) -
    Math.round(accountingSettlementTotal.value * 100),
);
const partialSettlement = computed(
  () => totalsComparable.value && settlementDifferenceCents.value > 0,
);
const settlementOverAmount = computed(
  () => totalsComparable.value && settlementDifferenceCents.value < 0,
);
const remainingSettlementAmount = computed(
  () => Math.max(0, settlementDifferenceCents.value) / 100,
);
const invoiceReady = computed(
  () =>
    !props.registrationId &&
    allInvoiceCredentials.value.length > 0 &&
    allInvoiceCredentials.value.every((item) => item.status === "verified") &&
    Boolean(invoiceBusinessDirection.value),
);
const canSaveInvoiceOnly = computed(
  () =>
    invoiceReady.value &&
    allBankCredentials.value.length === 0 &&
    allExternalCredentials.value.length === 0 &&
    !anyRecognizing.value &&
    !submitting.value,
);
const canSaveExternalPaymentOnly = computed(
  () =>
    !props.registrationId &&
    requiresExternalPayment.value &&
    allInvoiceCredentials.value.length === 0 &&
    allBankCredentials.value.length === 0 &&
    allExternalCredentials.value.length > 0 &&
    allExternalCredentials.value.every((item) => item.status === "verified") &&
    !anyRecognizing.value &&
    !submitting.value,
);
const canSaveRegistrationDraft = computed(
  () =>
    !submitting.value &&
    !anyRecognizing.value &&
    totalsComparable.value &&
    (requiresExternalPayment.value || !settlementOverAmount.value) &&
    allExternalCredentials.value.every((item) => item.status === "verified") &&
    fundingModeReady.value &&
    (!props.registrationId ||
      allBankCredentials.value.length > 0 ||
      allExternalCredentials.value.length > 0) &&
    Boolean(invoiceBusinessDirection.value),
);
const totalInvoiceDocumentCount = computed(
  () =>
    (props.registeredInvoices?.length || 0) +
    allInvoiceCredentials.value.length,
);
const totalBankDocumentCount = computed(
  () =>
    (props.registeredBankDocuments?.length || 0) +
    allBankCredentials.value.length,
);
const totalExternalDocumentCount = computed(
  () =>
    (props.registeredExternalPayments?.length || 0) +
    allExternalCredentials.value.length,
);
const allocationPreview = computed(() => {
  if (
    props.registrationId ||
    !totalsComparable.value ||
    settlementOverAmount.value
  )
    return [];
  const invoices = [
    ...(props.registrationId
      ? (props.registeredInvoices || []).map((invoice) => ({
          cents: Math.round(Number(invoice.amount) * 100),
          label: invoice.label,
        }))
      : []),
    ...allInvoiceCredentials.value.map((credential, index) => ({
      cents: Math.round(invoiceAmount(credential) * 100),
      label:
        invoiceFieldsFor(credential)?.invoiceNumber ||
        credential.file?.name ||
        `第${index + 1}张发票`,
    })),
  ];
  const banks = [
    ...(props.registrationId
      ? (props.registeredBankDocuments || []).map((document) => ({
          cents: Math.round(Number(document.amount) * 100),
          label: document.label,
        }))
      : []),
    ...allBankCredentials.value.map((credential, index) => ({
      cents: Math.round(bankAmount(credential) * 100),
      label:
        bankFieldsFor(credential)?.electronicReceiptNo ||
        credential.file?.name ||
        `第${index + 1}张${bankDocumentLabel.value}`,
    })),
  ];
  const result: Array<{
    invoiceIndex: number;
    bankIndex: number;
    invoiceLabel: string;
    bankLabel: string;
    amount: number;
  }> = [];
  const invoiceRemaining = invoices.map((item) => item.cents);
  const bankRemaining = banks.map((item) => item.cents);
  const appendAllocation = (
    invoiceIndex: number,
    bankIndex: number,
    allocated: number,
  ) => {
    result.push({
      invoiceIndex,
      bankIndex,
      invoiceLabel: `发票 ${invoices[invoiceIndex]!.label}`,
      bankLabel: `${bankDocumentLabel.value} ${banks[bankIndex]!.label}`,
      amount: allocated / 100,
    });
  };
  for (
    let invoiceIndex = 0;
    invoiceIndex < invoiceRemaining.length;
    invoiceIndex += 1
  ) {
    const bankIndex = bankRemaining.findIndex(
      (amount) => amount > 0 && amount === invoiceRemaining[invoiceIndex],
    );
    if (bankIndex < 0) continue;
    appendAllocation(invoiceIndex, bankIndex, invoiceRemaining[invoiceIndex]!);
    invoiceRemaining[invoiceIndex] = 0;
    bankRemaining[bankIndex] = 0;
  }
  let invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
  let bankIndex = bankRemaining.findIndex((amount) => amount > 0);
  while (invoiceIndex >= 0 && bankIndex >= 0) {
    const allocated = Math.min(
      invoiceRemaining[invoiceIndex]!,
      bankRemaining[bankIndex]!,
    );
    appendAllocation(invoiceIndex, bankIndex, allocated);
    invoiceRemaining[invoiceIndex] -= allocated;
    bankRemaining[bankIndex] -= allocated;
    invoiceIndex = invoiceRemaining.findIndex((amount) => amount > 0);
    bankIndex = bankRemaining.findIndex((amount) => amount > 0);
  }
  return result.sort(
    (left, right) =>
      left.invoiceIndex - right.invoiceIndex ||
      left.bankIndex - right.bankIndex,
  );
});
const canSubmit = computed(
  () =>
    canSaveInvoiceOnly.value ||
    canSaveExternalPaymentOnly.value ||
    canSaveRegistrationDraft.value,
);
const submitButtonLabel = computed(() => {
  if (canSaveExternalPaymentOnly.value) return "先保存科技对外付款";
  if (canSaveInvoiceOnly.value)
    return `保存待${settlementActionLabel.value}发票草稿`;
  if (props.registrationId) {
    if (
      allInvoiceCredentials.value.length > 0 &&
      allBankCredentials.value.length === 0 &&
      allExternalCredentials.value.length === 0
    ) {
      return "保存补充发票";
    }
    if (
      allExternalCredentials.value.length > 0 &&
      allBankCredentials.value.length === 0 &&
      allInvoiceCredentials.value.length === 0
    ) {
      return "保存科技公司最终对外付款";
    }
    return partialSettlement.value
      ? `保存本次部分${settlementActionLabel.value}`
      : `保存本次补充${bankDocumentLabel.value}`;
  }
  return partialSettlement.value
    ? `保存部分${accountingDocumentLabel.value}`
    : requiresExternalPayment.value && allExternalCredentials.value.length
      ? "保存发票和科技对外付款"
      : allBankCredentials.value.length
        ? `保存并登记${settlementActionLabel.value}`
        : "保存财务登记";
});
const completionHint = computed(() => {
  if (anyRecognizing.value) return "正在识别凭证，请等待全部凭证完成";
  if (canSaveExternalPaymentOnly.value)
    return `当前已识别 ${allExternalCredentials.value.length} 张${externalPaymentLabel.value}，可先保存付款事实并进入合同付款进度，后续补充发票核算明细`;
  if (
    requiresExternalPayment.value &&
    totalsComparable.value &&
    settlementDifferenceCents.value < 0
  )
    return `科技对外付款超过当前发票合计 ${formatRecognizedMoney(Math.abs(settlementDifferenceCents.value) / 100)}，可先保存并标记待补发票`;
  if (settlementOverAmount.value) {
    return `${accountingDocumentLabel.value}合计超过发票合计 ${formatRecognizedMoney(Math.abs(settlementDifferenceCents.value) / 100)}，请移除或核对凭证`;
  }
  if (canSaveInvoiceOnly.value)
    return `共${allInvoiceCredentials.value.length}张发票已识别，可先保存草稿，收到回单后再补充`;
  if (partialSettlement.value) {
    const partialHint = `当前累计${accountingDocumentLabel.value} ${formatRecognizedMoney(accountingSettlementTotal.value)}，尚待${accountingDocumentLabel.value} ${formatRecognizedMoney(remainingSettlementAmount.value)}`;
    return canSaveRegistrationDraft.value
      ? `${partialHint}；保存后进入合同核算，后续可继续补充`
      : `${partialHint}；请继续上传新的${requiresExternalPayment.value ? externalPaymentLabel.value : bankDocumentLabel.value}`;
  }
  if (canSaveRegistrationDraft.value) {
    const accountingDocumentCount = requiresExternalPayment.value
      ? totalExternalDocumentCount.value
      : totalBankDocumentCount.value;
    return `共${totalInvoiceDocumentCount.value}张发票、${accountingDocumentCount}张${accountingDocumentLabel.value}，累计金额一致；保存后进入合同核算，并可确认整笔配对`;
  }
  if (
    props.registrationId &&
    !allInvoiceCredentials.value.length &&
    !allBankCredentials.value.length &&
    !allExternalCredentials.value.length
  ) {
    return `可继续添加发票，并上传新的${accountingDocumentLabel.value}`;
  }
  if (
    !totalInvoiceDocumentCount.value &&
    !(requiresExternalPayment.value
      ? totalExternalDocumentCount.value
      : totalBankDocumentCount.value)
  ) {
    return `请上传至少一张发票和一张${accountingDocumentLabel.value}`;
  }
  if (
    !totalInvoiceDocumentCount.value ||
    allInvoiceCredentials.value.some((item) => item.status !== "verified")
  )
    return "请完成并通过全部发票识别";
  if (bankBlockingPresentation.value) {
    return bankBlockingPresentation.value.footerHint;
  }
  if (requiresExternalPayment.value) {
    if (
      !totalExternalDocumentCount.value ||
      allExternalCredentials.value.some((item) => item.status !== "verified")
    ) {
      return `请完成并通过全部${externalPaymentLabel.value}识别`;
    }
  } else if (
    !totalBankDocumentCount.value ||
    allBankCredentials.value.some((item) => item.status !== "verified")
  ) {
    return `请完成并通过全部${bankDocumentLabel.value}识别`;
  }
  if (invoiceDirectionConflict.value)
    return "发票购销方向与合同类型不一致，不能登记";
  if (!invoiceBusinessDirection.value) return "请先通过发票识别以确定收支方向";
  return "请完善本次财务登记";
});

function createCredentialState(): CredentialState {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file: null,
    previewUrl: "",
    previewExpanded: false,
    status: "idle",
    result: null,
    error: "",
    sequence: 0,
  };
}

function stateFor(kind: CredentialKind): CredentialState {
  return kind === "invoice"
    ? invoiceCredential
    : kind === "external"
      ? externalCredential
      : bankCredential;
}

function openRegisteredInvoicePreview(invoice?: RegisteredInvoice) {
  if (!invoice?.previewUrl) return;
  window.open(invoice.previewUrl, "_blank", "noopener,noreferrer");
}

function openRegisteredBankPreview(document?: RegisteredBankDocument) {
  if (!document?.previewUrl) return;
  window.open(document.previewUrl, "_blank", "noopener,noreferrer");
}

function uploadRefFor(kind: CredentialKind): UploadInstance | undefined {
  return kind === "invoice"
    ? invoiceUploadRef.value
    : kind === "external"
      ? externalUploadRef.value
      : bankUploadRef.value;
}

function credentialListFor(kind: CredentialKind): CredentialState[] {
  return kind === "invoice"
    ? invoiceCredentials
    : kind === "external"
      ? externalCredentials
      : bankCredentials;
}

function credentialTagType(
  status: CredentialStatus,
): "info" | "warning" | "success" | "danger" {
  return {
    idle: "info",
    recognizing: "warning",
    verified: "success",
    blocked: "warning",
    error: "danger",
  }[status] as "info" | "warning" | "success" | "danger";
}

function uniqueReasonMessages(
  reasons: readonly ContractFinancialBlockingReason[],
): string[] {
  return [...new Set(reasons.map((reason) => reason.message).filter(Boolean))];
}

function presentBankBlockingReasons(
  reasons: readonly ContractFinancialBlockingReason[],
  documentLabel: string,
): BankBlockingPresentation {
  const legacyParserConflictOnly =
    reasons.length > 0 &&
    reasons.every((reason) =>
      BANK_LEGACY_PARSER_CONFLICT_CODES.has(reason.code),
    );
  if (legacyParserConflictOnly) {
    return {
      type: "warning",
      statusLabel: "内容已识别 · 待重新核验",
      title: `${documentLabel}内容已识别，旧解析结果需要重新核验`,
      message:
        "当前凭证的七项内容已经识别，但旧版内部解析规则把同一识别结果误判为冲突。",
      action:
        "请重新选择同一份原文件，系统会按新版规则重新识别，无需更换凭证。",
      footerHint: `${documentLabel}内容已识别；请重新选择同一原件完成新版核验`,
      details: uniqueReasonMessages(reasons),
    };
  }
  const businessReviewOnly =
    reasons.length > 0 &&
    reasons.every((reason) => BANK_BUSINESS_REVIEW_CODES.has(reason.code));
  if (businessReviewOnly) {
    return {
      type: "warning",
      statusLabel: "识别完成 · 待核对收付方",
      title: `${documentLabel}内容已识别，收付方向需要核对`,
      message:
        "付款人和收款人未能唯一匹配任一已配置公司主体，系统无法确认收付方向。",
      action:
        "请核对户名：一方为已配置公司主体、另一方为外部主体时才能确定收付方向；内部主体之间的划拨不计合同收支。",
      footerHint: `${documentLabel}已识别；请核对付款人和收款人户名`,
      details: uniqueReasonMessages(reasons),
    };
  }

  return {
    type: "error",
    statusLabel: "核验未通过",
    title: `${documentLabel}未通过核验`,
    message: "部分关键内容缺失、冲突，或凭证状态不符合登记要求。",
    action: "请查看核验详情，并按提示上传清晰、完整且有效的凭证。",
    footerHint: `请处理${documentLabel}核验问题后再提交登记`,
    details: uniqueReasonMessages(reasons),
  };
}

function validateFile(file: File): string {
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    return "仅支持 PDF（便携式文档格式）、JPG、JPEG、PNG 文件";
  }
  if (file.size > 30 * 1024 * 1024) return "单个凭证文件不能超过 30MB";
  return "";
}

function normalizeInvoiceIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "");
}

function invoiceBusinessKey(seller: unknown, invoiceNumber: unknown): string {
  const sellerKey = normalizeInvoiceIdentity(seller);
  const invoiceNumberKey = normalizeInvoiceIdentity(invoiceNumber);
  return sellerKey && invoiceNumberKey
    ? `${sellerKey}:${invoiceNumberKey}`
    : "";
}

function normalizeBankReceiptNumber(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function findBankDuplicateInWorkspace(
  result: ContractFinancialOcrResult,
  kind: "bank" | "external",
): { electronicReceiptNo: string; sameJob: boolean } | null {
  if (result.recordKind === "invoice") return null;
  const fields = result.snapshot.fields;
  if (!("electronicReceiptNo" in fields)) return null;
  const electronicReceiptNo = String(fields.electronicReceiptNo || "").trim();
  const key = normalizeBankReceiptNumber(electronicReceiptNo);
  if (!key) return null;
  const pendingDuplicate = credentialListFor(kind).find((credential) => {
    if (credential.result?.id === result.id) return true;
    return (
      normalizeBankReceiptNumber(
        bankFieldsFor(credential)?.electronicReceiptNo,
      ) === key
    );
  });
  if (pendingDuplicate) {
    return {
      electronicReceiptNo,
      sameJob: pendingDuplicate.result?.id === result.id,
    };
  }
  const registeredDocuments =
    kind === "external"
      ? props.registeredExternalPayments || []
      : props.registeredBankDocuments || [];
  const savedDuplicate = registeredDocuments.some(
    (document) => normalizeBankReceiptNumber(document.referenceNo) === key,
  );
  return savedDuplicate ? { electronicReceiptNo, sameJob: false } : null;
}

function findInvoiceDuplicateInWorkspace(result: ContractFinancialOcrResult): {
  invoiceNumber: string;
  sameJob: boolean;
} | null {
  if (result.recordKind !== "invoice") return null;
  const fields = result.snapshot.fields;
  if (!("invoiceNumber" in fields)) return null;
  const key = invoiceBusinessKey(fields.seller, fields.invoiceNumber);
  const invoiceNumber = String(fields.invoiceNumber || "").trim();
  const pendingDuplicate = invoiceCredentials.find((credential) => {
    if (credential.result?.id === result.id) return true;
    const existingFields = invoiceFieldsFor(credential);
    return (
      key &&
      existingFields != null &&
      invoiceBusinessKey(
        existingFields.seller,
        existingFields.invoiceNumber,
      ) === key
    );
  });
  if (pendingDuplicate) {
    return {
      invoiceNumber,
      sameJob: pendingDuplicate.result?.id === result.id,
    };
  }
  const savedDuplicate = (props.registeredInvoices || []).some(
    (invoice) =>
      key && invoiceBusinessKey(invoice.seller, invoice.invoiceNo) === key,
  );
  return savedDuplicate ? { invoiceNumber, sameJob: false } : null;
}

async function discardDuplicateInvoiceResult(
  state: CredentialState,
  result: ContractFinancialOcrResult,
  message: string,
  preserveServerJob = false,
): Promise<boolean> {
  if (!preserveServerJob && result.id) {
    try {
      await deleteContractFinancialOcrUpload(props.contractId, result.id);
    } catch (error) {
      state.result = result;
      state.status = "blocked";
      state.error = `${message}；${getContractErrorMessage(error, "重复上传记录清理失败，请手动移除")}`;
      return false;
    }
  }
  removeCredential("invoice");
  ElMessage.warning(message);
  return true;
}

async function discardDuplicateBankResult(
  state: CredentialState,
  result: ContractFinancialOcrResult,
  kind: "bank" | "external",
  message: string,
  preserveServerJob = false,
): Promise<boolean> {
  if (!preserveServerJob && result.id) {
    try {
      await deleteContractFinancialOcrUpload(props.contractId, result.id);
    } catch (error) {
      state.result = result;
      state.status = "blocked";
      state.error = `${message}；${getContractErrorMessage(error, "重复回单记录清理失败，请手动移除")}`;
      return false;
    }
  }
  removeCredential(kind);
  ElMessage.warning(message);
  return true;
}

function invalidFinancialDocumentMessage(
  result: ContractFinancialOcrResult,
  kind: CredentialKind,
): string | null {
  const expectedCode =
    kind === "invoice"
      ? "INVOICE_DOCUMENT_TYPE_MISMATCH"
      : "BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH";
  if (!result.blockingReasons.some((reason) => reason.code === expectedCode)) {
    return null;
  }
  return kind === "invoice" ? "此不是有效发票" : "此不是有效回单";
}

async function discardInvalidFinancialDocument(
  state: CredentialState,
  result: ContractFinancialOcrResult,
  kind: CredentialKind,
  message: string,
): Promise<void> {
  if (result.id) {
    try {
      await deleteContractFinancialOcrUpload(props.contractId, result.id);
    } catch (error) {
      state.result = result;
      state.status = "error";
      state.error = `${message}；${getContractErrorMessage(error, "无效凭证清理失败，请手动移除")}`;
      return;
    }
  }
  removeCredential(kind);
  ElMessage.error(message);
}

function releasePreview(state: CredentialState) {
  if (state.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.previewUrl);
  }
  state.previewUrl = "";
  state.previewExpanded = false;
}

function restoredCredentialState(
  result: ContractFinancialOcrResult,
): CredentialState {
  const canCreateDraft = result.canCreateDraft;
  return {
    key: `restored-${result.id}`,
    file: null,
    previewUrl: getContractFileUrl(result.fileId),
    previewExpanded: false,
    status: canCreateDraft ? "verified" : "blocked",
    result,
    error: canCreateDraft
      ? ""
      : result.blockingReasons.map((reason) => reason.message).join("；"),
    sequence: 0,
  };
}

function restoredCredentialKind(
  result: ContractFinancialOcrResult,
): CredentialKind {
  if (result.recordKind === "invoice") return "invoice";
  if (result.recordKind === "receipt") return "bank";
  if (!requiresExternalPayment.value) return "bank";
  const fields = result.snapshot.fields;
  if (!("paymentTime" in fields)) return "bank";
  return normalizeInvoiceIdentity(fields.payee) ===
    normalizeInvoiceIdentity(props.contractCounterparty)
    ? "external"
    : "bank";
}

async function loadPendingFinancialOcrUploads() {
  try {
    const jobs = await getPendingContractFinancialOcrUploads(props.contractId);
    const knownJobIds = new Set(
      [
        ...allInvoiceCredentials.value,
        ...allBankCredentials.value,
        ...allExternalCredentials.value,
      ]
        .map((credential) => credential.result?.id)
        .filter((id): id is string => Boolean(id)),
    );
    jobs.forEach((job) => {
      if (knownJobIds.has(job.id)) return;
      credentialListFor(restoredCredentialKind(job)).push(
        restoredCredentialState(job),
      );
      knownJobIds.add(job.id);
    });
  } catch (error) {
    pageError.value = getContractErrorMessage(
      error,
      "恢复已识别的待登记凭证失败，请刷新后重试",
    );
  }
}

async function reloadPendingFinancialOcrUploads() {
  reset();
  await loadPendingFinancialOcrUploads();
}

function handleCredentialFile(kind: CredentialKind, uploadFile: UploadFile) {
  credentialQueues[kind] = credentialQueues[kind].then(() =>
    processCredentialFile(kind, uploadFile),
  );
}

async function processCredentialFile(
  kind: CredentialKind,
  uploadFile: UploadFile,
) {
  const file = uploadFile.raw;
  if (!file) return;
  if (
    (kind === "bank" || kind === "external") &&
    !invoiceContextReady.value &&
    !requiresExternalPayment.value
  ) {
    pageError.value = invoiceDirectionConflict.value
      ? "发票购销方向与合同类型不一致，不能上传银行凭证"
      : "请先上传并通过发票识别，再上传对应银行凭证";
    uploadRefFor(kind)?.clearFiles();
    return;
  }
  if (kind === "external" && !requiresExternalPayment.value) return;
  const state = stateFor(kind);
  const validationError = validateFile(file);
  if (validationError) {
    state.error = validationError;
    state.status = "error";
    state.file = null;
    uploadRefFor(kind)?.clearFiles();
    return;
  }

  if (state.file) {
    const stored = {
      ...state,
      key: createCredentialState().key,
      previewExpanded: false,
    };
    credentialListFor(kind).push(stored);
    Object.assign(state, createCredentialState());
  }

  state.sequence += 1;
  const sequence = state.sequence;
  releasePreview(state);
  state.file = file;
  // 文件卡由本组件自行维护；清空上传组件的内部列表，确保再次点击方框时
  // 可以直接替换当前凭证，而不会被单文件上限拦截。
  uploadRefFor(kind)?.clearFiles();
  state.previewUrl = URL.createObjectURL(file);
  state.result = null;
  state.error = "";
  state.status = "recognizing";
  pageError.value = "";

  try {
    const result = await recognizeContractFinancialFile(
      props.contractId,
      kind === "invoice"
        ? "invoice"
        : kind === "external"
          ? "payment"
          : bankOcrKind.value,
      file,
    );
    if (sequence !== state.sequence || state.file !== file) return;
    const invalidDocumentMessage = invalidFinancialDocumentMessage(
      result,
      kind,
    );
    if (invalidDocumentMessage) {
      await discardInvalidFinancialDocument(
        state,
        result,
        kind,
        invalidDocumentMessage,
      );
      return;
    }
    if (kind === "invoice") {
      const workspaceDuplicate = findInvoiceDuplicateInWorkspace(result);
      if (workspaceDuplicate) {
        await discardDuplicateInvoiceResult(
          state,
          result,
          `发票号码 ${workspaceDuplicate.invoiceNumber || "未识别"} 已添加，无需重复上传`,
          workspaceDuplicate.sameJob,
        );
        return;
      }
      const duplicateReason = result.blockingReasons.find((reason) =>
        INVOICE_DUPLICATE_CODES.has(reason.code),
      );
      if (duplicateReason) {
        await discardDuplicateInvoiceResult(
          state,
          result,
          duplicateReason.message || "该发票已上传或登记，请勿重复添加",
        );
        return;
      }
    } else {
      const bankKind = kind === "external" ? "external" : "bank";
      const workspaceDuplicate = findBankDuplicateInWorkspace(result, bankKind);
      if (workspaceDuplicate) {
        await discardDuplicateBankResult(
          state,
          result,
          bankKind,
          `电子回单号码 ${workspaceDuplicate.electronicReceiptNo || "未识别"} 已添加，无需重复上传`,
          workspaceDuplicate.sameJob,
        );
        return;
      }
      const duplicateReason = result.blockingReasons.find((reason) =>
        BANK_DUPLICATE_CODES.has(reason.code),
      );
      if (duplicateReason) {
        await discardDuplicateBankResult(
          state,
          result,
          bankKind,
          duplicateReason.message || "该电子回单号码已上传或登记，请勿重复添加",
        );
        return;
      }
    }
    state.result = result;
    if (result.canCreateDraft) {
      state.status = "verified";
      return;
    }
    state.status = "blocked";
    state.error = result.blockingReasons
      .map((reason) => reason.message)
      .join("；");
  } catch (error) {
    if (sequence !== state.sequence || state.file !== file) return;
    const errorCode = getContractErrorCode(error);
    if (
      errorCode != null &&
      ((kind === "invoice" && INVOICE_DUPLICATE_CODES.has(errorCode)) ||
        (kind !== "invoice" && BANK_DUPLICATE_CODES.has(errorCode)))
    ) {
      const message = getContractErrorMessage(
        error,
        `${file.name} 已上传或登记，无需重复添加`,
      );
      removeCredential(kind);
      ElMessage.warning(message);
      return;
    }
    if (errorCode === "FINANCIAL_OCR_IN_PROGRESS") {
      removeCredential(kind);
      ElMessage.warning(`${file.name} 正在识别，请等待当前任务完成`);
      return;
    }
    state.status = "error";
    state.error = getContractErrorMessage(
      error,
      `${
        kind === "invoice"
          ? "发票"
          : kind === "external"
            ? "科技公司对外付款"
            : bankDocumentLabel.value
      }识别失败，请重试`,
    );
  }
}

function openCredentialPreview(state: CredentialState) {
  if (!state.previewUrl) return;
  window.open(state.previewUrl, "_blank", "noopener,noreferrer");
}

function removeCredential(kind: CredentialKind) {
  const state = stateFor(kind);
  state.sequence += 1;
  releasePreview(state);
  state.file = null;
  state.result = null;
  state.error = "";
  state.status = "idle";
  uploadRefFor(kind)?.clearFiles();
}

function removeStoredCredential(kind: CredentialKind, key: string) {
  const list = credentialListFor(kind);
  const index = list.findIndex((item) => item.key === key);
  if (index < 0) return;
  releasePreview(list[index]);
  list.splice(index, 1);
}

function isRemovingCredential(key: string): boolean {
  return removingCredentialKeys.value.includes(key);
}

function credentialByKey(
  kind: CredentialKind,
  key: string,
): CredentialState | undefined {
  const current = stateFor(kind);
  if (current.key === key) return current;
  return credentialListFor(kind).find((item) => item.key === key);
}

async function removeCredentialByKey(
  kind: CredentialKind,
  key: string,
): Promise<boolean> {
  const target = credentialByKey(kind, key);
  if (!target || target.status === "recognizing" || submitting.value) {
    return false;
  }
  if (target.result?.id) {
    removingCredentialKeys.value = [
      ...removingCredentialKeys.value,
      ...(isRemovingCredential(key) ? [] : [key]),
    ];
    try {
      await deleteContractFinancialOcrUpload(
        props.contractId,
        target.result.id,
      );
    } catch (error) {
      pageError.value = getContractErrorMessage(
        error,
        "移除财务凭证失败，请稍后重试",
      );
      return false;
    } finally {
      removingCredentialKeys.value = removingCredentialKeys.value.filter(
        (item) => item !== key,
      );
    }
  }
  const current = stateFor(kind);
  if (current.key === key) {
    removeCredential(kind);
    return true;
  }
  removeStoredCredential(kind, key);
  return true;
}

function reset() {
  removeCredential("invoice");
  removeCredential("bank");
  removeCredential("external");
  invoiceCredentials.splice(0).forEach(releasePreview);
  bankCredentials.splice(0).forEach(releasePreview);
  externalCredentials.splice(0).forEach(releasePreview);
  note.value = "";
  pageError.value = "";
}

async function clearWorkspace() {
  if (clearing.value || submitting.value || anyRecognizing.value) return;
  clearing.value = true;
  pageError.value = "";
  try {
    const credentials = [
      ...allInvoiceCredentials.value.map((item) => ({
        kind: "invoice" as const,
        key: item.key,
      })),
      ...allBankCredentials.value.map((item) => ({
        kind: "bank" as const,
        key: item.key,
      })),
      ...allExternalCredentials.value.map((item) => ({
        kind: "external" as const,
        key: item.key,
      })),
    ];
    for (const credential of credentials) {
      const removed = await removeCredentialByKey(
        credential.kind,
        credential.key,
      );
      if (!removed) return;
    }
    note.value = "";
    pageError.value = "";
    if (props.registrationId) emit("cancelContinuation");
  } finally {
    clearing.value = false;
  }
}

async function submitRegistration() {
  if (!canSubmit.value) {
    pageError.value = completionHint.value;
    return;
  }
  const invoiceJobIds = allInvoiceCredentials.value.map(
    (item) => item.result!.id,
  );
  const invoiceKeys = allInvoiceCredentials.value
    .map((item) => invoiceFieldsFor(item))
    .map((fields) => invoiceBusinessKey(fields?.seller, fields?.invoiceNumber))
    .filter(Boolean);
  if (
    new Set(invoiceJobIds).size !== invoiceJobIds.length ||
    new Set(invoiceKeys).size !== invoiceKeys.length
  ) {
    pageError.value = "本次登记包含重复发票，请移除重复项后再保存";
    return;
  }
  submitting.value = true;
  pageError.value = "";
  try {
    const savedAsPartial = partialSettlement.value;
    const remainingAmount = remainingSettlementAmount.value;
    const payload = {
      invoiceOcrJobIds: invoiceJobIds,
      bankOcrJobIds: allBankCredentials.value.map((item) => item.result!.id),
      note: note.value.trim() || undefined,
    };
    const externalPayload = {
      bankOcrJobIds: allExternalCredentials.value.map(
        (item) => item.result!.id,
      ),
      note: note.value.trim() || undefined,
    };
    if (canSaveExternalPaymentOnly.value) {
      await createContractExternalPaymentRegistration(
        props.contractId,
        externalPayload,
      );
      ElMessage.success(
        "科技公司最终对外付款已保存，合同付款进度已更新；发票核算明细可后续补充",
      );
      reset();
      emit("created");
      return;
    }
    let targetRegistrationId = props.registrationId || "";
    if (props.registrationId) {
      if (
        allBankCredentials.value.length ||
        allInvoiceCredentials.value.length
      ) {
        await appendContractFinancialRegistrationSettlements(
          props.contractId,
          props.registrationId,
          payload,
        );
      }
      if (allExternalCredentials.value.length) {
        await appendContractFinancialRegistrationExternalPayments(
          props.contractId,
          props.registrationId,
          externalPayload,
        );
      }
      ElMessage.success(
        allInvoiceCredentials.value.length > 0 &&
          !allBankCredentials.value.length &&
          !allExternalCredentials.value.length
          ? "发票已补充，合同核算明细和待补差额已更新"
          : allExternalCredentials.value.length &&
              !allBankCredentials.value.length
            ? "科技公司最终对外付款已保存，已进入合同核算与履约核销"
            : savedAsPartial
              ? `本次${bankDocumentLabel.value}已保存并立即计入${postedSettlementLabel.value}，尚待${settlementActionLabel.value} ${formatRecognizedMoney(remainingAmount)}`
              : `本次${bankDocumentLabel.value}已保存并立即计入${postedSettlementLabel.value}，发票与银行凭证金额已全部对应`,
      );
    } else {
      const created = await createContractFinancialRegistration(
        props.contractId,
        {
          ...payload,
        },
      );
      targetRegistrationId = created.registrationId;
      if (allExternalCredentials.value.length) {
        await appendContractFinancialRegistrationExternalPayments(
          props.contractId,
          targetRegistrationId,
          externalPayload,
        );
      }
      ElMessage.success(
        requiresExternalPayment.value && allExternalCredentials.value.length
          ? savedAsPartial
            ? `发票和部分${externalPaymentLabel.value}已保存，已进入合同核算，尚待 ${formatRecognizedMoney(remainingAmount)}`
            : `发票和${externalPaymentLabel.value}已保存，已进入合同核算；工程咨询划拨回单可按实际发生情况另行补充统计`
          : savedAsPartial
            ? `部分${settlementActionLabel.value}已保存并立即计入${postedSettlementLabel.value}，尚待${settlementActionLabel.value} ${formatRecognizedMoney(remainingAmount)}`
            : allBankCredentials.value.length
              ? `发票和${bankDocumentLabel.value}已保存，${bankDocumentLabel.value}已立即计入${postedSettlementLabel.value}；请确认整笔配对`
              : `发票已保存为待${settlementActionLabel.value}草稿，收到${bankDocumentLabel.value}后可继续补充`,
      );
    }
    reset();
    emit("created");
  } catch (error) {
    const errorCode = getContractErrorCode(error);
    pageError.value =
      errorCode != null &&
      (INVOICE_DUPLICATE_CODES.has(errorCode) ||
        BANK_DUPLICATE_CODES.has(errorCode))
        ? getContractErrorMessage(error, "凭证已上传或登记，请移除重复项")
        : getContractErrorMessage(
            error,
            "财务登记保存失败，本次凭证均未登记，请检查后重试",
          );
  } finally {
    submitting.value = false;
  }
}

function focus() {
  panelRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  panelRef.value?.focus({ preventScroll: true });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRecognizedMoney(value: number | null): string {
  if (value === null || !Number.isFinite(Number(value))) return "—";
  return `¥${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function invoiceAmount(state: CredentialState): number {
  const fields = state.result?.snapshot.fields;
  return fields && "invoiceNumber" in fields ? Number(fields.amount || 0) : 0;
}

function invoiceFieldsFor(
  state: CredentialState,
): ContractFinancialInvoiceFields | null {
  const fields = state.result?.snapshot.fields;
  return fields && "invoiceNumber" in fields
    ? (fields as ContractFinancialInvoiceFields)
    : null;
}

function bankAmount(state: CredentialState): number {
  const fields = state.result?.snapshot.fields;
  return fields && "paymentTime" in fields ? Number(fields.amount || 0) : 0;
}

function bankFieldsFor(
  state: CredentialState,
): ContractFinancialBankFields | null {
  const fields = state.result?.snapshot.fields;
  return fields && "paymentTime" in fields
    ? (fields as ContractFinancialBankFields)
    : null;
}

function formatPaymentDate(value: string | null | undefined): string {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "—";
}

defineExpose({
  focus,
  reset,
  reloadPendingUploads: reloadPendingFinancialOcrUploads,
});

onMounted(loadPendingFinancialOcrUploads);

onBeforeUnmount(() => {
  releasePreview(invoiceCredential);
  releasePreview(bankCredential);
  releasePreview(externalCredential);
  invoiceCredentials.forEach(releasePreview);
  bankCredentials.forEach(releasePreview);
  externalCredentials.forEach(releasePreview);
});
</script>

<style scoped>
.financial-registration-panel {
  scroll-margin-top: 84px;
  padding: 20px;
  border: 1px solid #dce9e8;
  border-radius: 14px;
  background:
    linear-gradient(135deg, rgb(236 248 246 / 80%), transparent 38%), #fff;
  box-shadow: 0 10px 30px rgb(31 73 76 / 6%);
}
.financial-registration-panel:focus-visible {
  outline: 2px solid #3b9b98;
  outline-offset: 3px;
}
.registration-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}
.registration-kicker {
  color: #248b86;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.registration-heading h2 {
  margin: 3px 0 5px;
  color: #24475b;
  font-size: 20px;
}
.registration-heading p {
  margin: 0;
  color: #7a8c98;
  font-size: 13px;
}
.registration-page-error {
  margin-bottom: 14px;
}
.credential-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: flex-start;
  gap: 14px;
  overflow-x: hidden;
  padding-bottom: 2px;
}
.credential-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid #e0e8ec;
  border-radius: 12px;
  background: #fbfcfd;
}
.invoice-card {
  grid-column: 1;
  grid-row: 1;
}
.internal-invoice-card {
  grid-column: 1 / -1;
  grid-row: 2;
}
.external-card {
  grid-column: 2;
  grid-row: 1;
}
.funding-bank-card {
  grid-column: 1;
  grid-row: 1;
}
.credential-table-wrap {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid #dce9e8;
  border-radius: 10px;
  background: #fff;
}
.credential-table {
  width: 100%;
  font-size: 12px;
}
.credential-table :deep(th.el-table__cell),
.credential-table :deep(td.el-table__cell) {
  text-align: center;
  vertical-align: middle;
}
.credential-table :deep(.cell) {
  overflow: visible;
  padding: 0 2px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
  word-break: break-word;
}
.credential-table :deep(td.invoice-number-column .cell) {
  font-variant-numeric: tabular-nums;
}
.credential-table :deep(td.invoice-item-name-column .cell) {
  overflow-wrap: anywhere;
  white-space: normal;
  word-break: break-word;
}
.credential-table :deep(.el-scrollbar__bar.is-horizontal) {
  display: none !important;
}
.credential-table :deep(.el-table__cell) {
  padding: 11px 0;
}
.table-total {
  position: sticky;
  right: 0;
  display: flex;
  min-width: max-content;
  justify-content: flex-end;
  gap: 8px;
  padding: 11px 16px;
  border-top: 1px solid #dce9e8;
  background: #f3fbfa;
  color: #58717f;
  font-size: 13px;
}
.table-total strong {
  color: #0f807a;
  font-size: 15px;
}
.thumbnail-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.thumbnail-button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 1px solid #a9d5d1;
  border-radius: 6px;
  background: #e9f7f5;
  color: #16827c;
  font-size: 17px;
}
.thumbnail-remove-button {
  display: inline-flex;
  width: 30px;
  height: 30px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: #fff1f1;
  color: #e25b5b;
  font-size: 16px;
}
.thumbnail-remove-button:hover,
.thumbnail-remove-button:focus-visible {
  outline: 2px solid rgb(226 91 91 / 18%);
  outline-offset: 1px;
}
.thumbnail-remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.thumbnail-button:hover,
.thumbnail-button:focus-visible {
  border-color: #278e88;
  outline: 2px solid rgb(39 142 136 / 18%);
  outline-offset: 2px;
}
.thumbnail-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.registration-totals {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid #cfe7e4;
  border-radius: 10px;
  background: #f3fbfa;
  color: #516b78;
}
.registration-totals.mismatch {
  border-color: #f3c7c7;
  background: #fff6f6;
}
.registration-totals.partial {
  border-color: #f0d59b;
  background: #fffaf0;
}
.registration-totals strong {
  color: #117d78;
}
.credential-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.credential-index {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: #e5f4f2;
  color: #238681;
  font-size: 12px;
  font-weight: 750;
}
.credential-heading h3 {
  margin: 0 0 2px;
  color: #294b60;
  font-size: 16px;
}
.credential-heading p {
  margin: 0;
  color: #8a98a3;
  font-size: 11px;
}
.credential-uploader {
  width: 100%;
}
.credential-uploader :deep(.el-upload),
.credential-uploader :deep(.el-upload-dragger) {
  width: 100%;
}
.credential-uploader :deep(.el-upload-dragger) {
  min-height: 156px;
  padding: 18px;
  border-color: #bdd8d6;
  background: #f8fcfb;
}
.credential-uploader :deep(.el-upload-dragger:hover) {
  border-color: #3a9a96;
  background: #f1faf8;
}
.empty-upload,
.selected-file {
  min-height: 118px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.empty-upload strong,
.selected-file strong {
  max-width: 100%;
  overflow: hidden;
  color: #38586a;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-upload small,
.selected-file small {
  max-width: 390px;
  color: #95a1aa;
  font-size: 11px;
  line-height: 1.55;
}
.upload-icon {
  color: #69aaa7;
  font-size: 38px;
}
.selected-file-icon {
  display: inline-flex;
  width: 50px;
  height: 50px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #dff1ef;
  color: #218681;
  cursor: pointer;
  font-size: 24px;
}
.selected-file-icon:hover,
.selected-file-icon:focus-visible {
  outline: 2px solid rgb(33 134 129 / 24%);
  outline-offset: 3px;
}
.continue-upload-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  padding: 6px 12px;
  border: 1px solid #9dcfca;
  border-radius: 999px;
  background: #fff;
  color: #168079;
  font-size: 12px;
  font-weight: 650;
}
.recognizing-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  padding: 11px;
  border-radius: 8px;
  background: #eef7f6;
  color: #4b7d7b;
  font-size: 12px;
}
.credential-error {
  margin-top: 10px;
}
.continuation-alert {
  margin-bottom: 8px;
}
.continuation-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.registered-credential-uploader {
  min-height: 156px;
  padding: 18px;
  border: 1px dashed #bdd8d6;
  border-radius: 8px;
  background: #f8fcfb;
}
.registered-file-icon {
  border: 0;
  cursor: pointer;
}
.registered-file-icon:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.credential-guidance {
  margin-top: 12px;
}
.credential-guidance p {
  margin: 0;
  line-height: 1.7;
}
.credential-guidance-action {
  margin-top: 4px !important;
}
.credential-guidance details {
  margin-top: 7px;
  color: #7c8992;
  font-size: 12px;
}
.credential-guidance summary {
  width: max-content;
  cursor: pointer;
}
.credential-guidance ul {
  margin: 5px 0 0;
  padding-left: 18px;
}
.recognized-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.recognized-fields > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid #e7edef;
  border-radius: 8px;
  background: #fff;
}
.recognized-fields span {
  color: #8a98a3;
  font-size: 11px;
}
.recognized-fields strong {
  overflow-wrap: anywhere;
  color: #33566a;
  font-size: 13px;
}
.recognized-fields .field-emphasis {
  border-color: #b7ded8;
  background: #eff9f7;
}
.recognized-fields .field-emphasis strong {
  color: #168079;
  font-size: 16px;
}
.allocation-preview {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #d9e9e7;
  border-radius: 10px;
  background: #f4faf9;
}
.allocation-preview h3 {
  margin: 0 0 9px;
  color: #31536a;
  font-size: 14px;
}
.allocation-preview-header,
.allocation-preview-row {
  display: grid;
  grid-template-columns: 50px minmax(180px, 1fr) 56px minmax(180px, 1fr) 120px;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.allocation-preview-header {
  padding: 7px 8px;
  color: #82909a;
  font-size: 11px;
}
.allocation-preview-row {
  padding: 9px 8px;
  border-top: 1px solid #e1eceb;
  color: #536978;
  font-size: 12px;
}
.allocation-preview-row > strong {
  color: #0b7d78;
  white-space: nowrap;
}
.registration-form {
  margin-top: 14px;
  padding: 14px 16px 2px;
  border: 1px solid #e2eaed;
  border-radius: 11px;
  background: #fafcfd;
}
.registration-form-grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.55fr) minmax(0, 1.45fr);
  gap: 14px;
}
.registration-form-grid.single-field {
  grid-template-columns: 1fr;
}
.registration-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
}
.registration-actions > div:last-child {
  display: flex;
  gap: 8px;
}
.completion-hint {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: #82909a;
  font-size: 12px;
}
.completion-hint .complete {
  color: #2a9a72;
}

@media (max-width: 768px) {
  .financial-registration-panel {
    padding: 14px;
  }
  .registration-heading,
  .registration-actions,
  .registration-totals {
    align-items: stretch;
    flex-direction: column;
  }
  .registration-heading :deep(.el-tag) {
    align-self: flex-start;
  }
  .credential-card {
    padding: 12px;
  }
  .credential-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .credential-heading :deep(.el-tag) {
    grid-column: 2;
    justify-self: flex-start;
  }
  .registration-form-grid {
    grid-template-columns: 1fr;
  }
  .registration-actions > div:last-child {
    width: 100%;
  }
  .registration-actions :deep(.el-button) {
    flex: 1;
    margin-left: 0;
  }
  .allocation-preview-header {
    display: none;
  }
  .allocation-preview-row {
    grid-template-columns: 28px minmax(0, 1fr);
    text-align: left;
  }
  .allocation-preview-row > :nth-child(n + 3) {
    grid-column: 2;
  }
}
</style>
