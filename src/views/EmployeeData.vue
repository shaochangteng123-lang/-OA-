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
                    <el-input
                      v-model="filterForm.keyword"
                      placeholder="姓名/手机号"
                      clearable
                      style="width: 180px"
                    />
                  </el-form-item>
                  <el-form-item label="部门">
                    <el-input
                      v-model="filterForm.department"
                      placeholder="全部部门"
                      clearable
                    />
                  </el-form-item>
                  <el-form-item label="状态">
                    <el-select
                      v-model="filterForm.employmentStatus"
                      placeholder="全部状态"
                      clearable
                      style="width: 150px"
                    >
                      <el-option
                        label="在职"
                        value="active"
                        :disabled="
                          currentEmployee?.employment_status === 'probation'
                        "
                      />
                      <el-option label="实习期" value="probation" />
                      <el-option label="已离职" value="resigned" />
                      <el-option label="休假中" value="on_leave" />
                    </el-select>
                  </el-form-item>
                  <el-form-item>
                    <el-button
                      type="primary"
                      :icon="Search"
                      @click="handleSearch"
                    >
                      查询
                    </el-button>
                    <el-button :icon="Refresh" @click="handleReset"
                      >重置</el-button
                    >
                    <el-button :icon="Download" @click="handleExport"
                      >导出</el-button
                    >
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
                <el-table-column
                  type="index"
                  label="序号"
                  width="60"
                  align="center"
                />
                <el-table-column
                  prop="employee_no"
                  label="员工编号"
                  min-width="100"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.employee_no || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="name"
                  label="姓名"
                  min-width="80"
                  align="center"
                />
                <el-table-column
                  prop="gender"
                  label="性别"
                  min-width="60"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ getGenderText(row.gender) }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="department"
                  label="部门"
                  min-width="100"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.department || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="position"
                  label="职位"
                  min-width="120"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.position || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="mobile"
                  label="联系电话"
                  min-width="110"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.mobile || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="email"
                  label="邮箱"
                  min-width="150"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.email || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="hire_date"
                  label="入职日期"
                  min-width="100"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.hire_date || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="contract_end_date"
                  label="合同到期"
                  min-width="100"
                  align="center"
                >
                  <template #default="{ row }">
                    <span
                      :class="{ 'contract-expiring': isContractExpiring(row) }"
                    >
                      {{ row.contract_end_date || "-" }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column
                  prop="employment_status"
                  label="状态"
                  min-width="80"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag
                      :type="
                        getEmploymentStatusType(
                          getDisplayedEmploymentStatus(row),
                        )
                      "
                    >
                      {{
                        getEmploymentStatusText(
                          getDisplayedEmploymentStatus(row),
                        )
                      }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" min-width="120" align="center">
                  <template #default="{ row }">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handleView(row)"
                    >
                      查看
                    </el-button>
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handleEdit(row)"
                    >
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
          <el-tab-pane label="入职管理" name="onboarding">
            <div class="tab-content">
              <!-- 说明 -->
              <el-alert
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 20px"
              >
                <template #title>
                  管理入职所需的 PDF
                  文件模板，上传后所有员工可在「入职」页面查看和下载（仅支持
                  PDF）
                </template>
              </el-alert>

              <!-- 入职文件管理 -->
              <el-table
                :data="onboardingStore.onboardingFiles"
                style="width: 100%"
                border
              >
                <el-table-column
                  type="index"
                  label="序号"
                  width="70"
                  align="center"
                />
                <el-table-column prop="name" label="文件类型" min-width="200">
                  <template #default="{ row }">
                    <div class="file-type-name">
                      <span class="name-text">{{ row.name }}</span>
                    </div>
                    <div
                      v-if="row.children && row.children.length > 0"
                      class="file-children"
                    >
                      <div
                        v-for="(child, index) in row.children"
                        :key="index"
                        class="child-item"
                      >
                        {{ Number(index) + 1 }}. {{ child }}
                      </div>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="已上传文件" min-width="300">
                  <template #default="{ row }">
                    <!-- 个人入职材料由员工自行准备 -->
                    <span v-if="row.id === 'personal'" class="self-prepare"
                      >员工自行准备后上交</span
                    >
                    <div
                      v-else-if="row.files && row.files.length > 0"
                      class="uploaded-files"
                    >
                      <div
                        v-for="file in row.files"
                        :key="file.id"
                        class="file-item"
                      >
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
                    <!-- 个人入职材料无需上传公共模板 -->
                    <template v-if="row.id !== 'personal'">
                      <el-upload
                        :show-file-list="false"
                        :before-upload="
                          (file: File) => handleUpload(row.id, file)
                        "
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
              <el-badge
                v-if="probationPendingCount > 0"
                :value="probationPendingCount"
                type="danger"
                class="tab-badge"
              />
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
                    上传转正申请表 PDF
                    模板后，员工和审批人在系统内直接在线填写（仅支持 PDF）
                  </template>
                </el-alert>
                <el-table
                  :data="probationStore.templates"
                  style="width: 100%"
                  border
                  v-loading="probationStore.templatesLoading"
                >
                  <el-table-column
                    type="index"
                    label="序号"
                    width="70"
                    align="center"
                  />
                  <el-table-column
                    prop="name"
                    label="模板名称"
                    min-width="200"
                  />
                  <el-table-column
                    prop="file_name"
                    label="文件名"
                    min-width="200"
                  />
                  <el-table-column
                    prop="uploaded_by_name"
                    label="上传人"
                    width="120"
                  />
                  <el-table-column
                    prop="created_at"
                    label="上传时间"
                    width="180"
                  >
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="150" align="center">
                    <template #default="{ row }">
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handlePreviewProbationTemplate(row)"
                      >
                        预览
                      </el-button>
                      <el-button
                        link
                        type="danger"
                        size="small"
                        @click="handleDeleteProbationTemplate(row)"
                      >
                        删除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <!-- 管理员转正审批与记录 -->
              <div class="section-block probation-list-section">
                <el-alert
                  v-if="probationDueSoonCount > 0"
                  type="warning"
                  :closable="false"
                  show-icon
                  class="probation-due-alert"
                >
                  <template #title>
                    {{ probationDueSoonCount }} 名实习期员工将在 30
                    天内到期或已经到期，请及时跟进转正材料
                  </template>
                </el-alert>
                <el-alert
                  v-if="probationArchivePendingCount > 0"
                  type="warning"
                  :closable="false"
                  show-icon
                  class="probation-due-alert"
                >
                  <template #title>
                    {{ probationArchivePendingCount }}
                    名员工已完成全部转正审批，但尚未上传正式盖章转正档案，请到对应员工详情的“转正档案”中完成归档
                  </template>
                </el-alert>
                <ProbationApprovalPanel :key="probationManagementVersion" />
              </div>
            </div>
          </el-tab-pane>

          <!-- 离职管理 Tab -->
          <el-tab-pane name="resignation">
            <template #label>
              <span>离职管理</span>
              <el-badge
                v-if="resignationPendingCount > 0"
                :value="resignationPendingCount"
                type="danger"
                class="tab-badge"
              />
            </template>
            <div class="tab-content">
              <div class="section-block probation-template-section">
                <div class="section-header">
                  <h3>离职模板管理</h3>
                  <div class="resignation-template-upload-actions">
                    <el-upload
                      v-for="templateType in RESIGNATION_TEMPLATE_ORDER"
                      :key="templateType"
                      :show-file-list="false"
                      :before-upload="
                        handleUploadResignationTemplate(templateType)
                      "
                      accept=".pdf,application/pdf"
                    >
                      <el-button
                        type="primary"
                        plain
                        size="small"
                        :icon="Upload"
                      >
                        {{ RESIGNATION_TEMPLATE_LABELS[templateType] }}
                      </el-button>
                    </el-upload>
                  </div>
                </div>
                <el-alert
                  type="info"
                  :closable="false"
                  show-icon
                  style="margin-bottom: 16px"
                >
                  <template #title>
                    离职模板仅支持 PDF（便携式文档格式），系统将按上传文件的
                    原版式在线填写并生成 PDF。
                  </template>
                </el-alert>
                <el-table
                  :data="sortedResignationTemplates"
                  style="width: 100%"
                  border
                  v-loading="resignationStore.templatesLoading"
                >
                  <el-table-column
                    type="index"
                    label="序号"
                    width="70"
                    align="center"
                  />
                  <el-table-column
                    label="模板类型"
                    min-width="180"
                    align="center"
                  >
                    <template #default="{ row }">
                      <span style="white-space: nowrap">{{
                        RESIGNATION_TEMPLATE_LABELS[
                          row.template_type as ResignationTemplateType
                        ] || row.template_type
                      }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="name"
                    label="模板名称"
                    min-width="180"
                    align="center"
                  />
                  <el-table-column
                    prop="file_name"
                    label="文件名"
                    min-width="220"
                    align="center"
                  />
                  <el-table-column
                    prop="uploaded_by_name"
                    label="上传人"
                    width="120"
                    align="center"
                  />
                  <el-table-column
                    prop="created_at"
                    label="上传时间"
                    width="180"
                    align="center"
                  >
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="150" align="center">
                    <template #default="{ row }">
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handlePreviewResignationTemplate(row)"
                      >
                        预览
                      </el-button>
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handleDownloadResignationTemplate(row)"
                        >下载原件</el-button
                      >
                      <el-button
                        link
                        type="danger"
                        size="small"
                        @click="handleDeleteResignationTemplate(row)"
                        >删除</el-button
                      >
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <div class="section-block probation-list-section">
                <div class="section-header">
                  <h3>离职人员</h3>
                  <div class="filter-actions">
                    <el-select
                      v-model="resignationStatusFilter"
                      placeholder="全部状态"
                      clearable
                      style="width: 180px"
                      @change="handleResignationFilterChange"
                    >
                      <el-option label="档案待完善" value="draft" />
                      <el-option
                        label="待确认离职"
                        value="pending_confirmation"
                      />
                      <el-option label="已离职" value="approved" />
                    </el-select>
                    <el-button
                      type="primary"
                      :icon="Plus"
                      @click="openCreateResignationDialog()"
                      >创建离职人员</el-button
                    >
                  </div>
                </div>
                <el-table
                  :data="resignationStore.managementList"
                  style="width: 100%"
                  border
                  v-loading="resignationStore.managementLoading"
                >
                  <el-table-column
                    type="index"
                    label="序号"
                    width="60"
                    align="center"
                  />
                  <el-table-column
                    prop="employee_no"
                    label="员工编号"
                    min-width="120"
                    align="center"
                  />
                  <el-table-column
                    prop="employee_name"
                    label="员工姓名"
                    min-width="90"
                    align="center"
                  />
                  <el-table-column
                    prop="employee_department"
                    label="部门"
                    min-width="110"
                    align="center"
                  />
                  <el-table-column
                    prop="employee_position"
                    label="职位"
                    min-width="110"
                    align="center"
                  />
                  <el-table-column
                    prop="hire_date"
                    label="入职日期"
                    min-width="110"
                    align="center"
                  >
                    <template #default="{ row }">{{
                      row.hire_date || "-"
                    }}</template>
                  </el-table-column>
                  <el-table-column
                    prop="employment_status"
                    label="在职状态"
                    min-width="100"
                    align="center"
                  >
                    <template #default="{ row }">
                      <el-tag
                        :type="getEmploymentStatusType(row.employment_status)"
                      >
                        {{ getEmploymentStatusText(row.employment_status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="resign_type"
                    label="离职类型"
                    min-width="100"
                    align="center"
                  >
                    <template #default="{ row }">{{
                      getResignationTypeText(row.resign_type)
                    }}</template>
                  </el-table-column>
                  <el-table-column
                    prop="resign_date"
                    label="离职日期"
                    min-width="110"
                    align="center"
                  />
                  <el-table-column
                    prop="status"
                    label="状态"
                    min-width="120"
                    align="center"
                  >
                    <template #default="{ row }">
                      <el-tag :type="getResignationStatusType(row.status)">{{
                        getResignationStatusText(row.status)
                      }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="档案完成度"
                    min-width="170"
                    align="center"
                  >
                    <template #default="{ row }">
                      <el-progress
                        :percentage="getResignationArchivePercentage(row)"
                        :status="
                          getResignationArchivePercentage(row) === 100
                            ? 'success'
                            : ''
                        "
                        :stroke-width="8"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="账号状态"
                    min-width="100"
                    align="center"
                  >
                    <template #default="{ row }">
                      <el-tag :type="getAccountStatusType(row.account_status)">
                        {{ getAccountStatusText(row.account_status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" min-width="250" align="center">
                    <template #default="{ row }">
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handleViewResignationDetail(row.id)"
                        >离职档案</el-button
                      >
                      <el-button
                        link
                        type="success"
                        size="small"
                        @click="openResignationTemplateEditor(row.id)"
                        >在线模板</el-button
                      >
                      <el-button
                        v-if="
                          ['draft', 'pending_confirmation'].includes(row.status)
                        "
                        link
                        type="danger"
                        size="small"
                        @click="handleDeleteResignationRequest(row.id)"
                        >删除</el-button
                      >
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-tab-pane>

          <!-- 请假管理 Tab -->
          <el-tab-pane label="请假管理" name="leave">
            <div class="tab-content">
              <LeaveAdminPanel />
            </div>
          </el-tab-pane>

          <!-- 人力成本 Tab -->
          <el-tab-pane label="人力成本" name="human-cost">
            <div class="tab-content human-cost-tab-content">
              <HumanCostPanel />
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
                    <el-input
                      v-model="editFormData.name"
                      placeholder="请输入姓名"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="性别" prop="gender">
                    <el-select
                      v-model="editFormData.gender"
                      placeholder="请选择性别"
                      style="width: 100%"
                    >
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
                    <el-input
                      v-model="editFormData.id_number"
                      placeholder="请输入身份证号"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="民族" prop="ethnicity">
                    <el-input
                      v-model="editFormData.ethnicity"
                      placeholder="请输入民族"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="籍贯" prop="native_place">
                    <el-input
                      v-model="editFormData.native_place"
                      placeholder="请输入籍贯"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="婚姻状况" prop="marital_status">
                    <el-select
                      v-model="editFormData.marital_status"
                      placeholder="请选择婚姻状况"
                      style="width: 100%"
                    >
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
                    <el-input
                      v-model="editFormData.mobile"
                      placeholder="请输入手机号码"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="电子邮箱" prop="email">
                    <el-input
                      v-model="editFormData.email"
                      placeholder="请输入电子邮箱"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="16">
                  <el-form-item label="现居住地址" prop="address">
                    <el-input
                      v-model="editFormData.address"
                      placeholder="请输入现居住地址"
                    />
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
                    <el-input
                      v-model="editFormData.emergency_contact"
                      placeholder="请输入紧急联系人姓名"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="联系人电话" prop="emergency_phone">
                    <el-input
                      v-model="editFormData.emergency_phone"
                      placeholder="请输入紧急联系人电话"
                    />
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
                    <el-select
                      v-model="editFormData.education"
                      placeholder="请选择学历"
                      style="width: 100%"
                    >
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
                    <el-input
                      v-model="editFormData.school"
                      placeholder="请输入毕业院校"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="所学专业" prop="major">
                    <el-input
                      v-model="editFormData.major"
                      placeholder="请输入所学专业"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </div>

            <!-- 工作信息 -->
            <div class="form-section">
              <div class="section-title">工作信息</div>
              <el-row :gutter="24">
                <el-col :span="7">
                  <el-form-item label="入职日期" prop="hire_date">
                    <el-tooltip
                      content="入职日期来自第一份劳动合同；未识别到合同期限时不显示"
                      placement="top"
                    >
                      <div
                        class="readonly-field-display"
                        role="textbox"
                        aria-readonly="true"
                      >
                        {{ editFormData.hire_date || "暂无入职日期" }}
                      </div>
                    </el-tooltip>
                  </el-form-item>
                </el-col>
                <el-col :span="10">
                  <el-form-item label="劳动合同">
                    <div
                      class="contract-period-display"
                      role="textbox"
                      aria-readonly="true"
                    >
                      {{ laborContractPeriodDisplay }}
                    </div>
                  </el-form-item>
                </el-col>
                <el-col :span="7">
                  <el-form-item label="在职状态" prop="employment_status">
                    <el-select
                      v-model="editFormData.employment_status"
                      placeholder="请选择在职状态"
                      :disabled="
                        currentEmployee?.employment_status === 'resigned'
                      "
                      style="width: 100%"
                    >
                      <el-option label="在职" value="active" />
                      <el-option label="实习期" value="probation" />
                      <el-option
                        v-if="currentEmployee?.employment_status === 'resigned'"
                        label="已离职"
                        value="resigned"
                      />
                      <el-option label="休假中" value="on_leave" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="8">
                  <el-form-item label="所属部门" prop="department">
                    <el-select
                      v-model="editFormData.department"
                      placeholder="请选择所属部门"
                      style="width: 100%"
                      @change="handleEmployeeDepartmentChange"
                    >
                      <el-option
                        v-for="department in employeeDepartments"
                        :key="department"
                        :label="department"
                        :value="department"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="职位" prop="position">
                    <el-select
                      v-model="editFormData.position"
                      placeholder="请先选择所属部门"
                      :disabled="!editFormData.department"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="position in employeePositionOptions"
                        :key="position"
                        :label="position"
                        :value="position"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="12">
                  <el-form-item label="合同模板期限">
                    <el-date-picker
                      v-model="contractTemplatePeriod"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="开始日期"
                      end-placeholder="结束日期"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      clearable
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="模板试用期">
                    <el-date-picker
                      v-model="probationTemplatePeriod"
                      type="daterange"
                      range-separator="至"
                      start-placeholder="无试用期可留空"
                      end-placeholder="无试用期可留空"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      clearable
                      :disabled="!isEditing || !contractTemplatePeriod?.length"
                      style="width: 100%"
                    />
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
                    <el-input
                      v-model="editFormData.bank_account_name"
                      placeholder="请输入收款人姓名"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="收款人手机" prop="bank_account_phone">
                    <el-input
                      v-model="editFormData.bank_account_phone"
                      placeholder="请输入收款人手机号"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="24">
                <el-col :span="12">
                  <el-form-item label="开户行" prop="bank_name">
                    <el-input
                      v-model="editFormData.bank_name"
                      placeholder="请输入开户行（中国工商银行）"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="银行卡号" prop="bank_account_number">
                    <el-input
                      v-model="editFormData.bank_account_number"
                      placeholder="请输入银行卡号（中国工商银行）"
                    />
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
              <span class="count"
                >{{ completedDocTypes }} /
                {{ requiredDocumentTypes.length }}</span
              >
              <div v-if="isEditing" class="documents-upload-action">
                <el-tooltip
                  content="删除该员工的全部人事档案文件"
                  placement="top"
                >
                  <el-button
                    type="danger"
                    plain
                    :icon="Delete"
                    :loading="deletingAllDocuments"
                    :disabled="
                      employeeDocuments.length === 0 || documentControlsDisabled
                    "
                    @click="handleDeleteAllDocuments"
                  >
                    一键删除
                  </el-button>
                </el-tooltip>
                <el-tooltip
                  content="可一次选择多个 PDF，系统将逐页识别、拆分并自动归档"
                  placement="top"
                >
                  <el-upload
                    multiple
                    :show-file-list="false"
                    :before-upload="handleAutoUploadDoc"
                    :disabled="documentControlsDisabled"
                    accept=".pdf"
                  >
                    <el-button
                      type="primary"
                      :icon="Upload"
                      :loading="autoDocumentUploadCount > 0"
                      class="auto-document-upload-button"
                    >
                      {{
                        autoDocumentUploadCount > 0
                          ? `正在识别（${autoDocumentUploadCount}）`
                          : "一键识别上传"
                      }}
                    </el-button>
                  </el-upload>
                </el-tooltip>
              </div>
            </div>

            <!-- 文档列表 -->
            <el-table
              :data="documentTypes"
              style="width: 100%"
              border
              v-loading="documentsLoading"
            >
              <el-table-column
                type="index"
                label="序号"
                width="70"
                align="center"
              />
              <el-table-column prop="label" label="文档类型" min-width="200">
                <template #default="{ row }">
                  <div class="doc-type-name">
                    <span class="name-text">{{ row.label }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="已上传文件" min-width="580">
                <template #default="{ row }">
                  <div
                    v-if="getDocumentsByType(row.type).length > 0"
                    class="uploaded-docs"
                  >
                    <div
                      v-for="doc in getDocumentsByType(row.type)"
                      :key="doc.id"
                      class="doc-item"
                    >
                      <el-icon class="doc-icon"><Document /></el-icon>
                      <span class="doc-name">{{ doc.file_name }}</span>
                      <template v-if="row.type === 'contract'">
                        <el-tag
                          size="small"
                          :type="getContractStatusType(doc)"
                          effect="plain"
                        >
                          {{ getContractStatusText(doc) }}
                        </el-tag>
                        <span class="contract-term">{{
                          formatContractTerm(doc)
                        }}</span>
                      </template>
                      <span class="doc-info">{{
                        formatFileSize(doc.file_size)
                      }}</span>
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handlePreviewDoc(doc)"
                      >
                        预览
                      </el-button>
                      <el-button
                        link
                        type="primary"
                        size="small"
                        @click="handleDownloadDoc(doc)"
                      >
                        下载
                      </el-button>
                      <el-button
                        v-if="isEditing"
                        link
                        type="danger"
                        size="small"
                        :disabled="documentControlsDisabled"
                        @click="handleDeleteDoc(doc)"
                      >
                        删除
                      </el-button>
                    </div>
                  </div>
                  <span v-else class="no-doc">暂无文件</span>
                </template>
              </el-table-column>
              <el-table-column
                v-if="isEditing"
                label="操作"
                min-width="150"
                align="center"
              >
                <template #default="{ row }">
                  <el-upload
                    :show-file-list="false"
                    :before-upload="
                      (file: File) => handleUploadDoc(row.type, file)
                    "
                    :disabled="documentControlsDisabled"
                    accept=".pdf"
                  >
                    <el-button
                      type="primary"
                      size="small"
                      :icon="Upload"
                      :disabled="documentControlsDisabled"
                    >
                      {{
                        row.type === "contract" &&
                        getDocumentsByType("contract").length > 0
                          ? "上传续签合同"
                          : "上传 PDF"
                      }}
                    </el-button>
                  </el-upload>
                  <div class="upload-only-pdf-tip">
                    仅支持 PDF，大小不超过 10MB
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 转正档案 Tab -->
        <el-tab-pane label="转正档案" name="probationArchive">
          <div class="documents-section" v-loading="probationArchiveLoading">
            <div class="probation-archive-toolbar">
              <div class="section-title">转正申请记录</div>
              <el-upload
                v-if="isEditing && employeeProbationArchive?.can_upload"
                :show-file-list="false"
                :before-upload="handleUploadEmployeeProbationDocument"
                :disabled="probationArchiveMutationPending"
                accept=".pdf"
              >
                <el-button
                  type="primary"
                  size="small"
                  :icon="Upload"
                  :loading="probationArchiveMutationPending"
                >
                  上传正式盖章文件
                </el-button>
              </el-upload>
            </div>

            <el-alert
              v-if="
                employeeProbationArchive &&
                !employeeProbationArchive.confirmation &&
                currentEmployee?.employment_status === 'active'
              "
              type="info"
              :closable="false"
              show-icon
              class="probation-archive-alert"
            >
              <template #title>
                该员工创建时已直接设为在职，未生成转正审批记录；此处上传的盖章文件将作为正式转正档案。
              </template>
            </el-alert>

            <el-alert
              v-else-if="
                employeeProbationArchive?.confirmation &&
                employeeProbationArchive.confirmation.status !== 'approved'
              "
              type="info"
              :closable="false"
              show-icon
              class="probation-archive-alert"
            >
              <template #title>
                该员工尚未转正通过，流程申请表不会进入正式档案；请在“转正管理”中查看流程材料。
              </template>
            </el-alert>

            <el-alert
              v-else-if="
                employeeProbationArchive?.confirmation &&
                employeeProbationArchive.can_upload
              "
              type="warning"
              :closable="false"
              show-icon
              class="probation-archive-alert"
            >
              <template #title>
                当前转正记录尚未归档正式盖章文件；上传后会同步显示在转正申请列表的“正式文件”列，且不改变原审批状态。
              </template>
            </el-alert>

            <el-descriptions
              v-if="employeeProbationArchive?.confirmation"
              :column="3"
              border
              class="probation-archive-summary"
            >
              <el-descriptions-item label="转正状态">
                <el-tag
                  :type="
                    getProbationStatusType(
                      employeeProbationArchive.confirmation.status,
                    )
                  "
                >
                  {{
                    getProbationStatusText(
                      employeeProbationArchive.confirmation.status,
                    )
                  }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="入职日期">
                {{ employeeProbationArchive.confirmation.hire_date || "-" }}
              </el-descriptions-item>
              <el-descriptions-item label="试用期截止">
                {{
                  employeeProbationArchive.confirmation.probation_end_date ||
                  "-"
                }}
              </el-descriptions-item>
              <el-descriptions-item label="提交时间">
                {{
                  employeeProbationArchive.confirmation.submit_time
                    ? formatDateTime(
                        employeeProbationArchive.confirmation.submit_time,
                      )
                    : "-"
                }}
              </el-descriptions-item>
              <el-descriptions-item label="转正时间">
                {{
                  employeeProbationArchive.confirmation.approve_time
                    ? formatDateTime(
                        employeeProbationArchive.confirmation.approve_time,
                      )
                    : "-"
                }}
              </el-descriptions-item>
              <el-descriptions-item label="审批人">
                {{ employeeProbationArchive.confirmation.approver_name || "-" }}
              </el-descriptions-item>
            </el-descriptions>

            <div class="probation-archive-files">
              <div class="section-title">正式转正申请单（盖章归档）</div>
              <el-table
                v-if="employeeProbationArchive?.documents.length"
                :data="employeeProbationArchive.documents"
                style="width: 100%"
                border
              >
                <el-table-column
                  prop="file_name"
                  label="文件名"
                  min-width="260"
                />
                <el-table-column label="文件类型" width="120" align="center">
                  <template #default="{ row }">
                    <el-tag type="success" effect="plain">
                      {{ row.confirmation_id ? "正式盖章件" : "直接归档件" }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column
                  prop="uploaded_by_name"
                  label="上传人"
                  width="130"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ row.uploaded_by_name || "-" }}
                  </template>
                </el-table-column>
                <el-table-column
                  prop="created_at"
                  label="上传时间"
                  width="180"
                  align="center"
                >
                  <template #default="{ row }">
                    {{ formatDateTime(row.created_at) }}
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="190" align="center">
                  <template #default="{ row }">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handlePreviewEmployeeProbationDocument(row)"
                    >
                      预览
                    </el-button>
                    <el-button
                      link
                      type="primary"
                      size="small"
                      @click="handleDownloadEmployeeProbationDocument(row)"
                    >
                      下载
                    </el-button>
                    <el-button
                      v-if="isEditing && !row.confirmation_id"
                      link
                      type="danger"
                      size="small"
                      :disabled="probationArchiveMutationPending"
                      @click="handleDeleteEmployeeProbationDocument(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty
                v-else
                :description="
                  employeeProbationArchive?.confirmation &&
                  employeeProbationArchive.confirmation.status !== 'approved'
                    ? '转正通过后显示正式申请表'
                    : '暂无正式盖章文件'
                "
              />
            </div>
          </div>
        </el-tab-pane>

        <!-- 离职档案 Tab -->
        <el-tab-pane label="离职档案" name="resignationArchive">
          <div class="documents-section" v-loading="resignationArchiveLoading">
            <el-empty
              v-if="!employeeResignationArchive?.request"
              description="该员工暂无离职档案记录"
            >
              <el-button
                v-if="isEditing && currentEmployee"
                type="primary"
                @click="openCreateResignationDialog(currentEmployee.id)"
              >
                创建离职档案
              </el-button>
            </el-empty>
            <template v-else>
              <div class="resignation-archive-summary">
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="员工姓名">{{
                    employeeResignationArchive.request.employee_name || "-"
                  }}</el-descriptions-item>
                  <el-descriptions-item label="离职类型">{{
                    getResignationTypeText(
                      employeeResignationArchive.request.resign_type,
                    )
                  }}</el-descriptions-item>
                  <el-descriptions-item label="离职日期">{{
                    employeeResignationArchive.request.resign_date || "-"
                  }}</el-descriptions-item>
                  <el-descriptions-item label="当前状态">
                    <el-tag
                      :type="
                        getResignationStatusType(
                          employeeResignationArchive.request.status,
                        )
                      "
                    >
                      {{
                        getResignationStatusText(
                          employeeResignationArchive.request.status,
                        )
                      }}
                    </el-tag>
                  </el-descriptions-item>
                  <el-descriptions-item label="离职说明" :span="2">
                    {{ employeeResignationArchive.request.reason || "-" }}
                  </el-descriptions-item>
                </el-descriptions>
              </div>
              <ResignationArchiveManager
                :request-id="employeeResignationArchive.request.id"
                :status="employeeResignationArchive.request.status"
                :documents="employeeResignationArchive.documents"
                :editable="isEditing"
                @updated="handleEmployeeArchiveUpdated"
                @completed="handleResignationArchiveCompleted"
              />
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
            <el-button
              type="primary"
              :loading="editSaving"
              @click="handleSaveEdit"
              >保存</el-button
            >
          </template>
        </span>
      </template>
    </el-dialog>

    <el-dialog
      v-model="resignationDetailVisible"
      title="离职档案"
      width="1050px"
      top="4vh"
      destroy-on-close
    >
      <div v-if="resignationStore.detail" class="detail-content">
        <el-descriptions :column="3" border class="resignation-detail-summary">
          <el-descriptions-item label="员工编号">{{
            resignationStore.detail.request.employee_no || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="员工姓名">{{
            resignationStore.detail.request.employee_name || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag
              :type="
                getResignationStatusType(resignationStore.detail.request.status)
              "
            >
              {{
                getResignationStatusText(resignationStore.detail.request.status)
              }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="离职类型">{{
            getResignationTypeText(resignationStore.detail.request.resign_type)
          }}</el-descriptions-item>
          <el-descriptions-item label="离职日期">{{
            resignationStore.detail.request.resign_date
          }}</el-descriptions-item>
          <el-descriptions-item label="账号状态">
            {{
              getAccountStatusText(
                resignationStore.detail.request.account_status,
              )
            }}
          </el-descriptions-item>
          <el-descriptions-item label="离职说明" :span="3">
            {{ resignationStore.detail.request.reason || "-" }}
          </el-descriptions-item>
        </el-descriptions>
        <ResignationArchiveManager
          :request-id="resignationStore.detail.request.id"
          :status="resignationStore.detail.request.status"
          :documents="resignationStore.detail.documents"
          :loading="resignationStore.detailLoading"
          @updated="handleManagementArchiveUpdated"
          @completed="handleResignationArchiveCompleted"
        />
      </div>
      <template #footer>
        <el-button @click="resignationDetailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="createResignationVisible"
      title="创建离职人员"
      width="620px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="createResignationFormRef"
        :model="createResignationForm"
        :rules="createResignationRules"
        label-width="100px"
      >
        <el-form-item label="离职员工" prop="employeeId">
          <el-select
            v-model="createResignationForm.employeeId"
            filterable
            placeholder="请选择员工"
            style="width: 100%"
          >
            <el-option
              v-for="employee in resignationStore.managementCandidates"
              :key="employee.id"
              :label="`${employee.employee_no || '-'} · ${employee.name}${employee.employment_status === 'resigned' ? ' · 已离职补录' : ''}`"
              :value="employee.id"
            >
              <span
                >{{ employee.employee_no || "-" }} · {{ employee.name }}</span
              >
              <span class="candidate-department">
                {{
                  employee.employment_status === "resigned"
                    ? "已离职补录"
                    : employee.department || "未分配部门"
                }}
              </span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="离职类型" prop="resignType">
          <el-select
            v-model="createResignationForm.resignType"
            style="width: 100%"
          >
            <el-option label="主动离职" value="voluntary" />
            <el-option label="合同到期" value="contract_end" />
            <el-option label="辞退" value="dismissal" />
          </el-select>
        </el-form-item>
        <el-form-item label="离职日期" prop="resignDate">
          <el-date-picker
            v-model="createResignationForm.resignDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择离职日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="离职说明">
          <el-input
            v-model="createResignationForm.reason"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            placeholder="可填写离职原因或补充说明"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createResignationVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creatingResignation"
          @click="submitCreateResignation"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from "element-plus";
import {
  Search,
  Refresh,
  Download,
  Upload,
  Document,
  Delete,
  View,
  Plus,
} from "@element-plus/icons-vue";
import { useOnboardingStore } from "@/stores/onboarding";
import {
  useProbationStore,
  type ProbationConfirmation,
  type ProbationDocument,
  type ProbationTemplate,
} from "@/stores/probation";
import {
  useResignationStore,
  type ResignationDetailData,
  type ResignationTemplate,
  type ResignationType,
} from "@/stores/resignation";
import { usePendingStore } from "@/stores/pending";
import { api } from "@/utils/api";
import {
  formatContractDate,
  getContractExpiryReminder,
} from "@/utils/contractReminder";
import LeaveAdminPanel from "@/components/leave/LeaveAdminPanel.vue";
import HumanCostPanel from "@/components/payroll/HumanCostPanel.vue";
import ResignationArchiveManager from "@/components/resignation/ResignationArchiveManager.vue";
import ProbationApprovalPanel from "@/views/GMProbationApproval.vue";

type ResignationTemplateType =
  | "termination_agreement"
  | "employee_handover_form"
  | "settlement_confirmation"
  | "compensation_agreement"
  | "resignation_certificate";

const RESIGNATION_TEMPLATE_LABELS: Record<ResignationTemplateType, string> = {
  termination_agreement: "终止 / 解除劳动关系协议书",
  employee_handover_form: "员工离职交接单",
  settlement_confirmation: "薪资及各类款项结算确认书",
  compensation_agreement: "离职经济补偿协议书",
  resignation_certificate: "离职证明",
};

const RESIGNATION_TEMPLATE_ORDER: ResignationTemplateType[] = [
  "termination_agreement",
  "employee_handover_form",
  "settlement_confirmation",
  "compensation_agreement",
  "resignation_certificate",
];

const sortedResignationTemplates = computed(() => {
  return [...resignationStore.templates].sort((a, b) => {
    const indexA = RESIGNATION_TEMPLATE_ORDER.indexOf(
      a.template_type as ResignationTemplateType,
    );
    const indexB = RESIGNATION_TEMPLATE_ORDER.indexOf(
      b.template_type as ResignationTemplateType,
    );
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });
});

const RESIGNATION_TYPE_TEXT_MAP = {
  voluntary: "主动离职",
  contract_end: "合同到期",
  dismissal: "辞退",
} as const;

// 使用共享的 store
const onboardingStore = useOnboardingStore();
const probationStore = useProbationStore();
const resignationStore = useResignationStore();
const pendingStore = usePendingStore();
const route = useRoute();
const router = useRouter();

// 待操作事项计数
const probationDueSoonCount = computed(
  () => pendingStore.counts.probationDueSoon || 0,
);
const probationArchivePendingCount = computed(
  () => pendingStore.counts.probationArchivePending || 0,
);
const probationPendingCount = computed(() => {
  return (
    (pendingStore.counts.probationPending || 0) +
    probationDueSoonCount.value +
    probationArchivePendingCount.value
  );
});
const resignationPendingCount = computed(
  () => pendingStore.counts.resignationPending || 0,
);
// 转正管理相关
const probationManagementVersion = ref(0);
const refreshProbationManagement = () => {
  probationManagementVersion.value += 1;
};
const resignationStatusFilter = ref("");
const resignationDetailVisible = ref(false);
const createResignationVisible = ref(false);
const creatingResignation = ref(false);
const createResignationFormRef = ref<FormInstance>();
const createResignationForm = reactive<{
  employeeId: string;
  resignType: ResignationType;
  resignDate: string;
  reason: string;
}>({
  employeeId: "",
  resignType: "voluntary",
  resignDate: "",
  reason: "",
});
const createResignationRules: FormRules = {
  employeeId: [
    { required: true, message: "请选择离职员工", trigger: "change" },
  ],
  resignType: [
    { required: true, message: "请选择离职类型", trigger: "change" },
  ],
  resignDate: [
    { required: true, message: "请选择离职日期", trigger: "change" },
  ],
};

const getResignationArchivePercentage = (request: {
  completedDocumentCount?: number;
  requiredDocumentCount?: number;
}) => {
  const required = Number(
    request.requiredDocumentCount || RESIGNATION_TEMPLATE_ORDER.length,
  );
  const completed = Number(request.completedDocumentCount || 0);
  return required > 0 ? Math.round((completed / required) * 100) : 0;
};

const openCreateResignationDialog = async (employeeId = "") => {
  createResignationForm.employeeId = "";
  createResignationForm.resignType = "voluntary";
  createResignationForm.resignDate = "";
  createResignationForm.reason = "";
  try {
    await resignationStore.fetchManagementCandidates();
    if (
      employeeId &&
      resignationStore.managementCandidates.some(
        (employee) => employee.id === employeeId,
      )
    ) {
      createResignationForm.employeeId = employeeId;
    }
    createResignationVisible.value = true;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "获取员工列表失败");
  }
};

const submitCreateResignation = async () => {
  if (!createResignationFormRef.value) return;
  const valid = await createResignationFormRef.value
    .validate()
    .catch(() => false);
  if (!valid) return;

  creatingResignation.value = true;
  try {
    const result = await resignationStore.createManagementRequest({
      employeeId: createResignationForm.employeeId,
      resignType: createResignationForm.resignType,
      resignDate: createResignationForm.resignDate,
      reason: createResignationForm.reason.trim() || undefined,
    });
    if (result.success) {
      ElMessage.success(result.message || "离职人员创建成功");
      createResignationVisible.value = false;
      await pendingStore.refreshPendingCounts();
      if (result.data?.request?.id) {
        if (currentEmployee.value?.id === createResignationForm.employeeId) {
          await fetchEmployeeResignationArchive();
        }
        await handleViewResignationDetail(result.data.request.id);
      }
    } else {
      ElMessage.error(result.message || "创建失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "创建失败");
  } finally {
    creatingResignation.value = false;
  }
};

const openResignationTemplateEditor = (requestId: string) => {
  const editorUrl = router.resolve({
    name: "ResignationTemplateEditor",
    params: { requestId },
  }).href;
  const editorWindow = window.open(editorUrl, "_blank");
  if (!editorWindow) {
    ElMessage.warning("浏览器阻止了模板编辑窗口，请允许当前站点打开新窗口");
  }
};

const handleDeleteResignationRequest = async (id: string) => {
  try {
    await ElMessageBox.confirm(
      "确定删除该离职人员记录吗？已上传的离职档案也会被永久删除。",
      "删除确认",
      {
        confirmButtonText: "确定删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }
  try {
    const res = await api.delete(`/api/resignation/management/${id}`);
    if (res.data.success) {
      ElMessage.success("离职人员记录已删除");
      await Promise.all([
        resignationStore.fetchManagementList(
          resignationStatusFilter.value || undefined,
        ),
        resignationStore.fetchManagementCandidates(),
        pendingStore.refreshPendingCounts(),
      ]);
    } else {
      ElMessage.error(res.data.message || "删除失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "删除失败");
  }
};

// 格式化日期时间
const formatDateTime = (dateStr: string) => {
  if (!dateStr) return "-";

  const normalized = dateStr.replace(" ", "T");
  const localDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)
    ? new Date(normalized.length === 16 ? `${normalized}:00` : normalized)
    : new Date(dateStr);

  if (Number.isNaN(localDate.getTime())) {
    return dateStr;
  }

  return localDate.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

// 获取转正状态类型
const getProbationStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    pending: "info",
    submitted: "warning",
    approved: "success",
    rejected: "danger",
  };
  return typeMap[status] || "info";
};

// 获取转正状态文本
const getProbationStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    pending: "实习期",
    submitted: "待审批",
    approved: "已转正",
    rejected: "已驳回",
  };
  return textMap[status] || status;
};

const validatePdfUpload = (file: File) => {
  const isPdf = file.type === "application/pdf";
  const isLt10M = file.size / 1024 / 1024 < 10;

  if (!isPdf) {
    ElMessage.error("只支持 PDF 格式的文件");
    return false;
  }

  if (!isLt10M) {
    ElMessage.error("文件大小不能超过 10MB");
    return false;
  }

  return true;
};

// 上传转正模板
const handleUploadProbationTemplate = async (file: File) => {
  if (!validatePdfUpload(file)) return false;

  try {
    const res = await probationStore.uploadTemplate("转正申请表", file);
    if (res.success) {
      ElMessage.success("模板上传成功");
    } else {
      ElMessage.error(res.message || "上传失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "上传失败");
  }
  return false;
};

// 预览转正模板
const handlePreviewProbationTemplate = (row: ProbationTemplate) => {
  window.open(`/api/probation/templates/${row.id}/download`, "_blank");
};

// 删除转正模板
const handleDeleteProbationTemplate = (row: ProbationTemplate) => {
  ElMessageBox.confirm(`确定要删除模板「${row.name}」吗？`, "删除确认", {
    confirmButtonText: "确定删除",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(async () => {
      try {
        const res = await probationStore.deleteTemplate(row.id);
        if (res.success) {
          ElMessage.success("模板已删除");
        } else {
          ElMessage.error(res.message || "删除失败");
        }
      } catch (error: any) {
        ElMessage.error(error.response?.data?.message || "删除失败");
      }
    })
    .catch(() => {});
};

const handleResignationFilterChange = () => {
  resignationStore.fetchManagementList(
    resignationStatusFilter.value || undefined,
  );
};

const validateResignationTemplateUpload = (file: File) => {
  const fileName = file.name.toLowerCase();
  const isPdfMimeType = !file.type || file.type === "application/pdf";
  if (!fileName.endsWith(".pdf") || !isPdfMimeType) {
    ElMessage.error("离职模板只能上传 PDF 格式");
    return false;
  }
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.error("模板大小不能超过 20MB");
    return false;
  }
  return true;
};

const handleUploadResignationTemplate =
  (templateType: ResignationTemplateType) => async (file: File) => {
    if (!validateResignationTemplateUpload(file)) return false;

    try {
      const res = await resignationStore.uploadTemplate(
        templateType,
        RESIGNATION_TEMPLATE_LABELS[templateType],
        file,
      );
      if (res.success) {
        ElMessage.success("模板上传成功");
      } else {
        ElMessage.error(res.message || "上传失败");
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || "上传失败");
    }
    return false;
  };

const handlePreviewResignationTemplate = (row: ResignationTemplate) => {
  window.open(
    `/api/resignation/templates/${encodeURIComponent(row.id)}/preview`,
    "_blank",
    "noopener,noreferrer",
  );
};

const handleDownloadResignationTemplate = (row: ResignationTemplate) => {
  window.open(
    `/api/resignation/templates/${row.id}/download?download=1`,
    "_blank",
  );
};

const handleDeleteResignationTemplate = (row: ResignationTemplate) => {
  ElMessageBox.confirm(`确定要删除模板「${row.name}」吗？`, "删除确认", {
    confirmButtonText: "确定删除",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(async () => {
      try {
        const res = await resignationStore.deleteTemplate(row.id);
        if (res.success) {
          ElMessage.success("模板已删除");
        } else {
          ElMessage.error(res.message || "删除失败");
        }
      } catch (error: any) {
        ElMessage.error(error.response?.data?.message || "删除失败");
      }
    })
    .catch(() => {});
};

const getResignationStatusType = (status: string) => {
  const map: Record<string, any> = {
    draft: "info",
    pending_confirmation: "warning",
    submitted: "warning",
    handover_confirmed: "warning",
    handover_rejected: "danger",
    mutual_confirmed: "warning",
    approved: "success",
    rejected: "danger",
  };
  return map[status] || "info";
};

const getResignationStatusText = (status: string) => {
  const map: Record<string, string> = {
    draft: "档案待完善",
    pending_confirmation: "待确认离职",
    submitted: "待交接人处理",
    handover_confirmed: "待离职人确认",
    handover_rejected: "交接人待重新提交",
    mutual_confirmed: "待最终审批",
    approved: "已离职",
    rejected: "已驳回",
  };
  return map[status] || status;
};

const getResignationTypeText = (type: string) => {
  return (
    RESIGNATION_TYPE_TEXT_MAP[type as keyof typeof RESIGNATION_TYPE_TEXT_MAP] ||
    type
  );
};

const getAccountStatusText = (status: string | null | undefined) => {
  if (!status) return "无关联账号";
  return status === "active" ? "激活" : "停用";
};

const getAccountStatusType = (status: string | null | undefined) => {
  if (!status) return "info";
  return status === "active" ? "success" : "warning";
};

const handleViewResignationDetail = async (id: string) => {
  const res = await resignationStore.fetchDetail(id);
  if (res.success) {
    resignationDetailVisible.value = true;
  }
};

const handleManagementArchiveUpdated = async (
  detail: ResignationDetailData,
) => {
  resignationStore.detail = detail;
  await Promise.all([
    resignationStore.fetchManagementList(
      resignationStatusFilter.value || undefined,
    ),
    pendingStore.refreshPendingCounts(),
  ]);
};

const handleResignationArchiveCompleted = async () => {
  await Promise.all([
    resignationStore.fetchManagementList(
      resignationStatusFilter.value || undefined,
    ),
    fetchEmployeeList(),
    fetchStatistics(),
    pendingStore.refreshPendingCounts(),
  ]);
  if (currentEmployee.value) {
    await fetchEmployeeResignationArchive();
  }
};

// 员工类型
interface EmployeeProfile {
  id: string;
  user_id: string | null;
  employee_no: string | null;
  name: string;
  gender: string | null;
  birth_date: string | null;
  id_number: string | null;
  native_place: string | null;
  ethnicity: string | null;
  marital_status: string | null;
  education: string | null;
  school: string | null;
  major: string | null;
  mobile: string | null;
  email: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  address: string | null;
  hire_date: string | null;
  contract_end_date: string | null;
  contract_template_start_date: string | null;
  contract_template_end_date: string | null;
  probation_template_start_date: string | null;
  probation_template_end_date: string | null;
  department: string | null;
  position: string | null;
  bank_account_name: string | null;
  bank_account_phone: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  status: "draft" | "submitted";
  employment_status: "active" | "probation" | "resigned" | "on_leave" | null;
  effective_employment_status?:
    | "active"
    | "probation"
    | "resigned"
    | "on_leave";
  created_at: string;
  updated_at: string;
}

// 员工档案文件类型
interface EmployeeDocument {
  id: string;
  employee_id: string;
  document_type: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_recognized_at: string | null;
  probation_end_date: string | null;
  created_at: string;
}

interface EmployeeProbationArchive {
  employee: {
    id: string;
    name: string;
    hire_date: string | null;
    employment_status: string | null;
  };
  confirmation:
    | (ProbationConfirmation & { approver_name: string | null })
    | null;
  documents: ProbationDocument[];
  archive_mode: "workflow" | "direct" | "none";
  can_upload: boolean;
}

interface EmployeeResignationArchive {
  request: ResignationDetailData["request"] | null;
  documents: ResignationDetailData["documents"];
  fallback_from_employee_status?: boolean;
}

// 文档类型配置
const documentTypes = [
  { type: "invitation", label: "入职邀请函" },
  { type: "application", label: "新员工入职申请表" },
  { type: "contract", label: "劳动合同书" },
  { type: "nda", label: "保密协议" },
  { type: "declaration", label: "个人声明" },
  { type: "asset_handover", label: "2025年度公司电脑管理办法" },
  { type: "id_card", label: "身份证复印件" },
  { type: "health_report", label: "入职体检报告" },
  { type: "diploma", label: "学历证书复印件" },
  { type: "bank_card", label: "工资卡复印件（中国工商银行）" },
  { type: "other", label: "其他" },
];

const requiredDocumentTypes = documentTypes.filter(
  (item) => item.type !== "other",
);

const employeeDataTabs = new Set([
  "data",
  "onboarding",
  "probation",
  "resignation",
  "leave",
  "human-cost",
]);
const requestedTab = typeof route.query.tab === "string" ? route.query.tab : "";
const activeTab = ref(
  employeeDataTabs.has(requestedTab) ? requestedTab : "data",
);

// 详情对话框 Tab
const detailActiveTab = ref("info");

// 统计数据
const stats = reactive({
  total: 0,
  active: 0,
  probation: 0,
  resigned: 0,
  onLeave: 0,
});

// 筛选表单
const filterForm = reactive({
  keyword: "",
  department: "",
  employmentStatus: "",
});

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});

// 加载状态
const loading = ref(false);

// 员工列表
const employeeList = ref<EmployeeProfile[]>([]);

// 详情对话框
const detailDialogVisible = ref(false);
const isEditing = ref(false);
const editSaving = ref(false);
const editFormRef = ref<FormInstance>();
const currentEmployee = ref<EmployeeProfile | null>(null);

// 员工档案文件相关
const employeeDocuments = ref<EmployeeDocument[]>([]);
const documentsLoading = ref(false);
const autoDocumentUploadCount = ref(0);
const documentMutationPending = ref(false);
const deletingAllDocuments = ref(false);
const documentControlsDisabled = computed(() => {
  return documentMutationPending.value || autoDocumentUploadCount.value > 0;
});
const employeeResignationArchive = ref<EmployeeResignationArchive | null>(null);
const resignationArchiveLoading = ref(false);
const employeeProbationArchive = ref<EmployeeProbationArchive | null>(null);
const probationArchiveLoading = ref(false);
const probationArchiveMutationPending = ref(false);

let employeeProbationArchiveRequestId = 0;

const fetchEmployeeProbationArchive = async () => {
  const employeeId = currentEmployee.value?.id;
  if (!employeeId) return;

  const requestId = ++employeeProbationArchiveRequestId;
  probationArchiveLoading.value = true;
  try {
    const res = await api.get(`/api/probation/employee/${employeeId}/archive`);
    if (
      res.data.success &&
      requestId === employeeProbationArchiveRequestId &&
      currentEmployee.value?.id === employeeId
    ) {
      employeeProbationArchive.value = res.data.data;
    }
  } catch (error) {
    console.error("获取员工转正档案失败:", error);
    if (requestId === employeeProbationArchiveRequestId) {
      employeeProbationArchive.value = null;
    }
  } finally {
    if (requestId === employeeProbationArchiveRequestId) {
      probationArchiveLoading.value = false;
    }
  }
};

const handleUploadEmployeeProbationDocument = async (file: File) => {
  const employeeId = currentEmployee.value?.id;
  if (
    !employeeId ||
    probationArchiveMutationPending.value ||
    !validatePdfUpload(file)
  )
    return false;

  probationArchiveMutationPending.value = true;
  const formData = new FormData();
  formData.append("originalFileName", file.name);
  formData.append("file", file);

  try {
    const res = await api.post(
      `/api/probation/employee/${employeeId}/documents`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    if (res.data.success) {
      ElMessage.success(res.data.message || "正式盖章文件上传成功");
      await fetchEmployeeProbationArchive();
      refreshProbationManagement();
      await pendingStore.refreshPendingCounts();
    } else {
      ElMessage.error(res.data.message || "正式盖章文件上传失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "正式盖章文件上传失败");
  } finally {
    probationArchiveMutationPending.value = false;
  }

  return false;
};

const handlePreviewEmployeeProbationDocument = (
  document: ProbationDocument,
) => {
  const employeeId = currentEmployee.value?.id;
  if (!employeeId) return;
  window.open(
    `/api/probation/employee/${employeeId}/documents/${document.id}/download`,
    "_blank",
  );
};

const handleDownloadEmployeeProbationDocument = async (
  document: ProbationDocument,
) => {
  const employeeId = currentEmployee.value?.id;
  if (!employeeId) return;

  try {
    const res = await api.get(
      `/api/probation/employee/${employeeId}/documents/${document.id}/download`,
      {
        responseType: "blob",
      },
    );
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = window.document.createElement("a");
    link.href = url;
    link.setAttribute("download", document.file_name);
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    ElMessage.error("正式盖章文件下载失败");
  }
};

const handleDeleteEmployeeProbationDocument = async (
  document: ProbationDocument,
) => {
  const employeeId = currentEmployee.value?.id;
  if (
    !employeeId ||
    document.confirmation_id ||
    probationArchiveMutationPending.value
  )
    return;

  try {
    await ElMessageBox.confirm(
      `确定删除补录的转正申请表“${document.file_name}”吗？`,
      "删除转正申请表",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  probationArchiveMutationPending.value = true;
  try {
    const res = await api.delete(
      `/api/probation/employee/${employeeId}/documents/${document.id}`,
    );
    if (res.data.success) {
      ElMessage.success(res.data.message || "转正申请表已删除");
      await fetchEmployeeProbationArchive();
    } else {
      ElMessage.error(res.data.message || "删除失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "删除失败");
  } finally {
    probationArchiveMutationPending.value = false;
  }
};

// 获取员工离职档案
const fetchEmployeeResignationArchive = async () => {
  if (!currentEmployee.value) return;

  resignationArchiveLoading.value = true;
  try {
    const res = await api.get(
      `/api/employees/${currentEmployee.value.id}/resignation-archive`,
    );
    if (res.data.success) {
      employeeResignationArchive.value = res.data.data;
    }
  } catch (error) {
    console.error("获取员工离职档案失败:", error);
    employeeResignationArchive.value = null;
  } finally {
    resignationArchiveLoading.value = false;
  }
};

const handleEmployeeArchiveUpdated = async (detail: ResignationDetailData) => {
  employeeResignationArchive.value = {
    request: detail.request,
    documents: detail.documents,
  };
  resignationStore.detail = detail;
  await resignationStore.fetchManagementList(
    resignationStatusFilter.value || undefined,
  );
};

// 计算已完成的文档类型数量
const completedDocTypes = computed(() => {
  const uploadedTypes = new Set(
    employeeDocuments.value.map((doc) => doc.document_type),
  );
  return requiredDocumentTypes.filter((dt) => uploadedTypes.has(dt.type))
    .length;
});

// 计算档案完成度
const documentsProgress = computed(() => {
  return Math.round(
    (completedDocTypes.value / requiredDocumentTypes.length) * 100,
  );
});

// 根据类型获取文档
const getDocumentsByType = (type: string) => {
  const documents = employeeDocuments.value.filter(
    (doc) => doc.document_type === type,
  );
  if (type !== "contract") return documents;

  return [...documents].sort((left, right) => {
    const endDateCompare = (right.contract_end_date || "").localeCompare(
      left.contract_end_date || "",
    );
    return endDateCompare || right.created_at.localeCompare(left.created_at);
  });
};

const currentContractDocument = computed(() => {
  const contracts = getDocumentsByType("contract");
  if (contracts.length === 0) return null;

  const matchingCurrentContract = contracts.find(
    (doc) =>
      doc.contract_end_date &&
      doc.contract_end_date === currentEmployee.value?.contract_end_date,
  );
  return matchingCurrentContract || contracts[0];
});

const laborContractPeriodDisplay = computed(() => {
  if (documentsLoading.value) return "正在读取劳动合同...";
  if (
    currentContractDocument.value?.contract_start_date &&
    currentContractDocument.value.contract_end_date
  ) {
    return `${formatContractDate(currentContractDocument.value.contract_start_date)} 至 ${formatContractDate(currentContractDocument.value.contract_end_date)}`;
  }
  if (getDocumentsByType("contract").length > 0) return "合同期限未识别";
  return "暂无劳动合同";
});

const isCurrentContractDocument = (doc: EmployeeDocument) => {
  return getDocumentsByType("contract")[0]?.id === doc.id;
};

const getContractStatusText = (doc: EmployeeDocument) => {
  if (!doc.contract_start_date || !doc.contract_end_date) return "期限未识别";
  return isCurrentContractDocument(doc) ? "当前合同" : "历史合同";
};

const getContractStatusType = (doc: EmployeeDocument) => {
  if (!doc.contract_start_date || !doc.contract_end_date) return "warning";
  return isCurrentContractDocument(doc) ? "success" : "info";
};

const formatContractTerm = (doc: EmployeeDocument) => {
  if (!doc.contract_start_date || !doc.contract_end_date) return "期限未识别";
  return `${doc.contract_start_date} 至 ${doc.contract_end_date}`;
};

const applyCurrentContractEndDate = (contractEndDate: string | null) => {
  if (currentEmployee.value)
    currentEmployee.value.contract_end_date = contractEndDate;
  editFormData.contract_end_date = contractEndDate;
};

const applyCurrentHireDate = (hireDate: string | null) => {
  if (currentEmployee.value) currentEmployee.value.hire_date = hireDate;
  editFormData.hire_date = hireDate;
};

const applyContractTemplateLock = () => {
  const fields = [
    "contract_template_start_date",
    "contract_template_end_date",
    "probation_template_start_date",
    "probation_template_end_date",
  ] as const;
  for (const field of fields) {
    if (currentEmployee.value) currentEmployee.value[field] = null;
    editFormData[field] = null;
  }
  contractTemplatePeriod.value = null;
  probationTemplatePeriod.value = null;
};

// 格式化文件大小
const formatFileSize = (size: number | null) => {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

// 获取员工档案文件列表
let employeeDocumentsRequestId = 0;

const fetchEmployeeDocuments = async () => {
  const employeeId = currentEmployee.value?.id;
  if (!employeeId) return;

  const requestId = ++employeeDocumentsRequestId;
  documentsLoading.value = true;
  try {
    const res = await api.get(`/api/employees/${employeeId}/documents`);
    if (
      res.data.success &&
      requestId === employeeDocumentsRequestId &&
      currentEmployee.value?.id === employeeId
    ) {
      employeeDocuments.value = res.data.data;
    }
  } catch (error) {
    console.error("获取员工档案文件失败:", error);
  } finally {
    if (requestId === employeeDocumentsRequestId) {
      documentsLoading.value = false;
    }
  }
};

let autoDocumentUploadQueue: Promise<void> = Promise.resolve();

const uploadAutoClassifiedDocument = async (employeeId: string, file: File) => {
  const formData = new FormData();
  formData.append("originalFileName", file.name);
  formData.append("file", file);

  try {
    const res = await api.post(
      `/api/employees/${employeeId}/documents/auto-classify`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 600000,
      },
    );
    if (!res.data.success) {
      ElMessage.error(res.data.message || `文件「${file.name}」上传失败`);
      return;
    }

    const classifications = Array.isArray(res.data.classifications)
      ? res.data.classifications
      : [];
    const labels =
      classifications.map((item: { label: string }) => item.label).join("、") ||
      "人事档案文件";
    const details: string[] = [];
    if (res.data.salaryRecognition?.status === "success") {
      details.push(
        `月保障薪酬 ${res.data.salaryRecognition.monthlySalary} 元已同步到人力成本`,
      );
      window.dispatchEvent(
        new window.CustomEvent("employee-payroll-source-updated"),
      );
    }
    if (res.data.contractTemplateLocked) {
      applyContractTemplateLock();
      details.push("员工端劳动合同模板已锁定");
    }
    if (res.data.contractRecognition?.status === "success") {
      details.push(
        `合同期限 ${res.data.contractRecognition.contractStartDate} 至 ${res.data.contractRecognition.contractEndDate}`,
      );
      applyCurrentHireDate(
        res.data.currentHireDate ||
          res.data.contractRecognition.contractStartDate,
      );
      details.push(
        `入职日期 ${res.data.currentHireDate || res.data.contractRecognition.contractStartDate}`,
      );
      if (res.data.contractRecognition.probationEndDate) {
        details.push(
          `试用期截止 ${res.data.contractRecognition.probationEndDate}`,
        );
      } else {
        details.push("未设置试用期");
      }
      if (res.data.probationConfirmationSynced) {
        details.push("转正记录已同步");
      }
      applyCurrentContractEndDate(
        res.data.currentContractEndDate ||
          res.data.contractRecognition.contractEndDate,
      );
      window.dispatchEvent(
        new window.CustomEvent("employee-payroll-source-updated"),
      );
      refreshProbationManagement();
      await pendingStore.refreshPendingCounts();
      await fetchEmployeeList();
    }
    ElMessage.success(
      `文件「${file.name}」已拆分归档：${labels}${details.length > 0 ? `；${details.join("；")}` : ""}`,
    );

    if (res.data.salaryRecognition?.status === "failed") {
      ElMessage.warning(
        `入职邀请函已归档，但${res.data.salaryRecognition.message}，请在人力成本中填写本月工资`,
      );
    }
    if (res.data.contractRecognition?.status === "failed") {
      ElMessage.warning(
        `劳动合同已归档，但${res.data.contractRecognition.message}，合同到期时间未更新`,
      );
    }

    const otherSegments = Array.isArray(res.data.otherSegments)
      ? res.data.otherSegments
      : Array.isArray(res.data.unsupportedSegments)
        ? res.data.unsupportedSegments
        : [];
    if (otherSegments.length > 0) {
      const otherText = otherSegments
        .map(
          (segment: { label: string; pageNumbers: number[] }) =>
            `${segment.label}（第${segment.pageNumbers.join("、")}页）`,
        )
        .join("、");
      ElMessage.info(`以下资料已归档至“其他”：${otherText}`);
    }

    const missingTypes = Array.isArray(res.data.missingTypes)
      ? res.data.missingTypes
      : [];
    if (classifications.length > 1 && missingTypes.length > 0) {
      const missingLabels = missingTypes
        .map(
          (type: string) =>
            documentTypes.find((item) => item.type === type)?.label || type,
        )
        .join("、");
      ElMessage.warning(
        `本次合并文件未识别到：${missingLabels}；如文件中确实包含，请检查对应档案行`,
      );
    }
  } catch (error: any) {
    const message = error.response?.data?.message || "上传失败";
    if (error.response?.status === 422) {
      ElMessage.warning(`文件「${file.name}」：${message}`);
    } else {
      ElMessage.error(`文件「${file.name}」：${message}`);
    }
  }
};

const handleAutoUploadDoc = (file: File) => {
  const employeeId = currentEmployee.value?.id;
  if (!employeeId || documentMutationPending.value || !validatePdfUpload(file))
    return false;

  autoDocumentUploadCount.value += 1;
  autoDocumentUploadQueue = autoDocumentUploadQueue
    .then(() => uploadAutoClassifiedDocument(employeeId, file))
    .finally(async () => {
      autoDocumentUploadCount.value = Math.max(
        0,
        autoDocumentUploadCount.value - 1,
      );
      if (
        autoDocumentUploadCount.value === 0 &&
        currentEmployee.value?.id === employeeId
      ) {
        await fetchEmployeeDocuments();
      }
    });

  return false;
};

// 上传员工档案文件
const handleUploadDoc = async (documentType: string, file: File) => {
  if (!currentEmployee.value) return false;
  if (documentControlsDisabled.value) return false;
  if (!validatePdfUpload(file)) return false;

  documentMutationPending.value = true;
  const formData = new FormData();
  formData.append("document_type", documentType);
  formData.append("originalFileName", file.name);
  formData.append("file", file);

  try {
    const res = await api.post(
      `/api/employees/${currentEmployee.value.id}/documents`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout:
          documentType === "contract"
            ? 600000
            : documentType === "invitation"
              ? 240000
              : 30000,
      },
    );
    if (res.data.success) {
      if (res.data.contractTemplateLocked) {
        applyContractTemplateLock();
      }
      if (
        documentType === "invitation" &&
        res.data.salaryRecognition?.status === "success"
      ) {
        ElMessage.success(
          `入职邀请函上传成功，月保障薪酬 ${res.data.salaryRecognition.monthlySalary} 元已同步到人力成本`,
        );
        window.dispatchEvent(
          new window.CustomEvent("employee-payroll-source-updated"),
        );
      } else if (
        documentType === "invitation" &&
        res.data.salaryRecognition?.status === "failed"
      ) {
        ElMessage.warning(
          `入职邀请函已上传，但${res.data.salaryRecognition.message}，请在人力成本中填写本月工资`,
        );
      } else if (
        documentType === "contract" &&
        res.data.contractRecognition?.status === "success"
      ) {
        applyCurrentHireDate(
          res.data.currentHireDate ||
            res.data.contractRecognition.contractStartDate,
        );
        applyCurrentContractEndDate(
          res.data.currentContractEndDate ||
            res.data.contractRecognition.contractEndDate,
        );
        const probationText = res.data.contractRecognition.probationEndDate
          ? `，试用期截止 ${res.data.contractRecognition.probationEndDate}`
          : "，未设置试用期";
        const syncText = res.data.probationConfirmationSynced
          ? "，转正记录已同步"
          : "";
        ElMessage.success(
          `劳动合同已归档，入职日期 ${res.data.currentHireDate || res.data.contractRecognition.contractStartDate}，合同期限 ${res.data.contractRecognition.contractStartDate} 至 ${res.data.contractRecognition.contractEndDate}${probationText}${syncText}；员工端模板已锁定`,
        );
        window.dispatchEvent(
          new window.CustomEvent("employee-payroll-source-updated"),
        );
        refreshProbationManagement();
        await pendingStore.refreshPendingCounts();
        await fetchEmployeeList();
      } else if (
        documentType === "contract" &&
        res.data.contractRecognition?.status === "failed"
      ) {
        ElMessage.warning(
          `劳动合同已归档并锁定员工端模板，但${res.data.contractRecognition.message}，合同到期时间未更新`,
        );
      } else {
        ElMessage.success("文件上传成功");
      }
      await fetchEmployeeDocuments();
    } else {
      ElMessage.error(res.data.message || "上传失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "上传失败");
  } finally {
    documentMutationPending.value = false;
  }

  return false;
};

// 预览文档
const handlePreviewDoc = (doc: EmployeeDocument) => {
  if (!currentEmployee.value) return;
  window.open(
    `/api/employees/${currentEmployee.value.id}/documents/${doc.id}/download`,
    "_blank",
  );
};

// 下载文档
const handleDownloadDoc = async (doc: EmployeeDocument) => {
  if (!currentEmployee.value) return;

  try {
    const res = await api.get(
      `/api/employees/${currentEmployee.value.id}/documents/${doc.id}/download`,
      {
        responseType: "blob",
      },
    );
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", doc.file_name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error("下载失败");
  }
};

// 一键删除全部人事档案
const handleDeleteAllDocuments = async () => {
  const employee = currentEmployee.value;
  const documentCount = employeeDocuments.value.length;
  if (!employee || documentCount === 0 || documentControlsDisabled.value)
    return;

  try {
    await ElMessageBox.confirm(
      `确定删除「${employee.name}」的全部 ${documentCount} 份人事档案吗？删除后无法恢复，入职日期和合同到期时间将被清空；已生成的历史工资记录不会删除。`,
      "一键删除确认",
      {
        confirmButtonText: "全部删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  if (
    currentEmployee.value?.id !== employee.id ||
    documentControlsDisabled.value
  )
    return;

  deletingAllDocuments.value = true;
  documentMutationPending.value = true;
  try {
    const res = await api.delete(`/api/employees/${employee.id}/documents`);
    if (!res.data.success) {
      ElMessage.error(res.data.message || "一键删除失败");
      return;
    }

    employeeDocuments.value = [];
    applyCurrentHireDate(null);
    applyCurrentContractEndDate(null);
    if (res.data.payrollRecalculated) {
      window.dispatchEvent(
        new window.CustomEvent("employee-payroll-source-updated"),
      );
    }
    refreshProbationManagement();
    await pendingStore.refreshPendingCounts();
    await fetchEmployeeList();

    const cleanupFailedCount = Number(res.data.fileCleanupFailedCount) || 0;
    if (cleanupFailedCount > 0) {
      ElMessage.warning(
        `档案记录已全部删除，但有 ${cleanupFailedCount} 个存储文件未能清理`,
      );
    } else {
      ElMessage.success(res.data.message || "全部人事档案已删除");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "一键删除失败");
  } finally {
    documentMutationPending.value = false;
    deletingAllDocuments.value = false;
  }
};

// 删除文档
const handleDeleteDoc = (doc: EmployeeDocument) => {
  if (!currentEmployee.value || documentControlsDisabled.value) return;

  ElMessageBox.confirm(`确定要删除文件「${doc.file_name}」吗？`, "删除确认", {
    confirmButtonText: "确定删除",
    cancelButtonText: "取消",
    type: "warning",
  })
    .then(async () => {
      if (documentControlsDisabled.value) return;
      documentMutationPending.value = true;
      try {
        const res = await api.delete(
          `/api/employees/${currentEmployee.value!.id}/documents/${doc.id}`,
        );
        if (res.data.success) {
          ElMessage.success("文件已删除");
          if (doc.document_type === "contract") {
            applyCurrentHireDate(res.data.currentHireDate ?? null);
            applyCurrentContractEndDate(
              res.data.currentContractEndDate ?? null,
            );
            window.dispatchEvent(
              new window.CustomEvent("employee-payroll-source-updated"),
            );
            refreshProbationManagement();
            await pendingStore.refreshPendingCounts();
            await fetchEmployeeList();
          }
          await fetchEmployeeDocuments();
        } else {
          ElMessage.error(res.data.message || "删除失败");
        }
      } catch (error: any) {
        ElMessage.error(error.response?.data?.message || "删除失败");
      } finally {
        documentMutationPending.value = false;
      }
    })
    .catch(() => {});
};

// 监听详情对话框 Tab 切换，切换到档案 Tab 时加载文档
watch(detailActiveTab, (newTab) => {
  if (!currentEmployee.value) return;

  if (newTab === "documents") {
    fetchEmployeeDocuments();
  } else if (newTab === "probationArchive") {
    fetchEmployeeProbationArchive();
  } else if (newTab === "resignationArchive") {
    fetchEmployeeResignationArchive();
  }
});

const editFormData = reactive<Partial<EmployeeProfile>>({
  name: "",
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
  contract_template_start_date: null,
  contract_template_end_date: null,
  probation_template_start_date: null,
  probation_template_end_date: null,
  department: null,
  position: null,
  employee_no: null,
  status: "draft",
  employment_status: "active",
  bank_account_name: null,
  bank_account_phone: null,
  bank_name: null,
  bank_account_number: null,
});

const employeeDepartmentPositionMap = ref<Record<string, string[]>>({});
const employeeDepartments = computed(() =>
  Object.keys(employeeDepartmentPositionMap.value),
);
const employeePositionOptions = computed(() => {
  const department = editFormData.department || "";
  return employeeDepartmentPositionMap.value[department] || [];
});

const loadEmployeeDepartmentPositions = async () => {
  try {
    const res = await api.get("/api/departments/org-options");
    if (res.data.success) {
      employeeDepartmentPositionMap.value = res.data.data;
    }
  } catch (error) {
    console.error("加载部门职位配置失败:", error);
    employeeDepartmentPositionMap.value = {
      行政部: ["行政主管", "行政专员", "财务", "出纳"],
      项目部: ["项目经理", "员工"],
    };
  }
};

const handleEmployeeDepartmentChange = () => {
  editFormData.position = null;
  editFormRef.value?.clearValidate("position");
};

const editFormRules: FormRules = {
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  department: [
    { required: true, message: "请选择所属部门", trigger: "change" },
  ],
  position: [{ required: true, message: "请选择职位", trigger: "change" }],
};

const contractTemplatePeriod = ref<string[] | null>(null);
const probationTemplatePeriod = ref<string[] | null>(null);

watch(contractTemplatePeriod, (period) => {
  if (!period?.length) probationTemplatePeriod.value = null;
});

const populateContractTemplatePeriods = (employee: EmployeeProfile) => {
  contractTemplatePeriod.value =
    employee.contract_template_start_date && employee.contract_template_end_date
      ? [
          employee.contract_template_start_date,
          employee.contract_template_end_date,
        ]
      : null;
  probationTemplatePeriod.value =
    employee.probation_template_start_date &&
    employee.probation_template_end_date
      ? [
          employee.probation_template_start_date,
          employee.probation_template_end_date,
        ]
      : null;
};

// 获取员工列表
const fetchEmployeeList = async () => {
  loading.value = true;
  try {
    const res = await api.get("/api/employees/list", {
      params: {
        keyword: filterForm.keyword || undefined,
        department: filterForm.department || undefined,
        employmentStatus: filterForm.employmentStatus || undefined,
        status: "submitted", // 只显示已提交的员工
        page: pagination.page,
        pageSize: pagination.pageSize,
      },
    });
    if (res.data.success) {
      employeeList.value = res.data.data.list;
      pagination.total = res.data.data.total;
    }
  } catch (error) {
    console.error("获取员工列表失败:", error);
    ElMessage.error("获取员工列表失败");
  } finally {
    loading.value = false;
  }
};

// 获取员工统计数据
const fetchStatistics = async () => {
  try {
    const res = await api.get("/api/employees/statistics");
    if (res.data.success) {
      stats.total = res.data.data.total;
      stats.active = res.data.data.active;
      stats.probation = res.data.data.probation;
      stats.resigned = res.data.data.resigned;
      stats.onLeave = res.data.data.onLeave;
    }
  } catch (error) {
    console.error("获取员工统计失败:", error);
  }
};

// 上传文件
const handleUpload = async (fileTypeId: string, file: File) => {
  if (!validatePdfUpload(file)) return false;

  const res = await onboardingStore.uploadFile(fileTypeId, file);
  if (res.success) {
    ElMessage.success(
      `文件「${file.name}」上传成功，员工可在入职页面查看和下载`,
    );
  } else {
    ElMessage.error(res.message || "上传失败");
  }
  return false;
};

// 删除文件
const handleRemoveFile = (
  _fileTypeId: string,
  fileId: string,
  fileName: string,
) => {
  ElMessageBox.confirm(
    `确定要删除文件「${fileName}」吗？删除后员工将无法下载此文件。`,
    "删除确认",
    {
      confirmButtonText: "确定删除",
      cancelButtonText: "取消",
      type: "warning",
    },
  )
    .then(async () => {
      const res = await onboardingStore.removeFile(fileId);
      if (res.success) {
        ElMessage.success("文件已删除");
      } else {
        ElMessage.error(res.message || "删除失败");
      }
    })
    .catch(() => {
      // 取消删除
    });
};

// 预览入职文件模板
const handlePreviewTemplate = (file: { id: string; name: string }) => {
  window.open(
    `/api/employees/onboarding/templates/${file.id}/original`,
    "_blank",
  );
};

// 获取性别文本
const getGenderText = (gender: string | null) => {
  const textMap: Record<string, string> = {
    male: "男",
    female: "女",
  };
  return gender ? textMap[gender] || gender : "-";
};

// 获取在职状态类型
const getEmploymentStatusType = (status: string | null) => {
  const typeMap: Record<string, any> = {
    active: "success",
    probation: "warning",
    resigned: "info",
    on_leave: "primary",
  };
  return typeMap[status || "active"] || "success";
};

// 获取在职状态文本
const getEmploymentStatusText = (status: string | null) => {
  const textMap: Record<string, string> = {
    active: "在职",
    probation: "实习期",
    resigned: "已离职",
    on_leave: "休假中",
  };
  return textMap[status || "active"] || "在职";
};

const getDisplayedEmploymentStatus = (employee: EmployeeProfile) => {
  return employee.effective_employment_status || employee.employment_status;
};

// 判断合同是否需要标红（10天内到期 或 已过期，且未处理/未离职）
const isContractExpiring = (row: EmployeeProfile) => {
  return getContractExpiryReminder(row.contract_end_date, row.employment_status)
    .shouldRemind;
};

// 表格行样式：合同到期前10天标红
const getRowClassName = ({ row }: { row: EmployeeProfile }) => {
  if (isContractExpiring(row)) return "contract-expiring-row";
  return "";
};

// 导出数据
const handleExport = () => {
  ElMessage.info("导出员工数据功能开发中...");
};

// 查询
const handleSearch = () => {
  pagination.page = 1;
  fetchEmployeeList();
};

// 重置
const handleReset = () => {
  filterForm.keyword = "";
  filterForm.department = "";
  filterForm.employmentStatus = "";
  handleSearch();
};

// 查看详情
const handleView = (row: EmployeeProfile) => {
  currentEmployee.value = row;
  Object.assign(editFormData, row, {
    employment_status: getDisplayedEmploymentStatus(row),
  });
  populateContractTemplatePeriods(row);
  isEditing.value = false;
  detailActiveTab.value = "info";
  employeeDocuments.value = [];
  employeeProbationArchive.value = null;
  employeeResignationArchive.value = null;
  detailDialogVisible.value = true;
  void fetchEmployeeDocuments();
};

// 编辑
const handleEdit = async (row: EmployeeProfile) => {
  await loadEmployeeDepartmentPositions();
  currentEmployee.value = row;
  Object.assign(editFormData, row);
  populateContractTemplatePeriods(row);
  isEditing.value = true;
  detailActiveTab.value = "info";
  employeeDocuments.value = [];
  employeeProbationArchive.value = null;
  employeeResignationArchive.value = null;
  detailDialogVisible.value = true;
  void fetchEmployeeDocuments();
};

// 保存编辑
const handleSaveEdit = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) {
    ElMessage.warning("请填写必填项");
    return;
  }

  if (!currentEmployee.value) return;

  // 检测是否将员工状态改为实习期（需要重新走转正审批流程）
  const isResetToProbation =
    editFormData.employment_status === "probation" &&
    currentEmployee.value.employment_status !== "probation" &&
    currentEmployee.value.employment_status !== null;

  if (isResetToProbation) {
    try {
      await ElMessageBox.confirm(
        "将员工改为实习期后，原有的转正记录将被归档，该员工需要重新走一遍转正审批流程；试用期截止优先读取当前劳动合同，未识别合同试用期时才按入职日期兜底。\n\n确定要将该员工改为实习期吗？",
        "确认修改为实习期",
        {
          confirmButtonText: "确认修改",
          cancelButtonText: "取消",
          type: "warning",
          confirmButtonClass: "el-button--danger",
        },
      );
    } catch {
      return; // 用户取消
    }
  }

  editSaving.value = true;
  try {
    const payload = {
      ...editFormData,
      contract_template_start_date: contractTemplatePeriod.value?.[0] || null,
      contract_template_end_date: contractTemplatePeriod.value?.[1] || null,
      probation_template_start_date: probationTemplatePeriod.value?.[0] || null,
      probation_template_end_date: probationTemplatePeriod.value?.[1] || null,
    };
    const res = await api.put(
      `/api/employees/${currentEmployee.value.id}`,
      payload,
    );
    if (res.data.success) {
      ElMessage.success(res.data.message || "保存成功");
      detailDialogVisible.value = false;
      fetchEmployeeList();
      fetchStatistics();
    } else {
      ElMessage.error(res.data.message || "保存失败");
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "保存失败");
  } finally {
    editSaving.value = false;
  }
};

// 分页变化
const handleSizeChange = (size: number) => {
  pagination.pageSize = size;
  fetchEmployeeList();
};

const handlePageChange = (page: number) => {
  pagination.page = page;
  fetchEmployeeList();
};

// 组件挂载
onMounted(() => {
  loadEmployeeDepartmentPositions();
  fetchEmployeeList();
  fetchStatistics();
});

// 监听 Tab 切换，加载对应数据
watch(
  activeTab,
  (newTab) => {
    if (newTab === "onboarding") {
      onboardingStore.fetchTemplates();
    } else if (newTab === "probation") {
      probationStore.fetchTemplates();
      probationStore.fetchStatistics();
    } else if (newTab === "resignation") {
      resignationStore.fetchTemplates();
      resignationStore.fetchManagementList();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.tab-label-with-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.tab-label-with-badge :deep(.el-badge__content) {
  position: static;
  transform: none;
}

/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.employee-data-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px))
    calc(-1 * var(--yl-main-padding-x, 45px));
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

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.section-header h3 {
  margin: 0;
  line-height: 32px;
}

.filter-actions,
.resignation-template-upload-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.resignation-template-upload-actions {
  flex: 1 1 720px;
}

.resignation-template-upload-actions :deep(.el-upload) {
  display: block;
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

.probation-due-alert {
  margin-bottom: 12px;
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

.contract-period-display,
.readonly-field-display {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 5px 11px;
  color: var(--el-disabled-text-color, #a8abb2);
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: anywhere;
  background-color: var(--el-disabled-bg-color, #f5f7fa);
  border: 1px solid var(--el-disabled-border-color, #e4e7ed);
  border-radius: var(--el-input-border-radius, 4px);
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

.probation-archive-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.probation-archive-toolbar .section-title {
  padding: 0;
  margin: 0;
  border-bottom: 0;
}

.probation-archive-alert {
  margin-bottom: 16px;
}

.probation-archive-summary {
  margin-bottom: 24px;
}

.probation-archive-files .section-title {
  margin-bottom: 14px;
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

.documents-upload-action {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.auto-document-upload-button {
  min-width: 132px;
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

.contract-term {
  color: #606266;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
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
