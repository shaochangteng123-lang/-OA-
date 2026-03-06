<template>
  <div class="create-reimbursement-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
            <h2>新建基础报销单</h2>
          </div>
        </div>
      </template>

      <div class="content-wrapper">
        <div class="step-container">
          <el-form
            ref="formRef"
            :model="formData"
            label-width="120px"
            class="reimbursement-form"
          >
            <el-form-item label="报销月份">
              <el-input :value="getCurrentMonth()" disabled />
            </el-form-item>

            <!-- 两列布局：左侧发票，右侧无票 -->
            <div class="upload-layout">
              <div class="upload-left">
                <el-form-item label="发票上传" required>
                  <InvoiceUploader
                    v-model="invoice.fileList.value"
                    theme-color="#667eea"
                    @file-change="handleFileChange"
                    @delete-file="handleDeleteFile"
                  />
                </el-form-item>
              </div>

              <div class="upload-right">
                <el-form-item label="无票上传">
                  <ReceiptUploader
                    v-model="receiptFileList"
                    theme-color="#67c23a"
                    @file-change="handleReceiptChange"
                    @delete-file="handleDeleteReceipt"
                  />
                </el-form-item>
              </div>
            </div>

            <!-- 发票明细独立显示，不受两列布局限制 -->
            <el-form-item label="发票明细" class="invoice-detail-item">
              <InvoiceTable
                :invoice-list="invoice.invoiceList.value"
                :readonly="false"
                :show-deduction="true"
                :monthly-used-quota="invoice.monthlyUsedQuota.value"
                theme-color="#409eff"
                @delete="handleDeleteInvoice"
              />
            </el-form-item>

            <el-form-item label="详细说明">
              <el-input
                v-model="formData.description"
                type="textarea"
                :rows="4"
                placeholder="请详细说明报销内容（选填）"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
          </el-form>

          <div class="form-actions">
            <el-button @click="handleBack">取消</el-button>
            <el-button :loading="submitting" @click="handleSaveDraft">
              保存草稿
            </el-button>
            <el-button type="primary" :loading="submitting" @click="handleSubmit">
              提交审批
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import type { FormInstance } from 'element-plus'

// 导入报销相关组件
import InvoiceUploader from '@/components/reimbursement/InvoiceUploader.vue'
import ReceiptUploader from '@/components/reimbursement/ReceiptUploader.vue'
import InvoiceTable from '@/components/reimbursement/InvoiceTable.vue'

// 导入工具函数和常量
import { useInvoice } from '@/composables/reimbursement/useInvoice'
import { UPLOAD_CONFIG } from '@/utils/reimbursement/constants'
import { calculateReimbursementMonth, formatReimbursementMonth } from '@/utils/reimbursement/date'

const router = useRouter()

// 表单数据
const formData = reactive({
  description: '',
})

// 表单引用
const formRef = ref<FormInstance>()

// 提交状态
const submitting = ref(false)

// 创建发票管理实例
const invoice = useInvoice()

// 收据文件列表
const receiptFileList = ref<any[]>([])

// 获取当前月份（根据报销规则计算，基础报销使用特殊规则）
const getCurrentMonth = () => {
  const monthStr = calculateReimbursementMonth(undefined, 'basic')
  return formatReimbursementMonth(monthStr)
}

// 返回列表页
const handleBack = () => {
  if (invoice.invoiceList.value.length > 0) {
    ElMessageBox.confirm('确定要返回吗？未保存的内容将丢失', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => {
        router.push('/basic-reimbursement')
      })
      .catch(() => {})
  } else {
    router.push('/basic-reimbursement')
  }
}

// 处理文件变化
const handleFileChange = async (file: any, fileList: any[]) => {
  await invoice.handleFileChange(file, fileList)
  // 每次上传发票后,重新获取当月已使用额度
  await invoice.fetchMonthlyUsedQuota()
}

// 处理删除文件
const handleDeleteFile = (file: any) => {
  invoice.deleteInvoiceByFile(file.uid)
}

// 处理删除发票
const handleDeleteInvoice = (invoiceItem: any) => {
  invoice.deleteInvoiceById(invoiceItem.id)
}

// 处理收据变化
const handleReceiptChange = async (file: any, fileList: any[]) => {
  await invoice.handleReceiptChange(file, fileList)
  // 每次上传收据后,重新获取当月已使用额度
  await invoice.fetchMonthlyUsedQuota()
}

// 处理删除收据
const handleDeleteReceipt = (file: any) => {
  invoice.deleteInvoiceByFile(file.uid)
}

// 保存草稿
const handleSaveDraft = async () => {
  // 验证
  if (invoice.invoiceList.value.length === 0) {
    ElMessage.warning('请至少上传一张发票')
    return
  }

  try {
    submitting.value = true

    // 构建提交数据
    const submitData = {
      type: 'basic' as const,
      title: `${getCurrentMonth()} 基础报销`,
      description: formData.description,
      invoices: invoice.getInvoicesForSubmit(),
      status: 'draft', // 草稿状态
    }

    const response = await fetch('/api/reimbursement/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(submitData),
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('草稿保存成功')
      router.push('/basic-reimbursement')
    } else {
      ElMessage.error(result.message || '保存草稿失败')
    }
  } catch (error) {
    console.error('保存草稿失败:', error)
    ElMessage.error('保存草稿失败')
  } finally {
    submitting.value = false
  }
}

// 提交报销单
const handleSubmit = async () => {
  // 验证
  if (invoice.invoiceList.value.length === 0) {
    ElMessage.warning('请至少上传一张发票')
    return
  }

  try {
    submitting.value = true

    // 构建提交数据
    const submitData = {
      type: 'basic' as const,
      title: `${getCurrentMonth()} 基础报销`,
      description: formData.description,
      invoices: invoice.getInvoicesForSubmit(),
    }

    const response = await fetch('/api/reimbursement/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(submitData),
    })

    const result = await response.json()

    if (result.success) {
      ElMessage.success('提交成功')
      router.push('/basic-reimbursement')
    } else {
      ElMessage.error(result.message || '提交失败')
    }
  } catch (error) {
    console.error('提交失败:', error)
    ElMessage.error('提交失败')
  } finally {
    submitting.value = false
  }
}

// 页面加载时获取当月已使用额度
onMounted(async () => {
  await invoice.fetchMonthlyUsedQuota()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.create-reimbursement-container {
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
  box-shadow: none;
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

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-left h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
}

.step-container {
  width: 100%;
  max-width: 1400px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.reimbursement-form {
  width: 100%;
  max-width: 1100px;
}

/* 减少发票上传和发票明细之间的间距 */
.invoice-detail-item {
  margin-top: 8px;
}

/* 两列布局 */
.upload-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.upload-left {
  flex: 1;
  min-width: 0;
}

.upload-right {
  width: 450px;
  flex-shrink: 0;
}

/* 确保两侧的 form-item 样式一致 */
.upload-layout .el-form-item {
  margin-bottom: 0;
}

/* 确保两侧标签字体大小和对齐方式一致 */
.upload-layout :deep(.el-form-item__label) {
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
}

/* 确保内容区域对齐 */
.upload-layout :deep(.el-form-item__content) {
  line-height: 32px;
}

/* 确保两侧上传组件的提示信息区域高度一致 */
.upload-layout :deep(.upload-header) {
  min-height: 48px;
}

.form-actions {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e4e7ed;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
