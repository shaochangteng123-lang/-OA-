<template>
  <div
    class="leave-pending-list"
    :class="{ 'has-inline-search': canViewEmployeeStatistics && activeTab !== 'statistics' }"
  >
    <div
      class="leave-toolbar"
      :class="{
        'is-statistics': activeTab === 'statistics',
        'is-compact': canViewEmployeeStatistics && activeTab !== 'statistics',
      }"
    >
      <div
        v-if="activeTab === 'statistics' || !canViewEmployeeStatistics"
        class="toolbar-heading"
      >
        <template v-if="activeTab === 'statistics'">
          <div class="statistics-heading-line">
            <span class="section-title">{{ statisticsYear }} 年员工请假统计</span>
          </div>
          <div
            class="statistics-toolbar-summary"
            aria-label="年度请假统计摘要"
            :aria-busy="statisticsLoading"
          >
            <span v-if="statisticsLoading" class="section-subtitle">正在加载统计…</span>
            <span v-else-if="statisticsError" class="section-subtitle">统计数据加载失败，请重新加载</span>
            <template v-else-if="statisticsLoaded">
              <span class="statistics-inline-metric">
                统计员工 <strong>{{ statisticsSummary.employeeCount }}</strong> 人
              </span>
              <el-tooltip :content="requestCountComparisonLabel" placement="top">
                <span class="statistics-inline-metric" :title="requestCountComparisonLabel">
                  已批准申请 <strong>{{ statisticsSummary.approvedRequestCount }}</strong> 次
                </span>
              </el-tooltip>
              <el-tooltip :content="leaveDaysComparisonLabel" placement="top">
                <span class="statistics-inline-metric" :title="leaveDaysComparisonLabel">
                  已批准总天数 <strong>{{ formatStatisticsDays(statisticsSummary.approvedLeaveDays) }}</strong> 天
                </span>
              </el-tooltip>
            </template>
          </div>
        </template>
        <template v-else>
          <span class="section-title">请假审批</span>
          <span class="section-subtitle">{{ toolbarSubtitle }}</span>
        </template>
      </div>
      <div class="toolbar-actions">
        <el-input
          v-if="activeTab === 'pending'"
          v-model="pendingKeyword"
          class="keyword-input"
          clearable
          :prefix-icon="Search"
          aria-label="搜索待审批申请"
          placeholder="搜索员工 / 部门 / 事由"
        />
        <el-input
          v-else-if="activeTab === 'history'"
          v-model="historyKeyword"
          class="keyword-input"
          clearable
          :maxlength="200"
          :prefix-icon="Search"
          aria-label="搜索审批记录"
          placeholder="搜索员工 / 部门 / 事由 / 编号"
          @keydown.enter.prevent="searchHistory"
        />
        <template v-else-if="activeTab === 'statistics'">
          <el-select
            v-model="statisticsYear"
            class="statistics-year-select"
            aria-label="统计年度"
            @change="handleStatisticsYearChange"
          >
            <el-option
              v-for="year in statisticsYearOptions"
              :key="year"
              :label="`${year} 年`"
              :value="year"
            />
          </el-select>
          <el-select
            v-model="statisticsDepartment"
            class="statistics-department-select"
            clearable
            aria-label="部门筛选"
            placeholder="全部部门"
          >
            <el-option
              v-for="department in statisticsDepartmentOptions"
              :key="department"
              :label="department"
              :value="department"
            />
          </el-select>
          <el-input
            v-model="statisticsKeyword"
            class="keyword-input statistics-keyword-input"
            clearable
            :prefix-icon="Search"
            placeholder="搜索员工 / 部门"
          />
        </template>
        <el-tooltip content="刷新" placement="top">
          <el-button
            size="small"
            circle
            aria-label="刷新当前列表"
            :loading="currentLoading"
            @click="refreshCurrent"
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div
      v-if="!canViewEmployeeStatistics && activeTab !== 'statistics'"
      class="leave-metrics"
    >
      <div class="metric-item">
        <span>待审批</span>
        <strong>{{ list.length }}</strong>
      </div>
      <div class="metric-item">
        <span>涉及部门</span>
        <strong>{{ pendingDepartmentCount }}</strong>
      </div>
      <div class="metric-item">
        <span>超过 1 天</span>
        <strong>{{ overduePendingCount }}</strong>
      </div>
    </div>

    <el-tabs
      v-model="activeTab"
      class="approval-tabs"
      @tab-change="handleTabChange"
    >
      <el-tab-pane name="pending">
        <template #label>
          <span class="tab-label">
            待我审批
            <em v-if="list.length > 0">{{ list.length }}</em>
          </span>
        </template>
        <el-table
          v-loading="loading"
          :data="filteredPendingList"
          stripe
          size="small"
          table-layout="fixed"
          class="approval-table"
          empty-text="暂无待审批申请"
        >
          <el-table-column
            type="index"
            label="序号"
            width="52"
            align="center"
          />
          <el-table-column label="申请人" min-width="118" align="center">
            <template #default="{ row }">
              <div class="person-cell">
                <el-avatar :size="30">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <span>
                  <strong>{{ row.applicant_name }}</strong>
                  <small>{{
                    row.applicant_department || row.user_department || "-"
                  }}</small>
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="假期类型"
            prop="leave_type_name"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <div class="leave-type-cell">
                <el-tag size="small" effect="plain">{{
                  row.leave_type_name
                }}</el-tag>
                <span v-if="row.application_kind !== 'normal'">
                  {{ applicationKindLabel(row) }}
                </span>
                <el-tooltip
                  v-if="row.parent_leave_type_name"
                  :content="formatParentLeaveSummary(row)"
                  placement="top"
                >
                  <span class="parent-leave-summary">
                    原{{ row.parent_leave_type_name }}
                    {{ row.parent_total_days }}天
                  </span>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="时间段" min-width="168" align="center">
            <template #default="{ row }">
              <span class="period-cell">{{ formatLeavePeriod(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="天数"
            prop="total_days"
            width="60"
            align="center"
          >
            <template #default="{ row }">
              <span class="days-pill">{{ row.total_days }}天</span>
            </template>
          </el-table-column>
          <el-table-column label="已等候" width="68" align="center">
            <template #default="{ row }">
              <span
                :class="['waiting-days', { urgent: isOverduePending(row) }]"
              >
                {{ pendingAgeLabel(row.submitted_at) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="请假事由" prop="reason" min-width="112">
            <template #default="{ row }">
              <span class="wrapped-text">{{ row.reason || "-" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="166" align="center">
            <template #default="{ row }">
              <span class="approval-time">
                {{ formatBeijingDateTime(row.submitted_at) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="188" align="center">
            <template #default="{ row }">
              <div class="approval-actions">
                <el-button
                  size="small"
                  type="success"
                  plain
                  :icon="Check"
                  @click="handleApprove(row)"
                >
                  通过
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  :icon="Close"
                  @click="handleReject(row)"
                >
                  驳回
                </el-button>
                <el-button
                  link
                  size="small"
                  type="primary"
                  :icon="View"
                  @click="handleView(row)"
                  >详情</el-button
                >
              </div>
            </template>
          </el-table-column>
          <template #empty>
            <div class="table-empty">
              <el-empty description="暂无待审批申请" :image-size="72" />
            </div>
          </template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane name="history">
        <template #label>
          <span class="tab-label">审批记录</span>
        </template>
        <el-table
          v-loading="historyLoading"
          :data="historyList"
          stripe
          size="small"
          table-layout="fixed"
          class="approval-table"
          :empty-text="historyEmptyDescription"
        >
          <el-table-column
            type="index"
            label="序号"
            width="52"
            align="center"
            :index="historyRowIndex"
          />
          <el-table-column label="申请人" min-width="110" align="center">
            <template #default="{ row }">
              <div class="person-cell">
                <el-avatar :size="30">
                  <el-icon><User /></el-icon>
                </el-avatar>
                <span>
                  <strong>{{ row.applicant_name }}</strong>
                  <small>{{
                    row.applicant_department || row.user_department || "-"
                  }}</small>
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="假期类型"
            prop="leave_type_name"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <div class="leave-type-cell">
                <el-tag size="small" effect="plain">{{
                  row.leave_type_name
                }}</el-tag>
                <span v-if="row.application_kind !== 'normal'">
                  {{ applicationKindLabel(row) }}
                </span>
                <el-tooltip
                  v-if="row.parent_leave_type_name"
                  :content="formatParentLeaveSummary(row)"
                  placement="top"
                >
                  <span class="parent-leave-summary">
                    原{{ row.parent_leave_type_name }}
                    {{ row.parent_total_days }}天
                  </span>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="时间段" min-width="160" align="center">
            <template #default="{ row }">
              <span class="period-cell">{{ formatLeavePeriod(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="天数"
            prop="total_days"
            width="58"
            align="center"
          >
            <template #default="{ row }">
              <span class="days-pill">{{ row.total_days }}天</span>
            </template>
          </el-table-column>
          <el-table-column label="剩余天数" width="72" align="center">
            <template #default="{ row }">
              <span
                :class="[
                  'remaining-days',
                  `is-${row.leave_timing_status || 'not_applicable'}`,
                ]"
              >
                {{ remainingDaysLabel(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="返岗时间" width="100" align="center">
            <template #default="{ row }">{{ returnToWorkLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="70" align="center">
            <template #default="{ row }">
              <el-tag
                :type="reviewActionTagType(row.review_action)"
                size="small"
              >
                {{ reviewActionLabel(row.review_action) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审批意见" min-width="104">
            <template #default="{ row }">
              <span class="wrapped-text">{{ row.review_comment || "-" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="审批时间" width="166" align="center">
            <template #default="{ row }">
              <span class="approval-time">
                {{ formatBeijingDateTime(row.reviewed_at) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="68" align="center">
            <template #default="{ row }">
              <el-button
                link
                size="small"
                type="primary"
                :icon="View"
                @click="handleView(row)"
                >详情</el-button
              >
            </template>
          </el-table-column>
          <template #empty>
            <div class="table-empty">
              <el-empty :description="historyEmptyDescription" :image-size="72" />
            </div>
          </template>
        </el-table>

        <div v-if="historyTotal > historyPageSize" class="history-pagination">
          <el-pagination
            v-model:current-page="historyPage"
            :page-size="historyPageSize"
            :total="historyTotal"
            small
            layout="prev, pager, next"
            @current-change="fetchHistory"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewEmployeeStatistics" name="statistics">
        <template #label>
          <span class="tab-label">员工请假统计</span>
        </template>

        <section
          v-loading="statisticsLoading"
          class="statistics-panel"
          aria-label="员工请假年度统计"
        >
          <div class="statistics-content">
            <el-alert
              v-if="statisticsError"
              class="statistics-error"
              type="error"
              :closable="false"
              show-icon
              title="员工请假统计加载失败"
            >
              <template #default>
                <span>{{ statisticsError }}</span>
                <el-button link type="primary" @click="fetchStatistics">
                  重新加载
                </el-button>
              </template>
            </el-alert>

            <template v-else>
              <div class="statistics-dashboard">
                <article class="statistics-chart-card annual-trend-card">
                  <header class="statistics-chart-header">
                    <div>
                      <span class="chart-kicker">请假趋势</span>
                      <h3>{{ trendChartTitle }}</h3>
                      <p>{{ trendChartDescription }}</p>
                    </div>
                    <div class="trend-chart-controls">
                      <div
                        class="trend-mode-switch"
                        role="group"
                        aria-label="趋势统计维度"
                      >
                        <button
                          type="button"
                          :class="{
                            'is-active': statisticsTrendMode === 'annual',
                          }"
                          :aria-pressed="statisticsTrendMode === 'annual'"
                          @click="setStatisticsTrendMode('annual')"
                        >
                          年度
                        </button>
                        <button
                          type="button"
                          :class="{
                            'is-active': statisticsTrendMode === 'monthly',
                          }"
                          :aria-pressed="statisticsTrendMode === 'monthly'"
                          @click="setStatisticsTrendMode('monthly')"
                        >
                          月度
                        </button>
                      </div>
                      <div
                        class="statistics-chart-legend"
                        aria-label="趋势图图例"
                      >
                        <span><i class="is-requests"></i>批准次数</span>
                        <span><i class="is-days"></i>请假天数</span>
                      </div>
                    </div>
                  </header>

                  <div
                    v-if="hasActiveTrendData"
                    :class="[
                      'annual-trend-chart',
                      { 'is-monthly': statisticsTrendMode === 'monthly' },
                    ]"
                  >
                    <svg
                      viewBox="0 0 1040 400"
                      role="group"
                      :aria-label="activeTrendAriaLabel"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <g class="trend-grid" aria-hidden="true">
                        <template
                          v-for="tick in activeTrendChart.ticks"
                          :key="tick.y"
                        >
                          <line
                            :x1="activeTrendChart.left"
                            :x2="activeTrendChart.right"
                            :y1="tick.y"
                            :y2="tick.y"
                          />
                          <text
                            :x="activeTrendChart.left - 12"
                            :y="tick.y + 4"
                            text-anchor="end"
                          >
                            {{ tick.requestLabel }}
                          </text>
                          <text
                            :x="activeTrendChart.right + 12"
                            :y="tick.y + 4"
                            text-anchor="start"
                          >
                            {{ tick.daysLabel }}
                          </text>
                        </template>
                      </g>
                      <g class="trend-axis-titles" aria-hidden="true">
                        <text :x="activeTrendChart.left - 46" y="24">次数</text>
                        <text
                          :x="activeTrendChart.right + 46"
                          y="24"
                          text-anchor="end"
                        >
                          天数
                        </text>
                      </g>
                      <g class="trend-years" aria-hidden="true">
                        <text
                          v-for="point in activeTrendChart.points"
                          :key="`period-${point.periodKey}`"
                          :x="point.x"
                          :y="activeTrendChart.bottom + 30"
                          text-anchor="middle"
                        >
                          {{ point.axisLabel }}
                        </text>
                      </g>
                      <polyline
                        class="trend-line is-requests"
                        :points="activeTrendChart.requestLine"
                        aria-hidden="true"
                      />
                      <polyline
                        class="trend-line is-days"
                        :points="activeTrendChart.daysLine"
                        aria-hidden="true"
                      />
                      <g
                        v-for="point in activeTrendChart.points"
                        :key="`point-${point.periodKey}`"
                        :class="[
                          'trend-point-group',
                          {
                            'is-selected': isTrendPointSelected(point),
                          },
                        ]"
                      >
                        <circle
                          class="trend-point-hit trend-point-action is-requests"
                          :cx="point.x"
                          :cy="point.requestY"
                          r="22"
                          role="button"
                          tabindex="0"
                          :aria-label="`${point.periodLabel}批准 ${point.approvedRequestCount} 次，查看员工请假明细`"
                          :aria-pressed="isTrendPointSelected(point)"
                          @click="openTrendPointDetail(point)"
                          @keydown.enter.prevent="openTrendPointDetail(point)"
                          @keydown.space.prevent="openTrendPointDetail(point)"
                        >
                          <title>
                            {{ point.periodLabel }}：已批准
                            {{ point.approvedRequestCount }}
                            次，点击查看员工明细
                          </title>
                        </circle>
                        <circle
                          class="trend-point is-requests"
                          :cx="point.x"
                          :cy="point.requestY"
                          r="4.5"
                          aria-hidden="true"
                        />
                        <circle
                          class="trend-point-hit trend-point-action is-days"
                          :cx="point.x"
                          :cy="point.daysY"
                          r="22"
                          role="button"
                          tabindex="0"
                          :aria-label="`${point.periodLabel}批准 ${formatStatisticsDays(point.approvedLeaveDays)} 天，查看员工请假明细`"
                          :aria-pressed="isTrendPointSelected(point)"
                          @click="openTrendPointDetail(point)"
                          @keydown.enter.prevent="openTrendPointDetail(point)"
                          @keydown.space.prevent="openTrendPointDetail(point)"
                        >
                          <title>
                            {{ point.periodLabel }}：已批准
                            {{ formatStatisticsDays(point.approvedLeaveDays) }}
                            天，点击查看员工明细
                          </title>
                        </circle>
                        <circle
                          class="trend-point is-days"
                          :cx="point.x"
                          :cy="point.daysY"
                          r="4.5"
                          aria-hidden="true"
                        />
                      </g>
                    </svg>
                  </div>
                  <div v-else class="statistics-chart-empty">
                    <span aria-hidden="true">⌁</span>
                    <strong>暂无可对比的趋势数据</strong>
                    <small>产生已批准请假记录后将自动生成趋势</small>
                  </div>

                  <section
                    v-if="annualTrendDetailYear !== null"
                    class="annual-trend-detail"
                    :aria-label="trendDetailTitle"
                    aria-live="polite"
                  >
                    <header class="annual-trend-detail-header">
                      <div>
                        <span class="chart-kicker">
                          {{ trendDetailMonth ? "月度明细" : "年度明细" }}
                        </span>
                        <h4>{{ trendDetailTitle }}</h4>
                        <p>{{ trendDetailFilterLabel }}</p>
                      </div>
                      <el-button
                        link
                        type="primary"
                        :icon="Close"
                        :aria-label="`关闭${trendDetailTitle}`"
                        @click="closeAnnualTrendDetail"
                      >
                        关闭
                      </el-button>
                    </header>

                    <div
                      v-if="annualTrendDetailLoading"
                      class="annual-trend-detail-loading"
                    >
                      <el-skeleton animated :rows="3" />
                      <span>正在加载 {{ annualTrendDetailYear }} 年明细…</span>
                    </div>

                    <el-alert
                      v-else-if="annualTrendDetailError"
                      class="annual-trend-detail-error"
                      type="error"
                      :closable="false"
                      show-icon
                      title="年度明细加载失败"
                    >
                      <template #default>
                        <span>{{ annualTrendDetailError }}</span>
                        <el-button
                          link
                          type="primary"
                          @click="retryAnnualTrendDetail"
                        >
                          重新加载
                        </el-button>
                      </template>
                    </el-alert>

                    <template v-else-if="annualTrendDetailData">
                      <div class="annual-trend-detail-summary">
                        <span>
                          <small>请假员工</small>
                          <strong>{{
                            annualTrendDetailSummary.employeeCount
                          }}</strong>
                          <em>人</em>
                        </span>
                        <span>
                          <small>请假申请</small>
                          <strong>{{
                            annualTrendDetailSummary.approvedRequestCount
                          }}</strong>
                          <em>次</em>
                        </span>
                        <span>
                          <small>请假合计</small>
                          <strong>{{
                            formatStatisticsDays(
                              annualTrendDetailSummary.approvedLeaveDays,
                            )
                          }}</strong>
                          <em>天</em>
                        </span>
                      </div>

                      <div
                        v-if="annualTrendDetailEmployees.length > 0"
                        class="annual-trend-employee-list"
                      >
                        <div class="annual-trend-column-head" aria-hidden="true">
                          <span>员工 / 部门</span>
                          <span>请假次数 / 天数</span>
                          <span>假期类型明细</span>
                        </div>
                        <article
                          v-for="employee in annualTrendDetailEmployees"
                          :key="employee.userId"
                          class="annual-trend-employee"
                        >
                          <div class="annual-trend-employee-person">
                            <strong>{{ employee.name }}</strong>
                            <small>
                              部门：{{ employee.department || "未设置" }}
                            </small>
                          </div>
                          <div class="annual-trend-employee-totals">
                            <span>
                              <small>请假次数</small>
                              <strong>{{
                                employee.approvedRequestCount
                              }} 次</strong>
                            </span>
                            <span>
                              <small>请假天数</small>
                              <strong>{{
                                formatStatisticsDays(employee.approvedLeaveDays)
                              }} 天</strong>
                            </span>
                          </div>
                          <ul
                            v-if="employee.typeSummaries.length > 0"
                            class="annual-trend-type-list"
                            aria-label="假期类型构成"
                          >
                            <li
                              v-for="type in employee.typeSummaries"
                              :key="type.leaveTypeCode"
                            >
                              <span>{{ type.leaveTypeName }}</span>
                              <strong>
                                {{ type.requestCount }} 次，共
                                {{ formatStatisticsDays(type.totalDays) }} 天
                              </strong>
                            </li>
                          </ul>
                          <span v-else class="annual-trend-no-types">
                            暂无假期类型构成
                          </span>
                        </article>
                      </div>
                      <el-empty
                        v-else
                        :description="annualTrendDetailEmptyDescription"
                        :image-size="62"
                      />
                    </template>
                  </section>
                </article>

                <article class="statistics-chart-card employee-ranking-card">
                  <header class="statistics-chart-header">
                    <div>
                      <span class="chart-kicker">员工对比</span>
                      <h3>请假次数 / 天数</h3>
                    </div>
                  </header>

                  <div
                    v-if="hasEmployeeRankingData"
                    class="employee-ranking-chart"
                  >
                    <div
                      v-for="employee in employeeRankingChartItems"
                      :key="employee.userId"
                      class="employee-ranking-row"
                    >
                      <div class="employee-rank-name">
                        <span>{{ employee.rank }}</span>
                        <span>
                          <strong>{{ employee.name }}</strong>
                          <small>{{
                            employee.department || "未设置部门"
                          }}</small>
                        </span>
                      </div>
                      <div class="employee-ranking-bars">
                        <div class="employee-bar-row">
                          <span>次数</span>
                          <div class="employee-bar-track">
                            <i
                              class="employee-bar is-requests"
                              :style="{ width: `${employee.requestPercent}%` }"
                            ></i>
                          </div>
                          <strong
                            >{{ employee.approvedRequestCount }} 次</strong
                          >
                        </div>
                        <div class="employee-bar-row">
                          <span>天数</span>
                          <div class="employee-bar-track">
                            <i
                              class="employee-bar is-days"
                              :style="{ width: `${employee.daysPercent}%` }"
                            ></i>
                          </div>
                          <strong>
                            {{
                              formatStatisticsDays(employee.approvedLeaveDays)
                            }}
                            天
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="statistics-chart-empty">
                    <span aria-hidden="true">⌁</span>
                    <strong>{{ statisticsEmptyDescription }}</strong>
                    <small>调整部门或姓名筛选条件后再试</small>
                  </div>
                </article>

                <article class="statistics-chart-card leave-type-card">
                  <header class="statistics-chart-header">
                    <div>
                      <span class="chart-kicker">假期构成</span>
                      <h3>假期类型分布</h3>
                      <p>按本年已批准请假天数统计</p>
                    </div>
                  </header>

                  <div
                    v-if="typeDistributionItems.length"
                    class="leave-type-layout"
                  >
                    <div class="leave-type-donut">
                      <svg
                        viewBox="0 0 220 220"
                        role="img"
                        :aria-label="typeDistributionAriaLabel"
                      >
                        <circle class="donut-track" cx="110" cy="110" r="72" />
                        <circle
                          v-for="item in typeDistributionItems"
                          :key="item.leaveTypeCode"
                          :class="[
                            'donut-segment',
                            `chart-tone-${item.colorIndex}`,
                          ]"
                          cx="110"
                          cy="110"
                          r="72"
                          :stroke-dasharray="item.strokeDasharray"
                          :stroke-dashoffset="item.strokeDashoffset"
                        >
                          <title>
                            {{ item.leaveTypeName }}：{{
                              formatStatisticsDays(item.totalDays)
                            }}
                            天，占比
                            {{ formatStatisticsPercent(item.percentage) }}
                          </title>
                        </circle>
                        <text
                          class="donut-center-label"
                          x="110"
                          y="104"
                          text-anchor="middle"
                        >
                          已批准总天数
                        </text>
                        <text
                          class="donut-center-value"
                          x="110"
                          y="130"
                          text-anchor="middle"
                        >
                          {{ formatStatisticsDays(typeDistributionTotalDays) }}
                          天
                        </text>
                      </svg>
                    </div>
                    <ul class="leave-type-legend" aria-label="假期类型分布明细">
                      <li
                        v-for="item in typeDistributionItems"
                        :key="`legend-${item.leaveTypeCode}`"
                      >
                        <i :class="`chart-tone-${item.colorIndex}`"></i>
                        <span>{{ item.leaveTypeName }}</span>
                        <strong
                          >{{ formatStatisticsDays(item.totalDays) }} 天</strong
                        >
                        <em>{{ formatStatisticsPercent(item.percentage) }}</em>
                      </li>
                    </ul>
                  </div>
                  <div v-else class="statistics-chart-empty">
                    <span aria-hidden="true">⌁</span>
                    <strong>暂无假期类型分布</strong>
                    <small>当前筛选范围内没有已批准记录</small>
                  </div>
                </article>
              </div>

              <p class="statistics-scope-note">
                统计口径：带薪额度、已用、待审和剩余按“需要余额检查”的假期类型合计；不限额度假期仍计入已批准次数和本年请假天数。组合请假按一次申请计数。
              </p>

              <section
                class="statistics-detail-table"
                aria-label="员工请假明细表"
              >
                <header class="statistics-section-heading">
                  <div>
                    <span class="chart-kicker">可展开明细</span>
                    <h3>员工年度统计明细</h3>
                  </div>
                  <span>点击员工所在行左侧箭头查看假期余额、类型汇总与每次申请</span>
                </header>

                <div class="statistics-table-scroll">
                  <el-table
                    :data="filteredStatisticsEmployees"
                    stripe
                    size="small"
                    table-layout="fixed"
                    class="statistics-table"
                    empty-text="暂无员工请假统计"
                  >
                    <el-table-column type="expand" width="46">
                      <template #default="{ row }">
                        <div class="statistics-detail">
                          <section class="balance-summary-section">
                            <h4>假期余额</h4>
                            <div
                              v-if="row.balanceSummaries?.length > 0"
                              class="balance-summary-list"
                            >
                              <article
                                v-for="balance in row.balanceSummaries"
                                :key="balance.leaveTypeCode"
                                :class="[
                                  'balance-summary-item',
                                  { 'is-unlimited': balance.unlimited },
                                ]"
                              >
                                <header>
                                  <strong>{{ balance.leaveTypeName }}</strong>
                                  <el-tag
                                    size="small"
                                    :type="
                                      balance.unlimited ? 'info' : 'success'
                                    "
                                    effect="plain"
                                  >
                                    {{
                                      balance.unlimited
                                        ? "不限额度"
                                        : "额度假期"
                                    }}
                                  </el-tag>
                                </header>
                                <div
                                  v-if="!balance.unlimited"
                                  class="balance-summary-metrics"
                                >
                                  <span>
                                    <small>总额</small>
                                    <strong>{{
                                      formatBalanceDays(balance.totalDays)
                                    }}</strong>
                                  </span>
                                  <span>
                                    <small>已用</small>
                                    <strong>{{
                                      formatBalanceDays(balance.usedDays)
                                    }}</strong>
                                  </span>
                                  <span>
                                    <small>待审</small>
                                    <strong>{{
                                      formatBalanceDays(balance.pendingDays)
                                    }}</strong>
                                  </span>
                                  <span>
                                    <small>剩余</small>
                                    <strong
                                      :class="{
                                        'is-low':
                                          balance.remainingDays !== null &&
                                          balance.remainingDays <= 1,
                                      }"
                                    >
                                      {{
                                        formatBalanceDays(balance.remainingDays)
                                      }}
                                    </strong>
                                  </span>
                                </div>
                                <p v-else>该假期不设可用天数上限</p>
                              </article>
                            </div>
                            <el-empty
                              v-else
                              description="暂无假期余额"
                              :image-size="54"
                            />
                          </section>

                          <section class="type-summary-section">
                            <h4>假期类型汇总</h4>
                            <div
                              v-if="row.typeSummaries.length > 0"
                              class="type-summary-list"
                            >
                              <div
                                v-for="item in row.typeSummaries"
                                :key="item.leaveTypeCode"
                                class="type-summary-item"
                              >
                                <span>{{ item.leaveTypeName }}</span>
                                <strong>{{ item.requestCount }} 次</strong>
                                <small>
                                  本年
                                  {{ formatStatisticsDays(item.totalDays) }} 天
                                </small>
                              </div>
                            </div>
                            <el-empty
                              v-else
                              description="暂无假期类型汇总"
                              :image-size="54"
                            />
                          </section>

                          <section class="request-detail-section">
                            <h4>每次请假明细</h4>
                            <div
                              v-if="row.requests.length > 0"
                              class="statistics-request-list"
                            >
                              <article
                                v-for="request in row.requests"
                                :key="request.id"
                                class="statistics-request-card"
                              >
                                <div class="statistics-request-heading">
                                  <span class="statistics-request-no">
                                    {{ request.requestNo }}
                                  </span>
                                  <el-tag
                                    v-if="
                                      statisticsApplicationKindLabel(request)
                                    "
                                    size="small"
                                    effect="plain"
                                  >
                                    {{
                                      statisticsApplicationKindLabel(request)
                                    }}
                                  </el-tag>
                                  <strong>
                                    本年计
                                    {{
                                      formatStatisticsDays(request.totalDays)
                                    }}
                                    天
                                  </strong>
                                </div>
                                <div class="statistics-request-meta">
                                  <span>{{
                                    formatStatisticsPeriod(request)
                                  }}</span>
                                  <span>
                                    批准时间：{{
                                      request.approvedAt
                                        ? formatBeijingDateTime(
                                            request.approvedAt,
                                          )
                                        : "-"
                                    }}
                                  </span>
                                </div>
                                <p>请假事由：{{ request.reason || "-" }}</p>
                                <div
                                  v-if="request.segments.length > 0"
                                  class="segment-list"
                                >
                                  <div
                                    v-for="segment in request.segments"
                                    :key="segment.id"
                                    class="segment-item"
                                  >
                                    <el-tag
                                      size="small"
                                      type="info"
                                      effect="plain"
                                    >
                                      {{ segment.leaveTypeName }}
                                    </el-tag>
                                    <span>{{
                                      formatStatisticsPeriod(segment)
                                    }}</span>
                                    <strong>
                                      本年计
                                      {{
                                        formatStatisticsDays(segment.totalDays)
                                      }}
                                      天
                                    </strong>
                                  </div>
                                </div>
                              </article>
                            </div>
                            <el-empty
                              v-else
                              description="暂无请假明细"
                              :image-size="54"
                            />
                          </section>
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column label="排名" width="68" align="center">
                      <template #default="{ row }">
                        <span class="rank-badge">
                          {{ row.rank }}
                        </span>
                      </template>
                    </el-table-column>
                    <el-table-column label="员工" min-width="132">
                      <template #default="{ row }">
                        <div class="statistics-person-cell">
                          <strong>{{ row.name }}</strong>
                          <small>{{ row.department || "未设置部门" }}</small>
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column
                      label="已批准次数"
                      width="92"
                      align="center"
                    >
                      <template #default="{ row }">
                        <strong class="frequency-value">
                          {{ row.approvedRequestCount }} 次
                        </strong>
                      </template>
                    </el-table-column>
                    <el-table-column
                      label="本年请假天数"
                      width="104"
                      align="center"
                    >
                      <template #default="{ row }">
                        {{ formatStatisticsDays(row.approvedLeaveDays) }} 天
                      </template>
                    </el-table-column>
                    <el-table-column label="带薪额度" width="84" align="center">
                      <template #default="{ row }">
                        {{ formatStatisticsDays(row.paidLeaveTotalDays) }} 天
                      </template>
                    </el-table-column>
                    <el-table-column label="已用" width="72" align="center">
                      <template #default="{ row }">
                        {{ formatStatisticsDays(row.paidLeaveUsedDays) }} 天
                      </template>
                    </el-table-column>
                    <el-table-column label="待审" width="72" align="center">
                      <template #default="{ row }">
                        {{ formatStatisticsDays(row.paidLeavePendingDays) }} 天
                      </template>
                    </el-table-column>
                    <el-table-column label="剩余" width="76" align="center">
                      <template #default="{ row }">
                        <span
                          :class="[
                            'paid-leave-remaining',
                            { 'is-low': row.paidLeaveRemainingDays <= 1 },
                          ]"
                        >
                          {{ formatStatisticsDays(row.paidLeaveRemainingDays) }}
                          天
                        </span>
                      </template>
                    </el-table-column>
                    <template #empty>
                      <div class="table-empty statistics-empty">
                        <el-empty
                          :description="statisticsEmptyDescription"
                          :image-size="72"
                        />
                      </div>
                    </template>
                  </el-table>
                </div>
              </section>
            </template>
          </div>
        </section>
      </el-tab-pane>
    </el-tabs>

    <!-- 驳回理由对话框 -->
    <el-dialog
      v-model="rejectDialogVisible"
      title="填写驳回理由"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-input
        v-model="rejectReason"
        type="textarea"
        :rows="4"
        placeholder="请填写驳回理由（必填）..."
        maxlength="500"
        show-word-limit
        autofocus
      />
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="actionLoading"
          :disabled="!rejectReason.trim()"
          @click="confirmReject"
        >
          确认驳回
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="
        detailRequest
          ? `${detailRequest.applicant_name} 的请假申请`
          : '请假申请详情'
      "
      size="min(560px, 92vw)"
      @closed="resetDetailNavigation"
    >
      <div
        v-if="detailRequest"
        v-loading="detailLoading"
        class="detail-drawer-content"
      >
        <div v-if="detailHistory.length > 0" class="detail-navigation">
          <el-button
            link
            type="primary"
            :icon="ArrowLeft"
            @click="handleDetailBack"
          >
            返回上一申请
          </el-button>
          <span>正在查看 {{ detailRequest.request_no }}</span>
        </div>
        <LeaveApprovalTimeline
          :request="detailRequest"
          :is-owner="false"
          @view-request="handleViewRelatedRequest"
        />
      </div>
      <el-skeleton v-else :rows="6" animated style="padding: 16px" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  Refresh,
  Check,
  Close,
  Search,
  User,
  View,
  ArrowLeft,
} from "@element-plus/icons-vue";
import { usePendingStore } from "@/stores/pending";
import { useAuthStore } from "@/stores/auth";
import { canAccessHRApprovalCenter } from "@/utils/hrApprovalPermissions";
import LeaveApprovalTimeline from "./LeaveApprovalTimeline.vue";
import { formatBeijingDateTime } from "@/utils/date";
import { getLeaveApplicationKindLabel as applicationKindLabel } from "@/utils/leaveApplication";
import {
  getPendingRequests,
  getReviewedRequests,
  getLeaveEmployeeStatistics,
  approveRequest,
  rejectRequest,
  getRequestDetail,
  type LeaveRequest,
  type LeaveRequestDetail,
  type LeaveReviewHistoryItem,
  type LeaveEmployeeStatisticsItem,
  type LeaveEmployeeStatisticsRequest,
  type LeaveEmployeeStatisticsSegment,
  type LeaveEmployeeStatisticsResponse,
  type LeaveEmployeeAnnualComparison,
  type LeaveEmployeeMonthlyComparison,
} from "@/utils/leaveApi";

type StatisticsTrendMode = "annual" | "monthly";

interface StatisticsTrendPeriod {
  periodKey: string;
  periodLabel: string;
  axisLabel: string;
  year: number;
  month: string | null;
  approvedRequestCount: number;
  approvedLeaveDays: number;
}

const emit = defineEmits<{
  (e: "approved"): void;
}>();

const pendingStore = usePendingStore();
const authStore = useAuthStore();
const activeTab = ref("pending");
const list = ref<LeaveRequest[]>([]);
const pendingKeyword = ref("");
const loading = ref(false);
const historyList = ref<LeaveReviewHistoryItem[]>([]);
const historyLoading = ref(false);
const historyLoaded = ref(false);
const historyPage = ref(1);
const historyPageSize = 10;
const historyTotal = ref(0);
const historyKeyword = ref("");
let historySearchTimer: ReturnType<typeof setTimeout> | undefined;
let historyRequestSequence = 0;
const historyEmptyDescription = computed(() =>
  historyKeyword.value.trim() ? "没有符合搜索条件的审批记录" : "暂无审批记录",
);
const actionLoading = ref(false);
const rejectDialogVisible = ref(false);
const rejectReason = ref("");
const currentRejectItem = ref<LeaveRequest | null>(null);
const drawerVisible = ref(false);
const detailRequest = ref<LeaveRequestDetail | null>(null);
const detailHistory = ref<LeaveRequestDetail[]>([]);
const detailLoading = ref(false);
const currentYear = new Date().getFullYear();
const statisticsYear = ref(currentYear);
const statisticsYearOptions = Array.from(
  { length: 6 },
  (_, index) => currentYear - index,
);
const statisticsKeyword = ref("");
const statisticsDepartment = ref("");
const statisticsData = ref<LeaveEmployeeStatisticsResponse | null>(null);
const statisticsLoading = ref(false);
const statisticsLoaded = ref(false);
const statisticsError = ref("");
const statisticsTrendMode = ref<StatisticsTrendMode>("annual");
let statisticsRequestSequence = 0;
const statisticsResponseCache = new Map<
  number,
  LeaveEmployeeStatisticsResponse
>();
const annualTrendDetailYear = ref<number | null>(null);
const trendDetailMonth = ref<string | null>(null);
const annualTrendDetailData = ref<LeaveEmployeeStatisticsResponse | null>(null);
const annualTrendDetailLoading = ref(false);
const annualTrendDetailError = ref("");
let annualTrendDetailRequestSequence = 0;
const canViewEmployeeStatistics = computed(
  () => canAccessHRApprovalCenter(authStore.user?.role),
);
const currentLoading = computed(() => {
  if (activeTab.value === "pending") return loading.value;
  if (activeTab.value === "statistics") return statisticsLoading.value;
  return historyLoading.value;
});
const rankedStatisticsEmployees = computed<LeaveEmployeeStatisticsItem[]>(() =>
  [...(statisticsData.value?.employees || [])]
    .sort(
      (first, second) =>
        second.approvedRequestCount - first.approvedRequestCount ||
        second.approvedLeaveDays - first.approvedLeaveDays ||
        first.name.localeCompare(second.name, "zh-CN"),
    )
    .map((employee, index) => ({ ...employee, rank: index + 1 })),
);
const statisticsDepartmentOptions = computed(() =>
  Array.from(
    new Set(
      rankedStatisticsEmployees.value
        .map((employee) => employee.department?.trim())
        .filter((department): department is string => Boolean(department)),
    ),
  ).sort((first, second) => first.localeCompare(second, "zh-CN")),
);
const filteredStatisticsEmployees = computed(() => {
  return rankedStatisticsEmployees.value.filter(matchesStatisticsFilters);
});
const hasStatisticsFilters = computed(
  () =>
    Boolean(statisticsKeyword.value.trim()) ||
    Boolean(statisticsDepartment.value),
);
const statisticsSummary = computed(() => {
  if (!hasStatisticsFilters.value) {
    return (
      statisticsData.value?.summary || {
        employeeCount: 0,
        approvedRequestCount: 0,
        approvedLeaveDays: 0,
      }
    );
  }
  return filteredStatisticsEmployees.value.reduce(
    (summary, employee) => ({
      employeeCount: summary.employeeCount + 1,
      approvedRequestCount:
        summary.approvedRequestCount + employee.approvedRequestCount,
      approvedLeaveDays: summary.approvedLeaveDays + employee.approvedLeaveDays,
    }),
    { employeeCount: 0, approvedRequestCount: 0, approvedLeaveDays: 0 },
  );
});
const statisticsAnnualComparison = computed<LeaveEmployeeAnnualComparison[]>(
  () => {
    const source = [...(statisticsData.value?.annualComparison || [])].sort(
      (first, second) => first.year - second.year,
    );
    if (!hasStatisticsFilters.value) return source;

    return source.map((period) => {
      const totals = filteredStatisticsEmployees.value.reduce(
        (summary, employee) => {
          const employeePeriod = (employee.annualTrend || []).find(
            (item) => item.year === period.year,
          );
          return {
            approvedRequestCount:
              summary.approvedRequestCount +
              (employeePeriod?.approvedRequestCount || 0),
            approvedLeaveDays:
              summary.approvedLeaveDays +
              (employeePeriod?.approvedLeaveDays || 0),
          };
        },
        { approvedRequestCount: 0, approvedLeaveDays: 0 },
      );
      return {
        year: period.year,
        employeeCount: filteredStatisticsEmployees.value.length,
        ...totals,
      };
    });
  },
);
const previousYearComparison = computed(() =>
  statisticsAnnualComparison.value.find(
    (item) => item.year === statisticsYear.value - 1,
  ),
);
const requestCountComparisonLabel = computed(() =>
  formatYearComparison(
    statisticsSummary.value.approvedRequestCount,
    previousYearComparison.value?.approvedRequestCount,
    "次",
  ),
);
const leaveDaysComparisonLabel = computed(() =>
  formatYearComparison(
    statisticsSummary.value.approvedLeaveDays,
    previousYearComparison.value?.approvedLeaveDays,
    "天",
  ),
);

const ANNUAL_CHART_LEFT = 72;
const ANNUAL_CHART_RIGHT = 968;
const ANNUAL_CHART_TOP = 38;
const ANNUAL_CHART_BOTTOM = 330;

function buildTrendChart(periods: StatisticsTrendPeriod[]) {
  const requestMax = getRequestTrendScaleMax(
    Math.max(...periods.map((item) => item.approvedRequestCount), 0),
  );
  const daysMax = getTrendScaleMax(
    Math.max(...periods.map((item) => item.approvedLeaveDays), 0),
  );
  const chartHeight = ANNUAL_CHART_BOTTOM - ANNUAL_CHART_TOP;
  const chartWidth = ANNUAL_CHART_RIGHT - ANNUAL_CHART_LEFT;
  const points = periods.map((item, index) => {
    const x =
      periods.length <= 1
        ? ANNUAL_CHART_LEFT + chartWidth / 2
        : ANNUAL_CHART_LEFT + (chartWidth * index) / (periods.length - 1);
    return {
      ...item,
      x,
      requestY:
        ANNUAL_CHART_BOTTOM -
        (item.approvedRequestCount / requestMax) * chartHeight,
      daysY:
        ANNUAL_CHART_BOTTOM - (item.approvedLeaveDays / daysMax) * chartHeight,
    };
  });
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = 1 - index / 4;
    return {
      y: ANNUAL_CHART_TOP + (chartHeight * index) / 4,
      requestLabel: formatStatisticsDays(requestMax * ratio),
      daysLabel: formatStatisticsDays(daysMax * ratio),
    };
  });
  return {
    left: ANNUAL_CHART_LEFT,
    right: ANNUAL_CHART_RIGHT,
    bottom: ANNUAL_CHART_BOTTOM,
    points,
    ticks,
    requestLine: points
      .map((point) => `${point.x},${point.requestY}`)
      .join(" "),
    daysLine: points.map((point) => `${point.x},${point.daysY}`).join(" "),
  };
}

const statisticsMonthlyComparison = computed<LeaveEmployeeMonthlyComparison[]>(
  () => {
    const source = [...(statisticsData.value?.monthlyComparison || [])].sort(
      (first, second) => first.month.localeCompare(second.month),
    );
    if (!hasStatisticsFilters.value) return source;

    return source.map((period) => {
      const totals = filteredStatisticsEmployees.value.reduce(
        (summary, employee) => {
          const employeePeriod = (employee.monthlyTrend || []).find(
            (item) => item.month === period.month,
          );
          return {
            approvedRequestCount:
              summary.approvedRequestCount +
              (employeePeriod?.approvedRequestCount || 0),
            approvedLeaveDays:
              summary.approvedLeaveDays +
              (employeePeriod?.approvedLeaveDays || 0),
          };
        },
        { approvedRequestCount: 0, approvedLeaveDays: 0 },
      );
      return { month: period.month, ...totals };
    });
  },
);
const annualTrendChart = computed(() =>
  buildTrendChart(
    statisticsAnnualComparison.value.map((item) => ({
      periodKey: `annual-${item.year}`,
      periodLabel: `${item.year} 年`,
      axisLabel: String(item.year),
      year: item.year,
      month: null,
      approvedRequestCount: item.approvedRequestCount,
      approvedLeaveDays: item.approvedLeaveDays,
    })),
  ),
);
const monthlyTrendChart = computed(() =>
  buildTrendChart(
    statisticsMonthlyComparison.value.map((item) => ({
      periodKey: `monthly-${item.month}`,
      periodLabel: formatStatisticsMonth(item.month),
      axisLabel: `${Number(item.month.slice(5, 7))}月`,
      year: Number(item.month.slice(0, 4)) || statisticsYear.value,
      month: item.month,
      approvedRequestCount: item.approvedRequestCount,
      approvedLeaveDays: item.approvedLeaveDays,
    })),
  ),
);
const activeTrendChart = computed(() =>
  statisticsTrendMode.value === "monthly"
    ? monthlyTrendChart.value
    : annualTrendChart.value,
);
const hasActiveTrendData = computed(() =>
  activeTrendChart.value.points.length > 0,
);
const trendChartTitle = computed(() =>
  statisticsTrendMode.value === "monthly"
    ? `${statisticsYear.value} 年逐月请假趋势`
    : "近五年请假趋势",
);
const trendChartDescription = computed(() =>
  statisticsTrendMode.value === "monthly"
    ? "次数与天数使用独立刻度，点击任一月度数据点查看员工与假期类型"
    : "次数与天数使用独立刻度，点击任一年度数据点查看员工与假期类型",
);
const activeTrendAriaLabel = computed(() => {
  const dimensionLabel =
    statisticsTrendMode.value === "monthly" ? "逐月" : "近五年";
  return `${dimensionLabel}请假趋势：${activeTrendChart.value.points
    .map(
      (item) =>
        `${item.periodLabel}批准 ${item.approvedRequestCount} 次、${formatStatisticsDays(item.approvedLeaveDays)} 天`,
    )
    .join("；")}`;
});
const annualTrendDetailEmployees = computed<LeaveEmployeeStatisticsItem[]>(
  () => {
    const filteredEmployeeIds = hasStatisticsFilters.value
      ? new Set(
          filteredStatisticsEmployees.value.map((employee) => employee.userId),
        )
      : null;
    return [...(annualTrendDetailData.value?.employees || [])]
      .filter(
        (employee) =>
          filteredEmployeeIds === null ||
          filteredEmployeeIds.has(employee.userId),
      )
      .map((employee) => {
        if (!trendDetailMonth.value) return employee;
        const monthlyPeriod = (employee.monthlyTrend || []).find(
          (item) => item.month === trendDetailMonth.value,
        );
        return {
          ...employee,
          approvedRequestCount: monthlyPeriod?.approvedRequestCount || 0,
          approvedLeaveDays: monthlyPeriod?.approvedLeaveDays || 0,
          typeSummaries: monthlyPeriod?.typeSummaries || [],
        };
      })
      .filter(
        (employee) =>
          employee.approvedRequestCount > 0 || employee.approvedLeaveDays > 0,
      )
      .sort(
        (first, second) =>
          second.approvedRequestCount - first.approvedRequestCount ||
          second.approvedLeaveDays - first.approvedLeaveDays ||
          first.name.localeCompare(second.name, "zh-CN"),
      );
  },
);
const annualTrendDetailSummary = computed(() =>
  annualTrendDetailEmployees.value.reduce(
    (summary, employee) => ({
      employeeCount: summary.employeeCount + 1,
      approvedRequestCount:
        summary.approvedRequestCount + employee.approvedRequestCount,
      approvedLeaveDays: summary.approvedLeaveDays + employee.approvedLeaveDays,
    }),
    { employeeCount: 0, approvedRequestCount: 0, approvedLeaveDays: 0 },
  ),
);
const trendDetailTitle = computed(() =>
  trendDetailMonth.value
    ? `${formatStatisticsMonth(trendDetailMonth.value)}员工请假明细`
    : `${annualTrendDetailYear.value || "所选"} 年员工请假明细`,
);
const trendDetailFilterLabel = computed(() => {
  const conditions: string[] = [];
  if (statisticsDepartment.value) {
    conditions.push(`部门：${statisticsDepartment.value}`);
  }
  const keyword = statisticsKeyword.value.trim();
  if (keyword) conditions.push(`员工：${keyword}`);
  return conditions.length > 0
    ? `当前筛选：${conditions.join("；")}`
    : "当前筛选：全部部门、全部员工";
});
const annualTrendDetailEmptyDescription = computed(() =>
  hasStatisticsFilters.value
    ? "该时段没有符合当前筛选条件的员工请假记录"
    : `${trendDetailMonth.value ? formatStatisticsMonth(trendDetailMonth.value) : `${annualTrendDetailYear.value || "所选"} 年`}暂无员工请假记录`,
);

const employeeRankingChartItems = computed(() => {
  const employees = filteredStatisticsEmployees.value;
  const maxRequests = Math.max(
    ...employees.map((item) => item.approvedRequestCount),
    1,
  );
  const maxDays = Math.max(
    ...employees.map((item) => item.approvedLeaveDays),
    1,
  );
  return employees.map((employee) => ({
    ...employee,
    requestPercent: getBarPercent(employee.approvedRequestCount, maxRequests),
    daysPercent: getBarPercent(employee.approvedLeaveDays, maxDays),
  }));
});
const hasEmployeeRankingData = computed(() =>
  employeeRankingChartItems.value.some(
    (item) => item.approvedRequestCount > 0 || item.approvedLeaveDays > 0,
  ),
);

const typeDistributionTotalDays = computed(() =>
  filteredStatisticsEmployees.value.reduce(
    (total, employee) =>
      total +
      employee.typeSummaries.reduce(
        (employeeTotal, item) => employeeTotal + Number(item.totalDays || 0),
        0,
      ),
    0,
  ),
);
const typeDistributionItems = computed(() => {
  const aggregated: Record<
    string,
    {
      leaveTypeCode: string;
      leaveTypeName: string;
      requestCount: number;
      totalDays: number;
    }
  > = {};
  filteredStatisticsEmployees.value.forEach((employee) => {
    employee.typeSummaries.forEach((item) => {
      const current = aggregated[item.leaveTypeCode];
      aggregated[item.leaveTypeCode] = {
        leaveTypeCode: item.leaveTypeCode,
        leaveTypeName: item.leaveTypeName,
        requestCount: (current?.requestCount || 0) + item.requestCount,
        totalDays: (current?.totalDays || 0) + Number(item.totalDays || 0),
      };
    });
  });

  const sorted = Object.values(aggregated)
    .filter((item) => item.totalDays > 0)
    .sort(
      (first, second) =>
        second.totalDays - first.totalDays ||
        first.leaveTypeName.localeCompare(second.leaveTypeName, "zh-CN"),
    );
  const visible = sorted.slice(0, 5);
  if (sorted.length > 5) {
    visible.push(
      sorted.slice(5).reduce(
        (other, item) => ({
          leaveTypeCode: "__remaining__",
          leaveTypeName: "其他",
          requestCount: other.requestCount + item.requestCount,
          totalDays: other.totalDays + item.totalDays,
        }),
        {
          leaveTypeCode: "__remaining__",
          leaveTypeName: "其他",
          requestCount: 0,
          totalDays: 0,
        },
      ),
    );
  }

  const circumference = Math.PI * 2 * 72;
  let accumulatedLength = 0;
  return visible.map((item, index) => {
    const percentage =
      typeDistributionTotalDays.value > 0
        ? (item.totalDays / typeDistributionTotalDays.value) * 100
        : 0;
    const segmentLength = (percentage / 100) * circumference;
    const visibleLength = Math.max(segmentLength - 3, 0);
    const result = {
      ...item,
      percentage,
      colorIndex: index,
      strokeDasharray: `${visibleLength} ${circumference - visibleLength}`,
      strokeDashoffset: -accumulatedLength,
    };
    accumulatedLength += segmentLength;
    return result;
  });
});
const typeDistributionAriaLabel = computed(
  () =>
    `假期类型分布：${typeDistributionItems.value
      .map(
        (item) =>
          `${item.leaveTypeName} ${formatStatisticsDays(item.totalDays)} 天，占比 ${formatStatisticsPercent(item.percentage)}`,
      )
      .join("；")}`,
);
const statisticsEmptyDescription = computed(() => {
  if (statisticsKeyword.value.trim() || statisticsDepartment.value) {
    return "没有符合筛选条件的员工";
  }
  return `${statisticsYear.value} 年暂无已批准的请假记录`;
});
const toolbarSubtitle = computed(() => {
  if (activeTab.value === "statistics") {
    if (statisticsError.value) return "统计数据加载失败，请重新加载";
    if (!statisticsLoaded.value) return "按年度查看员工请假频次与带薪假额度";
    return `共 ${statisticsSummary.value.employeeCount} 名员工，按已批准请假次数排名`;
  }
  if (activeTab.value === "history") {
    return historyLoaded.value
      ? `共 ${historyTotal.value} 条记录`
      : "查看本人处理过的请假审批";
  }
  return list.value.length > 0
    ? `${list.value.length} 条待处理申请`
    : "当前没有待处理申请";
});
const filteredPendingList = computed(() => {
  const keyword = pendingKeyword.value.trim().toLowerCase();
  if (!keyword) return list.value;
  return list.value.filter((item) => {
    const fields = [
      item.request_no,
      item.applicant_name,
      item.applicant_department,
      item.leave_type_name,
      item.parent_leave_type_name,
      item.reason,
    ];
    return fields.some((field) =>
      (field || "").toLowerCase().includes(keyword),
    );
  });
});
const pendingDepartmentCount = computed(() => {
  const departments = list.value
    .map((item) => item.applicant_department)
    .filter((department): department is string => Boolean(department));
  return new Set(departments).size;
});
const overduePendingCount = computed(
  () => list.value.filter((item) => isOverduePending(item)).length,
);

async function fetchList() {
  loading.value = true;
  try {
    list.value = await getPendingRequests();
  } catch {
    // 静默处理
  } finally {
    loading.value = false;
  }
}

async function fetchHistory(page = historyPage.value) {
  clearTimeout(historySearchTimer);
  historySearchTimer = undefined;
  const requestSequence = ++historyRequestSequence;
  const keyword = historyKeyword.value.trim();
  historyPage.value = page;
  historyLoading.value = true;
  try {
    const result = await getReviewedRequests({
      page,
      pageSize: historyPageSize,
      ...(keyword ? { keyword } : {}),
    });
    if (requestSequence !== historyRequestSequence) return;
    historyList.value = result.list;
    historyTotal.value = result.total;
    historyLoaded.value = true;
  } catch {
    if (requestSequence !== historyRequestSequence) return;
    historyList.value = [];
    historyTotal.value = 0;
    historyLoaded.value = false;
    ElMessage.error("获取审批记录失败");
  } finally {
    if (requestSequence === historyRequestSequence) historyLoading.value = false;
  }
}

function searchHistory() {
  return fetchHistory(1);
}

watch(historyKeyword, () => {
  clearTimeout(historySearchTimer);
  historyRequestSequence += 1;
  historyPage.value = 1;
  historyList.value = [];
  historyTotal.value = 0;
  historyLoaded.value = false;
  historyLoading.value = true;
  if (!historyKeyword.value.trim()) {
    void searchHistory();
    return;
  }
  historySearchTimer = setTimeout(() => {
    void searchHistory();
  }, 300);
}, { flush: "sync" });

onBeforeUnmount(() => {
  clearTimeout(historySearchTimer);
  historyRequestSequence += 1;
});

async function fetchStatistics() {
  if (!canViewEmployeeStatistics.value) return;
  const requestSequence = ++statisticsRequestSequence;
  const requestedYear = statisticsYear.value;
  statisticsLoading.value = true;
  statisticsError.value = "";
  try {
    const result = await getLeaveEmployeeStatistics(requestedYear);
    if (
      requestSequence !== statisticsRequestSequence ||
      !canViewEmployeeStatistics.value ||
      statisticsYear.value !== requestedYear
    ) {
      return;
    }
    statisticsData.value = result;
    statisticsResponseCache.set(requestedYear, result);
    statisticsLoaded.value = true;
    if (annualTrendDetailYear.value === requestedYear) {
      annualTrendDetailRequestSequence += 1;
      annualTrendDetailData.value = result;
      annualTrendDetailLoading.value = false;
      annualTrendDetailError.value = "";
    }
  } catch (error: unknown) {
    if (requestSequence !== statisticsRequestSequence) return;
    statisticsData.value = null;
    statisticsLoaded.value = false;
    statisticsError.value = requestErrorMessage(
      error,
      "暂时无法获取统计数据，请稍后重试",
    );
  } finally {
    if (requestSequence === statisticsRequestSequence) {
      statisticsLoading.value = false;
    }
  }
}

async function openAnnualTrendDetail(year: number, forceReload = false) {
  annualTrendDetailYear.value = year;
  trendDetailMonth.value = null;
  const requestSequence = ++annualTrendDetailRequestSequence;
  annualTrendDetailError.value = "";

  const reusableResponse =
    !forceReload && statisticsData.value?.year === year
      ? statisticsData.value
      : !forceReload
        ? statisticsResponseCache.get(year)
        : undefined;
  if (reusableResponse) {
    annualTrendDetailData.value = reusableResponse;
    annualTrendDetailLoading.value = false;
    return;
  }

  annualTrendDetailData.value = null;
  annualTrendDetailLoading.value = true;
  try {
    const result = await getLeaveEmployeeStatistics(year);
    if (
      requestSequence !== annualTrendDetailRequestSequence ||
      annualTrendDetailYear.value !== year
    ) {
      return;
    }
    statisticsResponseCache.set(year, result);
    annualTrendDetailData.value = result;
  } catch (error: unknown) {
    if (
      requestSequence !== annualTrendDetailRequestSequence ||
      annualTrendDetailYear.value !== year
    ) {
      return;
    }
    annualTrendDetailData.value = null;
    annualTrendDetailError.value = requestErrorMessage(
      error,
      `暂时无法获取 ${year} 年员工请假明细，请稍后重试`,
    );
  } finally {
    if (
      requestSequence === annualTrendDetailRequestSequence &&
      annualTrendDetailYear.value === year
    ) {
      annualTrendDetailLoading.value = false;
    }
  }
}

function openMonthlyTrendDetail(month: string) {
  const result = statisticsData.value;
  if (!result || !month) return;
  annualTrendDetailRequestSequence += 1;
  annualTrendDetailYear.value = result.year;
  trendDetailMonth.value = month;
  annualTrendDetailData.value = result;
  annualTrendDetailLoading.value = false;
  annualTrendDetailError.value = "";
}

function openTrendPointDetail(point: StatisticsTrendPeriod) {
  if (point.month) {
    openMonthlyTrendDetail(point.month);
    return;
  }
  void openAnnualTrendDetail(point.year);
}

function isTrendPointSelected(point: StatisticsTrendPeriod): boolean {
  return (
    annualTrendDetailYear.value === point.year &&
    trendDetailMonth.value === point.month
  );
}

function setStatisticsTrendMode(mode: StatisticsTrendMode) {
  if (statisticsTrendMode.value === mode) return;
  closeAnnualTrendDetail();
  statisticsTrendMode.value = mode;
}

async function refreshStatisticsAndInvalidateCache(forceRefresh = false) {
  const detailYear = annualTrendDetailYear.value;
  statisticsResponseCache.clear();
  if (!forceRefresh && !statisticsLoaded.value) return;
  await fetchStatistics();
  if (
    detailYear !== null &&
    detailYear !== statisticsYear.value &&
    annualTrendDetailYear.value === detailYear
  ) {
    await openAnnualTrendDetail(detailYear, true);
  }
}

function retryAnnualTrendDetail() {
  if (annualTrendDetailYear.value === null) return;
  if (trendDetailMonth.value) {
    openMonthlyTrendDetail(trendDetailMonth.value);
    return;
  }
  void openAnnualTrendDetail(annualTrendDetailYear.value, true);
}

function closeAnnualTrendDetail() {
  annualTrendDetailRequestSequence += 1;
  annualTrendDetailYear.value = null;
  trendDetailMonth.value = null;
  annualTrendDetailData.value = null;
  annualTrendDetailLoading.value = false;
  annualTrendDetailError.value = "";
}

function handleStatisticsYearChange() {
  closeAnnualTrendDetail();
  statisticsKeyword.value = "";
  statisticsDepartment.value = "";
  statisticsData.value = null;
  statisticsLoaded.value = false;
  statisticsError.value = "";
  void fetchStatistics();
}

function handleTabChange(tabName: string | number) {
  if (tabName === "history" && !historyLoaded.value) fetchHistory(1);
  if (tabName === "statistics" && !statisticsLoaded.value) {
    fetchStatistics();
  }
}

function historyRowIndex(index: number) {
  return (historyPage.value - 1) * historyPageSize + index + 1;
}

function formatLeavePeriod(request: LeaveRequest): string {
  const startHalf = request.start_half === "morning" ? "上午" : "下午";
  const endHalf = request.end_half === "morning" ? "上午" : "下午";
  return `${request.start_date}${startHalf} ~ ${request.end_date}${endHalf}`;
}

function formatStatisticsDays(value: number): string {
  const days = Number(value);
  if (!Number.isFinite(days)) return "0";
  return days.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatStatisticsMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]} 年 ${Number(match[2])} 月`;
}

function formatBalanceDays(value: number | null): string {
  if (value === null || !Number.isFinite(Number(value))) return "-";
  return `${formatStatisticsDays(value)} 天`;
}

function matchesStatisticsFilters(
  employee: LeaveEmployeeStatisticsItem,
): boolean {
  if (
    statisticsDepartment.value &&
    employee.department !== statisticsDepartment.value
  ) {
    return false;
  }
  const keyword = statisticsKeyword.value.trim().toLowerCase();
  if (!keyword) return true;
  return [employee.name, employee.department].some((field) =>
    (field || "").toLowerCase().includes(keyword),
  );
}

function formatStatisticsPercent(value: number): string {
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return "0%";
  return `${percentage.toLocaleString("zh-CN", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatYearComparison(
  currentValue: number,
  previousValue: number | undefined,
  unit: string,
): string {
  if (previousValue === undefined) return "暂无上年对比";
  const difference = currentValue - previousValue;
  if (Math.abs(difference) < 0.001) {
    return `较 ${statisticsYear.value - 1} 年持平`;
  }
  const prefix = difference > 0 ? "+" : "";
  return `较 ${statisticsYear.value - 1} 年 ${prefix}${formatStatisticsDays(difference)} ${unit}`;
}

function getTrendScaleMax(value: number): number {
  const safeValue = Math.max(Number(value) || 0, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safeValue));
  const normalizedValue = safeValue / magnitude;
  const normalizedMax =
    normalizedValue <= 1
      ? 1
      : normalizedValue <= 2
        ? 2
        : normalizedValue <= 5
          ? 5
          : 10;
  return normalizedMax * magnitude;
}

function getRequestTrendScaleMax(value: number): number {
  return Math.max(4, Math.ceil((Number(value) || 0) / 4) * 4);
}

function getBarPercent(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(4, Math.min(100, (value / maximum) * 100));
}

function formatStatisticsPeriod(
  item: LeaveEmployeeStatisticsRequest | LeaveEmployeeStatisticsSegment,
): string {
  const startHalf = item.startHalf === "morning" ? "上午" : "下午";
  const endHalf = item.endHalf === "morning" ? "上午" : "下午";
  return `${item.startDate}${startHalf} ~ ${item.endDate}${endHalf}`;
}

function statisticsApplicationKindLabel(
  request: LeaveEmployeeStatisticsRequest,
): string {
  const isCombined = request.segments.length > 1;
  if (request.applicationKind === "supplement") {
    if (request.parentRequestId) return isCombined ? "组合补假" : "补假";
    return isCombined ? "组合返岗补假" : "返岗补假";
  }
  if (request.applicationKind === "extension") {
    return isCombined ? "组合续假" : "续假";
  }
  if (isCombined || request.applicationKind === "combined") return "组合请假";
  return "";
}

function reviewActionLabel(
  action: LeaveReviewHistoryItem["review_action"],
): string {
  const labels: Record<LeaveReviewHistoryItem["review_action"], string> = {
    approve: "已通过",
    reject: "已驳回",
    historical_import: "历史导入",
  };
  return labels[action];
}

function reviewActionTagType(
  action: LeaveReviewHistoryItem["review_action"],
): "success" | "danger" | "info" {
  if (action === "approve") return "success";
  if (action === "reject") return "danger";
  return "info";
}

function formatParentLeaveSummary(request: LeaveRequest): string {
  if (
    !request.parent_leave_type_name ||
    !request.parent_start_date ||
    !request.parent_start_half ||
    !request.parent_end_date ||
    !request.parent_end_half
  ) {
    return "原请假信息";
  }
  const startHalf = request.parent_start_half === "morning" ? "上午" : "下午";
  const endHalf = request.parent_end_half === "morning" ? "上午" : "下午";
  return [
    `${request.parent_leave_type_name} ${request.parent_total_days || 0}天`,
    `${request.parent_start_date}${startHalf} 至 ${request.parent_end_date}${endHalf}`,
    request.parent_reason || "未填写事由",
  ].join("；");
}

function remainingDaysLabel(request: LeaveRequest): string {
  if (request.status !== "approved") return "-";
  if (request.leave_timing_status === "returned") return "已返岗";
  const days = Number(request.remaining_days);
  return Number.isFinite(days) ? `${days}天` : "-";
}

function returnToWorkLabel(request: LeaveRequest): string {
  if (request.status !== "approved" || !request.return_to_work_date) return "-";
  const half = request.return_to_work_half === "morning" ? "上午" : "下午";
  return `${request.return_to_work_date}${half}`;
}

function getSubmittedAgeDays(value: string | null | undefined): number {
  if (!value) return 0;
  const safeValue = value.includes("T") ? value : value.replace(" ", "T");
  const submittedAt = new Date(safeValue).getTime();
  if (Number.isNaN(submittedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - submittedAt) / 86400000));
}

function pendingAgeLabel(value: string | null | undefined): string {
  const days = getSubmittedAgeDays(value);
  if (days <= 0) return "今天";
  return `${days}天`;
}

function isOverduePending(request: LeaveRequest): boolean {
  return getSubmittedAgeDays(request.submitted_at) > 1;
}

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    response?: { data?: { message?: string } };
  };
  return requestError.response?.data?.message || fallback;
}

async function refreshCurrent() {
  if (activeTab.value === "history") {
    await fetchHistory();
    return;
  }
  if (activeTab.value === "statistics") {
    await refreshStatisticsAndInvalidateCache(true);
    return;
  }
  await fetchList();
}

async function handleApprove(item: LeaveRequest) {
  actionLoading.value = true;
  try {
    await approveRequest(item.id);
    ElMessage.success(`已批准 ${item.applicant_name} 的请假申请`);
    await fetchList();
    if (historyLoaded.value) await fetchHistory(1);
    await refreshStatisticsAndInvalidateCache();
    await pendingStore.refreshPendingCounts();
    emit("approved");
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "操作失败"));
  } finally {
    actionLoading.value = false;
  }
}

function handleReject(item: LeaveRequest) {
  currentRejectItem.value = item;
  rejectReason.value = "";
  rejectDialogVisible.value = true;
}

async function confirmReject() {
  if (!currentRejectItem.value || !rejectReason.value.trim()) return;
  actionLoading.value = true;
  try {
    await rejectRequest(currentRejectItem.value.id, rejectReason.value.trim());
    ElMessage.success("已驳回申请");
    rejectDialogVisible.value = false;
    await fetchList();
    if (historyLoaded.value) await fetchHistory(1);
    await refreshStatisticsAndInvalidateCache();
    await pendingStore.refreshPendingCounts();
    emit("approved");
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "操作失败"));
  } finally {
    actionLoading.value = false;
  }
}

async function handleView(item: LeaveRequest) {
  drawerVisible.value = true;
  detailHistory.value = [];
  detailRequest.value = null;
  detailLoading.value = true;
  try {
    detailRequest.value = await getRequestDetail(item.id);
  } catch {
    ElMessage.error("获取详情失败");
    drawerVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function handleViewRelatedRequest(id: string) {
  if (
    !detailRequest.value ||
    detailRequest.value.id === id ||
    detailLoading.value
  ) {
    return;
  }
  const currentRequest = detailRequest.value;
  detailLoading.value = true;
  try {
    const relatedRequest = await getRequestDetail(id);
    detailHistory.value.push(currentRequest);
    detailRequest.value = relatedRequest;
  } catch {
    ElMessage.error("获取关联申请详情失败");
  } finally {
    detailLoading.value = false;
  }
}

function handleDetailBack() {
  const previousRequest = detailHistory.value.pop();
  if (previousRequest) detailRequest.value = previousRequest;
}

function resetDetailNavigation() {
  detailHistory.value = [];
  detailRequest.value = null;
}

async function refreshAll() {
  await fetchList();
  if (historyLoaded.value) await fetchHistory();
  await refreshStatisticsAndInvalidateCache();
}

onMounted(fetchList);
defineExpose({ refresh: refreshAll });
</script>

<style scoped>
.leave-type-cell {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 3px;
}
.leave-type-cell span {
  color: #909399;
  font-size: 11px;
}
.leave-type-cell .parent-leave-summary {
  color: #606266;
  font-weight: 600;
}
.leave-pending-list {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 100px;
  overflow-x: hidden;
}

.leave-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.leave-toolbar.is-compact {
  justify-content: flex-end;
}

.toolbar-heading {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.leave-toolbar.is-statistics {
  flex-wrap: wrap;
  gap: 10px 20px;
}

.is-statistics .toolbar-heading {
  flex: 1 1 420px;
  gap: 7px;
}

.is-statistics .toolbar-actions {
  margin-left: auto;
}

.statistics-heading-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.statistics-toolbar-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-height: 20px;
  color: #6b7785;
  font-size: 12px;
}

.statistics-inline-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.statistics-inline-metric strong {
  color: #24578c;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: #1f2d3d;
}

.section-subtitle {
  color: #6b7785;
  font-size: 13px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.keyword-input {
  width: 260px;
}

.statistics-year-select {
  width: 112px;
}

.statistics-department-select {
  width: 150px;
}

.statistics-keyword-input {
  width: 210px;
}

.leave-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  background: #fbfcfe;
}

.metric-item span {
  color: #6b7785;
  font-size: 13px;
  font-weight: 600;
}

.metric-item strong {
  color: #1f2d3d;
  font-size: 22px;
  line-height: 1;
}

.approval-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.approval-tabs {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.approval-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #edf0f5;
}

.approval-tabs :deep(.el-tabs__item) {
  height: 38px;
  color: #6b7785;
  font-weight: 600;
}

.approval-tabs :deep(.el-tabs__item.is-active) {
  color: #2c5aa0;
}

.has-inline-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 24px;
}

.has-inline-search::before {
  grid-column: 1 / -1;
  grid-row: 1;
  align-self: end;
  height: 1px;
  background: #edf0f5;
  content: "";
  pointer-events: none;
}

.has-inline-search .leave-toolbar {
  grid-column: 2;
  grid-row: 1;
  margin-bottom: 0;
}

.has-inline-search .approval-tabs {
  display: contents;
}

.has-inline-search > .approval-tabs :deep(> .el-tabs__header) {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  margin: 0;
}

.has-inline-search > .approval-tabs :deep(> .el-tabs__content) {
  grid-column: 1 / -1;
  grid-row: 2;
  min-width: 0;
}

.has-inline-search .approval-tabs :deep(.el-tabs__nav-wrap::after) {
  background: transparent;
}

.has-inline-search .toolbar-actions {
  flex-wrap: nowrap;
  gap: 8px;
}

.has-inline-search .keyword-input {
  width: clamp(240px, 24vw, 300px);
}

.has-inline-search .keyword-input :deep(.el-input__wrapper) {
  padding: 1px 11px;
  border-radius: 8px;
  background: #f5f7fa;
  box-shadow: 0 0 0 1px #eef1f5 inset;
  transition: background-color 0.18s ease, box-shadow 0.18s ease;
}

.has-inline-search .keyword-input :deep(.el-input__wrapper:hover) {
  background: #f0f4f8;
  box-shadow: 0 0 0 1px #dce4ed inset;
}

.has-inline-search .keyword-input :deep(.el-input__wrapper.is-focus) {
  background: #ffffff;
  box-shadow: 0 0 0 1px #409eff inset;
}

.has-inline-search .toolbar-actions > .el-button {
  flex: none;
  width: 32px;
  height: 32px;
  border-color: transparent;
  background: transparent;
  color: #7c8a9b;
}

.has-inline-search .toolbar-actions > .el-button:hover,
.has-inline-search .toolbar-actions > .el-button:focus-visible {
  background: #edf3f9;
  color: #2c5aa0;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-label em {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f56c6c;
  color: #ffffff;
  font-size: 12px;
  font-style: normal;
  line-height: 20px;
  text-align: center;
}

.approval-table {
  width: 100%;
  max-width: 100%;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  overflow: hidden;
}

.approval-table :deep(.el-scrollbar__bar.is-horizontal) {
  display: none !important;
}

.approval-table :deep(.el-table__header-wrapper th.el-table__cell) {
  background: #f7f9fc;
  color: #44505f;
  font-weight: 700;
}

.approval-table :deep(.el-table__cell) {
  padding-top: 10px;
  padding-bottom: 10px;
}

.approval-table :deep(.cell) {
  padding-right: 6px;
  padding-left: 6px;
  line-height: 1.45;
}

.person-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

.person-cell span {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: left;
}

.person-cell strong {
  color: #1f2d3d;
  font-size: 13px;
  font-weight: 700;
}

.person-cell small {
  color: #8a96a3;
  font-size: 12px;
}

.period-cell {
  color: #44505f;
  font-weight: 600;
  white-space: normal;
  word-break: break-word;
}

.wrapped-text {
  display: block;
  white-space: normal;
  word-break: break-word;
}

.approval-time {
  display: inline-block;
  white-space: nowrap;
}

.detail-drawer-content {
  min-height: 120px;
}

.detail-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf0f5;
}

.detail-navigation span {
  overflow: hidden;
  color: #909399;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  white-space: nowrap;
}

.approval-actions :deep(.el-button) {
  flex: none;
  margin-left: 0;
}

.approval-actions :deep(.el-button:not(.is-link)) {
  padding-right: 8px;
  padding-left: 8px;
}

.days-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef5ff;
  color: #2c5aa0;
  font-size: 12px;
  font-weight: 700;
}

.waiting-days {
  color: #52a566;
  font-weight: 700;
}

.waiting-days.urgent {
  color: #d9944e;
}

.remaining-days {
  color: #409eff;
  font-weight: 600;
}
.remaining-days.is-on_leave {
  color: #e6a23c;
}
.remaining-days.is-returned {
  color: #67c23a;
}
.history-pagination {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.statistics-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  gap: 16px;
  min-width: 0;
  padding: 18px;
  border: 1px solid #e4eaf2;
  border-radius: 14px;
  background: #f6f8fb;
}

.chart-kicker {
  display: block;
  color: #4e79a8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.statistics-content {
  display: contents;
}

.statistics-scope-note {
  grid-column: 1 / -1;
  margin: 0;
  padding: 10px 13px;
  border-left: 3px solid #6e9ec9;
  border-radius: 5px;
  background: #edf3f9;
  color: #677586;
  font-size: 12px;
  line-height: 1.6;
}

.statistics-error :deep(.el-alert__content) {
  min-width: 0;
}

.statistics-error {
  grid-column: 1 / -1;
}

.statistics-error :deep(.el-alert__description) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.statistics-dashboard {
  display: contents;
}

.statistics-chart-card,
.statistics-detail-table {
  min-width: 0;
  border: 1px solid #e1e7ef;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 7px 18px rgb(41 61 84 / 5%);
}

.annual-trend-card {
  grid-column: 1 / -1;
}

.statistics-detail-table {
  grid-column: 1 / -1;
}

.statistics-chart-card {
  padding: 18px;
}

.statistics-chart-header,
.statistics-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.statistics-chart-header h3,
.statistics-section-heading h3 {
  margin: 4px 0 0;
  color: #26384d;
  font-size: 16px;
  line-height: 1.35;
}

.statistics-chart-header p {
  margin: 4px 0 0;
  color: #657386;
  font-size: 12px;
}

.statistics-chart-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 5px;
  color: #657386;
  font-size: 12px;
  white-space: nowrap;
}

.trend-chart-controls {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 10px;
}

.trend-mode-switch {
  display: inline-flex;
  padding: 3px;
  border: 1px solid #dce4ed;
  border-radius: 8px;
  background: #f4f7fa;
}

.trend-mode-switch button {
  min-width: 56px;
  min-height: 32px;
  padding: 5px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #657386;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.trend-mode-switch button:hover {
  color: #24578c;
}

.trend-mode-switch button:focus-visible {
  outline: 2px solid #6a9bc7;
  outline-offset: 1px;
}

.trend-mode-switch button.is-active {
  background: #ffffff;
  box-shadow: 0 1px 4px rgb(39 75 112 / 14%);
  color: #24578c;
}

.statistics-chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.statistics-chart-legend i {
  width: 18px;
  height: 3px;
  border-radius: 999px;
}

.statistics-chart-legend i.is-requests {
  background: #2878b8;
}

.statistics-chart-legend i.is-days {
  background: #d18745;
}

.annual-trend-chart {
  width: 100%;
  margin-top: 8px;
  overflow-x: auto;
}

.annual-trend-chart svg {
  display: block;
  width: 100%;
  min-width: 760px;
  height: clamp(320px, 36vw, 430px);
}

.annual-trend-chart.is-monthly svg {
  min-width: 980px;
}

.trend-grid line {
  stroke: #e6ebf1;
  stroke-width: 1;
}

.trend-grid text,
.trend-years text,
.trend-axis-titles text {
  fill: #657386;
  font-size: 11px;
}

.trend-axis-titles text {
  fill: #657386;
  font-weight: 700;
}

.trend-line {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trend-line.is-requests,
.trend-point.is-requests {
  stroke: #2878b8;
}

.trend-line.is-days,
.trend-point.is-days {
  stroke: #d18745;
}

.trend-point {
  fill: #ffffff;
  stroke-width: 3;
  pointer-events: none;
}

.trend-point-hit {
  fill: transparent;
  stroke: transparent;
}

.trend-point-action {
  cursor: pointer;
  outline: none;
}

.trend-point-action:focus-visible {
  fill: rgb(44 90 160 / 8%);
  stroke: rgb(44 90 160 / 42%);
  stroke-width: 2;
}

.trend-point-group.is-selected .trend-point {
  fill: #eaf3fb;
  stroke-width: 4;
  filter: drop-shadow(0 2px 3px rgb(31 77 121 / 22%));
}

.annual-trend-detail {
  margin-top: 14px;
  overflow: hidden;
  border: 1px solid #dbe5ef;
  border-radius: 10px;
  background: #f8fafc;
}

.annual-trend-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid #e1e8f0;
  background: #ffffff;
}

.annual-trend-detail-header h4 {
  margin: 4px 0 0;
  color: #26384d;
  font-size: 15px;
}

.annual-trend-detail-header p {
  margin: 4px 0 0;
  color: #728094;
  font-size: 11px;
}

.annual-trend-detail-loading {
  display: grid;
  gap: 8px;
  padding: 18px;
  color: #728094;
  font-size: 12px;
  text-align: center;
}

.annual-trend-detail-error {
  margin: 14px;
}

.annual-trend-detail-error :deep(.el-alert__description) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.annual-trend-detail-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid #e1e8f0;
  background: #e1e8f0;
}

.annual-trend-detail-summary > span {
  display: block;
  padding: 11px 14px;
  background: #f4f7fa;
  color: #6d7b8d;
  font-size: 12px;
  text-align: center;
}

.annual-trend-detail-summary small {
  display: block;
  margin-bottom: 4px;
  color: #657386;
  font-size: 11px;
}

.annual-trend-detail-summary strong {
  margin-right: 4px;
  color: #24578c;
  font-size: 17px;
}

.annual-trend-detail-summary em {
  color: #657386;
  font-style: normal;
}

.annual-trend-employee-list {
  display: grid;
  max-height: 420px;
  overflow-y: auto;
}

.annual-trend-column-head {
  display: grid;
  grid-template-columns: minmax(130px, 0.45fr) minmax(120px, 0.35fr) minmax(
      260px,
      1.2fr
    );
  gap: 16px;
  padding: 9px 16px;
  border-bottom: 1px solid #dbe4ed;
  background: #eef3f7;
  color: #526276;
  font-size: 11px;
  font-weight: 700;
}

.annual-trend-employee {
  display: grid;
  grid-template-columns: minmax(130px, 0.45fr) minmax(120px, 0.35fr) minmax(
      260px,
      1.2fr
    );
  align-items: center;
  gap: 16px;
  padding: 13px 16px;
  border-bottom: 1px solid #e5ebf2;
  background: #ffffff;
}

.annual-trend-employee:last-child {
  border-bottom: 0;
}

.annual-trend-employee-person {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.annual-trend-employee-person strong,
.annual-trend-employee-person small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.annual-trend-employee-person strong {
  color: #2f4055;
  font-size: 13px;
}

.annual-trend-employee-person small {
  color: #7d8997;
  font-size: 11px;
}

.annual-trend-employee-totals {
  display: flex;
  gap: 8px;
}

.annual-trend-employee-totals span {
  display: grid;
  gap: 2px;
  min-width: 52px;
  padding: 6px 8px;
  border-radius: 7px;
  background: #edf3f9;
  color: #68778a;
  font-size: 11px;
  text-align: center;
}

.annual-trend-employee-totals small {
  color: #657386;
  font-size: 11px;
}

.annual-trend-employee-totals strong {
  color: #24578c;
  font-size: 13px;
}

.annual-trend-type-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.annual-trend-type-list li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid #e2e8ef;
  border-radius: 999px;
  background: #f8fafc;
  color: #647386;
  font-size: 11px;
}

.annual-trend-type-list strong {
  color: #43556b;
  font-weight: 600;
}

.annual-trend-no-types {
  color: #8a96a5;
  font-size: 11px;
}

.employee-ranking-chart {
  display: grid;
  gap: 15px;
  margin-top: 20px;
}

.employee-ranking-row {
  display: grid;
  grid-template-columns: minmax(118px, 0.35fr) minmax(180px, 1fr);
  align-items: center;
  gap: 14px;
}

.employee-rank-name {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.employee-rank-name > span:first-child {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: #edf2f7;
  color: #5e6f82;
  font-size: 11px;
  font-weight: 700;
}

.employee-rank-name > span:last-child {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.employee-rank-name strong,
.employee-rank-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.employee-rank-name strong {
  color: #34465b;
  font-size: 13px;
}

.employee-rank-name small {
  color: #657386;
  font-size: 11px;
}

.employee-ranking-bars {
  display: grid;
  gap: 7px;
}

.employee-bar-row {
  display: grid;
  grid-template-columns: 30px minmax(80px, 1fr) 58px;
  align-items: center;
  gap: 8px;
}

.employee-bar-row > span {
  color: #657386;
  font-size: 11px;
}

.employee-bar-row > strong {
  color: #4a596c;
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}

.employee-bar-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf1f5;
}

.employee-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.employee-bar.is-requests {
  background: linear-gradient(90deg, #3a78ad, #55a2c9);
}

.employee-bar.is-days {
  background: linear-gradient(90deg, #c77a3c, #e0a25f);
}

.leave-type-layout {
  display: grid;
  grid-template-columns: minmax(160px, 0.8fr) minmax(170px, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.leave-type-donut svg {
  display: block;
  width: 100%;
  max-height: 244px;
}

.donut-track,
.donut-segment {
  fill: none;
  stroke-width: 24;
}

.donut-track {
  stroke: #edf1f5;
}

.donut-segment {
  stroke: var(--chart-tone);
  transform: rotate(-90deg);
  transform-origin: 110px 110px;
}

.donut-center-label {
  fill: #657386;
  font-size: 11px;
}

.donut-center-value {
  fill: #26384d;
  font-size: 17px;
  font-weight: 700;
}

.leave-type-legend {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.leave-type-legend li {
  display: grid;
  grid-template-columns: 8px minmax(56px, 1fr) auto 44px;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: 7px;
  background: #f7f9fb;
}

.leave-type-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--chart-tone);
}

.leave-type-legend span {
  overflow: hidden;
  color: #4e5e71;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leave-type-legend strong,
.leave-type-legend em {
  color: #425368;
  font-size: 11px;
  font-style: normal;
  text-align: right;
  white-space: nowrap;
}

.leave-type-legend em {
  color: #657386;
}

.chart-tone-0 {
  --chart-tone: #326fa8;
}

.chart-tone-1 {
  --chart-tone: #4d9a9a;
}

.chart-tone-2 {
  --chart-tone: #d18b45;
}

.chart-tone-3 {
  --chart-tone: #7d72b8;
}

.chart-tone-4 {
  --chart-tone: #b65f72;
}

.chart-tone-5 {
  --chart-tone: #8795a5;
}

.statistics-chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 220px;
  color: #8a96a5;
  text-align: center;
}

.statistics-chart-empty > span {
  color: #aeb9c5;
  font-size: 38px;
  line-height: 1;
}

.statistics-chart-empty strong {
  margin-top: 10px;
  color: #657386;
  font-size: 13px;
}

.statistics-chart-empty small {
  margin-top: 5px;
  color: #657386;
  font-size: 11px;
}

.statistics-detail-table {
  overflow: hidden;
}

.statistics-section-heading {
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid #e8edf3;
}

.statistics-section-heading > span {
  color: #657386;
  font-size: 12px;
  text-align: right;
}

.statistics-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.statistics-table {
  min-width: 820px;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  overflow: hidden;
}

.statistics-detail-table .statistics-table {
  border: 0;
  border-radius: 0;
}

.statistics-table :deep(.el-table__header-wrapper th.el-table__cell) {
  background: #f6f8fc;
  color: #44505f;
  font-weight: 700;
}

.statistics-table :deep(.el-table__expanded-cell) {
  padding: 0 !important;
  background: #f8fafc;
}

.statistics-detail {
  display: grid;
  gap: 18px;
  padding: 18px 24px 22px;
}

.statistics-detail h4 {
  margin: 0 0 10px;
  color: #344256;
  font-size: 14px;
}

.balance-summary-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 9px;
}

.balance-summary-item {
  padding: 11px 12px;
  border: 1px solid #dde8e1;
  border-radius: 9px;
  background: #fbfdfb;
}

.balance-summary-item.is-unlimited {
  border-color: #e3e8ee;
  background: #ffffff;
}

.balance-summary-item > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.balance-summary-item > header > strong {
  overflow: hidden;
  color: #34475b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.balance-summary-item > p {
  margin: 10px 0 0;
  color: #758396;
  font-size: 12px;
}

.balance-summary-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 11px;
}

.balance-summary-metrics > span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.balance-summary-metrics small {
  color: #657386;
  font-size: 11px;
}

.balance-summary-metrics strong {
  overflow: hidden;
  color: #385b49;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.balance-summary-metrics strong.is-low {
  color: #c55050;
}

.type-summary-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}

.type-summary-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 10px;
  padding: 10px 12px;
  border: 1px solid #e7ecf3;
  border-radius: 8px;
  background: #ffffff;
}

.type-summary-item span {
  color: #44505f;
  font-weight: 700;
}

.type-summary-item strong {
  color: #2c5aa0;
}

.type-summary-item small {
  grid-column: 1 / -1;
  color: #7d8997;
}

.statistics-request-list {
  display: grid;
  gap: 10px;
}

.statistics-request-card {
  padding: 12px 14px;
  border: 1px solid #e4e9f1;
  border-radius: 8px;
  background: #ffffff;
}

.statistics-request-heading,
.statistics-request-meta,
.segment-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.statistics-request-heading > strong {
  margin-left: auto;
  color: #2c5aa0;
}

.statistics-request-no {
  color: #344256;
  font-weight: 700;
}

.statistics-request-meta {
  justify-content: space-between;
  margin-top: 7px;
  color: #7d8997;
  font-size: 12px;
}

.statistics-request-card > p {
  margin: 8px 0 0;
  color: #566273;
  font-size: 13px;
  line-height: 1.5;
}

.segment-list {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #dce3ec;
}

.segment-item {
  color: #566273;
  font-size: 12px;
}

.segment-item > span {
  min-width: 0;
  flex: 1;
}

.segment-item > strong {
  color: #344256;
  white-space: nowrap;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #eaf2fb;
  color: #2c5aa0;
  font-weight: 700;
}

.statistics-person-cell {
  display: grid;
  gap: 2px;
}

.statistics-person-cell strong {
  overflow: hidden;
  color: #263548;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statistics-person-cell small {
  overflow: hidden;
  color: #8a96a3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frequency-value {
  color: #c56f14;
}

.paid-leave-remaining {
  color: #3f8f58;
  font-weight: 700;
}

.paid-leave-remaining.is-low {
  color: #d25c5c;
}

.statistics-empty {
  min-height: 180px;
}

.table-empty {
  padding: 22px 0;
}

@media (max-width: 1080px) {
  .statistics-panel {
    grid-template-columns: 1fr;
  }

  .annual-trend-card {
    grid-column: auto;
  }

  .toolbar-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (max-width: 760px) {
  .has-inline-search {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 10px;
  }

  .has-inline-search .leave-toolbar {
    grid-column: 1;
    grid-row: 2;
  }

  .has-inline-search > .approval-tabs :deep(> .el-tabs__content) {
    grid-row: 3;
  }

  .has-inline-search .keyword-input {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .leave-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .is-statistics .toolbar-heading {
    flex: auto;
  }

  .keyword-input {
    width: 100%;
  }

  .statistics-year-select,
  .statistics-department-select {
    width: calc(50% - 5px);
  }

  .statistics-keyword-input {
    width: calc(100% - 42px);
  }

  .leave-metrics {
    grid-template-columns: 1fr;
  }

  .statistics-panel {
    padding: 10px;
    border-radius: 10px;
  }

  .statistics-chart-card {
    padding: 14px;
  }

  .statistics-chart-header,
  .statistics-section-heading {
    flex-direction: column;
    gap: 8px;
  }

  .statistics-chart-legend {
    padding-top: 0;
  }

  .trend-chart-controls {
    align-items: flex-start;
  }

  .annual-trend-chart svg {
    min-width: 680px;
    height: 320px;
  }

  .annual-trend-detail-header {
    align-items: stretch;
  }

  .annual-trend-employee {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .annual-trend-column-head {
    display: none;
  }

  .annual-trend-employee-totals,
  .annual-trend-type-list {
    flex-wrap: wrap;
  }

  .annual-trend-type-list,
  .annual-trend-no-types {
    grid-column: auto;
  }

  .leave-type-layout {
    grid-template-columns: 1fr;
  }

  .leave-type-donut {
    max-width: 250px;
    margin: 0 auto;
  }

  .statistics-section-heading > span {
    text-align: left;
  }

  .statistics-detail {
    padding: 14px;
  }

  .statistics-request-meta,
  .segment-item {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}

@media (max-width: 520px) {
  .employee-ranking-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .annual-trend-detail-header {
    flex-direction: column;
  }

  .annual-trend-detail-summary > span {
    padding: 9px 5px;
  }

  .annual-trend-employee {
    grid-template-columns: 1fr;
  }

  .annual-trend-employee-totals {
    justify-content: flex-start;
  }

  .annual-trend-type-list,
  .annual-trend-no-types {
    grid-column: auto;
  }
}
</style>
