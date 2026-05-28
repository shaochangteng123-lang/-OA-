<template>
  <div class="daily-log-page">
    <!-- 未读评论提示条 -->
    <div v-if="showUnreadHint" class="comment-hint-bar" @click="goToUnreadComment">
      有 {{ unreadCommentCount }} 条新评论，点击查看
    </div>
    <!-- 左栏：今日日志编辑 -->
    <div class="left-panel">
      <!-- 状态标签 -->
      <div v-if="viewingWeeklyReport" class="status-banner viewing">
        <el-tag type="info" effect="plain" size="small">查看周报</el-tag>
        <span class="status-hint">正在查看周报内容</span>
      </div>
      <div v-else-if="viewingHistory" class="status-banner viewing">
        <el-tag type="info" effect="plain" size="small">查看历史</el-tag>
        <span class="status-hint">
          {{ editingGroup?.editPermission === 'supplement' ? '正在查看历史日志，点击"补充"可添加补充内容' : editingGroup?.editPermission === 'locked' ? '该日志已锁定，不可编辑' : '正在查看历史日志，点击"编辑"可修改' }}
        </span>
      </div>
      <div v-else-if="editingSubmission" class="status-banner editing">
        <el-tag type="warning" effect="plain" size="small">修改中</el-tag>
        <span class="status-hint">正在修改已提交的日志，完成后点击"保存修改"</span>
      </div>
      <div v-else-if="supplementMode" class="status-banner supplement">
        <el-tag type="info" effect="plain" size="small">补充模式</el-tag>
        <span class="status-hint">正在为 {{ supplementTargetDate }} 的日志添加补充内容</span>
      </div>
      <div v-else-if="weeklySupplementMode" class="status-banner weekly-supplement">
        <el-tag type="success" effect="plain" size="small">周报补充</el-tag>
        <span class="status-hint">正在为周报添加补充内容</span>
      </div>

      <!-- 补充模式：原始日志只读展示 -->
      <div v-if="supplementMode && supplementOriginalContent" class="supplement-original">
        <div class="supplement-original-header">
          <span class="supplement-original-title">{{ supplementTargetDate }} 原始日志</span>
        </div>
        <div class="supplement-original-body rich-content" v-html="supplementOriginalContent" />
      </div>

      <!-- 周报补充模式：原始周报只读展示 -->
      <div v-if="weeklySupplementMode && weeklySupplementOriginalContent" class="supplement-original weekly-supplement-original">
        <div class="supplement-original-header">
          <span class="supplement-original-title">周报原始内容</span>
        </div>
        <div class="supplement-original-body rich-content" v-html="weeklySupplementOriginalContent" />
      </div>

      <!-- 富文本编辑区 -->
      <div class="editor-area" :class="{ 'editor-viewing': viewingHistory, 'editor-editing-history': editingSubmission && !viewingHistory, 'editor-weekly-supplement': weeklySupplementMode }">
        <!-- 工具栏 -->
        <div class="editor-toolbar" v-if="editor && (!viewingHistory || weeklySupplementMode)">
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('heading', { level: 1 }) }"
              title="一级标题"
              @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
            >H1</button>
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('heading', { level: 2 }) }"
              title="二级标题"
              @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
            >H2</button>
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('heading', { level: 3 }) }"
              title="三级标题"
              @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            >H3</button>
          </div>
          <div class="toolbar-divider" />
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('bold') }"
              title="加粗 (Ctrl+B)"
              @click="editor.chain().focus().toggleBold().run()"
            ><strong>B</strong></button>
            <button
              class="toolbar-btn italic-btn"
              :class="{ active: editor.isActive('italic') }"
              title="斜体 (Ctrl+I)"
              @click="editor.chain().focus().toggleItalic().run()"
            ><em>I</em></button>
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('underline') }"
              title="下划线 (Ctrl+U)"
              @click="editor.chain().focus().toggleUnderline().run()"
            ><span style="text-decoration:underline">U</span></button>
          </div>
          <div class="toolbar-divider" />
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('bulletList') }"
              title="无序列表"
              @click="editor.chain().focus().toggleBulletList().run()"
            >• 列表</button>
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('orderedList') }"
              title="有序列表（段落编号）"
              @click="editor.chain().focus().toggleOrderedList().run()"
            >1. 编号</button>
            <button
              class="toolbar-btn"
              :class="{ active: editor.isActive('taskList') }"
              title="任务清单"
              @click="editor.chain().focus().toggleTaskList().run()"
            >☑ 清单</button>
          </div>
          <div class="toolbar-divider" />
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              title="增加缩进"
              @click="editor.chain().focus().sinkListItem('listItem').run()"
            >→ 缩进</button>
            <button
              class="toolbar-btn"
              title="减少缩进"
              @click="handleLiftListItem"
            >← 减进</button>
          </div>
          <div class="toolbar-divider" />
          <div class="toolbar-group">
            <el-popover
              v-model:visible="phrasePopoverVisible"
              placement="bottom-start"
              :width="220"
              trigger="click"
            >
              <template #reference>
                <button class="toolbar-btn" title="自定义短语">⚡自定义短语</button>
              </template>
              <div class="phrase-popover">
                <div v-if="phrases.length === 0" class="phrase-empty">暂无短语，点击下方管理添加</div>
                <div
                  v-for="p in phrases"
                  :key="p.id"
                  class="phrase-item"
                  @click="insertPhrase(p.content)"
                >{{ p.content }}</div>
                <div class="phrase-footer">
                  <el-button size="small" text type="primary" @click="openPhraseManager">管理短语</el-button>
                </div>
              </div>
            </el-popover>
          </div>
        </div>

        <!-- TipTap 编辑器 -->
        <div class="tiptap-wrapper" @click="!viewingHistory && focusEditor()">
          <!-- 日期栏（不可编辑） -->
          <div class="editor-date-bar">
            <span class="date-text">{{ formattedDate }}</span>
            <span class="weekday">{{ weekdayText }}</span>
          </div>
          <div class="tiptap-content-wrapper">
            <div class="line-gutter" v-if="lineNumbers.length > 0">
              <span
                v-for="ln in lineNumbers"
                :key="ln.num"
                class="line-gutter-num"
                :class="{ active: ln.num === activeLineNum }"
                :style="{ top: (ln.top + ln.height / 2 + 4) + 'px' }"
              >{{ ln.num }}</span>
            </div>
            <editor-content :editor="editor" class="tiptap-content" />
          </div>
          <AiCompletionPopup />
          <div class="word-count">{{ wordCount }} 字</div>
        </div>
      </div>

      <!-- 补充记录展示 -->
      <div class="supplement-list" v-if="viewingHistory && editingSubmission?.supplements?.length">
        <div class="supplement-list-header">补充记录</div>
        <div v-for="sup in editingSubmission.supplements" :key="sup.id" class="supplement-list-item">
          <div class="supplement-list-meta">
            <span class="supplement-list-label">补充 {{ sup.seq }}</span>
            <span class="supplement-list-time">{{ formatSupplementTime(sup.createdAt) }}</span>
          </div>
          <div class="supplement-list-content rich-content" v-html="sup.content"></div>
        </div>
      </div>

      <!-- 周报补充记录 + 编辑 -->
      <div class="supplement-list" v-if="viewingWeeklyReport && currentWeekReport?.supplements?.length">
        <div class="supplement-list-header">补充记录</div>
        <div v-for="sup in currentWeekReport.supplements" :key="sup.id" class="supplement-list-item">
          <div class="supplement-list-meta">
            <span class="supplement-list-label">补充 {{ sup.seq }}</span>
            <span class="supplement-list-time">{{ formatSupplementTime(sup.createdAt) }}</span>
          </div>
          <div class="supplement-list-content rich-content" v-html="sup.content"></div>
        </div>
      </div>

      <!-- 评论区（查看历史日志时，有评论才显示） -->
      <div class="comment-section" v-if="viewingHistory && editingSubmission && editingSubmission.comments && editingSubmission.comments.length > 0">
        <div class="comment-list">
          <div v-for="c in editingSubmission.comments" :key="c.id" :class="['comment-item', { 'comment-item-unread': c.isUnread }]">
            <span :class="['comment-author', c.userId === authStore.user?.id ? 'is-self' : 'is-other']">{{ c.userName }}</span>
            <template v-if="c.replyToUserName">
              <span class="comment-reply-label">回复</span>
              <span :class="['comment-reply-target', c.replyToUserId === authStore.user?.id ? 'is-self' : 'is-other']">@{{ c.replyToUserName }}</span>
            </template>
            <span class="comment-text">{{ c.content }}</span>
            <span class="comment-time">{{ formatCommentTime(c.createdAt) }}</span>
            <span v-if="c.userId !== authStore.user?.id" class="comment-reply-btn" @click="setCommentReply(c)">回复</span>
            <span v-if="c.userId === authStore.user?.id && canWithdraw(c.createdAt)" class="comment-withdraw-btn" @click="withdrawComment(c.id)">撤回</span>
          </div>
        </div>
        <div class="comment-input" v-if="commentReplyTarget">
          <div class="comment-input-wrap">
            <div class="reply-hint">
              回复 @{{ commentReplyTarget.userName }}
              <span class="reply-cancel" @click="cancelCommentReply()">×</span>
            </div>
            <el-input
              v-model="commentInput"
              type="textarea"
              :rows="3"
              :placeholder="`回复 @${commentReplyTarget.userName}...`"
              resize="none"
              @keyup.ctrl.enter="submitComment()"
            />
            <div class="comment-input-bottom">
              <span class="char-count">{{ commentInput.length }} 字</span>
              <el-button
                size="small"
                type="primary"
                :loading="commentLoading"
                :disabled="!commentInput.trim()"
                @click="submitComment()"
              >回复</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 附件区域 -->
      <div class="attach-row" v-if="attachments.length > 0 || (logId && !viewingHistory)">
        <!-- 图片卡片 -->
        <div class="attach-card" v-if="imageAttachments.length > 0">
          <div class="attach-card-header">
            <span class="attach-card-title">📷 图片 <span class="attach-count">({{ imageAttachments.length }})</span></span>
          </div>
          <div class="image-grid">
            <div
              v-for="att in imageAttachments"
              :key="att.id"
              class="image-item"
            >
              <el-image
                :src="`/${att.filePath}`"
                :preview-src-list="imagePreviewList"
                :initial-index="imagePreviewList.indexOf(`/${att.filePath}`)"
                fit="cover"
                class="image-thumb"
              />
              <el-button
                v-if="!viewingHistory"
                class="remove-btn"
                type="danger"
                :icon="Close"
                size="small"
                circle
                @click="handleRemoveAttachment(att)"
              />
            </div>
          </div>
        </div>

        <!-- 附件卡片 -->
        <div class="attach-card" v-if="docAttachments.length > 0">
          <div class="attach-card-header">
            <span class="attach-card-title">📎 附件 <span class="attach-count">({{ docAttachments.length }})</span></span>
          </div>
          <div class="doc-grid">
            <div
              v-for="att in docAttachments"
              :key="att.id"
              class="doc-card"
              @click="handleDocPreview(att)"
            >
              <el-button
                v-if="!viewingHistory"
                class="remove-btn"
                type="danger"
                :icon="Close"
                size="small"
                circle
                @click.stop="handleRemoveAttachment(att)"
              />
              <div class="doc-card-icon" :class="getExtClass(att.fileName)">
                <span class="doc-card-ext">{{ getFileExt(att.fileName) }}</span>
              </div>
              <span class="doc-card-name" :title="att.fileName">{{ att.fileName }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 统一上传入口 -->
      <el-upload
        v-if="logId && (!viewingHistory || viewingWeeklyReport || weeklySupplementMode)"
        :action="`/api/daily-logs/${logId}/attachments`"
        :show-file-list="false"
        :on-success="handleUploadSuccess"
        :on-error="handleUploadError"
        :before-upload="beforeUpload"
        :headers="uploadHeaders"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
        name="file"
        multiple
        :drag="true"
        class="unified-upload"
      >
        <div class="unified-upload-inner">
          <el-icon :size="20"><UploadFilled /></el-icon>
          <span class="unified-upload-text">点击或拖拽上传文件</span>
          <span class="unified-upload-hint">图片 / PDF / Word / Excel，10MB以内，自动归类</span>
        </div>
      </el-upload>
      <div v-else-if="!logId && !viewingHistory" class="upload-disabled-hint">暂存日志后可上传附件</div>

      <!-- 操作按钮 -->
      <div class="action-bar" :class="{ 'action-bar-viewing': viewingHistory, 'action-bar-editing': editingSubmission && !viewingHistory }">
        <div class="action-left">
          <el-button v-if="viewingHistory" @click="cancelEdit" class="btn-back-today">
            返回今日
          </el-button>
          <el-button v-else-if="weeklySupplementMode" @click="cancelWeeklySupplement">
            取消补充
          </el-button>
          <el-button v-else-if="!editingSubmission && !supplementMode" @click="handleClear" :disabled="isEditorEmpty && attachments.length === 0" size="large" class="btn-clear">
            一键清除
          </el-button>
          <el-button v-else-if="editingSubmission" @click="cancelEdit">
            取消修改
          </el-button>
          <el-button v-else-if="supplementMode" @click="cancelSupplement">
            取消补充
          </el-button>
        </div>
        <div class="action-right">
          <template v-if="weeklySupplementMode">
            <el-button type="success" @click="handleWeeklySupplementSubmit" :loading="weeklySupplementSubmitting">
              保存补充
            </el-button>
          </template>
          <template v-else-if="viewingWeeklyReport">
            <el-button size="large" plain @click="handleExportCurrentWeek">导出 Word</el-button>
            <el-button v-if="currentWeekReport && canSupplementReport(currentWeekReport)" size="large" type="warning" plain @click="startWeeklySupplement(currentWeekReport)">补充编辑</el-button>
          </template>
          <el-button v-else-if="viewingHistory && editingGroup?.editPermission !== 'locked'" type="warning" size="large" @click="enableEditMode" class="btn-edit-history">
            {{ editingGroup?.editPermission === 'supplement' ? '补充此日志' : '编辑此日志' }}
          </el-button>
          <el-tag v-else-if="viewingHistory && editingGroup?.editPermission === 'locked'" type="info" effect="plain">已锁定</el-tag>
          <template v-else>
            <span v-if="autoSaveTime && !editingSubmission && !supplementMode" class="save-hint">已暂存 {{ autoSaveTime }}</span>
            <el-button v-if="supplementMode" type="primary" @click="handleSaveSupplement" :loading="submitting">
              保存补充
            </el-button>
            <el-button v-else-if="editingSubmission" type="warning" size="large" @click="handleSaveEditSubmission" :loading="submitting" class="btn-save-edit">
              保存修改
            </el-button>
            <el-button v-else type="primary" size="large" @click="handleSave" :loading="saving" class="btn-save-today">保存</el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 右栏：周报 + 历史日志 -->
    <!-- 右栏：日历视图 -->
    <div class="right-panel">
      <!-- 天气/限行信息 -->
      <div class="meta-info">
        <span v-if="weatherInfo" class="weather-tag">
          <el-icon><Sunny v-if="weatherInfo.icon === 'sunny'" /><Cloudy v-else /></el-icon>
          {{ weatherInfo.text }} {{ weatherInfo.temp }}
        </span>
        <span v-if="trafficRestriction" class="traffic-tag" :class="{ 'no-restriction': trafficRestriction === '不限行' }">
          {{ trafficRestriction === '不限行' ? '今日不限行' : `限行 ${trafficRestriction}` }}
        </span>
      </div>

      <div class="calendar-section">
        <div class="calendar-header">
          <h3 class="section-title" style="margin: 0;">历史日志</h3>
          <el-input
            v-model="searchKeyword"
            size="small"
            placeholder="搜索日志..."
            :prefix-icon="Search"
            clearable
            class="search-input"
            @keyup.enter="handleSearch"
            @clear="clearSearch"
          />
        </div>

        <!-- 搜索结果：按月分组，日期列表 -->
        <div v-if="searchMode" class="search-results">
          <div v-if="searching" class="search-loading">搜索中...</div>
          <div v-else-if="searchCalendarMonths.length === 0" class="search-empty">无匹配结果</div>
          <div v-else class="search-calendar-list">
            <div v-for="m in searchCalendarMonths" :key="m.key" class="search-month-block">
              <div class="search-month-title">{{ m.label }}</div>
              <div class="search-dates-row">
                <span
                  v-for="cell in m.cells.filter(c => c.matched)"
                  :key="cell.dateStr"
                  class="search-date-chip"
                  :class="{ active: cell.dateStr === calendarSelectedDate }"
                  @click="handleSearchDateClick(cell.dateStr)"
                >{{ cell.day }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 日历视图 -->
        <template v-else>
        <!-- 月份导航 -->
        <div class="calendar-nav">
          <div class="calendar-nav-left">
            <el-button text size="small" @click="calendarPrevWeeks">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <span class="calendar-month-label">{{ calendarMonthLabel }}</span>
            <el-button text size="small" @click="calendarNextWeeks">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <el-button size="small" text @click="calendarGoToday">今日</el-button>
        </div>

        <!-- 星期表头 -->
        <div class="calendar-weekdays">
          <span v-for="d in ['一','二','三','四','五','六','日']" :key="d" class="calendar-weekday">{{ d }}</span>
        </div>

        <!-- 日历网格：3周 -->
        <div class="calendar-grid" @wheel.prevent="handleCalendarWheel">
          <div
            v-for="day in calendarDays"
            :key="day.dateStr"
            :class="[
              'calendar-cell',
              { 'has-log': day.hasLog },
              { 'is-today': day.isToday },
              { 'is-selected': day.dateStr === calendarSelectedDate },
              { 'other-month': !day.isCurrentMonth },
            ]"
            @click="handleCalendarDateClick(day)"
          >
            <span class="calendar-day-num">{{ day.dayNum }}</span>
            <span v-if="day.tag" class="calendar-tag" :class="day.tag === '休' ? 'tag-rest' : 'tag-work'">{{ day.tag }}</span>
            <span v-if="day.hasUnreadComment" class="calendar-comment-dot unread"></span>
            <span v-else-if="day.hasComment" class="calendar-comment-dot"></span>
            <span v-if="day.hasLog" class="calendar-dot"></span>
          </div>
        </div>
        </template>

        <!-- 周报（联动日历选中日期） -->
        <div v-if="currentWeekReport" class="weekly-inline">
          <div class="weekly-inline-header" @click="openWeeklyReportInEditor(currentWeekReport)">
            <div class="report-card-title">
              <el-icon class="report-icon"><Document /></el-icon>
              <span>{{ getReportLabel(currentWeekReport) }}</span>
            </div>
            <div class="weekly-inline-actions">
              <el-button size="small" :icon="Download" link @click.stop="handleExportCurrentWeek">导出</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 历史日志查看弹窗已移除，改为内联展开 -->

    <!-- 快捷短语管理弹窗 -->
    <el-dialog v-model="phraseManagerVisible" title="管理快捷短语" width="420px" :close-on-click-modal="false">
      <div class="phrase-manager">
        <div v-if="phrases.length === 0" class="phrase-manager-empty">暂无短语，在下方添加</div>
        <div v-for="(p, idx) in phrases" :key="p.id" class="phrase-manager-item">
          <template v-if="editingPhraseId === p.id">
            <el-input v-model="editingPhraseContent" size="small" style="flex:1" @keyup.enter="saveEditPhrase" />
            <el-button size="small" type="primary" @click="saveEditPhrase">保存</el-button>
            <el-button size="small" @click="editingPhraseId = ''">取消</el-button>
          </template>
          <template v-else>
            <span class="phrase-manager-text">{{ p.content }}</span>
            <div class="phrase-manager-actions">
              <el-button size="small" text :disabled="idx === 0" @click="movePhraseUp(idx)">↑</el-button>
              <el-button size="small" text :disabled="idx === phrases.length - 1" @click="movePhraseDown(idx)">↓</el-button>
              <el-button size="small" text @click="startEditPhrase(p)">编辑</el-button>
              <el-button size="small" text type="danger" @click="deletePhrase(p.id)">删除</el-button>
            </div>
          </template>
        </div>
        <div class="phrase-manager-add">
          <el-input v-model="newPhraseContent" size="small" placeholder="输入新短语..." @keyup.enter="addPhrase" />
          <el-button size="small" type="primary" @click="addPhrase" :disabled="!newPhraseContent.trim()">添加</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { ChineseOrderedList } from '@/extensions/ChineseOrderedList'
import { AiCompletion } from '@/extensions/AiCompletion'
import AiCompletionPopup from '@/components/worklog/AiCompletionPopup.vue'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Sunny,
  Cloudy,
  Close,
  UploadFilled,
  Download,
  ArrowLeft,
  ArrowRight,
  Document,
  Search,
} from '@element-plus/icons-vue'

interface Attachment {
  id: string
  fileKind: 'image' | 'document'
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  createdAt: string
  logDate?: string
}

interface HistoryComment {
  id: string
  userId: string
  content: string
  createdAt: string
  userName: string
  replyTo: string | null
  replyToUserId: string | null
  replyToUserName: string | null
  isUnread: boolean
}

interface HistorySubmission {
  id: string
  content: string
  submittedAt: string
  comments: HistoryComment[]
  supplements: { id: string; seq: number; content: string; createdAt: string; updatedAt: string }[]
}

interface HistoryGroup {
  logDate: string
  logId: string | null
  editPermission: 'free' | 'edit' | 'supplement' | 'locked'
  submissions: HistorySubmission[]
  attachments: Attachment[]
}

interface WeeklySummary {
  id: string
  weekStart: string
  weekEnd: string
  content: string
  generatedAt: string
  lockedAt: string | null
  supplements: { id: string; seq: number; content: string; createdAt: string }[]
  attachments: Attachment[]
}

const logId = ref('')
const skipNextUpdate = ref(false)
const attachments = ref<Attachment[]>([])
const weatherInfo = ref<{ text: string; temp: string; icon: string } | null>(null)
const trafficRestriction = ref<string | null>(null)
const saving = ref(false)
const submitting = ref(false)
const autoSaveTime = ref('')
const autoSaveTimer = ref<number | null>(null)

const authStore = useAuthStore()
const pendingStore = usePendingStore()

const commentInput = ref('')
const commentLoading = ref(false)
const commentReplyTarget = ref<{ id: string; userName: string } | null>(null)
const canInitiateComment = computed(() => {
  const role = authStore.user?.role
  return role && ['super_admin', 'general_manager'].includes(role)
})

const showUnreadHint = ref(false)
const unreadCommentCount = ref(0)
const isNavigatingToUnread = ref(false)

// 快捷短语
interface Phrase { id: string; content: string; sort_order: number; created_at: string }
const phrases = ref<Phrase[]>([])
const phrasePopoverVisible = ref(false)
const phraseManagerVisible = ref(false)
const newPhraseContent = ref('')
const editingPhraseId = ref('')
const editingPhraseContent = ref('')

// 补充模式
const supplementMode = ref(false)
const supplementTargetDate = ref('')
const supplementOriginalContent = ref('')
const supplementSubmissionId = ref('')

const allWeeklySummaries = ref<WeeklySummary[]>([])
const weeklySupplementEditingId = ref('')
const weeklySupplementContent = ref('')
const weeklySupplementSubmitting = ref(false)
const weeklySupplementMode = ref(false)
const weeklySupplementOriginalContent = ref('')
const weeklyReportExpandedSet = ref<Set<string>>(new Set())

// 日历视图状态
interface CalendarDay {
  dateStr: string
  dayNum: number
  hasLog: boolean
  hasComment: boolean
  hasUnreadComment: boolean
  isToday: boolean
  isCurrentMonth: boolean
  tag: '休' | '班' | null
}

const calendarBaseDate = ref(new Date())
const calendarLogDates = ref<Set<string>>(new Set())
const calendarCommentDates = ref<Set<string>>(new Set())
const calendarUnreadCommentDates = ref<Set<string>>(new Set())
const calendarHolidayMap = ref<Map<string, { name: string; type: string }>>(new Map())
const calendarSelectedDate = ref('')
const calendarPreviewGroup = ref<HistoryGroup | null>(null)
const calendarPreviewLoading = ref(false)

// 搜索
const searchKeyword = ref('')
const searching = ref(false)
const searchMode = ref(false)

function getCalendarDayTag(dateStr: string, dayOfWeek: number): '休' | '班' | null {
  const h = calendarHolidayMap.value.get(dateStr)
  if (h?.type === 'holiday') return '休'
  if (h?.type === 'workday') return '班'
  if (dayOfWeek === 0 || dayOfWeek === 6) return '休'
  return null
}

const calendarDays = computed<CalendarDay[]>(() => {
  const base = calendarBaseDate.value
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  // 找到 base 所在周的周一
  const dayOfWeek = (base.getDay() + 6) % 7
  const monday = new Date(base)
  monday.setDate(base.getDate() - dayOfWeek)

  // 往前推一周，显示3周
  const startDate = new Date(monday)
  startDate.setDate(monday.getDate() - 7)

  const days: CalendarDay[] = []
  for (let i = 0; i < 21; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    days.push({
      dateStr,
      dayNum: d.getDate(),
      hasLog: calendarLogDates.value.has(dateStr),
      hasComment: calendarCommentDates.value.has(dateStr),
      hasUnreadComment: calendarUnreadCommentDates.value.has(dateStr),
      isToday: dateStr === todayStr,
      isCurrentMonth: d.getMonth() === base.getMonth(),
      tag: getCalendarDayTag(dateStr, d.getDay()),
    })
  }
  return days
})

const calendarMonthLabel = computed(() => {
  const base = calendarBaseDate.value
  return `${base.getFullYear()}年${base.getMonth() + 1}月`
})

const currentWeekReport = computed<WeeklySummary | null>(() => {
  if (!calendarSelectedDate.value && allWeeklySummaries.value.length > 0) {
    return allWeeklySummaries.value[0]
  }
  if (!calendarSelectedDate.value) return null
  const selected = calendarSelectedDate.value
  return allWeeklySummaries.value.find(s => selected >= s.weekStart && selected <= s.weekEnd) || null
})

function canSupplementReport(summary: WeeklySummary): boolean {
  if (!summary.lockedAt) return false
  const lockedDate = new Date(summary.lockedAt)
  const lockedDayOfWeek = lockedDate.getDay() || 7
  const nextSunday = new Date(lockedDate)
  nextSunday.setDate(lockedDate.getDate() + (7 - lockedDayOfWeek) + 7)
  nextSunday.setHours(23, 59, 59, 999)
  return new Date() <= nextSunday
}

function toggleWeeklyReport(id: string) {
  const s = new Set(weeklyReportExpandedSet.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  weeklyReportExpandedSet.value = s
}

function getReportLabel(summary: WeeklySummary): string {
  const d = new Date(summary.weekStart + 'T00:00:00')
  const year = d.getFullYear()
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
  const endD = new Date(summary.weekEnd + 'T00:00:00')
  const startStr = `${d.getMonth() + 1}/${d.getDate()}`
  const endStr = `${endD.getMonth() + 1}/${endD.getDate()}`
  return `${year}-${weekNum}周周报（${startStr}日—${endStr}日）`
}

// 日历导航
function calendarPrevWeeks() {
  const d = new Date(calendarBaseDate.value)
  d.setDate(d.getDate() - 7)
  calendarBaseDate.value = d
  loadCalendarDates()
}

function calendarNextWeeks() {
  const d = new Date(calendarBaseDate.value)
  d.setDate(d.getDate() + 7)
  calendarBaseDate.value = d
  loadCalendarDates()
}

function calendarGoToday() {
  calendarBaseDate.value = new Date()
  calendarSelectedDate.value = ''
  calendarPreviewGroup.value = null
  if (viewingHistory.value || editingSubmission.value) cancelEdit()
  loadCalendarDates()
}

function handleCalendarWheel(e: WheelEvent) {
  if (e.deltaY > 0) calendarNextWeeks()
  else calendarPrevWeeks()
}

async function loadCalendarDates() {
  const days = calendarDays.value
  if (days.length === 0) return
  const startDate = days[0].dateStr
  const endDate = days[days.length - 1].dateStr
  try {
    const { data } = await api.get('/api/daily-logs/calendar-dates', {
      params: { startDate, endDate },
    })
    if (data.success) {
      calendarLogDates.value = new Set(data.data.dates)
      calendarCommentDates.value = new Set(data.data.commentDates || [])
      calendarUnreadCommentDates.value = new Set(data.data.unreadCommentDates || [])
    }
  } catch {
    // 静默
  }
}

async function loadCalendarHolidays() {
  const days = calendarDays.value
  if (days.length === 0) return
  const year = days[0].dateStr.slice(0, 4)
  try {
    const { data } = await api.get('/api/holidays', { params: { year } })
    if (data.success) {
      const map = new Map<string, { name: string; type: string }>()
      for (const h of data.data) {
        map.set(h.date, { name: h.name, type: h.type })
      }
      calendarHolidayMap.value = map
    }
  } catch { /* ignore */ }
}

async function handleCalendarDateClick(day: CalendarDay) {
  if (!day.hasLog) return
  if (day.isToday) {
    if (viewingHistory.value || editingSubmission.value) cancelEdit()
    calendarSelectedDate.value = ''
    return
  }
  calendarSelectedDate.value = day.dateStr
  calendarPreviewLoading.value = true
  try {
    const { data } = await api.get('/api/daily-logs/history', {
      params: { page: 1, pageSize: 1, startDate: day.dateStr, endDate: day.dateStr },
    })
    if (data.success && data.data.groups.length > 0) {
      const group = data.data.groups[0] as HistoryGroup
      calendarPreviewGroup.value = group
      const sub = group.submissions[0]
      if (sub) openEditSubmission(sub, group)
    }
  } catch {
    ElMessage.error('加载日志失败')
  } finally {
    calendarPreviewLoading.value = false
  }
}

function handleExportCurrentWeek() {
  if (!currentWeekReport.value) return
  handleDownloadReportById(currentWeekReport.value)
}

// 搜索功能
interface SearchCalendarCell {
  day: number
  dateStr: string
  matched: boolean
  inMonth: boolean
}
interface SearchCalendarMonth {
  key: string
  label: string
  cells: SearchCalendarCell[]
}

const searchCalendarMonths = ref<SearchCalendarMonth[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

function buildCalendarMonths(matchedDates: Set<string>): SearchCalendarMonth[] {
  if (matchedDates.size === 0) return []

  const monthKeys = new Set<string>()
  for (const dateStr of matchedDates) {
    monthKeys.add(dateStr.slice(0, 7))
  }

  const months: SearchCalendarMonth[] = []
  const sortedKeys = Array.from(monthKeys).sort().reverse()
  for (const key of sortedKeys) {
    const [year, mon] = key.split('-').map(Number)
    const firstDay = new Date(year, mon - 1, 1)
    const lastDay = new Date(year, mon, 0).getDate()
    const startWeekday = (firstDay.getDay() + 6) % 7

    const cells: SearchCalendarCell[] = []
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ day: 0, dateStr: '', matched: false, inMonth: false })
    }
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, dateStr, matched: matchedDates.has(dateStr), inMonth: true })
    }
    const remaining = (7 - cells.length % 7) % 7
    for (let i = 0; i < remaining; i++) {
      cells.push({ day: 0, dateStr: '', matched: false, inMonth: false })
    }

    months.push({ key, label: `${year}年${mon}月`, cells })
  }
  return months
}

watch(searchKeyword, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  const kw = val.trim()
  if (!kw) {
    searchMode.value = false
    searchCalendarMonths.value = []
    nextTick(() => highlightKeywordInEditor())
    return
  }
  searchTimer = setTimeout(() => {
    void doSearch(kw)
  }, 300)
})

async function doSearch(kw: string) {
  searching.value = true
  searchMode.value = true
  try {
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    const startDate = threeMonthsAgo.toISOString().slice(0, 10)
    const { data } = await api.get('/api/daily-logs/history', {
      params: { keyword: kw, pageSize: 200, startDate },
    })
    if (data.success) {
      const groups: HistoryGroup[] = data.data.groups
      const matchedDates = new Set(groups.map(g => g.logDate))
      searchCalendarMonths.value = buildCalendarMonths(matchedDates)
    }
  } catch {
    ElMessage.error('搜索失败')
  } finally {
    searching.value = false
    await nextTick()
    highlightKeywordInEditor()
  }
}

function handleSearch() {
  const kw = searchKeyword.value.trim()
  if (!kw) return
  if (searchTimer) clearTimeout(searchTimer)
  void doSearch(kw)
}

function clearSearch() {
  searchKeyword.value = ''
  searchMode.value = false
  searchCalendarMonths.value = []
}

async function handleSearchDateClick(dateStr: string) {
  calendarSelectedDate.value = dateStr
  calendarPreviewLoading.value = true
  try {
    const { data } = await api.get('/api/daily-logs/history', {
      params: { page: 1, pageSize: 1, startDate: dateStr, endDate: dateStr },
    })
    if (data.success && data.data.groups.length > 0) {
      const group = data.data.groups[0] as HistoryGroup
      calendarPreviewGroup.value = group
      const sub = group.submissions[0]
      if (sub) {
        openEditSubmission(sub, group)
        await nextTick()
        highlightKeywordInEditor()
      }
    }
  } catch {
    ElMessage.error('加载日志失败')
  } finally {
    calendarPreviewLoading.value = false
  }
}

function highlightKeywordInEditor() {
  const kw = searchKeyword.value.trim()
  if (!editor.value) return
  const el = editor.value.view.dom as HTMLElement

  // 先清除之前的高亮
  const existingMarks = el.querySelectorAll('mark.search-highlight')
  existingMarks.forEach(mark => {
    const parent = mark.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
      parent.normalize()
    }
  })

  if (!kw) return

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }
  for (const node of textNodes) {
    const text = node.textContent || ''
    const regex = new RegExp(`(${escaped})`, 'gi')
    if (!regex.test(text)) continue
    regex.lastIndex = 0
    const frag = document.createDocumentFragment()
    let lastIdx = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)))
      }
      const mark = document.createElement('mark')
      mark.className = 'search-highlight'
      mark.textContent = match[1]
      frag.appendChild(mark)
      lastIdx = regex.lastIndex
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)))
    }
    node.parentNode?.replaceChild(frag, node)
  }
}

// TipTap 编辑器
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: '记录一下今天的温柔瞬间吧...' }),
    ChineseOrderedList,
    AiCompletion,
  ],
  onUpdate: () => {
    if (skipNextUpdate.value) {
      skipNextUpdate.value = false
      return
    }
    if (viewingHistory.value || editingSubmission.value || supplementMode.value || weeklySupplementMode.value) return
    triggerAutoSave()
  },
  onTransaction: () => {
    requestAnimationFrame(updateLineNumbers)
  },
  onCreate: () => {
    setTimeout(updateLineNumbers, 50)
  },
})

function updateLineNumbers() {
  if (!editor.value) return
  const el = editor.value.view.dom as HTMLElement
  if (!el) return
  const containerRect = el.getBoundingClientRect()

  const result: { num: number; top: number; height: number }[] = []
  let lineNum = 0
  let cursorLineNum = 0

  const cursorPos = editor.value.state.selection.$head
  const cursorNode = editor.value.view.domAtPos(cursorPos.pos)
  const cursorElement = cursorNode.node instanceof HTMLElement
    ? cursorNode.node
    : cursorNode.node.parentElement

  // 先收集所有节点信息
  const nodes: { node: Element; hasContent: boolean; isCursor: boolean; top: number; height: number }[] = []

  const collectNode = (node: Element) => {
    const tag = node.tagName.toLowerCase()
    if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const text = (node.textContent || '').trim()
      const isCursor = !!(cursorElement && node.contains(cursorElement))
      const rect = node.getBoundingClientRect()
      nodes.push({ node, hasContent: text.length > 0, isCursor, top: rect.top - containerRect.top, height: rect.height })
    } else if (tag === 'li') {
      const firstP = node.querySelector(':scope > p')
      const text = (firstP || node).textContent?.trim() || ''
      const isCursor = !!(cursorElement && node.contains(cursorElement))
      const measureEl = firstP || node
      const rect = measureEl.getBoundingClientRect()
      const liRect = node.getBoundingClientRect()
      nodes.push({ node, hasContent: text.length > 0, isCursor, top: liRect.top - containerRect.top, height: rect.height })
      for (const child of Array.from(node.children)) {
        const childTag = child.tagName.toLowerCase()
        if (childTag === 'ol' || childTag === 'ul') {
          for (const nested of Array.from(child.children)) {
            collectNode(nested)
          }
        }
      }
    } else if (tag === 'ol' || tag === 'ul') {
      for (const child of Array.from(node.children)) {
        collectNode(child)
      }
    }
  }

  for (const child of Array.from(el.children)) {
    collectNode(child)
  }

  // 找到最后一个有内容的节点索引和光标索引
  let lastContentIdx = -1
  let cursorIdx = -1
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (lastContentIdx < 0 && nodes[i].hasContent) lastContentIdx = i
    if (cursorIdx < 0 && nodes[i].isCursor) cursorIdx = i
  }
  const showUpTo = editor.value.isEditable ? Math.max(lastContentIdx, cursorIdx) : lastContentIdx

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (i <= showUpTo) {
      lineNum++
      result.push({ num: lineNum, top: n.top, height: n.height })
      if (n.isCursor) {
        cursorLineNum = lineNum
      }
    }
  }

  lineNumbers.value = result
  activeLineNum.value = cursorLineNum
}

const wordCount = computed(() => {
  if (!editor.value) return 0
  return editor.value.getText().replace(/\s/g, '').length
})

const isEditorEmpty = computed(() => {
  if (!editor.value) return true
  return editor.value.isEmpty
})

const lineNumbers = ref<{ num: number; top: number; height: number }[]>([])
const activeLineNum = ref<number>(0)
// 记录曾经激活过的最大行索引（光标到达过的最远位置）
function focusEditor() {
  editor.value?.commands.focus()
}

function handleLiftListItem() {
  if (!editor.value) return
  const { state } = editor.value
  const { $from } = state.selection

  // 找到当前 listItem
  let listItemDepth = -1
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'listItem') {
      listItemDepth = d
      break
    }
  }
  if (listItemDepth < 0) return

  const parentListDepth = listItemDepth - 1
  if (parentListDepth < 0) return
  const parentList = $from.node(parentListDepth)

  // 不在有序/无序列表中
  if (parentList.type.name !== 'orderedList' && parentList.type.name !== 'bulletList') return

  // 尝试标准 liftListItem
  const before = state.doc.toString()
  editor.value.chain().focus().liftListItem('listItem').run()

  // 检查文档是否变化（liftListItem 是否生效）
  requestAnimationFrame(() => {
    if (!editor.value) return
    const after = editor.value.state.doc.toString()
    if (before === after) {
      // liftListItem 未生效，尝试用 lift 命令
      editor.value.chain().focus().lift(parentList.type.name).run()
    }
  })
}

function getEditorHtml(): string {
  const html = editor.value?.getHTML() ?? ''
  return html.replace(/(<p><\/p>)+$/, '')
}

function getFullContentHtml(): string {
  const dateHtml = `<p class="log-date"><strong>${formattedDate.value}</strong> ${weekdayText.value}</p>`
  const editorHtml = getEditorHtml()
  return dateHtml + editorHtml
}

function setEditorContent(html: string) {
  if (!editor.value) return
  skipNextUpdate.value = true
  let stripped = html.replace(/^<p class="log-date">.*?<\/p>/, '')
  stripped = stripped.replace(/<mark[^>]*>(.*?)<\/mark>/gi, '$1')
  editor.value.commands.setContent(stripped || '')
  requestAnimationFrame(updateLineNumbers)
}

const currentLogDate = computed(() => {
  if (editingGroup.value?.logDate) {
    return new Date(editingGroup.value.logDate + 'T00:00:00')
  }
  if (supplementTargetDate.value) {
    return new Date(supplementTargetDate.value + 'T00:00:00')
  }
  return new Date()
})

function formatSupplementTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const formattedDate = computed(() => {
  if (viewingWeeklyReport.value && currentWeekReport.value) {
    const s = new Date(currentWeekReport.value.weekStart + 'T00:00:00')
    const e = new Date(currentWeekReport.value.weekEnd + 'T00:00:00')
    return `${s.getMonth() + 1}月${s.getDate()}日—${e.getMonth() + 1}月${e.getDate()}日 周报`
  }
  if (weeklySupplementMode.value && weeklySupplementEditingId.value) {
    const report = allWeeklySummaries.value.find(r => r.id === weeklySupplementEditingId.value)
    if (report) {
      const s = new Date(report.weekStart + 'T00:00:00')
      const e = new Date(report.weekEnd + 'T00:00:00')
      return `${s.getMonth() + 1}月${s.getDate()}日—${e.getMonth() + 1}月${e.getDate()}日 周报补充`
    }
  }
  const d = currentLogDate.value
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

const weekdayText = computed(() => {
  if (viewingWeeklyReport.value || weeklySupplementMode.value) return ''
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return days[currentLogDate.value.getDay()]
})

const imagePreviewList = computed(() =>
  attachments.value
    .filter(a => a.fileKind === 'image')
    .map(a => `/${a.filePath}`)
)

const imageAttachments = computed(() =>
  attachments.value.filter(a => a.fileKind === 'image')
)

const docAttachments = computed(() => {
  const extOrder: Record<string, number> = { pdf: 0, doc: 1, docx: 1, xls: 2, xlsx: 2 }
  return attachments.value
    .filter(a => a.fileKind === 'document')
    .sort((a, b) => {
      const extA = a.fileName.split('.').pop()?.toLowerCase() || ''
      const extB = b.fileName.split('.').pop()?.toLowerCase() || ''
      return (extOrder[extA] ?? 9) - (extOrder[extB] ?? 9)
    })
})

const uploadHeaders = computed(() => ({}))



async function loadTodayLog() {
  try {
    const { data } = await api.get('/api/daily-logs/today')
    if (data.success) {
      const log = data.data
      logId.value = log.id
      attachments.value = log.attachments || []
      setEditorContent(log.content)
    }
  } catch (err) {
    console.error('加载今日日志失败:', err)
  }
}

async function loadDayInfo() {
  try {
    const { data } = await api.get('/api/daily-logs/info')
    if (data.success) {
      weatherInfo.value = data.data.weather
      trafficRestriction.value = data.data.trafficRestriction
    }
  } catch {
    // 天气信息获取失败不影响使用
  }
}

async function loadWeeklySummary() {
  try {
    const { data } = await api.get('/api/daily-logs/weekly-summaries')
    if (data.success) {
      allWeeklySummaries.value = data.data
    }
  } catch {
    // 周报加载失败不影响使用
  }
}

async function loadPhrases() {
  try {
    const { data } = await api.get('/api/daily-logs/phrases')
    if (data.success) phrases.value = data.data
  } catch { /* 静默 */ }
}

function insertPhrase(content: string) {
  if (!editor.value) return
  editor.value.chain().focus().insertContent(content).run()
  phrasePopoverVisible.value = false
}

function openPhraseManager() {
  phrasePopoverVisible.value = false
  phraseManagerVisible.value = true
}

async function addPhrase() {
  if (!newPhraseContent.value.trim()) return
  try {
    const { data } = await api.post('/api/daily-logs/phrases', { content: newPhraseContent.value.trim() })
    if (data.success) {
      phrases.value.push(data.data)
      newPhraseContent.value = ''
    }
  } catch { ElMessage.error('添加失败') }
}

function startEditPhrase(p: Phrase) {
  editingPhraseId.value = p.id
  editingPhraseContent.value = p.content
}

async function saveEditPhrase() {
  if (!editingPhraseContent.value.trim() || !editingPhraseId.value) return
  try {
    const { data } = await api.put(`/api/daily-logs/phrases/${editingPhraseId.value}`, { content: editingPhraseContent.value.trim() })
    if (data.success) {
      const idx = phrases.value.findIndex(p => p.id === editingPhraseId.value)
      if (idx >= 0) phrases.value[idx].content = editingPhraseContent.value.trim()
      editingPhraseId.value = ''
      editingPhraseContent.value = ''
    }
  } catch { ElMessage.error('更新失败') }
}

async function deletePhrase(id: string) {
  try {
    const { data } = await api.delete(`/api/daily-logs/phrases/${id}`)
    if (data.success) phrases.value = phrases.value.filter(p => p.id !== id)
  } catch { ElMessage.error('删除失败') }
}

async function movePhraseUp(index: number) {
  if (index <= 0) return
  const arr = [...phrases.value]
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
  phrases.value = arr
  await api.put('/api/daily-logs/phrases/reorder', { ids: arr.map(p => p.id) }).catch(() => {})
}

async function movePhraseDown(index: number) {
  if (index >= phrases.value.length - 1) return
  const arr = [...phrases.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
  phrases.value = arr
  await api.put('/api/daily-logs/phrases/reorder', { ids: arr.map(p => p.id) }).catch(() => {})
}

function triggerAutoSave() {
  if (autoSaveTimer.value) clearTimeout(autoSaveTimer.value)
  autoSaveTimer.value = window.setTimeout(async () => {
    // 再次检查状态，防止延迟期间切换到查看/编辑模式
    if (viewingHistory.value || viewingWeeklyReport.value || editingSubmission.value || supplementMode.value || weeklySupplementMode.value) return
    if (isEditorEmpty.value) return
    const html = getFullContentHtml()
    try {
      await api.post('/api/daily-logs/save', { content: html })
      autoSaveTime.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } catch {
      // 自动保存失败静默处理
    }
  }, 3000)
}

async function handleSave() {
  saving.value = true
  try {
    const html = getFullContentHtml()
    const { data } = await api.post('/api/daily-logs/save', { content: html })
    if (data.success) {
      if (!logId.value) logId.value = data.data.id
      autoSaveTime.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      ElMessage.success('已暂存')
    }
  } catch {
    ElMessage.error('暂存失败')
  } finally {
    saving.value = false
  }
}

function cancelSupplement() {
  supplementMode.value = false
  supplementSubmissionId.value = ''
  supplementOriginalContent.value = ''
  supplementTargetDate.value = ''
  attachments.value = []
  savedTodayAttachments.value = []
  logId.value = savedLogId.value
  savedLogId.value = ''
  loadTodayLog()
}

async function handleSaveSupplement() {
  if (isEditorEmpty.value) {
    ElMessage.warning('补充内容不能为空')
    return
  }
  const html = getFullContentHtml()
  submitting.value = true
  try {
    const { data } = await api.post(`/api/daily-logs/submissions/${supplementSubmissionId.value}/supplement`, { content: html })
    if (data.success) {
      ElMessage.success('补充保存成功')
      supplementMode.value = false
      supplementSubmissionId.value = ''
      supplementOriginalContent.value = ''
      supplementTargetDate.value = ''
      skipNextUpdate.value = true
      editor.value?.commands.clearContent()
      attachments.value = []
      savedTodayAttachments.value = []
      logId.value = savedLogId.value
      savedLogId.value = ''
      loadTodayLog()
      loadCalendarDates()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '补充保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleClear() {
  try {
    await ElMessageBox.confirm('确定要清除当前日志内容吗？', '确认清除', {
      type: 'warning',
    })
  } catch {
    return
  }

  if (logId.value) {
    try {
      await api.delete(`/api/daily-logs/${logId.value}/clear`)
      skipNextUpdate.value = true
      editor.value?.commands.clearContent()
      attachments.value = []
      autoSaveTime.value = ''
      ElMessage.success('已清除')
    } catch {
      ElMessage.error('清除失败')
    }
  } else {
    skipNextUpdate.value = true
    editor.value?.commands.clearContent()
    attachments.value = []
    autoSaveTime.value = ''
  }
}

function handleUploadSuccess(response: any) {
  if (response.success) {
    attachments.value.push(response.data)
    ElMessage.success('上传成功')
  }
}

function handleUploadError() {
  ElMessage.error('上传失败')
}

function beforeUpload(file: File) {
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('文件大小不能超过 10MB')
    return false
  }
  if (!logId.value) {
    ElMessage.warning('请先暂存日志后再上传附件')
    return false
  }
  const allowedMimes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]
  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx']
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!allowedMimes.includes(file.type) && !allowedExts.includes(ext)) {
    ElMessage.warning('仅支持图片(JPG/PNG/GIF/WebP)和文档(PDF/Word/Excel)')
    return false
  }
  return true
}

async function handleRemoveAttachment(att: Attachment) {
  try {
    await ElMessageBox.confirm(`确定删除附件「${att.fileName}」？`, '确认删除')
  } catch {
    return
  }
  try {
    await api.delete(`/api/daily-logs/attachments/${att.id}`)
    attachments.value = attachments.value.filter(a => a.id !== att.id)
    ElMessage.success('已删除')
  } catch {
    ElMessage.error('删除失败')
  }
}

function getFileExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase() || ''
  return ext.length > 4 ? ext.slice(0, 4) : ext
}

function handleDocPreview(att: Attachment) {
  window.open(`/api/daily-logs/attachments/${att.id}/preview`, '_blank')
}

function getExtClass(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'ext-pdf'
  if (['doc', 'docx'].includes(ext)) return 'ext-word'
  if (['xls', 'xlsx'].includes(ext)) return 'ext-excel'
  return 'ext-other'
}


function splitReportByDate(report: WeeklySummary): { html: string; date: string; attachments: Attachment[] }[] {
  const content = report.content || ''
  const attachments = report.attachments || []

  // 按【YYYY-MM-DD】分割内容
  const datePattern = /【(\d{4}-\d{2}-\d{2})】/g
  const matches = [...content.matchAll(datePattern)]

  if (matches.length === 0) {
    return [{ html: content, date: '', attachments }]
  }

  const sections: { html: string; date: string; attachments: Attachment[] }[] = []

  // 如果第一个日期标记前有内容
  if (matches[0].index! > 0) {
    const before = content.slice(0, matches[0].index!).trim()
    if (before) sections.push({ html: before, date: '', attachments: [] })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length
    const date = matches[i][1]
    const html = content.slice(start, end).trim()
    const dayAtts = attachments.filter(a => a.logDate === date)
    sections.push({ html, date, attachments: dayAtts })
  }

  return sections
}

function handleDownloadReportById(report: WeeklySummary) {
  const url = `/api/daily-logs/weekly-summary/download?weekStart=${report.weekStart}&weekEnd=${report.weekEnd}`
  window.open(url, '_blank')
}

function startWeeklySupplement(report: WeeklySummary) {
  weeklySupplementEditingId.value = report.id
  weeklySupplementContent.value = ''
  weeklySupplementMode.value = true
  weeklySupplementOriginalContent.value = report.content || ''
  // 退出查看模式，进入补充编辑模式
  viewingHistory.value = false
  viewingWeeklyReport.value = false
  editor.value?.setEditable(true)
  editor.value?.commands.clearContent()
  editor.value?.commands.focus()
}

async function handleWeeklySupplementSubmit() {
  if (!weeklySupplementEditingId.value) return
  const html = getFullContentHtml()
  if (!html || html === '<p></p>') {
    ElMessage.warning('补充内容不能为空')
    return
  }
  weeklySupplementSubmitting.value = true
  try {
    const { data } = await api.post(`/api/daily-logs/weekly-summary/${weeklySupplementEditingId.value}/supplement`, {
      content: html,
    })
    if (data.success) {
      const report = allWeeklySummaries.value.find(r => r.id === weeklySupplementEditingId.value)
      if (report) report.supplements.push(data.data)
      cancelWeeklySupplement()
      ElMessage.success('补充提交成功')
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '补充提交失败')
  } finally {
    weeklySupplementSubmitting.value = false
  }
}

function cancelWeeklySupplement() {
  weeklySupplementMode.value = false
  weeklySupplementEditingId.value = ''
  weeklySupplementContent.value = ''
  weeklySupplementOriginalContent.value = ''
  attachments.value = []
  savedTodayAttachments.value = []
  logId.value = savedLogId.value
  savedLogId.value = ''
  skipNextUpdate.value = true
  editor.value?.commands.clearContent()
  loadTodayLog()
}

// 编辑已提交日志：加载到主编辑器
const viewingHistory = ref(false)
const viewingWeeklyReport = ref(false)
const editingSubmission = ref<HistorySubmission | null>(null)
const savedTodayAttachments = ref<Attachment[]>([])
const editingGroup = ref<HistoryGroup | null>(null)

const savedLogId = ref('')

function openEditSubmission(sub: HistorySubmission, group: HistoryGroup) {
  // 取消待执行的自动保存
  if (autoSaveTimer.value) { clearTimeout(autoSaveTimer.value); autoSaveTimer.value = null }
  // 清除所有补充模式状态
  if (weeklySupplementMode.value) {
    weeklySupplementMode.value = false
    weeklySupplementEditingId.value = ''
    weeklySupplementOriginalContent.value = ''
  }
  if (supplementMode.value) {
    supplementMode.value = false
    supplementSubmissionId.value = ''
    supplementOriginalContent.value = ''
    supplementTargetDate.value = ''
  }
  savedTodayAttachments.value = [...attachments.value]
  savedLogId.value = logId.value
  viewingHistory.value = true
  viewingWeeklyReport.value = false
  editingSubmission.value = sub
  editingGroup.value = group
  attachments.value = [...(group.attachments || [])]
  if (group.logId) logId.value = group.logId
  setEditorContent(sub.content || '')
  editor.value?.setEditable(false)
  commentInput.value = ''
  commentReplyTarget.value = null
  markCommentsRead(sub)
}

function canWithdraw(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 5 * 60 * 1000
}

function setCommentReply(comment: HistoryComment) {
  commentReplyTarget.value = { id: comment.id, userName: comment.userName }
}

function cancelCommentReply() {
  commentReplyTarget.value = null
}

async function markCommentsRead(sub: HistorySubmission) {
  const hasUnread = sub.comments?.some(c => c.isUnread)
  if (!hasUnread) return
  try {
    await api.post('/api/daily-logs/comments/mark-read', { submissionIds: [sub.id] })
    showUnreadHint.value = false
    loadCalendarDates()
    setTimeout(() => pendingStore.fetchPendingCounts(), 500)
    setTimeout(() => {
      for (const c of sub.comments) {
        c.isUnread = false
      }
    }, 3000)
  } catch { /* ignore */ }
}

async function submitComment() {
  if (!editingSubmission.value) return
  const content = commentInput.value.trim()
  if (!content) return

  commentLoading.value = true
  try {
    const replyTo = commentReplyTarget.value?.id || undefined
    const { data } = await api.post(`/api/daily-logs/comments/${editingSubmission.value.id}/reply`, { content, replyTo })
    if (data.success) {
      if (!editingSubmission.value.comments) editingSubmission.value.comments = []
      editingSubmission.value.comments.push(data.data)
      commentInput.value = ''
      commentReplyTarget.value = null
    }
  } catch {
    ElMessage.error('评论失败')
  } finally {
    commentLoading.value = false
  }
}

async function withdrawComment(commentId: string) {
  try {
    await ElMessageBox.confirm('确定撤回这条评论吗？', '撤回确认', { type: 'warning', confirmButtonText: '撤回', cancelButtonText: '取消' })
  } catch { return }
  try {
    const { data } = await api.post(`/api/daily-logs/comments/${commentId}/withdraw`)
    if (data.success && editingSubmission.value) {
      editingSubmission.value.comments = editingSubmission.value.comments.filter(c => c.id !== commentId)
      ElMessage.success('已撤回')
      pendingStore.refreshPendingCounts()
      loadCalendarDates()
    }
  } catch {
    ElMessage.error('撤回失败')
  }
}

function formatCommentTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function checkUnreadComments() {
  try {
    const { data } = await api.get('/api/daily-logs/comments/unread-date')
    if (data.success && data.data.count > 0) {
      unreadCommentCount.value = data.data.count
      showUnreadHint.value = true
    }
  } catch { /* ignore */ }
}

async function goToUnreadComment() {
  showUnreadHint.value = false
  isNavigatingToUnread.value = true
  try {
    const { data } = await api.get('/api/daily-logs/comments/unread-date')
    if (data.success && data.data.date) {
      calendarSelectedDate.value = data.data.date
      calendarPreviewLoading.value = true
      const res = await api.get('/api/daily-logs/history', {
        params: { page: 1, pageSize: 1, startDate: data.data.date, endDate: data.data.date },
      })
      if (res.data.success && res.data.data.groups.length > 0) {
        const group = res.data.data.groups[0] as HistoryGroup
        calendarPreviewGroup.value = group
        const sub = group.submissions[0]
        if (sub) openEditSubmission(sub, group)
      }
      calendarPreviewLoading.value = false
      await nextTick()
      const unreadEl = document.querySelector('.comment-item-unread')
      if (unreadEl) {
        unreadEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    // 标记已读后刷新 pendingStore，确保后续未读能及时触发提示
    setTimeout(() => {
      pendingStore.fetchPendingCounts()
      isNavigatingToUnread.value = false
    }, 500)
  } catch {
    isNavigatingToUnread.value = false
    ElMessage.error('加载未读评论失败')
  }
}

function enableEditMode() {
  if (!editingGroup.value || !editingSubmission.value) return

  const permission = editingGroup.value.editPermission

  if (permission === 'locked') {
    ElMessage.warning('周报已锁定，不可编辑')
    return
  }

  if (permission === 'supplement') {
    // 进入补充模式
    viewingHistory.value = false
    supplementMode.value = true
    supplementTargetDate.value = editingGroup.value.logDate
    supplementOriginalContent.value = editingSubmission.value.content
    supplementSubmissionId.value = editingSubmission.value.id
    editingSubmission.value = null
    editingGroup.value = null
    editor.value?.setEditable(true)
    editor.value?.commands.clearContent()
    editor.value?.commands.focus()
    return
  }

  // edit 模式：直接编辑原文
  viewingHistory.value = false
  editor.value?.setEditable(true)
  editor.value?.commands.focus()
}

function cancelEdit() {
  viewingHistory.value = false
  viewingWeeklyReport.value = false
  weeklySupplementMode.value = false
  weeklySupplementEditingId.value = ''
  weeklySupplementOriginalContent.value = ''
  editingSubmission.value = null
  editingGroup.value = null
  attachments.value = []
  savedTodayAttachments.value = []
  logId.value = savedLogId.value
  savedLogId.value = ''
  editor.value?.setEditable(true)
  loadTodayLog()
}

async function openWeeklyReportInEditor(report: WeeklySummary) {
  // 取消待执行的自动保存
  if (autoSaveTimer.value) { clearTimeout(autoSaveTimer.value); autoSaveTimer.value = null }
  // 清除周报补充模式
  if (weeklySupplementMode.value) {
    weeklySupplementMode.value = false
    weeklySupplementEditingId.value = ''
    weeklySupplementOriginalContent.value = ''
  }
  savedTodayAttachments.value = [...attachments.value]
  savedLogId.value = logId.value
  viewingHistory.value = true
  viewingWeeklyReport.value = true
  editingSubmission.value = null
  editingGroup.value = null
  attachments.value = [...(report.attachments || [])]
  const html = report.content || ''
  setEditorContent(html)
  editor.value?.setEditable(false)

  // 获取该周最后一天的 logId 用于上传附件
  try {
    const { data } = await api.get('/api/daily-logs/history', {
      params: { startDate: report.weekStart, endDate: report.weekEnd, pageSize: 1 },
    })
    if (data.success && data.data.groups.length > 0) {
      const group = data.data.groups[0]
      if (group.logId) logId.value = group.logId
    }
  } catch {
    // 静默
  }
}

async function handleSaveEditSubmission() {
  if (!editingSubmission.value) return
  if (isEditorEmpty.value) {
    ElMessage.warning('日志内容不能为空')
    return
  }
  const html = getFullContentHtml()
  submitting.value = true
  try {
    const { data } = await api.put(`/api/daily-logs/submissions/${editingSubmission.value.id}`, { content: html })
    if (data.success) {
      editingSubmission.value.content = html
      editingSubmission.value.submittedAt = data.data.submittedAt
      if (editingGroup.value) {
        editingGroup.value.attachments = [...attachments.value]
      }
      // 保存成功后切回只读查看模式，让用户确认修改已生效
      viewingHistory.value = true
      editor.value?.setEditable(false)
      setEditorContent(html)
      ElMessage.success('修改成功')
      loadCalendarDates()
    }
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '修改失败')
  } finally {
    submitting.value = false
  }
}

let commentPollTimer: number | null = null

onMounted(async () => {
  loadTodayLog()
  loadDayInfo()
  loadWeeklySummary()
  loadPhrases()
  loadCalendarDates()
  loadCalendarHolidays()
  checkUnreadComments()
  // 轮询刷新评论列表（撤回后接收方即时感知）
  commentPollTimer = window.setInterval(async () => {
    if (viewingHistory.value && editingSubmission.value && editingSubmission.value.comments && editingSubmission.value.comments.length > 0) {
      try {
        const { data } = await api.get(`/api/daily-logs/team/comments/${editingSubmission.value.id}`)
        if (data.success && editingSubmission.value) {
          editingSubmission.value.comments = data.data
        }
      } catch { /* ignore */ }
    }
  }, 5000)
})

watch(() => pendingStore.counts.unreadLogComments, (newVal) => {
  if (newVal > 0 && !isNavigatingToUnread.value) {
    unreadCommentCount.value = newVal
    showUnreadHint.value = true
    loadCalendarDates()
  } else if (newVal === 0) {
    showUnreadHint.value = false
    unreadCommentCount.value = 0
    loadCalendarDates()
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
  if (commentPollTimer) {
    clearInterval(commentPollTimer)
    commentPollTimer = null
  }
})
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
  animation: flash-hint 0.6s ease-in-out 3;
}

.comment-hint-bar:hover {
  background: #d9ecff;
}

@keyframes flash-hint {
  0%, 100% { background: #ecf5ff; }
  50% { background: #409eff; color: #fff; }
}

.daily-log-page {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
}

/* 左栏 */
.left-panel {
  flex: 1;
  min-width: 0;
}

.meta-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.weather-tag,
.traffic-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #555;
  background: #f5f5f5;
  padding: 4px 12px;
  border-radius: 20px;
}

.traffic-tag {
  color: #d48806;
  background: #fffbe6;
  border: 1px solid #ffe58f;
}

.traffic-tag.no-restriction {
  color: #389e0d;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}

.editor-date-bar {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 20px 10px;
  border-bottom: 1px solid #f0f0f0;
}

.editor-date-bar .date-text {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.5px;
}

.editor-date-bar .weekday {
  font-size: 14px;
  color: #888;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 16px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 8px;
  font-weight: 500;
}

.status-banner.editing {
  background: #fff7e6;
  border-color: #ffc53d;
  box-shadow: 0 2px 8px rgba(250, 140, 22, 0.12);
}

.status-banner.editing .status-hint {
  color: #d48806;
}

.status-banner.viewing {
  background: #e6f7ff;
  border-color: #69b1ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
}

.status-banner.viewing .status-hint {
  color: #096dd9;
}

.status-hint {
  font-size: 12px;
  color: #52c41a;
}

/* 编辑区 */
.editor-area {
  margin-bottom: 14px;
  border: 2px solid #e8e8e8;
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.3s, box-shadow 0.3s, background 0.3s;
  background: #fafbfc;
}

.editor-area:focus-within {
  border-color: #4f46e5;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.05);
}

.editor-area.editor-viewing {
  border-color: #69b1ff;
  background: #f8fbff;
  box-shadow: 0 0 0 3px rgba(24, 144, 255, 0.08);
}

.editor-area.editor-editing-history {
  border-color: #ffa940;
  background: #fffdf8;
  box-shadow: 0 0 0 3px rgba(250, 140, 22, 0.1);
}

.editor-area.editor-weekly-supplement {
  border-color: #73d13d;
  background: #fcfff6;
  box-shadow: 0 0 0 3px rgba(82, 196, 26, 0.1);
}

/* 工具栏 */
.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: #e8e8e8;
  margin: 0 6px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #555;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: #f0f0f0;
  color: #1a1a1a;
}

.toolbar-btn.active {
  background: #ede9fe;
  color: #4f46e5;
}

/* TipTap 编辑器内容区 */
.tiptap-wrapper {
  position: relative;
  cursor: text;
}

.tiptap-content-wrapper {
  position: relative;
}

.line-gutter {
  position: absolute;
  left: 0;
  top: 16px;
  width: 44px;
  pointer-events: none;
  user-select: none;
}

.line-gutter-num {
  position: absolute;
  left: 0;
  width: 36px;
  text-align: right;
  font-size: 14px;
  color: #c0c4cc;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  transform: translateY(-50%);
  transition: color 0.15s;
}

.line-gutter-num.active {
  color: #666;
}

.tiptap-content {
  padding: 16px 24px 36px 0;
}

:deep(.ProseMirror) {
  outline: none;
  min-height: 420px;
  font-size: 15px;
  line-height: 1.9;
  color: #333;
  padding-left: 48px;
}

:deep(.ProseMirror p) {
  margin: 0;
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #c0c0c0;
  pointer-events: none;
  float: left;
  height: 0;
}

/* 标题层级 */
:deep(.ProseMirror h1) {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
  margin: 20px 0 8px;
  padding-bottom: 6px;
  border-bottom: 2px solid #4f46e5;
  line-height: 1.4;
}

:deep(.ProseMirror h2) {
  font-size: 17px;
  font-weight: 600;
  color: #2d2d2d;
  margin: 16px 0 6px;
  padding-left: 10px;
  border-left: 3px solid #4f46e5;
  line-height: 1.4;
}

:deep(.ProseMirror h3) {
  font-size: 15px;
  font-weight: 600;
  color: #444;
  margin: 12px 0 4px;
  padding-left: 10px;
  border-left: 3px solid #a5b4fc;
  line-height: 1.4;
}

/* 有序列表 — 文中数字格式，标签由 JS 扩展注入 data-list-label */
:deep(.ProseMirror ol) {
  list-style: none;
  padding-left: 0;
  margin: 4px 0 8px;
}

:deep(.ProseMirror ol > li) {
  margin-bottom: 4px;
  line-height: 1.8;
  padding-left: 2.4em;
  position: relative;
}

:deep(.ProseMirror ol > li::before) {
  content: attr(data-list-label);
  position: absolute;
  left: 0;
  white-space: nowrap;
  color: #333;
}

:deep(.ProseMirror ol ol) {
  margin: 2px 0 4px;
  padding-left: 0;
}

:deep(.ProseMirror ol ol ol) {
  padding-left: 0;
}

:deep(.ProseMirror ol ol ol ol) {
  padding-left: 0;
}

/* 五级及以上：自动破折号引导，靠缩进体现层级 */
:deep(.ProseMirror ol ol ol ol ol > li) {
  padding-left: 1.8em;
}

:deep(.ProseMirror ol ol ol ol ol > li::before) {
  top: -0.1em;
}

/* 无序列表 */
:deep(.ProseMirror ul) {
  padding-left: 24px;
  margin: 4px 0 8px;
}

:deep(.ProseMirror ul li) {
  margin-bottom: 4px;
  line-height: 1.8;
}

/* 任务清单 */
:deep(.ProseMirror ul[data-type='taskList']) {
  padding-left: 4px;
  list-style: none;
}

:deep(.ProseMirror ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

:deep(.ProseMirror ul[data-type='taskList'] li > label) {
  flex-shrink: 0;
  margin-top: 3px;
}

:deep(.ProseMirror ul[data-type='taskList'] li > div) {
  flex: 1;
}

:deep(.ProseMirror ul[data-type='taskList'] li[data-checked='true'] > div) {
  text-decoration: line-through;
  color: #aaa;
}

/* 加粗、斜体 — font-synthesis: none 全局继承会阻止合成字形，需显式覆盖 */
:deep(.ProseMirror) {
  font-synthesis: weight style;
}

:deep(.ProseMirror strong) {
  font-weight: 700 !important;
  color: #1a1a1a;
}

:deep(.ProseMirror em) {
  font-style: italic !important;
  color: #555;
}

/* 字数统计 */
.word-count {
  position: absolute;
  bottom: 8px;
  right: 16px;
  font-size: 12px;
  color: #bbb;
  pointer-events: none;
  user-select: none;
}

/* 附件卡片 */
.attach-row {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
}

.attach-card {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 12px;
}

.attach-card-header {
  margin-bottom: 10px;
}

.attach-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #444;
}

.attach-count {
  font-weight: 400;
  color: #999;
}

/* 图片网格 */
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.image-item {
  position: relative;
}

.image-thumb {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  cursor: pointer;
  border: 1px solid #e8e8e8;
  transition: border-color 0.2s;
}

.image-thumb:hover {
  border-color: #c0c4cc;
}

.remove-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px !important;
  height: 18px !important;
}

/* 文档网格 */
.doc-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.doc-card {
  position: relative;
  width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.doc-card:hover {
  background: #f0f2f5;
}

.doc-card-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.doc-card-icon.ext-pdf {
  background: #fef0f0;
  border: 1px solid #fde2e2;
}

.doc-card-icon.ext-word {
  background: #ecf5ff;
  border: 1px solid #d9ecff;
}

.doc-card-icon.ext-excel {
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
}

.doc-card-icon.ext-other {
  background: #f4f4f5;
  border: 1px solid #e9e9eb;
}

.doc-card-ext {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.ext-pdf .doc-card-ext {
  color: #f56c6c;
}

.ext-word .doc-card-ext {
  color: #409eff;
}

.ext-excel .doc-card-ext {
  color: #67c23a;
}

.ext-other .doc-card-ext {
  color: #909399;
}

.doc-card-name {
  font-size: 11px;
  color: #666;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

/* 统一上传区 */
.unified-upload {
  margin-bottom: 14px;
  width: 100%;
}

.unified-upload :deep(.el-upload) {
  width: 100%;
}

.unified-upload :deep(.el-upload-dragger) {
  padding: 16px;
  border-radius: 10px;
  border: 2px dashed #dcdfe6;
  background: #fafbfc;
  transition: border-color 0.2s, background 0.2s;
}

.unified-upload :deep(.el-upload-dragger:hover) {
  border-color: #4f46e5;
  background: #f8f7ff;
}

.unified-upload :deep(.el-upload-dragger.is-dragover) {
  border-color: #4f46e5;
  background: #f0eeff;
}

.unified-upload-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #909399;
}

.unified-upload-text {
  font-size: 13px;
  color: #606266;
}

.unified-upload-hint {
  font-size: 11px;
  color: #c0c4cc;
}

.upload-disabled-hint {
  font-size: 12px;
  color: #c0c4cc;
  text-align: center;
  margin-bottom: 14px;
}

/* 操作栏 */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0 0;
  border-top: 1px solid #f0f0f0;
  transition: border-color 0.3s, background 0.3s;
}

.action-bar.action-bar-viewing {
  border-top: 2px solid #69b1ff;
}

.action-bar.action-bar-editing {
  border-top: 2px solid #ffc53d;
}

.btn-back-today {
  font-weight: 500;
}

.btn-edit-history {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.btn-save-today {
  font-weight: 500;
  min-width: 72px;
}

.btn-save-edit {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.action-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.save-hint {
  font-size: 12px;
  color: #aaa;
}

/* 右栏 */
.right-panel {
  width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 周报（内联在日历区域内） */
.weekly-inline {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.weekly-inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 6px 0;
}

.weekly-inline-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 日历视图 */
.calendar-section {
  background: #fafbfc;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  padding: 18px 20px;
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.search-input {
  width: 160px;
}

.search-results {
  max-height: 400px;
  overflow-y: auto;
}

.search-loading,
.search-empty {
  text-align: center;
  color: #909399;
  font-size: 13px;
  padding: 20px 0;
}

.search-calendar-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.search-month-block {
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.search-month-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.search-month-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.search-dates-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.search-date-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: #409eff;
  background: #ecf5ff;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.search-date-chip:hover {
  background: #d9ecff;
}

.search-date-chip.active {
  background: #409eff;
  color: #fff;
}

:deep(.search-highlight) {
  background: #fff3b0;
  color: #303133;
  padding: 0 1px;
  border-radius: 2px;
}

.calendar-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.calendar-nav-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.calendar-month-label {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  min-width: 100px;
  text-align: center;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.calendar-weekday {
  text-align: center;
  font-size: 12px;
  color: #909399;
  font-weight: 500;
  padding: 4px 0;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.calendar-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 4px 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  min-height: 44px;
  position: relative;
}

.calendar-cell:hover {
  background: #f0f2f5;
}

.calendar-cell.other-month .calendar-day-num {
  color: #c0c4cc;
}

.calendar-day-num {
  font-size: 14px;
  color: #606266;
  line-height: 1;
}

.calendar-cell.has-log .calendar-day-num {
  font-weight: 600;
  color: #1a1a1a;
}

.calendar-cell.is-today {
  background: #4f46e5;
  border-radius: 8px;
}

.calendar-cell.is-today .calendar-day-num {
  color: #fff;
  font-weight: 600;
}

.calendar-cell.is-today .calendar-dot {
  background: #fff;
}

.calendar-cell.is-selected {
  background: #ede9fe;
  box-shadow: inset 0 0 0 2px #4f46e5;
  border-radius: 8px;
}

.calendar-cell.is-selected.is-today {
  background: #4f46e5;
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
}

.calendar-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4f46e5;
  margin-top: 3px;
}

.calendar-comment-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 10px;
  height: 10px;
  z-index: 2;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.calendar-cell.is-selected .calendar-comment-dot {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.calendar-cell.is-selected.is-today .calendar-comment-dot {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.calendar-cell.is-selected .calendar-comment-dot.unread,
.calendar-cell.is-selected.is-today .calendar-comment-dot.unread {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f56c6c'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
}

.calendar-comment-dot.unread {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f56c6c'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z'/%3E%3C/svg%3E") no-repeat center/contain;
  animation: comment-pulse 1.5s ease-in-out 3;
}

@keyframes comment-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

.calendar-tag {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 8px;
  line-height: 1;
  transform: scale(0.9);
}

.calendar-tag.tag-rest {
  color: #f56c6c;
}

.calendar-tag.tag-work {
  color: #e6a23c;
}

.calendar-cell.is-today .calendar-tag {
  color: rgba(255, 255, 255, 0.8);
}

/* 日志预览 */
.calendar-preview {
  background: #fafbfc;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  padding: 16px 20px;
  max-height: calc(100vh - 420px);
  overflow-y: auto;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.preview-date {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-body {
  font-size: 13px;
  line-height: 1.8;
  color: #333;
}

.preview-submission {
  margin-bottom: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.section-actions {
  display: flex;
  gap: 6px;
}

.weekly-content {
  min-height: 40px;
  max-height: 200px;
  overflow-y: auto;
}

.summary-text {
  font-size: 13px;
  line-height: 1.7;
  color: #555;
  white-space: pre-wrap;
}

.summary-empty {
  font-size: 13px;
  color: #bbb;
  text-align: center;
  padding: 12px 0;
}

.weekly-supplements {
  margin-top: 10px;
  border-top: 1px dashed #e8e8e8;
  padding-top: 8px;
}

.weekly-supplement-item {
  font-size: 13px;
  line-height: 1.7;
  color: #555;
  margin-bottom: 4px;
}

.weekly-supplement-item .supplement-label {
  color: #e6a23c;
  font-weight: 500;
  margin-right: 8px;
}

.weekly-supplement-action {
  margin-top: 10px;
}

.weekly-supplement-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.weekly-supplement-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.weekly-report-item {
  margin-top: 4px;
}

.weekly-report-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 8px 0;
}

.report-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}

.report-icon {
  color: #409eff;
  font-size: 16px;
}

.weekly-report-body {
  padding: 10px 0 4px 22px;
}

.weekly-report-body .summary-text {
  font-size: 13px;
  line-height: 1.8;
  color: #555;
  white-space: pre-wrap;
}

.weekly-report-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

/* 响应式 */
@media (max-width: 1200px) {
  .right-panel {
    width: 360px;
  }
}

@media (max-width: 900px) {
  .daily-log-page {
    flex-direction: column;
  }

  .right-panel {
    width: 100%;
  }
}

/* 历史日志附件 */
.history-attachments {
  margin-top: 10px;
  padding: 10px 12px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-attach-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-attach-label {
  font-size: 12px;
  color: #909399;
  font-weight: 500;
}

.history-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.history-image-thumb {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  object-fit: cover;
  cursor: pointer;
  border: 1px solid #ebeef5;
  transition: transform 0.2s;
}

.history-image-thumb:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.history-docs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.history-doc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 64px;
  cursor: pointer;
  transition: transform 0.2s;
}

.history-doc-card:hover {
  transform: translateY(-2px);
}

.history-doc-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}

.history-doc-icon.ext-pdf { background: linear-gradient(135deg, #f56c6c, #e04040); }
.history-doc-icon.ext-word { background: linear-gradient(135deg, #409eff, #2a7de1); }
.history-doc-icon.ext-excel { background: linear-gradient(135deg, #67c23a, #4ea82a); }
.history-doc-icon.ext-other { background: linear-gradient(135deg, #909399, #6d7278); }

.history-doc-name {
  margin-top: 4px;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #606266;
  text-align: center;
}

/* 响应式 */
@media (max-width: 1200px) {
  .right-panel {
    width: 360px;
  }
}

@media (max-width: 900px) {
  .daily-log-page {
    flex-direction: column;
  }

  .right-panel {
    width: 100%;
  }
}

/* 展开图标 */
.expand-icon {
  font-size: 12px;
  color: #aaa;
  transition: transform 0.2s;
  transform: rotate(180deg);
}

.expand-icon.expanded {
  transform: rotate(0deg);
}

/* 富文本渲染 */
.rich-content :deep(h1) {
  font-size: 18px;
  font-weight: 700;
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 2px solid #4f46e5;
}

.rich-content :deep(h2) {
  font-size: 15px;
  font-weight: 600;
  margin: 12px 0 6px;
  padding-left: 8px;
  border-left: 3px solid #4f46e5;
}

.rich-content :deep(h3) {
  font-size: 14px;
  font-weight: 600;
  margin: 10px 0 4px;
  padding-left: 8px;
  border-left: 3px solid #a5b4fc;
}

.rich-content :deep(p) {
  margin: 0 0 6px;
  font-size: 14px;
  line-height: 1.8;
  color: #333;
}

.rich-content :deep(ol),
.rich-content :deep(ul) {
  padding-left: 20px;
  margin: 4px 0 8px;
}

.rich-content :deep(li) {
  margin-bottom: 3px;
  font-size: 14px;
  line-height: 1.7;
}

.rich-content :deep(strong) {
  font-weight: 700;
}

/* 补充模式 */
.status-banner.supplement {
  background: #f0f5ff;
  border-color: #adc6ff;
}

.status-banner.supplement .status-hint {
  color: #2f54eb;
}

.status-banner.weekly-supplement {
  background: #f6ffed;
  border-color: #b7eb8f;
}

.status-banner.weekly-supplement .status-hint {
  color: #389e0d;
}

.supplement-original {
  margin-bottom: 14px;
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  overflow: hidden;
  background: #f9fafb;
}

.supplement-original.weekly-supplement-original {
  border-color: #b7eb8f;
  background: #f6ffed;
}

.supplement-original.weekly-supplement-original .supplement-original-header {
  background: #d9f7be;
  border-bottom-color: #b7eb8f;
}

.supplement-original.weekly-supplement-original .supplement-original-title {
  color: #389e0d;
}

.supplement-original-header {
  padding: 10px 16px;
  background: #f0f2f5;
  border-bottom: 1px solid #e8e8e8;
}

.supplement-original-title {
  font-size: 13px;
  font-weight: 600;
  color: #666;
}

.supplement-original-body {
  padding: 16px 24px;
  font-size: 14px;
  line-height: 1.8;
  color: #555;
  max-height: 300px;
  overflow-y: auto;
}

/* 补充记录列表 */
.supplement-list {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 3px solid #adc6ff;
}

.supplement-list-header {
  font-size: 14px;
  font-weight: 600;
  color: #2f54eb;
  margin-bottom: 8px;
}

.supplement-list-item {
  padding: 10px 14px;
  margin-bottom: 8px;
  background: #f0f5ff;
  border-radius: 6px;
}

.supplement-list-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.supplement-list-label {
  font-size: 12px;
  font-weight: 600;
  color: #2f54eb;
}

.supplement-list-time {
  font-size: 12px;
  color: #999;
}

.supplement-list-content {
  font-size: 14px;
  color: #333;
  line-height: 1.6;
}

.supplement-item {
  padding: 8px 12px;
  margin-bottom: 6px;
  background: #f0f5ff;
  border-radius: 6px;
}

.supplement-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.supplement-label {
  font-size: 12px;
  font-weight: 600;
  color: #2f54eb;
}

.supplement-time {
  font-size: 11px;
  color: #aaa;
}

.supplement-body {
  font-size: 13px;
  line-height: 1.7;
  color: #333;
}

/* 历史日志操作按钮 */
.submission-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.locked-icon {
  font-size: 14px;
  color: #c0c4cc;
}

/* 快捷短语 popover */
.phrase-popover { max-height: 240px; overflow-y: auto; }
.phrase-empty { color: #909399; font-size: 12px; text-align: center; padding: 8px 0; }
.phrase-item {
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.15s;
}
.phrase-item:hover { background: #f0f2f5; }
.phrase-footer { border-top: 1px solid #ebeef5; margin-top: 6px; padding-top: 6px; text-align: center; }

/* 快捷短语管理弹窗 */
.phrase-manager-empty { color: #909399; font-size: 13px; text-align: center; padding: 16px 0; }
.phrase-manager-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f2f5;
}
.phrase-manager-text { flex: 1; font-size: 13px; }
.phrase-manager-actions { display: flex; gap: 2px; }
.phrase-manager-add {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

/* 评论区 */
.comment-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed #ebeef5;
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

.comment-withdraw-btn {
  color: #909399;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.comment-withdraw-btn:hover {
  color: #f56c6c;
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
</style>
