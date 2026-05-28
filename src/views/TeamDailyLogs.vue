<template>
  <div class="team-logs-page">
    <!-- 未读回复提示条 -->
    <div v-if="showReplyHint" class="comment-hint-bar" @click="scrollToUnreadReply">
      有 {{ unreadReplyCount }} 条新回复，点击查看
    </div>
    <!-- 顶部：日期选择 + 周概览 -->
    <div class="week-overview">
      <div class="week-header">
        <el-date-picker
          v-model="selectedDate"
          type="date"
          format="YYYY年MM月DD日"
          value-format="YYYY-MM-DD"
          :clearable="false"
          size="small"
          style="width: 170px"
          @change="onDatePickerChange"
        >
          <template #default="cell">
            <div class="date-cell">
              <span class="date-cell-text">{{ cell.date.getDate() }}</span>
              <span v-if="getDateTag(cell.date) === '休'" class="date-cell-tag tag-rest">休</span>
              <span v-else-if="getDateTag(cell.date) === '班'" class="date-cell-tag tag-work">班</span>
              <span
                v-if="getDateSubmitStatus(cell.date)"
                class="date-cell-dot"
                :class="getDateSubmitStatus(cell.date) === 'full' ? 'dot-full' : 'dot-partial'"
              ></span>
              <span
                v-if="getDateCommentStatus(cell.date)"
                class="date-cell-comment"
                :class="{ unread: getDateCommentStatus(cell.date) === 'unread' }"
              ></span>
            </div>
          </template>
        </el-date-picker>
        <el-button size="small" @click="goToday">今天</el-button>
        <el-button size="small" :icon="Download" @click="openExportDialog">导出周报</el-button>
      </div>

      <div class="week-days">
        <div
          v-for="day in weekDays"
          :key="day.date"
          class="week-day-item"
          :class="{
            active: day.date === selectedDate,
            today: day.date === today,
            'is-rest': day.total === 0,
          }"
          @click="selectDate(day.date)"
        >
          <div class="day-label">{{ formatWeekday(day.date) }}</div>
          <div class="day-date">{{ day.date.slice(5) }}</div>
          <span v-if="day.hasUnreadReply" class="day-comment-dot unread"></span>
          <span v-else-if="day.hasComment" class="day-comment-dot"></span>
          <template v-if="day.total > 0">
            <div class="day-progress">
              <div class="progress-bar" :style="{ width: (day.submitted / day.total * 100) + '%' }"></div>
            </div>
            <div class="day-stat">{{ day.submitted }}/{{ day.total }}</div>
          </template>
          <template v-else>
            <div class="day-tag" v-if="day.label">{{ day.label }}</div>
            <div class="day-tag" v-else>休</div>
          </template>
        </div>
      </div>
    </div>

    <div class="main-content">
      <!-- 左侧：日志列表 -->
      <div class="logs-panel" v-loading="loading">
        <div class="panel-header">
          <h3>{{ formatDateTitle(selectedDate) }} 员工日志</h3>
          <el-tag type="success" size="small">已提交 {{ submissions.length }} 人</el-tag>
        </div>

        <div v-if="submissions.length === 0" class="empty-state">
          当日暂无日志提交
        </div>

        <div v-for="sub in submissions" :key="sub.id" class="log-card">
          <div class="log-card-header" @click="toggleCard(sub.id)">
            <div class="user-info">
              <span class="user-name">{{ sub.userName }}</span>
              <span v-if="sub.userPosition" class="user-position">{{ sub.userPosition }}</span>
              <span v-if="sub.commentCount > 0" class="user-comment-icon" :class="{ 'has-unread': sub.hasUnreadReply }">
                <span class="comment-count">{{ sub.commentCount }}</span>
              </span>
            </div>
            <div class="header-right">
              <span class="submit-time">{{ formatTime(sub.submittedAt) }}</span>
              <el-icon class="expand-icon" :class="{ expanded: expandedCards.has(sub.id) }">
                <ArrowDown />
              </el-icon>
            </div>
          </div>
          <template v-if="expandedCards.has(sub.id)">
          <div class="log-card-body rich-content" v-html="sub.content"></div>

          <!-- 补充记录 -->
          <div v-if="sub.supplements && sub.supplements.length > 0" class="log-supplements">
            <div v-for="sp in sub.supplements" :key="sp.id" class="supplement-item">
              <div class="supplement-header">
                <span class="supplement-label">补充{{ sp.seq }}</span>
                <span class="supplement-time">{{ formatTime(sp.createdAt) }}</span>
              </div>
              <div class="supplement-content rich-content" v-html="sp.content"></div>
            </div>
          </div>

          <!-- 附件区 -->
          <div v-if="sub.attachments && sub.attachments.length > 0" class="log-attachments">
            <div v-if="getImages(sub.attachments).length > 0" class="attach-section">
              <div class="attach-label">📷 图片</div>
              <div class="attach-images">
                <el-image
                  v-for="att in getImages(sub.attachments)"
                  :key="att.id"
                  :src="`/${att.filePath}`"
                  :preview-src-list="getImages(sub.attachments).map(a => `/${a.filePath}`)"
                  :initial-index="getImages(sub.attachments).indexOf(att)"
                  fit="cover"
                  class="attach-image-thumb"
                />
              </div>
            </div>
            <div v-if="getDocs(sub.attachments).length > 0" class="attach-section">
              <div class="attach-label">📎 附件</div>
              <div class="attach-docs">
                <a
                  v-for="att in getDocs(sub.attachments)"
                  :key="att.id"
                  :href="`/${att.filePath}`"
                  target="_blank"
                  class="attach-doc-card"
                >
                  <div class="doc-icon" :class="getExtClass(att.fileName)">
                    <span>{{ getFileExt(att.fileName) }}</span>
                  </div>
                  <span class="doc-name" :title="att.fileName">{{ att.fileName }}</span>
                </a>
              </div>
            </div>
          </div>

          <!-- 评论区 -->
          <div class="comment-section">
            <div v-if="sub.comments && sub.comments.length > 0" class="comment-list">
              <div v-for="c in sub.comments" :key="c.id" :class="['comment-item', { 'comment-item-unread': c.isUnread }]">
                <span :class="['comment-author', c.userId === authStore.user?.id ? 'is-self' : 'is-other']">{{ c.userName }}</span>
                <template v-if="c.replyToUserName">
                  <span class="comment-reply-label">回复</span>
                  <span :class="['comment-reply-target', c.replyToUserId === authStore.user?.id ? 'is-self' : 'is-other']">@{{ c.replyToUserName }}</span>
                </template>
                <span class="comment-text">{{ c.content }}</span>
                <span class="comment-time">{{ formatTime(c.createdAt) }}</span>
                <span v-if="c.userId !== authStore.user?.id" class="comment-reply-btn" @click="setReplyTo(sub.id, c)">回复</span>
              </div>
            </div>
            <div class="comment-input">
              <div class="comment-input-wrap">
                <div v-if="replyTargets[sub.id]" class="reply-hint">
                  回复 @{{ replyTargets[sub.id]!.userName }}
                  <span class="reply-cancel" @click="cancelReply(sub.id)">×</span>
                </div>
                <el-input
                  v-model="commentInputs[sub.id]"
                  type="textarea"
                  :rows="3"
                  :placeholder="replyTargets[sub.id] ? `回复 @${replyTargets[sub.id]!.userName}...` : '输入评论...'"
                  resize="none"
                  @keyup.ctrl.enter="submitComment(sub.id)"
                />
                <div class="comment-input-bottom">
                  <span class="char-count">{{ (commentInputs[sub.id] || '').length }} 字</span>
                  <el-button
                    size="small"
                    type="primary"
                    :loading="commentLoading[sub.id]"
                    :disabled="!commentInputs[sub.id]?.trim()"
                    @click="submitComment(sub.id)"
                  >{{ replyTargets[sub.id] ? '回复' : '评论' }}</el-button>
                </div>
              </div>
            </div>
          </div>
          </template>
        </div>
      </div>

      <!-- 右侧：未提交人员 + 统计 -->
      <div class="stats-panel">
        <div class="stat-card">
          <div class="stat-title">提交率</div>
          <template v-if="isWorkingDay">
            <div class="stat-value">
              {{ totalUsers > 0 ? Math.round(submissions.length / totalUsers * 100) : 0 }}%
            </div>
            <div class="stat-desc">{{ submissions.length }} / {{ totalUsers }} 人</div>
          </template>
          <template v-else>
            <div class="stat-value rest">—</div>
            <div class="stat-desc">休息日</div>
          </template>
        </div>

        <div class="not-submitted-card">
          <div class="card-title">
            未提交人员
            <el-tag type="danger" size="small" v-if="notSubmitted.length > 0">{{ notSubmitted.length }}</el-tag>
          </div>
          <div v-if="!isWorkingDay" class="rest-day-text">休息日，无需提交</div>
          <div v-else-if="notSubmitted.length === 0" class="all-done-text">全员已提交</div>
          <div v-else class="not-submitted-list">
            <div v-for="u in notSubmitted" :key="u.id" class="not-submitted-item">
              <span class="ns-name">{{ u.name }}</span>
              <span v-if="u.position" class="ns-position">{{ u.position }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 导出周报对话框 -->
    <el-dialog v-model="showExportDialog" title="导出团队周报" width="400px">
      <div style="margin-bottom: 16px;">
        <span style="margin-right: 12px;">选择时间范围：</span>
        <el-date-picker
          v-model="exportDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
        />
      </div>
      <template #footer>
        <el-button @click="showExportDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!exportDateRange || exportDateRange.length < 2" @click="handleDownloadTeamReport">导出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import { ElMessage } from 'element-plus'
import { ArrowDown, Download } from '@element-plus/icons-vue'

interface Attachment {
  id: string
  fileKind: 'image' | 'document'
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
}

interface Supplement {
  id: string
  seq: number
  content: string
  createdAt: string
}

interface Submission {
  id: string
  userId: string
  userName: string
  userPosition: string | null
  content: string
  submittedAt: string
  commentCount: number
  hasUnreadReply: boolean
  comments?: Comment[]
  attachments: Attachment[]
  supplements: Supplement[]
}

interface Comment {
  id: string
  content: string
  createdAt: string
  userId: string
  userName: string
  replyTo: string | null
  replyToUserId: string | null
  replyToUserName: string | null
  isUnread: boolean
}

interface MonthDay {
  date: string
  submitted: number
  total: number
  label: string | null
}

const authStore = useAuthStore()
const pendingStore = usePendingStore()
const showReplyHint = ref(false)
const unreadReplyCount = ref(0)
const isNavigatingToUnread = ref(false)
const expandedCards = ref<Set<string>>(new Set())
const today = new Date().toISOString().slice(0, 10)
const selectedDate = ref(today)
const loading = ref(false)
const monthDays = ref<MonthDay[]>([])
const commentDates = ref<string[]>([])
const unreadReplyDates = ref<string[]>([])
const submissions = ref<Submission[]>([])
const notSubmitted = ref<{ id: string; name: string; position: string | null }[]>([])
const totalUsers = ref(0)
const commentInputs = reactive<Record<string, string>>({})
const commentLoading = reactive<Record<string, boolean>>({})
const replyTargets = reactive<Record<string, { id: string; userName: string } | null>>({})
const showExportDialog = ref(false)
const exportDateRange = ref<string[]>([])
function setReplyTo(submissionId: string, comment: Comment) {
  replyTargets[submissionId] = { id: comment.id, userName: comment.userName }
}

function cancelReply(submissionId: string) {
  replyTargets[submissionId] = null
}

async function scrollToUnreadReply() {
  showReplyHint.value = false
  isNavigatingToUnread.value = true
  try {
    const { data } = await api.get('/api/daily-logs/team/comments/unread-date')
    if (data.success && data.data.date) {
      const targetDate = data.data.date
      if (selectedDate.value !== targetDate) {
        selectedDate.value = targetDate
      }
      // 重新加载数据并等待评论加载完成
      loading.value = true
      const month = selectedDate.value.slice(0, 7)
      const res = await api.get('/api/daily-logs/team', {
        params: { date: selectedDate.value, month },
      })
      if (res.data.success) {
        monthDays.value = res.data.data.monthDays
        commentDates.value = res.data.data.commentDates || []
        unreadReplyDates.value = res.data.data.unreadReplyDates || []
        submissions.value = res.data.data.submissions
        notSubmitted.value = res.data.data.notSubmitted
        totalUsers.value = res.data.data.totalUsers
        expandedCards.value = new Set()

        // 等待所有有评论的 submission 加载评论
        const commentPromises = submissions.value
          .filter(s => s.commentCount > 0)
          .map(sub => {
            sub.comments = []
            return loadComments(sub)
          })
        await Promise.all(commentPromises)

        // 展开包含未读评论的卡片
        for (const sub of submissions.value) {
          if (sub.comments?.some(c => c.isUnread)) {
            expandedCards.value.add(sub.id)
          }
        }
        expandedCards.value = new Set(expandedCards.value)
      }
      loading.value = false

      await nextTick()
      const unreadEl = document.querySelector('.comment-item-unread')
      if (unreadEl) {
        unreadEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      // 标记已读后刷新 pendingStore，确保后续未读能及时触发提示
      setTimeout(() => {
        pendingStore.fetchPendingCounts()
        isNavigatingToUnread.value = false
      }, 500)
    }
  } catch {
    isNavigatingToUnread.value = false
    ElMessage.error('定位未读回复失败')
  }
}

function toggleCard(subId: string) {
  if (expandedCards.value.has(subId)) {
    expandedCards.value.delete(subId)
  } else {
    expandedCards.value.add(subId)
  }
  expandedCards.value = new Set(expandedCards.value)
}

// 节假日数据（用于日历面板标记）
const holidayMap = ref<Map<string, { name: string; type: string }>>(new Map())
// 当前选中日期是否为工作日（后端通过 total=0 标识非工作日）
const isWorkingDay = computed(() => {
  const found = monthDays.value.find(md => md.date === selectedDate.value)
  return found ? found.total > 0 : true
})

// 当前选中日期所在周的周一
const currentMonday = computed(() => {
  const d = new Date(selectedDate.value)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
})

// 从 monthDays 中提取当前周的 7 天数据
const weekDays = computed(() => {
  const monday = new Date(currentMonday.value)
  const days: { date: string; submitted: number; total: number; label: string | null; hasComment: boolean; hasUnreadReply: boolean }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const ds = d.toISOString().slice(0, 10)
    const found = monthDays.value.find(md => md.date === ds)
    days.push({
      date: ds,
      submitted: found?.submitted || 0,
      total: found?.total || 0,
      label: found?.label || null,
      hasComment: commentDates.value.includes(ds),
      hasUnreadReply: unreadReplyDates.value.includes(ds),
    })
  }
  return days
})

onMounted(() => {
  loadHolidays()
  loadTeamData()
  // 检查未读回复
  const count = pendingStore.counts.unreadTeamLogReplies
  if (count > 0) {
    unreadReplyCount.value = count
    showReplyHint.value = true
  }
})

// 实时监听未读回复变化，无延迟显示提示条
watch(() => pendingStore.counts.unreadTeamLogReplies, (newCount) => {
  if (newCount > 0 && !isNavigatingToUnread.value) {
    unreadReplyCount.value = newCount
    showReplyHint.value = true
  }
  // 刷新周概览的未读标识（不重置展开状态）
  refreshUnreadDates()
})

async function loadHolidays() {
  try {
    const year = selectedDate.value.slice(0, 4)
    const { data } = await api.get('/api/holidays', { params: { year } })
    if (data.success) {
      const map = new Map<string, { name: string; type: string }>()
      for (const h of data.data) {
        map.set(h.date, { name: h.name, type: h.type })
      }
      holidayMap.value = map
    }
  } catch { /* ignore */ }
}

function getDateTag(date: Date): string | null {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`
  const h = holidayMap.value.get(dateStr)
  if (h?.type === 'holiday') return '休'
  if (h?.type === 'workday') return '班'
  const dayOfWeek = date.getDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) return '休'
  return null
}

// 日期选择器中工作日的提交状态：'full' 全员已交, 'partial' 未交齐, null 非工作日或无数据
function getDateSubmitStatus(date: Date): 'full' | 'partial' | null {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`
  const found = monthDays.value.find(md => md.date === dateStr)
  if (!found || found.total === 0) return null
  // 未来日期不标注
  if (dateStr > today) return null
  return found.submitted >= found.total ? 'full' : 'partial'
}

function getDateCommentStatus(date: Date): 'unread' | 'has' | null {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`
  if (unreadReplyDates.value.includes(dateStr)) return 'unread'
  if (commentDates.value.includes(dateStr)) return 'has'
  return null
}

async function loadTeamData() {
  loading.value = true
  try {
    const month = selectedDate.value.slice(0, 7)
    const { data } = await api.get('/api/daily-logs/team', {
      params: { date: selectedDate.value, month },
    })
    if (data.success) {
      monthDays.value = data.data.monthDays
      commentDates.value = data.data.commentDates || []
      unreadReplyDates.value = data.data.unreadReplyDates || []
      submissions.value = data.data.submissions
      notSubmitted.value = data.data.notSubmitted
      totalUsers.value = data.data.totalUsers
      expandedCards.value = new Set()

      for (const sub of submissions.value) {
        sub.comments = []
        if (sub.commentCount > 0) {
          loadComments(sub)
        }
      }
    }
  } catch {
    ElMessage.error('加载团队日志失败')
  } finally {
    loading.value = false
  }
}

async function loadComments(sub: Submission) {
  try {
    const { data } = await api.get(`/api/daily-logs/team/comments/${sub.id}`)
    if (data.success) {
      sub.comments = data.data
      // GET 接口会自动标记已读，刷新未读标识
      if (data.data.some((c: any) => c.isUnread)) {
        refreshUnreadDates()
      }
    }
  } catch { /* ignore */ }
}

async function refreshUnreadDates() {
  try {
    const month = selectedDate.value.slice(0, 7)
    const { data } = await api.get('/api/daily-logs/team', {
      params: { date: selectedDate.value, month },
    })
    if (data.success) {
      unreadReplyDates.value = data.data.unreadReplyDates || []
    }
  } catch { /* ignore */ }
}

function selectDate(date: string) {
  selectedDate.value = date
  loadTeamData()
}

function onDatePickerChange() {
  loadTeamData()
}

function goToday() {
  selectedDate.value = today
  loadTeamData()
}

function openExportDialog() {
  const monday = currentMonday.value
  const sunday = new Date(monday)
  sunday.setDate(new Date(monday).getDate() + 6)
  exportDateRange.value = [monday, sunday.toISOString().slice(0, 10)]
  showExportDialog.value = true
}

function handleDownloadTeamReport() {
  if (!exportDateRange.value || exportDateRange.value.length < 2) return
  const [start, end] = exportDateRange.value
  window.open(`/api/daily-logs/weekly-summary/download?weekStart=${start}&weekEnd=${end}&scope=team`, '_blank')
  showExportDialog.value = false
}

async function submitComment(submissionId: string) {
  const content = commentInputs[submissionId]?.trim()
  if (!content) return

  commentLoading[submissionId] = true
  try {
    const replyTo = replyTargets[submissionId]?.id || undefined
    const { data } = await api.post(`/api/daily-logs/team/comments/${submissionId}`, { content, replyTo })
    if (data.success) {
      const sub = submissions.value.find(s => s.id === submissionId)
      if (sub) {
        if (!sub.comments) sub.comments = []
        sub.comments.push(data.data)
      }
      commentInputs[submissionId] = ''
      replyTargets[submissionId] = null
    }
  } catch {
    ElMessage.error('评论失败')
  } finally {
    commentLoading[submissionId] = false
  }
}

function formatWeekday(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['日', '一', '二', '三', '四', '五', '六']
  return '周' + days[d.getDay()]
}

function getImages(attachments: Attachment[]): Attachment[] {
  return attachments.filter(a => a.fileKind === 'image')
}

function getDocs(attachments: Attachment[]): Attachment[] {
  return attachments.filter(a => a.fileKind === 'document')
}

function getFileExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase() || ''
  return ext
}

function getExtClass(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'ext-pdf'
  if (['doc', 'docx'].includes(ext)) return 'ext-word'
  if (['xls', 'xlsx'].includes(ext)) return 'ext-excel'
  if (['ppt', 'pptx'].includes(ext)) return 'ext-ppt'
  return 'ext-other'
}

function formatDateTitle(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.comment-hint-bar {
  width: 100%;
  padding: 12px 16px;
  background: #ecf5ff;
  border: 1px solid #b3d8ff;
  border-radius: 4px;
  color: #409eff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  animation: flash-hint 0.6s ease-in-out 4;
}

.comment-hint-bar:hover {
  background: #d9ecff;
}

@keyframes flash-hint {
  0%, 100% { background: #ecf5ff; }
  50% { background: #409eff; color: #fff; }
}

.team-logs-page {
  padding: 20px 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.week-overview {
  background: #fff;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.week-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.week-days {
  display: flex;
  gap: 8px;
}

.week-day-item {
  flex: 1;
  text-align: center;
  padding: 10px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  border: 2px solid transparent;
  position: relative;
}

.week-day-item:hover {
  background: #f5f7fa;
}

.week-day-item.active {
  background: #ecf5ff;
  border-color: #409eff;
}

.week-day-item.today .day-label {
  color: #409eff;
  font-weight: 600;
}

.day-label {
  font-size: 12px;
  color: #909399;
}

.day-date {
  font-size: 13px;
  color: #303133;
  margin: 4px 0;
}

.day-progress {
  height: 4px;
  background: #ebeef5;
  border-radius: 2px;
  margin: 6px 0 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: #67c23a;
  border-radius: 2px;
  transition: width 0.3s;
}

.day-stat {
  font-size: 11px;
  color: #909399;
}

.week-day-item.is-rest {
  opacity: 0.7;
}

.week-day-item.is-rest .day-label,
.week-day-item.is-rest .day-date {
  color: #c0c4cc;
}

.day-tag {
  font-size: 10px;
  color: #e6a23c;
  margin-top: 6px;
  line-height: 1.2;
}

.day-comment-dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  display: block;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23c0c4cc'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
  z-index: 1;
}

.day-comment-dot.unread {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f56c6c'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
  animation: comment-pulse 1.5s ease-in-out 3;
}

@keyframes comment-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

.main-content {
  display: flex;
  gap: 20px;
}

.logs-panel {
  flex: 1;
  min-width: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.panel-header h3 {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.empty-state {
  text-align: center;
  padding: 60px 0;
  color: #909399;
  font-size: 14px;
}

.log-card {
  background: #fff;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.log-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-icon {
  transition: transform 0.2s;
  color: #c0c4cc;
  font-size: 14px;
  transform: rotate(180deg);
}

.expand-icon.expanded {
  transform: rotate(0deg);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  font-weight: 500;
  font-size: 14px;
  color: #303133;
}

.user-position {
  font-size: 12px;
  color: #909399;
  background: #f4f4f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.user-comment-icon {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f0f9eb;
  font-size: 11px;
  color: #67c23a;
}

.user-comment-icon::before {
  content: '';
  display: inline-block;
  width: 12px;
  height: 12px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2367c23a'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.user-comment-icon.has-unread {
  background: #fef0f0;
  color: #f56c6c;
}

.user-comment-icon.has-unread::before {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f56c6c'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
  animation: comment-pulse 1.5s ease-in-out 3;
}

.submit-time {
  font-size: 12px;
  color: #c0c4cc;
}

.log-card-body {
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.log-supplements {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.supplement-item {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 6px;
  border-left: 3px solid #e6a23c;
}

.supplement-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.supplement-label {
  font-size: 12px;
  font-weight: 500;
  color: #e6a23c;
}

.supplement-time {
  font-size: 11px;
  color: #909399;
}

.supplement-content {
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
}

.comment-section {
  margin-top: 10px;
}

.comment-list {
  margin-bottom: 8px;
}

.comment-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.comment-item-unread {
  background: #fdf6ec;
  border-radius: 4px;
  padding: 4px 6px;
  margin: 0 -6px;
}

.comment-author {
  font-weight: 500;
  flex-shrink: 0;
}

.comment-author.is-other {
  color: #409eff;
}

.comment-author.is-self {
  color: #67c23a;
}

.comment-reply-label {
  color: #909399;
  font-size: 12px;
  margin: 0 2px;
}

.comment-reply-target {
  font-size: 12px;
  font-weight: 500;
  margin-right: 4px;
}

.comment-reply-target.is-other {
  color: #409eff;
}

.comment-reply-target.is-self {
  color: #67c23a;
}

.comment-text {
  color: #606266;
}

.comment-time {
  color: #c0c4cc;
  font-size: 11px;
  flex-shrink: 0;
}

.comment-reply-btn {
  color: #909399;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.comment-reply-btn:hover {
  color: #409eff;
}

.reply-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #409eff;
  padding: 4px 0;
}

.reply-cancel {
  cursor: pointer;
  color: #c0c4cc;
  font-size: 14px;
  line-height: 1;
}

.reply-cancel:hover {
  color: #f56c6c;
}

.comment-input {
  margin-top: 4px;
}

.comment-input-wrap {
  width: 100%;
}

.comment-input-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
}

.char-count {
  font-size: 11px;
  color: #c0c4cc;
}

.stats-panel {
  width: 240px;
  flex-shrink: 0;
}

.stat-card {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  text-align: center;
  margin-bottom: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.stat-title {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: #67c23a;
}

.stat-desc {
  font-size: 12px;
  color: #c0c4cc;
  margin-top: 4px;
}

.not-submitted-card {
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.card-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.all-done-text {
  text-align: center;
  padding: 20px 0;
  color: #67c23a;
  font-size: 13px;
}

.rest-day-text {
  text-align: center;
  padding: 20px 0;
  color: #909399;
  font-size: 13px;
}

.stat-value.rest {
  color: #c0c4cc;
}

.not-submitted-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.not-submitted-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #fef0f0;
  border-radius: 6px;
}

.ns-name {
  font-size: 13px;
  color: #f56c6c;
  font-weight: 500;
}

.ns-position {
  font-size: 11px;
  color: #909399;
}

:deep(.rich-content p) {
  margin: 0 0 4px;
}

:deep(.rich-content ol),
:deep(.rich-content ul) {
  padding-left: 20px;
  margin: 4px 0;
}

.log-attachments {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.attach-section {
  margin-bottom: 10px;
}

.attach-section:last-child {
  margin-bottom: 0;
}

.attach-label {
  font-size: 13px;
  color: #606266;
  font-weight: 500;
  margin-bottom: 8px;
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
  overflow: hidden;
  cursor: pointer;
  border: 1px solid #ebeef5;
}

.attach-docs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.attach-doc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-decoration: none;
  width: 72px;
}

.doc-icon {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 4px;
}

.ext-pdf {
  background: #f56c6c;
}

.ext-word {
  background: #409eff;
}

.ext-excel {
  background: #67c23a;
}

.ext-ppt {
  background: #e6a23c;
}

.ext-other {
  background: #909399;
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

.attach-doc-card:hover .doc-icon {
  opacity: 0.85;
}

.attach-doc-link {
  font-size: 12px;
  color: #409eff;
  background: #ecf5ff;
  padding: 4px 10px;
  border-radius: 4px;
  text-decoration: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-doc-link:hover {
  background: #d9ecff;
}

/* 日期选择器自定义单元格 */
.date-cell {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.date-cell-tag {
  position: absolute;
  top: -2px;
  right: -2px;
  font-size: 8px;
  line-height: 1;
  transform: scale(0.85);
}

.tag-rest {
  color: #f56c6c;
}

.tag-work {
  color: #e6a23c;
}

.date-cell-dot {
  position: absolute;
  bottom: 0px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.dot-full {
  background: #67c23a;
}

.dot-partial {
  background: #f56c6c;
}

.date-cell-comment {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 10px;
  height: 10px;
  display: block;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23c0c4cc'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.date-cell-comment.unread {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f56c6c'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}
</style>
