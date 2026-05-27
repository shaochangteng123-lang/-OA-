<template>
  <div class="entry-card" :class="{ 'is-finalized': entry.isFinalized }">
    <div class="card-header">
      <div class="title">
        <el-tag v-if="entry.isFinalized" type="success" size="small" effect="dark">
          <el-icon><Lock /></el-icon>
          已办结
        </el-tag>
        <span class="project-name">{{ entry.projectName || '（项目未关联）' }}</span>
        <el-tag size="small" effect="plain">{{ entry.matter }}</el-tag>
      </div>
      <div class="meta">
        <span>{{ entry.logDate }}</span>
        <span class="divider">·</span>
        <span>{{ entry.userName }}{{ entry.userPosition ? ' / ' + entry.userPosition : '' }}</span>
        <span v-if="lastUpdatedAt" class="divider">·</span>
        <span v-if="lastUpdatedAt" class="updated-at">更新于 {{ formatTime(lastUpdatedAt) }}</span>
      </div>
    </div>

    <div v-if="entry.district || entry.clientName" class="info-line">
      <el-tag v-if="entry.district" size="small" type="info" effect="plain">{{ entry.district }}</el-tag>
      <el-tag v-if="entry.projectType" size="small" effect="plain">{{ entry.projectType }}</el-tag>
      <span v-if="entry.clientName">甲方：{{ entry.clientName }}</span>
      <span v-if="entry.clientContactName">联系人：{{ entry.clientContactName }}<template v-if="entry.clientContactPhone">（{{ entry.clientContactPhone }}）</template></span>
      <span>负责人：{{ entry.ownerName }}</span>
    </div>

    <div class="expand-toggle" @click="expanded = !expanded">
      <el-icon class="toggle-icon" :class="{ 'is-expanded': expanded }"><ArrowRight /></el-icon>
      <span>{{ expanded ? '收起详情' : '展开详情' }}</span>
    </div>

    <div v-show="expanded" class="card-body">
      <div v-if="entry.contractStatus" class="info-line contract-status-line" @click="$emit('viewContract', entry.projectId)">
        <span class="label">合同付款：</span>
        <el-tag size="small" :type="contractTagType(entry.contractStatus)">{{ entry.contractStatus }}</el-tag>
        <span v-if="entry.contractNote" class="note">（{{ entry.contractNote }}）</span>
        <span class="view-link">查看进度</span>
      </div>

      <div v-if="entry.progressNotes && entry.progressNotes.length > 0" class="progress-section">
        <div class="section-label">项目进展</div>
        <div class="card-timeline">
          <div v-for="(note, noteIdx) in entry.progressNotes" :key="note.id" class="card-timeline-item">
            <div class="card-tl-time">{{ formatTime(note.createdAt) }}</div>
            <div class="card-tl-text">{{ note.content }}</div>
            <!-- 进展自身的附件 -->
            <div v-if="note.attachments && note.attachments.length > 0" class="card-tl-attachments">
              <div v-if="getNoteScreenshots(note).length > 0 || getNotePhotos(note).length > 0" class="image-att-block">
                <div class="att-block-label">图片附件</div>
                <div class="image-row">
                  <div v-if="getNoteScreenshots(note).length > 0" class="image-section">
                    <div class="section-label">沟通记录截图</div>
                    <div class="image-grid">
                      <img
                        v-for="img in getNoteScreenshots(note)"
                        :key="img.id"
                        :src="`/api/files/worklog/${img.id}`"
                        class="thumb"
                        @click="handlePreview(img.id)"
                      />
                    </div>
                  </div>
                  <div v-if="getNotePhotos(note).length > 0" class="image-section">
                    <div class="section-label">项目现场照片</div>
                    <div class="image-grid">
                      <img
                        v-for="img in getNotePhotos(note)"
                        :key="img.id"
                        :src="`/api/files/worklog/${img.id}`"
                        class="thumb"
                        @click="handlePreview(img.id)"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="getNoteDocs(note).length > 0" class="doc-att-block">
                <div class="att-block-label">文档附件</div>
                <div class="doc-list">
                  <span
                    v-for="doc in getNoteDocs(note)"
                    :key="doc.id"
                    class="doc-link"
                    @click="handleDocPreview(doc.id)"
                  >
                    <span class="doc-type-badge" :class="getDocType(doc.fileName)">{{ getDocTypeLabel(doc.fileName) }}</span>
                    <el-icon><Document /></el-icon>
                    {{ doc.fileName }}
                  </span>
                </div>
              </div>
            </div>
            <!-- 第一条进展下方显示 entry 级别的旧附件 -->
            <div v-if="noteIdx === 0 && entry.attachments && entry.attachments.length > 0" class="card-tl-attachments">
              <div v-if="screenshots.length > 0 || photos.length > 0" class="image-att-block">
                <div class="att-block-label">图片附件</div>
                <div class="image-row">
                  <div v-if="screenshots.length > 0" class="image-section">
                    <div class="section-label">沟通记录截图</div>
                    <div class="image-grid">
                      <img
                        v-for="img in screenshots"
                        :key="img.id"
                        :src="`/api/files/worklog/${img.id}`"
                        class="thumb"
                        @click="handlePreview(img.id)"
                      />
                    </div>
                  </div>
                  <div v-if="photos.length > 0" class="image-section">
                    <div class="section-label">项目现场照片</div>
                    <div class="image-grid">
                      <img
                        v-for="img in photos"
                        :key="img.id"
                        :src="`/api/files/worklog/${img.id}`"
                        class="thumb"
                        @click="handlePreview(img.id)"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="docs.length > 0" class="doc-att-block">
                <div class="att-block-label">文档附件</div>
                <div class="doc-list">
                  <span
                    v-for="doc in docs"
                    :key="doc.id"
                    class="doc-link"
                    @click="handleDocPreview(doc.id)"
                  >
                    <span class="doc-type-badge" :class="getDocType(doc.fileName)">{{ getDocTypeLabel(doc.fileName) }}</span>
                    <el-icon><Document /></el-icon>
                    {{ doc.fileName }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="entry.workNote" class="work-note">
        {{ entry.workNote }}
      </div>
      <!-- 没有进展记录时，entry 级别附件仍显示在底部 -->
      <div v-if="(!entry.progressNotes || entry.progressNotes.length === 0) && entry.attachments && entry.attachments.length > 0" class="attachments">
        <div v-if="screenshots.length > 0 || photos.length > 0" class="image-att-block">
          <div class="att-block-label">图片附件</div>
          <div class="image-row">
            <div v-if="screenshots.length > 0" class="image-section">
              <div class="section-label">沟通记录截图</div>
              <div class="image-grid">
                <img
                  v-for="img in screenshots"
                  :key="img.id"
                  :src="`/api/files/worklog/${img.id}`"
                  class="thumb"
                  @click="handlePreview(img.id)"
                />
              </div>
            </div>
            <div v-if="photos.length > 0" class="image-section">
              <div class="section-label">项目现场照片</div>
              <div class="image-grid">
                <img
                  v-for="img in photos"
                  :key="img.id"
                  :src="`/api/files/worklog/${img.id}`"
                  class="thumb"
                  @click="handlePreview(img.id)"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-if="docs.length > 0" class="doc-att-block">
          <div class="att-block-label">文档附件</div>
          <div class="doc-list">
            <span
              v-for="doc in docs"
              :key="doc.id"
              class="doc-link"
              @click="handleDocPreview(doc.id)"
            >
              <span class="doc-type-badge" :class="getDocType(doc.fileName)">{{ getDocTypeLabel(doc.fileName) }}</span>
              <el-icon><Document /></el-icon>
              {{ doc.fileName }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <el-button size="small" link @click="emit('edit', entry)">
        {{ canEdit ? '编辑' : '查看' }}
      </el-button>
      <el-button
        v-if="canEdit"
        size="small"
        link
        type="danger"
        @click="emit('delete', entry)"
      >
        删除
      </el-button>
    </div>

    <el-image-viewer
      v-if="previewId"
      :url-list="[`/api/files/worklog/${previewId}`]"
      @close="previewId = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Document, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import type { WorklogEntry, WorklogProgressNote } from '@/types'

const props = defineProps<{ entry: WorklogEntry }>()
const emit = defineEmits<{
  (e: 'edit', entry: WorklogEntry): void
  (e: 'delete', entry: WorklogEntry): void
  (e: 'viewContract', projectId: string): void
}>()

const authStore = useAuthStore()
const isOwner = computed(() => authStore.user?.id === props.entry.userId)
const canEdit = computed(() => isOwner.value && !props.entry.isFinalized && !props.entry.projectIsCompleted)
const expanded = ref(false)

function contractTagType(status: string): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === '已结清') return 'success'
  if (status === '已开票未收款') return 'warning'
  if (status === '未签合同') return 'info'
  return 'primary'
}
const previewId = ref('')
const screenshots = computed(() => (props.entry.attachments || []).filter(a => a.fileKind === 'screenshot'))
const photos = computed(() => (props.entry.attachments || []).filter(a => a.fileKind === 'photo' || a.fileKind === 'image'))
const docs = computed(() => (props.entry.attachments || []).filter(a => a.fileKind === 'document'))

const lastUpdatedAt = computed(() => {
  const candidates: string[] = []
  if (props.entry.updatedAt) candidates.push(props.entry.updatedAt)
  for (const note of props.entry.progressNotes || []) {
    if (note.createdAt) candidates.push(note.createdAt)
  }
  if (candidates.length === 0) return ''
  return candidates.reduce((max, t) => (t > max ? t : max), candidates[0])
})

function getNoteScreenshots(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'screenshot')
}
function getNotePhotos(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'photo' || a.fileKind === 'image')
}
function getNoteDocs(note: WorklogProgressNote) {
  return (note.attachments || []).filter(a => a.fileKind === 'document')
}

function handlePreview(id: string) { previewId.value = id }

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

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.entry-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 16px;
  transition: box-shadow 0.15s;
}
.entry-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.entry-card.is-finalized {
  background: #f7faf7;
  border-color: #c8e6c9;
}

.card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
.title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.project-name { font-weight: 600; font-size: 15px; }
.meta { font-size: 12px; color: #999; white-space: nowrap; }
.meta .divider { margin: 0 4px; }
.meta .updated-at { color: #67c23a; }

.info-line { margin: 4px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; color: #606266; }
.info-line .label { color: #909399; }
.info-line .note { color: #909399; font-size: 12px; }
.contract-status-line { cursor: pointer; }
.contract-status-line:hover .view-link { opacity: 1; }
.view-link { font-size: 12px; color: #409eff; opacity: 0; transition: opacity 0.2s; margin-left: auto; }

.expand-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 4px;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  user-select: none;
}
.expand-toggle:hover { color: #337ecc; }
.toggle-icon { transition: transform 0.2s; }
.toggle-icon.is-expanded { transform: rotate(90deg); }

.card-body { font-size: 13px; color: #606266; margin-top: 8px; max-height: calc(100vh - 120px); overflow-y: auto; }
.work-note { margin: 8px 0; padding: 8px 10px; background: #fafafa; border-radius: 4px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; }

.attachments { margin-top: 8px; }
.image-att-block { margin-bottom: 8px; }
.doc-att-block { margin-top: 8px; }
.att-block-label { font-size: 12px; color: #606266; margin-bottom: 6px; font-weight: 500; }
.image-row { display: flex; gap: 40px; }
.image-row .image-section { min-width: 0; }
.image-section { margin-bottom: 6px; }
.section-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.image-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.image-grid .thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid #e4e7ed; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: transform 0.15s; }
.image-grid .thumb:hover { transform: scale(1.05); box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
.doc-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.doc-link { font-size: 13px; color: #409eff; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; padding: 4px 8px; border-radius: 4px; background: #fff; border: 1px solid #e4e7ed; cursor: pointer; position: relative; }
.doc-link:hover { background: #ecf5ff; border-color: #b3d8ff; text-decoration: none; }
.doc-type-badge { font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 2px; color: #fff; line-height: 1.2; }
.doc-type-badge.word { background: #2b579a; }
.doc-type-badge.excel { background: #217346; }
.doc-type-badge.pdf { background: #d63b3b; }
.doc-type-badge.other { background: #909399; }

.card-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ebeef5; }

.progress-section { margin: 8px 0; }
.card-timeline { padding-left: 12px; border-left: 2px solid #e4e7ed; }
.card-timeline-item { padding: 4px 0 8px 10px; position: relative; font-size: 13px; line-height: 1.5; }
.card-timeline-item::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 10px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #409eff;
}
.card-tl-time { font-size: 12px; color: #909399; font-family: monospace; margin-bottom: 2px; }
.card-tl-text { color: #303133; white-space: pre-wrap; }
.card-tl-attachments {
  margin-top: 8px;
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
</style>
