<template>
  <div class="employee-data-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>员工数据</h2>
        </div>
      </template>

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
              >
                <el-table-column type="index" label="序号" width="80" align="center" />
                <el-table-column prop="name" label="姓名" width="100" />
                <el-table-column prop="gender" label="性别" width="80">
                  <template #default="{ row }">
                    {{ getGenderText(row.gender) }}
                  </template>
                </el-table-column>
                <el-table-column prop="department" label="部门" width="120">
                  <template #default="{ row }">
                    {{ row.department || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="position" label="职位" width="150">
                  <template #default="{ row }">
                    {{ row.position || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="mobile" label="联系电话" width="130">
                  <template #default="{ row }">
                    {{ row.mobile || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="email" label="邮箱" min-width="180">
                  <template #default="{ row }">
                    {{ row.email || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="hire_date" label="入职日期" width="120">
                  <template #default="{ row }">
                    {{ row.hire_date || '-' }}
                  </template>
                </el-table-column>
                <el-table-column prop="employment_status" label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag :type="getEmploymentStatusType(row.employment_status)">
                      {{ getEmploymentStatusText(row.employment_status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="150" fixed="right">
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
                  管理入职所需的文件模板，上传后所有员工可在「入职」页面查看和下载
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
                        {{ index + 1 }}. {{ child }}
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
                <el-table-column label="操作" width="120" align="center">
                  <template #default="{ row }">
                    <!-- 邀请函和个人入职材料无需上传 -->
                    <template v-if="row.id !== 'invitation' && row.id !== 'personal'">
                      <el-upload
                        :show-file-list="false"
                        :before-upload="(file: File) => handleUpload(row.id, file)"
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      >
                        <el-button type="primary" size="small" :icon="Upload">
                          上传
                        </el-button>
                      </el-upload>
                    </template>
                    <span v-else class="no-action">-</span>
                  </template>
                </el-table-column>
              </el-table>

            </div>
          </el-tab-pane>

          <!-- 转正管理 Tab -->
          <el-tab-pane label="转正管理" name="probation">
            <div class="tab-content">
              <!-- 转正文件模板管理 -->
              <div class="section-block">
                <div class="section-header">
                  <h3>转正申请表模板</h3>
                  <el-upload
                    :show-file-list="false"
                    :before-upload="handleUploadProbationTemplate"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  >
                    <el-button type="primary" size="small" :icon="Upload">
                      上传模板
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
                    上传转正申请表模板后，实习期员工可在「入职」页面下载并填写
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
                  <el-table-column label="操作" width="150" align="center">
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
              <div class="section-block" style="margin-top: 24px">
                <div class="section-header">
                  <h3>转正申请列表</h3>
                  <div class="filter-actions">
                    <el-select v-model="probationStatusFilter" placeholder="全部状态" clearable style="width: 120px" @change="handleProbationFilterChange">
                      <el-option label="待提交" value="pending" />
                      <el-option label="待审批" value="submitted" />
                      <el-option label="已通过" value="approved" />
                      <el-option label="已拒绝" value="rejected" />
                    </el-select>
                  </div>
                </div>
                <el-table :data="probationStore.confirmationList" style="width: 100%" border v-loading="probationStore.confirmationListLoading">
                  <el-table-column type="index" label="序号" width="70" align="center" />
                  <el-table-column prop="employee_name" label="员工姓名" width="100" />
                  <el-table-column prop="employee_department" label="部门" width="120">
                    <template #default="{ row }">
                      {{ row.employee_department || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="employee_position" label="职位" width="120">
                    <template #default="{ row }">
                      {{ row.employee_position || '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="hire_date" label="入职日期" width="120" />
                  <el-table-column prop="probation_end_date" label="试用期截止" width="120" />
                  <el-table-column label="转正申请表" width="150">
                    <template #default="{ row }">
                      <template v-if="row.documents && row.documents.length > 0">
                        <el-button link type="primary" size="small" @click="handleViewProbationDocs(row)">
                          查看文件 ({{ row.documents.length }})
                        </el-button>
                      </template>
                      <span v-else class="no-file">未上传</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="status" label="状态" width="100">
                    <template #default="{ row }">
                      <el-tag :type="getProbationStatusType(row.status)">
                        {{ getProbationStatusText(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="submit_time" label="提交时间" width="180">
                    <template #default="{ row }">
                      {{ row.submit_time ? formatDateTime(row.submit_time) : '-' }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="180" fixed="right">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleViewProbation(row)">
                        查看
                      </el-button>
                      <template v-if="row.status === 'submitted'">
                        <el-button link type="success" size="small" @click="handleApproveProbation(row)">
                          通过
                        </el-button>
                        <el-button link type="danger" size="small" @click="handleRejectProbation(row)">
                          拒绝
                        </el-button>
                      </template>
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
          <el-tab-pane label="离职管理" name="resignation">
            <div class="tab-content">
              <el-empty description="离职管理功能开发中..." />
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
              <el-table-column v-if="isEditing" label="操作" width="120" align="center">
                <template #default="{ row }">
                  <el-upload
                    :show-file-list="false"
                    :before-upload="(file: File) => handleUploadDoc(row.type, file)"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  >
                    <el-button type="primary" size="small" :icon="Upload">
                      上传
                    </el-button>
                  </el-upload>
                </template>
              </el-table-column>
            </el-table>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Search, Refresh, Download, Upload, Document, Delete, View } from '@element-plus/icons-vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useProbationStore, type ProbationConfirmationWithEmployee, type ProbationTemplate } from '@/stores/probation'
import { api } from '@/utils/api'

// 使用共享的 store
const onboardingStore = useOnboardingStore()
const probationStore = useProbationStore()

// 转正管理相关
const probationStatusFilter = ref('')

// 格式化日期时间
const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
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

// 上传转正模板
const handleUploadProbationTemplate = async (file: File) => {
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

// 查看转正申请
const handleViewProbation = async (row: ProbationConfirmationWithEmployee) => {
  try {
    const res = await probationStore.getConfirmationDetail(row.id)
    if (res.success) {
      const detail = res.data
      let docInfo = ''
      if (detail.documents && detail.documents.length > 0) {
        docInfo = `\n\n已上传文件：${detail.documents.map((d: any) => d.file_name).join(', ')}`
      }
      ElMessageBox.alert(
        `员工姓名：${detail.employee_name}\n` +
        `部门：${detail.employee_department || '-'}\n` +
        `职位：${detail.employee_position || '-'}\n` +
        `入职日期：${detail.hire_date}\n` +
        `试用期截止：${detail.probation_end_date}\n` +
        `状态：${getProbationStatusText(detail.status)}\n` +
        `提交时间：${detail.submit_time ? formatDateTime(detail.submit_time) : '-'}\n` +
        `审批意见：${detail.approver_comment || '-'}` +
        docInfo,
        '转正申请详情',
        {
          confirmButtonText: '关闭',
          dangerouslyUseHTMLString: false,
        }
      )
    }
  } catch (error) {
    ElMessage.error('获取详情失败')
  }
}

// 查看转正申请表文件
const handleViewProbationDocs = (row: ProbationConfirmationWithEmployee) => {
  if (!row.documents || row.documents.length === 0) {
    ElMessage.warning('暂无转正申请表文件')
    return
  }
  // 打开第一个文件进行预览
  window.open(`/api/probation/${row.id}/documents/${row.documents[0].id}/download`, '_blank')
}

// 审批通过
const handleApproveProbation = (row: ProbationConfirmationWithEmployee) => {
  ElMessageBox.prompt('请输入审批意见（可选）', '审批通过', {
    confirmButtonText: '确定通过',
    cancelButtonText: '取消',
    inputPlaceholder: '审批意见',
  }).then(async ({ value }) => {
    try {
      const res = await probationStore.approveConfirmation(row.id, value)
      if (res.success) {
        ElMessage.success('审批通过')
        fetchStatistics() // 刷新员工统计
      } else {
        ElMessage.error(res.message || '审批失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '审批失败')
    }
  }).catch(() => {})
}

// 拒绝申请
const handleRejectProbation = (row: ProbationConfirmationWithEmployee) => {
  ElMessageBox.prompt('请输入拒绝原因', '拒绝申请', {
    confirmButtonText: '确定拒绝',
    cancelButtonText: '取消',
    inputPlaceholder: '拒绝原因（必填）',
    inputValidator: (value) => {
      if (!value || !value.trim()) {
        return '请输入拒绝原因'
      }
      return true
    },
  }).then(async ({ value }) => {
    try {
      const res = await probationStore.rejectConfirmation(row.id, value)
      if (res.success) {
        ElMessage.success('已拒绝申请')
      } else {
        ElMessage.error(res.message || '操作失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '操作失败')
    }
  }).catch(() => {})
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
  if (newTab === 'documents' && currentEmployee.value) {
    fetchEmployeeDocuments()
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
  const res = await onboardingStore.uploadFile(fileTypeId, file)
  if (res.success) {
    ElMessage.success(`文件「${file.name}」上传成功，员工可在入职页面查看和下载`)
  } else {
    ElMessage.error(res.message || '上传失败')
  }
  return false
}

// 删除文件
const handleRemoveFile = (fileTypeId: string, fileId: string, fileName: string) => {
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

// 获取状态类型（入职信息提交状态）
const getStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    submitted: 'success',
    draft: 'info',
  }
  return typeMap[status] || 'info'
}

// 获取状态文本（入职信息提交状态）
const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    submitted: '已提交',
    draft: '草稿',
  }
  return textMap[status] || status
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
  detailDialogVisible.value = true
}

// 编辑
const handleEdit = (row: EmployeeProfile) => {
  currentEmployee.value = row
  Object.assign(editFormData, row)
  isEditing.value = true
  detailActiveTab.value = 'info'
  employeeDocuments.value = []
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

  editSaving.value = true
  try {
    const res = await api.put(`/api/employees/${currentEmployee.value.id}`, editFormData)
    if (res.data.success) {
      ElMessage.success('保存成功')
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
  }
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.employee-data-container {
  height: calc(100vh - 60px);
  margin: -24px;
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
</style>
