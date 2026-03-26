<template>
  <div class="create-reimbursement-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
            <h2>新建商务报销单</h2>
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

            <el-form-item label="报销范围/区域" required>
              <el-cascader
                v-model="formData.reimbursementScope"
                :options="scopeOptions"
                :props="cascaderProps"
                placeholder="请选择报销范围/区域"
                style="width: 100%"
                clearable
              />
            </el-form-item>

            <el-form-item label="服务对象" required>
              <el-input
                v-model="formData.serviceTarget"
                placeholder="请输入服务对象"
                maxlength="100"
                show-word-limit
              />
            </el-form-item>

            <div class="upload-layout">
              <div class="upload-left">
                <el-form-item label="发票上传" required>
                  <InvoiceUploader
                    v-model="invoice.fileList.value"
                    theme-color="#67c23a"
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

            <el-form-item label="发票明细">
              <InvoiceTable
                :invoice-list="invoice.invoiceList.value"
                :readonly="false"
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
import { calculateReimbursementMonth, formatReimbursementMonth } from '@/utils/reimbursement/date'
import { api } from '@/utils/api'

const router = useRouter()

// 表单数据
const formData = reactive({
  reimbursementScope: [] as string[], // 报销范围/区域（级联选择器使用数组）
  serviceTarget: '', // 服务对象
  description: '',
})

// 表单引用
const formRef = ref<FormInstance>()

// 提交状态
const submitting = ref(false)

// 创建发票管理实例
const invoice = useInvoice()

// 无票上传文件列表
const receiptFileList = ref<any[]>([])

// 级联选择器配置
const scopeOptions = ref<any[]>([])
const cascaderProps = {
  value: 'value',
  label: 'name',
  children: 'children',
  checkStrictly: false, // 只能选择叶子节点
  emitPath: true, // 返回完整路径
}

// 加载报销范围选项
const loadScopeOptions = async () => {
  try {
    const response = await api.get('/api/reimbursement-scope/list')
    if (response.data.success) {
      scopeOptions.value = response.data.data
    }
  } catch (error) {
    console.error('加载报销范围失败:', error)
  }
}

// 获取当前月份（商务报销直接使用当月）
const getCurrentMonth = () => {
  const monthStr = calculateReimbursementMonth(undefined, 'business')
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
        router.back()
      })
      .catch(() => {})
  } else {
    router.back()
  }
}

// 处理文件变化
const handleFileChange = (file: any, fileList: any[]) => {
  invoice.handleFileChange(file, fileList)
}

// 处理删除文件
const handleDeleteFile = (file: any) => {
  invoice.deleteInvoiceByFile(file.uid)
}

// 处理删除发票
const handleDeleteInvoice = (invoiceItem: any) => {
  const receiptIndex = receiptFileList.value.findIndex(file => file.uid === invoiceItem.fileUid)
  if (receiptIndex > -1) {
    receiptFileList.value.splice(receiptIndex, 1)
  }
  invoice.deleteInvoiceById(invoiceItem.id)
}

// 处理无票上传变化
const handleReceiptChange = async (file: any, fileList: any[]) => {
  await invoice.handleReceiptChange(file, fileList)
  receiptFileList.value = fileList
}

// 处理删除无票文件
const handleDeleteReceipt = (file: any) => {
  const index = receiptFileList.value.findIndex(item => item.uid === file.uid)
  if (index > -1) {
    receiptFileList.value.splice(index, 1)
  }
  invoice.deleteInvoiceByFile(file.uid)
}

// 保存草稿
const handleSaveDraft = async () => {
  // 验证
  if (invoice.invoiceList.value.length === 0) {
    ElMessage.warning('请至少上传一张发票')
    return
  }

  if (!formData.reimbursementScope || formData.reimbursementScope.length === 0) {
    ElMessage.warning('请选择报销范围/区域')
    return
  }

  if (!formData.serviceTarget) {
    ElMessage.warning('请输入服务对象')
    return
  }

  try {
    submitting.value = true

    // 构建提交数据（将级联选择器的数组转为最后一个值）
    const submitData = {
      type: 'business' as const,
      title: `${getCurrentMonth()}-商务报销`,
      reimbursementScope: formData.reimbursementScope[formData.reimbursementScope.length - 1],
      serviceTarget: formData.serviceTarget,
      description: formData.description,
      invoices: invoice.getInvoicesForSubmit(),
      status: 'draft', // 草稿状态
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
      ElMessage.success('草稿保存成功')
      router.push({ path: '/business-reimbursement', query: { refresh: Date.now().toString() } })
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

  if (!formData.reimbursementScope || formData.reimbursementScope.length === 0) {
    ElMessage.warning('请选择报销范围/区域')
    return
  }

  if (!formData.serviceTarget) {
    ElMessage.warning('请输入服务对象')
    return
  }

  try {
    submitting.value = true

    // 构建提交数据（将级联选择器的数组转为最后一个值）
    const submitData = {
      type: 'business' as const,
      title: `${getCurrentMonth()}-商务报销`,
      reimbursementScope: formData.reimbursementScope[formData.reimbursementScope.length - 1],
      serviceTarget: formData.serviceTarget,
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
      router.push({ path: '/business-reimbursement', query: { refresh: Date.now().toString() } })
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

// 组件挂载时加载报销范围选项
onMounted(() => {
  loadScopeOptions()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.create-reimbursement-container {
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
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.reimbursement-form {
  width: 100%;
  max-width: min(1100px, 100%);
}

.reimbursement-form :deep(.el-form-item__content) {
  width: 100%;
}

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
  width: min(450px, 100%);
  min-width: 300px;
  flex-shrink: 0;
}

@media (max-width: 1366px) {
  .upload-layout {
    flex-direction: column;
  }
  .upload-right {
    width: 100%;
    min-width: unset;
  }
}

.upload-layout .el-form-item {
  margin-bottom: 0;
}

.upload-layout :deep(.el-form-item__label) {
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
}

.upload-layout :deep(.el-form-item__content) {
  line-height: 32px;
}

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
