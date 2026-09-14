<template>
  <div class="create-reimbursement-container" :style="themeStyle">
    <el-card class="page-card">
      <div class="page-type-bar"></div>

      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
            <h2>新建{{ typeConfig.label }}单</h2>
            <span class="page-type-badge">{{ typeConfig.shortLabel }}</span>
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

            <el-form-item :label="scopeLabel" required>
              <el-cascader
                v-model="formData.reimbursementScope"
                :options="scopeOptions"
                :props="cascaderProps"
                :placeholder="`请选择${scopeLabel}`"
                style="width: 100%"
                clearable
              />
            </el-form-item>

            <div class="upload-layout">
              <div class="upload-left">
                <el-form-item label="发票上传" required>
                  <InvoiceUploader
                    v-model="invoice.fileList.value"
                    :theme-color="typeConfig.accentColor"
                    @file-change="handleFileChange"
                    @delete-file="handleDeleteFile"
                  />
                </el-form-item>
              </div>

              <div class="upload-right">
                <el-form-item label="无票上传">
                  <ReceiptUploader
                    v-model="receiptFileList"
                    :theme-color="typeConfig.accentColor"
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
                :total-invoice-amount="invoice.totalAmount.value"
                :theme-color="typeConfig.accentColor"
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
            <el-button class="submit-btn" :loading="submitting" @click="handleSubmit">
              {{ submitButtonText }}
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue'
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
import { useAuthStore } from '@/stores/auth'
import {
  getReimbursementTypeConfig,
  type ReimbursementType,
} from '@/utils/reimbursement/typeConfig'

const router = useRouter()
const authStore = useAuthStore()
const props = withDefaults(defineProps<{
  reimbursementType?: ReimbursementType
}>(), {
  reimbursementType: 'large',
})
const typeConfig = computed(() => getReimbursementTypeConfig(props.reimbursementType)!)
const isWelfareReimbursement = computed(() =>
  ['welfare_one', 'welfare_two'].includes(typeConfig.value.type),
)
const scopeLabel = computed(() => isWelfareReimbursement.value ? '福利分类' : '报销范围/区域')
const submitButtonText = computed(() =>
  authStore.user?.role === 'chairman' ? '提交报销' : '提交审批',
)
const themeStyle = computed(() => ({
  '--reimbursement-accent': typeConfig.value.accentColor,
  '--reimbursement-accent-hover': typeConfig.value.accentHoverColor,
  '--reimbursement-accent-active': typeConfig.value.accentActiveColor,
}))

// 表单数据
const formData = reactive({
  reimbursementScope: [] as string[], // 报销范围/区域（级联选择器使用数组）
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
    const response = await api.get(
      typeConfig.value.scopeListEndpoint || '/api/reimbursement-scope/list',
    )
    if (response.data.success) {
      const items = Array.isArray(response.data.data) ? response.data.data : []
      scopeOptions.value = isWelfareReimbursement.value
        ? items.map((item: Record<string, unknown>) => ({
            ...item,
            value: String(item.id || item.code || ''),
          }))
        : items
    }
  } catch (error) {
    console.error('加载报销范围失败:', error)
  }
}

// 获取当前月份（大额报销直接使用当月）
const getCurrentMonth = () => {
  const monthStr = calculateReimbursementMonth(undefined, typeConfig.value.type)
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
const handleFileChange = async (file: any, fileList: any[]) => {
  await invoice.handleFileChange(file, fileList)
}

// 处理无票上传变化
const handleReceiptChange = async (file: any, fileList: any[]) => {
  // 先更新文件列表（保留缩略图），再进行OCR识别
  // 若先调用 handleReceiptChange，识别失败时会调用 removeFromFileList 修改 fileList 引用，
  // 再用 receiptFileList.value = fileList 赋值会漏掉失败前已有的文件
  receiptFileList.value = fileList
  await invoice.handleReceiptChange(file, fileList)
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

  try {
    submitting.value = true

    // 构建提交数据（将级联选择器的数组转为最后一个值）
    const selectedScope = formData.reimbursementScope[formData.reimbursementScope.length - 1]
    const submitData = {
      type: typeConfig.value.type,
      title: `${getCurrentMonth()}-${typeConfig.value.label}`,
      reimbursementScope: formData.reimbursementScope[formData.reimbursementScope.length - 1],
      ...(isWelfareReimbursement.value ? { welfareCategoryId: selectedScope } : {}),
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
      ElMessage.success(result.message || '草稿保存成功')
      router.push({ path: typeConfig.value.listRoute, query: { refresh: Date.now().toString() } })
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

  try {
    submitting.value = true

    // 构建提交数据（将级联选择器的数组转为最后一个值）
    const selectedScope = formData.reimbursementScope[formData.reimbursementScope.length - 1]
    const submitData = {
      type: typeConfig.value.type,
      title: `${getCurrentMonth()}-${typeConfig.value.label}`,
      reimbursementScope: formData.reimbursementScope[formData.reimbursementScope.length - 1],
      ...(isWelfareReimbursement.value ? { welfareCategoryId: selectedScope } : {}),
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
      ElMessage.success(result.message || '提交成功')
      router.push({ path: typeConfig.value.listRoute, query: { refresh: Date.now().toString() } })
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

/* 顶部色条 */
.page-type-bar {
  height: 4px;
  width: 100%;
  flex-shrink: 0;
  background-color: var(--reimbursement-accent);
}

/* 类型 Badge */
.page-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
  background-color: var(--reimbursement-accent);
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
  width: 100%;
  gap: 20px;
  align-items: flex-start;
}

.upload-left {
  flex: 11;
  min-width: 0;
}

.upload-right {
  flex: 9;
  min-width: 0;
}

@media (max-width: 1366px) {
  .upload-layout {
    flex-direction: column;
  }

  .upload-left,
  .upload-right {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
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

.submit-btn {
  font-weight: 600;
  --el-button-bg-color: var(--reimbursement-accent);
  --el-button-border-color: var(--reimbursement-accent);
  --el-button-hover-bg-color: var(--reimbursement-accent-hover);
  --el-button-hover-border-color: var(--reimbursement-accent-hover);
  --el-button-active-bg-color: var(--reimbursement-accent-active);
  --el-button-active-border-color: var(--reimbursement-accent-active);
  --el-button-text-color: #fff;
}
</style>
