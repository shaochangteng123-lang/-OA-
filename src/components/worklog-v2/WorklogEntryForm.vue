<template>
  <el-dialog
    :model-value="visible"
    :title="dialogTitle"
    width="1080px"
    top="1vh"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="isReadonly"
      label-width="110px"
      label-position="right"
    >
      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item :label="form.id ? '创建日期' : '日志日期'" prop="logDate">
            <el-date-picker
              v-model="form.logDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期（可补录历史）"
              style="width: 100%"
              :disabled="!!form.id"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="办理事项" prop="matter">
            <div class="matter-with-days">
              <el-select v-model="form.matter" placeholder="请选择" filterable :disabled="!!form.id" style="width: 100%">
                <el-option v-for="m in dicts.matters" :key="m.id" :label="m.name" :value="m.name" />
              </el-select>
              <el-tag v-if="selectedMatterStandardDays !== null" type="warning" size="small" effect="plain" class="matter-days-tag">
                {{ selectedMatterStandardDays }} 天
              </el-tag>
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="行政区" prop="district">
            <el-select v-model="form.district" placeholder="请选择" :disabled="!!form.id" style="width: 100%">
              <el-option v-for="d in dicts.districts" :key="d.id" :label="d.name" :value="d.name" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="项目名称" prop="projectName">
        <el-select
          v-model="form.projectName"
          filterable
          allow-create
          default-first-option
          reserve-keyword
          placeholder="输入项目名称，支持联想与新增"
          style="width: 100%"
          :remote="true"
          :remote-method="searchProjects"
          :loading="searchingProjects"
          :disabled="!!form.id"
          @change="handleProjectSelect"
          @focus="handleProjectFocus"
        >
          <el-option
            v-for="p in projectOptions"
            :key="p.id"
            :label="`${p.name}（${p.clientName}）`"
            :value="p.name"
          />
        </el-select>
        <el-button v-if="form.id" link type="primary" style="margin-left: 8px" @click="showProjectInfo = !showProjectInfo">
          {{ showProjectInfo ? '收起信息' : '查看项目信息' }}
        </el-button>
      </el-form-item>

      <!-- 编辑模式：点击展开项目基本信息（可编辑） -->
      <div v-if="form.id && showProjectInfo" class="project-info-panel">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="甲方单位">
              <el-input v-model="form.clientName" placeholder="甲方单位全称" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="甲方负责人">
              <el-input v-model="form.clientContactName" placeholder="甲方负责人姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="负责人电话">
              <el-input v-model="form.clientContactPhone" placeholder="联系方式" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="委办局">
              <el-input v-model="form.agencyBureau" placeholder="办理机构委办局" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="科室">
              <el-input v-model="form.agencyDepartment" placeholder="办理科室" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="经办人">
              <el-input v-model="form.agencyContactName" placeholder="经办人姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经办人电话">
              <el-input v-model="form.agencyContactPhone" placeholder="经办人电话" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="项目类型">
              <el-select v-model="form.projectType" placeholder="请选择" style="width: 100%">
                <el-option v-for="t in dicts.projectTypes" :key="t.id" :label="t.name" :value="t.name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="项目负责人">
              <el-select v-model="form.ownerUserId" placeholder="请选择" filterable style="width: 100%">
                <el-option
                  v-for="u in users"
                  :key="u.id"
                  :label="`${u.name}${u.position ? '（' + u.position + '）' : ''}`"
                  :value="u.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="合同付款">
              <el-select v-model="form.contractStatus" placeholder="请选择（选填）" clearable style="width: 100%">
                <el-option v-for="c in dicts.contractStatuses" :key="c.id" :label="c.name" :value="c.name" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="付款备注">
          <el-input v-model="form.contractNote" placeholder="合同或付款详情（选填）" />
        </el-form-item>
        <div style="text-align: right">
          <el-button type="primary" size="small" :loading="savingProject" @click="handleSaveProjectInfo">保存项目信息</el-button>
        </div>
      </div>

      <!-- 新建模式：显示项目基本信息表单 -->
      <template v-if="!form.id">
      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="甲方单位" prop="clientName">
            <el-input v-model="form.clientName" placeholder="请输入甲方单位全称" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="甲方负责人" prop="clientContactName">
            <el-input v-model="form.clientContactName" placeholder="请输入甲方单位项目负责人姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="负责人电话" prop="clientContactPhone">
            <el-input v-model="form.clientContactPhone" placeholder="请输入联系方式" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="委办局" prop="agencyBureau">
            <el-input v-model="form.agencyBureau" placeholder="请输入办理机构委办局" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="科室" prop="agencyDepartment">
            <el-input v-model="form.agencyDepartment" placeholder="请输入办理科室" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="经办人" prop="agencyContactName">
            <el-input v-model="form.agencyContactName" placeholder="请输入经办人姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="经办人电话" prop="agencyContactPhone">
            <el-input v-model="form.agencyContactPhone" placeholder="请输入经办人电话" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="项目类型" prop="projectType">
            <el-select v-model="form.projectType" placeholder="请选择" style="width: 100%">
              <el-option v-for="t in dicts.projectTypes" :key="t.id" :label="t.name" :value="t.name" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="项目负责人" prop="ownerUserId">
            <el-select v-model="form.ownerUserId" placeholder="请选择" filterable style="width: 100%">
              <el-option
                v-for="u in users"
                :key="u.id"
                :label="`${u.name}${u.position ? '（' + u.position + '）' : ''}`"
                :value="u.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="合同付款">
            <el-select v-model="form.contractStatus" placeholder="请选择（选填）" clearable style="width: 100%">
              <el-option v-for="c in dicts.contractStatuses" :key="c.id" :label="c.name" :value="c.name" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="付款备注">
        <el-input v-model="form.contractNote" placeholder="合同或付款详情（选填）" />
      </el-form-item>
      </template>

      <!-- 新建模式：下次跟进时间在基本信息下方 -->
      <el-form-item v-if="!form.id" label="下次跟进时间" prop="nextFollowUpDate">
        <el-date-picker
          v-model="form.nextFollowUpDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择预计下次跟进沟通日期"
          style="width: 100%"
          :disabled-date="(date: Date) => date.getTime() < Date.now() - 86400000"
        />
      </el-form-item>

      <!-- 新建时：项目备注 + 附件上传 -->
      <template v-if="!form.id">
        <el-form-item label="项目备注">
          <el-input
            v-model="form.workNote"
            type="textarea"
            :rows="3"
            placeholder="输入项目备注信息…"
            :disabled="isReadonly"
          />
        </el-form-item>

        <el-form-item v-if="!isReadonly" label="图片附件">
          <div class="image-uploads-row">
            <div class="image-upload-col">
              <div class="upload-col-label">沟通记录截图</div>
              <WorklogAttachments
                ref="screenshotRef"
                v-model="progressScreenshots"
                :entry-id="null"
                kind="screenshot"
                :disabled="false"
              />
            </div>
            <div class="image-upload-col">
              <div class="upload-col-label">项目现场照片</div>
              <WorklogAttachments
                ref="photoRef"
                v-model="progressPhotos"
                :entry-id="null"
                kind="photo"
                :disabled="false"
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item v-if="!isReadonly" label="文档附件">
          <WorklogAttachments
            ref="documentRef"
            v-model="progressDocs"
            :entry-id="null"
            kind="document"
            :disabled="false"
          />
        </el-form-item>
      </template>

      <!-- 编辑时：项目进展（时间线追加） + 附件上传 -->
      <template v-else>
        <el-form-item label="项目进展">
          <div class="progress-timeline" style="width: 100%">
            <div v-if="progressNotes.length > 0" class="timeline-list">
              <div v-for="note in progressNotes" :key="note.id" class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-meta">
                    <span class="timeline-time">{{ formatProgressTime(note.createdAt) }}</span>
                    <span class="timeline-author">{{ note.createdByName }}</span>
                    <el-button
                      v-if="!isReadonly && (note.createdBy === authStore.user?.id || isAdmin)"
                      type="danger"
                      size="small"
                      link
                      @click="handleDeleteProgress(note.id)"
                    >删除</el-button>
                  </div>
                  <div class="timeline-text">{{ note.content }}</div>
                  <div v-if="note.attachments && note.attachments.length > 0" class="timeline-attachments">
                    <div v-if="getNoteScreenshots(note).length > 0 || getNotePhotos(note).length > 0" class="att-block">
                      <div class="att-block-label">图片附件</div>
                      <div class="att-image-row">
                        <div v-if="getNoteScreenshots(note).length > 0" class="att-section">
                          <div class="att-section-label">沟通记录截图</div>
                          <div class="att-image-grid">
                            <img
                              v-for="att in getNoteScreenshots(note)"
                              :key="att.id"
                              :src="`/api/files/worklog/${att.id}`"
                              class="att-thumb"
                              @click="handlePreviewImage(att.id)"
                            />
                          </div>
                        </div>
                        <div v-if="getNotePhotos(note).length > 0" class="att-section">
                          <div class="att-section-label">项目现场照片</div>
                          <div class="att-image-grid">
                            <img
                              v-for="att in getNotePhotos(note)"
                              :key="att.id"
                              :src="`/api/files/worklog/${att.id}`"
                              class="att-thumb"
                              @click="handlePreviewImage(att.id)"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div v-if="getNoteDocs(note).length > 0" class="att-block">
                      <div class="att-block-label">文档附件</div>
                      <div class="att-doc-list">
                        <span
                          v-for="att in getNoteDocs(note)"
                          :key="att.id"
                          class="att-doc-link"
                          @click="handleDocPreview(att.id)"
                        >
                          <span class="doc-type-badge" :class="getDocType(att.fileName)">{{ getDocTypeLabel(att.fileName) }}</span>
                          {{ att.fileName }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="timeline-empty">暂无进展记录</div>
            <div v-if="!isReadonly" class="timeline-input">
              <el-input
                v-model="newProgressContent"
                type="textarea"
                :rows="6"
                placeholder="输入新的进展内容…"
                style="flex: 1"
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item v-if="!isReadonly && form.id" label="图片附件">
          <div class="image-uploads-row">
            <div class="image-upload-col">
              <div class="upload-col-label">沟通记录截图</div>
              <WorklogAttachments
                ref="screenshotRef"
                v-model="progressScreenshots"
                :entry-id="null"
                kind="screenshot"
                :disabled="false"
              />
            </div>
            <div class="image-upload-col">
              <div class="upload-col-label">项目现场照片</div>
              <WorklogAttachments
                ref="photoRef"
                v-model="progressPhotos"
                :entry-id="null"
                kind="photo"
                :disabled="false"
              />
            </div>
          </div>
        </el-form-item>

        <el-form-item v-if="!isReadonly && form.id" label="文档附件">
          <WorklogAttachments
            ref="documentRef"
            v-model="progressDocs"
            :entry-id="null"
            kind="document"
            :disabled="false"
          />
        </el-form-item>

        <el-form-item label="下次跟进时间" prop="nextFollowUpDate">
          <el-date-picker
            v-model="form.nextFollowUpDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择预计下次跟进沟通日期"
            style="width: 100%"
            :disabled-date="(date: Date) => date.getTime() < Date.now() - 86400000"
          />
        </el-form-item>
      </template>

      <el-alert
        v-if="form.isFinalized"
        type="success"
        :closable="false"
        show-icon
        title="该日志已办结，仅可查看不可编辑"
      />
    </el-form>

    <template #footer>
      <el-button @click="handleClose">{{ isReadonly ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!isReadonly" type="primary" :loading="isToday ? addingProgress : saving" @click="isToday ? handleAddProgress() : handleSave()">
        {{ isToday ? '追加进展' : '提交' }}
      </el-button>
    </template>

    <el-image-viewer
      v-if="previewImageId"
      :url-list="[`/api/files/worklog/${previewImageId}`]"
      @close="previewImageId = ''"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import WorklogAttachments from './WorklogAttachments.vue'
import type { WorklogDictItem, WorklogEntry, WorklogProject, WorklogAttachment, WorklogProgressNote } from '@/types'

interface Dicts {
  districts: WorklogDictItem[]
  projectTypes: WorklogDictItem[]
  matters: WorklogDictItem[]
  contractStatuses: WorklogDictItem[]
}
interface UserLite { id: string; name: string; position?: string | null }

const props = defineProps<{
  visible: boolean
  entry?: WorklogEntry | null
  defaultDate?: string
  dicts: Dicts
  users: UserLite[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved', entry: WorklogEntry): void
}>()

const authStore = useAuthStore()
const formRef = ref<FormInstance>()
const saving = ref(false)
const projectOptions = ref<WorklogProject[]>([])
const searchingProjects = ref(false)
const showProjectInfo = ref(false)
const savingProject = ref(false)
const progressNotes = ref<WorklogProgressNote[]>([])
const newProgressContent = ref('')
const addingProgress = ref(false)
const pendingProgressNotes = ref<{ content: string }[]>([])
const previewImageId = ref('')

const screenshotRef = ref<InstanceType<typeof WorklogAttachments> | null>(null)
const photoRef = ref<InstanceType<typeof WorklogAttachments> | null>(null)
const documentRef = ref<InstanceType<typeof WorklogAttachments> | null>(null)
const progressScreenshots = ref<WorklogAttachment[]>([])
const progressPhotos = ref<WorklogAttachment[]>([])
const progressDocs = ref<WorklogAttachment[]>([])


const isAdmin = computed(() => ['super_admin', 'admin', 'general_manager'].includes(authStore.user?.role || ''))

const ownerNameDisplay = computed(() => {
  const u = props.users.find(u => u.id === form.ownerUserId)
  return u ? `${u.name}${u.position ? '（' + u.position + '）' : ''}` : form.ownerUserId
})

const selectedMatterStandardDays = computed(() => {
  if (!form.matter) return null
  const item = props.dicts.matters.find(m => m.name === form.matter)
  return item?.standard_days ?? null
})

const form = reactive({
  id: '' as string,
  logDate: '',
  projectId: '' as string | null,
  projectName: '',
  clientName: '',
  clientContactName: '',
  clientContactPhone: '',
  district: '',
  projectType: '',
  matter: '',
  ownerUserId: '',
  contractStatus: '',
  contractNote: '',
  workNote: '',
  nextFollowUpDate: '',
  agencyBureau: '',
  agencyDepartment: '',
  agencyContactName: '',
  agencyContactPhone: '',
  isFinalized: false,
  finalizeOnSave: false,
  attachments: [] as WorklogAttachment[],
})

const isReadonly = computed(() => {
  if (form.isFinalized) return true
  if (props.entry?.projectIsCompleted) return true
  if (form.id && props.entry?.userId && props.entry.userId !== authStore.user?.id) return true
  return false
})
const dialogTitle = computed(() => {
  if (!form.id) return '新建项目日志'
  if (form.isFinalized) return '项目日志（已办结）'
  if (props.entry?.projectIsCompleted) return '项目日志（项目已办结）'
  return '编辑项目日志'
})
const isToday = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return form.id && form.logDate === today
})
let originalContractStatus = ''
const rules: FormRules = {
  logDate: [{ required: true, message: '请选择日期', trigger: 'change' }],
  projectName: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  clientName: [{ required: true, message: '请输入甲方单位', trigger: 'blur' }],
  clientContactName: [{ required: true, message: '请输入甲方项目负责人姓名', trigger: 'blur' }],
  clientContactPhone: [
    { required: true, message: '请输入甲方项目负责人联系方式', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码', trigger: 'blur' },
  ],
  district: [{ required: true, message: '请选择行政区', trigger: 'change' }],
  projectType: [{ required: true, message: '请选择项目类型', trigger: 'change' }],
  matter: [{ required: true, message: '请选择办理事项', trigger: 'change' }],
  ownerUserId: [{ required: true, message: '请选择项目负责人', trigger: 'change' }],
  nextFollowUpDate: [{ required: true, message: '请选择预计下次跟进时间', trigger: 'change' }],
  agencyBureau: [{ required: true, message: '请输入委办局', trigger: 'blur' }],
  agencyDepartment: [{ required: true, message: '请输入科室', trigger: 'blur' }],
  agencyContactName: [{ required: true, message: '请输入经办人姓名', trigger: 'blur' }],
  agencyContactPhone: [
    { required: true, message: '请输入经办人电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码', trigger: 'blur' },
  ],
}

watch(() => props.visible, (v) => {
  if (v) init()
})

async function init() {
  newProgressContent.value = ''
  pendingProgressNotes.value = []
  progressScreenshots.value = []
  progressPhotos.value = []
  progressDocs.value = []
  if (props.entry) {
    const e = props.entry
    form.id = e.id
    form.logDate = e.logDate
    form.projectId = e.projectId
    form.projectName = e.projectName || ''
    form.clientName = e.clientName || ''
    form.clientContactName = ''
    form.clientContactPhone = ''
    form.district = e.district || ''
    form.projectType = ''
    form.matter = e.matter
    form.ownerUserId = e.ownerUserId
    form.contractStatus = e.contractStatus || ''
    form.contractNote = e.contractNote || ''
    form.workNote = e.workNote || ''
    form.nextFollowUpDate = e.nextFollowUpDate || ''
    originalContractStatus = form.contractStatus
    form.isFinalized = e.isFinalized
    form.finalizeOnSave = false
    form.attachments = e.attachments || []
    progressNotes.value = e.progressNotes || []

    // 补 projectType 及甲方联系人、办理机构信息
    try {
      const resp = await api.get(`/api/worklog-projects/${e.projectId}`)
      if (resp.data.success) {
        form.projectType = resp.data.data.projectType
        form.clientContactName = resp.data.data.clientContactName || ''
        form.clientContactPhone = resp.data.data.clientContactPhone || ''
        form.agencyBureau = resp.data.data.agencyBureau || ''
        form.agencyDepartment = resp.data.data.agencyDepartment || ''
        form.agencyContactName = resp.data.data.agencyContactName || ''
        form.agencyContactPhone = resp.data.data.agencyContactPhone || ''
      }
    } catch { /* ignore */ }
  } else {
    form.id = ''
    form.logDate = props.defaultDate || new Date().toISOString().slice(0, 10)
    form.projectId = null
    form.projectName = ''
    form.clientName = ''
    form.clientContactName = ''
    form.clientContactPhone = ''
    form.district = ''
    form.projectType = ''
    form.matter = ''
    form.ownerUserId = authStore.user?.id || ''
    form.contractStatus = ''
    form.contractNote = ''
    form.workNote = ''
    form.nextFollowUpDate = ''
    form.agencyBureau = ''
    form.agencyDepartment = ''
    form.agencyContactName = ''
    form.agencyContactPhone = ''
    originalContractStatus = ''
  }
}

async function searchProjects(keyword: string) {
  if (!keyword) {
    await loadDistrictProjects()
    return
  }
  searchingProjects.value = true
  try {
    const params: Record<string, string> = { q: keyword, isCompleted: 'false' }
    if (form.district) params.district = form.district
    const resp = await api.get('/api/worklog-projects', { params })
    if (resp.data.success) projectOptions.value = resp.data.data
  } finally {
    searchingProjects.value = false
  }
}

async function handleProjectFocus() {
  await loadDistrictProjects()
}

async function loadDistrictProjects() {
  searchingProjects.value = true
  try {
    const params: Record<string, string> = { isCompleted: 'false' }
    if (form.district) params.district = form.district
    const resp = await api.get('/api/worklog-projects', { params })
    if (resp.data.success) projectOptions.value = resp.data.data
  } finally {
    searchingProjects.value = false
  }
}

function handleProjectSelect(name: string) {
  const proj = projectOptions.value.find(p => p.name === name)
  if (proj) {
    form.projectId = proj.id
    form.projectName = proj.name
    form.clientName = proj.clientName
    form.clientContactName = proj.clientContactName || ''
    form.clientContactPhone = proj.clientContactPhone || ''
    form.district = proj.district
    form.projectType = proj.projectType
    form.agencyBureau = proj.agencyBureau || ''
    form.agencyDepartment = proj.agencyDepartment || ''
    form.agencyContactName = proj.agencyContactName || ''
    form.agencyContactPhone = proj.agencyContactPhone || ''
    if (!form.ownerUserId) form.ownerUserId = proj.ownerUserId
  } else {
    form.projectId = null
  }
}

function handlePreviewImage(attId: string) {
  previewImageId.value = attId
}

function handleDocPreview(id: string) {
  window.open(`/api/files/worklog/${id}/preview`, '_blank')
}

function getDocType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['xls', 'xlsx'].includes(ext)) return 'excel'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

function getDocTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['doc', 'docx'].includes(ext)) return 'Word'
  if (['xls', 'xlsx'].includes(ext)) return 'Excel'
  if (ext === 'pdf') return 'PDF'
  return ''
}

function getNoteScreenshots(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'screenshot')
}
function getNotePhotos(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'photo' || a.fileKind === 'image')
}
function getNoteDocs(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'document')
}

function formatProgressTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function handleAddProgress() {
  const content = newProgressContent.value.trim()
  if (!content) {
    ElMessage.warning('请输入进展内容')
    return
  }
  if (!form.nextFollowUpDate) {
    ElMessage.warning('请选择预计下次跟进时间')
    return
  }

  const hasPendingFiles = screenshotRef.value?.hasPending() || photoRef.value?.hasPending() || documentRef.value?.hasPending()

  if (!form.id) {
    // 新建日志时暂存进展（附件也暂存在组件内部）
    pendingProgressNotes.value.push({ content })
    progressNotes.value.push({
      id: `pending_${Date.now()}`,
      entryId: '',
      content,
      createdBy: authStore.user?.id || '',
      createdByName: authStore.user?.name || '',
      createdAt: new Date().toISOString(),
      attachments: [],
    })
    newProgressContent.value = ''
    // 注意：附件暂存在 WorklogAttachments 组件内部，提交时统一上传
    return
  }

  addingProgress.value = true
  try {
    const resp = await api.post(`/api/worklog-entries/${form.id}/progress`, { content, nextFollowUpDate: form.nextFollowUpDate })
    if (resp.data.success) {
      const noteId = resp.data.data.id
      if (hasPendingFiles) {
        for (const ref of [screenshotRef, photoRef, documentRef]) {
          if (ref.value?.hasPending()) {
            await ref.value.uploadToNote(form.id, noteId)
          }
        }
      }
      // 重新拉取进展列表
      const notesResp = await api.get(`/api/worklog-entries/${form.id}/progress`)
      if (notesResp.data.success) {
        // 需要重新拉取附件信息
        const detailResp = await api.get(`/api/worklog-entries/${form.id}`)
        if (detailResp.data.success) {
          progressNotes.value = detailResp.data.data.progressNotes || []
          emit('saved', detailResp.data.data)
        }
      }
      newProgressContent.value = ''
      progressScreenshots.value = []
      progressPhotos.value = []
      progressDocs.value = []
    } else {
      ElMessage.error(resp.data.message || '追加失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '追加失败')
  } finally {
    addingProgress.value = false
  }
}

async function handleDeleteProgress(noteId: string) {
  try {
    await ElMessageBox.confirm('确定删除该进展记录？', '提示', { type: 'warning' })
  } catch { return }

  if (noteId.startsWith('pending_')) {
    const idx = progressNotes.value.findIndex(n => n.id === noteId)
    if (idx >= 0) {
      pendingProgressNotes.value.splice(idx, 1)
      progressNotes.value.splice(idx, 1)
    }
    return
  }

  try {
    const resp = await api.delete(`/api/worklog-entries/${form.id}/progress/${noteId}`)
    if (resp.data.success) {
      progressNotes.value = progressNotes.value.filter(n => n.id !== noteId)
    } else {
      ElMessage.error(resp.data.message || '删除失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '删除失败')
  }
}

async function handleSave() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    ElMessage.warning('请填写必填项')
    return
  }
  try {
    await ElMessageBox.confirm(isToday.value ? '确认追加该进展？' : '确认提交该项目日志？', '提示', { type: 'info', confirmButtonText: '确认', cancelButtonText: '取消' })
  } catch { return }
  saving.value = true
  try {
    let projectId = form.projectId
    // 新项目：先创建
    if (!projectId) {
      const resp = await api.post('/api/worklog-projects', {
        name: form.projectName.trim(),
        clientName: form.clientName.trim(),
        clientContactName: form.clientContactName.trim(),
        clientContactPhone: form.clientContactPhone.trim(),
        district: form.district,
        projectType: form.projectType,
        ownerUserId: form.ownerUserId,
        startDate: form.logDate,
        agencyBureau: form.agencyBureau.trim() || null,
        agencyDepartment: form.agencyDepartment.trim() || null,
        agencyContactName: form.agencyContactName.trim() || null,
        agencyContactPhone: form.agencyContactPhone.trim() || null,
      })
      if (!resp.data.success) throw new Error(resp.data.message)
      projectId = resp.data.data.id
    }

    // 保存 entry
    let savedId = form.id
    if (!savedId) {
      const resp = await api.post('/api/worklog-entries', {
        logDate: form.logDate,
        projectId,
        matter: form.matter,
        ownerUserId: form.ownerUserId,
        contractStatus: form.contractStatus || null,
        contractNote: form.contractNote || null,
        workNote: form.workNote || null,
        nextFollowUpDate: form.nextFollowUpDate || null,
      })
      if (!resp.data.success) throw new Error(resp.data.message)
      savedId = resp.data.data.id
      form.id = savedId
      form.projectId = projectId
    } else {
      const resp = await api.put(`/api/worklog-entries/${savedId}`, {
        logDate: form.logDate,
        matter: form.matter,
        ownerUserId: form.ownerUserId,
        contractStatus: form.contractStatus || null,
        contractNote: form.contractNote || null,
        workNote: form.workNote || null,
        nextFollowUpDate: form.nextFollowUpDate || null,
      })
      if (!resp.data.success) throw new Error(resp.data.message)
    }

    // 办结（单向）
    if (form.finalizeOnSave) {
      await api.post(`/api/worklog-entries/${savedId}/finalize`)
      form.isFinalized = true
    }

    // 合同状态变更时同步到项目合同进度
    if (form.contractStatus && form.contractStatus !== originalContractStatus && projectId) {
      try {
        await api.post(`/api/worklog-projects/${projectId}/contract`, {
          status: form.contractStatus,
          amount: null,
          note: form.contractNote || null,
        })
      } catch { /* ignore */ }
    }

    // 推送暂存的进展记录（含附件）—— 新建日志场景
    for (const pending of pendingProgressNotes.value) {
      try {
        const resp = await api.post(`/api/worklog-entries/${savedId}/progress`, { content: pending.content, nextFollowUpDate: form.nextFollowUpDate })
        if (resp.data.success) {
          const noteId = resp.data.data.id
          for (const ref of [screenshotRef, photoRef, documentRef]) {
            if (ref.value?.hasPending()) {
              await ref.value.uploadToNote(savedId, noteId)
            }
          }
        }
      } catch { /* ignore */ }
    }
    pendingProgressNotes.value = []

    // 编辑日志场景：若输入框有内容或附件待上传，作为一条新进展提交
    if (form.id) {
      const trimmed = newProgressContent.value.trim()
      const hasPending = screenshotRef.value?.hasPending() || photoRef.value?.hasPending() || documentRef.value?.hasPending()
      if (trimmed || hasPending) {
        const content = trimmed || '（追加附件）'
        try {
          const resp = await api.post(`/api/worklog-entries/${savedId}/progress`, { content, nextFollowUpDate: form.nextFollowUpDate })
          if (resp.data.success) {
            const noteId = resp.data.data.id
            for (const ref of [screenshotRef, photoRef, documentRef]) {
              if (ref.value?.hasPending()) {
                await ref.value.uploadToNote(savedId, noteId)
              }
            }
          }
        } catch { /* ignore */ }
        newProgressContent.value = ''
      }
    }

    // 重新拉完整 entry 返回
    const detail = await api.get(`/api/worklog-entries/${savedId}`)
    if (detail.data.success) emit('saved', detail.data.data)
    ElMessage.success('提交成功')
    emit('update:visible', false)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || '提交失败')
  } finally {
    saving.value = false
  }
}

async function handleSaveProjectInfo() {
  if (!form.projectId) return
  savingProject.value = true
  try {
    const resp = await api.put(`/api/worklog-projects/${form.projectId}`, {
      clientName: form.clientName,
      clientContactName: form.clientContactName,
      clientContactPhone: form.clientContactPhone,
      agencyBureau: form.agencyBureau,
      agencyDepartment: form.agencyDepartment,
      agencyContactName: form.agencyContactName,
      agencyContactPhone: form.agencyContactPhone,
      projectType: form.projectType,
      ownerUserId: form.ownerUserId,
      contractStatus: form.contractStatus || null,
    })
    if (resp.data.success) {
      ElMessage.success('项目信息已更新')
    } else {
      ElMessage.error(resp.data.message || '更新失败')
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '更新项目信息失败')
  } finally {
    savingProject.value = false
  }
}

function handleClose() {
  showProjectInfo.value = false
  emit('update:visible', false)
}
</script>

<style scoped>
.project-info-panel {
  margin: 0 0 18px 110px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}
.matter-with-days {
  display: flex; align-items: center; gap: 8px; width: 100%;
}
.matter-with-days .el-select { flex: 1; }
.matter-days-tag { flex-shrink: 0; }
.progress-timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.timeline-list {
  max-height: 300px;
  overflow-y: auto;
  padding-left: 16px;
  border-left: 2px solid #e4e7ed;
}
.timeline-item {
  position: relative;
  padding: 6px 0 12px 16px;
}
.timeline-item:last-child {
  padding-bottom: 0;
}
.timeline-dot {
  position: absolute;
  left: -21px;
  top: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #409eff;
}
.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.timeline-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #909399;
}
.timeline-time {
  font-family: monospace;
}
.timeline-author {
  color: #606266;
}
.timeline-text {
  font-size: 13px;
  color: #303133;
  line-height: 1.6;
  white-space: pre-wrap;
}
.timeline-attachments {
  margin-top: 8px;
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
.att-block {
  margin-bottom: 8px;
}
.att-block:last-child {
  margin-bottom: 0;
}
.att-block-label {
  font-size: 12px;
  color: #606266;
  font-weight: 500;
  margin-bottom: 6px;
}
.att-image-row {
  display: flex;
  gap: 40px;
}
.att-section {
  margin-bottom: 6px;
}
.att-section-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.att-image-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.att-thumb {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #e4e7ed;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: transform 0.15s;
}
.att-thumb:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}
.att-doc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.att-doc-link {
  font-size: 13px;
  color: #409eff;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #e4e7ed;
  cursor: pointer;
}
.att-doc-link:hover {
  background: #ecf5ff;
  border-color: #b3d8ff;
  text-decoration: none;
}
.doc-type-badge {
  font-size: 11px; font-weight: 600; padding: 1px 5px; border-radius: 3px; color: #fff;
}
.doc-type-badge.word { background: #2b579a; }
.doc-type-badge.excel { background: #217346; }
.doc-type-badge.pdf { background: #d63b3b; }
.doc-type-badge.other { background: #909399; }
.timeline-empty {
  font-size: 13px;
  color: #909399;
  padding: 8px 0;
}
.timeline-input {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.progress-submit-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.progress-upload-area {
  margin-top: 10px;
}
.image-uploads-row {
  display: flex;
  gap: 16px;
  width: 100%;
}
.image-upload-col {
  flex: 1;
  min-width: 0;
}
.upload-col-label {
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}
</style>
