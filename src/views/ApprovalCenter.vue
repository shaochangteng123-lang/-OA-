<template>
  <div class="yl-page approval-center">
    <!-- 统计区域 - 可点击 -->
    <div class="statistics-section">
      <el-card
        class="stat-card pending-card"
        shadow="hover"
        @click="switchTab('pending')"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><Clock /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.pendingCount }}</div>
            <div class="stat-label">待办</div>
          </div>
        </div>
      </el-card>

      <el-card
        class="stat-card basic-card"
        shadow="hover"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><Wallet /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.basicStats.count }}</div>
            <div class="stat-label">基础报销</div>
            <div class="stat-amount" v-if="statistics.basicStats.amount > 0">
              ¥{{ statistics.basicStats.amount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>

      <el-card
        class="stat-card large-card"
        shadow="hover"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><Money /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.largeStats.count }}</div>
            <div class="stat-label">大额报销</div>
            <div class="stat-amount" v-if="statistics.largeStats.amount > 0">
              ¥{{ statistics.largeStats.amount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>

      <el-card
        class="stat-card business-card"
        shadow="hover"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><SuccessFilled /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.businessStats.count }}</div>
            <div class="stat-label">商务报销</div>
            <div class="stat-amount" v-if="statistics.businessStats.amount > 0">
              ¥{{ statistics.businessStats.amount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange" class="no-transition-tabs">
      <!-- 待审批 -->
      <el-tab-pane label="待办" name="pending">
        <el-card>
          <!-- 筛选条件 -->
          <div class="filter-section">
            <el-form :inline="true" :model="pendingFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="pendingFilterForm.userId"
                  placeholder="全部员工"
                  clearable
                  filterable
                  style="width: 130px"
                >
                  <el-option
                    v-for="emp in employeeList"
                    :key="emp.id"
                    :label="emp.name"
                    :value="emp.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="类型">
                <el-select
                  v-model="pendingFilterForm.type"
                  placeholder="全部"
                  clearable
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  style="width: 160px"
                >
                  <el-option value="basic" label="基础报销">
                    <el-checkbox :model-value="pendingFilterForm.type.includes('basic')" style="pointer-events: none; margin-right: 8px;" />
                    基础报销
                  </el-option>
                  <el-option value="large" label="大额报销">
                    <el-checkbox :model-value="pendingFilterForm.type.includes('large')" style="pointer-events: none; margin-right: 8px;" />
                    大额报销
                  </el-option>
                  <el-option value="business" label="商务报销">
                    <el-checkbox :model-value="pendingFilterForm.type.includes('business')" style="pointer-events: none; margin-right: 8px;" />
                    商务报销
                  </el-option>
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select
                  v-model="pendingFilterForm.status"
                  placeholder="全部"
                  clearable
                  style="width: 130px"
                >
                  <el-option label="待审批" value="pending" />
                  <el-option label="待付款" value="approved" />
                  <el-option label="待确认" value="payment_uploaded" />
                  <el-option label="已完成" value="completed" />
                </el-select>
              </el-form-item>
              <el-form-item label="日期">
                <el-date-picker
                  v-model="pendingFilterForm.dateRange"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  range-separator="至"
                  style="width: 260px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="pendingListLoading" @click="handleQueryPendingList">
                  查询
                </el-button>
                <el-button @click="handleResetPendingFilter">重置</el-button>
              </el-form-item>
            </el-form>
          </div>

          <el-table :data="pendingList" border stripe empty-text="暂无待办项" v-loading="pendingListLoading">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="120" align="center">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="150" align="center">
              <template #default="{ row }">
                <div v-if="row.reimbursementInfo">
                  <div>{{ normalizeReimbursementTitle(row.reimbursementInfo.title) }}</div>
                  <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                    ¥{{ row.reimbursementInfo.amount.toFixed(2) }}
                  </div>
                </div>
                <div v-else>-</div>
              </template>
            </el-table-column>
            <el-table-column label="报销类型" min-width="120" align="center">
              <template #default="{ row }">
                <span v-if="row.invoiceCategories">{{ row.invoiceCategories }}</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="getPendingStatusTagType(row)"
                  :color="getPendingStatusColor(row)"
                  :style="getPendingStatusColor(row) ? { color: '#fff', borderColor: getPendingStatusColor(row) } : {}"
                  size="small"
                >
                  {{ getPendingStatusLabel(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" min-width="130" align="center">
              <template #default="{ row }">
                {{ formatDate(row.submitTime) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="280" align="center">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button
                    v-if="row.targetType === 'reimbursement'"
                    type="primary"
                    size="small"
                    :icon="View"
                    @click="handleViewReimbursement(row)"
                  >
                    详情
                  </el-button>
                  <el-button
                    v-if="row.targetType === 'reimbursement'"
                    type="info"
                    size="small"
                    :icon="List"
                    @click="handleViewApprovalProcessFromPending(row)"
                  >
                    审批流程
                  </el-button>
                  <!-- 只有待审批状态才显示通过和驳回按钮 -->
                  <template v-if="row.status === 'pending'">
                    <el-button type="success" size="small" :icon="Check" @click="handleApprove(row)">
                      通过
                    </el-button>
                    <el-button type="danger" size="small" :icon="Close" @click="handleReject(row)">
                      驳回
                    </el-button>
                  </template>
                  <!-- 已通过待付款状态显示付款按钮 -->
                  <template v-else-if="row.status === 'approved' && row.reimbursementStatus === 'approved'">
                    <el-button type="success" size="small" :icon="Money" @click="handlePaymentFromPending(row)">
                      付款
                    </el-button>
                  </template>
                  <!-- 待确认收款状态 -->
                  <el-tag v-else-if="row.reimbursementStatus === 'payment_uploaded'" type="info" size="small">
                    待确认收款
                  </el-tag>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 本月已通过 -->
      <!-- 待付款 -->
      <el-tab-pane label="待付款" name="unpaid">
        <el-card>
          <!-- 筛选条件 -->
          <div class="filter-section">
            <el-form :inline="true" :model="unpaidFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="unpaidFilterForm.userId"
                  placeholder="全部员工"
                  clearable
                  filterable
                  style="width: 130px"
                >
                  <el-option
                    v-for="emp in employeeList"
                    :key="emp.id"
                    :label="emp.name"
                    :value="emp.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="类型">
                <el-select
                  v-model="unpaidFilterForm.type"
                  placeholder="全部"
                  clearable
                  style="width: 140px"
                >
                  <el-option value="basic" label="基础报销" />
                  <el-option value="large" label="大额报销" />
                  <el-option value="business" label="商务报销" />
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select
                  v-model="unpaidFilterForm.status"
                  placeholder="全部"
                  clearable
                  style="width: 130px"
                >
                  <el-option label="待付款" value="approved" />
                  <el-option label="待确认" value="payment_uploaded" />
                  <el-option label="已完成" value="completed" />
                </el-select>
              </el-form-item>
              <el-form-item label="日期">
                <el-date-picker
                  v-model="unpaidFilterForm.dateRange"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  range-separator="至"
                  style="width: 260px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="unpaidListLoading" @click="handleQueryUnpaidList">
                  查询
                </el-button>
                <el-button @click="handleResetUnpaidFilter">重置</el-button>
              </el-form-item>
            </el-form>
          </div>

          <el-table :data="unpaidList" border stripe empty-text="暂无待付款记录" ref="unpaidTableRef" @selection-change="handleUnpaidSelectionChange" v-loading="unpaidListLoading">
            <el-table-column type="selection" width="55" align="center" />
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="120" align="center">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="150" align="center">
              <template #default="{ row }">
                <div>{{ normalizeReimbursementTitle(row.title) }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="报销类型" min-width="120" align="center">
              <template #default="{ row }">
                <span v-if="row.invoiceCategories">{{ row.invoiceCategories }}</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="通过时间" min-width="130" align="center">
              <template #default="{ row }">
                {{ row.approveTime ? formatDate(row.approveTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="220" align="center">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button
                    type="primary"
                    size="small"
                    :icon="View"
                    @click="handleViewUnpaidReimbursement(row)"
                  >
                    详情
                  </el-button>
                  <el-button
                    type="info"
                    size="small"
                    :icon="List"
                    @click="handleViewApprovalProcessFromUnpaid(row)"
                  >
                    审批流程
                  </el-button>
                  <el-button
                    v-if="row.status === 'approved'"
                    type="success"
                    size="small"
                    :icon="Money"
                    @click="handlePayment(row)"
                  >
                    付款
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <!-- 批量付款操作栏 -->
          <div v-if="selectedUnpaidItems.length > 0" class="batch-action-bar">
            <div class="batch-info">
              <span>已选 <strong>{{ selectedUnpaidItems.length }}</strong> 笔</span>
              <span class="batch-amount">合计 <strong>¥{{ selectedUnpaidTotalAmount.toFixed(2) }}</strong></span>
              <span v-if="!isSamePayee" class="batch-warning">
                <el-icon><WarningFilled /></el-icon>
                包含不同收款人，无法批量付款
              </span>
              <span v-else-if="!isSameType" class="batch-warning">
                <el-icon><WarningFilled /></el-icon>
                请选择同一报销类型进行付款
              </span>
            </div>
            <el-button
              type="success"
              :icon="Money"
              :disabled="!isSamePayee || !isSameType || batchPaymentLoading"
              :loading="batchPaymentLoading"
              @click="handleBatchPayment"
            >
              批量付款
            </el-button>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 已付款 -->
      <el-tab-pane label="已付款" name="paid">
        <el-card>
          <!-- 筛选条件 -->
          <div class="filter-section">
            <el-form :inline="true" :model="paidFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="paidFilterForm.userId"
                  placeholder="全部员工"
                  clearable
                  filterable
                  style="width: 130px"
                >
                  <el-option
                    v-for="emp in employeeList"
                    :key="emp.id"
                    :label="emp.name"
                    :value="emp.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="类型">
                <el-select
                  v-model="paidFilterForm.type"
                  placeholder="全部"
                  clearable
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  style="width: 160px"
                >
                  <el-option value="basic" label="基础报销">
                    <el-checkbox :model-value="paidFilterForm.type.includes('basic')" style="pointer-events: none; margin-right: 8px;" />
                    基础报销
                  </el-option>
                  <el-option value="large" label="大额报销">
                    <el-checkbox :model-value="paidFilterForm.type.includes('large')" style="pointer-events: none; margin-right: 8px;" />
                    大额报销
                  </el-option>
                  <el-option value="business" label="商务报销">
                    <el-checkbox :model-value="paidFilterForm.type.includes('business')" style="pointer-events: none; margin-right: 8px;" />
                    商务报销
                  </el-option>
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select
                  v-model="paidFilterForm.status"
                  placeholder="全部"
                  clearable
                  style="width: 130px"
                >
                  <el-option label="待确认收款" value="payment_uploaded" />
                  <el-option label="已确认收款" value="completed" />
                </el-select>
              </el-form-item>
              <el-form-item label="日期">
                <el-date-picker
                  v-model="paidFilterForm.dateRange"
                  type="daterange"
                  value-format="YYYY-MM-DD"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  range-separator="至"
                  style="width: 260px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="paidListLoading" @click="handleQueryPaidList">
                  查询
                </el-button>
                <el-button @click="handleResetPaidFilter">重置</el-button>
              </el-form-item>
            </el-form>
          </div>

          <el-table :data="paidList" border stripe empty-text="暂无已付款记录" v-loading="paidListLoading">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="120" align="center">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="150" align="center">
              <template #default="{ row }">
                <div>{{ normalizeReimbursementTitle(row.title) }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="报销类型" min-width="120" align="center">
              <template #default="{ row }">
                <span v-if="row.invoiceCategories">{{ row.invoiceCategories }}</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="付款时间" min-width="130" align="center">
              <template #default="{ row }">
                {{ row.payTime ? formatDate(row.payTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 'completed' ? 'success' : 'warning'" size="small">
                  {{ row.status === 'completed' ? '已确认收款' : '待确认收款' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="100"  align="center">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  :icon="View"
                  @click="handleViewPaidReimbursement(row)"
                >
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 全部查询 -->
      <el-tab-pane label="全部查询" name="all">
        <el-card>
          <!-- 筛选条件 -->
          <div class="filter-section">
            <el-form :inline="true" :model="allFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="allFilterForm.userId"
                  placeholder="全部员工"
                  clearable
                  filterable
                  style="width: 130px"
                >
                  <el-option
                    v-for="emp in employeeList"
                    :key="emp.id"
                    :label="emp.name"
                    :value="emp.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="类型">
                <el-select
                  v-model="allFilterForm.type"
                  placeholder="全部"
                  clearable
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  popper-class="type-select-popper"
                  style="width: 160px"
                >
                  <el-option value="basic" label="基础报销">
                    <el-checkbox :model-value="allFilterForm.type.includes('basic')" style="pointer-events: none; margin-right: 8px;" />
                    基础报销
                  </el-option>
                  <el-option value="large" label="大额报销">
                    <el-checkbox :model-value="allFilterForm.type.includes('large')" style="pointer-events: none; margin-right: 8px;" />
                    大额报销
                  </el-option>
                  <el-option value="business" label="商务报销">
                    <el-checkbox :model-value="allFilterForm.type.includes('business')" style="pointer-events: none; margin-right: 8px;" />
                    商务报销
                  </el-option>
                </el-select>
              </el-form-item>
              <el-form-item label="所属区域">
                <el-cascader
                  v-model="allFilterForm.reimbursementScope"
                  :options="scopeList"
                  :props="{
                    value: 'value',
                    label: 'name',
                    children: 'children',
                    checkStrictly: true,
                    emitPath: false,
                    multiple: true
                  }"
                  collapse-tags
                  collapse-tags-tooltip
                  :max-collapse-tags="1"
                  :disabled="isBasicReimbursementSelected"
                  clearable
                  placeholder="全部"
                  class="scope-cascader"
                  style="width: 200px"
                />
              </el-form-item>
              <el-form-item label="状态">
                <el-select
                  v-model="allFilterForm.status"
                  placeholder="全部"
                  clearable
                  style="width: 110px"
                >
                  <el-option label="待付款" value="approved" />
                  <el-option label="待确认" value="payment_uploaded" />
                  <el-option label="已完成" value="completed" />
                </el-select>
              </el-form-item>
              <el-form-item label="日期">
                <el-date-picker
                  v-model="dateRangeModel"
                  :type="currentDatePickerType"
                  :value-format="currentDateValueFormat"
                  :start-placeholder="currentStartPlaceholder"
                  :end-placeholder="currentEndPlaceholder"
                  range-separator="至"
                  :shortcuts="dateTypeShortcuts"
                  style="width: 280px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="allListLoading" @click="handleQueryAllList">
                  查询
                </el-button>
                <el-button @click="handleResetAllFilter">重置</el-button>
                <el-button type="success" :icon="Download" @click="handleExportAllList">导出</el-button>
                <el-button type="warning" @click="handleOpenDeductionQuery">核减查询</el-button>
              </el-form-item>
            </el-form>
          </div>

          <!-- 汇总卡片 -->
          <div class="all-summary-cards" v-if="allSummary.total.count > 0">
            <el-card
              v-for="item in allSummary.byType"
              :key="item.type"
              class="summary-type-card"
              shadow="hover"
            >
              <div class="type-card-content">
                <div class="type-name">{{ item.typeName }}</div>
                <div class="type-amount">¥{{ item.amount.toFixed(2) }}</div>
                <div class="type-count">{{ item.count }} 笔</div>
              </div>
            </el-card>
            <el-card class="summary-type-card total-card" shadow="hover">
              <div class="type-card-content">
                <div class="type-name">总计</div>
                <div class="type-amount total">¥{{ allSummary.total.amount.toFixed(2) }}</div>
                <div class="type-count">{{ allSummary.total.count }} 笔</div>
              </div>
            </el-card>
          </div>

          <!-- 汇总信息条 -->
          <div class="summary-bar" v-if="allList.length > 0">
            <span>共 <strong>{{ allList.length }}</strong> 条记录</span>
            <span v-if="allListTotalAmount > 0" style="margin-left: 16px;">已付款金额 <strong style="color: #409eff;">¥{{ allListTotalAmount.toFixed(2) }}</strong></span>
          </div>

          <!-- 列表 -->
          <el-table :data="allList" border stripe empty-text="请设置筛选条件后点击查询" v-loading="allListLoading">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="100" align="center">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="28">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ row.typeName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="150" align="center">
              <template #default="{ row }">
                <div>{{ normalizeReimbursementTitle(row.title) }}</div>
                <div v-if="row.amount !== undefined && row.amount !== null" style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
                <div v-else style="color: #909399; margin-top: 4px;">-</div>
              </template>
            </el-table-column>
            <el-table-column label="报销类型" min-width="120" align="center">
              <template #default="{ row }">
                <span v-if="row.invoiceCategories">{{ row.invoiceCategories }}</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="所属区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="getAllStatusType(row.status)" size="small">
                  {{ row.statusName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" min-width="130" align="center">
              <template #default="{ row }">
                {{ row.submitTime ? formatDate(row.submitTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="150"  align="center">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  link
                  @click="handleViewAllDetail(row)"
                >
                  详情
                </el-button>
                <el-button
                  type="info"
                  size="small"
                  link
                  @click="handleViewApprovalProcessFromAll(row)"
                >
                  审批流程
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 发票管理 -->
      <el-tab-pane label="发票管理" name="invoices">
        <el-card>
          <!-- 筛选条件 -->
          <div class="filter-section">
            <el-form :inline="true" :model="invoiceFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="invoiceFilterForm.userId"
                  placeholder="全部员工"
                  clearable
                  filterable
                  style="width: 100px"
                >
                  <el-option
                    v-for="emp in employeeList"
                    :key="emp.id"
                    :label="emp.name"
                    :value="emp.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="类型">
                <el-select
                  v-model="invoiceFilterForm.type"
                  placeholder="全部"
                  clearable
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  style="width: 130px"
                >
                  <el-option value="basic" label="基础报销" />
                  <el-option value="large" label="大额报销" />
                  <el-option value="business" label="商务报销" />
                </el-select>
              </el-form-item>
              <el-form-item label="文件类型">
                <el-select
                  v-model="invoiceFilterForm.fileType"
                  placeholder="全部"
                  clearable
                  style="width: 80px"
                >
                  <el-option value="receipt" label="收据" />
                  <el-option value="invoice" label="发票" />
                </el-select>
              </el-form-item>
              <el-form-item label="所属区域">
                <el-cascader
                  v-model="invoiceFilterForm.reimbursementScope"
                  :options="scopeList"
                  :props="{
                    value: 'value',
                    label: 'name',
                    children: 'children',
                    checkStrictly: true,
                    emitPath: false,
                    multiple: true
                  }"
                  collapse-tags
                  collapse-tags-tooltip
                  :max-collapse-tags="1"
                  clearable
                  placeholder="全部"
                  class="scope-cascader"
                  style="width: 200px"
                />
              </el-form-item>
              <el-form-item label="提交时间">
                <el-date-picker
                  v-model="invoiceDateRangeModel"
                  :type="invoiceDatePickerType"
                  :value-format="invoiceDateValueFormat"
                  :start-placeholder="invoiceDateStartPlaceholder"
                  :end-placeholder="invoiceDateEndPlaceholder"
                  range-separator="至"
                  :shortcuts="invoiceDateShortcuts"
                  style="width: 240px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="invoiceListLoading" @click="handleQueryInvoiceList">
                  查询
                </el-button>
                <el-button @click="handleResetInvoiceFilter">重置</el-button>
                <el-button
                  type="primary"
                  :icon="Download"
                  :disabled="selectedInvoiceIds.length === 0"
                  :loading="batchDownloading"
                  @click="handleBatchDownload"
                >
                  批量下载
                </el-button>
                <el-button
                  type="success"
                  :icon="Printer"
                  :disabled="selectedInvoiceIds.length === 0"
                  @click="handleBatchPrint"
                >
                  批量打印
                </el-button>
              </el-form-item>
            </el-form>
          </div>

          <!-- 汇总信息 -->
          <div class="summary-bar" v-if="invoiceList.length > 0">
            <span>共 <strong>{{ invoiceList.length }}</strong> 条发票记录</span>
            <span style="margin-left: 16px;">总金额 <strong style="color: #409eff;">¥{{ invoiceTotalAmount.toFixed(2) }}</strong></span>
            <span style="margin-left: 8px;">（实报金额：<strong style="color: #67c23a;">¥{{ invoiceActualAmount.toFixed(2) }}</strong></span>
            <span style="margin-left: 8px;">核减金额：<strong style="color: #f56c6c;">¥{{ invoiceTotalDeductedAmount.toFixed(2) }}</strong>）</span>
          </div>

          <!-- 发票列表 -->
          <el-table :data="invoiceList" border stripe empty-text="请设置筛选条件后点击查询" v-loading="invoiceListLoading">
            <el-table-column width="80" align="center">
              <template #header>
                <div style="display: flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;">
                  <el-checkbox
                    v-model="invoiceSelectAll"
                    :indeterminate="invoiceSelectIndeterminate"
                    @change="handleInvoiceSelectAllChange"
                  />
                  <span>全选</span>
                </div>
              </template>
              <template #default="{ row }">
                <el-checkbox
                  :model-value="selectedInvoiceIds.includes(row.id)"
                  @change="(val: boolean | string | number) => handleInvoiceSelect(row.id, !!val)"
                />
              </template>
            </el-table-column>
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="员工" width="100" align="center">
              <template #default="{ row }">
                {{ row.userName }}
              </template>
            </el-table-column>
            <el-table-column label="报销事由" min-width="150" align="center">
              <template #default="{ row }">
                {{ normalizeReimbursementTitle(row.reimbursementTitle) }}
              </template>
            </el-table-column>
            <el-table-column label="报销类型" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.reimbursementType)" size="small">
                  {{ row.reimbursementTypeName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="发票号码" min-width="220" align="center">
              <template #default="{ row }">
                <span style="white-space: nowrap;">{{ row.invoiceNumber || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="发票日期" width="120" align="center" prop="invoiceDate" />
            <el-table-column label="提交时间" width="150" align="center">
              <template #default="{ row }">
                <span style="white-space: nowrap;">{{ formatSubmitTime(row.submitTime) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="文件类型" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.fileType === 'invoice' ? 'primary' : 'warning'" size="small">
                  {{ row.fileType === 'invoice' ? '发票' : '收据' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="120" align="center">
              <template #default="{ row }">
                <span v-if="['payment_uploaded', 'completed'].includes(row.reimbursementStatus)" style="color: #409eff; font-weight: 600;">¥{{ row.amount.toFixed(2) }}</span>
                <span v-else style="color: #909399;">-</span>
              </template>
            </el-table-column>
            <el-table-column label="预览" width="80" align="center">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="handlePreviewInvoice(row)">
                  查看
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 发票预览对话框 -->
    <el-dialog v-model="invoicePreviewDialogVisible" title="发票预览" width="80%" :close-on-click-modal="true">
      <div class="preview-dialog-content">
        <img v-if="previewInvoiceIsImage" :src="previewInvoicePath" class="preview-dialog-image" alt="发票" />
        <iframe v-else :src="previewInvoicePath" class="preview-dialog-pdf" />
      </div>
    </el-dialog>

    <!-- 驳回对话框 -->
    <el-dialog v-model="rejectDialogVisible" title="驳回审批" width="400px" :close-on-click-modal="false">
      <el-form ref="rejectFormRef" :model="rejectForm" :rules="rejectFormRules" label-width="80px">
        <el-form-item label="驳回原因" prop="comment">
          <el-input
            v-model="rejectForm.comment"
            type="textarea"
            :rows="4"
            placeholder="请填写驳回原因（必填）"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="rejectLoading" @click="confirmReject">确定</el-button>
      </template>
    </el-dialog>

    <!-- 审批流程弹窗 -->
    <el-dialog
      v-model="approvalProcessDialogVisible"
      title="审批流程"
      width="650px"
      :close-on-click-modal="false"
    >
      <div v-if="currentApprovalRecord" class="approval-process-detail">
        <!-- 基本信息 -->
        <div class="info-section">
          <h4 class="section-title">报销单信息</h4>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="报销单号">{{ currentApprovalRecord.id }}</el-descriptions-item>
            <el-descriptions-item label="报销类型">{{ getTypeLabel(currentApprovalRecord.type) }}</el-descriptions-item>
            <el-descriptions-item label="报销事由" :span="2">{{ normalizeReimbursementTitle(currentApprovalRecord.title) }}</el-descriptions-item>
            <el-descriptions-item label="申请人">{{ currentApprovalRecord.applicantName }}</el-descriptions-item>
            <el-descriptions-item label="报销金额">
              <span class="amount-highlight">¥{{ currentApprovalRecord.amount.toFixed(2) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag :type="getAllStatusType(currentApprovalRecord.status)" size="small">
                {{ getStatusLabel(currentApprovalRecord.status) }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 审批流程时间线 -->
        <div class="timeline-section">
          <h4 class="section-title">审批流程</h4>
          <el-timeline>
            <!-- 1. 员工提交 -->
            <el-timeline-item
              :timestamp="currentApprovalRecord.submitTime ? formatDate(currentApprovalRecord.submitTime) : ''"
              placement="top"
              type="primary"
            >
              <div class="timeline-content">
                <div class="timeline-title">员工提交</div>
                <div class="timeline-desc">{{ currentApprovalRecord.applicantName }} 提交了报销申请</div>
                <div v-if="currentApprovalRecord.description" class="timeline-description">{{ currentApprovalRecord.description }}</div>
              </div>
            </el-timeline-item>

            <!-- 2. 管理员审批 -->\n            <!-- 如果有审批记录，显示详细记录 -->
            <template v-if="approvalRecords.length > 0">
              <el-timeline-item
                v-for="record in approvalRecords.filter(r => r.action !== 'payment_uploaded')"
                :key="record.id"
                :timestamp="formatDate(record.actionTime)"
                placement="top"
                :type="record.action === 'approve' ? 'success' : record.action === 'reject' ? 'danger' : 'info'"
              >
                <div class="timeline-content">
                  <div class="timeline-title">
                    {{ record.approverName || '管理员' }}
                  </div>
                  <div class="timeline-desc">
                    <el-tag :type="record.action === 'approve' ? 'success' : record.action === 'reject' ? 'danger' : 'info'" size="small" effect="dark">
                      {{ record.action === 'approve' ? '审批通过' : record.action === 'reject' ? '审批驳回' : record.action === 'resubmit' ? '再次提交' : record.action }}
                    </el-tag>
                  </div>
                  <div v-if="record.action === 'reject' && record.comment" class="timeline-desc reject-reason">
                    驳回原因：{{ record.comment }}
                  </div>
                </div>
              </el-timeline-item>
            </template>
            <!-- 如果没有审批记录，显示简化版本 -->
            <template v-else>
              <el-timeline-item
                v-if="['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                :timestamp="currentApprovalRecord.approveTime ? formatDate(currentApprovalRecord.approveTime) : ''"
                placement="top"
                type="success"
              >
                <div class="timeline-content">
                  <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                  <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 审批通过</div>
                </div>
              </el-timeline-item>
              <el-timeline-item
                v-else-if="currentApprovalRecord.status === 'rejected'"
                :timestamp="currentApprovalRecord.approveTime ? formatDate(currentApprovalRecord.approveTime) : ''"
                placement="top"
                type="danger"
              >
                <div class="timeline-content">
                  <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                  <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 驳回了申请</div>
                  <div v-if="currentApprovalRecord.rejectReason" class="reject-reason-box">
                    <div class="reject-reason-label">驳回原因：</div>
                    <div class="reject-reason-text">{{ currentApprovalRecord.rejectReason }}</div>
                  </div>
                </div>
              </el-timeline-item>
              <el-timeline-item
                v-else-if="currentApprovalRecord.status === 'pending'"
                timestamp="待审批"
                placement="top"
                type="warning"
              >
                <div class="timeline-content">
                  <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                  <div class="timeline-desc">等待管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批...</div>
                </div>
              </el-timeline-item>
            </template>

            <!-- 驳回重新提交后，等待审批的下一步 -->
            <el-timeline-item
              v-if="currentApprovalRecord.status === 'pending' && approvalRecords.length > 0"
              timestamp="待审批"
              placement="top"
              type="warning"
            >
              <div class="timeline-content">
                <div class="timeline-title">管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批</div>
                <div class="timeline-desc">等待管理员{{ currentApprovalRecord.adminApproverName ? '（' + currentApprovalRecord.adminApproverName + '）' : '' }}审批...</div>
              </div>
            </el-timeline-item>

            <!-- 驳回后的下一步 -->
            <el-timeline-item
              v-if="currentApprovalRecord.status === 'rejected'"
              timestamp="待重新提交"
              placement="top"
              type="warning"
            >
              <div class="timeline-content">
                <div class="timeline-title">重新提交</div>
                <div class="timeline-desc">等待员工修改后重新提交...</div>
              </div>
            </el-timeline-item>

            <!-- 3. 财务付款 -->
            <el-timeline-item
              v-if="!isDeductionOnly && ['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
              :timestamp="currentApprovalRecord.status === 'approved' ? '待付款' : (currentApprovalRecord.payTime ? formatDate(currentApprovalRecord.payTime) : '')"
              placement="top"
              :type="currentApprovalRecord.status === 'approved' ? 'warning' : 'success'"
            >
              <div class="timeline-content">
                <div class="timeline-title">财务付款</div>
                <div class="timeline-desc">{{ currentApprovalRecord.status === 'approved' ? '等待财务付款...' : '财务已付款' }}</div>
              </div>
            </el-timeline-item>

            <!-- 4. 上传付款凭证 -->
            <el-timeline-item
              v-if="!isDeductionOnly && ['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
              :timestamp="currentApprovalRecord.paymentUploadTime ? formatDate(currentApprovalRecord.paymentUploadTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">上传付款凭证</div>
                <div class="timeline-desc">财务已上传付款凭证</div>
                <!-- 付款回单展示 -->
                <div v-if="currentApprovalRecord.paymentProofPath" class="payment-proof-preview">
                  <div v-for="(proofUrl, idx) in currentApprovalRecord.paymentProofPath.split(',')" :key="idx" class="proof-card" @click="handlePreviewPaymentProof(proofUrl)">
                    <template v-if="isImagePath(proofUrl)">
                      <img :src="toFileUrl(proofUrl)" class="proof-image" alt="付款回单" />
                    </template>
                    <template v-else>
                      <div class="proof-pdf">
                        <el-icon :size="32" color="#409EFF"><Document /></el-icon>
                        <span>付款回单.pdf</span>
                      </div>
                    </template>
                    <div class="proof-overlay">
                      <el-icon :size="20"><ZoomIn /></el-icon>
                      <span>点击查看</span>
                    </div>
                  </div>
                </div>
              </div>
            </el-timeline-item>

            <!-- 5. 员工确认收款 -->
            <el-timeline-item
              v-if="!isDeductionOnly && currentApprovalRecord.status === 'completed' && currentApprovalRecord.receiptConfirmedBy"
              :timestamp="currentApprovalRecord.completedTime ? formatDate(currentApprovalRecord.completedTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">确认收款</div>
                <div class="timeline-desc">{{ currentApprovalRecord.receiptConfirmedBy }}已确认收款</div>
              </div>
            </el-timeline-item>
            <el-timeline-item
              v-else-if="!isDeductionOnly && currentApprovalRecord.status === 'payment_uploaded'"
              timestamp="待确认收款"
              placement="top"
              type="warning"
            >
              <div class="timeline-content">
                <div class="timeline-title">确认收款</div>
                <div class="timeline-desc">等待员工确认收款...</div>
              </div>
            </el-timeline-item>

            <!-- 6. 付款完成 -->
            <el-timeline-item
              v-if="currentApprovalRecord.status === 'completed'"
              :timestamp="currentApprovalRecord.completedTime ? formatDate(currentApprovalRecord.completedTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">{{ isDeductionOnly ? '已计算到核减金额' : '流程完成' }}</div>
                <div class="timeline-desc">
                  {{ isDeductionOnly ? '核减金额已记录，报销流程已完成' : '报销流程已完成' }}
                </div>
              </div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>
      <template #footer>
        <el-button @click="approvalProcessDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleGoToReimbursementDetail">查看报销单</el-button>
      </template>
    </el-dialog>

    <!-- 付款回单预览对话框 -->
    <el-dialog v-model="paymentProofDialogVisible" title="付款回单" width="80%" :close-on-click-modal="true">
      <div class="preview-dialog-content">
        <img v-if="isImagePath(previewingProofUrl)" :src="previewingProofUrl" class="preview-dialog-image" alt="付款回单" />
        <iframe v-else-if="previewingProofUrl" :src="previewingProofUrl" class="preview-dialog-pdf" />
      </div>
    </el-dialog>

    <!-- 全部查询导出预览弹窗 -->
    <el-dialog v-model="allExportDialogVisible" title="导出报销数据" width="800px" :close-on-click-modal="false">
      <div v-if="allExportData" class="export-content">
        <!-- 汇总信息 -->
        <div class="export-summary">
          <h3>{{ allExportData.filterDesc }} 报销汇总</h3>
          <el-row :gutter="20">
            <el-col :span="8">
              <el-statistic title="员工人数" :value="allExportData.summary.employeeCount" suffix="人" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="报销笔数" :value="allExportData.summary.totalCount" suffix="笔" />
            </el-col>
            <el-col :span="8">
              <el-statistic title="报销总额" :value="allExportData.summary.totalAmount" :precision="2" prefix="¥" />
            </el-col>
          </el-row>
        </div>

        <!-- 报销范围汇总（如果有数据） -->
        <div v-if="allExportData.byScope && allExportData.byScope.length > 0" class="export-scope-summary">
          <h4>报销范围汇总</h4>
          <el-table :data="allExportData.byScope" border size="small" style="margin-top: 10px;">
            <el-table-column prop="scopeName" label="报销范围" min-width="150" />
            <el-table-column label="报销笔数" width="100" align="right">
              <template #default="{ row }">
                {{ row.count }} 笔
              </template>
            </el-table-column>
            <el-table-column label="报销金额" width="120" align="right">
              <template #default="{ row }">
                ¥{{ row.amount.toFixed(2) }}
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 员工明细 -->
        <div class="export-employees">
          <h4>员工明细</h4>
          <el-collapse v-model="allExportActiveCollapse">
            <el-collapse-item
              v-for="emp in allExportData.employees"
              :key="emp.userId"
              :name="emp.userId"
            >
              <template #title>
                <div class="employee-collapse-title">
                  <span class="emp-name">{{ emp.name }}</span>
                  <span class="emp-department" v-if="emp.department">{{ emp.department }}</span>
                  <span class="emp-stats">{{ emp.count }}笔 / ¥{{ emp.totalAmount.toFixed(2) }}</span>
                </div>
              </template>
              <el-table :data="emp.details" border size="small">
                <el-table-column prop="typeName" label="类型" width="80" />
                <el-table-column prop="title" label="报销事由" min-width="150">
                  <template #default="{ row }">
                    {{ normalizeReimbursementTitle(row.title) }}
                  </template>
                </el-table-column>
                <el-table-column label="金额" width="100">
                  <template #default="{ row }">
                    ¥{{ row.amount.toFixed(2) }}
                  </template>
                </el-table-column>
                <el-table-column prop="statusName" label="状态" width="80" />
                <el-table-column label="提交时间" width="140">
                  <template #default="{ row }">
                    {{ row.submitTime ? formatDate(row.submitTime) : '-' }}
                  </template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
          </el-collapse>
        </div>
      </div>
      <div v-else class="export-empty">
        <el-empty description="暂无报销数据" />
      </div>
      <template #footer>
        <el-button @click="allExportDialogVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Download" @click="handleDownloadAllExcel" :disabled="!allExportData || allExportData.employees.length === 0">
          导出Excel
        </el-button>
      </template>
    </el-dialog>

    <!-- 核减金额查询对话框 -->
    <el-dialog v-model="deductionDialogVisible" title="核减金额查询" width="1100px" :close-on-click-modal="false">
      <!-- 查询条件 -->
      <div class="deduction-filter">
        <el-form :inline="true" :model="deductionForm" class="filter-form">
          <el-form-item label="员工">
            <el-select
              v-model="deductionForm.userId"
              placeholder="全部员工"
              clearable
              filterable
              style="width: 150px"
            >
              <el-option
                v-for="emp in employeeList"
                :key="emp.id"
                :label="emp.name"
                :value="emp.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="日期范围">
            <el-date-picker
              v-model="deductionDateRangeModel"
              :type="deductionCurrentDatePickerType"
              :value-format="deductionCurrentDateValueFormat"
              :start-placeholder="deductionCurrentStartPlaceholder"
              :end-placeholder="deductionCurrentEndPlaceholder"
              range-separator="至"
              :shortcuts="deductionDateTypeShortcuts"
              style="width: 280px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" :loading="deductionLoading" @click="handleQueryDeduction">
              查询
            </el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 核减金额汇总 -->
      <div v-if="deductionResult" class="deduction-result">
        <div class="deduction-summary">
          <h4>{{ deductionResult.period }} 核减金额汇总</h4>
          <div class="summary-cards">
            <el-card class="summary-card">
              <div class="card-label">总核减金额</div>
              <div class="card-value total">¥{{ deductionResult.totalDeduction.toFixed(2) }}</div>
            </el-card>
            <el-card class="summary-card">
              <div class="card-label">核减笔数</div>
              <div class="card-value">{{ deductionResult.totalCount }} 笔</div>
            </el-card>
            <el-card class="summary-card">
              <div class="card-label">涉及员工</div>
              <div class="card-value">{{ deductionResult.employeeCount }} 人</div>
            </el-card>
          </div>
        </div>

        <!-- 员工明细 -->
        <div class="deduction-details">
          <h4>员工明细</h4>
          <el-table ref="deductionTableRef" :data="deductionResult.employees" border stripe row-key="userId" class="deduction-table" max-height="400">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="deduction-expand-content">
                  <el-table :data="row.details" border size="small">
                    <el-table-column label="序号" width="60" align="center">
                      <template #default="{ $index }">
                        {{ $index + 1 }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="typeName" label="报销类型" width="120" align="center" />
                    <el-table-column prop="title" label="报销事由" min-width="200" align="center">
                      <template #default="{ row }">
                        {{ normalizeReimbursementTitle(row.title) }}
                      </template>
                    </el-table-column>
                    <el-table-column label="核减金额" width="130" align="center">
                      <template #default="{ row: detail }">
                        <span style="color: #f56c6c; font-weight: 600;">¥{{ detail.deductionAmount.toFixed(2) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="提交时间" width="170" align="center">
                      <template #default="{ row: detail }">
                        {{ detail.submitTime ? formatDate(detail.submitTime) : '-' }}
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="序号" min-width="80" align="center" :resizable="false">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column prop="name" label="员工姓名" min-width="180" align="center" :resizable="false" />
            <el-table-column prop="department" label="部门" min-width="150" align="center" :resizable="false" />
            <el-table-column label="核减金额" min-width="150" align="center" :resizable="false">
              <template #default="{ row }">
                <span style="color: #f56c6c; font-weight: 600;">¥{{ row.deductionAmount.toFixed(2) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="核减笔数" min-width="120" align="center" :resizable="false">
              <template #default="{ row }">
                {{ row.deductionCount }} 笔
              </template>
            </el-table-column>
            <el-table-column label="明细" min-width="150" align="center" :resizable="false">
              <template #default="{ row }">
                <span class="deduction-toggle" @click="toggleDeductionExpand(row)">
                  查看明细 <span :class="['toggle-arrow', { expanded: expandedDeductionRows.has(row.userId) }]">›</span>
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <div v-else class="deduction-empty">
        <el-empty description="请选择查询条件后点击查询" />
      </div>

      <template #footer>
        <el-button @click="deductionDialogVisible = false">关闭</el-button>
        <el-button type="success" :icon="Download" @click="handleExportDeduction" :disabled="!deductionResult">
          导出Excel
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { User, Check, Close, View, Clock, Wallet, Money, SuccessFilled, Search, Download, Document, ZoomIn, List, Printer, WarningFilled } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { toFileUrl, isImageFile } from '@/utils/file'
import { usePendingStore } from '@/stores/pending'
import { normalizeReimbursementTitle } from '@/utils/reimbursement/date'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const router = useRouter()
const route = useRoute()
const pendingStore = usePendingStore()

interface ApprovalItem {
  id: string
  type: string
  targetId: string
  targetType: string
  applicantId?: string
  applicantName?: string
  applicantAvatar?: string
  currentStep: number
  status: string
  reimbursementStatus?: string
  submitTime: string
  completeTime?: string
  createdAt: string
  reimbursementInfo?: {
    title: string
    amount: number
  }
  reimbursementUserId?: string
}

interface ReimbursementItem {
  id: string
  type: string
  title: string
  amount: number
  status: string
  applicantName: string
  applicantAvatar?: string
  approveTime?: string
  approver?: string
  payTime?: string
  paymentUploadTime?: string
  completedTime?: string
  paymentProofPath?: string
  receiptConfirmedBy?: string
  userId: string
}

interface Statistics {
  pendingCount: number
  approvedUnpaid: number
  paidThisMonth: number
  paidThisMonthAmount: number
  completedThisMonth: number
  completedThisMonthAmount: number
  currentMonth: string
  basicStats: { count: number; amount: number }
  largeStats: { count: number; amount: number }
  businessStats: { count: number; amount: number }
}

// 使用 computed 直接绑定 URL 参数，确保标签页状态始终与 URL 同步
const activeTab = computed({
  get: () => {
    const tab = route.query.tab as string
    if (tab && ['pending', 'unpaid', 'paid', 'all', 'invoices'].includes(tab)) {
      return tab
    }
    return 'pending'
  },
  set: (value: string) => {
    router.replace({ query: { ...route.query, tab: value } })
  }
})
const pendingList = ref<ApprovalItem[]>([])
const pendingListLoading = ref(false)
// 待办筛选表单
const pendingFilterForm = reactive({
  userId: '',
  type: [] as string[],
  status: '',
  dateRange: null as [string, string] | null,
})
const unpaidList = ref<ReimbursementItem[]>([])
const unpaidListLoading = ref(false)
const paidList = ref<ReimbursementItem[]>([])
const paidListLoading = ref(false)

// 待付款筛选表单
const unpaidFilterForm = reactive({
  userId: '',
  type: '',
  status: '',
  dateRange: null as [string, string] | null,
})

// 已付款筛选表单
const paidFilterForm = reactive({
  userId: '',
  type: [] as string[],
  status: '',
  dateRange: null as [string, string] | null,
})
// 批量付款相关
const unpaidTableRef = ref()
const selectedUnpaidItems = ref<ReimbursementItem[]>([])
const batchPaymentLoading = ref(false)

const selectedUnpaidTotalAmount = computed(() => {
  return selectedUnpaidItems.value.reduce((sum, item) => sum + item.amount, 0)
})

const isSamePayee = computed(() => {
  if (selectedUnpaidItems.value.length === 0) return false
  const userIds = [...new Set(selectedUnpaidItems.value.map(item => item.userId))]
  return userIds.length === 1
})

const isSameType = computed(() => {
  if (selectedUnpaidItems.value.length === 0) return false
  const types = [...new Set(selectedUnpaidItems.value.map(item => item.type))]
  return types.length === 1
})

function handleUnpaidSelectionChange(selection: ReimbursementItem[]) {
  selectedUnpaidItems.value = selection
}

async function handleBatchPayment() {
  if (!isSamePayee.value || !isSameType.value) return

  const ids = selectedUnpaidItems.value.map(item => item.id)

  if (ids.length === 1) {
    // 单笔直接走原有付款流程
    router.push(`/approval/payment/${ids[0]}?from=/approval&tab=unpaid`)
    return
  }

  batchPaymentLoading.value = true
  try {
    const res = await api.post('/api/reimbursement/payment-batch/create', {
      reimbursementIds: ids,
    })
    if (res.data.success) {
      const batchId = res.data.data.batchId
      router.push(`/approval/batch-payment/${batchId}?from=/approval&tab=unpaid`)
    } else {
      ElMessage.error(res.data.message || '创建付款批次失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '创建付款批次失败')
  } finally {
    batchPaymentLoading.value = false
  }
}
const statistics = ref<Statistics>({
  pendingCount: 0,
  approvedUnpaid: 0,
  paidThisMonth: 0,
  paidThisMonthAmount: 0,
  completedThisMonth: 0,
  completedThisMonthAmount: 0,
  currentMonth: '',
  basicStats: { count: 0, amount: 0 },
  largeStats: { count: 0, amount: 0 },
  businessStats: { count: 0, amount: 0 },
})

// 驳回对话框
const rejectDialogVisible = ref(false)
const rejectLoading = ref(false)
const rejectFormRef = ref<FormInstance>()
const rejectForm = reactive({
  id: '',
  comment: '',
})
const rejectFormRules: FormRules = {
  comment: [
    { required: true, message: '请填写驳回原因', trigger: 'blur' },
    { min: 2, message: '驳回原因至少2个字符', trigger: 'blur' },
  ],
}

// 汇总查询相关
interface Employee {
  id: string
  name: string
  username: string
  department: string | null
  position: string | null
}

const employeeList = ref<Employee[]>([])

// 报销范围/区域数据
interface ScopeOption {
  value: string
  name: string
  children?: ScopeOption[]
}
const scopeList = ref<ScopeOption[]>([])
const scopeMap = ref<Record<string, string>>({}) // value -> 完整路径名称映射

// 递归收集某个节点下所有子孙的 value
function collectDescendantValues(items: ScopeOption[]): string[] {
  const result: string[] = []
  for (const item of items) {
    if (item.value) result.push(item.value)
    if (item.children?.length) {
      result.push(...collectDescendantValues(item.children))
    }
  }
  return result
}

// 展开选中的 scope：如果选中了父级，自动包含其所有子级 value
function expandScopeSelection(selectedValues: string[]): string[] {
  if (!selectedValues.length || !scopeList.value.length) return selectedValues

  const expanded = new Set<string>()

  // 在树中查找节点并收集其所有子孙
  function findAndExpand(items: ScopeOption[], targetValue: string): boolean {
    for (const item of items) {
      if (item.value === targetValue) {
        expanded.add(item.value)
        if (item.children?.length) {
          collectDescendantValues(item.children).forEach(v => expanded.add(v))
        }
        return true
      }
      if (item.children?.length && findAndExpand(item.children, targetValue)) {
        return true
      }
    }
    return false
  }

  for (const val of selectedValues) {
    findAndExpand(scopeList.value, val)
  }

  return Array.from(expanded)
}

// 全部查询相关
interface AllReimbursementItem {
  id: string
  type: string
  typeName: string
  title: string
  amount: number
  totalAmount?: number
  deductionAmount?: number
  status: string
  statusName: string
  applicantName: string
  applicantAvatar?: string
  applicantDepartment?: string
  submitTime?: string
  approveTime?: string
  approver?: string
  rejectReason?: string
  payTime?: string
  paymentUploadTime?: string
  completedTime?: string
  paymentProofPath?: string
  receiptConfirmedBy?: string
  reimbursementScope?: string // 报销范围/区域
  createdAt: string
  userId: string
}

const allFilterForm = reactive({
  userId: '',
  type: [] as string[], // 改为数组支持多选
  status: '',
  reimbursementScope: [] as string[], // 改为数组支持多选
  dateQueryType: 'day' as 'year' | 'month' | 'day', // 日期查询类型
  dateRange: null as [string, string] | null,
  yearRange: null as [string, string] | null,
  monthRange: null as [string, string] | null,
})
const allList = ref<AllReimbursementItem[]>([])
const allListLoading = ref(false)

// 当前日期选择器类型（yearrange / monthrange / daterange）
const currentDatePickerType = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return 'yearrange'
  if (allFilterForm.dateQueryType === 'month') return 'monthrange'
  return 'daterange'
})

// 不同查询类型下的 value-format
const currentDateValueFormat = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return 'YYYY'
  if (allFilterForm.dateQueryType === 'month') return 'YYYY-MM'
  return 'YYYY-MM-DD'
})

// 不同查询类型下的占位文案
const currentStartPlaceholder = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return '开始年份'
  if (allFilterForm.dateQueryType === 'month') return '开始月份'
  return '开始日期'
})

const currentEndPlaceholder = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return '结束年份'
  if (allFilterForm.dateQueryType === 'month') return '结束月份'
  return '结束日期'
})

// 统一给 el-date-picker 使用的 v-model，根据当前查询类型映射到不同字段
const dateRangeModel = computed<[string, string] | null>({
  get() {
    if (allFilterForm.dateQueryType === 'year') return allFilterForm.yearRange
    if (allFilterForm.dateQueryType === 'month') return allFilterForm.monthRange
    return allFilterForm.dateRange
  },
  set(val) {
    allFilterForm.yearRange = null
    allFilterForm.monthRange = null
    allFilterForm.dateRange = null
    if (!val) return
    if (allFilterForm.dateQueryType === 'year') {
      allFilterForm.yearRange = val
    } else if (allFilterForm.dateQueryType === 'month') {
      allFilterForm.monthRange = val
    } else {
      allFilterForm.dateRange = val
    }
  },
})

// 计算全部列表总金额
const allListTotalAmount = computed(() => {
  return allList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
})

// 判断是否选择了基础报销（用于禁用所属区域）
const isBasicReimbursementSelected = computed(() => {
  return allFilterForm.type.includes('basic')
})

// 计算全部列表按类型汇总
const allSummary = computed(() => {
  const typeMap: Record<string, string> = {
    basic: '基础报销',
    large: '大额报销',
    business: '商务报销',
  }

  const byTypeMap: Record<string, { type: string; typeName: string; count: number; amount: number }> = {}

  allList.value.forEach(item => {
    if (!byTypeMap[item.type]) {
      byTypeMap[item.type] = {
        type: item.type,
        typeName: typeMap[item.type] || item.type,
        count: 0,
        amount: 0,
      }
    }
    byTypeMap[item.type].count += 1
    byTypeMap[item.type].amount += item.amount || 0
  })

  // 固定排序：基础报销、大额报销、商务报销
  const typeOrder = ['basic', 'large', 'business']
  const sortedByType = typeOrder
    .filter(t => byTypeMap[t])
    .map(t => byTypeMap[t])

  return {
    byType: sortedByType,
    total: {
      count: allList.value.length,
      amount: allListTotalAmount.value,
    },
  }
})

// 审批流程弹窗相关
interface ApprovalProcessRecord {
  id: string
  targetId: string // 报销单ID
  type: string
  title: string
  amount: number
  totalAmount?: number
  deductionAmount?: number
  status: string
  applicantName: string
  applicantAvatar?: string
  submitTime?: string
  approveTime?: string
  approver?: string
  rejectReason?: string
  payTime?: string
  paymentUploadTime?: string
  completedTime?: string
  paymentProofPath?: string
  receiptConfirmedBy?: string
  description?: string
  adminApproverName?: string
  gmApproverName?: string
}

interface ApprovalRecordItem {
  id: string
  step: number
  approverId: string
  approverName: string
  approverAvatar: string | null
  action: 'approve' | 'reject' | 'comment' | 'payment_uploaded' | 'resubmit'
  comment: string | null
  actionTime: string
}

const approvalProcessDialogVisible = ref(false)
const currentApprovalRecord = ref<ApprovalProcessRecord | null>(null)
const approvalRecords = ref<ApprovalRecordItem[]>([])

// 付款回单预览
const paymentProofDialogVisible = ref(false)
const previewingProofUrl = ref('')

// 判断路径是否为图片
function isImagePath(p: string): boolean {
  return isImageFile(p)
}

// 判断是否为核减金额（报销金额为0，无需付款流程）
const isDeductionOnly = computed(() => {
  if (!currentApprovalRecord.value) return false
  const deductionAmount = currentApprovalRecord.value.deductionAmount || 0
  const totalAmount = currentApprovalRecord.value.totalAmount || currentApprovalRecord.value.amount || 0
  // 实际报销金额 = 总金额 - 核减金额
  const actualAmount = totalAmount - deductionAmount
  return actualAmount <= 0
})

// 全部查询导出相关
interface AllExportEmployee {
  userId: string
  name: string
  department: string | null
  totalAmount: number
  count: number
  details: Array<{
    id: string
    type: string
    typeName: string
    title: string
    amount: number
    status: string
    statusName: string
    submitTime?: string
  }>
}

interface AllExportData {
  filterDesc: string
  summary: {
    totalAmount: number
    totalCount: number
    employeeCount: number
  }
  byScope?: Array<{
    scope: string
    scopeName: string
    count: number
    amount: number
  }>
  employees: AllExportEmployee[]
}

const allExportDialogVisible = ref(false)
const allExportData = ref<AllExportData | null>(null)
const allExportActiveCollapse = ref<string[]>([])

// 核减金额查询相关
interface DeductionEmployee {
  userId: string
  name: string
  department: string | null
  deductionAmount: number
  deductionCount: number
  details: Array<{
    id: string
    type: string
    typeName: string
    title: string
    originalAmount: number
    deductionAmount: number
    deductionReason: string | null
    submitTime: string
  }>
}

interface DeductionResult {
  period: string
  totalDeduction: number
  totalCount: number
  employeeCount: number
  employees: DeductionEmployee[]
}

const deductionDialogVisible = ref(false)
const deductionLoading = ref(false)
const deductionForm = reactive({
  // 日期查询类型：年 / 月 / 日
  dateType: 'day' as 'year' | 'month' | 'day',
  // 按日范围
  dateRange: null as [string, string] | null,
  // 按年范围
  yearRange: null as [string, string] | null,
  // 按月范围
  monthRange: null as [string, string] | null,
  // 员工
  userId: '',
})
const deductionResult = ref<DeductionResult | null>(null)
const deductionTableRef = ref<InstanceType<typeof import('element-plus')['ElTable']>>()
const expandedDeductionRows = ref<Set<string>>(new Set())

function toggleDeductionExpand(row: DeductionEmployee) {
  const table = deductionTableRef.value
  if (!table) return
  if (expandedDeductionRows.value.has(row.userId)) {
    expandedDeductionRows.value.delete(row.userId)
  } else {
    expandedDeductionRows.value.add(row.userId)
  }
  table.toggleRowExpansion(row)
}

// 核减查询日期选择器类型
const deductionCurrentDatePickerType = computed(() => {
  if (deductionForm.dateType === 'year') return 'yearrange'
  if (deductionForm.dateType === 'month') return 'monthrange'
  return 'daterange'
})

// 核减查询日期 value-format
const deductionCurrentDateValueFormat = computed(() => {
  if (deductionForm.dateType === 'year') return 'YYYY'
  if (deductionForm.dateType === 'month') return 'YYYY-MM'
  return 'YYYY-MM-DD'
})

// 核减查询日期占位
const deductionCurrentStartPlaceholder = computed(() => {
  if (deductionForm.dateType === 'year') return '开始年份'
  if (deductionForm.dateType === 'month') return '开始月份'
  return '开始日期'
})

const deductionCurrentEndPlaceholder = computed(() => {
  if (deductionForm.dateType === 'year') return '结束年份'
  if (deductionForm.dateType === 'month') return '结束月份'
  return '结束日期'
})

// 核减查询统一 v-model
const deductionDateRangeModel = computed<[string, string] | null>({
  get() {
    if (deductionForm.dateType === 'year') return deductionForm.yearRange
    if (deductionForm.dateType === 'month') return deductionForm.monthRange
    return deductionForm.dateRange
  },
  set(val) {
    deductionForm.yearRange = null
    deductionForm.monthRange = null
    deductionForm.dateRange = null
    if (!val) return
    if (deductionForm.dateType === 'year') {
      deductionForm.yearRange = val
    } else if (deductionForm.dateType === 'month') {
      deductionForm.monthRange = val
    } else {
      deductionForm.dateRange = val
    }
  },
})

// ==================== 发票管理相关 ====================
interface InvoiceManagementItem {
  id: string
  reimbursementId: string
  amount: number
  invoiceDate: string
  invoiceNumber: string
  filePath: string
  fileType: 'invoice' | 'receipt'
  category: string
  deductedAmount: number
  seller: string
  buyer: string
  reimbursementType: string
  reimbursementTypeName: string
  reimbursementTitle: string
  reimbursementScope: string
  reimbursementStatus: string // 报销单状态
  userId: string
  userName: string
  userDepartment: string
  createdAt: string
}

const invoiceFilterForm = reactive({
  userId: '',
  type: [] as string[],
  fileType: '',
  reimbursementScope: [] as string[],
  dateQueryType: 'day' as 'month' | 'day',
  dateRange: null as [string, string] | null,
  monthRange: null as [string, string] | null,
})

const invoiceList = ref<InvoiceManagementItem[]>([])
const invoiceListLoading = ref(false)
const selectedInvoiceIds = ref<string[]>([])
const batchDownloading = ref(false)
const invoicePreviewDialogVisible = ref(false)
const previewInvoicePath = ref('')
// 核减发票总金额（从后端API返回）
const deductionInvoicesTotal = ref(0)

// 发票日期选择器类型
const invoiceDatePickerType = computed(() => {
  return invoiceFilterForm.dateQueryType === 'month' ? 'monthrange' : 'daterange'
})

const invoiceDateValueFormat = computed(() => {
  return invoiceFilterForm.dateQueryType === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'
})

const invoiceDateStartPlaceholder = computed(() => {
  return invoiceFilterForm.dateQueryType === 'month' ? '开始月份' : '开始日期'
})

const invoiceDateEndPlaceholder = computed(() => {
  return invoiceFilterForm.dateQueryType === 'month' ? '结束月份' : '结束日期'
})

const invoiceDateRangeModel = computed<[string, string] | null>({
  get() {
    if (invoiceFilterForm.dateQueryType === 'month') return invoiceFilterForm.monthRange
    return invoiceFilterForm.dateRange
  },
  set(val) {
    invoiceFilterForm.monthRange = null
    invoiceFilterForm.dateRange = null
    if (!val) return
    if (invoiceFilterForm.dateQueryType === 'month') {
      invoiceFilterForm.monthRange = val
    } else {
      invoiceFilterForm.dateRange = val
    }
  },
})

// 发票日期快捷切换
const invoiceDateShortcuts = [
  {
    text: '日',
    onClick: () => {
      invoiceFilterForm.dateQueryType = 'day'
      invoiceFilterForm.dateRange = null
      invoiceFilterForm.monthRange = null
    },
  },
  {
    text: '月',
    onClick: () => {
      invoiceFilterForm.dateQueryType = 'month'
      invoiceFilterForm.dateRange = null
      invoiceFilterForm.monthRange = null
    },
  },
]

// 已付款状态列表
const paidStatuses = ['payment_uploaded', 'completed']

// 发票总金额（仅统计已付款的）
const invoiceTotalAmount = computed(() => {
  const regularInvoices = invoiceList.value
    .filter(item => paidStatuses.includes(item.reimbursementStatus))
    .reduce((sum, item) => sum + (item.amount || 0), 0)
  // 加上核减发票总金额
  return regularInvoices + deductionInvoicesTotal.value
})

// 发票核减总金额（仅统计已付款的）
// 包括：基础报销发票的核减金额 + 核减发票的金额
const invoiceTotalDeductedAmount = computed(() => {
  const invoiceDeductions = invoiceList.value
    .filter(item => paidStatuses.includes(item.reimbursementStatus))
    .reduce((sum, item) => sum + (item.deductedAmount || 0), 0)
  console.log('[发票管理] 发票核减:', invoiceDeductions, '核减发票总额:', deductionInvoicesTotal.value, '合计:', invoiceDeductions + deductionInvoicesTotal.value)
  // 加上核减发票总金额
  return invoiceDeductions + deductionInvoicesTotal.value
})

// 实报总金额
const invoiceActualAmount = computed(() => {
  return invoiceTotalAmount.value - invoiceTotalDeductedAmount.value
})

// 全选相关
const invoiceSelectAll = computed({
  get() {
    return invoiceList.value.length > 0 && selectedInvoiceIds.value.length === invoiceList.value.length
  },
  set(val: boolean) {
    if (val) {
      selectedInvoiceIds.value = invoiceList.value.map(inv => inv.id)
    } else {
      selectedInvoiceIds.value = []
    }
  },
})

const invoiceSelectIndeterminate = computed(() => {
  return selectedInvoiceIds.value.length > 0 && selectedInvoiceIds.value.length < invoiceList.value.length
})

// 预览发票是否为图片
const previewInvoiceIsImage = computed(() => {
  return isImageFile(previewInvoicePath.value)
})

// 获取类型标签
function getTypeTagType(type: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    worklog: 'info',
    basic: 'success',
    large: 'warning',
    business: 'danger',
    reimbursement_basic: 'success',
    reimbursement_large: 'warning',
    reimbursement_business: 'danger',
    leave: 'info',
  }
  return typeMap[type] || 'info'
}

// 获取类型文字
function getTypeLabel(type: string): string {
  const typeMap: Record<string, string> = {
    worklog: '工作日志',
    basic: '基础报销',
    large: '大额报销',
    business: '商务报销',
    reimbursement_basic: '基础报销',
    reimbursement_large: '大额报销',
    reimbursement_business: '商务报销',
    leave: '请假',
  }
  return typeMap[type] || type
}

// 格式化日期
function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  // 兼容旧格式 "YYYY-MM-DD HH:mm:ss"，替换空格为T确保跨浏览器解析
  const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 格式化提交时间（后端已返回最终格式 YYYY-MM-DD HH:mm）
function formatSubmitTime(dateStr: string | undefined) {
  if (!dateStr) return '-'
  return dateStr
}

// 加载统计数据
async function loadStatistics() {
  try {
    const res = await api.get('/api/approval/statistics')
    if (res.data.success) {
      statistics.value = res.data.data
    }
  } catch {
    console.error('加载统计数据失败')
  }
}

// 加载待审批列表
async function loadPendingList() {
  pendingListLoading.value = true
  try {
    const params: Record<string, string> = {}
    if (pendingFilterForm.userId) params.userId = pendingFilterForm.userId
    if (pendingFilterForm.type.length > 0) params.type = pendingFilterForm.type.join(',')
    if (pendingFilterForm.status) params.status = pendingFilterForm.status
    if (pendingFilterForm.dateRange) {
      params.startDate = pendingFilterForm.dateRange[0]
      params.endDate = pendingFilterForm.dateRange[1]
    }
    const res = await api.get('/api/approval/pending', { params })
    if (res.data.success) {
      pendingList.value = res.data.data
    }
  } catch {
    console.error('加载待审批列表失败')
  } finally {
    pendingListLoading.value = false
  }
}

// 待办查询
function handleQueryPendingList() {
  loadPendingList()
}

// 待办重置
function handleResetPendingFilter() {
  pendingFilterForm.userId = ''
  pendingFilterForm.type = []
  pendingFilterForm.status = ''
  pendingFilterForm.dateRange = null
  loadPendingList()
}

// 加载已通过未付款列表
async function loadUnpaidList() {
  unpaidListLoading.value = true
  try {
    const params: Record<string, string> = {}
    if (unpaidFilterForm.userId) params.userId = unpaidFilterForm.userId
    if (unpaidFilterForm.type) params.type = unpaidFilterForm.type
    if (unpaidFilterForm.status) params.status = unpaidFilterForm.status
    if (unpaidFilterForm.dateRange) {
      params.startDate = unpaidFilterForm.dateRange[0]
      params.endDate = unpaidFilterForm.dateRange[1]
    }
    const res = await api.get('/api/approval/approved-unpaid', { params })
    if (res.data.success) {
      unpaidList.value = res.data.data
    }
  } catch {
    console.error('加载已通过未付款列表失败')
  } finally {
    unpaidListLoading.value = false
  }
}

// 加载已付款列表
async function loadPaidList() {
  paidListLoading.value = true
  try {
    const params: Record<string, string> = {}
    if (paidFilterForm.userId) params.userId = paidFilterForm.userId
    if (paidFilterForm.type.length > 0) params.type = paidFilterForm.type.join(',')
    if (paidFilterForm.status) params.status = paidFilterForm.status
    if (paidFilterForm.dateRange) {
      params.startDate = paidFilterForm.dateRange[0]
      params.endDate = paidFilterForm.dateRange[1]
    }
    const res = await api.get('/api/approval/paid-this-month', { params })
    if (res.data.success) {
      paidList.value = res.data.data
    }
  } catch {
    console.error('加载已付款列表失败')
  } finally {
    paidListLoading.value = false
  }
}

// 待付款查询
function handleQueryUnpaidList() {
  loadUnpaidList()
}

// 待付款重置
function handleResetUnpaidFilter() {
  unpaidFilterForm.userId = ''
  unpaidFilterForm.type = ''
  unpaidFilterForm.status = ''
  unpaidFilterForm.dateRange = null
  loadUnpaidList()
}

// 已付款查询
function handleQueryPaidList() {
  loadPaidList()
}

// 已付款重置
function handleResetPaidFilter() {
  paidFilterForm.userId = ''
  paidFilterForm.type = []
  paidFilterForm.status = ''
  paidFilterForm.dateRange = null
  loadPaidList()
}

// 切换tab
function switchTab(tab: string) {
  activeTab.value = tab  // 这会触发 computed setter，自动更新 URL
  // 手动触发数据加载
  if (tab === 'pending') {
    loadPendingList()
  } else if (tab === 'unpaid') {
    loadUnpaidList()
  } else if (tab === 'paid') {
    loadPaidList()
  }
}

// Tab切换处理
function handleTabChange(tab: string | number) {
  if (tab === 'pending') {
    loadPendingList()
  } else if (tab === 'unpaid') {
    loadUnpaidList()
  } else if (tab === 'paid') {
    loadPaidList()
  } else if (tab === 'all') {
    // 全部查询tab不自动加载数据，保留用户的查询结果
    // 员工列表在 onMounted 时已加载
  } else if (tab === 'invoices') {
    // 发票管理tab不自动加载数据，需要用户设置筛选条件后查询
  }
}

// 通过审批
async function handleApprove(item: ApprovalItem) {
  try {
    await ElMessageBox.confirm('确定通过此审批？', '确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'info',
    })

    const res = await api.post(`/api/approval/${item.id}/approve`)
    if (res.data.success) {
      ElMessage.success('审批已通过')
      // 立即刷新菜单栏角标
      await pendingStore.refreshPendingCounts()
      loadStatistics()
      // 保持在当前页面，刷新当前标签页数据
      handleTabChange(activeTab.value)
    }
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error(err.response?.data?.message || '操作失败')
    }
  }
}

// 驳回审批
function handleReject(item: ApprovalItem) {
  rejectForm.id = item.id
  rejectForm.comment = ''
  rejectDialogVisible.value = true
}

// 确认驳回
async function confirmReject() {
  if (!rejectFormRef.value) return

  try {
    await rejectFormRef.value.validate()
  } catch {
    return
  }

  try {
    rejectLoading.value = true
    const res = await api.post(`/api/approval/${rejectForm.id}/reject`, {
      comment: rejectForm.comment,
    })
    if (res.data.success) {
      ElMessage.success('审批已驳回')
      rejectDialogVisible.value = false
      // 立即刷新菜单栏角标
      await pendingStore.refreshPendingCounts()
      loadStatistics()
      // 保持在当前页面，刷新当前标签页数据
      handleTabChange(activeTab.value)
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '操作失败')
  } finally {
    rejectLoading.value = false
  }
}

// 查看报销单详情（待审批/本月已通过）
function handleViewReimbursement(item: ApprovalItem) {
  const typeMap: Record<string, string> = {
    reimbursement_basic: '/basic-reimbursement',
    reimbursement_large: '/large-reimbursement',
    reimbursement_business: '/business-reimbursement',
  }
  const routePath = typeMap[item.type]
  if (routePath) {
    router.push(`${routePath}/${item.targetId}?mode=view&from=/approval&tab=${activeTab.value}`)
  }
}

// 查看待审批报销单的审批流程
async function handleViewApprovalProcessFromPending(item: ApprovalItem) {
  // 先设置当前审批记录信息
  currentApprovalRecord.value = {
    id: item.id,
    targetId: item.targetId, // 报销单ID
    type: item.type,
    title: item.reimbursementInfo?.title || '',
    amount: item.reimbursementInfo?.amount || 0,
    applicantName: item.applicantName || '',
    applicantAvatar: item.applicantAvatar || '',
    submitTime: item.submitTime,
    status: item.status,
    approveTime: '',
    approver: '',
    rejectReason: '',
    payTime: '',
    paymentUploadTime: '',
    completedTime: '',
    paymentProofPath: '',
    receiptConfirmedBy: '',
    description: '',
  }

  // 加载审批记录（会用最新状态覆盖）
  await loadApprovalRecords(item.targetId)

  approvalProcessDialogVisible.value = true
}

// 查看已通过未付款报销单的审批流程
async function handleViewApprovalProcessFromUnpaid(item: ReimbursementItem) {
  // 先设置当前审批记录信息
  currentApprovalRecord.value = {
    id: item.id,
    targetId: item.id, // 报销单ID（已通过未付款的item.id就是报销单ID）
    type: item.type,
    title: item.title,
    amount: item.amount,
    applicantName: item.applicantName,
    applicantAvatar: item.applicantAvatar || '',
    submitTime: '',
    status: item.status,
    approveTime: item.approveTime || '',
    approver: item.approver || '',
    rejectReason: '',
    payTime: item.payTime || '',
    paymentUploadTime: item.paymentUploadTime || '',
    completedTime: item.completedTime || '',
    paymentProofPath: item.paymentProofPath || '',
    receiptConfirmedBy: item.receiptConfirmedBy || '',
    description: '',
  }

  // 加载审批记录（会用最新状态覆盖）
  await loadApprovalRecords(item.id)

  approvalProcessDialogVisible.value = true
}

// 查看未付款报销单详情
function handleViewUnpaidReimbursement(item: ReimbursementItem) {
  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[item.type]
  if (routePath) {
    router.push(`${routePath}/${item.id}?mode=view&from=/approval&tab=unpaid`)
  }
}

// 进入付款页面（从未付款列表）
function handlePayment(item: ReimbursementItem) {
  router.push(`/approval/payment/${item.id}?from=/approval&tab=unpaid`)
}

// 从待办列表进入付款页面
function handlePaymentFromPending(item: ApprovalItem) {
  router.push(`/approval/payment/${item.targetId}?from=/approval&tab=pending`)
}

// 查看已付款报销单详情
function handleViewPaidReimbursement(item: ReimbursementItem) {
  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[item.type]
  if (routePath) {
    router.push(`${routePath}/${item.id}?mode=view&from=/approval&tab=paid`)
  }
}

// 加载员工列表
async function loadEmployeeList() {
  try {
    const res = await api.get('/api/approval/employees')
    if (res.data.success) {
      employeeList.value = res.data.data
    }
  } catch {
    console.error('加载员工列表失败')
  }
}

// 加载报销范围列表
async function loadScopeList() {
  try {
    const res = await api.get('/api/reimbursement-scope/list')
    if (res.data.success) {
      scopeList.value = res.data.data
      // 递归构建 value -> 完整路径名称 映射
      const buildMap = (items: ScopeOption[], parentName = '') => {
        for (const item of items) {
          if (item.value) {
            const fullName = parentName ? `${parentName} / ${item.name}` : item.name
            scopeMap.value[item.value] = fullName
          }
          if (item.children?.length) {
            buildMap(item.children, item.name)
          }
        }
      }
      buildMap(scopeList.value)
    }
  } catch {
    console.error('加载报销范围列表失败')
  }
}

// 查看审批流程（从全部查询tab）
async function handleViewApprovalProcessFromAll(row: AllReimbursementItem) {
  currentApprovalRecord.value = {
    id: row.id,
    targetId: row.id, // 报销单ID
    type: row.type,
    title: row.title,
    amount: row.amount,
    totalAmount: row.totalAmount,
    deductionAmount: row.deductionAmount,
    status: row.status,
    applicantName: row.applicantName,
    submitTime: row.submitTime,
    approveTime: row.approveTime,
    approver: row.approver,
    rejectReason: row.rejectReason,
    payTime: row.payTime,
    paymentUploadTime: row.paymentUploadTime,
    completedTime: row.completedTime,
    paymentProofPath: row.paymentProofPath,
    receiptConfirmedBy: row.receiptConfirmedBy,
    description: '',
  }

  // 加载审批记录
  await loadApprovalRecords(row.id)

  approvalProcessDialogVisible.value = true
}

// 加载审批记录
async function loadApprovalRecords(reimbursementId: string) {
  try {
    const res = await api.get(`/api/approval/by-target`, {
      params: {
        targetId: reimbursementId,
        targetType: 'reimbursement',
      },
    })

    if (res.data.success && res.data.data) {
      approvalRecords.value = res.data.data.records || []

      // 用最新的报销单状态覆盖弹窗数据
      if (currentApprovalRecord.value && res.data.data.reimbursementStatus) {
        currentApprovalRecord.value.status = res.data.data.reimbursementStatus
        if (res.data.data.paymentProofPath) {
          currentApprovalRecord.value.paymentProofPath = res.data.data.paymentProofPath
        }
        if (res.data.data.payTime) {
          currentApprovalRecord.value.payTime = res.data.data.payTime
        }
        if (res.data.data.paymentUploadTime) {
          currentApprovalRecord.value.paymentUploadTime = res.data.data.paymentUploadTime
        }
        if (res.data.data.completedTime) {
          currentApprovalRecord.value.completedTime = res.data.data.completedTime
        }
        if (res.data.data.receiptConfirmedBy) {
          currentApprovalRecord.value.receiptConfirmedBy = res.data.data.receiptConfirmedBy
        }
        // 更新详细说明
        if (res.data.data.reimbursementDescription) {
          currentApprovalRecord.value.description = res.data.data.reimbursementDescription
        }
        // 更新审批人名字
        if (res.data.data.adminApproverName) {
          currentApprovalRecord.value.adminApproverName = res.data.data.adminApproverName
        }
        if (res.data.data.gmApproverName) {
          currentApprovalRecord.value.gmApproverName = res.data.data.gmApproverName
        }
      }
    }
  } catch (error) {
    console.error('加载审批记录失败:', error)
    approvalRecords.value = []
  }
}

// 预览付款回单
function handlePreviewPaymentProof(url?: string) {
  const raw = url || currentApprovalRecord.value?.paymentProofPath?.split(',')[0] || ''
  previewingProofUrl.value = toFileUrl(raw)
  paymentProofDialogVisible.value = true
}

// 跳转到报销单详情
function handleGoToReimbursementDetail() {
  if (!currentApprovalRecord.value) return

  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
    reimbursement_basic: '/basic-reimbursement',
    reimbursement_large: '/large-reimbursement',
    reimbursement_business: '/business-reimbursement',
  }
  const routePath = typeMap[currentApprovalRecord.value.type]
  if (routePath) {
    approvalProcessDialogVisible.value = false
    router.push(`${routePath}/${currentApprovalRecord.value.targetId}?mode=view&from=/approval&tab=${activeTab.value}`)
  }
}

// 获取状态标签类型（全部查询用）
function getAllStatusType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    draft: 'info',
    pending: 'warning',
    approved: 'primary',
    rejected: 'danger',
    payment_uploaded: 'success',
    completed: 'success',
  }
  return typeMap[status] || 'info'
}

// 获取待办列表中的状态显示文字（综合审批状态和报销单状态）
function getPendingStatusLabel(row: ApprovalItem): string {
  if (row.reimbursementStatus === 'completed') return '已完成'
  if (row.reimbursementStatus === 'payment_uploaded') return '待确认'
  if (row.status === 'approved' || row.reimbursementStatus === 'approved') return '待付款'
  if (row.status === 'pending') return '待审批'
  return '待审批'
}

// 获取待办列表中的状态标签类型
function getPendingStatusTagType(row: ApprovalItem): 'success' | 'info' | 'warning' | 'danger' {
  if (row.reimbursementStatus === 'completed') return 'success'
  if (row.reimbursementStatus === 'payment_uploaded') return 'info'
  if (row.status === 'approved' || row.reimbursementStatus === 'approved') return 'info'
  if (row.status === 'pending') return 'warning'
  return 'info'
}

// 获取待办列表中的状态自定义颜色
function getPendingStatusColor(row: ApprovalItem): string {
  if (row.reimbursementStatus === 'payment_uploaded') return '#17a2b8'
  if (row.status === 'approved' || row.reimbursementStatus === 'approved') return '#409eff'
  return ''
}

// 获取状态标签文字
function getStatusLabel(status: string): string {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '待付款',
    rejected: '已驳回',
    payment_uploaded: '待确认',
    completed: '已完成',
  }
  return statusMap[status] || status
}

// 加载全部列表
async function loadAllList() {
  try {
    allListLoading.value = true
    const params: any = {}

    if (allFilterForm.userId) {
      params.userId = allFilterForm.userId
    }
    // 类型支持多选，传递数组
    if (allFilterForm.type && allFilterForm.type.length > 0) {
      params.type = allFilterForm.type.join(',')
    }
    if (allFilterForm.status) {
      params.status = allFilterForm.status
    }
    // 所属区域支持多选，选择父级时自动包含所有子级
    if (allFilterForm.reimbursementScope && allFilterForm.reimbursementScope.length > 0) {
      const expandedScopes = expandScopeSelection(allFilterForm.reimbursementScope)
      params.reimbursementScope = expandedScopes.join(',')
    }

    // 根据日期查询类型设置日期参数
    if (allFilterForm.dateQueryType === 'day' && allFilterForm.dateRange && allFilterForm.dateRange[0] && allFilterForm.dateRange[1]) {
      // 按日期范围查询
      params.startDate = allFilterForm.dateRange[0]
      params.endDate = allFilterForm.dateRange[1]
    } else if (allFilterForm.dateQueryType === 'month' && allFilterForm.monthRange && allFilterForm.monthRange[0] && allFilterForm.monthRange[1]) {
      // 按月查询
      const [startYear, startMonth] = allFilterForm.monthRange[0].split('-')
      const [endYear, endMonth] = allFilterForm.monthRange[1].split('-')
      params.startDate = `${startYear}-${startMonth}-01`
      const lastDay = new Date(parseInt(endYear), parseInt(endMonth), 0).getDate()
      params.endDate = `${endYear}-${endMonth}-${String(lastDay).padStart(2, '0')}`
    } else if (allFilterForm.dateQueryType === 'year' && allFilterForm.yearRange && allFilterForm.yearRange[0] && allFilterForm.yearRange[1]) {
      // 按年查询
      params.startDate = `${allFilterForm.yearRange[0]}-01-01`
      params.endDate = `${allFilterForm.yearRange[1]}-12-31`
    }

    const res = await api.get('/api/approval/all-reimbursements', { params })
    if (res.data.success) {
      allList.value = res.data.data
      // 保存查询结果和筛选条件到 sessionStorage
      saveAllQueryState()
    } else {
      ElMessage.error(res.data.message || '查询失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '查询失败')
  } finally {
    allListLoading.value = false
  }
}

// 保存全部查询状态到 sessionStorage
function saveAllQueryState() {
  try {
    const state = {
      allList: allList.value,
      allFilterForm: {
        userId: allFilterForm.userId,
        type: allFilterForm.type,
        status: allFilterForm.status,
        reimbursementScope: allFilterForm.reimbursementScope,
        dateQueryType: allFilterForm.dateQueryType,
        dateRange: allFilterForm.dateRange,
        yearRange: allFilterForm.yearRange,
        monthRange: allFilterForm.monthRange,
      },
    }
    sessionStorage.setItem('approval_all_query_state', JSON.stringify(state))
  } catch (err) {
    console.error('保存查询状态失败:', err)
  }
}

// 从 sessionStorage 恢复全部查询状态
function restoreAllQueryState() {
  try {
    const stateStr = sessionStorage.getItem('approval_all_query_state')
    if (stateStr) {
      const state = JSON.parse(stateStr)
      allList.value = state.allList || []
      if (state.allFilterForm) {
        allFilterForm.userId = state.allFilterForm.userId || ''
        allFilterForm.type = state.allFilterForm.type || []
        allFilterForm.status = state.allFilterForm.status || ''
        allFilterForm.reimbursementScope = state.allFilterForm.reimbursementScope || []
        allFilterForm.dateQueryType = state.allFilterForm.dateQueryType || 'day'
        allFilterForm.dateRange = state.allFilterForm.dateRange || null
        allFilterForm.yearRange = state.allFilterForm.yearRange || null
        allFilterForm.monthRange = state.allFilterForm.monthRange || null
      }
    }
  } catch (err) {
    console.error('恢复查询状态失败:', err)
  }
}

// 处理日期查询类型变化
function handleDateQueryTypeChange(type: 'year' | 'month' | 'day') {
  allFilterForm.dateQueryType = type
  // 清空所有日期字段
  allFilterForm.dateRange = null
  allFilterForm.yearRange = null
  allFilterForm.monthRange = null
}

// 日期选择器左侧快捷选项 - 切换查询类型但不直接关闭面板
const dateTypeShortcuts = [
  {
    text: '年',
    onClick: () => {
      handleDateQueryTypeChange('year')
    },
  },
  {
    text: '月',
    onClick: () => {
      handleDateQueryTypeChange('month')
    },
  },
  {
    text: '日',
    onClick: () => {
      handleDateQueryTypeChange('day')
    },
  },
]

// 查询全部列表
function handleQueryAllList() {
  loadAllList()
}

// 重置全部筛选
function handleResetAllFilter() {
  allFilterForm.userId = ''
  allFilterForm.type = []
  allFilterForm.status = ''
  allFilterForm.reimbursementScope = []
  allFilterForm.dateQueryType = 'day'
  allFilterForm.dateRange = null
  allFilterForm.yearRange = null
  allFilterForm.monthRange = null
  allList.value = []
  // 清除 sessionStorage 中的查询状态
  sessionStorage.removeItem('approval_all_query_state')
}

// 导出全部列表数据（显示预览弹窗）
function handleExportAllList() {
  if (allList.value.length === 0) {
    ElMessage.warning('没有可导出的数据')
    return
  }

  // 获取筛选条件描述
  const filterDesc: string[] = []
  if (allFilterForm.userId) {
    const emp = employeeList.value.find(e => e.id === allFilterForm.userId)
    if (emp) filterDesc.push(emp.name)
  } else {
    filterDesc.push('全部员工')
  }
  if (allFilterForm.dateRange && allFilterForm.dateRange[0] && allFilterForm.dateRange[1]) {
    filterDesc.push(`${allFilterForm.dateRange[0]}至${allFilterForm.dateRange[1]}`)
  }

  // 按员工分组统计
  const employeeSummary: Record<string, AllExportEmployee> = {}

  allList.value.forEach(item => {
    const userId = item.userId
    if (!employeeSummary[userId]) {
      employeeSummary[userId] = {
        userId,
        name: item.applicantName,
        department: item.applicantDepartment || null,
        totalAmount: 0,
        count: 0,
        details: [],
      }
    }

    employeeSummary[userId].totalAmount += item.amount || 0
    employeeSummary[userId].count += 1
    employeeSummary[userId].details.push({
      id: item.id,
      type: item.type,
      typeName: item.typeName,
      title: item.title,
      amount: item.amount,
      status: item.status,
      statusName: item.statusName,
      submitTime: item.submitTime,
    })
  })

  // 转换为数组格式
  const employeeListData = Object.values(employeeSummary)

  // 按报销范围分类统计（仅统计大额和商务报销）
  const byScopeMap: Record<string, { scope: string; scopeName: string; count: number; amount: number }> = {}
  allList.value.forEach(item => {
    // 只统计有报销范围的记录（大额和商务报销）
    if (item.reimbursementScope && (item.type === 'large' || item.type === 'business')) {
      if (!byScopeMap[item.reimbursementScope]) {
        byScopeMap[item.reimbursementScope] = {
          scope: item.reimbursementScope,
          scopeName: scopeMap.value[item.reimbursementScope] || item.reimbursementScope,
          count: 0,
          amount: 0,
        }
      }
      byScopeMap[item.reimbursementScope].count += 1
      byScopeMap[item.reimbursementScope].amount += item.amount || 0
    }
  })
  const byScopeData = Object.values(byScopeMap)

  // 设置导出数据
  allExportData.value = {
    filterDesc: filterDesc.join(' '),
    summary: {
      totalAmount: allListTotalAmount.value,
      totalCount: allList.value.length,
      employeeCount: employeeListData.length,
    },
    byScope: byScopeData.length > 0 ? byScopeData : undefined,
    employees: employeeListData,
  }

  // 默认展开所有员工
  allExportActiveCollapse.value = employeeListData.map(e => e.userId)

  // 显示预览弹窗
  allExportDialogVisible.value = true
}

// 下载全部查询Excel
function handleDownloadAllExcel() {
  if (!allExportData.value || allExportData.value.employees.length === 0) {
    ElMessage.warning('没有可导出的数据')
    return
  }

  // 生成CSV内容
  const headers = ['员工', '部门', '报销类型', '报销事由', '金额', '状态', '提交时间']
  const rows: string[][] = []

  allExportData.value.employees.forEach(emp => {
    emp.details.forEach(detail => {
      rows.push([
        emp.name,
        emp.department || '',
        detail.typeName,
        detail.title,
        detail.amount.toFixed(2),
        detail.statusName,
        detail.submitTime || '',
      ])
    })
  })

  // 添加汇总行
  rows.push([])
  rows.push(['汇总', '', '', '', allExportData.value.summary.totalAmount.toFixed(2), `共${allExportData.value.summary.totalCount}笔`, ''])

  // 按类型汇总
  if (allSummary.value.byType.length > 0) {
    rows.push([])
    rows.push(['分类汇总', '', '', '', '', '', ''])
    allSummary.value.byType.forEach(item => {
      rows.push(['', '', item.typeName, '', item.amount.toFixed(2), `${item.count}笔`, ''])
    })
  }

  // 按报销范围汇总（如果有数据）
  if (allExportData.value.byScope && allExportData.value.byScope.length > 0) {
    rows.push([])
    rows.push(['报销范围汇总', '', '', '', '', '', ''])
    allExportData.value.byScope.forEach(item => {
      rows.push(['', '', item.scopeName, '', item.amount.toFixed(2), `${item.count}笔`, ''])
    })
  }

  // 转换为CSV格式
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n')

  // 添加BOM以支持中文
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `报销数据_${allExportData.value.filterDesc.replace(/\s+/g, '_')}.csv`
  link.click()
  URL.revokeObjectURL(url)

  ElMessage.success('导出成功')
}

// 打开核减金额查询对话框
function handleOpenDeductionQuery() {
  deductionDialogVisible.value = true
}

// 处理核减日期类型变化
function handleDeductionDateTypeChange(type: 'year' | 'month' | 'day') {
  deductionForm.dateType = type
  deductionForm.dateRange = null
  deductionForm.yearRange = null
  deductionForm.monthRange = null
  deductionResult.value = null
}

// 核减查询日期面板左侧快捷项
const deductionDateTypeShortcuts = [
  {
    text: '年',
    onClick: () => {
      handleDeductionDateTypeChange('year')
    },
  },
  {
    text: '月',
    onClick: () => {
      handleDeductionDateTypeChange('month')
    },
  },
  {
    text: '日',
    onClick: () => {
      handleDeductionDateTypeChange('day')
    },
  },
]

// 查询核减金额
async function handleQueryDeduction() {
  // 校验日期范围
  if (deductionForm.dateType === 'day') {
    if (!deductionForm.dateRange || !deductionForm.dateRange[0] || !deductionForm.dateRange[1]) {
      ElMessage.warning('请选择日期范围')
      return
    }
  } else if (deductionForm.dateType === 'month') {
    if (!deductionForm.monthRange || !deductionForm.monthRange[0] || !deductionForm.monthRange[1]) {
      ElMessage.warning('请选择月份范围')
      return
    }
  } else if (deductionForm.dateType === 'year') {
    if (!deductionForm.yearRange || !deductionForm.yearRange[0] || !deductionForm.yearRange[1]) {
      ElMessage.warning('请选择年份范围')
      return
    }
  }

  try {
    deductionLoading.value = true
    const params: any = {
      dateType: deductionForm.dateType,
    }

    // 统一转换为 startDate / endDate
    if (deductionForm.dateType === 'day' && deductionForm.dateRange) {
      params.startDate = deductionForm.dateRange[0]
      params.endDate = deductionForm.dateRange[1]
    } else if (deductionForm.dateType === 'month' && deductionForm.monthRange) {
      const [startYear, startMonth] = deductionForm.monthRange[0].split('-')
      const [endYear, endMonth] = deductionForm.monthRange[1].split('-')
      params.startDate = `${startYear}-${startMonth}-01`
      const lastDay = new Date(parseInt(endYear), parseInt(endMonth), 0).getDate()
      params.endDate = `${endYear}-${endMonth}-${String(lastDay).padStart(2, '0')}`
    } else if (deductionForm.dateType === 'year' && deductionForm.yearRange) {
      params.startDate = `${deductionForm.yearRange[0]}-01-01`
      params.endDate = `${deductionForm.yearRange[1]}-12-31`
    }

    if (deductionForm.userId) {
      params.userId = deductionForm.userId
    }

    const res = await api.get('/api/approval/deduction-query', { params })
    if (res.data.success) {
      deductionResult.value = res.data.data
    } else {
      ElMessage.error(res.data.message || '查询失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '查询失败')
  } finally {
    deductionLoading.value = false
  }
}

// 导出核减金额数据
function handleExportDeduction() {
  if (!deductionResult.value) {
    ElMessage.warning('没有可导出的数据')
    return
  }

  // 生成CSV内容
  const headers = ['员工', '部门', '核减金额合计', '核减笔数', '报销类型', '报销事由', '核减金额', '提交时间']
  const rows: string[][] = []

  deductionResult.value.employees.forEach(emp => {
    // 第一条明细与员工汇总信息在同一行
    emp.details.forEach((detail, idx) => {
      rows.push([
        idx === 0 ? emp.name : '',
        idx === 0 ? (emp.department || '') : '',
        idx === 0 ? emp.deductionAmount.toFixed(2) : '',
        idx === 0 ? `${emp.deductionCount} 笔` : '',
        detail.typeName,
        detail.title,
        detail.deductionAmount.toFixed(2),
        detail.submitTime || '',
      ])
    })
  })

  // 添加汇总行
  rows.push([])
  rows.push(['汇总', '', deductionResult.value.totalDeduction.toFixed(2), `共${deductionResult.value.totalCount}笔`, '', '', '', ''])

  // 转换为CSV格式
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n')

  // 添加BOM以支持中文
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `核减金额_${deductionResult.value.period.replace(/\s+/g, '_')}.csv`
  link.click()
  URL.revokeObjectURL(url)

  ElMessage.success('导出成功')
}

// 查看全部列表详情
function handleViewAllDetail(row: AllReimbursementItem) {
  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[row.type]
  if (routePath) {
    router.push(`${routePath}/${row.id}?mode=view&from=/approval&tab=all`)
  }
}

// 监听类型选择变化，如果选择了基础报销，清空所属区域
watch(
  () => allFilterForm.type,
  (newType) => {
    if (newType.includes('basic')) {
      allFilterForm.reimbursementScope = []
    }
  }
)

// 监听路由变化，处理从详情页返回时的状态恢复
watch(
  () => route.query.tab,
  (newTab) => {
    // 如果是返回到 all tab，恢复查询状态
    if (newTab === 'all') {
      restoreAllQueryState()
    }
    // 触发数据加载
    if (newTab && typeof newTab === 'string') {
      handleTabChange(newTab)
    }
  }
)

// ==================== 发票管理方法 ====================

// 查询发票列表
async function loadInvoiceList() {
  try {
    invoiceListLoading.value = true
    selectedInvoiceIds.value = []
    const params: any = {}

    if (invoiceFilterForm.userId) {
      params.userId = invoiceFilterForm.userId
    }
    if (invoiceFilterForm.type.length > 0) {
      params.type = invoiceFilterForm.type.join(',')
    }
    if (invoiceFilterForm.fileType) {
      params.fileType = invoiceFilterForm.fileType
    }
    if (invoiceFilterForm.reimbursementScope.length > 0) {
      const expandedScopes = expandScopeSelection(invoiceFilterForm.reimbursementScope)
      params.reimbursementScope = expandedScopes.join(',')
    }

    // 日期参数
    if (invoiceFilterForm.dateQueryType === 'month' && invoiceFilterForm.monthRange && invoiceFilterForm.monthRange[0] && invoiceFilterForm.monthRange[1]) {
      const [startYear, startMonth] = invoiceFilterForm.monthRange[0].split('-')
      const [endYear, endMonth] = invoiceFilterForm.monthRange[1].split('-')
      params.startDate = `${startYear}-${startMonth}-01`
      const lastDay = new Date(parseInt(endYear), parseInt(endMonth), 0).getDate()
      params.endDate = `${endYear}-${endMonth}-${String(lastDay).padStart(2, '0')}`
    } else if (invoiceFilterForm.dateQueryType === 'day' && invoiceFilterForm.dateRange && invoiceFilterForm.dateRange[0] && invoiceFilterForm.dateRange[1]) {
      params.startDate = invoiceFilterForm.dateRange[0]
      params.endDate = invoiceFilterForm.dateRange[1]
    }

    const res = await api.get('/api/approval/invoice-management', { params })
    if (res.data.success) {
      invoiceList.value = res.data.data
      // 获取核减发票总金额
      deductionInvoicesTotal.value = res.data.deductionInvoicesTotal || 0
    } else {
      ElMessage.error(res.data.message || '查询失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '查询失败')
  } finally {
    invoiceListLoading.value = false
  }
}

function handleQueryInvoiceList() {
  loadInvoiceList()
}

function handleResetInvoiceFilter() {
  invoiceFilterForm.userId = ''
  invoiceFilterForm.type = []
  invoiceFilterForm.fileType = ''
  invoiceFilterForm.reimbursementScope = []
  invoiceFilterForm.dateQueryType = 'month'
  invoiceFilterForm.dateRange = null
  invoiceFilterForm.monthRange = null
  invoiceList.value = []
  selectedInvoiceIds.value = []
}

// 选择发票
function handleInvoiceSelect(id: string, checked: boolean) {
  if (checked) {
    if (!selectedInvoiceIds.value.includes(id)) {
      selectedInvoiceIds.value.push(id)
    }
  } else {
    selectedInvoiceIds.value = selectedInvoiceIds.value.filter(i => i !== id)
  }
}

function handleInvoiceSelectAllChange(val: boolean | string | number) {
  if (val) {
    selectedInvoiceIds.value = invoiceList.value.map(inv => inv.id)
  } else {
    selectedInvoiceIds.value = []
  }
}

// 预览发票
function handlePreviewInvoice(inv: InvoiceManagementItem) {
  previewInvoicePath.value = toFileUrl(inv.filePath)
  invoicePreviewDialogVisible.value = true
}

// 批量下载
async function handleBatchDownload() {
  if (selectedInvoiceIds.value.length === 0) {
    ElMessage.warning('请选择要下载的发票')
    return
  }

  try {
    batchDownloading.value = true
    const res = await api.post('/api/approval/invoice-management/batch-download', {
      invoiceIds: selectedInvoiceIds.value,
    }, {
      responseType: 'blob',
    })

    // 创建下载链接
    const blob = new Blob([res.data], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    link.download = `发票_${timestamp}.zip`
    link.click()
    URL.revokeObjectURL(url)

    ElMessage.success(`已下载 ${selectedInvoiceIds.value.length} 个发票文件`)
  } catch (err: any) {
    ElMessage.error('下载失败')
  } finally {
    batchDownloading.value = false
  }
}

// 批量打印 - 导航到独立打印页面
function handleBatchPrint() {
  if (selectedInvoiceIds.value.length === 0) {
    ElMessage.warning('请选择要打印的发票')
    return
  }
  const selectedInvoices = invoiceList.value.filter(inv => selectedInvoiceIds.value.includes(inv.id))
  sessionStorage.setItem('print-invoices', JSON.stringify(selectedInvoices))
  // 保存发票筛选条件和选中状态，返回时恢复
  sessionStorage.setItem('invoice-filter-state', JSON.stringify({
    filterForm: {
      userId: invoiceFilterForm.userId,
      type: invoiceFilterForm.type,
      reimbursementScope: invoiceFilterForm.reimbursementScope,
      dateQueryType: invoiceFilterForm.dateQueryType,
      dateRange: invoiceFilterForm.dateRange,
      monthRange: invoiceFilterForm.monthRange,
    },
    selectedIds: selectedInvoiceIds.value,
  }))
  // 先替换当前URL带上tab参数，这样从打印页router.back()回来时能恢复到正确的tab
  router.replace({ query: { ...route.query, tab: activeTab.value } }).then(() => {
    router.push({ name: 'InvoicePrint' })
  })
}

onMounted(() => {
  // 加载统计数据
  loadStatistics()
  // 加载员工列表和报销范围列表（用于全部查询筛选）
  loadEmployeeList()
  loadScopeList()
  // activeTab 通过 computed 自动从 URL 读取，不需要手动设置
  const tab = activeTab.value
  // 如果是返回到 all tab，先恢复查询状态
  if (tab === 'all') {
    restoreAllQueryState()
  }
  // 如果是返回到 invoices tab，恢复筛选条件和选中状态
  if (tab === 'invoices') {
    const savedState = sessionStorage.getItem('invoice-filter-state')
    if (savedState) {
      sessionStorage.removeItem('invoice-filter-state')
      try {
        const state = JSON.parse(savedState)
        // 恢复筛选条件
        if (state.filterForm) {
          invoiceFilterForm.userId = state.filterForm.userId || ''
          invoiceFilterForm.type = state.filterForm.type || []
          invoiceFilterForm.reimbursementScope = state.filterForm.reimbursementScope || []
          invoiceFilterForm.dateQueryType = state.filterForm.dateQueryType || 'day'
          invoiceFilterForm.dateRange = state.filterForm.dateRange || null
          invoiceFilterForm.monthRange = state.filterForm.monthRange || null
        }
        // 重新加载发票列表，加载完成后恢复选中状态
        const pendingSelectedIds = state.selectedIds || []
        loadInvoiceList().then(() => {
          selectedInvoiceIds.value = pendingSelectedIds
        })
      } catch (e) {
        // 解析失败，正常加载
      }
    }
  }
  // 根据当前 tab 加载对应数据
  handleTabChange(tab)
})
</script>

<style scoped>
/* 禁用标签页切换动画，防止返回时出现视觉跳转 */
.no-transition-tabs :deep(.el-tabs__active-bar) {
  transition: none !important;
}
.no-transition-tabs :deep(.el-tabs__nav-wrap::after) {
  transition: none !important;
}

/* 表头居中 */
:deep(.el-table th.el-table__cell) {
  text-align: center;
}

/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.approval-center {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 24px;
}

.statistics-section {
  margin-bottom: 24px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.stat-card {
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid #ebeef5;
  min-height: 110px;
}

.stat-card :deep(.el-card__body) {
  padding: 16px;
  height: 100%;
  box-sizing: border-box;
}

.stat-card:hover {
  transform: translateY(-4px);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  width: 100%;
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: #f5f7fa;
  flex-shrink: 0;
  font-size: 28px;
}

.pending-card .stat-icon {
  background-color: rgba(230, 162, 60, 0.1);
  color: #E6A23C;
}

.basic-card .stat-icon {
  background-color: rgba(64, 158, 255, 0.1);
  color: #409EFF;
}

.large-card .stat-icon {
  background-color: rgba(245, 108, 108, 0.1);
  color: #F56C6C;
}

.business-card .stat-icon {
  background-color: rgba(103, 194, 58, 0.1);
  color: #67C23A;
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-top: 4px;
}

.stat-amount {
  font-size: 12px;
  color: #409eff;
  margin-top: 2px;
  font-weight: 500;
}

.applicant-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.summary-bar {
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 14px;
  color: #606266;
}

/* 报销汇总查询样式 */
.summary-filter {
  margin-bottom: 24px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 0;
  flex-shrink: 0;
}

.filter-form :deep(.el-form-item__label) {
  padding-right: 6px;
}

.summary-result {
  padding: 16px 0;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}

.summary-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.summary-header .date-range {
  font-size: 14px;
  color: #909399;
}

.summary-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
}

/* 全部查询汇总卡片 */
.all-summary-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.summary-type-card {
  min-width: 150px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.summary-type-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.summary-type-card.total-card {
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
}

.summary-type-card.total-card .type-card-content {
  color: #fff;
}

.type-card-content {
  text-align: center;
  padding: 8px 0;
}

.type-name {
  font-size: 14px;
  color: #606266;
  margin-bottom: 8px;
}

.total-card .type-name {
  color: rgba(255, 255, 255, 0.9);
}

.type-amount {
  font-size: 24px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 4px;
}

.type-amount.total {
  color: #fff;
}

.type-count {
  font-size: 12px;
  color: #909399;
}

.total-card .type-count {
  color: rgba(255, 255, 255, 0.8);
}

.summary-details {
  margin-top: 24px;
}

.summary-details h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.amount-text {
  color: #409eff;
  font-weight: 600;
}

/* 全部查询筛选区域 */
.filter-section {
  margin-bottom: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
  overflow: hidden;
}

/* 审批流程弹窗样式 */
.approval-process-detail {
  padding: 0 10px;
}

.info-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.amount-highlight {
  color: #409eff;
  font-weight: 600;
  font-size: 16px;
}

.timeline-section {
  margin-top: 24px;
}

.timeline-content {
  padding: 4px 0;
}

.timeline-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.timeline-desc {
  font-size: 14px;
  color: #606266;
}

.timeline-description {
  margin-top: 6px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* 驳回原因样式 */
.reject-reason-box {
  margin-top: 12px;
  padding: 12px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 6px;
}

.reject-reason-label {
  font-size: 13px;
  font-weight: 600;
  color: #f56c6c;
  margin-bottom: 6px;
}

.reject-reason-text {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  word-break: break-word;
}

/* 导出弹窗样式 */
.export-content {
  padding: 10px;
}

.export-summary {
  padding: 20px;
  background: #f5f7fa;
  border-radius: 8px;
  margin-bottom: 24px;
}

.export-summary h3 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.export-employees {
  margin-top: 24px;
}

.export-employees h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.export-scope-summary {
  margin-top: 24px;
}

.export-scope-summary h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.employee-collapse-title {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.emp-name {
  font-weight: 600;
  color: #303133;
}

.emp-department {
  font-size: 13px;
  color: #909399;
}

.emp-stats {
  margin-left: auto;
  font-size: 14px;
  color: #409eff;
  font-weight: 500;
}

.export-empty {
  padding: 40px 0;
}

/* 时间线中的付款回单预览 */
.payment-proof-preview {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.proof-card {
  position: relative;
  width: min(200px, 45%);
  height: 140px;
  border: 2px solid #67c23a;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #f8fafc;
}

.proof-card:hover .proof-overlay {
  opacity: 1;
}

.proof-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.proof-pdf {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
}

.proof-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  opacity: 0;
  transition: opacity 0.3s;
  gap: 4px;
  font-size: 12px;
}

/* 预览对话框样式 */
.preview-dialog-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.preview-dialog-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-dialog-pdf {
  width: 100%;
  height: 70vh;
  border: none;
}

/* 核减金额查询样式 */
.deduction-filter {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.deduction-result {
  margin-top: 20px;
}

.deduction-summary {
  margin-bottom: 24px;
}

.deduction-summary h4 {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.summary-card {
  text-align: center;
  padding: 16px;
}

.summary-card .card-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 8px;
}

.summary-card .card-value {
  font-size: 24px;
  font-weight: 600;
  color: #f56c6c;
}

.summary-card .card-value.total {
  color: #f56c6c;
  font-size: 28px;
}

.deduction-details {
  margin-top: 24px;
}

.deduction-details h4 {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  text-align: center;
}

.deduction-empty {
  padding: 40px 0;
  text-align: center;
}

.deduction-expand-content {
  padding: 12px 20px;
}

/* 隐藏默认展开箭头列 */
.deduction-table :deep(.el-table__expand-column) {
  display: none;
}

.deduction-table :deep(.el-table__expanded-cell) {
  padding: 0;
}

.deduction-table :deep(th .cell),
.deduction-table :deep(td .cell) {
  white-space: nowrap;
  overflow: visible;
  text-overflow: unset;
}

.deduction-toggle {
  color: #409eff;
  cursor: pointer;
  user-select: none;
}

.deduction-toggle:hover {
  color: #66b1ff;
}

.toggle-arrow {
  display: inline-block;
  font-size: 16px;
  font-weight: 700;
  transition: transform 0.2s;
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}


/* 发票管理样式 */
.invoice-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
}

.action-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.action-right {
  display: flex;
  gap: 8px;
}

.selected-count {
  font-size: 14px;
  color: #409eff;
  font-weight: 500;
}

/* 批量付款操作栏 */
.batch-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-top: 12px;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 6px;
}

.batch-info {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 14px;
  color: #606266;
}

.batch-amount {
  color: #409eff;
}

.batch-warning {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #e6a23c;
  font-size: 13px;
}
</style>

<!-- 非 scoped 样式：用于类型多选下拉框的 checkbox 效果 + cascader 单行不换行 -->
<style>
.type-select-popper .el-select-dropdown__item.is-selected::after {
  display: none;
}

/* 所属区域 cascader 单行不换行（全局样式，确保穿透 Element Plus 内部结构） */
.scope-cascader .el-input__wrapper {
  flex-wrap: nowrap !important;
  overflow: hidden !important;
  align-items: center !important;
}

.scope-cascader .el-cascader__tags {
  flex-wrap: nowrap !important;
  overflow: hidden !important;
  align-items: center !important;
  gap: 4px !important;
  max-width: calc(100% - 25px) !important;
  height: auto !important;
  min-height: unset !important;
}

/* 隐藏 tags 容器内用于撑高的隐藏 input */
.scope-cascader .el-cascader__tags .el-cascader__search-input {
  width: 0 !important;
  min-width: 0 !important;
  flex-shrink: 1 !important;
}

.scope-cascader .el-cascader__tags > .el-tag {
  max-width: 90px !important;
  flex-shrink: 1 !important;
  min-width: 0 !important;
  overflow: hidden !important;
  margin: 0 !important;
}

.scope-cascader .el-cascader__tags > .el-tag .el-tag__content {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.scope-cascader .el-cascader__collapse-tags {
  flex-shrink: 0 !important;
  margin: 0 !important;
}

.scope-cascader .el-cascader__collapse-tags .el-tag {
  max-width: none !important;
  flex-shrink: 0 !important;
}
</style>
