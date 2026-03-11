<template>
  <div class="onboarding-container">
    <el-card class="page-card">
      <template #header>
        <div class="card-header">
          <h2>入职管理</h2>
        </div>
      </template>

      <el-tabs v-model="activeTab" class="content-tabs">
        <!-- 员工基础信息 Tab -->
        <el-tab-pane label="员工基础信息" name="profile">
          <div class="profile-section">
            <el-alert
              v-if="profileData?.status === 'submitted'"
              type="success"
              :closable="false"
              show-icon
              style="margin-bottom: 20px"
            >
              <template #title>
                您的员工信息已提交，如需修改请联系管理员
              </template>
            </el-alert>

            <el-form
              ref="formRef"
              :model="formData"
              :rules="formRules"
              label-width="110px"
              class="profile-form"
              :disabled="profileData?.status === 'submitted'"
            >
              <!-- 基本信息 -->
              <div class="form-section">
                <div class="section-title">基本信息</div>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="姓名" prop="name">
                      <el-input v-model="formData.name" placeholder="请输入姓名" @blur="validateEmergencyContact" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="性别" prop="gender">
                      <el-select v-model="formData.gender" placeholder="请选择性别">
                        <el-option label="男" value="male" />
                        <el-option label="女" value="female" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="出生日期" prop="birthDate">
                      <el-date-picker
                        v-model="formData.birthDate"
                        type="date"
                        placeholder="请选择出生日期"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                      />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="身份证号" prop="idNumber">
                      <el-input v-model="formData.idNumber" placeholder="请输入身份证号" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="民族" prop="ethnicity">
                      <el-input v-model="formData.ethnicity" placeholder="请输入民族" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="籍贯" prop="nativePlace">
                      <el-input v-model="formData.nativePlace" placeholder="请输入籍贯" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="婚姻状况" prop="maritalStatus">
                      <el-select v-model="formData.maritalStatus" placeholder="请选择婚姻状况">
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
                      <el-input v-model="formData.mobile" placeholder="请输入手机号码" @blur="validateEmergencyPhone" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="电子邮箱" prop="email">
                      <el-input v-model="formData.email" placeholder="请输入电子邮箱" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="24">
                  <el-col :span="16">
                    <el-form-item label="现居住地址" prop="address">
                      <el-input v-model="formData.address" placeholder="请输入现居住地址" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>

              <!-- 紧急联系人 -->
              <div class="form-section">
                <div class="section-title">紧急联系人</div>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="紧急联系人" prop="emergencyContact">
                      <el-input v-model="formData.emergencyContact" placeholder="请输入紧急联系人姓名" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="联系人电话" prop="emergencyPhone">
                      <el-input v-model="formData.emergencyPhone" placeholder="请输入紧急联系人电话" />
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
                      <el-select v-model="formData.education" placeholder="请选择学历">
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
                      <el-input v-model="formData.school" placeholder="请输入毕业院校" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="所学专业" prop="major">
                      <el-input v-model="formData.major" placeholder="请输入所学专业" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>

              <!-- 工作信息 -->
              <div class="form-section">
                <div class="section-title">工作信息</div>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="员工编号" prop="employeeNo">
                      <el-input v-model="formData.employeeNo" placeholder="由系统自动生成" disabled />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="入职日期" prop="hireDate">
                      <el-date-picker
                        v-model="formData.hireDate"
                        type="date"
                        placeholder="请选择入职日期"
                        format="YYYY-MM-DD"
                        value-format="YYYY-MM-DD"
                      />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="所属部门" prop="department">
                      <el-select v-model="formData.department" placeholder="请选择部门" style="width: 100%" :disabled="profileData?.status === 'submitted'">
                        <el-option v-for="dept in DEPARTMENTS" :key="dept" :label="dept" :value="dept" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="职位" prop="position">
                      <el-select v-model="formData.position" placeholder="请先选择部门" :disabled="!formData.department || profileData?.status === 'submitted'" style="width: 100%">
                        <el-option v-for="pos in getPositionsByDepartment(formData.department)" :key="pos" :label="pos" :value="pos" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>

              <!-- 收款信息 -->
              <div class="form-section">
                <div class="section-title">收款信息</div>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="收款人姓名" prop="bankAccountName">
                      <el-input v-model="formData.bankAccountName" placeholder="请输入收款人姓名" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="收款人手机" prop="bankAccountPhone">
                      <el-input v-model="formData.bankAccountPhone" placeholder="请输入收款人手机号" />
                    </el-form-item>
                  </el-col>
                </el-row>
                <el-row :gutter="24">
                  <el-col :span="8">
                    <el-form-item label="开户行" prop="bankName">
                      <el-input v-model="formData.bankName" placeholder="中国工商银行" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="银行卡号" prop="bankAccountNumber">
                      <el-input v-model="formData.bankAccountNumber" placeholder="中国工商银行卡号" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </div>
            </el-form>

            <!-- 底部操作按钮 -->
            <div v-if="profileData?.status !== 'submitted'" class="form-actions">
              <el-button @click="handleReset">重置</el-button>
              <el-button type="info" :loading="saving" @click="handleSave">
                保存草稿
              </el-button>
              <el-button type="primary" :loading="submitting" @click="handleSubmit">
                提交
              </el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- 入职文件 Tab -->
        <el-tab-pane label="入职文件" name="files">
          <div class="content-wrapper">
            <!-- 入职文件清单 -->
            <div class="materials-section">
              <el-alert
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 20px"
              >
                <template #title>
                  以下是您的入职所需文件，请下载相关文件填写后上交
                </template>
              </el-alert>

              <el-table :data="onboardingStore.onboardingFiles" style="width: 100%" border>
                <el-table-column type="index" label="序号" width="70" align="center" />
                <el-table-column prop="name" label="文件类型" min-width="200">
                  <template #default="{ row }">
                    <div class="file-type-name">
                      <span class="name-text">{{ row.name }}</span>
                      <!-- 劳动合同显示员工编号 -->
                      <span v-if="row.id === 'contract' && formData.employeeNo" class="employee-no-badge">
                        编号：{{ formData.employeeNo }}
                      </span>
                    </div>
                    <div v-if="row.children && row.children.length > 0" class="file-children">
                      <div v-for="(child, index) in row.children" :key="index" class="child-item">
                        {{ index + 1 }}. {{ child }}
                      </div>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="文件" min-width="280">
                  <template #default="{ row }">
                    <!-- 有文件时显示文件列表 -->
                    <div v-if="row.files && row.files.length > 0" class="file-list">
                      <div v-for="file in row.files" :key="file.id" class="file-item">
                        <el-icon class="file-icon"><Document /></el-icon>
                        <span class="file-name">{{ file.name }}</span>
                        <el-button
                          link
                          type="primary"
                          size="small"
                          :icon="View"
                          @click="handlePreview(file)"
                        >
                          预览
                        </el-button>
                        <el-button
                          link
                          type="success"
                          size="small"
                          :icon="Download"
                          @click="handleDownload(file)"
                        >
                          下载
                        </el-button>
                      </div>
                    </div>
                    <!-- 无文件时显示提示 -->
                    <div v-else class="no-file-tip">
                      <el-icon class="waiting-icon"><Clock /></el-icon>
                      <span class="waiting-text">{{ row.id === 'personal' ? '请自行准备后上交' : row.id === 'invitation' ? '已发送邮箱无需上交' : '暂无文件，等待管理员上传' }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="查看原文件" min-width="280">
                  <template #default="{ row }">
                    <!-- 显示管理员为该员工上传的档案文件 -->
                    <div v-if="getMyDocumentsByType(row.id).length > 0" class="my-docs-list">
                      <div v-for="doc in getMyDocumentsByType(row.id)" :key="doc.id" class="my-doc-item">
                        <el-icon class="doc-icon"><Document /></el-icon>
                        <span class="doc-name">{{ doc.file_name }}</span>
                        <span class="doc-size">{{ formatFileSize(doc.file_size) }}</span>
                        <el-button
                          link
                          type="primary"
                          size="small"
                          @click="handlePreviewMyDoc(doc)"
                        >
                          查看
                        </el-button>
                        <el-button
                          link
                          type="success"
                          size="small"
                          @click="handleDownloadMyDoc(doc)"
                        >
                          下载
                        </el-button>
                      </div>
                    </div>
                    <div v-else class="no-doc-tip">
                      <span class="no-doc-text">暂无档案</span>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 文件预览对话框 -->
    <el-dialog
      v-model="previewDialogVisible"
      :title="previewFile?.name || '文件预览'"
      width="800px"
      destroy-on-close
    >
      <div class="preview-content">
        <div v-if="isImageFile(previewFile?.name)" class="image-preview">
          <img :src="previewFile?.url" :alt="previewFile?.name" />
        </div>
        <div v-else class="file-preview-tip">
          <el-icon :size="64" color="#909399"><Document /></el-icon>
          <p>{{ previewFile?.name }}</p>
          <p class="tip-text">该文件类型不支持在线预览，请下载后查看</p>
          <el-button type="primary" :icon="Download" @click="handleDownload(previewFile!)">
            下载文件
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Document, Download, View, Folder, Clock } from '@element-plus/icons-vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/utils/api'
import { DEPARTMENTS, getPositionsByDepartment } from '@/constants/department'

// 员工档案文件类型
interface MyDocument {
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

// 使用共享的 store
const onboardingStore = useOnboardingStore()
const authStore = useAuthStore()
const router = useRouter()

// Tab 切换
const activeTab = ref('profile')

// 表单引用
const formRef = ref<FormInstance>()

// 加载状态
const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)

// 员工信息数据（从服务器获取）
const profileData = ref<any>(null)

// 表单数据
const formData = reactive({
  name: '',
  gender: '',
  birthDate: '',
  idNumber: '',
  ethnicity: '',
  nativePlace: '',
  maritalStatus: '',
  mobile: '',
  email: '',
  address: '',
  emergencyContact: '',
  emergencyPhone: '',
  education: '',
  school: '',
  major: '',
  employeeNo: '',
  hireDate: '',
  department: '',
  position: '',
  bankAccountName: '',
  bankAccountPhone: '',
  bankName: '',
  bankAccountNumber: ''
})

// 表单验证规则
const formRules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
  birthDate: [{ required: true, message: '请选择出生日期', trigger: 'change' }],
  idNumber: [{ required: true, message: '请输入身份证号', trigger: 'blur' }],
  ethnicity: [{ required: true, message: '请输入民族', trigger: 'blur' }],
  nativePlace: [{ required: true, message: '请输入籍贯', trigger: 'blur' }],
  maritalStatus: [{ required: true, message: '请选择婚姻状况', trigger: 'change' }],
  mobile: [{ required: true, message: '请输入手机号码', trigger: 'blur' }],
  email: [{ required: true, message: '请输入电子邮箱', trigger: 'blur' }],
  address: [{ required: true, message: '请输入现居住地址', trigger: 'blur' }],
  emergencyContact: [
    { required: true, message: '请输入紧急联系人姓名', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && formData.name && value.trim() === formData.name.trim()) {
          callback(new Error('紧急联系人不可与本人一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  emergencyPhone: [
    { required: true, message: '请输入紧急联系人电话', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && formData.mobile && value.trim() === formData.mobile.trim()) {
          callback(new Error('紧急联系人电话不可与本人一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  education: [{ required: true, message: '请选择学历', trigger: 'change' }],
  school: [{ required: true, message: '请输入毕业院校', trigger: 'blur' }],
  major: [{ required: true, message: '请输入所学专业', trigger: 'blur' }],
  hireDate: [{ required: true, message: '请选择入职日期', trigger: 'change' }],
  bankAccountName: [{ required: true, message: '请输入收款人姓名', trigger: 'blur' }],
  bankAccountPhone: [{ required: true, message: '请输入收款人手机号', trigger: 'blur' }],
  bankName: [{ required: true, message: '请输入开户行', trigger: 'blur' }],
  bankAccountNumber: [{ required: true, message: '请输入银行卡号', trigger: 'blur' }]
}

// 当本人姓名变化时，重新验证紧急联系人姓名
const validateEmergencyContact = () => {
  if (formData.emergencyContact) {
    formRef.value?.validateField('emergencyContact')
  }
}

// 当本人手机号变化时，重新验证紧急联系人电话
const validateEmergencyPhone = () => {
  if (formData.emergencyPhone) {
    formRef.value?.validateField('emergencyPhone')
  }
}

// 部门变化时清空职位（填充数据时跳过）
const isPopulating = ref(false)
watch(() => formData.department, () => {
  if (isPopulating.value) return
  formData.position = ''
})

// 获取当前用户的员工信息
const fetchProfile = async () => {
  loading.value = true
  try {
    const res = await api.get('/api/employees/my-profile')
    if (res.data.success && res.data.data) {
      profileData.value = res.data.data
      // 填充表单数据（转换 snake_case 到 camelCase）
      isPopulating.value = true
      const data = res.data.data
      formData.name = data.name || ''
      formData.gender = data.gender || ''
      formData.birthDate = data.birth_date || ''
      formData.idNumber = data.id_number || ''
      formData.ethnicity = data.ethnicity || ''
      formData.nativePlace = data.native_place || ''
      formData.maritalStatus = data.marital_status || ''
      formData.mobile = data.mobile || ''
      formData.email = data.email || ''
      formData.address = data.address || ''
      formData.emergencyContact = data.emergency_contact || ''
      formData.emergencyPhone = data.emergency_phone || ''
      formData.education = data.education || ''
      formData.school = data.school || ''
      formData.major = data.major || ''
      formData.employeeNo = data.employee_no || ''
      formData.hireDate = data.hire_date || ''
      formData.department = data.department || ''
      formData.position = data.position || ''
      formData.bankAccountName = data.bank_account_name || ''
      formData.bankAccountPhone = data.bank_account_phone || ''
      formData.bankName = data.bank_name || ''
      formData.bankAccountNumber = data.bank_account_number || ''
      nextTick(() => {
        isPopulating.value = false
      })
    }
  } catch (error) {
    console.error('获取员工信息失败:', error)
  } finally {
    loading.value = false
  }
}

// 重置表单
const handleReset = () => {
  if (profileData.value) {
    // 重置为服务器数据
    isPopulating.value = true
    const data = profileData.value
    formData.name = data.name || ''
    formData.gender = data.gender || ''
    formData.birthDate = data.birth_date || ''
    formData.idNumber = data.id_number || ''
    formData.ethnicity = data.ethnicity || ''
    formData.nativePlace = data.native_place || ''
    formData.maritalStatus = data.marital_status || ''
    formData.mobile = data.mobile || ''
    formData.email = data.email || ''
    formData.address = data.address || ''
    formData.emergencyContact = data.emergency_contact || ''
    formData.emergencyPhone = data.emergency_phone || ''
    formData.education = data.education || ''
    formData.school = data.school || ''
    formData.major = data.major || ''
    formData.hireDate = data.hire_date || ''
    formData.department = data.department || ''
    formData.position = data.position || ''
    formData.bankAccountName = data.bank_account_name || ''
    formData.bankAccountPhone = data.bank_account_phone || ''
    formData.bankName = data.bank_name || ''
    formData.bankAccountNumber = data.bank_account_number || ''
    nextTick(() => {
      isPopulating.value = false
    })
  } else {
    formRef.value?.resetFields()
  }
}

// 保存草稿
const handleSave = async () => {
  saving.value = true
  try {
    const payload = {
      name: formData.name,
      gender: formData.gender || null,
      birth_date: formData.birthDate || null,
      id_number: formData.idNumber || null,
      ethnicity: formData.ethnicity || null,
      native_place: formData.nativePlace || null,
      marital_status: formData.maritalStatus || null,
      mobile: formData.mobile || null,
      email: formData.email || null,
      address: formData.address || null,
      emergency_contact: formData.emergencyContact || null,
      emergency_phone: formData.emergencyPhone || null,
      education: formData.education || null,
      school: formData.school || null,
      major: formData.major || null,
      hire_date: formData.hireDate || null,
      department: formData.department || null,
      position: formData.position || null,
      bank_account_name: formData.bankAccountName || null,
      bank_account_phone: formData.bankAccountPhone || null,
      bank_name: formData.bankName || null,
      bank_account_number: formData.bankAccountNumber || null
    }
    const res = await api.post('/api/employees/my-profile', payload)
    if (res.data.success) {
      ElMessage.success('保存成功')
      profileData.value = res.data.data
    } else {
      ElMessage.error(res.data.message || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 提交
const handleSubmit = async () => {
  // 先验证表单
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) {
    ElMessage.warning('请填写必填项')
    return
  }

  // 确认提交
  try {
    await ElMessageBox.confirm(
      '提交后将无法修改，确定要提交吗？',
      '确认提交',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  submitting.value = true
  try {
    // 先保存
    const payload = {
      name: formData.name,
      gender: formData.gender || null,
      birth_date: formData.birthDate || null,
      id_number: formData.idNumber || null,
      ethnicity: formData.ethnicity || null,
      native_place: formData.nativePlace || null,
      marital_status: formData.maritalStatus || null,
      mobile: formData.mobile || null,
      email: formData.email || null,
      address: formData.address || null,
      emergency_contact: formData.emergencyContact || null,
      emergency_phone: formData.emergencyPhone || null,
      education: formData.education || null,
      school: formData.school || null,
      major: formData.major || null,
      hire_date: formData.hireDate || null,
      department: formData.department || null,
      position: formData.position || null,
      bank_account_name: formData.bankAccountName || null,
      bank_account_phone: formData.bankAccountPhone || null,
      bank_name: formData.bankName || null,
      bank_account_number: formData.bankAccountNumber || null
    }
    await api.post('/api/employees/my-profile', payload)

    // 提交
    const res = await api.post('/api/employees/my-profile/submit')
    if (res.data.success) {
      ElMessage.success('提交成功')
      profileData.value = res.data.data
      // 更新 auth store 中的员工信息状态
      await authStore.fetchProfileStatus()
      // 跳转到首页
      router.push({ name: 'Home' })
    } else {
      ElMessage.error(res.data.message || '提交失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

// 预览对话框
const previewDialogVisible = ref(false)
const previewFile = ref<{ name: string; url: string } | null>(null)

// 判断是否为图片文件
const isImageFile = (filename?: string) => {
  if (!filename) return false
  const ext = filename.split('.').pop()?.toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '')
}

// 预览文件
const handlePreview = (file: { id: string; name: string; url: string }) => {
  // 直接在新窗口打开预览
  window.open(file.url, '_blank')
}

// 下载文件
const handleDownload = async (file: { id: string; name: string; url: string }) => {
  try {
    const res = await api.get(file.url, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', file.name)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    ElMessage.success(`下载成功：${file.name}`)
  } catch (error) {
    ElMessage.error('下载失败')
  }
}

// ==================== 用户档案文件相关 ====================

// 用户档案文件列表
const myDocuments = ref<MyDocument[]>([])
const myDocumentsLoading = ref(false)

// 文档类型映射（与入职文件类型对应）
const documentTypeMap: Record<string, string> = {
  invitation: 'invitation',
  application: 'application',
  contract: 'contract',
  nda: 'nda',
  declaration: 'declaration',
  asset_handover: 'asset',
  id_card: 'personal',
  health_report: 'personal',
  diploma: 'personal',
  bank_card: 'personal',
}

// 根据入职文件类型获取对应的档案文件
const getMyDocumentsByType = (fileTypeId: string) => {
  // 找出所有映射到该类型的文档类型
  const matchingDocTypes = Object.entries(documentTypeMap)
    .filter(([_, mappedType]) => mappedType === fileTypeId)
    .map(([docType]) => docType)

  return myDocuments.value.filter(doc => matchingDocTypes.includes(doc.document_type))
}

// 获取用户的档案文件
const fetchMyDocuments = async () => {
  myDocumentsLoading.value = true
  try {
    const res = await api.get('/api/employees/my-documents')
    if (res.data.success) {
      myDocuments.value = res.data.data
    }
  } catch (error) {
    console.error('获取档案文件失败:', error)
  } finally {
    myDocumentsLoading.value = false
  }
}

// 预览档案文件
const handlePreviewMyDoc = (doc: MyDocument) => {
  window.open(`/api/employees/my-documents/${doc.id}/download`, '_blank')
}

// 下载档案文件
const handleDownloadMyDoc = async (doc: MyDocument) => {
  try {
    const res = await api.get(`/api/employees/my-documents/${doc.id}/download`, {
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

// 格式化文件大小
const formatFileSize = (size: number | null) => {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

onMounted(() => {
  fetchProfile()
  fetchMyDocuments()
  // 加载入职文件模板
  onboardingStore.fetchTemplates()
})
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.onboarding-container {
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

.content-tabs {
  height: 100%;
}

.content-tabs :deep(.el-tabs__content) {
  height: calc(100% - 50px);
  overflow: auto;
}

/* 员工信息表单样式 */
.profile-section {
  padding: 0 20px;
}

/* 表单对齐样式 */
.profile-form {
  width: 100%;
}

.profile-form :deep(.el-form-item) {
  margin-bottom: 18px;
  margin-right: 0;
}

/* 让 label 左对齐，确保星号位置一致 */
.profile-form :deep(.el-form-item__label) {
  font-weight: 400;
  color: #606266;
  text-align: left;
  justify-content: flex-start;
}

/* 确保所有输入组件宽度填满容器 */
.profile-form :deep(.el-form-item__content) {
  flex: 1;
}

.profile-form :deep(.el-input),
.profile-form :deep(.el-select),
.profile-form :deep(.el-date-editor.el-input) {
  width: 100%;
}

.profile-form :deep(.el-select) {
  display: block;
}

.profile-form :deep(.el-date-editor.el-input) {
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

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid #e4e7ed;
  margin-top: 20px;
}

/* 入职文件样式 */
.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.materials-section {
  flex: 1;
}

.file-type-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name-text {
  font-weight: 500;
}

.employee-no-badge {
  display: inline-block;
  margin-left: 12px;
  padding: 2px 10px;
  font-size: 13px;
  font-weight: 500;
  color: #409eff;
  background-color: #ecf5ff;
  border: 1px solid #b3d8ff;
  border-radius: 4px;
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

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #f0f9eb;
  border-radius: 6px;
  border: 1px solid #e1f3d8;
}

.file-icon {
  color: #67c23a;
  font-size: 18px;
}

.file-name {
  flex: 1;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 无文件提示样式 */
.no-file-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background-color: #fdf6ec;
  border-radius: 6px;
  border: 1px solid #faecd8;
}

.waiting-icon {
  color: #e6a23c;
  font-size: 18px;
}

.waiting-text {
  color: #e6a23c;
  font-size: 13px;
}

/* 用户档案文件列表样式 */
.my-docs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.my-doc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #ecf5ff;
  border-radius: 6px;
  border: 1px solid #d9ecff;
}

.doc-icon {
  color: #409eff;
  font-size: 16px;
  flex-shrink: 0;
}

.doc-name {
  flex: 1;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-size {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

.no-doc-tip {
  padding: 12px 16px;
  text-align: center;
}

.no-doc-text {
  color: #909399;
  font-size: 13px;
}

.footer-section {
  margin-top: 24px;
  padding: 16px 20px;
  background-color: #f5f7fa;
  border-radius: 8px;
}

.file-count {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #606266;
  font-size: 14px;
}

/* 预览对话框样式 */
.preview-content {
  min-height: 300px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.image-preview {
  max-width: 100%;
  max-height: 500px;
  overflow: auto;
}

.image-preview img {
  max-width: 100%;
  height: auto;
}

.file-preview-tip {
  text-align: center;
  color: #909399;
}

.file-preview-tip p {
  margin: 16px 0;
  font-size: 16px;
  color: #303133;
}

.file-preview-tip .tip-text {
  font-size: 14px;
  color: #909399;
  margin-bottom: 20px;
}
</style>
