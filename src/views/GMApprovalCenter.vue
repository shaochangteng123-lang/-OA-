<template>
  <div class="yl-page gm-approval-center">
    <!-- 统计区域 -->
    <div class="statistics-section">
      <el-card
        class="stat-card pending-card"
        shadow="hover"
        :class="{ active: activeTab === 'pending' }"
        @click="switchTab('pending')"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><Clock /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.pendingCount }}</div>
            <div class="stat-label">待审批</div>
            <div class="stat-amount" v-if="statistics.pendingAmount > 0">
              ¥{{ statistics.pendingAmount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>

      <el-card
        class="stat-card completed-card"
        shadow="hover"
        :class="{ active: activeTab === 'completed' }"
        @click="switchTab('completed')"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><SuccessFilled /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.completedThisMonth }}</div>
            <div class="stat-label">本月已审批</div>
            <div class="stat-amount" v-if="statistics.completedThisMonthAmount > 0">
              ¥{{ statistics.completedThisMonthAmount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>

      <el-card
        class="stat-card all-card"
        shadow="hover"
        :class="{ active: activeTab === 'all' }"
        @click="switchTab('all')"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="32"><List /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ statistics.completedCount }}</div>
            <div class="stat-label">已完成</div>
            <div class="stat-amount" v-if="statistics.completedAmount > 0">
              ¥{{ statistics.completedAmount.toFixed(2) }}
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange" class="no-transition-tabs">
      <!-- 待审批 -->
      <el-tab-pane label="待审批" name="pending">
        <el-card>
          <el-table :data="pendingList" border stripe empty-text="暂无待审批项">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="100" align="center">
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
                <div v-if="row.type === 'probation'">
                  <div>转正申请</div>
                </div>
                <div v-else-if="row.reimbursementInfo">
                  <div>{{ normalizeReimbursementTitle(row.reimbursementInfo.title) }}</div>
                  <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                    ¥{{ row.reimbursementInfo.amount.toFixed(2) }}
                  </div>
                </div>
                <div v-else>-</div>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.type === 'probation'" type="success" size="small">转正申请</el-tag>
                <el-tag v-else type="primary" size="small">商务报销</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="客户/对象" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.client || row.serviceTarget || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="getStatusTagType(row.reimbursementStatus) as any"
                  :color="getStatusColor(row.reimbursementStatus)"
                  :style="getStatusColor(row.reimbursementStatus) ? { color: '#fff', borderColor: getStatusColor(row.reimbursementStatus) } : {}"
                  size="small"
                >
                  {{ getStatusLabel(row.reimbursementStatus) }}
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
                  <template v-if="row.type === 'probation'">
                    <el-button
                      type="primary"
                      size="small"
                      :icon="View"
                      @click="handleViewProbation(row)"
                    >
                      详情
                    </el-button>
                    <el-button type="success" size="small" :icon="Check" @click="handleApproveProbation(row)">
                      通过
                    </el-button>
                    <el-button type="danger" size="small" :icon="Close" @click="handleRejectProbation(row)">
                      驳回
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button
                      type="primary"
                      size="small"
                      :icon="View"
                      @click="handleViewReimbursement(row)"
                    >
                      详情
                    </el-button>
                    <el-button
                      type="info"
                      size="small"
                      :icon="List"
                      @click="handleViewApprovalProcess(row)"
                    >
                      审批流程
                    </el-button>
                    <el-button type="success" size="small" :icon="Check" @click="handleApprove(row)">
                      通过
                    </el-button>
                    <el-button type="danger" size="small" :icon="Close" @click="handleReject(row)">
                      驳回
                    </el-button>
                  </template>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 本月已审批 -->
      <el-tab-pane label="本月已审批" name="completed">
        <el-card>
          <div class="summary-bar" v-if="completedList.length > 0">
            <span>共 <strong>{{ completedList.length }}</strong> 条记录</span>
            <span style="margin-left: 16px;">总金额 <strong style="color: #409eff;">¥{{ completedTotalAmount.toFixed(2) }}</strong></span>
          </div>
          <el-table :data="completedList" border stripe empty-text="暂无已审批记录">
            <el-table-column label="序号" width="60" align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="100" align="center">
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
            <el-table-column label="报销类型" min-width="80" align="center">
              <template #default>
                <el-tag type="primary" size="small">商务报销</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="客户/对象" min-width="120" align="center">
              <template #default="{ row }">
                {{ row.client || row.serviceTarget || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="getStatusTagType(row.status) as any"
                  :color="getStatusColor(row.status)"
                  :style="getStatusColor(row.status) ? { color: '#fff', borderColor: getStatusColor(row.status) } : {}"
                  size="small"
                >
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="审批时间" min-width="130" align="center">
              <template #default="{ row }">
                {{ row.approveTime ? formatDate(row.approveTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="170" align="center">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button
                    type="primary"
                    size="small"
                    :icon="View"
                    @click="handleViewReimbursementDetail(row)"
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
                </div>
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
                  style="width: 160px"
                >
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
                  clearable
                  placeholder="全部"
                  style="width: 200px"
                />
              </el-form-item>
              <el-form-item label="状态">
                <el-select
                  v-model="allFilterForm.status"
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
                  v-model="dateRangeModel"
                  :type="currentDatePickerType"
                  :value-format="currentDateValueFormat"
                  :start-placeholder="currentStartPlaceholder"
                  :end-placeholder="currentEndPlaceholder"
                  range-separator="至"
                  style="width: 280px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :icon="Search" :loading="allListLoading" @click="handleQueryAllList">
                  查询
                </el-button>
                <el-button @click="handleResetAllFilter">重置</el-button>
                <el-button type="success" :icon="Download" @click="handleExportAllList">导出</el-button>
              </el-form-item>
            </el-form>
          </div>

          <!-- 汇总信息条 -->
          <div class="summary-bar" v-if="allList.length > 0">
            <span>共 <strong>{{ allList.length }}</strong> 条记录</span>
            <span style="margin-left: 16px;">总金额 <strong style="color: #409eff;">¥{{ allTotalAmount.toFixed(2) }}</strong></span>
          </div>

          <!-- 列表 -->
          <el-table :data="allList" border stripe empty-text="请设置筛选条件后点击查询" v-loading="allListLoading">
            <el-table-column label="序号" width="60" align="center" header-align="center">
              <template #default="{ $index }">
                {{ $index + 1 }}
              </template>
            </el-table-column>
            <el-table-column label="申请人" min-width="100" align="center" header-align="center">
              <template #default="{ row }">
                <div class="applicant-cell">
                  <el-avatar :src="row.applicantAvatar" :size="28">
                    <el-icon><User /></el-icon>
                  </el-avatar>
                  <span>{{ row.applicantName }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="标题/金额" min-width="150" align="center" header-align="center">
              <template #default="{ row }">
                <div>{{ normalizeReimbursementTitle(row.title) }}</div>
                <div style="color: #409eff; font-weight: 600; margin-top: 4px;">
                  ¥{{ row.amount.toFixed(2) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="报销类型" min-width="100" align="center" header-align="center">
              <template #default="{ row }">
                <el-tag :type="getTypeTagType(row.type)" size="small">
                  {{ row.typeName }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="报销范围/区域" min-width="120" align="center" header-align="center">
              <template #default="{ row }">
                {{ row.reimbursementScope ? (scopeMap[row.reimbursementScope] || row.reimbursementScope) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="客户/对象" min-width="120" align="center" header-align="center">
              <template #default="{ row }">
                {{ row.client || row.serviceTarget || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="80" align="center" header-align="center">
              <template #default="{ row }">
                <el-tag
                  :type="getStatusTagType(row.status) as any"
                  :color="getStatusColor(row.status)"
                  :style="getStatusColor(row.status) ? { color: '#fff', borderColor: getStatusColor(row.status) } : {}"
                  size="small"
                >
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="审批时间" min-width="130" align="center" header-align="center">
              <template #default="{ row }">
                {{ row.approveTime ? formatDate(row.approveTime) : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="150" align="center" header-align="center">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button
                    type="primary"
                    size="small"
                    link
                    @click="handleViewReimbursementDetail(row)"
                  >
                    详情
                  </el-button>
                  <el-button
                    type="info"
                    size="small"
                    link
                    @click="handleViewApprovalProcess(row)"
                  >
                    审批流程
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

    </el-tabs>

    <!-- 驳回对话框 -->
    <el-dialog
      v-model="rejectDialogVisible"
      title="驳回原因"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="rejectFormRef"
        :model="rejectForm"
        :rules="rejectFormRules"
        label-width="80px"
      >
        <el-form-item label="驳回原因" prop="comment">
          <el-input
            v-model="rejectForm.comment"
            type="textarea"
            :rows="4"
            placeholder="请填写驳回原因"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="rejectLoading" @click="confirmReject">
          确认驳回
        </el-button>
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
            <el-descriptions-item label="报销单号">{{ currentApprovalRecord.targetId }}</el-descriptions-item>
            <el-descriptions-item label="报销类型">商务报销</el-descriptions-item>
            <el-descriptions-item label="报销事由" :span="2">{{ normalizeReimbursementTitle(currentApprovalRecord.title) }}</el-descriptions-item>
            <el-descriptions-item label="申请人">{{ currentApprovalRecord.applicantName }}</el-descriptions-item>
            <el-descriptions-item label="报销金额">
              <span class="amount-highlight">¥{{ currentApprovalRecord.amount.toFixed(2) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag
                :type="getStatusTagType(currentApprovalRecord.status) as any"
                :color="getStatusColor(currentApprovalRecord.status)"
                :style="getStatusColor(currentApprovalRecord.status) ? { color: '#fff', borderColor: getStatusColor(currentApprovalRecord.status) } : {}"
                size="small"
              >
                {{ getStatusLabel(currentApprovalRecord.status) }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 审批流程时间线 -->
        <div class="timeline-section">
          <h4 class="section-title">审批流程</h4>
          <el-timeline>
            <!-- 1. 员工提交（始终显示） -->
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

            <!-- 2. 审批记录（如果有，显示详细的历史操作记录） -->
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
                    {{ record.approverName || '总经理' }}
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
            <!-- 如果没有审批记录，根据状态显示简化版本 -->
            <template v-else>
              <el-timeline-item
                v-if="['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                :timestamp="currentApprovalRecord.approveTime ? formatDate(currentApprovalRecord.approveTime) : ''"
                placement="top"
                type="success"
              >
                <div class="timeline-content">
                  <div class="timeline-title">总经理{{ currentApprovalRecord.gmApproverName ? '（' + currentApprovalRecord.gmApproverName + '）' : '' }}审批</div>
                  <div class="timeline-desc">{{ currentApprovalRecord.approver || '总经理' }} 审批通过</div>
                </div>
              </el-timeline-item>
              <el-timeline-item
                v-else-if="currentApprovalRecord.status === 'rejected'"
                :timestamp="currentApprovalRecord.approveTime ? formatDate(currentApprovalRecord.approveTime) : ''"
                placement="top"
                type="danger"
              >
                <div class="timeline-content">
                  <div class="timeline-title">总经理{{ currentApprovalRecord.gmApproverName ? '（' + currentApprovalRecord.gmApproverName + '）' : '' }}审批</div>
                  <div class="timeline-desc">{{ currentApprovalRecord.approver || '总经理' }} 驳回了申请</div>
                  <div v-if="currentApprovalRecord.rejectReason" class="reject-reason-box">
                    <div class="reject-reason-label">驳回原因：</div>
                    <div class="reject-reason-text">{{ currentApprovalRecord.rejectReason }}</div>
                  </div>
                </div>
              </el-timeline-item>
            </template>

            <!-- 驳回重新提交后，等待审批的下一步；或首次待审批 -->
            <el-timeline-item
              v-if="currentApprovalRecord.status === 'pending'"
              timestamp="待审批"
              placement="top"
              type="warning"
            >
              <div class="timeline-content">
                <div class="timeline-title">总经理{{ currentApprovalRecord.gmApproverName ? '（' + currentApprovalRecord.gmApproverName + '）' : '' }}审批</div>
                <div class="timeline-desc">等待总经理{{ currentApprovalRecord.gmApproverName ? '（' + currentApprovalRecord.gmApproverName + '）' : '' }}审批...</div>
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

              <!-- 3. 财务付款：approved及之后的状态才显示 -->
              <el-timeline-item
                v-if="['approved', 'payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                :timestamp="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) ? (currentApprovalRecord.payTime ? formatDate(currentApprovalRecord.payTime) : '') : '待处理'"
                placement="top"
                :type="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) ? 'success' : 'info'"
              >
                <div class="timeline-content">
                  <div class="timeline-title" :class="{ 'timeline-pending': !['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) }">财务付款</div>
                  <div class="timeline-desc">
                    <template v-if="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)">财务已付款</template>
                    <template v-else>等待财务付款...</template>
                  </div>
                </div>
              </el-timeline-item>

              <!-- 4. 上传付款凭证：payment_uploaded及之后的状态才显示 -->
              <el-timeline-item
                v-if="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)"
                :timestamp="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) ? (currentApprovalRecord.paymentUploadTime ? formatDate(currentApprovalRecord.paymentUploadTime) : '') : '待处理'"
                placement="top"
                :type="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) ? 'success' : 'info'"
              >
                <div class="timeline-content">
                  <div class="timeline-title" :class="{ 'timeline-pending': !['payment_uploaded', 'completed'].includes(currentApprovalRecord.status) }">上传付款凭证</div>
                  <div class="timeline-desc">
                    <template v-if="['payment_uploaded', 'completed'].includes(currentApprovalRecord.status)">
                      财务已上传付款凭证
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
                    </template>
                    <template v-else>等待上传付款凭证...</template>
                  </div>
                </div>
              </el-timeline-item>

              <!-- 5. 确认收款/完成：payment_uploaded及之后的状态才显示 -->
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
            <el-table-column prop="scopeName" label="报销范围" min-width="150" align="center" header-align="center" />
            <el-table-column label="报销笔数" width="100" align="center" header-align="center">
              <template #default="{ row }">
                {{ row.count }} 笔
              </template>
            </el-table-column>
            <el-table-column label="报销金额" width="120" align="center" header-align="center">
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
                  <span>{{ emp.name }}</span>
                  <span style="margin-left: 8px; color: #909399;">{{ emp.department || '' }}</span>
                  <span style="margin-left: auto; color: #409eff; font-weight: 600;">¥{{ emp.totalAmount.toFixed(2) }}</span>
                  <span style="margin-left: 8px; color: #909399;">{{ emp.count }}笔</span>
                </div>
              </template>
              <el-table :data="emp.details" border size="small">
                <el-table-column prop="typeName" label="类型" width="100" align="center" header-align="center" />
                <el-table-column prop="title" label="报销事由" min-width="150" align="center" header-align="center">
                  <template #default="{ row }">
                    {{ normalizeReimbursementTitle(row.title) }}
                  </template>
                </el-table-column>
                <el-table-column label="金额" width="100" align="center" header-align="center">
                  <template #default="{ row }">
                    ¥{{ row.amount.toFixed(2) }}
                  </template>
                </el-table-column>
                <el-table-column prop="statusName" label="状态" width="100" align="center" header-align="center" />
                <el-table-column label="提交时间" width="180" align="center" header-align="center">
                  <template #default="{ row }">
                    {{ formatDate(row.submitTime) }}
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
import { User, Check, Close, View, Clock, SuccessFilled, List, Document, ZoomIn, Search, Download } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { toFileUrl, isImageFile } from '@/utils/file'
import { normalizeReimbursementTitle } from '@/utils/reimbursement/date'
import { usePendingStore } from '@/stores/pending'
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
  submitTime: string
  completeTime?: string
  createdAt: string
  reimbursementInfo?: {
    title: string
    amount: number
  }
  reimbursementType?: string
  reimbursementScope?: string
  client?: string
  serviceTarget?: string
  reimbursementStatus?: string
  paymentUploadTime?: string
  paymentProofPath?: string
}

interface ReimbursementItem {
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
  approveTime?: string
  approver?: string
  payTime?: string
  completedTime?: string
  submitTime: string
  userId: string
  reimbursementScope?: string
  client?: string
  serviceTarget?: string
  createdAt: string
  paymentProofPath?: string
  paymentUploadTime?: string
}

interface Statistics {
  pendingCount: number
  pendingAmount: number
  completedThisMonth: number
  completedThisMonthAmount: number
  completedCount: number
  completedAmount: number
  currentMonth: string
}

interface ApprovalProcessRecord {
  id: string
  targetId: string
  type: string
  title: string
  amount: number
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
  adminApproverName?: string
  gmApproverName?: string
  description?: string
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

interface Employee {
  id: string
  name: string
}

// 使用 computed 直接绑定 URL 参数，确保标签页状态始终与 URL 同步
const activeTab = computed({
  get: () => (route.query.tab as string) || 'pending',
  set: (value: string) => {
    router.replace({ query: { ...route.query, tab: value } })
  }
})
const isMounted = ref(false)
const pendingList = ref<ApprovalItem[]>([])
const completedList = ref<ReimbursementItem[]>([])
const allList = ref<ReimbursementItem[]>([])
const allListLoading = ref(false)
const statistics = ref<Statistics>({
  pendingCount: 0,
  pendingAmount: 0,
  completedThisMonth: 0,
  completedThisMonthAmount: 0,
  completedCount: 0,
  completedAmount: 0,
  currentMonth: '',
})

// 员工列表
const employeeList = ref<Employee[]>([])

// 全部查询筛选条件
const allFilterForm = reactive({
  userId: '',
  type: [] as string[],
  status: '',
  reimbursementScope: [] as string[],
  dateQueryType: 'day' as 'year' | 'month' | 'day',
  dateRange: null as [string, string] | null,
  yearRange: null as [string, string] | null,
  monthRange: null as [string, string] | null,
})

// 日期选择器类型
const currentDatePickerType = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return 'yearrange'
  if (allFilterForm.dateQueryType === 'month') return 'monthrange'
  return 'daterange'
})

// 日期格式
const currentDateValueFormat = computed(() => {
  if (allFilterForm.dateQueryType === 'year') return 'YYYY'
  if (allFilterForm.dateQueryType === 'month') return 'YYYY-MM'
  return 'YYYY-MM-DD'
})

// 日期占位符
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

// 日期范围双向绑定
const dateRangeModel = computed({
  get() {
    if (allFilterForm.dateQueryType === 'year') return allFilterForm.yearRange
    if (allFilterForm.dateQueryType === 'month') return allFilterForm.monthRange
    return allFilterForm.dateRange
  },
  set(value: [string, string] | null) {
    if (allFilterForm.dateQueryType === 'year') {
      allFilterForm.yearRange = value
    } else if (allFilterForm.dateQueryType === 'month') {
      allFilterForm.monthRange = value
    } else {
      allFilterForm.dateRange = value
    }
  },
})

// 所属区域选项
const scopeList = [
  {
    value: 'company_internal',
    name: '公司内部',
  },
  {
    value: 'haidian',
    name: '海淀区',
    children: [
      { value: 'haidian_gjdw', name: 'GJDW' },
      { value: 'haidian_wfah', name: 'WFAH' },
    ],
  },
  {
    value: 'chaoyang',
    name: '朝阳区',
    children: [
      { value: 'chaoyang_gjdw', name: 'GJDW' },
    ],
  },
]

// 所属区域映射（从 API 动态获取）
const scopeMap = ref<Record<string, string>>({})

// 从 API 获取报销范围配置
const fetchScopeOptions = async () => {
  try {
    const response = await api.get('/api/reimbursement-scope/list')
    if (response.data.success) {
      const buildMap = (items: any[], parentName = '') => {
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
      buildMap(response.data.data)
    }
  } catch (error) {
    console.error('获取报销范围配置失败:', error)
  }
}

// 计算已审批列表的总金额
const completedTotalAmount = computed(() => {
  return completedList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
})

// 计算全部查询列表的总金额
const allTotalAmount = computed(() => {
  return allList.value.reduce((sum, item) => sum + (item.amount || 0), 0)
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
    submitTime: string
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

// 审批流程对话框
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

// 预览付款回单
function handlePreviewPaymentProof(url?: string) {
  const raw = url || currentApprovalRecord.value?.paymentProofPath?.split(',')[0] || ''
  previewingProofUrl.value = toFileUrl(raw)
  paymentProofDialogVisible.value = true
}

// 格式化日期
function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  // 兼容旧格式 "YYYY-MM-DD HH:mm:ss"，替换空格为T确保跨浏览器解析
  const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 切换标签页（通过统计卡片点击）
function switchTab(tab: string) {
  activeTab.value = tab  // 这会触发 computed setter，自动更新 URL
  // 手动触发数据加载
  if (tab === 'pending') {
    fetchPendingList()
  } else if (tab === 'completed') {
    fetchCompletedList()
  }
}

// 标签页切换处理（el-tabs 的 @tab-change 事件）
function handleTabChange(tab: any) {
  // 跳过 el-tabs 初始化时自动触发的 tab-change 事件
  if (!isMounted.value) return
  // activeTab 的 setter 已经处理了 URL 更新，这里只需加载数据
  if (tab === 'pending') {
    fetchPendingList()
  } else if (tab === 'completed') {
    fetchCompletedList()
  }
  // 全部查询标签不自动加载，等用户点击查询按钮
}

// 获取统计数据
async function fetchStatistics() {
  try {
    const response = await api.get('/api/approval/gm-statistics')
    if (response.data.success) {
      statistics.value = response.data.data
    }
  } catch (error) {
    console.error('获取统计数据失败:', error)
  }
}

// 获取待审批列表
async function fetchPendingList() {
  try {
    const response = await api.get('/api/approval/gm-pending')
    if (response.data.success) {
      pendingList.value = response.data.data
    }
  } catch (error) {
    console.error('获取待审批列表失败:', error)
    ElMessage.error('获取待审批列表失败')
  }
}

// 获取本月已审批列表
async function fetchCompletedList() {
  try {
    const response = await api.get('/api/approval/gm-completed')
    if (response.data.success) {
      completedList.value = response.data.data
    }
  } catch (error) {
    console.error('获取已审批列表失败:', error)
    ElMessage.error('获取已审批列表失败')
  }
}

// 获取全部查询列表
async function fetchAllList() {
  try {
    allListLoading.value = true
    const params: any = {}

    console.log('[前端] fetchAllList - dateQueryType:', allFilterForm.dateQueryType)
    console.log('[前端] fetchAllList - dateRange:', allFilterForm.dateRange)
    console.log('[前端] fetchAllList - monthRange:', allFilterForm.monthRange)
    console.log('[前端] fetchAllList - yearRange:', allFilterForm.yearRange)

    if (allFilterForm.userId) {
      params.userId = allFilterForm.userId
    }

    if (allFilterForm.type.length > 0) {
      params.type = allFilterForm.type.join(',')
    }

    if (allFilterForm.status) {
      params.status = allFilterForm.status
    }

    if (allFilterForm.reimbursementScope.length > 0) {
      params.reimbursementScope = allFilterForm.reimbursementScope.join(',')
    }

    // 处理日期范围
    if (allFilterForm.dateQueryType === 'day' && allFilterForm.dateRange && allFilterForm.dateRange[0] && allFilterForm.dateRange[1]) {
      params.startDate = allFilterForm.dateRange[0]
      params.endDate = allFilterForm.dateRange[1]
      console.log('[前端] 日期筛选 - 类型: day, startDate:', params.startDate, 'endDate:', params.endDate)
    } else if (allFilterForm.dateQueryType === 'month' && allFilterForm.monthRange && allFilterForm.monthRange[0] && allFilterForm.monthRange[1]) {
      const [startYear, startMonth] = allFilterForm.monthRange[0].split('-')
      const [endYear, endMonth] = allFilterForm.monthRange[1].split('-')
      params.startDate = `${startYear}-${startMonth}-01`
      const lastDay = new Date(parseInt(endYear), parseInt(endMonth), 0).getDate()
      params.endDate = `${endYear}-${endMonth}-${String(lastDay).padStart(2, '0')}`
      console.log('[前端] 日期筛选 - 类型: month, startDate:', params.startDate, 'endDate:', params.endDate)
    } else if (allFilterForm.dateQueryType === 'year' && allFilterForm.yearRange && allFilterForm.yearRange[0] && allFilterForm.yearRange[1]) {
      params.startDate = `${allFilterForm.yearRange[0]}-01-01`
      params.endDate = `${allFilterForm.yearRange[1]}-12-31`
      console.log('[前端] 日期筛选 - 类型: year, startDate:', params.startDate, 'endDate:', params.endDate)
    }

    console.log('[前端] API请求参数:', params)
    const response = await api.get('/api/approval/gm-all', { params })
    console.log('[前端] API响应数据数量:', response.data.data?.length || 0)
    if (response.data.success) {
      allList.value = response.data.data
    }
  } catch (error) {
    console.error('获取全部查询列表失败:', error)
    ElMessage.error('获取全部查询列表失败')
  } finally {
    allListLoading.value = false
  }
}

// 查询全部列表
function handleQueryAllList() {
  fetchAllList()
}

// 重置筛选条件
function handleResetAllFilter() {
  allFilterForm.userId = ''
  allFilterForm.type = []
  allFilterForm.status = ''
  allFilterForm.reimbursementScope = []
  allFilterForm.dateRange = null
  allFilterForm.yearRange = null
  allFilterForm.monthRange = null
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

  // 按报销范围分类统计（仅统计商务报销）
  const byScopeMap: Record<string, { scope: string; scopeName: string; count: number; amount: number }> = {}
  allList.value.forEach(item => {
    // 只统计有报销范围的记录（商务报销）
    if (item.reimbursementScope && item.type === 'business') {
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
      totalAmount: allTotalAmount.value,
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
        formatDate(detail.submitTime),
      ])
    })
  })

  // 添加汇总行
  rows.push([])
  rows.push(['汇总', '', '', '', allExportData.value.summary.totalAmount.toFixed(2), `共${allExportData.value.summary.totalCount}笔`, ''])

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

// 获取员工列表
async function fetchEmployeeList() {
  try {
    const response = await api.get('/api/approval/employees')
    if (response.data.success) {
      employeeList.value = response.data.data
    }
  } catch (error) {
    console.error('获取员工列表失败:', error)
  }
}

// 查看报销单详情
function handleViewReimbursement(row: ApprovalItem) {
  router.push(`/business-reimbursement/${row.targetId}?mode=view`)
}

// 查看转正申请详情
function handleViewProbation(row: ApprovalItem) {
  router.push(`/gm-probation-approval?id=${row.targetId}`)
}

// 通过转正申请
async function handleApproveProbation(row: ApprovalItem) {
  try {
    await ElMessageBox.confirm('确认通过该转正申请？', '确认通过', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'success',
    })

    const response = await api.post(`/api/probation/${row.targetId}/approve`)

    if (response.data.success) {
      ElMessage.success('审批通过')
      await pendingStore.refreshPendingCounts()
      await fetchPendingList()
      await fetchStatistics()
    } else {
      ElMessage.error(response.data.message || '审批失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('审批失败:', error)
      ElMessage.error('审批失败')
    }
  }
}

// 驳回转正申请
async function handleRejectProbation(row: ApprovalItem) {
  try {
    const { value: comment } = await ElMessageBox.prompt('请填写驳回原因', '驳回转正申请', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请填写驳回原因',
      inputValidator: (value) => {
        if (!value || value.trim().length < 2) {
          return '驳回原因至少2个字符'
        }
        return true
      },
    })

    const response = await api.post(`/api/probation/${row.targetId}/reject`, {
      comment: comment?.trim(),
    })

    if (response.data.success) {
      ElMessage.success('已驳回')
      await pendingStore.refreshPendingCounts()
      await fetchPendingList()
      await fetchStatistics()
    } else {
      ElMessage.error(response.data.message || '驳回失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('驳回失败:', error)
      ElMessage.error('驳回失败')
    }
  }
}

// 查看已审批报销单详情
function handleViewReimbursementDetail(row: ReimbursementItem) {
  const routeMap: Record<string, string> = {
    basic: '/basic-reimbursement',
    large: '/large-reimbursement',
    business: '/business-reimbursement',
  }
  const basePath = routeMap[row.type] || '/business-reimbursement'
  router.push(`${basePath}/${row.id}?mode=view`)
}

// 加载审批记录
async function loadApprovalRecords(reimbursementId: string) {
  try {
    console.log('[前端] 开始加载审批记录, reimbursementId:', reimbursementId)
    const res = await api.get('/api/approval/by-target', {
      params: {
        targetId: reimbursementId,
        targetType: 'reimbursement',
      },
    })

    console.log('[前端] 审批记录API响应:', res.data)
    if (res.data.success && res.data.data) {
      approvalRecords.value = res.data.data.records || []
      console.log('[前端] 加载到的审批记录数量:', approvalRecords.value.length)

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

// 查看待审批的审批流程
async function handleViewApprovalProcess(row: ApprovalItem | ReimbursementItem) {
  console.log('[前端] handleViewApprovalProcess 被调用, row:', row)
  const isApprovalItem = 'targetId' in row
  const reimbursementId = isApprovalItem ? row.targetId : row.id
  console.log('[前端] isApprovalItem:', isApprovalItem, 'reimbursementId:', reimbursementId)

  if (isApprovalItem) {
    // 待审批项
    currentApprovalRecord.value = {
      id: row.id,
      targetId: row.targetId,
      type: 'business',
      title: row.reimbursementInfo?.title || '',
      amount: row.reimbursementInfo?.amount || 0,
      applicantName: row.applicantName || '',
      applicantAvatar: row.applicantAvatar || '',
      submitTime: row.submitTime,
      status: row.status,
      approveTime: '',
      approver: '',
      rejectReason: '',
      payTime: '',
      paymentUploadTime: row.paymentUploadTime || '',
      completedTime: '',
      paymentProofPath: row.paymentProofPath || '',
      receiptConfirmedBy: '',
      description: '',
    }
  } else {
    // 已审批项
    currentApprovalRecord.value = {
      id: row.id,
      targetId: row.id,
      type: 'business',
      title: row.title,
      amount: row.amount,
      applicantName: row.applicantName,
      applicantAvatar: row.applicantAvatar || '',
      submitTime: row.submitTime || '',
      status: row.status,
      approveTime: row.approveTime || '',
      approver: row.approver || '',
      rejectReason: '',
      payTime: row.payTime || '',
      paymentUploadTime: row.paymentUploadTime || '',
      completedTime: row.completedTime || '',
      paymentProofPath: row.paymentProofPath || '',
      receiptConfirmedBy: '',
      description: '',
    }
  }

  // 加载审批记录（会用最新状态覆盖）
  await loadApprovalRecords(reimbursementId)

  approvalProcessDialogVisible.value = true
}

// 跳转到报销单详情
function handleGoToReimbursementDetail() {
  if (!currentApprovalRecord.value) return
  approvalProcessDialogVisible.value = false
  router.push(`/business-reimbursement/${currentApprovalRecord.value.targetId}?mode=view`)
}

// 通过审批
async function handleApprove(row: ApprovalItem) {
  try {
    await ElMessageBox.confirm('确认通过该商务报销申请？', '确认通过', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'success',
    })

    const response = await api.post(`/api/approval/${row.id}/approve`, {
      comment: '通过',
    })

    if (response.data.success) {
      ElMessage.success('审批通过')
      // 立即刷新菜单栏角标
      await pendingStore.refreshPendingCounts()
      await fetchPendingList()
      await fetchStatistics()
    } else {
      ElMessage.error(response.data.message || '审批失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('审批失败:', error)
      ElMessage.error('审批失败')
    }
  }
}

// 驳回审批
function handleReject(row: ApprovalItem) {
  rejectForm.id = row.id
  rejectForm.comment = ''
  rejectDialogVisible.value = true
}

// 确认驳回
async function confirmReject() {
  if (!rejectFormRef.value) return

  await rejectFormRef.value.validate(async (valid) => {
    if (!valid) return

    try {
      rejectLoading.value = true
      const response = await api.post(`/api/approval/${rejectForm.id}/reject`, {
        comment: rejectForm.comment,
      })

      if (response.data.success) {
        ElMessage.success('已驳回')
        rejectDialogVisible.value = false
        // 立即刷新菜单栏角标
        await pendingStore.refreshPendingCounts()
        await fetchPendingList()
        await fetchStatistics()
      } else {
        ElMessage.error(response.data.message || '驳回失败')
      }
    } catch (error) {
      console.error('驳回失败:', error)
      ElMessage.error('驳回失败')
    } finally {
      rejectLoading.value = false
    }
  })
}

// 获取状态标签类型
function getStatusTagType(status: string) {
  const typeMap: Record<string, string> = {
    draft: 'info',
    pending: 'warning',
    approved: '',
    payment_uploaded: '',
    completed: 'success',
    rejected: 'danger',
  }
  return typeMap[status] || 'info'
}

// 获取状态自定义颜色（用于区分相似状态）
function getStatusColor(status: string) {
  const colorMap: Record<string, string> = {
    approved: '#409eff',
    payment_uploaded: '#17a2b8',
  }
  return colorMap[status] || ''
}

// 获取状态标签文本
function getStatusLabel(status: string) {
  const labelMap: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '待付款',
    payment_uploaded: '待确认',
    completed: '已完成',
    rejected: '已驳回',
  }
  return labelMap[status] || status
}

// 获取类型标签类型
function getTypeTagType(type: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'primary'> = {
    basic: 'success',
    large: 'warning',
    business: 'primary',
  }
  return typeMap[type] || 'info'
}

// 初始化
onMounted(async () => {
  await fetchScopeOptions()
  await fetchStatistics()
  await fetchEmployeeList()
  // 根据当前 tab 加载对应数据
  if (activeTab.value === 'completed') {
    await fetchCompletedList()
  } else if (activeTab.value === 'all') {
    await fetchAllList()
  } else {
    await fetchPendingList()
  }
  // 数据加载完成后才允许 tab-change 事件处理
  await nextTick()
  isMounted.value = true
})
</script>

<style scoped lang="scss">
// 禁用标签页切换动画，防止返回时出现视觉跳转
.no-transition-tabs {
  :deep(.el-tabs__active-bar) {
    transition: none !important;
  }
  :deep(.el-tabs__nav-wrap::after) {
    transition: none !important;
  }
}

.gm-approval-center {
  .statistics-section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 24px;

    .stat-card {
      cursor: pointer;
      transition: all 0.3s ease;
      border: 1px solid #ebeef5;
      border-radius: 8px;

      &:hover {
        transform: translateY(-4px);
      }

      &.active {
        border-color: var(--el-color-primary);
        border-width: 2px;
      }

      &.pending-card.active {
        border-color: #e6a23c;
        border-width: 2px;
      }

      &.completed-card.active {
        border-color: #67c23a;
        border-width: 2px;
      }

      .stat-content {
        display: flex;
        align-items: center;
        gap: 16px;

        .stat-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          border-radius: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .stat-info {
          flex: 1;

          .stat-value {
            font-size: 32px;
            font-weight: bold;
            color: #303133;
            line-height: 1;
            margin-bottom: 8px;
          }

          .stat-label {
            font-size: 14px;
            color: #909399;
          }

          .stat-amount {
            font-size: 14px;
            color: #409eff;
            font-weight: 600;
            margin-top: 4px;
          }
        }
      }
    }

    .pending-card .stat-icon {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .completed-card .stat-icon {
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    }

    .all-card .stat-icon {
      background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
    }

    .all-card.active {
      border-color: #909399;
    }
  }

  .filter-section {
    margin-bottom: 16px;
    padding: 16px;
    background: #f5f7fa;
    border-radius: 4px;
    overflow: hidden;

    .filter-form {
      margin-bottom: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;

      :deep(.el-form-item) {
        margin-bottom: 0;
        margin-right: 12px;
        flex-shrink: 0;
      }
    }
  }

  .applicant-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;

    span {
      font-weight: 500;
    }
  }

  .action-buttons {
    display: flex;
    gap: 8px;
    flex-wrap: nowrap;
    justify-content: center;
  }

  .summary-bar {
    padding: 12px 16px;
    background: #f5f7fa;
    border-radius: 4px;
    margin-bottom: 16px;
    font-size: 14px;
    color: #606266;

    strong {
      color: #303133;
      font-size: 16px;
    }
  }
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

.timeline-pending {
  color: #c0c4cc;
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

/* 付款回单预览 */
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

/* 导出预览样式 */
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

// 强制表格内容居中对齐
.export-scope-summary :deep(.el-table) {
  th.el-table__cell,
  td.el-table__cell {
    text-align: center !important;
  }
  .el-table__cell .cell {
    text-align: center !important;
    justify-content: center !important;
    display: flex !important;
  }
}

.export-employees :deep(.el-table) {
  th.el-table__cell,
  td.el-table__cell {
    text-align: center !important;
  }
  .el-table__cell .cell {
    text-align: center !important;
    justify-content: center !important;
    display: flex !important;
  }
}

.employee-collapse-title {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.export-empty {
  padding: 40px 0;
}
</style>
