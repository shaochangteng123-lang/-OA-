<template>
  <div class="contract-dashboard-page">
    <header class="dashboard-hero">
      <div class="hero-copy">
        <span class="hero-kicker"><i></i>合同经营分析</span>
        <h1>合同经营看板</h1>
        <p>
          区分全历史合同规模快照与所选期间收支，所有金额以服务端实时核算为准。
        </p>
      </div>
      <div class="hero-tools">
        <el-button :icon="Refresh" :loading="loading" @click="loadDashboard"
          >刷新</el-button
        >
        <el-button :icon="Setting" @click="openRateDialog">核算费率</el-button>
        <el-button :icon="List" @click="router.push('/contracts')"
          >合同台账</el-button
        >
      </div>
    </header>

    <section class="dashboard-filter-panel" aria-label="经营看板筛选条件">
      <div class="filter-heading">
        <div>
          <strong>统计范围</strong
          ><small
            >开始年月至结束年月统一用于期间合同额、收支、核算、趋势及项目排行；合同规模分组始终为全历史快照</small
          >
        </div>
        <span v-if="metaErrorMessage">{{ metaErrorMessage }}</span>
      </div>
      <div class="dashboard-filters">
        <el-date-picker
          v-model="selectedPeriod"
          type="monthrange"
          value-format="YYYY-MM"
          range-separator="至"
          start-placeholder="开始月份"
          end-placeholder="结束月份"
          :clearable="false"
          aria-label="选择统计开始月份和结束月份"
          @change="handlePeriodChange"
        />
        <el-button @click="selectCurrentYearToDate">本年度至今</el-button>
        <el-button @click="selectFullYear">完整年度</el-button>
        <el-select
          v-model="selectedCategory"
          clearable
          placeholder="全部合同分类"
          aria-label="筛选合同分类"
          @change="applyDashboardFilters"
        >
          <el-option
            v-for="(label, value) in CONTRACT_CATEGORY_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select
          v-model="selectedProjectId"
          clearable
          filterable
          :loading="metaLoading"
          placeholder="全部项目"
          aria-label="筛选关联项目"
          @change="applyDashboardFilters"
        >
          <el-option
            v-for="project in meta.projects"
            :key="project.id"
            :label="project.name"
            :value="project.id"
          />
        </el-select>
        <el-button :icon="Refresh" @click="resetDashboardFilters"
          >重置筛选</el-button
        >
      </div>
    </section>

    <el-alert
      v-if="errorMessage"
      class="dashboard-alert"
      type="error"
      show-icon
      :closable="false"
      :title="errorMessage"
    >
      <template #default
        ><el-button type="danger" link @click="loadDashboard"
          >重新加载</el-button
        ></template
      >
    </el-alert>

    <main v-loading="loading" :aria-busy="loading">
      <section class="metric-section" aria-label="全历史合同规模">
        <div class="section-heading metric-section-heading">
          <div>
            <h2>合同规模</h2>
            <span>全历史快照，分类构成在下方“合同结构”中展示</span>
          </div>
          <div class="metric-section-total">
            <span>合同总额</span>
            <strong>{{
              formatContractMoney(
                dashboard?.summary.allContractAmount ??
                  dashboard?.summary.totalAmount,
              )
            }}</strong>
          </div>
        </div>
        <div class="metric-grid snapshot-metric-grid">
          <ContractMetricCard
            label="有效收入合同额"
            :value="
              formatContractMoney(
                dashboard?.summary.effectiveIncomeContractAmount,
              )
            "
            :note="`共 ${dashboard?.summary.effectiveIncomeContractCount || 0} 个主营或非主营有效合同组`"
            :icon="DataAnalysis"
            tone="cyan"
            badge="收入"
          />
          <ContractMetricCard
            label="有效支出合同额"
            :value="
              formatContractMoney(
                dashboard?.summary.effectiveExpenseContractAmount,
              )
            "
            :note="`共 ${dashboard?.summary.effectiveExpenseContractCount || 0} 个资产类有效合同组`"
            :icon="Money"
            tone="red"
            badge="支出"
          />
          <ContractMetricCard
            label="待签金额"
            :value="
              formatContractMoney(dashboard?.summary.pendingSignatureAmount)
            "
            :note="`共 ${dashboard?.summary.pendingSignatureContractCount || 0} 个待签合同组`"
            :icon="Document"
            tone="amber"
          />
          <ContractMetricCard
            label="未回款余额"
            :value="formatOptionalMoney(dashboard?.unreceivedAmount)"
            :note="
              dashboard?.unreceivedAmount == null
                ? '后端暂未提供未回款统计'
                : '有效收入合同额扣除累计有效回款'
            "
            :icon="WarningFilled"
            tone="red"
          />
        </div>
      </section>

      <section class="metric-section" aria-label="所选期间经营数据">
        <div class="section-heading metric-section-heading">
          <div>
            <h2>所选期间经营数据</h2>
            <span>{{ selectedPeriodLabel }}，统一按所选统计范围汇总</span>
          </div>
        </div>
        <div class="metric-grid period-metric-grid">
          <ContractMetricCard
            label="期间签订合同额"
            :value="
              formatContractMoney(dashboard?.summary.periodContractAmount)
            "
            :note="`主合同签订月份在期间内，共 ${dashboard?.summary.periodContractCount || 0} 个当前有效合同组`"
            :icon="Document"
            tone="violet"
          />
          <ContractMetricCard
            label="期间开票与回款"
            value=""
            :details="[
              {
                label: '回款',
                value: formatContractMoney(dashboard?.summary.receivedAmount),
              },
              {
                label: '开票',
                value: formatContractMoney(dashboard?.summary.invoiceAmount),
              },
              {
                label: '开票－回款',
                value: formatContractMoney(periodInvoiceReceiptDifference),
              },
            ]"
            note="发票与收入回单对比"
            :icon="Tickets"
            tone="green"
            badge="收入"
          />
          <ContractMetricCard
            label="期间支出"
            :value="formatContractMoney(dashboard?.summary.paidAmount)"
            note="资产类合同有效付款"
            :icon="Money"
            tone="amber"
            badge="支出"
          />
          <ContractMetricCard
            label="期间核算收入"
            :value="formatOptionalMoney(dashboard?.periodAccountingIncome)"
            :note="
              dashboard?.periodAccountingIncome == null
                ? '后端暂未提供期间核算收入'
                : '按历史生效费率逐笔核算'
            "
            :icon="DataAnalysis"
            tone="violet"
            badge="收入"
          />
        </div>
      </section>

      <section class="category-section">
        <div class="section-heading">
          <div>
            <h2>合同结构</h2>
            <span>全历史快照：按当前有效合同及合同分类汇总，不含待签合同</span>
          </div>
          <small
            >数据更新时间：{{
              formatContractDateTime(dashboard?.generatedAt)
            }}</small
          >
        </div>
        <div class="category-grid">
          <article
            v-for="item in categoryCards"
            :key="item.category"
            :class="`category-card ${item.category}`"
          >
            <div class="category-title">
              <span
                ><el-icon><component :is="item.icon" /></el-icon
              ></span>
              <div>
                <strong>{{ CONTRACT_CATEGORY_LABELS[item.category] }}</strong
                ><small>{{ item.contractCount }} 份合同</small>
              </div>
            </div>
            <div class="category-total">
              <small>合同总额</small>
              <b>{{ formatContractMoney(item.totalAmount) }}</b>
            </div>
            <div class="category-metrics">
              <div>
                <span
                  >期间{{ item.category === "asset" ? "付款" : "回款" }}</span
                >
                <strong>{{
                  formatOptionalMoney(
                    item.periodSettledAmount ??
                      item.periodAmount ??
                      item.monthSettledAmount ??
                      item.monthAmount,
                    "—",
                  )
                }}</strong>
              </div>
              <div>
                <span
                  >累计{{ item.category === "asset" ? "付款" : "回款" }}</span
                >
                <strong>{{
                  formatOptionalMoney(
                    item.cumulativeSettledAmount ?? item.settledAmount,
                    "—",
                  )
                }}</strong>
              </div>
              <div>
                <span>未{{ item.category === "asset" ? "付款" : "回款" }}</span>
                <strong>{{
                  formatOptionalMoney(item.outstandingAmount, "—")
                }}</strong>
              </div>
            </div>
            <div
              class="share-track"
              role="progressbar"
              :aria-valuenow="completionBarWidth(item.completionRate)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <i
                :style="{
                  width: `${completionBarWidth(item.completionRate)}%`,
                }"
              ></i>
            </div>
            <p>
              <span>回款／付款完成比例</span
              ><strong>{{ formatOptionalPercent(item.completionRate) }}</strong>
            </p>
            <p class="category-card-note">
              <span>合同金额占比 {{ item.share }}%</span>
              <span v-if="item.noFixedAmountCount"
                >无固定金额 {{ item.noFixedAmountCount }} 份，不计完成率</span
              >
            </p>
          </article>
        </div>
      </section>

      <section class="accounting-section" aria-label="分类核算明细">
        <div class="section-heading">
          <div>
            <h2>分类核算明细</h2>
            <span>{{ selectedPeriodLabel }} 按回单日期匹配历史生效费率</span>
          </div>
          <small>金额均由服务端整数分核算</small>
        </div>
        <div class="accounting-grid">
          <article
            v-for="section in accountingSections"
            :key="section.key"
            class="accounting-card"
          >
            <div class="accounting-card-heading">
              <div>
                <strong>{{ section.label }}</strong
                ><small>{{ section.description }}</small>
              </div>
              <el-tag size="small" effect="plain">{{ section.badge }}</el-tag>
            </div>
            <div v-if="section.available" class="accounting-lines">
              <div
                v-for="line in section.lines"
                :key="line.label"
                :class="{ emphasized: line.emphasized }"
              >
                <span>{{ line.label }}</span>
                <strong :class="{ unavailable: line.value == null }">{{
                  formatOptionalMoney(line.value, "—")
                }}</strong>
              </div>
            </div>
            <el-empty
              v-else
              description="后端暂未提供该分类核算数据"
              :image-size="58"
            />
          </article>
        </div>
        <div class="period-rate-panel">
          <div class="accounting-card-heading">
            <div>
              <strong>统计期末适用费率</strong
              ><small
                >用于说明
                {{ selectedEndMonth }} 期末生效版本，期间回单仍逐笔匹配</small
              >
            </div>
          </div>
          <div v-if="dashboard?.rates" class="period-rate-grid">
            <div v-for="item in rateDefinitions" :key="item.code">
              <span>{{ item.label }}</span>
              <strong>{{
                formatRatePercent(dashboard.rates[item.code])
              }}</strong>
            </div>
          </div>
          <el-empty
            v-else
            description="后端暂未提供统计期费率"
            :image-size="58"
          />
        </div>
      </section>

      <section class="settlement-section" aria-label="合同结算状态">
        <div class="section-heading">
          <div>
            <h2>合同结算状态</h2>
            <span
              >全历史快照：按已生效合同组当前有效金额与累计有效银行回单判断</span
            >
          </div>
          <small>点击状态卡片下钻至合同台账</small>
        </div>
        <div class="settlement-grid">
          <button
            v-for="item in settlementCards"
            :key="item.status"
            type="button"
            :class="`settlement-card ${item.status}`"
            @click="openSettlementStatus(item.status)"
          >
            <span class="settlement-card-heading">
              <span>
                <strong>{{ settlementStatusLabel(item.status) }}</strong>
                <small>{{ item.contractCount }} 份合同</small>
              </span>
              <el-icon><ArrowRight /></el-icon>
            </span>
            <span class="settlement-card-metrics">
              <span
                ><small>合同总金额</small
                ><strong>{{
                  formatContractMoney(item.contractAmount)
                }}</strong></span
              >
              <span
                ><small>已回款</small
                ><strong>{{
                  formatContractMoney(item.settledAmount)
                }}</strong></span
              >
              <span
                ><small>未付款</small
                ><strong>{{
                  formatContractMoney(item.outstandingAmount)
                }}</strong></span
              >
            </span>
          </button>
        </div>
        <p
          v-if="dashboard?.noFixedAmountContractCount"
          class="no-fixed-amount-note"
        >
          无固定金额合同 {{ dashboard.noFixedAmountContractCount }}
          份，仅单独计数，不进入上述三类结算状态及金额。
        </p>
      </section>

      <section class="comparison-section" aria-label="三期收支比较">
        <div class="section-heading">
          <div>
            <h2>
              {{
                isSingleMonth
                  ? "本月、上月与上年同月收支比较"
                  : "所选期间、上一等长期间与上年同期收支比较"
              }}
            </h2>
            <span
              >各比较区间长度一致；收入为有效回单，支出为资产类有效付款</span
            >
          </div>
          <div class="legend">
            <span><i class="income"></i>收入</span
            ><span><i class="expense"></i>支出</span>
          </div>
        </div>
        <div v-if="comparisonItems.length" class="comparison-layout">
          <div
            class="comparison-chart"
            role="img"
            :aria-label="comparisonAriaLabel"
          >
            <div
              v-for="item in comparisonItems"
              :key="item.key"
              class="comparison-column"
            >
              <div class="comparison-period">
                <strong>{{ comparisonPeriodLabel(item.key) }}</strong>
                <small>{{ item.period }}</small>
              </div>
              <div class="bars">
                <span
                  class="bar income"
                  :style="{
                    height: `${comparisonBarHeight(item.incomeAmount)}%`,
                  }"
                  :title="`收入 ${formatContractMoney(item.incomeAmount)}`"
                ></span>
                <span
                  class="bar expense"
                  :style="{
                    height: `${comparisonBarHeight(item.expenseAmount)}%`,
                  }"
                  :title="`支出 ${formatContractMoney(item.expenseAmount)}`"
                ></span>
              </div>
              <div class="comparison-values">
                <span>收 {{ formatContractMoney(item.incomeAmount) }}</span>
                <span>支 {{ formatContractMoney(item.expenseAmount) }}</span>
              </div>
            </div>
          </div>
          <div class="comparison-change-grid">
            <article v-for="item in comparisonChangeItems" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ formatSignedMoney(item.change.amount) }}</strong>
              <small>{{
                formatComparisonPercentage(item.change.percentage)
              }}</small>
            </article>
          </div>
        </div>
        <el-empty v-else description="暂无三期收支比较数据" :image-size="76" />
      </section>

      <section class="analysis-grid">
        <article class="analysis-card trend-card">
          <div class="section-heading">
            <div>
              <h2>所选期间月度收支趋势</h2>
              <span>{{ selectedPeriodLabel }} 每月回单收入与资产付款对比</span>
            </div>
            <div class="legend">
              <span><i class="income"></i>有效回单</span
              ><span><i class="expense"></i>资产付款</span>
            </div>
          </div>
          <div
            v-if="trendItems.length"
            class="trend-chart"
            role="img"
            :aria-label="trendAriaLabel"
          >
            <div
              v-for="item in trendItems"
              :key="item.period"
              class="trend-column"
            >
              <div class="bars">
                <span
                  class="bar income"
                  :style="{ height: `${barHeight(item.income)}%` }"
                  :title="`有效回单 ${formatContractMoney(item.income)}`"
                ></span>
                <span
                  class="bar expense"
                  :style="{ height: `${barHeight(item.expense)}%` }"
                  :title="`资产付款 ${formatContractMoney(item.expense)}`"
                ></span>
              </div>
              <small>{{ formatPeriod(item.period) }}</small>
            </div>
          </div>
          <table v-if="trendItems.length" class="sr-only">
            <caption>
              所选期间合同收支明细
            </caption>
            <thead>
              <tr>
                <th>月份</th>
                <th>有效回单</th>
                <th>资产付款</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in trendItems" :key="`accessible-${item.period}`">
                <td>{{ formatPeriod(item.period) }}</td>
                <td>{{ formatContractMoney(item.income) }}</td>
                <td>{{ formatContractMoney(item.expense) }}</td>
              </tr>
            </tbody>
          </table>
          <el-empty v-else description="暂无月度收支数据" :image-size="76" />
        </article>

        <article class="analysis-card risk-card">
          <div class="section-heading">
            <div>
              <h2>经营风险提醒</h2>
              <span>待审批与结算异常合同</span>
            </div>
            <el-tag :type="riskCount ? 'danger' : 'success'" effect="light"
              >{{ riskCount }} 项</el-tag
            >
          </div>
          <div v-if="dashboard?.risks.length" class="risk-list">
            <button
              v-for="risk in dashboard.risks"
              :key="risk.id"
              type="button"
              @click="openRisk(risk)"
            >
              <span :class="`risk-dot ${risk.level}`"></span>
              <span
                ><strong>{{ risk.title }}</strong
                ><small>{{
                  risk.contractName || risk.description
                }}</small></span
              >
              <el-icon><ArrowRight /></el-icon>
            </button>
          </div>
          <div v-else class="risk-empty">
            <span
              ><el-icon><CircleCheckFilled /></el-icon></span
            ><strong>暂无经营风险</strong
            ><small>当前未发现待审批或结算超额合同</small>
          </div>
        </article>
      </section>

      <section class="ranking-section" aria-label="项目经营排行">
        <div class="section-heading">
          <div>
            <h2>项目经营排行</h2>
            <span>点击排行项可下钻至合同或项目详情</span>
          </div>
          <small>{{ selectedPeriodLabel }} 主合同签订月份口径</small>
        </div>
        <div v-if="dashboard?.projectRanking?.length" class="ranking-list">
          <button
            v-for="(item, index) in dashboard.projectRanking"
            :key="
              item.projectId ||
              item.contractId ||
              `${item.projectName}-${index}`
            "
            type="button"
            @click="openProjectRanking(item)"
          >
            <span class="ranking-index">{{ item.rank || index + 1 }}</span>
            <span class="ranking-name">
              <strong>{{ item.projectName }}</strong>
              <small
                >{{ item.contractCount ?? "—" }} 份合同 ·
                {{
                  item.category
                    ? CONTRACT_CATEGORY_LABELS[item.category]
                    : "全部分类"
                }}</small
              >
            </span>
            <span
              ><small>合同金额</small
              ><strong>{{
                formatOptionalMoney(item.contractAmount, "—")
              }}</strong></span
            >
            <span
              ><small>已结算</small
              ><strong>{{
                formatOptionalMoney(
                  item.settledAmount ?? item.receivedAmount ?? item.paidAmount,
                  "—",
                )
              }}</strong></span
            >
            <span
              ><small>核算收入</small
              ><strong>{{
                formatOptionalMoney(item.accountingIncome, "—")
              }}</strong></span
            >
            <span
              ><small>{{
                item.unpaidAmount != null ? "未付款" : "未回款"
              }}</small
              ><strong>{{
                formatOptionalMoney(
                  item.unpaidAmount ?? item.unreceivedAmount,
                  "—",
                )
              }}</strong></span
            >
            <span
              ><small>结算进度</small
              ><strong>{{
                formatOptionalPercent(item.completionRate)
              }}</strong></span
            >
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
        <el-empty
          v-else
          :description="
            dashboard?.projectRanking === null
              ? '后端暂未提供项目排行数据'
              : '当前筛选条件下暂无项目排行数据'
          "
          :image-size="76"
        />
      </section>
    </main>

    <el-dialog
      v-model="rateDialogVisible"
      class="contract-rate-dialog"
      width="min(920px, 94vw)"
      :close-on-click-modal="false"
      :teleported="false"
      destroy-on-close
    >
      <template #header>
        <div class="rate-dialog-title">
          <span
            ><el-icon><Setting /></el-icon
          ></span>
          <div>
            <strong>合同核算费率</strong>
            <small>费率按业务日期生效，历史回单始终使用当时有效的版本</small>
          </div>
        </div>
      </template>

      <div v-loading="rateLoading" class="rate-dialog-body">
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="费率版本建立后不可覆盖；调整时请设置新的生效日期，系统会自动衔接原费率的失效日期。"
        />

        <el-alert
          v-if="rateErrorMessage"
          type="error"
          show-icon
          :closable="false"
          title="合同费率加载失败"
          :description="rateErrorMessage"
        >
          <template #default>
            <el-button
              type="danger"
              link
              :loading="rateLoading"
              @click="loadRates"
              >重新加载费率</el-button
            >
          </template>
        </el-alert>

        <section
          v-if="currentRates"
          class="rate-current-section"
          aria-label="当前生效费率"
        >
          <div class="rate-section-heading">
            <div>
              <strong>当前生效费率</strong
              ><small>以下数值用于新发生的回单核算</small>
            </div>
            <el-tag type="success" effect="light">正在使用</el-tag>
          </div>
          <div class="rate-current-grid">
            <article v-for="item in rateDefinitions" :key="item.code">
              <span>{{ item.label }}</span>
              <strong>{{ formatRatePercent(currentRates[item.code]) }}</strong>
              <small>{{ item.description }}</small>
            </article>
          </div>
        </section>
        <el-empty
          v-else-if="!rateLoading"
          description="费率尚未成功加载，不展示默认 0%"
          :image-size="72"
        />

        <section
          v-if="canManageRates && currentRates"
          class="rate-editor-section"
          aria-label="新增费率版本"
        >
          <div class="rate-section-heading">
            <div>
              <strong>新增费率版本</strong
              ><small>仅财务管理员可维护，变更原因将保留在审计记录中</small>
            </div>
          </div>
          <el-form label-position="top" @submit.prevent="saveRates">
            <div class="rate-form-grid">
              <el-form-item label="生效日期" required>
                <el-date-picker
                  v-model="rateForm.effectiveFrom"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :clearable="false"
                  aria-label="费率生效日期"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="变更原因" required class="reason-field">
                <el-input
                  v-model="rateForm.changeReason"
                  maxlength="200"
                  show-word-limit
                  placeholder="例如：根据最新财务核算政策调整"
                />
              </el-form-item>
            </div>
            <div class="rate-input-grid">
              <el-form-item
                v-for="item in rateDefinitions"
                :key="item.code"
                :label="item.label"
                required
              >
                <el-input-number
                  v-model="rateForm.rates[item.code]"
                  :min="0"
                  :max="100"
                  :precision="2"
                  :step="0.01"
                  controls-position="right"
                  :aria-label="`${item.label}百分比`"
                />
                <span class="rate-percent-suffix">%</span>
              </el-form-item>
            </div>
          </el-form>
        </section>

        <section
          v-if="currentRates"
          class="rate-history-section"
          aria-label="费率历史版本"
        >
          <div class="rate-section-heading">
            <div>
              <strong>历史版本</strong
              ><small>按生效日期倒序展示，便于核对每笔回单的核算依据</small>
            </div>
            <span>共 {{ rateHistory.length }} 条</span>
          </div>
          <el-table
            :data="rateHistory"
            max-height="310"
            empty-text="暂无费率历史"
          >
            <el-table-column label="费率项目" min-width="120">
              <template #default="scope">{{
                rateLabel(scope.row.rateCode)
              }}</template>
            </el-table-column>
            <el-table-column label="费率" width="100" align="right">
              <template #default="scope"
                ><strong>{{
                  formatRatePercent(scope.row.rateValue)
                }}</strong></template
              >
            </el-table-column>
            <el-table-column label="有效期间" min-width="210">
              <template #default="scope"
                >{{ scope.row.effectiveFrom }} 至
                {{ scope.row.effectiveTo || "长期有效" }}</template
              >
            </el-table-column>
            <el-table-column
              prop="changeReason"
              label="变更原因"
              min-width="180"
              show-overflow-tooltip
            >
              <template #default="scope">{{
                scope.row.changeReason || "系统初始费率"
              }}</template>
            </el-table-column>
            <el-table-column label="维护人" min-width="110">
              <template #default="scope">{{
                scope.row.createdByName || "系统"
              }}</template>
            </el-table-column>
          </el-table>
        </section>
      </div>

      <template #footer>
        <el-button @click="rateDialogVisible = false">关闭</el-button>
        <el-button
          v-if="canManageRates && currentRates"
          type="primary"
          :loading="rateSaving"
          @click="saveRates"
          >保存新版本</el-button
        >
      </template>
    </el-dialog>

    <span class="sr-live" aria-live="polite">{{ liveStatus }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  ArrowRight,
  Box,
  Briefcase,
  CircleCheckFilled,
  DataAnalysis,
  Document,
  List,
  Money,
  Refresh,
  Setting,
  Tickets,
  WarningFilled,
} from "@element-plus/icons-vue";
import ContractMetricCard from "@/components/contracts/ContractMetricCard.vue";
import { useAuthStore } from "@/stores/auth";
import type {
  ContractCategory,
  ContractDashboardCategory,
  ContractDashboardComparisonPeriodKey,
  ContractDashboardProjectRanking,
  ContractDashboardQuery,
  ContractDashboardResponse,
  ContractDashboardSettlementStatus,
  ContractMeta,
  ContractRateCode,
  ContractRateConfig,
  ContractRateMutationPayload,
  ContractRiskItem,
  ContractSettlementStatus,
  MoneyValue,
} from "@/types/contract";
import {
  contractRatePercentToDecimal,
  createContractRates,
  getContractDashboard,
  getContractErrorMessage,
  getContractMeta,
  getContractRates,
} from "@/utils/contractApi";
import {
  CONTRACT_CATEGORY_LABELS,
  formatContractDateTime,
  formatContractMoney,
  getContractBusinessDate,
  getContractBusinessMonth,
  moneyToNumber,
  normalizeContractPercent,
} from "@/utils/contractPresentation";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const defaultMonth = getContractBusinessMonth();
const defaultStartMonth = `${defaultMonth.slice(0, 4)}-01`;
const selectedPeriod = ref<[string, string]>([defaultStartMonth, defaultMonth]);
const selectedStartMonth = computed(() => selectedPeriod.value[0]);
const selectedEndMonth = computed(() => selectedPeriod.value[1]);
const isSingleMonth = computed(
  () => selectedStartMonth.value === selectedEndMonth.value,
);
const selectedPeriodLabel = computed(() =>
  isSingleMonth.value
    ? selectedStartMonth.value
    : `${selectedStartMonth.value} 至 ${selectedEndMonth.value}`,
);
const selectedCategory = ref<ContractCategory | "">("");
const selectedProjectId = ref("");
const dashboard = ref<ContractDashboardResponse | null>(null);
const periodInvoiceReceiptDifference = computed(
  () =>
    moneyToNumber(dashboard.value?.summary.invoiceAmount) -
    moneyToNumber(dashboard.value?.summary.receivedAmount),
);
const loading = ref(false);
const errorMessage = ref("");
const liveStatus = ref("");
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
const metaLoading = ref(false);
const metaErrorMessage = ref("");
const rateDialogVisible = ref(false);
const rateLoading = ref(false);
const rateSaving = ref(false);
const rateErrorMessage = ref("");
const rateHistory = ref<ContractRateConfig[]>([]);
const currentRates = ref<Record<ContractRateCode, number> | null>(null);
const rateForm = reactive({
  effectiveFrom: getContractBusinessDate(),
  changeReason: "",
  rates: {
    tax: 0,
    marketing: 0,
    business: 0,
    financial: 0,
  } as Record<ContractRateCode, number>,
});

const rateDefinitions: Array<{
  code: ContractRateCode;
  label: string;
  description: string;
}> = [
  { code: "tax", label: "税费", description: "主营、非主营合同" },
  { code: "marketing", label: "预扣营销", description: "主营合同税后金额" },
  { code: "business", label: "商务费用", description: "主营合同扣除营销后" },
  { code: "financial", label: "财务成本", description: "非主营合同" },
];

const canManageRates = computed(() =>
  new Set(["super_admin", "chairman", "admin"]).has(authStore.user?.role || ""),
);

const categoryDefinitions: Array<{
  category: ContractCategory;
  icon: typeof Document;
}> = [
  { category: "main_business", icon: Briefcase },
  { category: "non_main", icon: Document },
  { category: "asset", icon: Box },
];

const categoryCards = computed(() => {
  const total = moneyToNumber(
    dashboard.value?.summary.effectiveContractAmount ??
      dashboard.value?.summary.totalAmount,
  );
  return categoryDefinitions
    .filter(
      (definition) =>
        !selectedCategory.value ||
        definition.category === selectedCategory.value,
    )
    .map((definition) => {
      const existing = dashboard.value?.categories.find(
        (item) => item.category === definition.category,
      );
      const item: ContractDashboardCategory = existing || {
        category: definition.category,
        contractCount: 0,
        totalAmount: 0,
      };
      const amount = moneyToNumber(item.totalAmount);
      return {
        ...item,
        icon: definition.icon,
        share: total > 0 ? Math.round((amount / total) * 100) : 0,
      };
    });
});

const settlementStatusDefinitions: Array<{
  status: ContractSettlementStatus;
  label: string;
}> = [
  { status: "unsettled", label: "已签合同未结算" },
  { status: "partial", label: "已签合同部分结算" },
  { status: "settled", label: "已签合同已结清" },
];

const settlementCards = computed<ContractDashboardSettlementStatus[]>(() =>
  settlementStatusDefinitions.map(
    (definition) =>
      dashboard.value?.settlementStatuses.find(
        (item) => item.status === definition.status,
      ) || {
        status: definition.status,
        contractCount: 0,
        contractAmount: 0,
        settledAmount: 0,
        outstandingAmount: 0,
        contracts: [],
      },
  ),
);

const comparisonItems = computed(
  () => dashboard.value?.periodComparison?.periods || [],
);
const comparisonMaximum = computed(() =>
  Math.max(
    1,
    ...comparisonItems.value.flatMap((item) => [
      moneyToNumber(item.incomeAmount),
      moneyToNumber(item.expenseAmount),
    ]),
  ),
);
const comparisonChangeItems = computed(() => {
  const changes = dashboard.value?.periodComparison?.changes;
  return changes
    ? [
        { label: "收入较上一等长期间", change: changes.incomePreviousPeriod },
        { label: "支出较上一等长期间", change: changes.expensePreviousPeriod },
        { label: "收入较上年同期", change: changes.incomePreviousYear },
        { label: "支出较上年同期", change: changes.expensePreviousYear },
      ]
    : [];
});
const comparisonAriaLabel = computed(() =>
  comparisonItems.value
    .map(
      (item) =>
        `${comparisonPeriodLabel(item.key)}${item.period}，收入${formatContractMoney(item.incomeAmount)}，支出${formatContractMoney(item.expenseAmount)}`,
    )
    .join("；"),
);

const accountingSections = computed(() => {
  const mainBusiness = dashboard.value?.mainBusiness;
  const nonMain = dashboard.value?.nonMain;
  const asset = dashboard.value?.asset;
  return [
    {
      key: "main_business" as const,
      label: "主营项目合同",
      description: "税费、营销预留、商务费用顺序扣减",
      badge: "收入",
      available: Boolean(mainBusiness),
      lines: [
        {
          label: "合同总额",
          value: mainBusiness?.totalContractAmount,
          emphasized: false,
        },
        {
          label: isSingleMonth.value ? "本月回款" : "所选期间回款",
          value:
            mainBusiness?.periodReceiptAmount ??
            mainBusiness?.monthReceiptAmount ??
            mainBusiness?.contractAmount,
          emphasized: false,
        },
        {
          label: "累计回款",
          value: mainBusiness?.cumulativeReceiptAmount,
          emphasized: false,
        },
        {
          label: "未回款",
          value: mainBusiness?.unreceivedAmount,
          emphasized: false,
        },
        { label: "税费", value: mainBusiness?.tax, emphasized: false },
        {
          label: "预扣营销",
          value: mainBusiness?.marketingReserve,
          emphasized: false,
        },
        {
          label: "商务费用",
          value: mainBusiness?.businessCost,
          emphasized: false,
        },
        {
          label: "核算基数",
          value: mainBusiness?.accountingBase,
          emphasized: true,
        },
      ],
    },
    {
      key: "non_main" as const,
      label: "非主营项目合同",
      description: "扣减财务成本与税费",
      badge: "收入",
      available: Boolean(nonMain),
      lines: [
        {
          label: "合同总额",
          value: nonMain?.totalContractAmount,
          emphasized: false,
        },
        {
          label: isSingleMonth.value ? "本月回款" : "所选期间回款",
          value:
            nonMain?.periodReceiptAmount ??
            nonMain?.monthReceiptAmount ??
            nonMain?.contractAmount,
          emphasized: false,
        },
        {
          label: "累计回款",
          value: nonMain?.cumulativeReceiptAmount,
          emphasized: false,
        },
        {
          label: "未回款",
          value: nonMain?.unreceivedAmount,
          emphasized: false,
        },
        { label: "财务成本", value: nonMain?.financialCost, emphasized: false },
        { label: "税费", value: nonMain?.tax, emphasized: false },
        { label: "核算基数", value: nonMain?.accountingBase, emphasized: true },
      ],
    },
    {
      key: "asset" as const,
      label: "资产类合同",
      description: "按付款凭证汇总",
      badge: "支出",
      available: Boolean(asset),
      lines: [
        {
          label: "合同总额",
          value: asset?.totalContractAmount,
          emphasized: false,
        },
        {
          label: isSingleMonth.value ? "本月付款" : "所选期间付款",
          value:
            asset?.periodPaymentAmount ??
            asset?.monthPaymentAmount ??
            asset?.paymentAmount,
          emphasized: false,
        },
        {
          label: "累计付款",
          value: asset?.cumulativePaymentAmount,
          emphasized: false,
        },
        {
          label: "未付款",
          value: asset?.unpaidAmount,
          emphasized: true,
        },
      ],
    },
  ].filter(
    (section) =>
      !selectedCategory.value || section.key === selectedCategory.value,
  );
});

const trendItems = computed(() => dashboard.value?.monthlyTrend || []);
const trendAriaLabel = computed(() =>
  trendItems.value
    .map(
      (item) =>
        `${formatPeriod(item.period)}有效回单${formatContractMoney(item.income)}，资产付款${formatContractMoney(item.expense)}`,
    )
    .join("；"),
);
const trendMaximum = computed(() =>
  Math.max(
    1,
    ...trendItems.value.flatMap((item) => [
      moneyToNumber(item.income),
      moneyToNumber(item.expense),
    ]),
  ),
);
const riskCount = computed(() => dashboard.value?.risks.length || 0);

function barHeight(value: string | number): number {
  const amount = moneyToNumber(value);
  if (amount <= 0) return 2;
  return Math.max(6, Math.round((amount / trendMaximum.value) * 100));
}

function completionBarWidth(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function comparisonBarHeight(value: MoneyValue): number {
  const amount = moneyToNumber(value);
  if (amount <= 0) return 2;
  return Math.max(6, Math.round((amount / comparisonMaximum.value) * 100));
}

function settlementStatusLabel(status: ContractSettlementStatus): string {
  return (
    settlementStatusDefinitions.find((item) => item.status === status)?.label ||
    status
  );
}

function comparisonPeriodLabel(
  key: ContractDashboardComparisonPeriodKey,
): string {
  return {
    current: isSingleMonth.value ? "当前所选月份" : "当前所选期间",
    previous_period: isSingleMonth.value ? "上一个自然月" : "上一等长期间",
    previous_year: isSingleMonth.value ? "上年同月" : "上年同期",
  }[key];
}

function formatSignedMoney(value: MoneyValue): string {
  const amount = moneyToNumber(value);
  return `${amount > 0 ? "+" : ""}${formatContractMoney(amount)}`;
}

function formatComparisonPercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "暂无可比数据";
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${value > 0 ? "+" : ""}${formatted}%`;
}

function formatPeriod(period: string): string {
  const parts = period.split("-");
  return parts.length === 2 ? `${Number(parts[1])}月` : period;
}

function formatOptionalMoney(
  value: MoneyValue | null | undefined,
  emptyText = "暂未提供",
): string {
  return value === null || value === undefined || value === ""
    ? emptyText
    : formatContractMoney(value);
}

function formatOptionalPercent(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : `${normalizeContractPercent(value)}%`;
}

function openRisk(risk: ContractRiskItem) {
  if (risk.contractId) {
    void router.push(`/contracts/${risk.contractId}`);
    return;
  }
  if (risk.projectId) {
    void router.push({ name: "ProjectDetail", params: { id: risk.projectId } });
    return;
  }
  void router.push({
    path: "/contracts",
    query: {
      category: risk.category || undefined,
      status: risk.status || undefined,
    },
  });
}

function openProjectRanking(item: ContractDashboardProjectRanking) {
  if (item.contractId) {
    void router.push(`/contracts/${item.contractId}`);
    return;
  }
  if (item.projectId) {
    void router.push({ name: "ProjectDetail", params: { id: item.projectId } });
    return;
  }
  void router.push({
    path: "/contracts",
    query: { keyword: item.projectName },
  });
}

function openSettlementStatus(status: ContractSettlementStatus) {
  void router.push({
    path: "/contracts",
    query: {
      settlementStatus: status,
      category: selectedCategory.value || undefined,
      projectId: selectedProjectId.value || undefined,
    },
  });
}

function rateLabel(code: ContractRateCode): string {
  return rateDefinitions.find((item) => item.code === code)?.label || code;
}

function formatRatePercent(value: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }
  const percentage = Number(value) * 100;
  return `${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(percentage)}%`;
}

function applyCurrentRates(rates: Record<ContractRateCode, number>) {
  const nextRates = {} as Record<ContractRateCode, number>;
  for (const definition of rateDefinitions) {
    const decimal = Number(rates[definition.code] || 0);
    nextRates[definition.code] = decimal;
    rateForm.rates[definition.code] = Number((decimal * 100).toFixed(2));
  }
  currentRates.value = nextRates;
}

async function loadRates() {
  rateLoading.value = true;
  rateErrorMessage.value = "";
  currentRates.value = null;
  rateHistory.value = [];
  try {
    const data = await getContractRates();
    applyCurrentRates(data.current);
    rateHistory.value = [...data.items].sort((left, right) => {
      const dateDifference = right.effectiveFrom.localeCompare(
        left.effectiveFrom,
      );
      if (dateDifference !== 0) return dateDifference;
      return (
        rateDefinitions.findIndex((item) => item.code === left.rateCode) -
        rateDefinitions.findIndex((item) => item.code === right.rateCode)
      );
    });
  } catch (error) {
    rateErrorMessage.value = getContractErrorMessage(error, "合同费率加载失败");
    liveStatus.value = rateErrorMessage.value;
  } finally {
    rateLoading.value = false;
  }
}

async function openRateDialog() {
  rateDialogVisible.value = true;
  rateForm.effectiveFrom = getContractBusinessDate();
  rateForm.changeReason = "";
  await loadRates();
}

async function saveRates() {
  if (!canManageRates.value || !currentRates.value) return;
  if (!rateForm.effectiveFrom) {
    ElMessage.warning("请选择费率生效日期");
    return;
  }
  if (rateForm.changeReason.trim().length < 2) {
    ElMessage.warning("请填写清晰的费率变更原因");
    return;
  }
  let rateItems: ContractRateMutationPayload["items"];
  try {
    rateItems = rateDefinitions.map((item) => ({
      rateCode: item.code,
      rateValue: contractRatePercentToDecimal(rateForm.rates[item.code]),
    }));
  } catch (error) {
    ElMessage.warning(getContractErrorMessage(error, "费率格式不正确"));
    return;
  }

  rateSaving.value = true;
  try {
    await createContractRates({
      effectiveFrom: rateForm.effectiveFrom,
      changeReason: rateForm.changeReason.trim(),
      items: rateItems,
    });
    ElMessage.success("费率新版本已保存，将按生效日期自动应用");
    rateForm.changeReason = "";
    await Promise.all([loadRates(), loadDashboard()]);
  } catch (error) {
    ElMessage.error(getContractErrorMessage(error, "合同费率保存失败"));
  } finally {
    rateSaving.value = false;
  }
}

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function validDashboardMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function dashboardMonthOrdinal(value: string): number {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + month - 1;
}

function dashboardMonthFromOrdinal(value: number): string {
  const year = Math.floor(value / 12);
  const month = (value % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function normalizedDashboardRouteQuery(): Required<ContractDashboardQuery> {
  const routeEndMonth = queryText(route.query.endMonth);
  const endMonth = validDashboardMonth(routeEndMonth)
    ? routeEndMonth
    : defaultMonth;
  const routeStartMonth = queryText(route.query.startMonth);
  let startMonth = validDashboardMonth(routeStartMonth)
    ? routeStartMonth
    : `${endMonth.slice(0, 4)}-01`;
  const monthCount =
    dashboardMonthOrdinal(endMonth) - dashboardMonthOrdinal(startMonth) + 1;
  if (monthCount < 1 || monthCount > 36) {
    startMonth = `${endMonth.slice(0, 4)}-01`;
  }
  const category = queryText(route.query.category);
  return {
    startMonth,
    endMonth,
    category: (["main_business", "non_main", "asset"] as string[]).includes(
      category,
    )
      ? (category as ContractCategory)
      : "",
    projectId: queryText(route.query.projectId),
  };
}

function dashboardRequestQuery(): ContractDashboardQuery {
  return {
    startMonth: selectedStartMonth.value,
    endMonth: selectedEndMonth.value,
    category: selectedCategory.value || undefined,
    projectId: selectedProjectId.value || undefined,
  };
}

function dashboardRouteMatches(
  query: Required<ContractDashboardQuery>,
): boolean {
  return (
    queryText(route.query.startMonth) === query.startMonth &&
    queryText(route.query.endMonth) === query.endMonth &&
    queryText(route.query.category) === query.category &&
    queryText(route.query.projectId) === query.projectId
  );
}

function replaceDashboardQuery(query: Required<ContractDashboardQuery>) {
  const nextQuery = {
    ...route.query,
    year: undefined,
    month: undefined,
    startMonth: query.startMonth,
    endMonth: query.endMonth,
    category: query.category || undefined,
    projectId: query.projectId || undefined,
  };
  void router.replace({ query: nextQuery });
}

function applyDashboardFilters() {
  const query = {
    startMonth: selectedStartMonth.value,
    endMonth: selectedEndMonth.value,
    category: selectedCategory.value,
    projectId: selectedProjectId.value,
  } satisfies Required<ContractDashboardQuery>;
  if (dashboardRouteMatches(query)) {
    void loadDashboard();
    return;
  }
  replaceDashboardQuery(query);
}

function handlePeriodChange() {
  const monthCount =
    dashboardMonthOrdinal(selectedEndMonth.value) -
    dashboardMonthOrdinal(selectedStartMonth.value) +
    1;
  if (monthCount > 36) {
    selectedPeriod.value = [
      selectedStartMonth.value,
      dashboardMonthFromOrdinal(
        dashboardMonthOrdinal(selectedStartMonth.value) + 35,
      ),
    ];
    ElMessage.warning("统计范围最多支持连续 36 个月");
  }
  applyDashboardFilters();
}

function selectCurrentYearToDate() {
  selectedPeriod.value = [defaultStartMonth, defaultMonth];
  applyDashboardFilters();
}

function selectFullYear() {
  const year = selectedEndMonth.value.slice(0, 4);
  selectedPeriod.value = [`${year}-01`, `${year}-12`];
  applyDashboardFilters();
}

function resetDashboardFilters() {
  selectedPeriod.value = [defaultStartMonth, defaultMonth];
  selectedCategory.value = "";
  selectedProjectId.value = "";
  applyDashboardFilters();
}

let dashboardLoadSequence = 0;

async function loadDashboard() {
  const loadSequence = ++dashboardLoadSequence;
  const requestQuery = dashboardRequestQuery();
  loading.value = true;
  errorMessage.value = "";
  try {
    const nextDashboard = await getContractDashboard(requestQuery);
    if (loadSequence !== dashboardLoadSequence) return;
    dashboard.value = nextDashboard;
    liveStatus.value = "合同经营看板已更新";
  } catch (error) {
    if (loadSequence !== dashboardLoadSequence) return;
    errorMessage.value = getContractErrorMessage(error, "合同经营看板加载失败");
    liveStatus.value = errorMessage.value;
  } finally {
    if (loadSequence === dashboardLoadSequence) loading.value = false;
  }
}

async function loadMeta() {
  metaLoading.value = true;
  metaErrorMessage.value = "";
  try {
    meta.value = await getContractMeta();
  } catch (error) {
    metaErrorMessage.value = getContractErrorMessage(
      error,
      "项目筛选项加载失败",
    );
  } finally {
    metaLoading.value = false;
  }
}

watch(
  () => [
    queryText(route.query.startMonth),
    queryText(route.query.endMonth),
    queryText(route.query.category),
    queryText(route.query.projectId),
  ],
  () => {
    const query = normalizedDashboardRouteQuery();
    selectedPeriod.value = [query.startMonth, query.endMonth];
    selectedCategory.value = query.category;
    selectedProjectId.value = query.projectId;
    if (!dashboardRouteMatches(query)) {
      replaceDashboardQuery(query);
      return;
    }
    dashboard.value = null;
    void loadDashboard();
  },
  { immediate: true },
);

onMounted(loadMeta);
</script>

<style scoped>
.contract-dashboard-page {
  min-height: calc(100vh - 60px);
  margin: -24px -45px;
  padding: 24px 32px 48px;
  background:
    radial-gradient(circle at 8% 2%, rgb(49 132 139 / 10%), transparent 25%),
    #0f2638;
  color: #e9f4f5;
}
.dashboard-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 25px 28px;
  border: 1px solid rgb(135 193 199 / 18%);
  border-radius: 18px;
  background:
    radial-gradient(circle at 92% 0, rgb(61 213 185 / 18%), transparent 34%),
    linear-gradient(135deg, #17364c, #112b40);
  box-shadow: 0 18px 42px rgb(0 10 20 / 22%);
}
.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #79d9c9;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.hero-kicker i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5de0c5;
  box-shadow: 0 0 0 5px rgb(93 224 197 / 12%);
}
.hero-copy h1 {
  margin: 5px 0;
  color: #fff;
  font-size: 31px;
}
.hero-copy p {
  margin: 0;
  color: #9bb1bf;
}
.hero-tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.hero-tools :deep(.el-input__wrapper),
.hero-tools :deep(.el-button) {
  min-height: 38px;
  border-color: rgb(171 211 215 / 22%);
  border-radius: 9px;
  background: rgb(255 255 255 / 8%);
  color: #e9f4f5;
  box-shadow: none;
}
.dashboard-filter-panel {
  margin-top: 16px;
  padding: 15px 18px;
  border: 1px solid rgb(133 187 193 / 16%);
  border-radius: 13px;
  background: rgb(22 51 70 / 92%);
}
.filter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 11px;
}
.filter-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.filter-heading strong {
  color: #edf8f8;
}
.filter-heading small {
  color: #819aa8;
  font-size: 11px;
}
.filter-heading > span {
  color: #e7a96c;
  font-size: 11px;
}
.dashboard-filters {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 3px;
}
.dashboard-filters :deep(.el-date-editor) {
  flex: 0 0 300px;
}
.dashboard-filters :deep(.el-select) {
  flex: 0 0 240px;
}
.dashboard-filters :deep(.el-button) {
  flex: 0 0 180px;
  margin-left: 0;
}
.dashboard-filters :deep(.el-input__wrapper),
.dashboard-filters :deep(.el-select__wrapper),
.dashboard-filters :deep(.el-button) {
  min-height: 38px;
  border-color: rgb(171 211 215 / 18%);
  border-radius: 9px;
  background: rgb(255 255 255 / 7%);
  color: #dcebed;
  box-shadow: none;
}
.dashboard-alert {
  margin-top: 14px;
  border-radius: 10px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.metric-section {
  margin-top: 16px;
}
.metric-section-heading {
  margin-bottom: 10px;
}
.metric-section .metric-grid {
  margin-top: 0;
}
.snapshot-metric-grid,
.period-metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.metric-section-total {
  display: grid;
  justify-items: end;
  gap: 2px;
}
.metric-section-total span {
  color: #819aa8;
  font-size: 11px;
}
.metric-section-total strong {
  color: #4fc7b6;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.category-section,
.accounting-section,
.settlement-section,
.comparison-section,
.analysis-card,
.ranking-section {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid rgb(133 187 193 / 16%);
  border-radius: 13px;
  background: rgb(22 51 70 / 92%);
  box-shadow: 0 12px 32px rgb(0 11 21 / 14%);
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 15px;
}
.section-heading > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.section-heading h2 {
  margin: 0;
  color: #edf8f8;
  font-size: 18px;
}
.section-heading span,
.section-heading small {
  color: #819aa8;
  font-size: 11px;
}
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.category-card {
  position: relative;
  padding: 17px;
  overflow: hidden;
  border: 1px solid rgb(137 192 196 / 15%);
  border-radius: 12px;
  background: linear-gradient(
    145deg,
    rgb(255 255 255 / 7%),
    rgb(255 255 255 / 3%)
  );
}
.category-card::after {
  position: absolute;
  right: -28px;
  bottom: -36px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgb(82 212 190 / 6%);
  content: "";
}
.category-title {
  display: flex;
  align-items: center;
  gap: 11px;
}
.category-title > span {
  display: inline-flex;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: rgb(75 199 182 / 12%);
  color: #72d1c2;
  font-size: 20px;
}
.category-title > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.category-title strong {
  color: #e9f4f4;
}
.category-title small {
  color: #8198a6;
}
.category-total {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 17px 0 12px;
}
.category-total small {
  color: #8198a6;
  font-size: 10px;
}
.category-total b {
  color: #dff8f4;
  font-size: 24px;
}
.category-metrics {
  display: grid;
  gap: 7px;
  margin-bottom: 12px;
}
.category-metrics > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  color: #8198a6;
  font-size: 11px;
}
.category-metrics strong {
  color: #dcebed;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.share-track {
  height: 6px;
  overflow: hidden;
  border-radius: 10px;
  background: rgb(255 255 255 / 8%);
}
.share-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2e9c98, #67d7c5);
}
.category-card > p {
  display: flex;
  justify-content: space-between;
  margin: 7px 0 0;
  color: #8198a6;
  font-size: 11px;
}
.category-card > p strong {
  color: #8edbce;
}
.category-card > p.category-card-note {
  gap: 8px;
  color: #718b98;
}
.category-card > p.category-card-note span:last-child {
  text-align: right;
}
.accounting-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}
.accounting-card,
.period-rate-panel {
  min-width: 0;
  padding: 15px;
  border: 1px solid rgb(151 194 197 / 13%);
  border-radius: 11px;
  background: rgb(255 255 255 / 4%);
}
.accounting-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.accounting-card-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.accounting-card-heading strong {
  color: #dcebed;
}
.accounting-card-heading small {
  color: #8098a5;
  font-size: 10px;
}
.accounting-lines {
  display: grid;
  gap: 2px;
  margin-top: 12px;
}
.accounting-lines > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px dashed rgb(151 194 197 / 13%);
  color: #829aa7;
  font-size: 12px;
}
.accounting-lines strong {
  color: #dcebed;
  font-variant-numeric: tabular-nums;
}
.accounting-lines strong.unavailable {
  color: #667e8b;
}
.accounting-lines .emphasized {
  margin-top: 3px;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: rgb(75 199 182 / 9%);
}
.accounting-lines .emphasized strong {
  color: #72d1c2;
  font-size: 15px;
}
.period-rate-panel {
  margin-top: 12px;
}
.period-rate-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
  margin-top: 12px;
}
.period-rate-grid > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgb(255 255 255 / 4%);
}
.period-rate-grid span {
  color: #8198a6;
  font-size: 11px;
}
.period-rate-grid strong {
  color: #72d1c2;
  font-variant-numeric: tabular-nums;
}
.settlement-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.settlement-card {
  display: grid;
  gap: 14px;
  padding: 15px;
  border: 1px solid rgb(151 194 197 / 15%);
  border-radius: 11px;
  background: rgb(255 255 255 / 4%);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.settlement-card:hover,
.settlement-card:focus-visible {
  border-color: rgb(93 204 188 / 45%);
  outline: none;
  background: rgb(255 255 255 / 6%);
}
.settlement-card.partial {
  border-color: rgb(226 166 94 / 23%);
}
.settlement-card.settled {
  border-color: rgb(93 204 188 / 25%);
}
.settlement-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.settlement-card-heading > span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.settlement-card-heading strong {
  color: #e1f0f1;
}
.settlement-card-heading small {
  color: #8198a6;
  font-size: 10px;
}
.settlement-card-heading > .el-icon {
  color: #72d1c2;
}
.settlement-card-metrics {
  display: grid;
  gap: 7px;
}
.settlement-card-metrics > span {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.settlement-card-metrics small {
  color: #8198a6;
  font-size: 10px;
}
.settlement-card-metrics strong {
  color: #dcebed;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.no-fixed-amount-note {
  margin: 12px 0 0;
  padding: 9px 11px;
  border-radius: 8px;
  background: rgb(226 166 94 / 8%);
  color: #b6a185;
  font-size: 11px;
}
.comparison-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(310px, 0.6fr);
  gap: 16px;
}
.comparison-chart {
  display: grid;
  min-height: 250px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.comparison-column {
  display: grid;
  min-width: 0;
  grid-template-rows: auto minmax(130px, 1fr) auto;
  gap: 9px;
  padding: 13px;
  border: 1px solid rgb(151 194 197 / 13%);
  border-radius: 10px;
  background: rgb(255 255 255 / 3%);
}
.comparison-period {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.comparison-period strong {
  color: #dcebed;
  font-size: 12px;
}
.comparison-period small {
  color: #8198a6;
  font-size: 10px;
}
.comparison-column .bar {
  width: min(28px, 38%);
}
.comparison-values {
  display: grid;
  gap: 3px;
  color: #93aab5;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.comparison-change-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  align-content: start;
}
.comparison-change-grid article {
  display: flex;
  min-height: 92px;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 13px;
  border: 1px solid rgb(151 194 197 / 13%);
  border-radius: 10px;
  background: rgb(255 255 255 / 4%);
}
.comparison-change-grid span {
  color: #8198a6;
  font-size: 10px;
}
.comparison-change-grid strong {
  color: #dcebed;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.comparison-change-grid small {
  color: #72d1c2;
  font-size: 11px;
}
.analysis-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.65fr);
  gap: 16px;
}
.analysis-card {
  min-width: 0;
}
.legend {
  display: flex;
  flex-direction: row !important;
  gap: 12px !important;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.legend .income {
  background: #4bc5b4;
}
.legend .expense {
  background: #e3a45e;
}
.trend-chart {
  display: grid;
  height: 245px;
  grid-template-columns: repeat(12, minmax(28px, 1fr));
  align-items: end;
  gap: 7px;
  padding-top: 8px;
  border-bottom: 1px solid rgb(160 201 204 / 14%);
}
.trend-column {
  display: grid;
  height: 100%;
  grid-template-rows: minmax(0, 1fr) 25px;
  align-items: end;
  gap: 7px;
}
.bars {
  display: flex;
  height: 100%;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
}
.bar {
  width: min(12px, 42%);
  min-height: 3px;
  border-radius: 4px 4px 1px 1px;
  transition: height 220ms ease;
}
.bar.income {
  background: linear-gradient(180deg, #63dbc7, #268f91);
}
.bar.expense {
  background: linear-gradient(180deg, #f2bd7b, #b87545);
}
.trend-column small {
  color: #78919f;
  font-size: 10px;
  text-align: center;
}
.risk-list {
  display: grid;
  gap: 8px;
}
.risk-list button {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(151 194 197 / 13%);
  border-radius: 10px;
  background: rgb(255 255 255 / 4%);
  color: #8198a6;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.risk-list button:hover,
.risk-list button:focus-visible {
  border-color: rgb(93 204 188 / 45%);
  outline: none;
  background: rgb(255 255 255 / 6%);
}
.risk-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #58b6ac;
}
.risk-dot.high {
  background: #e16e6e;
  box-shadow: 0 0 0 4px rgb(225 110 110 / 11%);
}
.risk-dot.medium {
  background: #e2a65e;
  box-shadow: 0 0 0 4px rgb(226 166 94 / 11%);
}
.risk-list button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.risk-list strong {
  overflow: hidden;
  color: #dcebed;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.risk-list small {
  overflow: hidden;
  color: #8098a5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.risk-empty {
  display: flex;
  min-height: 190px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #77929f;
  text-align: center;
}
.risk-empty > span {
  display: inline-flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgb(77 200 174 / 10%);
  color: #5fcab7;
  font-size: 26px;
}
.risk-empty strong {
  color: #d8e9e8;
}
.risk-empty small {
  font-size: 11px;
}
.ranking-list {
  display: grid;
  gap: 8px;
  overflow-x: auto;
}
.ranking-list button {
  display: grid;
  min-width: 980px;
  grid-template-columns:
    42px minmax(160px, 1.25fr) repeat(5, minmax(95px, 0.72fr))
    auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgb(151 194 197 / 13%);
  border-radius: 10px;
  background: rgb(255 255 255 / 4%);
  color: #8198a6;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.ranking-list button:hover,
.ranking-list button:focus-visible {
  border-color: rgb(93 204 188 / 45%);
  outline: none;
  background: rgb(255 255 255 / 6%);
}
.ranking-index {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: rgb(75 199 182 / 11%);
  color: #72d1c2;
  font-weight: 750;
}
.ranking-name,
.ranking-list button > span:not(.ranking-index) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.ranking-list strong {
  overflow: hidden;
  color: #dcebed;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ranking-list small {
  overflow: hidden;
  color: #8098a5;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 浅色经营看板：保留青绿数据强调，减少大面积深色背景带来的视觉压力。 */
.contract-dashboard-page {
  background:
    radial-gradient(circle at 8% 2%, rgb(74 180 165 / 10%), transparent 25%),
    #f3f6f8;
  color: #294354;
}
.dashboard-hero {
  border-color: #d8e7e8;
  background:
    radial-gradient(circle at 92% 0, rgb(90 205 184 / 16%), transparent 34%),
    linear-gradient(135deg, #fff, #f1f8f8);
  box-shadow: 0 12px 32px rgb(40 75 91 / 8%);
}
.hero-kicker {
  color: #25877e;
}
.hero-copy h1 {
  color: #203d50;
}
.hero-copy p {
  color: #718691;
}
.hero-tools :deep(.el-input__wrapper),
.hero-tools :deep(.el-button),
.dashboard-filters :deep(.el-input__wrapper),
.dashboard-filters :deep(.el-select__wrapper),
.dashboard-filters :deep(.el-button) {
  border-color: #d9e5e8;
  background: #fff;
  color: #365363;
  box-shadow: 0 2px 8px rgb(41 76 92 / 5%);
}
.hero-tools :deep(.el-input__inner),
.dashboard-filters :deep(.el-input__inner),
.dashboard-filters :deep(.el-select__selected-item),
.dashboard-filters :deep(.el-select__placeholder) {
  color: #365363;
}
.dashboard-filter-panel,
.category-section,
.accounting-section,
.settlement-section,
.comparison-section,
.analysis-card,
.ranking-section {
  border-color: #dce7ea;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 9px 26px rgb(41 74 90 / 6%);
}
.filter-heading strong,
.section-heading h2 {
  color: #284657;
}
.filter-heading small,
.section-heading span,
.section-heading small {
  color: #788c97;
}
.metric-section-total strong {
  color: #16736f;
}
.filter-heading > span {
  color: #b77835;
}
.category-card,
.accounting-card,
.period-rate-panel,
.settlement-card,
.comparison-column,
.comparison-change-grid article,
.risk-list button,
.ranking-list button {
  border-color: #dde8eb;
  background: #f8fafb;
}
.category-card::after {
  background: rgb(75 199 182 / 9%);
}
.category-title > span,
.ranking-index {
  background: #e7f5f2;
  color: #258d83;
}
.category-title strong,
.accounting-card-heading strong,
.settlement-card-heading strong,
.comparison-period strong,
.comparison-change-grid strong,
.risk-list strong,
.ranking-list strong,
.risk-empty strong {
  color: #294858;
}
.category-title small,
.category-total small,
.category-metrics > div,
.category-card > p,
.accounting-card-heading small,
.accounting-lines > div,
.period-rate-grid span,
.settlement-card-heading small,
.settlement-card-metrics small,
.comparison-period small,
.comparison-change-grid span,
.risk-list button,
.risk-list small,
.risk-empty,
.ranking-list button,
.ranking-list small {
  color: #748995;
}
.category-total b {
  color: #174d55;
}
.category-metrics strong,
.accounting-lines strong,
.settlement-card-metrics strong,
.comparison-change-grid strong {
  color: #315261;
}
.share-track,
.period-rate-grid > div {
  background: #e9eff1;
}
.category-card > p strong,
.accounting-lines .emphasized strong,
.period-rate-grid strong,
.settlement-card-heading > .el-icon,
.comparison-change-grid small {
  color: #218b80;
}
.accounting-lines > div {
  border-bottom-color: #e0e8eb;
}
.accounting-lines .emphasized,
.settlement-card.settled,
.risk-empty > span {
  background: #edf8f5;
}
.settlement-card.partial,
.no-fixed-amount-note {
  border-color: #eed8b9;
  background: #fff8ef;
}
.settlement-card:hover,
.settlement-card:focus-visible,
.risk-list button:hover,
.risk-list button:focus-visible,
.ranking-list button:hover,
.ranking-list button:focus-visible {
  border-color: #8dcac1;
  background: #f1f8f7;
}
.comparison-values,
.trend-column small {
  color: #667f8d;
}
.trend-chart {
  border-bottom-color: #dbe5e8;
}
.contract-rate-dialog {
  overflow: hidden;
  border: 1px solid #dce6e8;
  border-radius: 18px;
  background: #f7fafb;
  box-shadow: 0 24px 70px rgb(1 25 41 / 35%);
}
.contract-rate-dialog :deep(.el-dialog__header) {
  margin: 0;
  padding: 19px 24px;
  border-bottom: 1px solid #e3ebed;
  background: linear-gradient(120deg, #eef8f7, #f8fbfc);
}
.contract-rate-dialog :deep(.el-dialog__body) {
  padding: 20px 24px 6px;
  color: #203643;
}
.contract-rate-dialog :deep(.el-dialog__footer) {
  padding: 15px 24px 19px;
  border-top: 1px solid #e5edef;
  background: #fbfcfd;
}
.rate-dialog-title {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 28px;
}
.rate-dialog-title > span {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(145deg, #176f70, #2c9991);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 8px 18px rgb(23 111 112 / 20%);
}
.rate-dialog-title > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.rate-dialog-title strong {
  color: #163343;
  font-size: 18px;
}
.rate-dialog-title small {
  color: #6b808a;
  font-size: 12px;
}
.rate-dialog-body {
  display: grid;
  gap: 16px;
  min-height: 240px;
}
.rate-current-section,
.rate-editor-section,
.rate-history-section {
  padding: 16px;
  border: 1px solid #e1e9eb;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 5px 16px rgb(18 59 72 / 4%);
}
.rate-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 13px;
}
.rate-section-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rate-section-heading strong {
  color: #1d3b49;
  font-size: 15px;
}
.rate-section-heading small,
.rate-section-heading > span {
  color: #7b8e97;
  font-size: 11px;
}
.rate-current-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}
.rate-current-grid article {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border: 1px solid #e5eded;
  border-radius: 10px;
  background: linear-gradient(145deg, #f7fbfb, #f2f7f8);
}
.rate-current-grid span {
  color: #607985;
  font-size: 12px;
}
.rate-current-grid strong {
  color: #16736f;
  font-size: 21px;
  font-variant-numeric: tabular-nums;
}
.rate-current-grid small {
  overflow: hidden;
  color: #8a9ba2;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rate-form-grid {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(280px, 1.3fr);
  gap: 12px;
}
.rate-input-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.rate-input-grid :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 0;
}
.rate-input-grid :deep(.el-form-item__content) {
  flex-wrap: nowrap;
}
.rate-input-grid :deep(.el-input-number) {
  width: 100%;
}
.rate-percent-suffix {
  margin-left: 5px;
  color: #58717d;
  font-weight: 700;
}
.rate-history-section :deep(.el-table) {
  --el-table-border-color: #e5ecee;
  --el-table-header-bg-color: #f3f7f8;
  border-radius: 9px;
  color: #314955;
}
.rate-history-section :deep(.el-table th.el-table__cell) {
  color: #617985;
  font-size: 12px;
  font-weight: 700;
}
.rate-history-section :deep(.el-table strong) {
  color: #16736f;
  font-variant-numeric: tabular-nums;
}
.sr-live,
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 1200px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .accounting-grid,
  .analysis-grid,
  .comparison-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 900px) {
  .dashboard-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .hero-tools {
    width: 100%;
    justify-content: flex-start;
  }
  .category-grid {
    grid-template-columns: 1fr;
  }
  .settlement-grid {
    grid-template-columns: 1fr;
  }
  .trend-chart {
    overflow-x: auto;
    grid-template-columns: repeat(12, minmax(42px, 1fr));
  }
  .period-rate-grid,
  .rate-current-grid,
  .rate-input-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 768px) {
  .contract-dashboard-page {
    margin: -16px -20px;
    padding: 14px;
  }
  .metric-grid {
    grid-template-columns: 1fr;
  }
  .comparison-chart,
  .comparison-change-grid {
    grid-template-columns: 1fr;
  }
  .dashboard-hero {
    padding: 20px;
  }
  .filter-heading,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .contract-rate-dialog :deep(.el-dialog__header),
  .contract-rate-dialog :deep(.el-dialog__body),
  .contract-rate-dialog :deep(.el-dialog__footer) {
    padding-right: 14px;
    padding-left: 14px;
  }
  .period-rate-grid,
  .rate-form-grid,
  .rate-current-grid,
  .rate-input-grid {
    grid-template-columns: 1fr;
  }
  .rate-dialog-title small {
    white-space: normal;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bar {
    transition: none;
  }
}
</style>
