<template>
  <div class="yl-page approval-center">
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <Stamp />
        </el-icon>
        <h1>审批中心</h1>
      </div>
      <div class="yl-page-actions">
        <el-button :icon="Refresh" @click="refreshData">刷新</el-button>
      </div>
    </div>

    <!-- 统计区域 - 可点击 -->
    <div class="statistics-section">
      <el-row :gutter="20">
        <el-col :span="4">
          <el-card
            class="stat-card pending-card"
            shadow="hover"
            :class="{ active: activeTab === 'pending' }"
            @click="switchTab('pending')"
          >
            <div class="stat-content">
              <div class="stat-icon">
                <el-icon :size="32" color="#E6A23C"><Clock /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ statistics.pendingCount }}</div>
                <div class="stat-label">待审批</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="5">
          <el-card
            class="stat-card approved-card"
            shadow="hover"
            :class="{ active: activeTab === 'approved' }"
            @click="switchTab('approved')"
          >
            <div class="stat-content">
              <div class="stat-icon">
                <el-icon :size="32" color="#67C23A"><CircleCheck /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ statistics.approvedThisMonth }}</div>
                <div class="stat-label">本月已通过</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="5">
          <el-card
            class="stat-card unpaid-card"
            shadow="hover"
            :class="{ active: activeTab === 'unpaid' }"
            @click="switchTab('unpaid')"
          >
            <div class="stat-content">
              <div class="stat-icon">
                <el-icon :size="32" color="#F56C6C"><Wallet /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ statistics.approvedUnpaid }}</div>
                <div class="stat-label">已通过未付款</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="4">
          <el-card
            class="stat-card paid-card"
            shadow="hover"
            :class="{ active: activeTab === 'paid' }"
            @click="switchTab('paid')"
          >
            <div class="stat-content">
              <div class="stat-icon">
                <el-icon :size="32" color="#409EFF"><Money /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ statistics.paidThisMonth }}</div>
                <div class="stat-label">本月已付款</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="4">
          <el-card
            class="stat-card completed-card"
            shadow="hover"
            :class="{ active: activeTab === 'completed' }"
            @click="switchTab('completed')"
          >
            <div class="stat-content">
              <div class="stat-icon">
                <el-icon :size="32" color="#67C23A"><SuccessFilled /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ statistics.completedThisMonth }}</div>
                <div class="stat-label">本月已完成</div>
                <div class="stat-amount" v-if="statistics.completedThisMonthAmount > 0">
                  ¥{{ statistics.completedThisMonthAmount.toFixed(2) }}
                </div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <!-- 待审批 -->
      <el-tab-pane label="待审批" name="pending">
        <el-card>
          <el-table :data="pendingList" border stripe empty-text="暂无待审批项">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="150">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ getTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="200">
              <template #default="{ row }">
                <div v-if="row.reimbursementInfo">
                  <div>{{ row.reimbursementInfo.title }}</div>
                  <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                    ¥{{ row.reimbursementInfo.amount.toFixed(2) }}
                  </div>
                </div>
                <div v-else>-</div>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.submitTime) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="280" fixed="right">
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
                  <el-button type="success" size="small" :icon="Check" @click="handleApprove(row)">
                    通过
                  </el-button>
                  <el-button type="danger" size="small" :icon="Close" @click="handleReject(row)">
                    驳回
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 本月已通过 -->
      <el-tab-pane label="本月已通过" name="approved">
        <el-card>
          <el-table :data="approvedList" border stripe empty-text="暂无本月已通过记录">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="150">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ getTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="200">
              <template #default="{ row }">
                <div v-if="row.reimbursementInfo">
                  <div>{{ row.reimbursementInfo.title }}</div>
                  <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                    ¥{{ row.reimbursementInfo.amount.toFixed(2) }}
                  </div>
                </div>
                <div v-else>-</div>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.submitTime) }}
              </template>
            </el-table-column>
            <el-table-column label="通过时间" width="180">
              <template #default="{ row }">
                {{ row.completeTime ? formatDate(row.completeTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="row.targetType === 'reimbursement'"
                  type="primary"
                  size="small"
                  :icon="View"
                  @click="handleViewReimbursement(row)"
                >
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 已通过未付款 -->
      <el-tab-pane label="已通过未付款" name="unpaid">
        <el-card>
          <el-table :data="unpaidList" border stripe empty-text="暂无已通过未付款记录">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="150">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ getTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="200">
              <template #default="{ row }">
                <div>{{ row.title }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="通过时间" width="180">
              <template #default="{ row }">
                {{ row.approveTime ? formatDate(row.approveTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
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
        </el-card>
      </el-tab-pane>

      <!-- 已付款 -->
      <el-tab-pane label="已付款" name="paid">
        <el-card>
          <el-table :data="paidList" border stripe empty-text="暂无已付款记录">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="150">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ getTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="200">
              <template #default="{ row }">
                <div>{{ row.title }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="付款时间" width="180">
              <template #default="{ row }">
                {{ row.payTime ? formatDate(row.payTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.status === 'completed' ? 'success' : 'warning'" size="small">
                  {{ row.status === 'completed' ? '已确认收款' : '待确认收款' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
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

      <!-- 已完成 -->
      <el-tab-pane label="已完成" name="completed">
        <el-card>
          <div class="summary-bar" v-if="completedList.length > 0">
            <span>共 <strong>{{ completedList.length }}</strong> 条记录</span>
            <span style="margin-left: 16px;">总金额 <strong style="color: #409eff;">¥{{ completedTotalAmount.toFixed(2) }}</strong></span>
          </div>
          <el-table :data="completedList" border stripe empty-text="暂无已完成记录">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="150">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="32">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ getTypeLabel(row.type) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="200">
              <template #default="{ row }">
                <div>{{ row.title }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="付款时间" width="180">
              <template #default="{ row }">
                {{ row.payTime ? formatDate(row.payTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="确认收款时间" width="180">
              <template #default="{ row }">
                {{ row.completedTime ? formatDate(row.completedTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button
                  type="primary"
                  size="small"
                  :icon="View"
                  @click="handleViewCompletedReimbursement(row)"
                >
                  详情
                </el-button>
                <el-button
                  type="info"
                  size="small"
                  @click="handleViewApprovalProcess(row)"
                >
                  审批流程
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 全部查询 -->
      <el-tab-pane label="全部查询" name="all">
        <el-card>
          <!-- 筛选区域 -->
          <div class="filter-section">
            <el-form :inline="true" :model="allFilterForm" class="filter-form">
              <el-form-item label="员工">
                <el-select
                  v-model="allFilterForm.userId"
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
              <el-form-item label="类型">
                <el-select v-model="allFilterForm.type" placeholder="全部" clearable style="width: 120px">
                  <el-option label="基础报销" value="basic" />
                  <el-option label="大额报销" value="large" />
                  <el-option label="商务报销" value="business" />
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select v-model="allFilterForm.status" placeholder="全部" clearable style="width: 140px">
                  <el-option label="草稿" value="draft" />
                  <el-option label="待审批" value="pending" />
                  <el-option label="已审批未付款" value="approved" />
                  <el-option label="已拒绝" value="rejected" />
                  <el-option label="待确认" value="payment_uploaded" />
                  <el-option label="已完成" value="completed" />
                </el-select>
              </el-form-item>
              <el-form-item label="日期范围">
                <el-date-picker
                  v-model="allFilterForm.dateRange"
                  type="daterange"
                  range-separator="至"
                  start-placeholder="开始"
                  end-placeholder="结束"
                  value-format="YYYY-MM-DD"
                  style="width: 240px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="allListLoading" @click="handleQueryAllList">
                  查询
                </el-button>
                <el-button @click="handleResetAllFilter">重置</el-button>
                <el-button type="success" :icon="Download" @click="handleExportAllList" :disabled="allList.length === 0">
                  导出
                </el-button>
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
            <span style="margin-left: 16px;">总金额 <strong style="color: #409eff;">¥{{ allListTotalAmount.toFixed(2) }}</strong></span>
          </div>

          <!-- 列表 -->
          <el-table :data="allList" border stripe empty-text="请设置筛选条件后点击查询" v-loading="allListLoading">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" width="120">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="28">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ row.typeName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="180">
              <template #default="{ row }">
                <div>{{ row.title }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="getAllStatusType(row.status)" size="small">
                  {{ row.statusName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="160">
              <template #default="{ row }">
                {{ row.submitTime ? formatDate(row.submitTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
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
    </el-tabs>

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
            <el-descriptions-item label="报销事由" :span="2">{{ currentApprovalRecord.title }}</el-descriptions-item>
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
              </div>
            </el-timeline-item>

            <!-- 2. 管理员审批 -->
            <el-timeline-item
              v-if="['approved', 'paying', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
              :timestamp="currentApprovalRecord.approveTime ? formatDate(currentApprovalRecord.approveTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">管理员审批</div>
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
                <div class="timeline-title">管理员审批</div>
                <div class="timeline-desc">{{ currentApprovalRecord.approver || '管理员' }} 拒绝了申请</div>
                <div v-if="currentApprovalRecord.rejectReason" class="reject-reason-box">
                  <div class="reject-reason-label">拒绝原因：</div>
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
                <div class="timeline-title">管理员审批</div>
                <div class="timeline-desc">等待管理员审批...</div>
              </div>
            </el-timeline-item>

            <!-- 3. 财务付款 -->
            <el-timeline-item
              v-if="['paying', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
              :timestamp="currentApprovalRecord.payTime ? formatDate(currentApprovalRecord.payTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">财务付款</div>
                <div class="timeline-desc">财务已付款</div>
              </div>
            </el-timeline-item>

            <!-- 4. 上传付款凭证 -->
            <el-timeline-item
              v-if="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
              :timestamp="currentApprovalRecord.paymentUploadTime ? formatDate(currentApprovalRecord.paymentUploadTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">上传付款凭证</div>
                <div class="timeline-desc">财务已上传付款凭证</div>
                <!-- 付款回单展示 -->
                <div v-if="currentApprovalRecord.paymentProofPath" class="payment-proof-preview">
                  <div class="proof-card" @click="handlePreviewPaymentProof">
                    <template v-if="isPaymentProofImage">
                      <img :src="currentApprovalRecord.paymentProofPath" class="proof-image" alt="付款回单" />
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

            <!-- 5. 付款完成 -->
            <el-timeline-item
              v-if="currentApprovalRecord.status === 'completed'"
              :timestamp="currentApprovalRecord.completedTime ? formatDate(currentApprovalRecord.completedTime) : ''"
              placement="top"
              type="success"
            >
              <div class="timeline-content">
                <div class="timeline-title">付款完成</div>
                <div class="timeline-desc">报销流程已完成</div>
                <div v-if="currentApprovalRecord.receiptConfirmedBy" class="timeline-desc" style="margin-top: 4px; color: #67c23a;">
                  {{ currentApprovalRecord.receiptConfirmedBy }}已确认收款
                </div>
              </div>
            </el-timeline-item>
            <el-timeline-item
              v-else-if="currentApprovalRecord.status === 'payment_uploaded'"
              timestamp="待确认收款"
              placement="top"
              type="warning"
            >
              <div class="timeline-content">
                <div class="timeline-title">待确认收款</div>
                <div class="timeline-desc">等待员工确认收款...</div>
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
        <img v-if="isPaymentProofImage && currentApprovalRecord?.paymentProofPath" :src="currentApprovalRecord.paymentProofPath" class="preview-dialog-image" alt="付款回单" />
        <iframe v-else-if="currentApprovalRecord?.paymentProofPath" :src="currentApprovalRecord.paymentProofPath" class="preview-dialog-pdf" />
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
                <el-table-column prop="title" label="报销事由" min-width="150" />
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

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Stamp, Refresh, User, Check, Close, View, Clock, CircleCheck, Wallet, Money, SuccessFilled, Search, Download, Document, ZoomIn } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const router = useRouter()
const route = useRoute()

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
  submitTime: string
  completeTime?: string
  createdAt: string
  reimbursementInfo?: {
    title: string
    amount: number
  }
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
  approvedThisMonth: number
  approvedUnpaid: number
  paidThisMonth: number
  paidThisMonthAmount: number
  completedThisMonth: number
  completedThisMonthAmount: number
  currentMonth: string
}

const activeTab = ref('pending')
const pendingList = ref<ApprovalItem[]>([])
const approvedList = ref<ApprovalItem[]>([])
const unpaidList = ref<ReimbursementItem[]>([])
const paidList = ref<ReimbursementItem[]>([])
const completedList = ref<ReimbursementItem[]>([])
const statistics = ref<Statistics>({
  pendingCount: 0,
  approvedThisMonth: 0,
  approvedUnpaid: 0,
  paidThisMonth: 0,
  paidThisMonthAmount: 0,
  completedThisMonth: 0,
  completedThisMonthAmount: 0,
  currentMonth: '',
})

// 计算已完成列表的总金额
const completedTotalAmount = computed(() => {
  return completedList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
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

interface SummaryResult {
  employee: { id: string; name: string }
  dateRange: { startDate: string; endDate: string }
  summary: {
    total: { count: number; amount: number }
    byType: Array<{ type: string; typeName: string; count: number; amount: number }>
  }
  details: Array<{
    id: string
    type: string
    typeName: string
    title: string
    amount: number
    status: string
    statusName: string
    submitTime: string
    approveTime: string
    createTime: string
    isDeleted: boolean
  }>
}

const employeeList = ref<Employee[]>([])
const summaryLoading = ref(false)
const summaryResult = ref<SummaryResult | null>(null)
const summaryForm = reactive({
  userId: '',
  dateRange: null as [string, string] | null,
})

// 全部查询相关
interface AllReimbursementItem {
  id: string
  type: string
  typeName: string
  title: string
  amount: number
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
  createdAt: string
  userId: string
}

const allFilterForm = reactive({
  userId: '',
  type: '',
  status: '',
  dateRange: null as [string, string] | null,
})
const allList = ref<AllReimbursementItem[]>([])
const allListLoading = ref(false)

// 计算全部列表总金额
const allListTotalAmount = computed(() => {
  return allList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
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

  return {
    byType: Object.values(byTypeMap),
    total: {
      count: allList.value.length,
      amount: allListTotalAmount.value,
    },
  }
})

// 审批流程弹窗相关
interface ApprovalProcessRecord {
  id: string
  type: string
  title: string
  amount: number
  status: string
  applicantName: string
  submitTime?: string
  approveTime?: string
  approver?: string
  rejectReason?: string
  payTime?: string
  paymentUploadTime?: string
  completedTime?: string
  paymentProofPath?: string
  receiptConfirmedBy?: string
}
const approvalProcessDialogVisible = ref(false)
const currentApprovalRecord = ref<ApprovalProcessRecord | null>(null)

// 付款回单预览
const paymentProofDialogVisible = ref(false)

// 判断付款回单是否为图片
const isPaymentProofImage = computed(() => {
  if (!currentApprovalRecord.value?.paymentProofPath) return false
  const path = currentApprovalRecord.value.paymentProofPath.toLowerCase()
  return path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.png')
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
  employees: AllExportEmployee[]
}

const allExportDialogVisible = ref(false)
const allExportData = ref<AllExportData | null>(null)
const allExportActiveCollapse = ref<string[]>([])

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
  return format(new Date(dateStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
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
  try {
    const res = await api.get('/api/approval/pending')
    if (res.data.success) {
      pendingList.value = res.data.data
    }
  } catch {
    console.error('加载待审批列表失败')
  }
}

// 加载本月已通过列表
async function loadApprovedList() {
  try {
    const res = await api.get('/api/approval/approved-this-month')
    if (res.data.success) {
      approvedList.value = res.data.data
    }
  } catch {
    console.error('加载本月已通过列表失败')
  }
}

// 加载已通过未付款列表
async function loadUnpaidList() {
  try {
    const res = await api.get('/api/approval/approved-unpaid')
    if (res.data.success) {
      unpaidList.value = res.data.data
    }
  } catch {
    console.error('加载已通过未付款列表失败')
  }
}

// 加载已付款列表
async function loadPaidList() {
  try {
    const res = await api.get('/api/approval/paid-this-month')
    if (res.data.success) {
      paidList.value = res.data.data
    }
  } catch {
    console.error('加载已付款列表失败')
  }
}

// 加载已完成列表
async function loadCompletedList() {
  try {
    const res = await api.get('/api/approval/completed-this-month')
    if (res.data.success) {
      completedList.value = res.data.data
    }
  } catch {
    console.error('加载已完成列表失败')
  }
}

// 切换tab
function switchTab(tab: string) {
  activeTab.value = tab
  handleTabChange(tab)
}

// Tab切换处理
function handleTabChange(tab: string | number) {
  if (tab === 'pending') {
    loadPendingList()
  } else if (tab === 'approved') {
    loadApprovedList()
  } else if (tab === 'unpaid') {
    loadUnpaidList()
  } else if (tab === 'paid') {
    loadPaidList()
  } else if (tab === 'completed') {
    loadCompletedList()
  } else if (tab === 'all') {
    loadEmployeeList() // 为全部查询加载员工列表
  }
}

// 刷新数据
function refreshData() {
  loadStatistics()
  handleTabChange(activeTab.value)
  ElMessage.success('已刷新')
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
      loadStatistics()
      loadPendingList()
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
      loadStatistics()
      loadPendingList()
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

// 进入付款页面
function handlePayment(item: ReimbursementItem) {
  router.push(`/approval/payment/${item.id}?from=/approval&tab=unpaid`)
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

// 查看已完成报销单详情
function handleViewCompletedReimbursement(item: ReimbursementItem) {
  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[item.type]
  if (routePath) {
    router.push(`${routePath}/${item.id}?mode=view&from=/approval&tab=completed`)
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

// 查询员工报销汇总
async function handleQuerySummary() {
  if (!summaryForm.userId) {
    ElMessage.warning('请选择员工')
    return
  }
  if (!summaryForm.dateRange || !summaryForm.dateRange[0] || !summaryForm.dateRange[1]) {
    ElMessage.warning('请选择日期范围')
    return
  }

  try {
    summaryLoading.value = true
    const res = await api.get('/api/approval/employee-summary', {
      params: {
        userId: summaryForm.userId,
        startDate: summaryForm.dateRange[0],
        endDate: summaryForm.dateRange[1],
      },
    })
    if (res.data.success) {
      summaryResult.value = res.data.data
    } else {
      ElMessage.error(res.data.message || '查询失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '查询失败')
  } finally {
    summaryLoading.value = false
  }
}

// 获取汇总状态标签类型
function getSummaryStatusType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    approved: 'primary',
    paying: 'warning',
    payment_uploaded: 'success',
    completed: 'success',
  }
  return typeMap[status] || 'info'
}

// 查看汇总明细详情
function handleViewSummaryDetail(row: any) {
  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[row.type]
  if (routePath) {
    router.push(`${routePath}/${row.id}?mode=view&from=/approval&tab=summary`)
  }
}

// 查看审批流程（从已完成tab）
function handleViewApprovalProcess(item: ReimbursementItem) {
  currentApprovalRecord.value = {
    id: item.id,
    type: item.type,
    title: item.title,
    amount: item.amount,
    status: item.status,
    applicantName: item.applicantName,
    submitTime: '', // 需要从详情获取
    approveTime: item.approveTime,
    approver: item.approver,
    payTime: item.payTime,
    paymentUploadTime: item.paymentUploadTime,
    completedTime: item.completedTime,
    paymentProofPath: item.paymentProofPath,
    receiptConfirmedBy: item.receiptConfirmedBy,
  }
  approvalProcessDialogVisible.value = true
}

// 查看审批流程（从全部查询tab）
function handleViewApprovalProcessFromAll(row: AllReimbursementItem) {
  currentApprovalRecord.value = {
    id: row.id,
    type: row.type,
    title: row.title,
    amount: row.amount,
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
  }
  approvalProcessDialogVisible.value = true
}

// 预览付款回单
function handlePreviewPaymentProof() {
  paymentProofDialogVisible.value = true
}

// 跳转到报销单详情
function handleGoToReimbursementDetail() {
  if (!currentApprovalRecord.value) return

  const typeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const routePath = typeMap[currentApprovalRecord.value.type]
  if (routePath) {
    approvalProcessDialogVisible.value = false
    router.push(`${routePath}/${currentApprovalRecord.value.id}?mode=view&from=/approval&tab=${activeTab.value}`)
  }
}

// 获取状态标签类型（全部查询用）
function getAllStatusType(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    draft: 'info',
    pending: 'warning',
    approved: 'primary',
    rejected: 'danger',
    paying: 'warning',
    payment_uploaded: 'success',
    completed: 'success',
  }
  return typeMap[status] || 'info'
}

// 获取状态标签文字
function getStatusLabel(status: string): string {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '已审批未付款',
    rejected: '已拒绝',
    paying: '付款中',
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
    if (allFilterForm.type) {
      params.type = allFilterForm.type
    }
    if (allFilterForm.status) {
      params.status = allFilterForm.status
    }
    if (allFilterForm.dateRange && allFilterForm.dateRange[0]) {
      params.startDate = allFilterForm.dateRange[0]
    }
    if (allFilterForm.dateRange && allFilterForm.dateRange[1]) {
      params.endDate = allFilterForm.dateRange[1]
    }

    const res = await api.get('/api/approval/all-reimbursements', { params })
    if (res.data.success) {
      allList.value = res.data.data
    } else {
      ElMessage.error(res.data.message || '查询失败')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '查询失败')
  } finally {
    allListLoading.value = false
  }
}

// 查询全部列表
function handleQueryAllList() {
  loadAllList()
}

// 重置全部筛选
function handleResetAllFilter() {
  allFilterForm.userId = ''
  allFilterForm.type = ''
  allFilterForm.status = ''
  allFilterForm.dateRange = null
  allList.value = []
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

  // 设置导出数据
  allExportData.value = {
    filterDesc: filterDesc.join(' '),
    summary: {
      totalAmount: allListTotalAmount.value,
      totalCount: allList.value.length,
      employeeCount: employeeListData.length,
    },
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

onMounted(() => {
  // 加载统计数据
  loadStatistics()
  // 根据URL参数决定默认tab，支持从付款页面返回时定位到正确的tab
  const tab = route.query.tab as string
  if (tab && ['pending', 'approved', 'unpaid', 'paid', 'completed', 'all'].includes(tab)) {
    activeTab.value = tab
    handleTabChange(tab)
  } else {
    // 默认加载待审批列表
    activeTab.value = 'pending'
    loadPendingList()
  }
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.approval-center {
  height: calc(100vh - 60px);
  margin: -24px;
  padding: 24px;
}

.statistics-section {
  margin-bottom: 24px;
}

.statistics-section :deep(.el-col) {
  display: flex;
}

.statistics-section :deep(.el-col .el-card) {
  width: 100%;
}

.stat-card {
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid transparent;
  min-height: 110px;
}

.stat-card :deep(.el-card__body) {
  padding: 16px;
  height: 100%;
  box-sizing: border-box;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-card.active {
  border-color: var(--el-color-primary);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
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
}

.pending-card .stat-icon {
  background: rgba(230, 162, 60, 0.1);
}

.approved-card .stat-icon {
  background: rgba(103, 194, 58, 0.1);
}

.unpaid-card .stat-icon {
  background: rgba(245, 108, 108, 0.1);
}

.paid-card .stat-icon {
  background: rgba(64, 158, 255, 0.1);
}

.completed-card .stat-icon {
  background: rgba(103, 194, 58, 0.1);
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
  gap: 8px;
}

.action-buttons {
  display: flex;
  gap: 8px;
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
  gap: 16px;
  align-items: flex-end;
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

/* 拒绝原因样式 */
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

/* 付款回单预览 */
.payment-proof-preview {
  margin-top: 12px;
}

.proof-card {
  position: relative;
  width: 200px;
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
</style>
