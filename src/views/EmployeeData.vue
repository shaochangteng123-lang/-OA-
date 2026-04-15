<template>
  <div class="employee-data-container">
    <el-card class="page-card">
      <div class="content-wrapper">
        <!-- Tab 切换 -->
        <el-tabs v-model="activeTab" class="main-tabs">
          <!-- 员工数据 Tab -->
          <el-tab-pane label="员工数据" name="data">
            <div class="tab-content">
              <!-- 统计卡片 -->
              <div class="stats-section">
                <el-row :gutter="16">
                  <el-col :span="5">
                    <div class="stat-card">
                      <div class="stat-value">{{ stats.total }}</div>
                      <div class="stat-label">员工总数</div>
                    </div>
                  </el-col>
                  <el-col :span="5">
                    <div class="stat-card stat-active">
                      <div class="stat-value">{{ stats.active }}</div>
                      <div class="stat-label">在职</div>
                    </div>
                  </el-col>
                  <el-col :span="5">
                    <div class="stat-card stat-probation">
                      <div class="stat-value">{{ stats.probation }}</div>
                      <div class="stat-label">实习期</div>
                    </div>
                  </el-col>
                  <el-col :span="5">
                    <div class="stat-card stat-onleave">
                      <div class="stat-value">{{ stats.onLeave }}</div>
                      <div class="stat-label">休假中</div>
                    </div>
                  </el-col>
                  <el-col :span="4">
                    <div class="stat-card stat-resigned">
                      <div class="stat-value">{{ stats.resigned }}</div>
                      <div class="stat-label">已离职</div>
                    </div>
                  </el-col>
                </el-row>
              </div>

              <!-- 筛选区域 -->
              <div class="filter-section">
                <el-form :inline="true" :model="filterForm" class="filter-form">
                  <el-form-item label="搜索类型">
                    <el-input v-model="filterForm.keyword" placeholder="姓名/手机号" clearable style="width: 180px" />
                  </el-form-item>
                  <el-form-item label="部门">
                    <el-input v-model="filterForm.department" placeholder="全部部门" clearable />
                  </el-form-item>
                  <el-form-item label="状态">
                    <el-select v-model="filterForm.employmentStatus" placeholder="全部状态" clearable style="width: 150px">
                      <el-option label="在职" value="active" />
                      <el-option label="实习期" value="probation" />
                      <el-option label="已离职" value="resigned" />
                      <el-option label="休假中" value="on_leave" />
                    </el-select>
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" :icon="Search" @click="handleSearch">
                      查询
                    </el-button>
                    <el-button :icon="Refresh" @click="handleReset">重置</el-button>
                    <el-button :icon="Download" @click="handleExport">导出</el-button>
                  </el-form-item>
                </el-form>
              </div>

              <!-- 员工列表 -->
              <el-table
                v-loading="loading"
                :data="employeeList"
                stripe
                style="width: 100%"
                header-align="center"
                :row-class-name="getRowClassName"
              >
                <el-table-column type="index" label="序号" width="60" align="center" />
                <el-table-column prop="employee_no" label="员工编号" min-width="100" align="center">
                  <template #default="{ row }">
                    {{ row.employee_no || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="name" label="姓名" min-width="80" align="center" />
                <el-table-column prop="gender" label="性别" min-width="60" align="center">
                  <template #default="{ row }">
                    {{ getGenderText(row.gender) }}
                  </template>
                </el-table-column>
                <el-table-column prop="department" label="部门" min-width="100" align="center">
                  <template #default="{ row }">
                    {{ row.department || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="position" label="职位" min-width="120" align="center">
                  <template #default="{ row }">
                    {{ row.position || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="mobile" label="联系电话" min-width="110" align="center">
                  <template #default="{ row }">
                    {{ row.mobile || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="email" label="邮箱" min-width="150" align="center">
                  <template #default="{ row }">
                    {{ row.email || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="hire_date" label="入职日期" min-width="100" align="center">
                  <template #default="{ row }">
                    {{ row.hire_date || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="contract_end_date" label="合同到期" min-width="100" align="center">
                  <template #default="{ row }">
                    <span :class="{ 'contract-expiring': isContractExpiring(row) }">
                      {{ row.contract_end_date || '-' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="employment_status" label="状态" min-width="80" align="center">
                  <template #default="{ row }">
                    <el-tag :type="getEmploymentStatusType(row.employment_status)">
                      {{ getEmploymentStatusText(row.employment_status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" min-width="120" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="handleView(row)">
                      查看
                    </el-button>
                    <el-button link type="primary" size="small" @click="handleEdit(row)">
                      编辑
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>

              <!-- 分页 -->
              <div class="pagination-wrapper">
                <el-pagination
                  v-model:current-page="pagination.page"
                  v-model:page-size="pagination.pageSize"
                  :total="pagination.total"
                  :page-sizes="[10, 20, 50, 100]"
                  layout="total, sizes, prev, pager, next, jumper"
                  @size-change="handleSizeChange"
                  @current-change="handlePageChange"
                />
              </div>
            </div>
          </el-tab-pane>

          <!-- 入职管理 Tab -->
          <el-tab-pane label="入职管理" name="management">
            <div class="tab-content">
              <!-- 说明 -->
              <el-alert
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 20px"
              >
                <template #title>
                  管理入职所需的 PDF 文件模板，上传后所有员工可在「入职」页面查看和下载（仅支持 PDF）
                </template>
              </el-alert>

              <!-- 入职文件管理 -->
              <el-table :data="onboardingStore.onboardingFiles" style="width: 100%" border>
                <el-table-column type="index" label="序号" width="70" align="center" />
                <el-table-column prop="name" label="文件类型" min-width="200">
                  <template #default="{ row }">
                    <div class="file-type-name">
                      <span class="name-text">{{ row.name }}</span>
                    </div>
                    <div v-if="row.children && row.children.length > 0" class="file-children">
                      <div v-for="(child, index) in row.children" :key="index" class="child-item">
                        {{ Number(index) + 1 }}. {{ child }}
                      </div>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="已上传文件" min-width="300">
                  <template #default="{ row }">
                    <!-- 邀请函无需上传 -->
                    <span v-if="row.id === 'invitation'" class="no-upload">无需上传</span>
                    <!-- 个人入职材料由员工自行准备 -->
                    <span v-else-if="row.id === 'personal'" class="self-prepare">员工自行准备后上交</span>
                    <div v-else-if="row.files && row.files.length > 0" class="uploaded-files">
                      <div v-for="file in row.files" :key="file.id" class="file-item">
                        <el-icon class="file-icon"><Document /></el-icon>
                        <span class="file-name-text">{{ file.name }}</span>
                        <el-button
                          link
                          type="primary"
                          size="small"
                          :icon="View"
                          @click="handlePreviewTemplate(file)"
                        >
                          预览
                        </el-button>
                        <el-button
                          link
                          type="danger"
                          size="small"
                          :icon="Delete"
                          @click="handleRemoveFile(row.id, file.id, file.name)"
                        >
                          删除
                        </el-button>
                      </div>
                    </div>
                    <span v-else class="no-file">暂无文件</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" min-width="120" align="center">
                  <template #default="{ row }">
                    <!-- 邀请函和个人入职材料无需上传 -->
                    <template v-if="row.id !== 'invitation' && row.id !== 'personal'">
                      <el-upload
                        :show-file-list="false"
                        :before-upload="(file: File) => handleUpload(row.id, file)"
                        accept=".pdf"
                      >
                        <el-button type="primary" size="small" :icon="Upload">
                          上传 PDF
                        </el-button>
                      </el-upload>
                      <div class="upload-only-pdf-tip">仅支持 PDF</div>
                    </template>
                    <span v-else class="no-action">-</span>
                  </template>
                </el-table-column>
              </el-table>

            </div>
          </el-tab-pane>

          <!-- 转正管理 Tab -->
          <el-tab-pane name="probation">
            <template #label>
              <span>转正管理</span>
              <el-badge v-if="probationPendingCount > 0" :value="probationPendingCount" type="danger" class="tab-badge" />
            </template>
            <div class="tab-content">
              <!-- 转正文件模板管理 -->
              <div class="section-block probation-template-section">
                <div class="section-header">
                  <h3>转正申请表模板</h3>
                  <el-upload
                    :show-file-list="false"
                    :before-upload="handleUploadProbationTemplate"
                    accept=".pdf"
                  >
                    <el-button type="primary" size="small" :icon="Upload">
                      上传 PDF 模板
                    </el-button>
                  </el-upload>
                </div>
                <el-alert
                  type="info"
                  :closable="false"
                  show-icon
                  style="margin-bottom: 16px"
                >
                  <template #title>
                    上传转正申请表 PDF 模板后，实习期员工可在「入职」页面下载并填写（仅支持 PDF）
                  </template>
                </el-alert>
                <el-table :data="probationStore.templates" style="width: 100%" border v-loading="probationStore.templatesLoading">
                  <el-table-column type="index" label="序号" width="70" align="center" />
                  <el-table-column prop="name" label="模板名称" min-width="200" />
                  <el-table-column prop="file_name" label="文件名" min-width="200" />
                  <el-table-column prop="uploaded_by_name" label="上传人" width="120" />
                  <el-table-column prop="created_at" label="上传时间" width="180">
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="150" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handlePreviewProbationTemplate(row)">
                        预览
                      </el-button>
                      <el-button link type="danger" size="small" @click="handleDeleteProbationTemplate(row)">
                        删除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <!-- 待转正员工列表 -->
              <div class="section-block probation-list-section">
                <div class="section-header">
                  <h3>转正申请列表</h3>
                  <div class="filter-actions">
                    <el-select v-model="probationStatusFilter" placeholder="全部状态" clearable style="width: 120px" @change="handleProbationFilterChange">
                      <el-option label="待提交" value="pending" />
                      <el-option label="待审批" value="submitted" />
                      <el-option label="已通过" value="approved" />
                      <el-option label="已驳回" value="rejected" />
                    </el-select>
                  </div>
                </div>
                <el-table :data="probationStore.confirmationList" style="width: 100%" border v-loading="probationStore.confirmationListLoading">
                  <el-table-column type="index" label="序号" width="60" align="center" />
                  <el-table-column prop="employee_name" label="员工姓名" min-width="80" align="center" />
                  <el-table-column prop="employee_department" label="部门" min-width="100" align="center">
                    <template #default="{ row }">
                      {{ row.employee_department || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="employee_position" label="职位" min-width="100" align="center">
                    <template #default="{ row }">
                      {{ row.employee_position || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="hire_date" label="入职日期" min-width="100" align="center" />
                  <el-table-column prop="probation_end_date" label="试用期截止" min-width="100" align="center" />
                  <el-table-column label="转正申请表" min-width="120" align="center">
                    <template #default="{ row }">
                      <template v-if="row.documents && row.documents.length > 0">
                        <el-button link type="primary" size="small" @click="openProbationDoc(row.id, row.documents[0].id)">
                          查看文件 ({{ row.documents.length }})
                        </el-button>
                      </template>
                      <span v-else class="no-file">未上传</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="status" label="状态" min-width="80" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getProbationStatusType(row.status)">
                        {{ getProbationStatusText(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="submit_time" label="提交时间" min-width="130" align="center">
                    <template #default="{ row }">
                      {{ row.submit_time ? formatDateTime(row.submit_time) : '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="approve_time" label="转正时间" min-width="130" align="center">
                    <template #default="{ row }">
                      {{ row.approve_time ? formatDateTime(row.approve_time) : '-' }}
                    </template>
                  </el-table-column>
                </el-table>
                <!-- 分页 -->
                <div class="pagination-wrapper" v-if="probationStore.confirmationPagination.total > 0">
                  <el-pagination
                    v-model:current-page="probationStore.confirmationPagination.page"
                    v-model:page-size="probationStore.confirmationPagination.pageSize"
                    :total="probationStore.confirmationPagination.total"
                    :page-sizes="[10, 20, 50]"
                    layout="total, sizes, prev, pager, next"
                    @size-change="handleProbationSizeChange"
                    @current-change="handleProbationPageChange"
                  />
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 离职管理 Tab -->
          <el-tab-pane name="resignation">
            <template #label>
              <span>离职管理</span>
              <el-badge v-if="resignationPendingCount > 0" :value="resignationPendingCount" type="danger" class="tab-badge" />
            </template>
            <div class="tab-content">
              <div class="section-block probation-template-section">
                <div class="section-header">
                  <h3>离职模板管理</h3>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('application_form')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传申请表模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('handover_form')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传交接单模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('termination_proof')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传终止/解除劳动关系证明模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('asset_handover')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传固定资产交接单模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('compensation_agreement')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传离职经济补偿协议书模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('expense_settlement_agreement')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传离职其他费用结算约定模版</el-button>
                    </el-upload>
                    <el-upload :show-file-list="false" :before-upload="handleUploadResignationTemplate('partner_dividend_settlement')" accept=".pdf">
                      <el-button type="primary" size="small" :icon="Upload">上传合伙人离任分红结算模版</el-button>
                    </el-upload>
                  </div>
                </div>
                <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
                  <template #title>
                    管理申请表、交接单、终止/解除劳动关系证明、固定资产交接单、离职经济补偿协议书、离职其他费用结算约定、合伙人离任分红结算模板。
                  </template>
                </el-alert>
                <el-table :data="sortedResignationTemplates" style="width: 100%" border v-loading="resignationStore.templatesLoading">
                  <el-table-column type="index" label="序号" width="70" align="center" />
                  <el-table-column label="模板类型" min-width="180" align="center">
                    <template #default="{ row }">
                      <span style="white-space: nowrap">{{ RESIGNATION_TEMPLATE_LABELS[row.template_type as ResignationTemplateType] || row.template_type }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="模板名称" min-width="180" align="center" />
                  <el-table-column prop="file_name" label="文件名" min-width="220" align="center" />
                  <el-table-column prop="uploaded_by_name" label="上传人" width="120" align="center" />
                  <el-table-column prop="created_at" label="上传时间" width="180" align="center">
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="150" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handlePreviewResignationTemplate(row)">预览</el-button>
                      <el-button link type="danger" size="small" @click="handleDeleteResignationTemplate(row)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <div class="section-block probation-list-section">
                <div class="section-header">
                  <h3>离职申请列表</h3>
                  <div class="filter-actions">
                    <el-select v-model="resignationStatusFilter" placeholder="全部状态" clearable style="width: 180px" @change="handleResignationFilterChange">
                      <el-option label="草稿" value="draft" />
                      <el-option label="待交接人处理" value="submitted" />
                      <el-option label="待离职人确认" value="handover_confirmed" />
                      <el-option label="待管理员审批" value="mutual_confirmed" />
                      <el-option label="已通过" value="approved" />
                      <el-option label="已驳回" value="rejected" />
                    </el-select>
                  </div>
                </div>
                <el-table :data="resignationStore.managementList" style="width: 100%" border v-loading="resignationStore.managementLoading">
                  <el-table-column type="index" label="序号" width="60" align="center" />
                  <el-table-column prop="employee_name" label="员工姓名" min-width="90" align="center" />
                  <el-table-column prop="employee_department" label="部门" min-width="110" align="center" />
                  <el-table-column prop="employee_position" label="职位" min-width="110" align="center" />
                  <el-table-column prop="handover_name" label="交接人" min-width="90" align="center" />
                  <el-table-column prop="resign_date" label="离职日期" min-width="110" align="center" />
                  <el-table-column prop="status" label="状态" min-width="120" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getResignationStatusType(row.status)">{{ getResignationStatusText(row.status) }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="submit_time" label="提交时间" min-width="160" align="center">
                    <template #default="{ row }">
                      {{ row.submit_time ? formatDateTime(row.submit_time) : '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="附件" min-width="160" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleViewResignationDetail(row.id)">
                        查看文件 ({{ row.documents?.length || 0 }})
                      </el-button>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="240" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleViewResignationDetail(row.id)">查看</el-button>
                      <el-button link type="info" size="small" @click="handleViewResignationFlow(row)">审批流程</el-button>
                      <el-button v-if="row.status === 'mutual_confirmed'" link type="success" size="small" @click="handleApproveResignation(row.id)">通过</el-button>
                      <el-button v-if="!['approved', 'rejected', 'handover_rejected'].includes(row.status)" link type="danger" size="small" @click="handleRejectResignation(row.id)">驳回</el-button>
                      <el-button v-if="['draft', 'rejected'].includes(row.status)" link type="danger" size="small" @click="handleDeleteResignationRequest(row.id)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-tab-pane>

          <!-- 请假管理 Tab -->
          <el-tab-pane label="请假管理" name="leave">
            <div class="tab-content">
              <el-empty description="请假管理功能开发中..." />
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>

    <!-- 员工详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      :title="isEditing ? '编辑员工信息' : '员工详情'"
      width="1100px"
      destroy-on-close
    >
      <el-tabs v-model="detailActiveTab" class="detail-tabs">
        <!-- 基本信息 Tab -->
        <el-tab-pane label="基本信息" name="info">
          <el-form
            ref="editFormRef"
            :model="editFormData"
            :rules="editFormRules"
            label-width="110px"
            :disabled="!isEditing"
          >
            <!-- 基本信息 -->
            <div class="form-section">
              <div class="section-title">基本信息</div>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="姓名" prop="name">
                    <el-input v-model="editFormData.name" placeholder="请输入姓名" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="性别" prop="gender">
                    <el-select v-model="editFormData.gender" placeholder="请选择性别" style="width: 100%">
                      <el-option label="男" value="male" />
                      <el-option label="女" value="female" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="出生日期" prop="birth_date">
                    <el-date-picker
                      v-model="editFormData.birth_date"
                      type="date"
                      placeholder="请选择出生日期"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="身份证号" prop="id_number">
                    <el-input v-model="editFormData.id_number" placeholder="请输入身份证号" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="民族" prop="ethnicity">
                    <el-input v-model="editFormData.ethnicity" placeholder="请输入民族" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="籍贯" prop="native_place">
                    <el-input v-model="editFormData.native_place" placeholder="请输入籍贯" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="婚姻状况" prop="marital_status">
                    <el-select v-model="editFormData.marital_status" placeholder="请选择婚姻状况" style="width: 100%">
                      <el-option label="未婚" value="single" />
                      <el-option label="已婚" value="married" />
                      <el-option label="离异" value="divorced" />
                      <el-option label="丧偶" value="widowed" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 联系方式 -->
            <div class="form-section">
              <div class="section-title">联系方式</div>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="手机号码" prop="mobile">
                    <el-input v-model="editFormData.mobile" placeholder="请输入手机号码" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="电子邮箱" prop="email">
                    <el-input v-model="editFormData.email" placeholder="请输入电子邮箱" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="16">
                  <el-form-item label="现居住地址" prop="address">
                    <el-input v-model="editFormData.address" placeholder="请输入现居住地址" />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 紧急联系人 -->
            <div class="form-section">
              <div class="section-title">紧急联系人</div>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="紧急联系人" prop="emergency_contact">
                    <el-input v-model="editFormData.emergency_contact" placeholder="请输入紧急联系人姓名" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="联系人电话" prop="emergency_phone">
                    <el-input v-model="editFormData.emergency_phone" placeholder="请输入紧急联系人电话" />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 教育经历 -->
            <div class="form-section">
              <div class="section-title">教育经历</div>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="最高学历" prop="education">
                    <el-select v-model="editFormData.education" placeholder="请选择学历" style="width: 100%">
                      <el-option label="初中及以下" value="初中及以下" />
                      <el-option label="高中/中专" value="高中/中专" />
                      <el-option label="大专" value="大专" />
                      <el-option label="本科" value="本科" />
                      <el-option label="硕士" value="硕士" />
                      <el-option label="博士" value="博士" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="毕业院校" prop="school">
                    <el-input v-model="editFormData.school" placeholder="请输入毕业院校" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="所学专业" prop="major">
                    <el-input v-model="editFormData.major" placeholder="请输入所学专业" />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 工作信息 -->
            <div class="form-section">
              <div class="section-title">工作信息</div>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="入职日期" prop="hire_date">
                    <el-date-picker
                      v-model="editFormData.hire_date"
                      type="date"
                      placeholder="请选择入职日期"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="合同到期">
                    <el-input
                      :model-value="computedContractEndDate"
                      disabled
                      placeholder="根据入职日期自动计算"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="在职状态" prop="employment_status">
                    <el-select v-model="editFormData.employment_status" placeholder="请选择在职状态" style="width: 100%">
                      <el-option label="在职" value="active" />
                      <el-option label="实习期" value="probation" />
                      <el-option label="已离职" value="resigned" />
                      <el-option label="休假中" value="on_leave" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="所属部门" prop="department">
                    <el-input v-model="editFormData.department" placeholder="请输入所属部门" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="职位" prop="position">
                    <el-input v-model="editFormData.position" placeholder="请输入职位" />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 收款信息 -->
            <div class="form-section">
              <div class="section-title">收款信息</div>
              <el-row :gutter="24">
                <el-col :span="12">
                  <el-form-item label="收款人姓名" prop="bank_account_name">
                    <el-input v-model="editFormData.bank_account_name" placeholder="请输入收款人姓名" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="收款人手机" prop="bank_account_phone">
                    <el-input v-model="editFormData.bank_account_phone" placeholder="请输入收款人手机号" />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="12">
                  <el-form-item label="开户行" prop="bank_name">
                    <el-input v-model="editFormData.bank_name" placeholder="请输入开户行（中国工商银行）" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="银行卡号" prop="bank_account_number">
                    <el-input v-model="editFormData.bank_account_number" placeholder="请输入银行卡号（中国工商银行）" />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>
          </el-form>
        </el-tab-pane>

        <!-- 人事档案 Tab -->
        <el-tab-pane label="人事档案" name="documents">
          <div class="documents-section">
            <!-- 档案完成度 -->
            <div class="documents-progress">
              <span class="label">档案完成度：</span>
              <el-progress
                :percentage="documentsProgress"
                :status="documentsProgress === 100 ? 'success' : ''"
                :stroke-width="10"
                style="width: 200px"
              />
              <span class="count">{{ completedDocTypes }} / {{ documentTypes.length }}</span>
            </div>

            <!-- 文档列表 -->
            <el-table :data="documentTypes" style="width: 100%" border v-loading="documentsLoading">
              <el-table-column type="index" label="序号" width="70" align="center" />
              <el-table-column prop="label" label="文档类型" min-width="200">
                <template #default="{ row }">
                  <div class="doc-type-name">
                    <span class="name-text">{{ row.label }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="已上传文件" min-width="350">
                <template #default="{ row }">
                  <div v-if="getDocumentsByType(row.type).length > 0" class="uploaded-docs">
                    <div v-for="doc in getDocumentsByType(row.type)" :key="doc.id" class="doc-item">
                      <el-icon class="doc-icon"><Document /></el-icon>
                      <span class="doc-name">{{ doc.file_name }}</span>
                      <span class="doc-info">{{ formatFileSize(doc.file_size) }}</span>
                      <el-button link type="primary" size="small" @click="handlePreviewDoc(doc)">
                        预览
                      </el-button>
                      <el-button link type="primary" size="small" @click="handleDownloadDoc(doc)">
                        下载
                      </el-button>
                      <el-button v-if="isEditing" link type="danger" size="small" @click="handleDeleteDoc(doc)">
                        删除
                      </el-button>
                    </div>
                  </div>
                  <span v-else class="no-doc">暂无文件</span>
                </template>
              </el-table-column>
              <el-table-column v-if="isEditing" label="操作" min-width="120" align="center">
                <template #default="{ row }">
                  <el-upload
                    :show-file-list="false"
                    :before-upload="(file: File) => handleUploadDoc(row.type, file)"
                    accept=".pdf"
                  >
                    <el-button type="primary" size="small" :icon="Upload">
                      上传 PDF
                    </el-button>
                  </el-upload>
                  <div class="upload-only-pdf-tip">仅支持 PDF，大小不超过 10MB</div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 离职档案 Tab -->
        <el-tab-pane label="离职档案" name="resignationArchive">
          <div class="documents-section" v-loading="resignationArchiveLoading">
            <el-empty v-if="!employeeResignationArchive?.request" description="该员工暂无离职申请记录" />
            <template v-else>
              <el-alert
                v-if="employeeResignationArchive.fallback_from_employee_status"
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 16px"
              >
                <template #title>
                  该员工暂无离职申请记录，当前离职档案内容根据员工状态进行兜底展示。
                </template>
              </el-alert>
              <div class="resignation-archive-summary">
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="员工姓名">{{ employeeResignationArchive.request.employee_name || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="交接人">{{ employeeResignationArchive.request.handover_name || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="离职类型">{{ getResignationTypeText(employeeResignationArchive.request.resign_type) }}</el-descriptions-item>
                  <el-descriptions-item label="离职日期">{{ employeeResignationArchive.request.resign_date || '-' }}</el-descriptions-item>
                  <el-descriptions-item label="当前状态">
                    <el-tag :type="getResignationStatusType(employeeResignationArchive.request.status)">
                      {{ getResignationStatusText(employeeResignationArchive.request.status) }}
                    </el-tag>
                  </el-descriptions-item>
                  <el-descriptions-item label="提交时间">
                    {{ employeeResignationArchive.request.submit_time ? formatDateTime(employeeResignationArchive.request.submit_time) : '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="审批时间">
                    {{ employeeResignationArchive.request.approve_time ? formatDateTime(employeeResignationArchive.request.approve_time) : '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="审批意见">
                    {{ employeeResignationArchive.request.approver_comment || '-' }}
                  </el-descriptions-item>
                </el-descriptions>
              </div>

              <div class="resignation-archive-block">
                <div class="section-title">离职人上传文件</div>
                <el-table :data="employeeUploadedResignationDocuments" border>
                  <el-table-column type="index" label="序号" width="70" align="center" />
                  <el-table-column label="材料类型" min-width="180">
                    <template #default="{ row }">
                      {{ getResignationDocumentLabel(row.document_type) }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="file_name" label="文件名" min-width="260" />
                  <el-table-column prop="uploaded_by_name" label="上传人" width="120" align="center">
                    <template #default="{ row }">
                      {{ row.uploaded_by_name || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="180" align="center">
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="文件大小" width="110" align="center">
                    <template #default="{ row }">
                      {{ formatFileSize(row.file_size) || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="140" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleOpenResignationArchiveDocument(row)">查看</el-button>
                      <el-button link type="primary" size="small" @click="handleDownloadResignationArchiveDocument(row)">下载</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <el-empty v-if="employeeUploadedResignationDocuments.length === 0" description="暂无离职人上传文件" />
              </div>

              <div class="resignation-archive-block">
                <div class="section-title">工作交接单</div>
                <el-table :data="handoverResignationDocuments" border>
                  <el-table-column type="index" label="序号" width="70" align="center" />
                  <el-table-column label="材料类型" min-width="180">
                    <template #default="{ row }">
                      {{ getResignationDocumentLabel(row.document_type) }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="file_name" label="文件名" min-width="260" />
                  <el-table-column prop="uploaded_by_name" label="上传人" width="120" align="center">
                    <template #default="{ row }">
                      {{ row.uploaded_by_name || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="上传时间" width="180" align="center">
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="文件大小" width="110" align="center">
                    <template #default="{ row }">
                      {{ formatFileSize(row.file_size) || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="140" align="center">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleOpenResignationArchiveDocument(row)">查看</el-button>
                      <el-button link type="primary" size="small" @click="handleDownloadResignationArchiveDocument(row)">下载</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <el-empty v-if="handoverResignationDocuments.length === 0" description="暂无工作交接单" />
              </div>
            </template>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <span class="dialog-footer">
          <template v-if="!isEditing">
            <el-button @click="detailDialogVisible = false">关闭</el-button>
          </template>
          <template v-else>
            <el-button @click="detailDialogVisible = false">取消</el-button>
            <el-button type="primary" :loading="editSaving" @click="handleSaveEdit">保存</el-button>
          </template>
        </span>
      </template>
    </el-dialog>

    <!-- 审批流程对话框 -->
    <el-dialog v-model="resignationFlowVisible" title="审批流程" width="700px" destroy-on-close>
      <div v-loading="auditLogsLoading" style="min-height: 120px;">
        <template v-if="!auditLogsLoading">
          <!-- 申请基本信息 -->
          <el-descriptions v-if="flowRequest" :column="2" border size="small" style="margin-bottom: 20px;">
            <el-descriptions-item label="员工">{{ flowRequest.employee_name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="交接人">{{ flowRequest.handover_name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="离职日期">{{ flowRequest.resign_date || '-' }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag :type="getResignationStatusType(flowRequest.status)" size="small">
                {{ getResignationStatusText(flowRequest.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="flowRequest.reason" label="离职说明" :span="2">
              {{ flowRequest.reason }}
            </el-descriptions-item>
            <el-descriptions-item v-if="flowRequest.approver_comment" label="审批意见" :span="2">
              {{ flowRequest.approver_comment }}
            </el-descriptions-item>
          </el-descriptions>

          <!-- 流程时间线（融合申请字段 + audit logs） -->
          <el-timeline>
            <el-timeline-item
              v-for="step in flowTimeline"
              :key="step.key"
              :timestamp="step.time"
              placement="top"
              :type="step.type"
              :hollow="step.hollow"
            >
              <div style="font-weight: 500;">{{ step.title }}</div>
              <div v-if="step.desc" style="color: #606266; font-size: 13px; margin-top: 4px;">{{ step.desc }}</div>
              <div v-if="step.operator" style="color: #909399; font-size: 13px; margin-top: 2px;">操作人：{{ step.operator }}</div>
            </el-timeline-item>
          </el-timeline>
        </template>
      </div>
      <template #footer>
        <el-button @click="resignationFlowVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 离职详情对话框 -->
    <el-dialog v-model="resignationDetailVisible" title="离职详情" width="900px" top="3vh" destroy-on-close>
      <div v-if="resignationStore.detail" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="员工姓名">{{ resignationStore.detail.request.employee_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="交接人">{{ resignationStore.detail.request.handover_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="离职类型">{{ getResignationTypeText(resignationStore.detail.request.resign_type) }}</el-descriptions-item>
          <el-descriptions-item label="离职日期">{{ resignationStore.detail.request.resign_date }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getResignationStatusType(resignationStore.detail.request.status)">
              {{ getResignationStatusText(resignationStore.detail.request.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{ resignationStore.detail.request.submit_time ? formatDateTime(resignationStore.detail.request.submit_time) : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="离职说明" :span="2">
            {{ resignationStore.detail.request.reason || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="审批意见" :span="2">
            <el-input v-model="resignationApprovalComment" type="textarea" :rows="3" placeholder="请输入审批意见" />
          </el-descriptions-item>
        </el-descriptions>

        <div class="documents-section">
          <h4>离职人材料</h4>
          <el-table :data="getResignationEmployeeDocumentRows" stripe size="small">
            <el-table-column label="材料类型" min-width="220">
              <template #default="{ row }">
                <div class="resignation-doc-label">
                  <span>{{ row.label }}</span>
                  <el-tag v-if="row.required" size="small" type="danger" effect="plain">必传</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="文件列表" min-width="320">
              <template #default="{ row }">
                <div v-if="row.files.length > 0" class="resignation-doc-files">
                  <div v-for="file in row.files" :key="file.id" class="resignation-doc-file-item">
                    <span>{{ file.file_name }}</span>
                    <span class="resignation-doc-meta">{{ file.uploaded_by_name || '-' }}</span>
                    <el-button type="primary" link @click="openResignationDocument(resignationStore.detail!.request.id, file.id)">查看</el-button>
                  </div>
                </div>
                <el-tag v-else-if="row.missing" size="small" type="danger">缺失</el-tag>
                <span v-else class="no-file">暂无文件</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.missing" type="danger">待补充</el-tag>
                <el-tag v-else-if="row.files.length > 0" type="success">已上传</el-tag>
                <el-tag v-else type="info">非必传</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="documents-section">
          <h4>交接人材料</h4>
          <el-table :data="getResignationHandoverDocumentRows" stripe size="small">
            <el-table-column label="材料类型" min-width="220">
              <template #default="{ row }">
                <div class="resignation-doc-label">
                  <span>{{ row.label }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="文件列表" min-width="320">
              <template #default="{ row }">
                <div v-if="row.files.length > 0" class="resignation-doc-files">
                  <div v-for="file in row.files" :key="file.id" class="resignation-doc-file-item">
                    <span>{{ file.file_name }}</span>
                    <span class="resignation-doc-meta">{{ file.uploaded_by_name || '-' }}</span>
                    <el-button type="primary" link @click="openResignationDocument(resignationStore.detail!.request.id, file.id)">查看</el-button>
                  </div>
                </div>
                <span v-else class="no-file">暂无文件</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.files.length > 0" type="success">已上传</el-tag>
                <el-tag v-else type="info">待上传</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="resignationDetailVisible = false">关闭</el-button>
        <el-button v-if="resignationStore.detail?.request.status !== 'approved' && resignationStore.detail?.request.status !== 'rejected' && resignationStore.detail?.request.status !== 'handover_rejected'" type="danger" @click="handleRejectResignation(resignationStore.detail!.request.id)">驳回</el-button>
        <el-button v-if="resignationStore.detail?.request.status === 'mutual_confirmed'" type="success" @click="handleApproveResignation(resignationStore.detail!.request.id)">审批通过</el-button>
      </template>
    </el-dialog>

    <!-- 驳回对话框 -->
    <el-dialog v-model="rejectDialogVisible" title="驳回离职申请" width="480px" :close-on-click-modal="false">
      <el-form label-width="90px">
        <el-form-item label="驳回对象">
          <el-radio-group v-model="rejectForm.target">
            <el-radio value="employee">仅驳回给离职人</el-radio>
            <el-radio value="handover">仅驳回给交接人</el-radio>
            <el-radio value="both">同时驳回给双方</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="驳回原因">
          <el-input
            v-model="rejectForm.comment"
            type="textarea"
            :rows="4"
            placeholder="请输入驳回原因（必填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmRejectResignation">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Search, Refresh, Download, Upload, Document, Delete, View } from '@element-plus/icons-vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useProbationStore, type ProbationTemplate } from '@/stores/probation'
import { useResignationStore, type ResignationDocumentType, type ResignationTemplate } from '@/stores/resignation'
import { usePendingStore } from '@/stores/pending'
import { api } from '@/utils/api'

type ResignationTemplateType =
  | 'application_form'
  | 'handover_form'
  | 'termination_proof'
  | 'asset_handover'
  | 'compensation_agreement'
  | 'expense_settlement_agreement'
  | 'partner_dividend_settlement'

const RESIGNATION_TEMPLATE_LABELS: Record<ResignationTemplateType, string> = {
  application_form: '申请表模版',
  handover_form: '交接单模版',
  termination_proof: '终止/解除劳动关系证明模版',
  asset_handover: '固定资产交接单模版',
  compensation_agreement: '离职经济补偿协议书模版',
  expense_settlement_agreement: '离职其他费用结算约定模版',
  partner_dividend_settlement: '合伙人离任分红结算模版',
}

// 离职模板固定排序顺序
const RESIGNATION_TEMPLATE_ORDER: ResignationTemplateType[] = [
  'application_form',
  'handover_form',
  'termination_proof',
  'asset_handover',
  'compensation_agreement',
  'expense_settlement_agreement',
  'partner_dividend_settlement',
]

const sortedResignationTemplates = computed(() => {
  return [...resignationStore.templates].sort((a, b) => {
    const indexA = RESIGNATION_TEMPLATE_ORDER.indexOf(a.template_type as ResignationTemplateType)
    const indexB = RESIGNATION_TEMPLATE_ORDER.indexOf(b.template_type as ResignationTemplateType)
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB)
  })
})

const RESIGNATION_DOCUMENT_LABELS: Record<ResignationDocumentType, string> = {
  application_form: '离职申请表',
  handover_form_employee: '离职人交接单',
  handover_form_handover: '交接人交接单',
  termination_proof: '终止/解除劳动关系证明',
  asset_handover: '固定资产交接单',
  compensation_agreement: '离职经济补偿协议书',
  expense_settlement_agreement: '离职其他费用结算约定',
}

const RESIGNATION_TYPE_TEXT_MAP = {
  voluntary: '主动离职',
  contract_end: '合同到期',
  dismissal: '辞退',
} as const

// 使用共享的 store
const onboardingStore = useOnboardingStore()
const probationStore = useProbationStore()
const resignationStore = useResignationStore()
const pendingStore = usePendingStore()

// 待操作事项计数
const probationPendingCount = computed(() => pendingStore.counts.probationPending)
const resignationPendingCount = computed(() => pendingStore.counts.resignationPending)

// 转正管理相关
const probationStatusFilter = ref('')
const resignationStatusFilter = ref('')
const resignationDetailVisible = ref(false)
const resignationApprovalComment = ref('')

// 驳回对话框
const rejectDialogVisible = ref(false)
const rejectPendingId = ref('')
const rejectForm = reactive({
  target: 'employee' as 'employee' | 'handover' | 'both',
  comment: '',
})

// 审批流程弹窗
const resignationFlowVisible = ref(false)
const auditLogsLoading = ref(false)
const auditLogs = ref<Array<{ id: string; action: string; operator_name: string | null; comment: string | null; created_at: string }>>([])
const flowRequest = ref<{
  employee_name?: string
  handover_name?: string | null
  resign_date?: string
  reason?: string | null
  status: string
  submit_time?: string | null
  handover_confirm_time?: string | null
  employee_confirm_time?: string | null
  approve_time?: string | null
  approver_comment?: string | null
} | null>(null)

const getAuditLogType = (action: string): 'success' | 'danger' | 'warning' | 'primary' | 'info' => {
  if (action.includes('通过')) return 'success'
  if (action.includes('驳回')) return 'danger'
  if (action.includes('撤回')) return 'warning'
  if (action.includes('提交')) return 'primary'
  if (action.includes('确认')) return 'warning'
  return 'info'
}

// 合并申请字段推导的步骤 + audit logs，生成完整时间线
const flowTimeline = computed(() => {
  interface TimelineItem {
    key: string
    title: string
    desc: string
    time: string
    type: 'success' | 'danger' | 'warning' | 'primary' | 'info'
    hollow: boolean
    operator: string
    sortTime: string
  }

  const items: TimelineItem[] = []
  const req = flowRequest.value

  // 将 audit logs 转为时间线条目
  const logKeys = new Set<string>()
  for (const log of auditLogs.value) {
    logKeys.add(log.action + '_' + log.created_at)
    items.push({
      key: log.id,
      title: log.action,
      desc: log.comment || '',
      time: formatDateTime(log.created_at),
      type: getAuditLogType(log.action),
      hollow: false,
      operator: log.operator_name || '-',
      sortTime: log.created_at,
    })
  }

  // 当 audit logs 为空时，从申请字段推导基础步骤（兼容老数据）
  if (auditLogs.value.length === 0 && req) {
    if (req.submit_time) {
      items.push({
        key: 'submit',
        title: '提交离职申请',
        desc: '',
        time: formatDateTime(req.submit_time),
        type: 'primary',
        hollow: false,
        operator: req.employee_name || '-',
        sortTime: req.submit_time,
      })
    }
    if (req.handover_confirm_time) {
      items.push({
        key: 'handover_confirm',
        title: '交接人确认交接完成',
        desc: '',
        time: formatDateTime(req.handover_confirm_time),
        type: 'warning',
        hollow: false,
        operator: req.handover_name || '-',
        sortTime: req.handover_confirm_time,
      })
    }
    if (req.employee_confirm_time) {
      items.push({
        key: 'employee_confirm',
        title: '离职人确认交接完成',
        desc: '',
        time: formatDateTime(req.employee_confirm_time),
        type: 'warning',
        hollow: false,
        operator: req.employee_name || '-',
        sortTime: req.employee_confirm_time,
      })
    }
    if (req.approve_time) {
      const approved = req.status === 'approved'
      items.push({
        key: 'approve',
        title: approved ? '管理员审批通过' : '管理员驳回申请',
        desc: req.approver_comment || '',
        time: formatDateTime(req.approve_time),
        type: approved ? 'success' : 'danger',
        hollow: false,
        operator: '-',
        sortTime: req.approve_time,
      })
    }
  }

  // 如果还没有步骤且无提交时间，提示待提交
  if (items.length === 0) {
    items.push({
      key: 'pending',
      title: '待提交离职申请',
      desc: '员工尚未提交离职申请',
      time: '',
      type: 'info',
      hollow: true,
      operator: '',
      sortTime: '',
    })
  } else {
    // 如果申请已提交但还未完成，补充待处理的下一步，并说明应由谁操作
    if (req && req.status === 'submitted') {
      items.push({ key: 'next_handover', title: '待交接人确认', desc: `等待交接人 ${req.handover_name || '-'} 上传交接单并确认`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req && req.status === 'handover_rejected') {
      items.push({ key: 'next_handover_resubmit', title: '待交接人重新提交', desc: `交接单已被驳回，请交接人 ${req.handover_name || '-'} 重新上传`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req && req.status === 'handover_confirmed') {
      items.push({ key: 'next_employee', title: '待离职人确认', desc: `等待 ${req.employee_name || '-'} 确认交接完成`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req && req.status === 'mutual_confirmed') {
      items.push({ key: 'next_approve', title: '待管理员审批', desc: '等待管理员审批离职申请', time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    } else if (req && req.status === 'rejected') {
      items.push({ key: 'next_resubmit', title: '待重新提交', desc: `申请已被驳回，请 ${req.employee_name || '-'} 修改后重新提交`, time: '', type: 'info', hollow: true, operator: '', sortTime: '' })
    }
  }

  // 按时间排序（空时间的待处理步骤排在末尾）
  return items.sort((a, b) => {
    if (!a.sortTime && !b.sortTime) return 0
    if (!a.sortTime) return 1
    if (!b.sortTime) return -1
    return a.sortTime.localeCompare(b.sortTime)
  })
})

const handleViewResignationFlow = async (row: { id: string; employee_name?: string; handover_name?: string | null; resign_date?: string; status: string; submit_time?: string | null; handover_confirm_time?: string | null; employee_confirm_time?: string | null; approve_time?: string | null; approver_comment?: string | null }) => {
  resignationFlowVisible.value = true
  auditLogsLoading.value = true
  auditLogs.value = []
  flowRequest.value = row
  try {
    const res = await api.get(`/api/resignation/${row.id}/audit-logs`)
    if (res.data.success) {
      auditLogs.value = res.data.data
    }
  } catch (error) {
    console.error('获取审批流程失败:', error)
  } finally {
    auditLogsLoading.value = false
  }
}

const handleDeleteResignationRequest = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除该离职申请吗？删除后所有相关材料将被永久清除。', '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await api.delete(`/api/resignation/management/${id}`)
    if (res.data.success) {
      ElMessage.success('离职申请已删除')
      resignationStore.fetchManagementList(resignationStatusFilter.value || undefined)
    } else {
      ElMessage.error(res.data.message || '删除失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '删除失败')
  }
}

// 格式化日期时间
const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'

  const normalized = dateStr.replace(' ', 'T')
  const localDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)
    ? new Date(normalized.length === 16 ? `${normalized}:00` : normalized)
    : new Date(dateStr)

  if (Number.isNaN(localDate.getTime())) {
    return dateStr
  }

  return localDate.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const openProbationDoc = (confirmationId: string, docId: string) => {
  window.open(`/api/probation/${confirmationId}/documents/${docId}/download`, '_blank')
}

// 获取转正状态类型
const getProbationStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    pending: 'info',
    submitted: 'warning',
    approved: 'success',
    rejected: 'danger',
  }
  return typeMap[status] || 'info'
}

// 获取转正状态文本
const getProbationStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    pending: '实习期',
    submitted: '待审批',
    approved: '已转正',
    rejected: '已驳回',
  }
  return textMap[status] || status
}

const validatePdfUpload = (file: File) => {
  const isPdf = file.type === 'application/pdf'
  const isLt10M = file.size / 1024 / 1024 < 10

  if (!isPdf) {
    ElMessage.error('只支持 PDF 格式的文件')
    return false
  }

  if (!isLt10M) {
    ElMessage.error('文件大小不能超过 10MB')
    return false
  }

  return true
}

// 上传转正模板
const handleUploadProbationTemplate = async (file: File) => {
  if (!validatePdfUpload(file)) return false

  try {
    const res = await probationStore.uploadTemplate('转正申请表', file)
    if (res.success) {
      ElMessage.success('模板上传成功')
    } else {
      ElMessage.error(res.message || '上传失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '上传失败')
  }
  return false
}

// 预览转正模板
const handlePreviewProbationTemplate = (row: ProbationTemplate) => {
  window.open(`/api/probation/templates/${row.id}/download`, '_blank')
}

// 删除转正模板
const handleDeleteProbationTemplate = (row: ProbationTemplate) => {
  ElMessageBox.confirm(
    `确定要删除模板「${row.name}」吗？`,
    '删除确认',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(async () => {
    try {
      const res = await probationStore.deleteTemplate(row.id)
      if (res.success) {
        ElMessage.success('模板已删除')
      } else {
        ElMessage.error(res.message || '删除失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }).catch(() => {})
}

// 转正筛选变化
const handleProbationFilterChange = () => {
  probationStore.fetchConfirmationList({ status: probationStatusFilter.value || undefined })
}

const handleResignationFilterChange = () => {
  resignationStore.fetchManagementList(resignationStatusFilter.value || undefined)
}

const handleUploadResignationTemplate = (templateType: ResignationTemplateType) => async (file: File) => {
  if (!validatePdfUpload(file)) return false

  const templateNameMap: Record<ResignationTemplateType, string> = {
    application_form: '离职申请表模板',
    handover_form: '交接单模板',
    termination_proof: '终止/解除劳动关系证明模板',
    asset_handover: '固定资产交接单模板',
    compensation_agreement: '离职经济补偿协议书模板',
    expense_settlement_agreement: '离职其他费用结算约定模板',
    partner_dividend_settlement: '合伙人离任分红结算模板',
  }

  try {
    const res = await resignationStore.uploadTemplate(
      templateType,
      templateNameMap[templateType],
      file,
    )
    if (res.success) {
      ElMessage.success('模板上传成功')
    } else {
      ElMessage.error(res.message || '上传失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '上传失败')
  }
  return false
}

const handlePreviewResignationTemplate = (row: ResignationTemplate) => {
  window.open(`/api/resignation/templates/${row.id}/download`, '_blank')
}

const handleDeleteResignationTemplate = (row: ResignationTemplate) => {
  ElMessageBox.confirm(`确定要删除模板「${row.name}」吗？`, '删除确认', {
    confirmButtonText: '确定删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(async () => {
    try {
      const res = await resignationStore.deleteTemplate(row.id)
      if (res.success) {
        ElMessage.success('模板已删除')
      } else {
        ElMessage.error(res.message || '删除失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }).catch(() => {})
}

const getResignationStatusType = (status: string) => {
  const map: Record<string, any> = {
    draft: 'info',
    submitted: 'warning',
    handover_confirmed: 'warning',
    handover_rejected: 'danger',
    mutual_confirmed: 'warning',
    approved: 'success',
    rejected: 'danger',
  }
  return map[status] || 'info'
}

const getResignationStatusText = (status: string) => {
  const map: Record<string, string> = {
    draft: '草稿',
    submitted: '待交接人处理',
    handover_confirmed: '待离职人确认',
    handover_rejected: '交接人待重新提交',
    mutual_confirmed: '待管理员审批',
    approved: '已通过',
    rejected: '已驳回',
  }
  return map[status] || status
}

const openResignationDocument = (requestId: string, docId: string) => {
  window.open(`/api/resignation/requests/${requestId}/documents/${docId}/download`, '_blank')
}

const getResignationDocumentLabel = (type: string) => {
  return RESIGNATION_DOCUMENT_LABELS[type as ResignationDocumentType] || type
}

const getResignationTypeText = (type: string) => {
  return RESIGNATION_TYPE_TEXT_MAP[type as keyof typeof RESIGNATION_TYPE_TEXT_MAP] || type
}

// 离职人上传的材料
const getResignationEmployeeDocumentRows = computed(() => {
  if (!resignationStore.detail) return []
  const employeeTypes: ResignationDocumentType[] = [
    'application_form', 'handover_form_employee',
    'termination_proof', 'asset_handover',
    'compensation_agreement', 'expense_settlement_agreement',
  ]
  return employeeTypes.map(type => {
    const files = resignationStore.detail!.documents.filter(doc => doc.document_type === type && doc.uploader_role === 'employee')
    const required = resignationStore.detail!.requiredDocumentTypes.includes(type)
    const missing = required && files.length === 0
    return { type, label: getResignationDocumentLabel(type), required, missing, files }
  }).filter(item => item.required || item.files.length > 0)
})

// 交接人上传的材料
const getResignationHandoverDocumentRows = computed(() => {
  if (!resignationStore.detail) return []
  const files = resignationStore.detail.documents.filter(doc => doc.document_type === 'handover_form_handover' && doc.uploader_role === 'handover')
  return [{ type: 'handover_form_handover' as ResignationDocumentType, label: '交接人交接单', files }]
})

const handleViewResignationDetail = async (id: string) => {
  const res = await resignationStore.fetchDetail(id)
  if (res.success) {
    resignationApprovalComment.value = resignationStore.detail?.request.approver_comment || ''
    resignationDetailVisible.value = true
  }
}

const handleApproveResignation = async (id: string) => {
  try {
    const res = await resignationStore.approve(id, resignationApprovalComment.value)
    if (res.success) {
      ElMessage.success('离职审批通过')
      resignationDetailVisible.value = false
    } else {
      ElMessage.error(res.message || '审批失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '审批失败')
  }
}

const handleRejectResignation = (id: string) => {
  rejectPendingId.value = id
  rejectForm.target = 'employee'
  rejectForm.comment = ''
  rejectDialogVisible.value = true
}

const confirmRejectResignation = async () => {
  if (!rejectForm.comment.trim()) {
    ElMessage.warning('请输入驳回原因')
    return
  }
  try {
    const res = await resignationStore.reject(rejectPendingId.value, rejectForm.comment, rejectForm.target)
    if (res.success) {
      ElMessage.success('离职申请已驳回')
      rejectDialogVisible.value = false
      resignationDetailVisible.value = false
    } else {
      ElMessage.error(res.message || '驳回失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '驳回失败')
  }
}

// 转正分页变化
const handleProbationSizeChange = (size: number) => {
  probationStore.fetchConfirmationList({
    status: probationStatusFilter.value || undefined,
    pageSize: size
  })
}

const handleProbationPageChange = (page: number) => {
  probationStore.fetchConfirmationList({
    status: probationStatusFilter.value || undefined,
    page
  })
}


// 员工类型
interface EmployeeProfile {
  id: string
  user_id: string | null
  employee_no: string | null
  name: string
  gender: string | null
  birth_date: string | null
  id_number: string | null
  native_place: string | null
  ethnicity: string | null
  marital_status: string | null
  education: string | null
  school: string | null
  major: string | null
  mobile: string | null
  email: string | null
  emergency_contact: string | null
  emergency_phone: string | null
  address: string | null
  hire_date: string | null
  contract_end_date: string | null
  department: string | null
  position: string | null
  bank_account_name: string | null
  bank_account_phone: string | null
  bank_name: string | null
  bank_account_number: string | null
  status: 'draft' | 'submitted'
  employment_status: 'active' | 'probation' | 'resigned' | 'on_leave' | null
  created_at: string
  updated_at: string
}

// 员工档案文件类型
interface EmployeeDocument {
  id: string
  employee_id: string
  document_type: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

interface EmployeeResignationArchiveRequest {
  id: string
  employee_id: string
  employee_user_id: string
  handover_user_id: string
  handover_name: string | null
  resign_type: string
  resign_date: string
  reason: string | null
  status: string
  employee_confirm_time: string | null
  handover_confirm_time: string | null
  submit_time: string | null
  approve_time: string | null
  approver_id: string | null
  approver_comment: string | null
  created_at: string
  updated_at: string
  employee_name: string
  employee_department: string | null
  employee_position: string | null
  employee_mobile: string | null
}

interface EmployeeResignationArchiveDocument {
  id: string
  request_id: string
  document_type: ResignationDocumentType
  uploader_role: 'employee' | 'handover' | 'admin'
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

interface EmployeeResignationArchive {
  request: EmployeeResignationArchiveRequest | null
  documents: EmployeeResignationArchiveDocument[]
  fallback_from_employee_status?: boolean
}

// 文档类型配置
const documentTypes = [
  { type: 'invitation', label: '邀请函' },
  { type: 'application', label: '入职申请表' },
  { type: 'contract', label: '劳动合同' },
  { type: 'nda', label: '保密协议' },
  { type: 'declaration', label: '个人声明' },
  { type: 'asset_handover', label: '固定资产交接单' },
  { type: 'id_card', label: '身份证复印件' },
  { type: 'health_report', label: '入职体检报告' },
  { type: 'diploma', label: '学历证书复印件' },
  { type: 'bank_card', label: '工资卡复印件（中国工商银行）' },
]

// 当前 Tab - 默认显示员工数据
const activeTab = ref('data')

// 详情对话框 Tab
const detailActiveTab = ref('info')

// 统计数据
const stats = reactive({
  total: 0,
  active: 0,
  probation: 0,
  resigned: 0,
  onLeave: 0,
})

// 筛选表单
const filterForm = reactive({
  keyword: '',
  department: '',
  employmentStatus: '',
})

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

// 加载状态
const loading = ref(false)

// 员工列表
const employeeList = ref<EmployeeProfile[]>([])

// 详情对话框
const detailDialogVisible = ref(false)
const isEditing = ref(false)
const editSaving = ref(false)
const editFormRef = ref<FormInstance>()
const currentEmployee = ref<EmployeeProfile | null>(null)

// 员工档案文件相关
const employeeDocuments = ref<EmployeeDocument[]>([])
const documentsLoading = ref(false)
const employeeResignationArchive = ref<EmployeeResignationArchive | null>(null)
const resignationArchiveLoading = ref(false)

const employeeUploadedResignationDocuments = computed(() => {
  return employeeResignationArchive.value?.documents.filter((doc: EmployeeResignationArchiveDocument) => doc.uploader_role === 'employee') || []
})

const handoverResignationDocuments = computed(() => {
  return employeeResignationArchive.value?.documents.filter((doc: EmployeeResignationArchiveDocument) => doc.document_type === 'handover_form_handover') || []
})

// 获取员工离职档案
const fetchEmployeeResignationArchive = async () => {
  if (!currentEmployee.value) return

  resignationArchiveLoading.value = true
  try {
    const res = await api.get(`/api/employees/${currentEmployee.value.id}/resignation-archive`)
    if (res.data.success) {
      employeeResignationArchive.value = res.data.data
    }
  } catch (error) {
    console.error('获取员工离职档案失败:', error)
    employeeResignationArchive.value = null
  } finally {
    resignationArchiveLoading.value = false
  }
}

const handleOpenResignationArchiveDocument = (doc: EmployeeResignationArchiveDocument) => {
  const requestId = employeeResignationArchive.value?.request?.id
  if (!requestId) return
  openResignationDocument(requestId, doc.id)
}

const handleDownloadResignationArchiveDocument = async (doc: EmployeeResignationArchiveDocument) => {
  const requestId = employeeResignationArchive.value?.request?.id
  if (!requestId) return

  try {
    const res = await api.get(`/api/resignation/requests/${requestId}/documents/${doc.id}/download`, {
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', doc.file_name)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error('下载失败')
  }
}

// 计算已完成的文档类型数量
const completedDocTypes = computed(() => {
  const uploadedTypes = new Set(employeeDocuments.value.map(doc => doc.document_type))
  return documentTypes.filter(dt => uploadedTypes.has(dt.type)).length
})

// 计算档案完成度
const documentsProgress = computed(() => {
  return Math.round((completedDocTypes.value / documentTypes.length) * 100)
})

// 根据类型获取文档
const getDocumentsByType = (type: string) => {
  return employeeDocuments.value.filter(doc => doc.document_type === type)
}

// 格式化文件大小
const formatFileSize = (size: number | null) => {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

// 获取员工档案文件列表
const fetchEmployeeDocuments = async () => {
  if (!currentEmployee.value) return

  documentsLoading.value = true
  try {
    const res = await api.get(`/api/employees/${currentEmployee.value.id}/documents`)
    if (res.data.success) {
      employeeDocuments.value = res.data.data
    }
  } catch (error) {
    console.error('获取员工档案文件失败:', error)
  } finally {
    documentsLoading.value = false
  }
}

// 上传员工档案文件
const handleUploadDoc = async (documentType: string, file: File) => {
  if (!currentEmployee.value) return false
  if (!validatePdfUpload(file)) return false

  const formData = new FormData()
  formData.append('file', file)
  formData.append('document_type', documentType)
  formData.append('originalFileName', file.name)

  try {
    const res = await api.post(`/api/employees/${currentEmployee.value.id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (res.data.success) {
      ElMessage.success('文件上传成功')
      fetchEmployeeDocuments()
    } else {
      ElMessage.error(res.data.message || '上传失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '上传失败')
  }

  return false
}

// 预览文档
const handlePreviewDoc = (doc: EmployeeDocument) => {
  if (!currentEmployee.value) return
  window.open(`/api/employees/${currentEmployee.value.id}/documents/${doc.id}/download`, '_blank')
}

// 下载文档
const handleDownloadDoc = async (doc: EmployeeDocument) => {
  if (!currentEmployee.value) return

  try {
    const res = await api.get(`/api/employees/${currentEmployee.value.id}/documents/${doc.id}/download`, {
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', doc.file_name)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error('下载失败')
  }
}

// 删除文档
const handleDeleteDoc = (doc: EmployeeDocument) => {
  if (!currentEmployee.value) return

  ElMessageBox.confirm(
    `确定要删除文件「${doc.file_name}」吗？`,
    '删除确认',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(async () => {
    try {
      const res = await api.delete(`/api/employees/${currentEmployee.value!.id}/documents/${doc.id}`)
      if (res.data.success) {
        ElMessage.success('文件已删除')
        fetchEmployeeDocuments()
      } else {
        ElMessage.error(res.data.message || '删除失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }).catch(() => {})
}

// 监听详情对话框 Tab 切换，切换到档案 Tab 时加载文档
watch(detailActiveTab, (newTab) => {
  if (!currentEmployee.value) return

  if (newTab === 'documents') {
    fetchEmployeeDocuments()
  } else if (newTab === 'resignationArchive') {
    fetchEmployeeResignationArchive()
  }
})

const editFormData = reactive<Partial<EmployeeProfile>>({
  name: '',
  gender: null,
  birth_date: null,
  id_number: null,
  native_place: null,
  ethnicity: null,
  marital_status: null,
  education: null,
  school: null,
  major: null,
  mobile: null,
  email: null,
  emergency_contact: null,
  emergency_phone: null,
  address: null,
  hire_date: null,
  contract_end_date: null,
  department: null,
  position: null,
  employee_no: null,
  status: 'draft',
  employment_status: 'active',
  bank_account_name: null,
  bank_account_phone: null,
  bank_name: null,
  bank_account_number: null,
})

const editFormRules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }]
}

// 获取员工列表
const fetchEmployeeList = async () => {
  loading.value = true
  try {
    const res = await api.get('/api/employees/list', {
      params: {
        keyword: filterForm.keyword || undefined,
        department: filterForm.department || undefined,
        employmentStatus: filterForm.employmentStatus || undefined,
        status: 'submitted', // 只显示已提交的员工
        page: pagination.page,
        pageSize: pagination.pageSize,
      }
    })
    if (res.data.success) {
      employeeList.value = res.data.data.list
      pagination.total = res.data.data.total
    }
  } catch (error) {
    console.error('获取员工列表失败:', error)
    ElMessage.error('获取员工列表失败')
  } finally {
    loading.value = false
  }
}

// 获取员工统计数据
const fetchStatistics = async () => {
  try {
    const res = await api.get('/api/employees/statistics')
    if (res.data.success) {
      stats.total = res.data.data.total
      stats.active = res.data.data.active
      stats.probation = res.data.data.probation
      stats.resigned = res.data.data.resigned
      stats.onLeave = res.data.data.onLeave
    }
  } catch (error) {
    console.error('获取员工统计失败:', error)
  }
}

// 上传文件
const handleUpload = async (fileTypeId: string, file: File) => {
  if (!validatePdfUpload(file)) return false

  const res = await onboardingStore.uploadFile(fileTypeId, file)
  if (res.success) {
    ElMessage.success(`文件「${file.name}」上传成功，员工可在入职页面查看和下载`)
  } else {
    ElMessage.error(res.message || '上传失败')
  }
  return false
}

// 删除文件
const handleRemoveFile = (_fileTypeId: string, fileId: string, fileName: string) => {
  ElMessageBox.confirm(
    `确定要删除文件「${fileName}」吗？删除后员工将无法下载此文件。`,
    '删除确认',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(async () => {
    const res = await onboardingStore.removeFile(fileId)
    if (res.success) {
      ElMessage.success('文件已删除')
    } else {
      ElMessage.error(res.message || '删除失败')
    }
  }).catch(() => {
    // 取消删除
  })
}

// 预览入职文件模板
const handlePreviewTemplate = (file: { id: string; name: string; url: string }) => {
  window.open(file.url, '_blank')
}

// 获取性别文本
const getGenderText = (gender: string | null) => {
  const textMap: Record<string, string> = {
    male: '男',
    female: '女',
  }
  return gender ? textMap[gender] || gender : '-'
}

// 获取在职状态类型
const getEmploymentStatusType = (status: string | null) => {
  const typeMap: Record<string, any> = {
    active: 'success',
    probation: 'warning',
    resigned: 'info',
    on_leave: 'primary',
  }
  return typeMap[status || 'active'] || 'success'
}

// 获取在职状态文本
const getEmploymentStatusText = (status: string | null) => {
  const textMap: Record<string, string> = {
    active: '在职',
    probation: '实习期',
    resigned: '已离职',
    on_leave: '休假中',
  }
  return textMap[status || 'active'] || '在职'
}

// 判断合同是否即将到期（10天内）
const isContractExpiring = (row: EmployeeProfile) => {
  if (!row.contract_end_date || row.employment_status === 'resigned') return false
  const endDate = new Date(row.contract_end_date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  endDate.setHours(0, 0, 0, 0)
  const diffDays = (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 10
}

// 表格行样式：合同到期前10天标红
const getRowClassName = ({ row }: { row: EmployeeProfile }) => {
  if (isContractExpiring(row)) return 'contract-expiring-row'
  return ''
}

// 根据入职日期自动计算合同到期日期（编辑表单用）
const computedContractEndDate = computed(() => {
  if (!editFormData.hire_date) return ''
  try {
    const date = new Date(editFormData.hire_date)
    if (isNaN(date.getTime())) return ''
    date.setFullYear(date.getFullYear() + 1)
    return date.toISOString().split('T')[0]
  } catch {
    return ''
  }
})

// 导出数据
const handleExport = () => {
  ElMessage.info('导出员工数据功能开发中...')
}

// 查询
const handleSearch = () => {
  pagination.page = 1
  fetchEmployeeList()
}

// 重置
const handleReset = () => {
  filterForm.keyword = ''
  filterForm.department = ''
  filterForm.employmentStatus = ''
  handleSearch()
}

// 查看详情
const handleView = (row: EmployeeProfile) => {
  currentEmployee.value = row
  Object.assign(editFormData, row)
  isEditing.value = false
  detailActiveTab.value = 'info'
  employeeDocuments.value = []
  employeeResignationArchive.value = null
  detailDialogVisible.value = true
}

// 编辑
const handleEdit = (row: EmployeeProfile) => {
  currentEmployee.value = row
  Object.assign(editFormData, row)
  isEditing.value = true
  detailActiveTab.value = 'info'
  employeeDocuments.value = []
  employeeResignationArchive.value = null
  detailDialogVisible.value = true
}

// 保存编辑
const handleSaveEdit = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) {
    ElMessage.warning('请填写必填项')
    return
  }

  if (!currentEmployee.value) return

  // 检测是否将员工状态改为实习期（需要重新走转正审批流程）
  const isResetToProbation = editFormData.employment_status === 'probation'
    && currentEmployee.value.employment_status !== 'probation'
    && currentEmployee.value.employment_status !== null

  if (isResetToProbation) {
    try {
      await ElMessageBox.confirm(
        '将员工改为实习期后，原有的转正记录将被归档，该员工需要重新走一遍转正审批流程（试用期6个月）。\n\n确定要将该员工改为实习期吗？',
        '确认修改为实习期',
        {
          confirmButtonText: '确认修改',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger',
        }
      )
    } catch {
      return // 用户取消
    }
  }

  editSaving.value = true
  try {
    const res = await api.put(`/api/employees/${currentEmployee.value.id}`, editFormData)
    if (res.data.success) {
      ElMessage.success(res.data.message || '保存成功')
      detailDialogVisible.value = false
      fetchEmployeeList()
      fetchStatistics()
    } else {
      ElMessage.error(res.data.message || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

// 分页变化
const handleSizeChange = (size: number) => {
  pagination.pageSize = size
  fetchEmployeeList()
}

const handlePageChange = (page: number) => {
  pagination.page = page
  fetchEmployeeList()
}

// 组件挂载
onMounted(() => {
  fetchEmployeeList()
  fetchStatistics()
})

// 监听 Tab 切换，加载对应数据
watch(activeTab, (newTab) => {
  if (newTab === 'management') {
    onboardingStore.fetchTemplates()
  } else if (newTab === 'probation') {
    probationStore.fetchTemplates()
    probationStore.fetchConfirmationList()
    probationStore.fetchStatistics()
  } else if (newTab === 'resignation') {
    resignationStore.fetchTemplates()
    resignationStore.fetchManagementList()
  }
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.employee-data-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 0;
}

.page-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
}

.page-card :deep(.el-card__header) {
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.page-card :deep(.el-card__body) {
  flex: 1;
  padding: 24px;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.content-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.main-tabs {
  height: 100%;
}

.main-tabs :deep(.el-tabs__content) {
  height: calc(100% - 40px);
  overflow: auto;
}

.tab-badge {
  margin-left: 6px;
}

.tab-badge :deep(.el-badge__content) {
  top: -2px;
}

.tab-content {
  padding: 16px 0;
}

/* 员工数据样式 */
.stats-section {
  margin-bottom: 20px;
}

.stat-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  color: #fff;
}

.stat-card.stat-active {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
}

.stat-card.stat-probation {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.stat-card.stat-resigned {
  background: linear-gradient(135deg, #606c88 0%, #3f4c6b 100%);
}

.stat-card.stat-onleave {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.9;
}

.filter-section {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.filter-form {
  margin: 0;
}

/* 转正管理区块间距优化 */
.probation-template-section {
  margin-bottom: 32px;
}

.probation-template-section :deep(.el-alert) {
  margin-top: 14px;
}

.probation-list-section {
  margin-top: 8px;
}

.probation-list-section :deep(.el-table) {
  margin-top: 14px;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

/* 员工管理样式 */
.file-type-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name-text {
  font-weight: 500;
}

.file-children {
  margin-top: 8px;
  padding: 8px 16px;
  color: #606266;
  font-size: 13px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.child-item {
  line-height: 1.8;
}

.uploaded-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background-color: #f0f9eb;
  border-radius: 4px;
  font-size: 13px;
}

.file-icon {
  color: #67c23a;
}

.file-name-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-file {
  color: #909399;
  font-size: 13px;
}

.no-upload {
  color: #67c23a;
  font-size: 13px;
}

.self-prepare {
  color: #67c23a;
  font-size: 13px;
}

.no-action {
  color: #c0c4cc;
}

/* 详情对话框样式 */
.detail-tabs {
  margin: -20px -20px 0;
}

.detail-tabs :deep(.el-tabs__header) {
  padding: 0 20px;
  margin-bottom: 0;
}

.detail-tabs :deep(.el-tabs__content) {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

/* 详情表单对齐样式 */
.detail-tabs :deep(.el-form-item__label) {
  font-weight: 400;
  color: #606266;
  text-align: left;
  justify-content: flex-start;
}

.detail-tabs :deep(.el-form-item__content) {
  flex: 1;
}

.detail-tabs :deep(.el-input),
.detail-tabs :deep(.el-select),
.detail-tabs :deep(.el-date-editor.el-input) {
  width: 100%;
}

.detail-tabs :deep(.el-select) {
  display: block;
}

.detail-tabs :deep(.el-date-editor.el-input) {
  width: 100%;
  display: inline-flex;
}

.form-section {
  margin-bottom: 24px;
  padding: 20px;
  background-color: #fafafa;
  border-radius: 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e4e7ed;
}

/* 人事档案样式 */
.documents-section {
  padding: 0;
}

.resignation-doc-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.resignation-doc-files {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resignation-doc-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.resignation-doc-meta {
  color: #909399;
  font-size: 12px;
}

.documents-progress {
  margin-bottom: 20px;
  padding: 16px 20px;
  background-color: #f5f7fa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.documents-progress .label {
  font-weight: 500;
  color: #303133;
}

.documents-progress .count {
  color: #606266;
  font-size: 14px;
}

.doc-type-name {
  display: flex;
  align-items: center;
}

.doc-type-name .name-text {
  font-weight: 500;
}

.uploaded-docs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #f0f9eb;
  border-radius: 4px;
  font-size: 13px;
}

.doc-icon {
  color: #67c23a;
  flex-shrink: 0;
}

.doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-info {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

.no-doc {
  color: #909399;
  font-size: 13px;
}

/* 合同到期前10天标红 */
.contract-expiring {
  color: #f56c6c;
  font-weight: bold;
}

:deep(.contract-expiring-row) {
  --el-table-tr-bg-color: #fef0f0 !important;
}

:deep(.contract-expiring-row td) {
  color: #f56c6c !important;
}

.reason-ellipsis {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  color: #606266;
  cursor: default;
}
</style>
