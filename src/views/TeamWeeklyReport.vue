<template>
  <div class="team-weekly-report">
    <div class="page-header">
      <div class="header-left">
        <el-button text :icon="ArrowLeft" @click="$router.back()">返回</el-button>
        <h2>团队周报</h2>
      </div>
      <div class="header-right">
        <el-radio-group v-model="timeChoice" size="small" @change="handleTimeChange">
          <el-radio-button value="thisWeek">本周</el-radio-button>
          <el-radio-button value="lastWeek">上周</el-radio-button>
          <el-radio-button value="custom">更早日期</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="timeChoice === 'custom'"
          v-model="customDate"
          type="week"
          placeholder="选择一周"
          :format="weekLabel"
          :disabled-date="(date: Date) => date > new Date()"
          size="small"
          @change="handleCustomDateChange"
        />
        <el-dropdown @command="handleExport" trigger="click">
          <el-button size="small" type="primary" :icon="Download" :disabled="!dateRange.length">
            导出<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="docx">纯文本 Word</el-dropdown-item>
              <el-dropdown-item command="zip">Word + 附件</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div v-if="dateRange.length === 2" class="date-range-hint">
      {{ dateRange[0] }} 至 {{ dateRange[1] }}
    </div>

    <div v-loading="loading" class="report-body">
      <el-empty v-if="!loading && reports.length === 0" description="暂无团队周报" :image-size="100" />
      <div v-for="report in reports" :key="report.id" class="report-card">
        <div class="report-card-header">
          <div>
            <span class="report-user">{{ report.userName }}</span>
            <span v-if="report.userPosition" class="report-position">{{ report.userPosition }}</span>
          </div>
          <span class="report-time">生成于 {{ formatTime(report.generatedAt) }}</span>
        </div>
        <div class="report-content rich-content" v-html="formatContent(report.content)"></div>

        <div v-if="report.supplements && report.supplements.length > 0" class="report-supplements">
          <div v-for="sp in report.supplements" :key="sp.id" class="report-supplement">
            <span class="supplement-label">补充{{ sp.seq }}</span>
            <div class="rich-content" v-html="sp.content"></div>
          </div>
        </div>

        <div v-if="report.attachments && report.attachments.length > 0" class="report-attachments">
          <div v-if="getImages(report.attachments).length > 0" class="attach-section">
            <div class="attach-label">图片</div>
            <div class="attach-images">
              <el-image
                v-for="att in getImages(report.attachments)"
                :key="att.id"
                :src="getTeamAttachmentUrl(att.id)"
                :preview-src-list="getImages(report.attachments).map(a => getTeamAttachmentUrl(a.id))"
                :initial-index="getImages(report.attachments).indexOf(att)"
                fit="cover"
                class="attach-image-thumb"
              />
            </div>
          </div>
          <div v-if="getDocs(report.attachments).length > 0" class="attach-section">
            <div class="attach-label">附件</div>
            <div class="attach-docs">
              <button
                v-for="att in getDocs(report.attachments)"
                :key="att.id"
                type="button"
                class="attach-doc-card"
                @click="previewAttachment(att)"
              >
                <div class="doc-icon" :class="getExtClass(att.fileName)">
                  <span>{{ getFileExt(att.fileName) }}</span>
                </div>
                <span class="doc-name" :title="att.fileName">{{ att.fileName }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/utils/api'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowDown, Download } from '@element-plus/icons-vue'

interface Attachment {
  id: string
  fileKind: 'image' | 'document'
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  logDate?: string
}

interface Supplement {
  id: string
  seq: number
  content: string
  createdAt: string
}

interface WeeklyReport {
  id: string
  userId: string
  userName: string
  userPosition: string | null
  content: string
  generatedAt: string
  lockedAt: string | null
  supplements: Supplement[]
  attachments: Attachment[]
}

const loading = ref(false)
const reports = ref<WeeklyReport[]>([])
const timeChoice = ref<'thisWeek' | 'lastWeek' | 'custom'>('thisWeek')
const customDate = ref('')
const dateRange = ref<string[]>([])

const weekLabel = computed(() => {
  if (dateRange.value.length === 2) {
    return `[${dateRange.value[0]} 至 ${dateRange.value[1]}]`
  }
  return '[选择一周]'
})

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getWeekRange(choice: string): string[] {
  const now = new Date()
  const day = now.getDay() || 7
  if (choice === 'thisWeek') {
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return [formatDate(monday), formatDate(sunday)]
  } else if (choice === 'lastWeek') {
    const monday = new Date(now)
    monday.setDate(now.getDate() - day - 6)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return [formatDate(monday), formatDate(sunday)]
  }
  return []
}

function getWeekRangeFromPicker(val: any): string[] {
  const d = val instanceof Date ? val : new Date(val)
  const dow = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - dow + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return [formatDate(monday), formatDate(sunday)]
}

function handleTimeChange(choice: string | number | boolean | undefined) {
  if (choice !== 'thisWeek' && choice !== 'lastWeek' && choice !== 'custom') return
  if (choice === 'custom') {
    dateRange.value = []
    customDate.value = ''
    reports.value = []
    return
  }
  dateRange.value = getWeekRange(choice)
  loadReports()
}

function handleCustomDateChange(val: any) {
  dateRange.value = val ? getWeekRangeFromPicker(val) : []
  if (dateRange.value.length === 2) {
    loadReports()
  }
}

async function loadReports() {
  if (!dateRange.value || dateRange.value.length < 2) return
  loading.value = true
  try {
    const [weekStart, weekEnd] = dateRange.value
    const { data } = await api.get('/api/daily-logs/team/weekly-summary', {
      params: { weekStart, weekEnd },
    })
    if (data.success) {
      reports.value = data.data.reports || []
    }
  } catch {
    ElMessage.error('加载团队周报失败')
  } finally {
    loading.value = false
  }
}

function handleExport(format: string) {
  if (!dateRange.value || dateRange.value.length < 2) return
  const [start, end] = dateRange.value
  const formatParam = format === 'docx' ? '&format=docx' : ''
  window.open(`/api/daily-logs/weekly-summary/download?weekStart=${start}&weekEnd=${end}&scope=team${formatParam}`, '_blank')
}

const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']

function formatContent(content: string): string {
  if (!content) return ''
  // 替换行首或标签后紧跟的 "N. " 为中文编号
  let result = content.replace(/(^|<[^>]*>|\n)(\d+)\.\s/gm, (_, prefix, num) => {
    const n = parseInt(num, 10)
    const cn = CN_NUMBERS[n - 1] || num
    return `${prefix}${cn}、`
  })
  // 日期标记加粗：【2026-06-25】或 2026年X月X日 周X 等格式
  result = result.replace(/(【\d{4}-\d{2}-\d{2}】)/g, '<strong>$1</strong>')
  result = result.replace(/(\d{4}年\d{1,2}月\d{1,2}日\s*周[一二三四五六日])/g, '<strong>$1</strong>')
  // 如果是纯文本（无 HTML 标签），将换行转为 <br>
  if (!/<(?!strong|\/strong)[a-z][\s\S]*>/i.test(content)) {
    result = result.replace(/\n/g, '<br>')
  }
  return result
}

function formatTime(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function getImages(attachments: Attachment[]) {
  return attachments.filter(a => a.fileKind === 'image')
}

function getDocs(attachments: Attachment[]) {
  return attachments.filter(a => a.fileKind === 'document')
}

function getTeamAttachmentUrl(attachmentId: string) {
  return `/api/daily-logs/team/attachments/${attachmentId}/preview`
}

function getFileExt(name: string) {
  return name.split('.').pop()?.toUpperCase() || ''
}

function getExtClass(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'ext-pdf'
  if (['doc', 'docx'].includes(ext)) return 'ext-word'
  if (['xls', 'xlsx'].includes(ext)) return 'ext-excel'
  if (['ppt', 'pptx'].includes(ext)) return 'ext-ppt'
  return 'ext-other'
}

function previewAttachment(att: Attachment) {
  window.open(`/api/daily-logs/team/attachments/${att.id}/preview`, '_blank')
}

onMounted(() => {
  dateRange.value = getWeekRange('thisWeek')
  loadReports()
})
</script>

<style scoped>
.team-weekly-report {
  padding: 20px;
  max-width: 960px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-left h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.date-range-hint {
  color: #606266;
  font-size: 13px;
  margin-bottom: 16px;
}

.report-body {
  min-height: 300px;
}

.report-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 14px;
  background: #fff;
}

.report-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f2f5;
  margin-bottom: 10px;
}

.report-user {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.report-position {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}

.report-time {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}

.report-content {
  color: #303133;
  line-height: 1.8;
  font-size: 14px;
}

.report-supplements {
  margin-top: 12px;
  border-top: 1px dashed #dcdfe6;
  padding-top: 10px;
}

.report-supplement {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
}

.supplement-label {
  flex-shrink: 0;
  font-size: 12px;
  background: #ecf5ff;
  color: #409eff;
  padding: 2px 6px;
  border-radius: 4px;
}

.report-attachments {
  margin-top: 12px;
  border-top: 1px solid #f0f2f5;
  padding-top: 12px;
}

.attach-section {
  margin-bottom: 10px;
}

.attach-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}

.attach-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attach-image-thumb {
  width: 80px;
  height: 80px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid #ebeef5;
}

.attach-docs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.attach-doc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.2s;
}

.attach-doc-card:hover {
  border-color: #409eff;
}

.doc-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

.doc-name {
  font-size: 11px;
  color: #606266;
  text-align: center;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ext-pdf { background: #f56c6c; }
.ext-word { background: #409eff; }
.ext-excel { background: #67c23a; }
.ext-ppt { background: #e6a23c; }
.ext-other { background: #909399; }
</style>

<style>
.team-weekly-report .rich-content ol,
.team-weekly-report .rich-content ul {
  padding-left: 0;
  margin: 4px 0;
}

.team-weekly-report .rich-content ol {
  list-style: none !important;
  counter-reset: cn-list;
}

.team-weekly-report .rich-content ol > li {
  counter-increment: cn-list;
  padding-left: 2.4em;
  position: relative;
  line-height: 1.8;
  margin-bottom: 4px;
  list-style: none !important;
}

.team-weekly-report .rich-content ol > li::before {
  content: counter(cn-list, cjk-ideographic) "\3001";
  position: absolute;
  left: 0;
  white-space: nowrap;
  color: #333;
  font-weight: 600;
}

.team-weekly-report .rich-content ol ol {
  counter-reset: cn-list-2;
  list-style: none;
}

.team-weekly-report .rich-content ol ol > li {
  counter-increment: cn-list-2;
}

.team-weekly-report .rich-content ol ol > li::before {
  content: counter(cn-list-2) ".";
}

.team-weekly-report .rich-content ol ol ol {
  counter-reset: cn-list-3;
  list-style: none;
}

.team-weekly-report .rich-content ol ol ol > li {
  counter-increment: cn-list-3;
}

.team-weekly-report .rich-content ol ol ol > li::before {
  content: "\FF08" counter(cn-list-3) "\FF09";
}

.team-weekly-report .rich-content ul {
  padding-left: 20px;
}

.team-weekly-report .rich-content p {
  margin: 0 0 6px;
  font-size: 14px;
  line-height: 1.8;
  color: #333;
}

.team-weekly-report .rich-content h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 16px 0 8px;
}

.team-weekly-report .rich-content h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.team-weekly-report .rich-content h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 10px 0 4px;
}

.team-weekly-report .rich-content li {
  font-size: 14px;
  line-height: 1.7;
}
</style>
