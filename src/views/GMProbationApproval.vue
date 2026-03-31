<template>
  <div class="yl-page gm-probation-approval">
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <Stamp />
        </el-icon>
        <h1>审批中心</h1>
      </div>
    </div>

    <el-card>
      <el-table :data="probationList" border stripe empty-text="暂无转正申请">
        <el-table-column label="序号" width="60" align="center">
          <template #default="{ $index }">
            {{ $index + 1 }}
          </template>
        </el-table-column>
        <el-table-column label="申请人" min-width="100" align="center">
          <template #default="{ row }">
            <div class="applicant-cell">
              <el-avatar :size="32">
                <el-icon><User /></el-icon>
              </el-avatar>
              <span>{{ row.employee_name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="部门" min-width="100" align="center">
          <template #default="{ row }">
            {{ row.department || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="职位" min-width="100" align="center">
          <template #default="{ row }">
            {{ row.position || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="入职日期" min-width="110" align="center">
          <template #default="{ row }">
            {{ formatDate(row.hire_date) }}
          </template>
        </el-table-column>
        <el-table-column label="试用期截止" min-width="110" align="center">
          <template #default="{ row }">
            {{ formatDate(row.probation_end_date) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="getProbationStatusType(row.status)" size="small">
              {{ getProbationStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" min-width="130" align="center">
          <template #default="{ row }">
            {{ formatDate(row.submit_time) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button
                type="primary"
                size="small"
                :icon="View"
                @click="handleViewProbation(row)"
              >
                详情
              </el-button>
              <el-button
                type="success"
                size="small"
                :icon="Check"
                @click="handleApproveProbation(row)"
              >
                通过
              </el-button>
              <el-button
                type="danger"
                size="small"
                :icon="Close"
                @click="handleRejectProbation(row)"
              >
                驳回
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { User, Check, Close, View, Stamp } from '@element-plus/icons-vue'
import { api } from '@/utils/api'
import { usePendingStore } from '@/stores/pending'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const router = useRouter()
const pendingStore = usePendingStore()

const probationList = ref<any[]>([])

// 格式化日期
function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  const safeStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  return format(new Date(safeStr), 'yyyy-MM-dd HH:mm', { locale: zhCN })
}

// 获取转正状态类型
function getProbationStatusType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  const typeMap: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    submitted: 'info',
    approved: 'success',
    rejected: 'danger'
  }
  return typeMap[status] || 'info'
}

// 获取转正状态文本
function getProbationStatusText(status: string): string {
  const textMap: Record<string, string> = {
    pending: '待审批',
    submitted: '已提交',
    approved: '已通过',
    rejected: '已驳回'
  }
  return textMap[status] || status
}

// 获取转正审批列表
async function fetchProbationList() {
  try {
    const response = await api.get('/api/probation/list', {
      params: { status: 'pending' }
    })
    if (response.data.success) {
      probationList.value = response.data.data.list || []
    }
  } catch (error) {
    console.error('获取转正审批列表失败:', error)
    ElMessage.error('获取转正审批列表失败')
  }
}

// 查看转正详情
function handleViewProbation(row: any) {
  router.push(`/employee-data?id=${row.employee_id}&tab=probation`)
}

// 通过转正申请
async function handleApproveProbation(row: any) {
  try {
    await ElMessageBox.confirm('确定要通过该转正申请吗？', '确认通过', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'success'
    })

    const response = await api.post(`/api/probation/${row.id}/approve`, {
      comment: '同意转正'
    })

    if (response.data.success) {
      ElMessage.success('转正申请已通过')
      await pendingStore.refreshPendingCounts()
      fetchProbationList()
    } else {
      ElMessage.error(response.data.message || '操作失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('通过转正申请失败:', error)
      ElMessage.error(error.response?.data?.message || '操作失败')
    }
  }
}

// 驳回转正申请
async function handleRejectProbation(row: any) {
  try {
    const { value: comment } = await ElMessageBox.prompt('请填写驳回原因', '驳回转正申请', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请填写驳回原因',
      inputValidator: (value) => {
        if (!value || value.trim() === '') {
          return '请填写驳回原因'
        }
        return true
      }
    })

    const response = await api.post(`/api/probation/${row.id}/reject`, {
      comment: comment
    })

    if (response.data.success) {
      ElMessage.success('转正申请已驳回')
      await pendingStore.refreshPendingCounts()
      fetchProbationList()
    } else {
      ElMessage.error(response.data.message || '操作失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('驳回转正申请失败:', error)
      ElMessage.error(error.response?.data?.message || '操作失败')
    }
  }
}

onMounted(() => {
  fetchProbationList()
})
</script>

<style scoped>
.applicant-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.applicant-cell span {
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
  justify-content: center;
}
</style>
