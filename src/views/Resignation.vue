<template>
  <div class="resignation-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>离职管理</h2>
          <el-button type="primary" :icon="Plus" @click="handleCreate">
            新建离职申请
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
                <el-option label="已驳回" value="rejected" />
                <el-option label="已离职" value="resigned" />
              </el-select>
            </el-form-item>
            <el-form-item label="离职类型">
              <el-select v-model="filterForm.resignType" placeholder="全部类型" clearable>
                <el-option label="主动离职" value="voluntary" />
                <el-option label="合同到期" value="contract_end" />
                <el-option label="辞退" value="dismissal" />
              </el-select>
            </el-form-item>
            <el-form-item label="离职日期">
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

        <!-- 离职列表 -->
        <el-table
          v-loading="loading"
          :data="resignationList"
          stripe
          style="width: 100%"
        >
          <el-table-column prop="id" label="申请编号" min-width="100" />
          <el-table-column prop="name" label="姓名" min-width="80" />
          <el-table-column prop="department" label="部门" min-width="100" />
          <el-table-column prop="position" label="职位" min-width="120" />
          <el-table-column prop="resignType" label="离职类型" min-width="80">
            <template #default="{ row }">
              <el-tag :type="getResignTypeColor(row.resignType)" size="small">
                {{ getResignTypeText(row.resignType) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="resignDate" label="离职日期" min-width="100" />
          <el-table-column prop="status" label="状态" min-width="80">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150">
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
                v-if="row.status === 'approved'"
                link
                type="warning"
                size="small"
                @click="handleHandover(row)"
              >
                办理交接
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
import { ElMessage } from 'element-plus'
import { Plus, Search, Refresh } from '@element-plus/icons-vue'

// 筛选表单
const filterForm = reactive({
  status: '',
  resignType: '',
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

// 离职列表
const resignationList = ref([
  {
    id: 'RS202601001',
    name: '周九',
    department: '技术部',
    position: '测试工程师',
    resignType: 'voluntary',
    resignDate: '2026-02-28',
    status: 'approved',
  },
  {
    id: 'RS202601002',
    name: '吴十',
    department: '市场部',
    position: '市场专员',
    resignType: 'contract_end',
    resignDate: '2026-03-15',
    status: 'pending',
  },
  {
    id: 'RS202601003',
    name: '郑十一',
    department: '财务部',
    position: '出纳',
    resignType: 'voluntary',
    resignDate: '2026-01-31',
    status: 'resigned',
  },
])

// 获取离职类型文本
const getResignTypeText = (type: string) => {
  const textMap: Record<string, string> = {
    voluntary: '主动离职',
    contract_end: '合同到期',
    dismissal: '辞退',
  }
  return textMap[type] || type
}

// 获取离职类型颜色
const getResignTypeColor = (type: string) => {
  const colorMap: Record<string, any> = {
    voluntary: 'info',
    contract_end: 'warning',
    dismissal: 'danger',
  }
  return colorMap[type] || ''
}

// 获取状态类型
const getStatusType = (status: string) => {
  const typeMap: Record<string, any> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    resigned: 'info',
  }
  return typeMap[status] || 'info'
}

// 获取状态文本
const getStatusText = (status: string) => {
  const textMap: Record<string, string> = {
    pending: '待审批',
    approved: '已批准',
    rejected: '已驳回',
    resigned: '已离职',
  }
  return textMap[status] || status
}

// 新建离职申请
const handleCreate = () => {
  ElMessage.info('新建离职申请功能开发中...')
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
  filterForm.resignType = ''
  filterForm.dateRange = null
  handleSearch()
}

// 查看详情
const handleView = (row: any) => {
  ElMessage.info(`查看离职申请：${row.id}`)
}

// 审批
const handleApprove = (row: any) => {
  ElMessage.info(`审批离职申请：${row.id}`)
}

// 办理交接
const handleHandover = (row: any) => {
  ElMessage.info(`办理交接：${row.name}`)
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
  pagination.total = resignationList.value.length
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.resignation-container {
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

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
