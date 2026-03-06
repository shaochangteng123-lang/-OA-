<template>
  <div class="leave-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>请假管理</h2>
          <el-button type="primary" :icon="Plus" @click="handleCreate">
            新建请假申请
          </el-button>
        </div>
      </template>

      <div class="content-wrapper">
        <!-- 筛选区域 -->
        <div class="filter-section">
          <el-form :inline="true" :model="filterForm" class="filter-form">
            <el-form-item label="状态">
              <el-select v-model="filterForm.status" placeholder="全部状态" clearable>
                <el-option label="待审批" value="pending" />
                <el-option label="已批准" value="approved" />
                <el-option label="已拒绝" value="rejected" />
                <el-option label="已取消" value="cancelled" />
              </el-select>
            </el-form-item>
            <el-form-item label="请假类型">
              <el-select v-model="filterForm.leaveType" placeholder="全部类型" clearable>
                <el-option label="年假" value="annual" />
                <el-option label="事假" value="personal" />
                <el-option label="病假" value="sick" />
                <el-option label="婚假" value="marriage" />
                <el-option label="产假" value="maternity" />
                <el-option label="陪产假" value="paternity" />
              </el-select>
            </el-form-item>
            <el-form-item label="请假日期">
              <el-date-picker
                v-model="filterForm.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="handleSearch">
                查询
              </el-button>
              <el-button :icon="Refresh" @click="handleReset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <!-- 请假列表 -->
        <el-table
          v-loading="loading"
          :data="leaveList"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="id" label="申请编号" width="120" />
          <el-table-column prop="applicant" label="申请人" width="100" />
          <el-table-column prop="department" label="部门" width="120" />
          <el-table-column prop="leaveType" label="请假类型" width="100">
            <template #default="{ row }">
              <el-tag :type="getLeaveTypeColor(row.leaveType)" size="small">
                {{ getLeaveTypeText(row.leaveType) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="startDate" label="开始日期" width="120" />
          <el-table-column prop="endDate" label="结束日期" width="120" />
          <el-table-column prop="days" label="请假天数" width="100">
            <template #default="{ row }">
              <span class="days-text">{{ row.days }} 天</span>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="请假事由" min-width="150" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleView(row)">
                查看
              </el-button>
              <el-button
                v-if="row.status === 'pending'"
                link
                type="success"
                size="small"
                @click="handleApprove(row)"
              >
                审批
              </el-button>
              <el-button
                v-if="row.status === 'pending'"
                link
                type="danger"
                size="small"
                @click="handleCancel(row)"
              >
                取消
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
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh } from '@element-plus/icons-vue'

// 筛选表单
const filterForm = reactive({
  status: '',
  leaveType: '',
  dateRange: null as [Date, Date] | null,
})

// 分页
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
})

// 加载状态
const loading = ref(false)

// 请假列表
const leaveList = ref([
  {
    id: 'LV202601001',
    applicant: '张三',
    department: '技术部',
    leaveType: 'annual',
    startDate: '2026-02-01',
    endDate: '2026-02-03',
    days: 3,
    reason: '回老家过年',
    status: 'approved',
  },
  {
    id: 'LV202601002',
    applicant: '李四',
    department: '市场部',
    leaveType: 'sick',
    startDate: '2026-01-25',
    endDate: '2026-01-26',
    days: 2,
    reason: '感冒发烧需要休息',
    status: 'pending',
  },
  {
    id: 'LV202601003',
    applicant: '王五',
    department: '财务部',
    leaveType: 'personal',
    startDate: '2026-01-28',
    endDate: '2026-01-28',
    days: 1,
    reason: '家中有事需要处理',
    status: 'pending',
  },
])

// 获取请假类型文本
const getLeaveTypeText = (type: string) => {
  const textMap: Record<string, string> = {
    annual: '年假',
    personal: '事假',
    sick: '病假',
    marriage: '婚假',
    maternity: '产假',
    paternity: '陪产假',
  }
  return textMap[type] || type
}

// 获取请假类型颜色
const getLeaveTypeColor = (type: string) => {
  const colorMap: Record<string, any> = {
    annual: 'success',
    personal: 'info',
    sick: 'warning',
    marriage: 'danger',
    maternity: 'primary',
    paternity: 'primary',
  }
  return colorMap[type] || ''
}

// 获取状态类型
const getStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    cancelled: 'info',
  }
  return typeMap[status] || 'info'
}

// 获取状态文本
const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    pending: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    cancelled: '已取消',
  }
  return textMap[status] || status
}

// 新建请假申请
const handleCreate = () => {
  ElMessage.info('新建请假申请功能开发中...')
}

// 查询
const handleSearch = () => {
  loading.value = true
  setTimeout(() => {
    loading.value = false
    ElMessage.success('查询完成')
  }, 500)
}

// 重置
const handleReset = () => {
  filterForm.status = ''
  filterForm.leaveType = ''
  filterForm.dateRange = null
  handleSearch()
}

// 查看详情
const handleView = (row: any) => {
  ElMessage.info(`查看请假申请：${row.id}`)
}

// 审批
const handleApprove = (row: any) => {
  ElMessage.info(`审批请假申请：${row.id}`)
}

// 取消
const handleCancel = (row: any) => {
  ElMessageBox.confirm('确定要取消这条请假申请吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(() => {
      ElMessage.success('已取消请假申请')
    })
    .catch(() => {
      ElMessage.info('操作已取消')
    })
}

// 分页变化
const handleSizeChange = (size: number) => {
  pagination.pageSize = size
  handleSearch()
}

const handlePageChange = (page: number) => {
  pagination.page = page
  handleSearch()
}

// 组件挂载
onMounted(() => {
  pagination.total = leaveList.value.length
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.leave-container {
  height: calc(100vh - 60px);
  margin: -24px -45px;
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
  overflow: auto;
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
  flex: 1;
  display: flex;
  flex-direction: column;
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

.days-text {
  color: #409eff;
  font-weight: 600;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
