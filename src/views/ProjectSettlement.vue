<template>
  <div class="settlement-container">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">项目结算</h1>
        <p class="page-subtitle">管理项目结算信息</p>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :inline="true">
        <el-form-item label="搜索">
          <el-input
            v-model="searchText"
            placeholder="项目名称"
            clearable
            style="width: 240px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="结算状态">
          <el-select
            v-model="filterStatus"
            placeholder="全部状态"
            clearable
            style="width: 150px"
          >
            <el-option label="未结算" value="pending" />
            <el-option label="部分结算" value="partial" />
            <el-option label="已结算" value="settled" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        v-loading="loading"
        :data="filteredProjects"
        stripe
      >
        <el-table-column prop="name" label="项目名称" min-width="200" />
        <el-table-column prop="district" label="区域" width="100" />
        <el-table-column prop="projectType" label="项目类型" width="120" />
        <el-table-column label="合同金额" width="140">
          <template #default="{ row }">
            <span v-if="row.contractAmount">¥{{ formatAmount(row.contractAmount) }}</span>
            <span v-else class="text-muted">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="已结算金额" width="140">
          <template #default="{ row }">
            <span :class="{ 'text-success': row.settledAmount > 0 }">
              ¥{{ formatAmount(row.settledAmount || 0) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="结算进度" width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="getSettlementPercentage(row)"
              :status="getProgressStatus(row)"
              :stroke-width="8"
            />
          </template>
        </el-table-column>
        <el-table-column label="结算状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row)" size="small">
              {{ getStatusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="150">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleSettlement(row)">
              结算
            </el-button>
            <el-button type="info" size="small" link @click="handleViewDetail(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 结算对话框 -->
    <el-dialog
      v-model="settlementDialogVisible"
      title="项目结算"
      width="500px"
      @close="handleDialogClose"
    >
      <div class="settlement-info" v-if="currentProject">
        <p><strong>项目名称：</strong>{{ currentProject.name }}</p>
        <p><strong>合同金额：</strong>¥{{ formatAmount(currentProject.contractAmount || 0) }}</p>
        <p><strong>已结算金额：</strong>¥{{ formatAmount(currentProject.settledAmount || 0) }}</p>
        <p><strong>待结算金额：</strong>¥{{ formatAmount((currentProject.contractAmount || 0) - (currentProject.settledAmount || 0)) }}</p>
      </div>
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="本次结算" prop="amount">
          <el-input-number
            v-model="formData.amount"
            :min="0"
            :precision="2"
            :controls="false"
            style="width: 100%"
            placeholder="请输入结算金额"
          />
        </el-form-item>
        <el-form-item label="结算日期" prop="date">
          <el-date-picker
            v-model="formData.date"
            type="date"
            placeholder="选择日期"
            style="width: 100%"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="formData.remark"
            type="textarea"
            :rows="3"
            placeholder="请输入备注（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settlementDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="结算记录"
      width="700px"
    >
      <div class="detail-header" v-if="currentProject">
        <p><strong>项目名称：</strong>{{ currentProject.name }}</p>
        <p><strong>合同金额：</strong>¥{{ formatAmount(currentProject.contractAmount || 0) }}</p>
        <p><strong>已结算总额：</strong>¥{{ formatAmount(currentProject.settledAmount || 0) }}</p>
      </div>
      <el-table :data="settlementRecords" stripe>
        <el-table-column label="序号" type="index" width="60" />
        <el-table-column prop="date" label="结算日期" width="120" />
        <el-table-column label="结算金额" width="140">
          <template #default="{ row }">
            ¥{{ formatAmount(row.amount) }}
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
      </el-table>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'

interface Project {
  id: string
  name: string
  district: string
  projectType: string
  contractAmount?: number
  settledAmount?: number
}

interface SettlementRecord {
  id: string
  projectId: string
  amount: number
  date: string
  remark?: string
  createdAt: string
}

// 数据
const projects = ref<Project[]>([])
const loading = ref(false)
const searchText = ref('')
const filterStatus = ref('')

// 结算对话框
const settlementDialogVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const currentProject = ref<Project | null>(null)
const formData = ref({
  amount: 0,
  date: '',
  remark: '',
})

// 详情对话框
const detailDialogVisible = ref(false)
const settlementRecords = ref<SettlementRecord[]>([])

// 表单验证规则
const formRules: FormRules = {
  amount: [
    { required: true, message: '请输入结算金额', trigger: 'blur' },
    { type: 'number', min: 0.01, message: '金额必须大于0', trigger: 'blur' },
  ],
  date: [{ required: true, message: '请选择结算日期', trigger: 'change' }],
}

// 过滤后的项目列表
const filteredProjects = computed(() => {
  return projects.value.filter((project) => {
    const matchSearch = !searchText.value || project.name.includes(searchText.value)

    if (!filterStatus.value) return matchSearch

    const percentage = getSettlementPercentage(project)
    if (filterStatus.value === 'pending') {
      return matchSearch && percentage === 0
    } else if (filterStatus.value === 'partial') {
      return matchSearch && percentage > 0 && percentage < 100
    } else if (filterStatus.value === 'settled') {
      return matchSearch && percentage >= 100
    }

    return matchSearch
  })
})

// 加载项目列表
async function loadProjects() {
  try {
    loading.value = true
    const response = await api.get('/api/projects')
    if (response.data.success) {
      // 暂时使用模拟的结算数据
      projects.value = (response.data.data || []).map((p: Project) => ({
        ...p,
        contractAmount: p.contractAmount || Math.floor(Math.random() * 1000000) + 100000,
        settledAmount: p.settledAmount || 0,
      }))
    }
  } catch (error) {
    console.error('加载项目列表失败:', error)
    ElMessage.error('加载项目列表失败')
  } finally {
    loading.value = false
  }
}

// 格式化金额
function formatAmount(amount: number): string {
  return amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 获取结算百分比
function getSettlementPercentage(project: Project): number {
  if (!project.contractAmount || project.contractAmount === 0) return 0
  const percentage = ((project.settledAmount || 0) / project.contractAmount) * 100
  return Math.min(Math.round(percentage), 100)
}

// 获取进度条状态
function getProgressStatus(project: Project): '' | 'success' | 'warning' | 'exception' {
  const percentage = getSettlementPercentage(project)
  if (percentage >= 100) return 'success'
  if (percentage >= 50) return ''
  if (percentage > 0) return 'warning'
  return 'exception'
}

// 获取状态标签类型
function getStatusTagType(project: Project): 'info' | 'warning' | 'success' {
  const percentage = getSettlementPercentage(project)
  if (percentage >= 100) return 'success'
  if (percentage > 0) return 'warning'
  return 'info'
}

// 获取状态文本
function getStatusText(project: Project): string {
  const percentage = getSettlementPercentage(project)
  if (percentage >= 100) return '已结算'
  if (percentage > 0) return '部分结算'
  return '未结算'
}

// 打开结算对话框
function handleSettlement(project: Project) {
  currentProject.value = project
  formData.value = {
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    remark: '',
  }
  settlementDialogVisible.value = true
}

// 保存结算
async function handleSave() {
  if (!formRef.value || !currentProject.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    try {
      saving.value = true
      // TODO: 调用后端API保存结算记录
      // await api.post(`/api/projects/${currentProject.value.id}/settlements`, formData.value)

      // 临时本地更新
      const project = projects.value.find(p => p.id === currentProject.value?.id)
      if (project) {
        project.settledAmount = (project.settledAmount || 0) + formData.value.amount
      }

      ElMessage.success('结算成功')
      settlementDialogVisible.value = false
    } catch (error) {
      console.error('结算失败:', error)
      ElMessage.error('结算失败')
    } finally {
      saving.value = false
    }
  })
}

// 查看详情
function handleViewDetail(project: Project) {
  currentProject.value = project
  // TODO: 从后端加载结算记录
  settlementRecords.value = []
  detailDialogVisible.value = true
}

// 对话框关闭
function handleDialogClose() {
  formRef.value?.resetFields()
  currentProject.value = null
}

// 初始化
onMounted(() => {
  loadProjects()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.settlement-container {
  height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 0;
  display: flex;
  flex-direction: column;
}

.page-header {
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.page-subtitle {
  margin: 4px 0 0;
  font-size: 14px;
  color: #909399;
}

.filter-card {
  background: #fff;
  border-radius: 0;
  border-left: none;
  border-right: none;
}

.filter-card :deep(.el-card__body) {
  padding: 16px 24px;
}

.table-card {
  flex: 1;
  background: #fff;
  overflow: hidden;
  border-radius: 0;
  border: none;
}

.table-card :deep(.el-card__body) {
  height: 100%;
  padding: 0 24px 24px;
}

.table-card :deep(.el-card__body) {
  height: 100%;
  padding: 0;
}

.table-card :deep(.el-table) {
  height: 100%;
}

.text-muted {
  color: #999;
}

.text-success {
  color: #67c23a;
}

.settlement-info {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.settlement-info p {
  margin: 8px 0;
  color: #606266;
}

.settlement-info p:first-child {
  margin-top: 0;
}

.settlement-info p:last-child {
  margin-bottom: 0;
}

.detail-header {
  margin-bottom: 16px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.detail-header p {
  margin: 8px 0;
  color: #606266;
}

.detail-header p:first-child {
  margin-top: 0;
}

.detail-header p:last-child {
  margin-bottom: 0;
}
</style>
