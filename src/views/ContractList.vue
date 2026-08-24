<template>
  <div class="contract-page contract-list-page">
    <header class="contract-hero">
      <div class="hero-copy">
        <span class="hero-kicker"><i></i>合同全生命周期管理</span>
        <h1>合同管理</h1>
        <p>
          统一管理合同识别、审批、归档与收付款，关键金额以服务端核算结果为准。
        </p>
      </div>
      <div class="hero-actions">
        <el-button
          v-if="!isEmployee"
          :icon="DataAnalysis"
          @click="router.push('/contract-dashboard')"
        >
          合同分析
        </el-button>
        <el-button
          v-if="canExportContracts"
          :icon="Download"
          :loading="exporting"
          @click="exportContracts"
        >
          导出台账
        </el-button>
        <el-button
          v-if="isEmployee"
          @click="router.push('/contract-applications/mine')"
        >
          我的申请
        </el-button>
        <el-button
          v-if="canCreate"
          type="primary"
          :icon="Plus"
          @click="router.push('/contracts/create')"
        >
          新增合同
        </el-button>
      </div>
    </header>

    <section class="metric-grid" aria-label="合同核心指标">
      <ContractMetricCard
        label="有效收入合同额"
        :value="formatContractMoney(summary.effectiveIncomeContractAmount)"
        :note="`共 ${summary.effectiveIncomeContractCount || 0} 个主营或非主营有效合同组，不含待签合同`"
        :icon="TrendCharts"
        tone="navy"
      />
      <ContractMetricCard
        label="有效支出合同额"
        :value="formatContractMoney(summary.effectiveExpenseContractAmount)"
        :note="`共 ${summary.effectiveExpenseContractCount || 0} 个资产类有效合同组，不含待签合同`"
        :icon="Money"
        tone="red"
      />
      <ContractMetricCard
        label="待签合同金额"
        :value="formatContractMoney(summary.pendingSignatureAmount)"
        :note="`共 ${summary.pendingSignatureContractCount || 0} 个待签合同组，含草稿、初始审批中和待盖章`"
        :icon="Wallet"
        tone="amber"
      />
      <ContractMetricCard
        label="本月收入"
        :value="formatContractMoney(summary.monthIncome)"
        note="已上传有效回单口径"
        :icon="TrendCharts"
        tone="cyan"
      />
      <ContractMetricCard
        label="未回款金额"
        :value="formatContractMoney(summary.unreceivedAmount)"
        note="按服务端实时核算"
        :icon="WarningFilled"
        tone="amber"
      />
      <ContractMetricCard
        label="待审批合同"
        :value="summary.pendingApprovalCount || 0"
        note="全部合同业务审批统一由总经理处理"
        :icon="Stamp"
        tone="violet"
        :clickable="canOpenApprovalCenter"
        @activate="router.push('/contract-approvals')"
      />
      <ContractMetricCard
        label="待盖章归档"
        :value="summary.pendingSealCount || 0"
        note="审批通过后等待盖章"
        :icon="DocumentChecked"
        tone="green"
      />
    </section>

    <section class="filter-panel" aria-label="合同筛选">
      <div class="filter-row">
        <el-input
          v-model="filters.keyword"
          class="keyword-input"
          clearable
          :prefix-icon="Search"
          placeholder="合同名称、编号、项目"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-input
          v-model="filters.counterparty"
          clearable
          placeholder="对方单位"
          aria-label="筛选合同对方单位"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="filters.categories"
          multiple
          collapse-tags
          collapse-tags-tooltip
          clearable
          placeholder="合同分类（多选）"
          @change="handleFilterChange"
        >
          <el-option
            v-for="(label, value) in CONTRACT_CATEGORY_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          v-model="filters.statuses"
          multiple
          collapse-tags
          collapse-tags-tooltip
          clearable
          placeholder="合同状态（多选）"
          @change="handleFilterChange"
        >
          <el-option
            v-for="(label, value) in CONTRACT_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          v-model="filters.settlementStatus"
          clearable
          placeholder="结算状态"
          aria-label="筛选合同结算状态"
          @change="handleFilterChange"
        >
          <el-option
            v-for="(label, value) in CONTRACT_SETTLEMENT_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          v-model="filters.projectId"
          clearable
          filterable
          placeholder="关联项目"
          @change="handleFilterChange"
        >
          <el-option
            v-for="project in meta.projects"
            :key="project.id"
            :label="project.name"
            :value="project.id"
          />
        </el-select>
        <el-select
          v-model="filters.area"
          clearable
          placeholder="区域"
          @change="handleFilterChange"
        >
          <el-option label="全部" value="" />
          <el-option
            v-for="area in meta.areas.filter((item) => item !== '全部')"
            :key="area"
            :label="area"
            :value="area"
          />
        </el-select>
        <div class="date-filter" aria-label="合同日期范围">
          <el-date-picker
            v-model="contractDatePickerValue"
            :type="contractDatePickerType"
            :format="contractDatePickerFormat"
            :value-format="contractDatePickerValueFormat"
            clearable
            range-separator="至"
            :start-placeholder="contractDatePickerStartPlaceholder"
            :end-placeholder="contractDatePickerEndPlaceholder"
            aria-label="合同日期范围选择"
            :shortcuts="contractDatePanelShortcuts"
            popper-class="contract-ledger-date-range-popper"
            @change="handleFilterChange"
          />
        </div>
        <div class="filter-actions">
          <el-button
            type="primary"
            :icon="Search"
            :loading="loading"
            @click="handleSearch"
          >
            查询
          </el-button>
          <el-button :icon="Refresh" @click="resetFilters">重置</el-button>
        </div>
      </div>
    </section>

    <el-alert
      v-if="canCreate && Number(summary.leaseExpiringCount || 0) > 0"
      class="lease-expiry-alert"
      type="error"
      show-icon
      :closable="false"
      :title="`租赁合同到期提醒：${summary.leaseExpiringCount} 份合同已到期或将在 1 个月内到期`"
      description="相关合同已自动置顶并标红，请管理员及时办理续签、退租／还车或终止手续。"
    />

    <el-alert
      v-if="errorMessage"
      type="error"
      :closable="false"
      show-icon
      title="合同台账加载失败"
      :description="errorMessage"
    >
      <template #default>
        <el-button type="danger" link @click="loadContracts"
          >重新加载</el-button
        >
      </template>
    </el-alert>

    <section v-loading="loading" class="ledger-card" :aria-busy="loading">
      <div class="ledger-heading">
        <div>
          <strong>合同台账</strong>
          <span>共 {{ total }} 组主合同链</span>
        </div>
        <div class="ledger-heading-actions">
          <el-button
            v-if="canCreate"
            @click="router.push('/contracts/cancelled')"
          >
            已撤销合同
          </el-button>
          <el-button
            :icon="Refresh"
            circle
            aria-label="刷新合同台账"
            @click="loadContracts"
          />
        </div>
      </div>

      <el-table
        v-if="items.length || loading"
        class="contract-table desktop-only"
        :data="ledgerItems"
        stripe
        row-key="id"
        :tree-props="{ children: 'children' }"
        :row-class-name="contractRowClassName"
        @row-dblclick="openDetail"
      >
        <el-table-column
          label="序号"
          width="72"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            {{ ledgerSequence(row) }}
          </template>
        </el-table-column>
        <el-table-column
          label="合同信息"
          min-width="360"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <div class="contract-name-cell">
              <strong :title="contractDisplayName(row)">
                {{ contractDisplayName(row) }}
              </strong>
              <span class="contract-name-meta">
                <span
                  v-if="shouldShowRelationBadge(row)"
                  class="relation-badge"
                >
                  {{ contractRelationLabel(row) }}
                </span>
                <span
                  v-if="row.relationType === 'main' && row.children?.length"
                  class="child-count-badge"
                >
                  {{ row.children.length }} 份关联协议
                </span>
                <span class="contract-number">{{
                  contractNumberText(row)
                }}</span>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="分类"
          width="140"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <div class="category-direction-cell">
              <span>{{ contractCategoryLabel(row.category) }}</span>
              <small
                class="direction-badge"
                :class="contractDirectionClass(row)"
              >
                {{ contractDirectionLabel(row) }}
              </small>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          prop="projectName"
          label="项目名称"
          min-width="180"
          align="center"
          header-align="center"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ row.category === "asset" ? "—" : row.projectName }}
          </template>
        </el-table-column>
        <el-table-column
          label="行政区域"
          width="110"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{ row.area || "—" }}</template>
        </el-table-column>
        <el-table-column
          label="合同日期"
          width="120"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{
            formatContractDate(row.contractDate)
          }}</template>
        </el-table-column>
        <el-table-column
          label="租赁期限"
          width="210"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <span v-if="row.leaseStartDate || row.leaseEndDate">
              {{ formatContractDate(row.leaseStartDate) }} 至
              {{ formatContractDate(row.leaseEndDate) }}
            </span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column
          label="合同截至日期"
          width="130"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            {{ formatContractDate(displayedContractCutoffDate(row)) }}
          </template>
        </el-table-column>
        <el-table-column
          label="合同金额"
          width="205"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <div
              v-if="
                row.relationType === 'supplement' &&
                hasSupplementAmountChain(row)
              "
              class="supplement-amount-chain"
            >
              <span
                v-if="row.supplementChangeType === 'payment_terms_only'"
                class="payment-terms-badge"
                >仅变更付款方式</span
              >
              <small
                >原始
                {{
                  formatContractMoney(row.originalContractAmount, "—")
                }}</small
              >
              <small
                >生效前
                {{ formatContractMoney(row.amountBeforeChange, "—") }}</small
              >
              <span
                >本次增减
                {{ formatContractMoney(supplementAmountDelta(row)) }}</span
              >
              <strong
                >生效后
                {{ formatContractMoney(row.amountAfterChange, "—") }}</strong
              >
              <small
                >当前有效
                {{
                  formatContractMoney(row.currentEffectiveAmount, "—")
                }}</small
              >
            </div>
            <div
              v-else-if="hasProjectedAmountChange(row)"
              class="ledger-amount-change"
            >
              <small>变更前 {{ formatContractMoney(row.currentAmount) }}</small>
              <strong
                >变更后 {{ formatContractMoney(row.projectedAmount) }}</strong
              >
              <span>{{ row.pendingSupplementCount }} 份补充协议待生效</span>
            </div>
            <strong
              v-else
              class="money-cell"
              :class="contractDirectionClass(row)"
              >{{ formatContractMoney(displayContractAmount(row)) }}</strong
            >
          </template>
        </el-table-column>
        <el-table-column
          label="已收"
          width="125"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <span
              v-if="row.category !== 'asset'"
              class="money-cell is-income"
              >{{ formatContractMoney(row.receivedAmount) }}</span
            >
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column
          label="已付"
          width="125"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <span
              v-if="row.category === 'asset'"
              class="money-cell is-expense"
              >{{ formatContractMoney(row.paidAmount) }}</span
            >
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column
          label="执行进度"
          width="150"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress
                :percentage="
                  clampPercent(normalizeProgress(row.completionRate))
                "
                :stroke-width="7"
                :show-text="false"
              />
              <span>{{ normalizeProgress(row.completionRate) }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          width="110"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <ContractStatusTag :status="row.status" size="small" />
          </template>
        </el-table-column>
        <el-table-column
          label="责任人"
          width="110"
          align="center"
          header-align="center"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ row.ownerName || "—" }}</template>
        </el-table-column>
        <el-table-column
          label="更新时间"
          width="120"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">{{
            formatContractDate(row.updatedAt)
          }}</template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="330"
          fixed="right"
          align="center"
          header-align="center"
        >
          <template #default="{ row }">
            <div class="row-actions">
              <el-button type="primary" link @click.stop="openDetail(row)"
                >详情</el-button
              >
              <el-button
                v-if="isEmployee"
                type="success"
                link
                @click.stop="openDownloadRequest(row)"
                >申请下载</el-button
              >
              <el-button
                v-if="canApplyInvoice(row)"
                type="primary"
                link
                @click.stop="openInvoiceApplication(row)"
                >开票申请</el-button
              >
              <el-button
                v-if="canCreate && row.requiresAuxiliaryMaterials"
                type="primary"
                link
                @click.stop="openAuxiliaryMaterials(row)"
                >添加辅助材料</el-button
              >
              <el-button
                v-if="canManageRentalLifecycle(row)"
                type="success"
                link
                @click.stop="openRentalRenewal(row)"
                >续签</el-button
              >
              <el-button
                v-if="canUploadSupplement(row)"
                type="warning"
                link
                @click.stop="openSupplementUpload(row)"
                >上传补充协议</el-button
              >
              <el-button
                v-if="canCreate && row.status === 'draft'"
                type="primary"
                link
                @click.stop="continueEditing(row)"
                >继续编辑</el-button
              >
              <el-button
                v-if="canCreate && row.status === 'pending_seal'"
                type="primary"
                link
                @click.stop="openSealArchive(row)"
                >盖章</el-button
              >
              <el-button
                v-if="
                  canCreate &&
                  row.relationType === 'main' &&
                  ['effective', 'executing'].includes(row.status)
                "
                type="success"
                link
                @click.stop="openFinancialRegistration(row)"
                >财务登记</el-button
              >
              <el-button
                v-if="canCancelContract(row)"
                type="danger"
                link
                :loading="cancellingContractId === row.id"
                @click.stop="cancelContract(row)"
                >撤销此合同</el-button
              >
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="items.length" class="mobile-contract-list mobile-only">
        <article
          v-for="item in visibleMobileItems"
          :key="item.id"
          class="mobile-contract-card"
          :class="{
            'is-lease-expiring': item.leaseExpiringSoon,
            'is-related-contract': item.relationType !== 'main',
          }"
        >
          <button
            type="button"
            class="mobile-card-main"
            @click="openDetail(item)"
          >
            <span class="mobile-card-top">
              <strong>{{ contractDisplayName(item) }}</strong>
              <ContractStatusTag :status="item.status" size="small" />
            </span>
            <span
              v-if="item.relationType !== 'main'"
              class="mobile-relation-label"
            >
              挂接于上方主合同
            </span>
            <span class="mobile-category-line">
              <span>
                {{ contractCategoryLabel(item.category)
                }}<template v-if="item.category !== 'asset'">
                  · {{ item.projectName }}</template
                >
              </span>
              <small
                class="direction-badge"
                :class="contractDirectionClass(item)"
                >{{ contractDirectionLabel(item) }}</small
              >
            </span>
            <span>行政区域 {{ item.area || "—" }}</span>
            <span
              >合同日期 {{ formatContractDate(item.contractDate) }} · 责任人
              {{ item.ownerName || "—" }}</span
            >
            <span v-if="item.leaseStartDate || item.leaseEndDate">
              租赁期限 {{ formatContractDate(item.leaseStartDate) }} 至
              {{ formatContractDate(item.leaseEndDate) }}
            </span>
            <span>
              合同截至日期
              {{ formatContractDate(displayedContractCutoffDate(item)) }}
            </span>
            <span
              v-if="
                item.relationType === 'supplement' &&
                hasSupplementAmountChain(item)
              "
              class="mobile-supplement-amount-chain"
            >
              <small
                v-if="item.supplementChangeType === 'payment_terms_only'"
                class="payment-terms-badge"
                >仅变更付款方式</small
              >
              <small
                >原始
                {{
                  formatContractMoney(item.originalContractAmount, "—")
                }}</small
              >
              <small
                >生效前
                {{ formatContractMoney(item.amountBeforeChange, "—") }}</small
              >
              <span
                >本次增减
                {{ formatContractMoney(supplementAmountDelta(item)) }}</span
              >
              <b
                >生效后
                {{ formatContractMoney(item.amountAfterChange, "—") }}</b
              >
              <small
                >当前有效
                {{
                  formatContractMoney(item.currentEffectiveAmount, "—")
                }}</small
              >
            </span>
            <span
              v-else-if="hasProjectedAmountChange(item)"
              class="mobile-amount-change"
            >
              变更前 {{ formatContractMoney(item.currentAmount) }}
              <b>变更后 {{ formatContractMoney(item.projectedAmount) }}</b>
              <small>{{ item.pendingSupplementCount }} 份补充协议待生效</small>
            </span>
            <b
              v-else
              class="mobile-contract-amount"
              :class="contractDirectionClass(item)"
              >{{ formatContractMoney(displayContractAmount(item)) }}</b
            >
            <span>
              {{ item.category === "asset" ? "已付" : "已收" }}
              {{
                formatContractMoney(
                  item.category === "asset"
                    ? item.paidAmount
                    : item.receivedAmount,
                )
              }}
            </span>
          </button>
          <div class="mobile-card-actions">
            <el-button
              v-if="item.relationType === 'main' && item.children?.length"
              type="warning"
              link
              @click="toggleMobileContractGroup(item.id)"
            >
              {{
                expandedMobileRootIds.has(item.id)
                  ? "收起关联协议"
                  : `展开 ${item.children.length} 份关联协议`
              }}
            </el-button>
            <el-button type="primary" link @click="openDetail(item)"
              >详情</el-button
            >
            <el-button
              v-if="isEmployee"
              type="success"
              link
              @click="openDownloadRequest(item)"
              >申请下载</el-button
            >
            <el-button
              v-if="canApplyInvoice(item)"
              type="primary"
              link
              @click="openInvoiceApplication(item)"
              >开票申请</el-button
            >
            <el-button
              v-if="canCreate && item.requiresAuxiliaryMaterials"
              type="primary"
              link
              @click="openAuxiliaryMaterials(item)"
              >添加辅助材料</el-button
            >
            <el-button
              v-if="canManageRentalLifecycle(item)"
              type="success"
              link
              @click="openRentalRenewal(item)"
              >续签</el-button
            >
            <el-button
              v-if="canUploadSupplement(item)"
              type="warning"
              link
              @click="openSupplementUpload(item)"
              >上传补充协议</el-button
            >
            <el-button
              v-if="canCreate && item.status === 'draft'"
              type="primary"
              link
              @click="continueEditing(item)"
              >继续编辑</el-button
            >
            <el-button
              v-if="canCreate && item.status === 'pending_seal'"
              type="primary"
              link
              @click="openSealArchive(item)"
              >盖章</el-button
            >
            <el-button
              v-if="
                canCreate &&
                item.relationType === 'main' &&
                ['effective', 'executing'].includes(item.status)
              "
              type="success"
              link
              @click="openFinancialRegistration(item)"
              >财务登记</el-button
            >
            <el-button
              v-if="canCancelContract(item)"
              type="danger"
              link
              :loading="cancellingContractId === item.id"
              @click="cancelContract(item)"
              >撤销此合同</el-button
            >
          </div>
        </article>
      </div>

      <el-empty
        v-if="!loading && !items.length && !errorMessage"
        description="暂无符合条件的合同"
        :image-size="96"
      >
        <el-button
          v-if="canCreate"
          type="primary"
          @click="router.push('/contracts/create')"
        >
          新增第一份合同
        </el-button>
      </el-empty>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        class="ledger-pagination"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @current-change="handlePageChange"
        @size-change="handlePageSizeChange"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DataAnalysis,
  DocumentChecked,
  Download,
  Money,
  Plus,
  Refresh,
  Search,
  Stamp,
  TrendCharts,
  Wallet,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ContractMetricCard from "@/components/contracts/ContractMetricCard.vue";
import ContractStatusTag from "@/components/contracts/ContractStatusTag.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractCategory,
  ContractListItem,
  ContractListQuery,
  ContractListSummary,
  ContractMeta,
  ContractSettlementStatus,
  ContractStatus,
} from "@/types/contract";
import {
  cancelContractBeforeSeal,
  getContractErrorMessage,
  getContractMeta,
  getContracts,
} from "@/utils/contractApi";
import {
  clampPercent,
  CONTRACT_CATEGORY_LABELS,
  CONTRACT_RELATION_LABELS,
  CONTRACT_STATUS_LABELS,
  escapeContractCsvCell,
  formatContractDate,
  formatContractMoney,
  getContractBusinessDate,
  normalizeContractPercent,
  shouldDisplayContractCurrentAmount,
} from "@/utils/contractPresentation";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const adminRoles = new Set(["super_admin", "chairman", "admin"]);
const approvalCenterRoles = new Set(["general_manager"]);
const canCreate = computed(() => adminRoles.has(authStore.user?.role || ""));
const isEmployee = computed(() => authStore.user?.role === "user");
const canExportContracts = computed(
  () =>
    adminRoles.has(authStore.user?.role || "") ||
    authStore.user?.role === "general_manager",
);
const canOpenApprovalCenter = computed(() =>
  approvalCenterRoles.has(authStore.user?.role || ""),
);
const CONTRACT_SETTLEMENT_STATUS_LABELS: Record<
  ContractSettlementStatus,
  string
> = {
  unsettled: "已签合同未结算",
  partial: "已签合同部分结算",
  settled: "已签合同已结清",
};
type ContractDateMode = "year" | "month" | "day";
const contractDateModes: Array<{ label: string; value: ContractDateMode }> = [
  { label: "年", value: "year" },
  { label: "月", value: "month" },
  { label: "日", value: "day" },
];
const contractDateMode = ref<ContractDateMode>("day");
const contractDatePanelShortcuts = contractDateModes.map((mode) => ({
  text: mode.label,
  onClick: () => {
    contractDateMode.value = mode.value;
  },
}));
const contractDatePickerType = computed(() => {
  if (contractDateMode.value === "year") return "yearrange" as const;
  if (contractDateMode.value === "month") return "monthrange" as const;
  return "daterange" as const;
});
const contractDatePickerFormat = computed(() => {
  if (contractDateMode.value === "year") return "YYYY 年";
  if (contractDateMode.value === "month") return "YYYY 年 M 月";
  return "YYYY-MM-DD";
});
const contractDatePickerValueFormat = computed(() => {
  if (contractDateMode.value === "year") return "YYYY";
  if (contractDateMode.value === "month") return "YYYY-MM";
  return "YYYY-MM-DD";
});
const contractDatePickerStartPlaceholder = computed(() => {
  if (contractDateMode.value === "year") return "开始年份";
  if (contractDateMode.value === "month") return "开始月份";
  return "合同开始日期";
});
const contractDatePickerEndPlaceholder = computed(() => {
  if (contractDateMode.value === "year") return "结束年份";
  if (contractDateMode.value === "month") return "结束月份";
  return "合同结束日期";
});

const items = ref<ContractListItem[]>([]);
type ContractLedgerRow = ContractListItem & { children?: ContractLedgerRow[] };
const expandedMobileRootIds = ref(new Set<string>());
const ledgerItems = computed<ContractLedgerRow[]>(() => {
  const roots = items.value
    .filter((item) => item.relationType === "main")
    .map((item) => ({ ...item, children: [] }) as ContractLedgerRow);
  const rootsById = new Map(roots.map((root) => [root.id, root]));
  for (const item of items.value) {
    if (item.relationType === "main" || item.hasSealedContractFile === true) {
      continue;
    }
    const rootId = item.rootContractId || item.parentContractId;
    const root = rootId ? rootsById.get(rootId) : undefined;
    if (root) root.children!.push({ ...item });
  }
  return roots.map((root) =>
    root.children?.length ? root : { ...root, children: undefined },
  );
});
const visibleMobileItems = computed<ContractLedgerRow[]>(() =>
  ledgerItems.value.flatMap((root) =>
    expandedMobileRootIds.value.has(root.id)
      ? [root, ...(root.children || [])]
      : [root],
  ),
);
const summary = ref<ContractListSummary>({});
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const exporting = ref(false);
const cancellingContractId = ref("");
const errorMessage = ref("");
const meta = ref<ContractMeta>({
  projects: [],
  areas: [],
  assetCategories: [],
  declaredSubtypeOptions: {
    main_business: [],
    non_main: [],
    asset: [],
  },
});
const filters = reactive<{
  keyword: string;
  counterparty: string;
  categories: ContractCategory[];
  statuses: ContractStatus[];
  settlementStatus: ContractSettlementStatus | "";
  projectId: string;
  area: string;
  contractDateFrom: string;
  contractDateTo: string;
}>({
  keyword: "",
  counterparty: "",
  categories: [],
  statuses: [],
  settlementStatus: "",
  projectId: "",
  area: "",
  contractDateFrom: "",
  contractDateTo: "",
});
const contractDatePickerValue = computed<string[] | null>({
  get: () => {
    if (!filters.contractDateFrom || !filters.contractDateTo) return null;
    if (contractDateMode.value === "year") {
      return [
        filters.contractDateFrom.slice(0, 4),
        filters.contractDateTo.slice(0, 4),
      ];
    }
    if (contractDateMode.value === "month") {
      return [
        filters.contractDateFrom.slice(0, 7),
        filters.contractDateTo.slice(0, 7),
      ];
    }
    return [filters.contractDateFrom, filters.contractDateTo];
  },
  set: (value) => {
    if (!value?.[0] || !value?.[1]) {
      filters.contractDateFrom = "";
      filters.contractDateTo = "";
      return;
    }
    if (contractDateMode.value === "year") {
      filters.contractDateFrom = `${value[0]}-01-01`;
      filters.contractDateTo = `${value[1]}-12-31`;
      return;
    }
    if (contractDateMode.value === "month") {
      const [endYear, endMonth] = value[1].split("-").map(Number);
      const lastDay = new Date(endYear, endMonth, 0).getDate();
      filters.contractDateFrom = `${value[0]}-01`;
      filters.contractDateTo = `${value[1]}-${String(lastDay).padStart(2, "0")}`;
      return;
    }
    filters.contractDateFrom = value[0];
    filters.contractDateTo = value[1];
  },
});

interface NormalizedContractListLocation {
  page: number;
  pageSize: number;
  keyword: string;
  counterparty: string;
  categories: ContractCategory[];
  statuses: ContractStatus[];
  settlementStatus: ContractSettlementStatus | "";
  projectId: string;
  area: string;
  contractDateFrom: string;
  contractDateTo: string;
}

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function rawQueryList(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function queryEnumList<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T[] {
  return [
    ...new Set(
      rawQueryList(value).filter((item): item is T =>
        allowedValues.includes(item as T),
      ),
    ),
  ];
}

function queryDate(value: unknown): string {
  const date = queryText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
}

function normalizedRouteQuery(): NormalizedContractListLocation {
  const rawPage = Number(queryText(route.query.page));
  const rawPageSize = Number(queryText(route.query.pageSize));
  return {
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: [10, 20, 50].includes(rawPageSize) ? rawPageSize : 20,
    keyword: queryText(route.query.keyword).trim(),
    counterparty: queryText(route.query.counterparty).trim(),
    categories: queryEnumList(route.query.category, [
      "main_business",
      "non_main",
      "asset",
    ] as const),
    statuses: queryEnumList(route.query.status, [
      "draft",
      "approving",
      "pending_seal",
      "effective",
      "executing",
      "completed",
      "rejected",
      "terminated",
    ] as const),
    settlementStatus:
      queryEnumList(route.query.settlementStatus, [
        "unsettled",
        "partial",
        "settled",
      ] as const)[0] || "",
    projectId: queryText(route.query.projectId),
    area: queryText(route.query.area),
    contractDateFrom: queryDate(route.query.contractDateFrom),
    contractDateTo: queryDate(route.query.contractDateTo),
  };
}

function currentLocationQuery(): NormalizedContractListLocation {
  return {
    page: page.value,
    pageSize: pageSize.value,
    keyword: filters.keyword.trim(),
    counterparty: filters.counterparty.trim(),
    categories: [...filters.categories],
    statuses: [...filters.statuses],
    settlementStatus: filters.settlementStatus,
    projectId: filters.projectId,
    area: filters.area,
    contractDateFrom: filters.contractDateFrom,
    contractDateTo: filters.contractDateTo,
  };
}

function currentQuery(): ContractListQuery {
  return {
    page: page.value,
    pageSize: pageSize.value,
    keyword: filters.keyword.trim() || undefined,
    counterparty: filters.counterparty.trim() || undefined,
    category: filters.categories.length ? filters.categories : undefined,
    status: filters.statuses.length ? filters.statuses : undefined,
    settlementStatus: filters.settlementStatus || undefined,
    projectId: filters.projectId || undefined,
    area: filters.area || undefined,
    contractDateFrom: filters.contractDateFrom || undefined,
    contractDateTo: filters.contractDateTo || undefined,
  };
}

function routeMatches(query: NormalizedContractListLocation): boolean {
  return (
    queryText(route.query.page) === String(query.page) &&
    queryText(route.query.pageSize) === String(query.pageSize) &&
    queryText(route.query.keyword) === query.keyword &&
    queryText(route.query.counterparty) === query.counterparty &&
    rawQueryList(route.query.category).join(",") ===
      query.categories.join(",") &&
    rawQueryList(route.query.status).join(",") === query.statuses.join(",") &&
    queryText(route.query.settlementStatus) === query.settlementStatus &&
    queryText(route.query.projectId) === query.projectId &&
    queryText(route.query.area) === query.area &&
    queryText(route.query.contractDateFrom) === query.contractDateFrom &&
    queryText(route.query.contractDateTo) === query.contractDateTo
  );
}

function replaceRouteQuery(query: NormalizedContractListLocation) {
  void router.replace({
    query: {
      ...route.query,
      page: String(query.page),
      pageSize: String(query.pageSize),
      keyword: query.keyword || undefined,
      counterparty: query.counterparty || undefined,
      category: query.categories.length
        ? query.categories.join(",")
        : undefined,
      status: query.statuses.length ? query.statuses.join(",") : undefined,
      settlementStatus: query.settlementStatus || undefined,
      projectId: query.projectId || undefined,
      area: query.area || undefined,
      contractDateFrom: query.contractDateFrom || undefined,
      contractDateTo: query.contractDateTo || undefined,
    },
  });
}

let contractLoadSequence = 0;

async function loadContracts() {
  const loadSequence = ++contractLoadSequence;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await getContracts(currentQuery());
    if (loadSequence !== contractLoadSequence) return;
    const maximumPage = Math.max(1, Math.ceil(result.total / pageSize.value));
    if (page.value > maximumPage) {
      page.value = maximumPage;
      replaceRouteQuery(currentLocationQuery());
      return;
    }
    items.value = result.items;
    total.value = result.total;
    summary.value = result.summary;
  } catch (error) {
    if (loadSequence !== contractLoadSequence) return;
    errorMessage.value = getContractErrorMessage(
      error,
      "无法获取合同台账，请稍后重试",
    );
  } finally {
    if (loadSequence === contractLoadSequence) loading.value = false;
  }
}

function applyFilters(resetPage: boolean) {
  if (
    filters.contractDateFrom &&
    filters.contractDateTo &&
    filters.contractDateFrom > filters.contractDateTo
  ) {
    ElMessage.warning("合同开始日期不能晚于结束日期");
    return;
  }
  if (resetPage) page.value = 1;
  const query = currentLocationQuery();
  if (routeMatches(query)) {
    void loadContracts();
    return;
  }
  replaceRouteQuery(query);
}

function handleSearch() {
  applyFilters(true);
}

function handleFilterChange() {
  applyFilters(true);
}

function handlePageChange(nextPage: number) {
  page.value = nextPage;
  applyFilters(false);
}

function handlePageSizeChange(nextPageSize: number) {
  pageSize.value = nextPageSize;
  page.value = 1;
  applyFilters(false);
}

function resetFilters() {
  contractDateMode.value = "day";
  filters.keyword = "";
  filters.counterparty = "";
  filters.categories = [];
  filters.statuses = [];
  filters.settlementStatus = "";
  filters.projectId = "";
  filters.area = "";
  filters.contractDateFrom = "";
  filters.contractDateTo = "";
  page.value = 1;
  applyFilters(false);
}

function openDetail(item: ContractListItem) {
  void router.push(`/contracts/${item.id}`);
}

function openDownloadRequest(item: ContractListItem) {
  void router.push({
    path: "/contract-download-requests/new",
    query: { contractId: item.id },
  });
}

function canApplyInvoice(item: ContractListItem): boolean {
  return (
    isEmployee.value &&
    item.relationType === "main" &&
    ["main_business", "non_main"].includes(item.category || "") &&
    ["effective", "executing", "completed"].includes(item.status) &&
    item.invoiceApplicationEligibility?.eligible === true
  );
}

function openInvoiceApplication(item: ContractListItem) {
  if (!canApplyInvoice(item)) return;
  void router.push({
    path: "/invoice-applications/new",
    query: { contractId: item.id },
  });
}

function openAuxiliaryMaterials(item: ContractListItem) {
  if (!canCreate.value || !item.requiresAuxiliaryMaterials) return;
  void router.push({
    path: `/contracts/${item.id}`,
    query: { tab: "auxiliary" },
  });
}

function canUploadSupplement(item: ContractListItem): boolean {
  return (
    canCreate.value &&
    item.relationType === "main" &&
    !item.renewalContractId &&
    ["effective", "executing", "completed"].includes(item.status)
  );
}

function canManageRentalLifecycle(item: ContractListItem): boolean {
  return (
    canCreate.value &&
    item.relationType === "main" &&
    item.category === "asset" &&
    ["house_rental", "vehicle_rental", "parking_space"].includes(
      item.declaredSubtype || "",
    ) &&
    Boolean(item.leaseEndDate) &&
    !item.renewalContractId &&
    ["effective", "executing", "completed"].includes(item.status)
  );
}

function openRentalRenewal(item: ContractListItem) {
  if (!canManageRentalLifecycle(item)) return;
  void router.push({
    path: "/contracts/create",
    query: {
      rentalRenewal: "1",
      sourceContractId: item.id,
    },
  });
}

function openSupplementUpload(item: ContractListItem) {
  if (!canUploadSupplement(item)) return;
  void router.push({
    path: "/contracts/create",
    query: { parentContractId: item.id, quickSupplement: "1" },
  });
}

function continueEditing(item: ContractListItem) {
  if (!canCreate.value || item.status !== "draft") return;
  void router.push({
    path: "/contracts/create",
    query: { contractId: item.id },
  });
}

function openSealArchive(item: ContractListItem) {
  if (!canCreate.value || item.status !== "pending_seal") return;
  void router.push({
    path: `/contracts/${item.id}`,
    query: { tab: "seal", action: "seal" },
  });
}

function openFinancialRegistration(item: ContractListItem) {
  if (
    !canCreate.value ||
    item.relationType !== "main" ||
    !["effective", "executing"].includes(item.status)
  ) {
    return;
  }
  void router.push({
    path: `/contracts/${item.id}`,
    query: { tab: "finance", action: "record" },
  });
}

function canCancelContract(item: ContractListItem): boolean {
  return (
    canCreate.value &&
    ["draft", "approving", "pending_seal"].includes(item.status)
  );
}

async function cancelContract(item: ContractListItem) {
  if (!canCancelContract(item) || cancellingContractId.value) return;
  let cancellationReason = "";
  try {
    const result = await ElMessageBox.prompt(
      "撤销后合同将从台账移除，但合同文件、审批历史和操作留痕会继续保留。已上传盖章版的合同不能撤销。请填写真实、可追溯的撤销原因。",
      "撤销此合同",
      {
        confirmButtonText: "确认撤销",
        cancelButtonText: "取消",
        type: "warning",
        distinguishCancelAndClose: true,
        inputType: "textarea",
        inputPlaceholder: "请输入撤销原因（必填，最多300字）",
        inputValidator: (value) => {
          const text = String(value || "").trim();
          if (!text) return "请填写撤销原因";
          if (text.length > 300) return "撤销原因不能超过300个字符";
          return true;
        },
      },
    );
    cancellationReason = String(result.value || "").trim();
  } catch {
    return;
  }
  cancellingContractId.value = item.id;
  try {
    await cancelContractBeforeSeal(item.id, item.version, cancellationReason);
    ElMessage.success("合同已撤销");
    await loadContracts();
  } catch (error) {
    errorMessage.value = getContractErrorMessage(
      error,
      "撤销合同失败，请稍后重试",
    );
  } finally {
    cancellingContractId.value = "";
  }
}

function normalizeProgress(value?: number | null): number {
  return normalizeContractPercent(value);
}

function contractDirectionClass(
  item: Pick<ContractListItem, "category">,
): "is-income" | "is-expense" | "is-unclassified" {
  if (item.category === "asset") return "is-expense";
  if (item.category === "main_business" || item.category === "non_main") {
    return "is-income";
  }
  return "is-unclassified";
}

function contractDirectionLabel(
  item: Pick<ContractListItem, "category">,
): "收入" | "支出" | "待确认" {
  const directionClass = contractDirectionClass(item);
  if (directionClass === "is-income") return "收入";
  if (directionClass === "is-expense") return "支出";
  return "待确认";
}

function contractRowClassName({ row }: { row: ContractListItem }): string {
  return [
    row.leaseExpiringSoon ? "lease-expiring-row" : "",
    row.relationType !== "main" ? "related-contract-row" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function ledgerSequence(item: ContractListItem): string | number {
  if (item.relationType !== "main") return "↳";
  const rootIndex = ledgerItems.value.findIndex((root) => root.id === item.id);
  return (page.value - 1) * pageSize.value + rootIndex + 1;
}

function toggleMobileContractGroup(rootId: string) {
  const next = new Set(expandedMobileRootIds.value);
  if (next.has(rootId)) next.delete(rootId);
  else next.add(rootId);
  expandedMobileRootIds.value = next;
}

function contractCategoryLabel(category: unknown): string {
  return CONTRACT_CATEGORY_LABELS[category as ContractCategory] || "未知分类";
}

function contractRelationLabel(item: ContractListItem): string {
  return CONTRACT_RELATION_LABELS[item.relationType];
}

function contractDisplayName(item: ContractListItem): string {
  return String(item.name || item.projectName || "未命名合同").trim();
}

function shouldShowRelationBadge(item: ContractListItem): boolean {
  if (item.relationType === "main") return false;
  const normalizedName = contractDisplayName(item).replace(/\s+/g, "");
  const normalizedLabel = contractRelationLabel(item).replace(/\s+/g, "");
  return !normalizedName.includes(normalizedLabel);
}

function contractNumberText(item: ContractListItem): string {
  if (item.contractNo) return item.contractNo;
  return item.declaredCategory === "main_business"
    ? "原件合同编号待识别"
    : "系统编号待生成";
}

function displayedContractCutoffDate(
  item: ContractListItem,
): string | null | undefined {
  if (item.relationType !== "main") return null;
  if (item.status !== "completed" && item.status !== "terminated") {
    return null;
  }
  return item.contractCutoffDate;
}

function displayContractAmount(item: ContractListItem): string | number {
  if (["supplement", "termination"].includes(item.relationType))
    return item.amount;
  if (hasProjectedAmountChange(item)) return item.projectedAmount!;
  return shouldDisplayContractCurrentAmount(
    item.currentAmount,
    item.status,
    item.relationType,
    item.pendingAction,
  )
    ? item.currentAmount!
    : item.amount;
}

function hasSupplementAmountChain(item: ContractListItem): boolean {
  return Boolean(
    item.supplementChangeType ||
    item.originalContractAmount != null ||
    item.amountBeforeChange != null ||
    item.amountAfterChange != null ||
    item.currentEffectiveAmount != null,
  );
}

function supplementAmountDelta(item: ContractListItem): string | number {
  return item.supplementChangeType === "payment_terms_only" ? 0 : item.amount;
}

function hasProjectedAmountChange(item: ContractListItem): boolean {
  if (item.relationType !== "main" || !item.pendingSupplementCount)
    return false;
  const currentAmount = Number(item.currentAmount);
  const projectedAmount = Number(item.projectedAmount);
  return (
    Number.isFinite(currentAmount) &&
    Number.isFinite(projectedAmount) &&
    currentAmount !== projectedAmount
  );
}

async function exportContracts() {
  exporting.value = true;
  try {
    const exportItems: ContractListItem[] = [];
    const exportPageSize = 100;
    let exportPage = 1;
    let exportTotal = 0;
    let lastBatchSize = 0;
    do {
      const result = await getContracts({
        ...currentQuery(),
        page: exportPage,
        pageSize: exportPageSize,
      });
      exportItems.push(...result.items);
      exportTotal = result.total;
      lastBatchSize = result.items.length;
      exportPage += 1;
    } while (
      lastBatchSize > 0 &&
      exportPage <= Math.ceil(exportTotal / exportPageSize)
    );
    const visibleExportItems = exportItems.filter(
      (item) =>
        item.relationType === "main" || item.hasSealedContractFile !== true,
    );
    if (!visibleExportItems.length) {
      ElMessage.info("当前筛选条件下没有可导出的合同");
      return;
    }
    const header = [
      "合同编号",
      "合同名称",
      "分类",
      "合同关系",
      "项目名称",
      "行政区域",
      "甲方",
      "乙方",
      "合同日期",
      "合同截至日期",
      "合同金额或协议调整额",
      "已收金额",
      "已付金额",
      "责任人",
      "状态",
    ];
    const rows = visibleExportItems.map((item) => [
      item.contractNo || "",
      item.name,
      contractCategoryLabel(item.category),
      CONTRACT_RELATION_LABELS[item.relationType],
      item.category === "asset" ? "" : item.projectName,
      item.area || "",
      item.partyA,
      item.partyB,
      item.contractDate || "",
      displayedContractCutoffDate(item) || "",
      displayContractAmount(item),
      item.category === "asset" ? "" : item.receivedAmount || 0,
      item.category === "asset" ? item.paidAmount || 0 : "",
      item.ownerName || "",
      CONTRACT_STATUS_LABELS[item.status],
    ]);
    const content = `\uFEFF${[header, ...rows]
      .map((row) => row.map(escapeContractCsvCell).join(","))
      .join("\n")}`;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `合同台账-${getContractBusinessDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "导出合同台账失败"));
  } finally {
    exporting.value = false;
  }
}

async function loadMeta() {
  try {
    meta.value = await getContractMeta();
  } catch {
    // 元数据加载失败不阻止台账加载，筛选项使用默认值。
  }
}

watch(
  () => [
    route.query.page,
    route.query.pageSize,
    route.query.keyword,
    route.query.counterparty,
    route.query.category,
    route.query.status,
    route.query.settlementStatus,
    route.query.projectId,
    route.query.area,
    route.query.contractDateFrom,
    route.query.contractDateTo,
  ],
  () => {
    const query = normalizedRouteQuery();
    page.value = query.page;
    pageSize.value = query.pageSize;
    filters.keyword = query.keyword;
    filters.counterparty = query.counterparty;
    filters.categories = [...query.categories];
    filters.statuses = [...query.statuses];
    filters.settlementStatus = query.settlementStatus;
    filters.projectId = query.projectId;
    filters.area = query.area;
    filters.contractDateFrom = query.contractDateFrom;
    filters.contractDateTo = query.contractDateTo;
    if (!routeMatches(query)) {
      replaceRouteQuery(query);
      return;
    }
    void loadContracts();
  },
  { immediate: true },
);

onMounted(loadMeta);
</script>

<style scoped>
.contract-page {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px 32px 48px;
  background:
    radial-gradient(circle at 5% 2%, rgb(42 104 148 / 8%), transparent 22%),
    #f5f7fa;
  color: #1c3349;
}
.contract-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  border: 1px solid #dfe7ee;
  border-radius: 20px;
  background:
    radial-gradient(circle at 95% 0, rgb(62 183 167 / 13%), transparent 30%),
    linear-gradient(135deg, #fff, #f6f9fc);
  box-shadow: 0 14px 36px rgb(31 55 78 / 8%);
}
.hero-copy h1 {
  margin: 4px 0 6px;
  color: #19344d;
  font-size: 30px;
}
.hero-copy p {
  max-width: 680px;
  margin: 0;
  color: #718090;
}
.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #238478;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.hero-kicker i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5de0c5;
  box-shadow: 0 0 0 5px rgb(93 224 197 / 11%);
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.hero-actions :deep(.el-button) {
  min-height: 38px;
  border-radius: 10px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(190px, 1fr));
  gap: 12px;
  overflow-x: auto;
  margin-top: 16px;
  padding-bottom: 2px;
}
.filter-panel {
  overflow-x: auto;
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #e1e8ee;
  border-radius: 12px;
  background: rgb(255 255 255 / 94%);
  box-shadow: 0 8px 24px rgb(28 49 70 / 5%);
}
.filter-row {
  display: grid;
  min-width: 1540px;
  grid-template-columns:
    minmax(200px, 1.35fr) minmax(140px, 1fr) repeat(5, minmax(125px, 1fr))
    minmax(300px, 2fr) max-content;
  align-items: center;
  gap: 10px;
}
.date-filter {
  display: grid;
  grid-column: auto;
  grid-template-columns: minmax(300px, 1fr);
  align-items: center;
}
.date-filter :deep(.el-date-editor) {
  width: 100%;
}
.filter-actions {
  display: flex;
  grid-column: auto;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}
.filter-panel :deep(.el-input__wrapper),
.filter-panel :deep(.el-select__wrapper) {
  min-height: 38px;
  border-radius: 9px;
}
.ledger-card {
  min-height: 260px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #e1e7ed;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 30px rgb(31 49 68 / 6%);
}
.ledger-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.ledger-heading > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.ledger-heading strong {
  color: #203c55;
  font-size: 17px;
}
.ledger-heading span {
  color: #8b97a3;
  font-size: 12px;
}
.contract-table {
  border-radius: 10px;
}
.lease-expiry-alert {
  margin-top: 16px;
}
.contract-table :deep(.lease-expiring-row > td.el-table__cell) {
  background: #fff1f0 !important;
  color: #b42318;
}
.contract-table :deep(.lease-expiring-row:hover > td.el-table__cell) {
  background: #ffe4e1 !important;
}
.contract-table :deep(.related-contract-row > td.el-table__cell) {
  border-top-color: #d7ecea;
}
.contract-table :deep(.related-contract-row .contract-name-cell) {
  padding-left: 12px;
  align-items: flex-start;
}
.mobile-contract-card.is-lease-expiring {
  border-color: #f56c6c;
  background: #fff1f0;
  box-shadow: 0 8px 22px rgb(245 108 108 / 14%);
}
.mobile-contract-card.is-related-contract {
  width: calc(100% - 22px);
  margin-left: 22px;
  border-left: 3px solid #67bfb1;
  background: #f7fbfc;
}
.contract-table :deep(.cell) {
  white-space: nowrap;
}
.contract-name-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: visible;
  white-space: normal;
}
.contract-name-cell strong {
  width: 100%;
  min-width: 0;
  overflow: visible;
  color: #284a68;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: center;
  text-overflow: clip;
  white-space: normal;
}
.contract-table :deep(.related-contract-row .contract-name-cell strong) {
  text-align: left;
}
.contract-name-meta {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px 8px;
}
.contract-table :deep(.related-contract-row .contract-name-meta) {
  justify-content: flex-start;
}
.contract-name-meta > span {
  color: #98a2ad;
  font-size: 11px;
  white-space: nowrap;
}
.contract-name-cell .relation-badge,
.mobile-relation-label {
  color: #277f73;
  font-size: 11px;
  font-weight: 700;
}
.contract-name-cell .child-count-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: #fff3dc;
  color: #9a651b;
  font-weight: 700;
}
.category-direction-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.direction-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
}
.direction-badge.is-income {
  background: #dff4ec;
  color: #08735f;
}
.direction-badge.is-expense {
  background: #ffeadb;
  color: #b65318;
}
.direction-badge.is-unclassified {
  background: #edf0f3;
  color: #677580;
}
.money-cell {
  color: #1e7180;
}
.money-cell.is-income,
.mobile-contract-amount.is-income {
  color: #08735f;
}
.money-cell.is-expense,
.mobile-contract-amount.is-expense {
  color: #b65318;
}
.mobile-category-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ledger-amount-change {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1.25;
}
.ledger-amount-change small {
  color: #8b97a3;
  font-size: 10px;
  text-decoration: line-through;
}
.ledger-amount-change strong {
  color: #b56716;
  font-size: 14px;
}
.ledger-amount-change span {
  color: #9a6a20;
  font-size: 10px;
}
.mobile-amount-change {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #8b97a3;
  font-size: 11px;
}
.mobile-amount-change > b {
  color: #b56716;
  font-size: 16px;
}
.mobile-amount-change > small {
  color: #9a6a20;
}
.supplement-amount-chain,
.mobile-supplement-amount-chain {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: #657687;
  font-size: 10px;
  line-height: 1.25;
}
.supplement-amount-chain strong,
.mobile-supplement-amount-chain b {
  color: #1e7180;
  font-size: 13px;
}
.payment-terms-badge {
  color: #277f73;
  font-weight: 700;
}
.progress-cell {
  display: grid;
  grid-template-columns: minmax(60px, 1fr) minmax(44px, auto);
  align-items: center;
  gap: 8px;
}
.progress-cell span {
  color: #708090;
  font-size: 11px;
  text-align: right;
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0 7px;
  white-space: nowrap;
}
.row-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.ledger-pagination {
  justify-content: flex-end;
  margin-top: 18px;
}
.ledger-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mobile-only {
  display: none;
}

@media (max-width: 1366px) {
  .contract-page {
    margin: -16px -20px;
    padding: 20px;
  }
}

@media (max-width: 768px) {
  .contract-page {
    margin: -16px -20px;
    padding: 14px;
  }
  .contract-hero {
    align-items: flex-start;
    flex-direction: column;
    padding: 20px;
    border-radius: 16px;
  }
  .hero-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .metric-grid {
    grid-template-columns: 1fr;
    overflow-x: visible;
  }
  .filter-row {
    min-width: 0;
    grid-template-columns: 1fr;
  }
  .date-filter {
    grid-column: auto;
    grid-template-columns: 1fr;
  }
  .filter-actions {
    width: 100%;
    grid-column: auto;
  }
  .filter-actions :deep(.el-button) {
    flex: 1;
  }
  .desktop-only {
    display: none;
  }
  .mobile-only {
    display: grid;
  }
  .mobile-contract-list {
    gap: 10px;
  }
  .mobile-contract-card {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 8px;
    padding: 15px;
    border: 1px solid #e2e8ee;
    border-radius: 12px;
    background: #fbfcfd;
    color: #708090;
  }
  .mobile-card-main {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .mobile-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    color: #274862;
  }
  .mobile-contract-card b {
    color: #1e7180;
    font-size: 18px;
  }
  .mobile-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
    padding-top: 7px;
    border-top: 1px solid #e7ecef;
  }
  .mobile-card-actions :deep(.el-button + .el-button) {
    margin-left: 0;
  }
  .ledger-pagination {
    overflow-x: auto;
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .contract-hero,
  .ledger-card {
    scroll-behavior: auto;
  }
}
</style>
