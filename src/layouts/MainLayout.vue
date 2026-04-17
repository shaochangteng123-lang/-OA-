<template>
  <div class="app-layout">
    <!-- 强制修改密码弹窗：登录后检测到需要修改密码时弹出，不可关闭 -->
    <el-dialog
      :model-value="showChangePasswordDialog"
      title="请修改初始密码"
      width="460px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="true"
      align-center
      @close="handleCancelChangePassword"
    >
      <el-alert
        title="为保障账号安全，请立即将初始密码修改为个人密码，修改后需重新登录。"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 20px"
      />
      <el-form
        ref="cpFormRef"
        :model="cpForm"
        :rules="cpRules"
        label-width="100px"
      >
        <el-form-item label="当前密码" prop="currentPassword">
          <el-input
            v-model="cpForm.currentPassword"
            type="password"
            placeholder="请输入初始密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="cpForm.newPassword"
            type="password"
            placeholder="至少6个字符"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="cpForm.confirmPassword"
            type="password"
            placeholder="再次输入新密码"
            show-password
            @keyup.enter="handleForceChangePassword"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          type="primary"
          :loading="cpLoading"
          style="width: 100%"
          @click="handleForceChangePassword"
        >
          修改密码并重新登录
        </el-button>
      </template>
    </el-dialog>

    <!-- 侧边栏 - 固定浮动 -->
    <aside
      class="app-sidebar"
      :class="{ 'is-collapsed': sidebarCollapsed, 'is-hovering': isHovering, 'is-pinned': isPinned }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <!-- 头部Logo -->
      <SidebarHeader
        :collapsed="sidebarCollapsed"
        :is-pinned="isPinned"
        @toggle-collapse="toggleSidebar"
      />

      <!-- 导航菜单 -->
      <el-scrollbar class="sidebar-menu-scrollbar">
        <nav class="sidebar-menu">
          <!-- 办公区 -->
          <SidebarGroup
            title="办公区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
            group-key="office"
            v-model:expanded="groupStates.office.expanded"
          >
            <SidebarMenuItem
              path="/calendar"
              label="日历"
              :icon="Calendar"
              :collapsed="sidebarCollapsed"
              tooltip-content="日历"
            />
            <SidebarMenuItem
              path="/"
              label="今日日志"
              :icon="Notebook"
              :collapsed="sidebarCollapsed"
              tooltip-content="今日日志"
            />
            <SidebarMenuItem
              path="/history"
              label="历史日志"
              :icon="Document"
              :collapsed="sidebarCollapsed"
              tooltip-content="历史日志"
            />
          </SidebarGroup>

          <!-- 财务区 -->
          <SidebarGroup
            title="财务区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
            group-key="finance"
            v-model:expanded="groupStates.finance.expanded"
            :has-badge="financeGroupHasBadge"
          >
            <SidebarMenuItem
              path="/basic-reimbursement"
              label="基础报销"
              :icon="Money"
              :collapsed="sidebarCollapsed"
              tooltip-content="基础报销"
              :badge="basicReimbursementBadge"
              badge-type="warning"
            />
            <SidebarMenuItem
              path="/large-reimbursement"
              label="大额报销"
              :icon="Wallet"
              :collapsed="sidebarCollapsed"
              tooltip-content="大额报销"
              :badge="largeReimbursementBadge"
              badge-type="warning"
            />
            <SidebarMenuItem
              path="/business-reimbursement"
              label="商务报销"
              :icon="Briefcase"
              :collapsed="sidebarCollapsed"
              tooltip-content="商务报销"
              :badge="businessReimbursementBadge"
              badge-type="warning"
            />
            <SidebarMenuItem
              path="/reimbursement-statistics"
              label="报销统计"
              :icon="DataAnalysis"
              :collapsed="sidebarCollapsed"
              tooltip-content="报销统计"
            />
            <SidebarMenuItem
              v-if="isGeneralManager"
              path="/gm-approval"
              label="审批中心"
              :icon="Stamp"
              :collapsed="sidebarCollapsed"
              tooltip-content="审批中心"
              :badge="gmPendingApprovalCount > 0 ? gmPendingApprovalCount : undefined"
              badge-type="danger"
            />
            <SidebarMenuItem
              v-if="isAdmin"
              path="/reimbursement-management"
              label="报销管理"
              :icon="Setting"
              :collapsed="sidebarCollapsed"
              tooltip-content="报销管理"
            />
            <SidebarMenuItem
              v-if="isAdmin"
              path="/approval"
              label="审批中心"
              :icon="Stamp"
              :collapsed="sidebarCollapsed"
              tooltip-content="审批中心"
              :badge="pendingApprovalCount > 0 ? pendingApprovalCount : undefined"
              badge-type="danger"
            />
          </SidebarGroup>

          <!-- 人力资源区 -->
          <SidebarGroup
            title="人力资源区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
            group-key="hr"
            v-model:expanded="groupStates.hr.expanded"
            :has-badge="hrGroupHasBadge"
          >
            <SidebarMenuItem
              path="/onboarding"
              label="入职"
              :icon="Promotion"
              :collapsed="sidebarCollapsed"
              tooltip-content="入职"
            />
            <SidebarMenuItem
              path="/probation"
              label="转正"
              :icon="UserFilled"
              :collapsed="sidebarCollapsed"
              tooltip-content="转正"
              :badge="probationBadge"
              badge-type="danger"
            />
            <SidebarMenuItem
              path="/resignation"
              label="离职"
              :icon="SwitchButton"
              :collapsed="sidebarCollapsed"
              tooltip-content="离职"
              :badge="resignationBadge"
              badge-type="danger"
            />
            <SidebarMenuItem
              path="/leave"
              label="请假"
              :icon="Clock"
              :collapsed="sidebarCollapsed"
              tooltip-content="请假"
            />
            <SidebarMenuItem
              v-if="isGeneralManager"
              path="/gm-probation-approval"
              label="审批中心"
              :icon="Stamp"
              :collapsed="sidebarCollapsed"
              tooltip-content="审批中���"
              :badge="gmProbationPendingCount > 0 ? gmProbationPendingCount : undefined"
              badge-type="danger"
            />
            <SidebarMenuItem
              v-if="isAdmin"
              path="/employee-data"
              label="员工数据"
              :icon="List"
              :collapsed="sidebarCollapsed"
              tooltip-content="员工数据"
              :badge="employeeDataBadge"
              badge-type="danger"
            />
          </SidebarGroup>

          <!-- 项目区 -->
          <SidebarGroup
            title="项目区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
            group-key="project"
            v-model:expanded="groupStates.project.expanded"
          >
            <SidebarMenuItem
              path="/projects"
              label="项目管理"
              :icon="FolderOpened"
              :collapsed="sidebarCollapsed"
              tooltip-content="项目管理"
            />
            <SidebarMenuItem
              path="/project-initiation"
              label="项目立项"
              :icon="DocumentAdd"
              :collapsed="sidebarCollapsed"
              tooltip-content="项目立项"
            />
            <SidebarMenuItem
              path="/project-progress"
              label="项目进度"
              :icon="DataAnalysis"
              :collapsed="sidebarCollapsed"
              tooltip-content="项目进度"
            />
            <SidebarMenuItem
              path="/project-archive"
              label="项目封存"
              :icon="Box"
              :collapsed="sidebarCollapsed"
              tooltip-content="项目封存"
            />
            <SidebarMenuItem
              path="/presets"
              label="预设方案"
              :icon="Collection"
              :collapsed="sidebarCollapsed"
              tooltip-content="预设方案"
            />
            <SidebarMenuItem
              path="/blocks"
              label="预设板块"
              :icon="Grid"
              :collapsed="sidebarCollapsed"
              tooltip-content="预设板块"
            />
            <SidebarMenuItem
              path="/events"
              label="事件库"
              :icon="Files"
              :collapsed="sidebarCollapsed"
              tooltip-content="事件库"
            />
            <SidebarMenuItem
              path="/departments"
              label="部门管理"
              :icon="OfficeBuilding"
              :collapsed="sidebarCollapsed"
              tooltip-content="部门管理"
            />
          </SidebarGroup>

          <!-- 系统区 -->
          <SidebarGroup
            title="系统区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
            group-key="system"
            v-model:expanded="groupStates.system.expanded"
          >
            <SidebarMenuItem
              v-if="isAdmin"
              path="/users"
              label="用户管理"
              :icon="UserFilled"
              :collapsed="sidebarCollapsed"
              tooltip-content="用户管理"
            />
            <SidebarMenuItem
              v-if="isAdmin"
              path="/system-settings"
              label="系统设置"
              :icon="Setting"
              :collapsed="sidebarCollapsed"
              tooltip-content="系统设置"
            />
            <SidebarMenuItem
              path="/settings"
              label="个人设置"
              :icon="User"
              :collapsed="sidebarCollapsed"
              tooltip-content="个人设置"
            />
          </SidebarGroup>
        </nav>
      </el-scrollbar>
    </aside>

    <!-- 顶部栏 -->
    <TopBar
      :user="authStore.user"
      :sidebar-collapsed="sidebarCollapsed"
      :sidebar-pinned="isPinned || isHovering"
      :title="pageTitle"
      @logout="handleLogout"
      @settings="handleSettings"
      @toggle-theme="handleToggleTheme"
    />

    <!-- 主内容区域 -->
    <main class="app-main" :class="{ 'sidebar-pinned': isPinned }">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePendingStore } from '@/stores/pending'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '@/utils/api'
import {
  Calendar,
  Document,
  FolderOpened,
  Collection,
  Grid,
  Files,
  User,
  Setting,
  OfficeBuilding,
  Notebook,
  DataAnalysis,
  DocumentAdd,
  Box,
  Money,
  Wallet,
  Briefcase,
  UserFilled,
  Promotion,
  SwitchButton,
  List,
  Clock,
  Stamp,
} from '@element-plus/icons-vue'
import SidebarHeader from './components/SidebarHeader.vue'
import SidebarMenuItem from './components/SidebarMenuItem.vue'
import SidebarGroup from './components/SidebarGroup.vue'
import TopBar from './components/TopBar.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const pendingStore = usePendingStore()

// ===================== 强制修改密码弹窗 =====================
const showChangePasswordDialog = computed(() => !!authStore.forceChangePassword)
const cpFormRef = ref<FormInstance>()
const cpLoading = ref(false)
const cpForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

const validateCpConfirm = (_rule: any, value: string, callback: any) => {
  if (!value) callback(new Error('请确认新密码'))
  else if (value !== cpForm.newPassword) callback(new Error('两次输入的密码不一致'))
  else callback()
}

const cpRules: FormRules = {
  currentPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' },
  ],
  confirmPassword: [{ required: true, validator: validateCpConfirm, trigger: 'blur' }],
}

async function handleForceChangePassword() {
  if (!cpFormRef.value) return
  try { await cpFormRef.value.validate() } catch { return }
  try {
    cpLoading.value = true
    await api.post('/api/auth/change-password', {
      currentPassword: cpForm.currentPassword,
      newPassword: cpForm.newPassword,
    })
    ElMessage.success('密码修改成功，请用新密码重新登录')
    await api.post('/api/auth/logout')
    authStore.user = null
    window.location.href = '/login?changed=1'
  } catch (err: any) {
    ElMessage.error(err.response?.data?.message || '密码修改失败')
  } finally {
    cpLoading.value = false
  }
}

// 点 X 关闭弹窗 → 直接退出登录
async function handleCancelChangePassword() {
  try {
    await api.post('/api/auth/logout')
  } catch {}
  authStore.user = null
  window.location.href = '/login'
}
// ============================================================

// 侧边栏折叠状态 - 默认折叠，默认不锁定
const sidebarCollapsed = ref(true)
const isHovering = ref(false)
const isPinned = ref(false)
const groupTitlesVisible = ref(false) // 分组标题独立控制
let collapseTimer: number | null = null

// 分组折叠状态管理
interface GroupState {
  expanded: boolean
}

const groupStates = reactive<Record<string, GroupState>>({
  office: { expanded: false },
  finance: { expanded: false },
  hr: { expanded: false },
  project: { expanded: false },
  system: { expanded: false },
})

// 待审批数量（从 pendingStore 获取）
const pendingApprovalCount = computed(() => pendingStore.counts.approvalPending)
const gmPendingApprovalCount = computed(() => pendingStore.counts.gmApprovalPending)
const gmProbationPendingCount = computed(() => pendingStore.counts.probationPending)

// 是否是管理员
const isAdmin = computed(() => {
  return authStore.user?.role === 'super_admin' || authStore.user?.role === 'admin'
})

// 是否是总经理
const isGeneralManager = computed(() => {
  return authStore.user?.role === 'general_manager'
})

// 计算各分组是否有待办事项
const financeGroupHasBadge = computed(() => {
  const counts = pendingStore.counts
  // 用户的报销待确认
  const userReimbursement = counts.myReimbursementBasic + counts.myReimbursementLarge + counts.myReimbursementBusiness
  // 用户的报销已驳回
  const userRejected = (counts.myReimbursementBasicRejected || 0) + (counts.myReimbursementLargeRejected || 0) + (counts.myReimbursementBusinessRejected || 0)
  // 管理员的审批待办
  const adminApproval = isAdmin.value ? counts.approvalPending : 0
  // 总经理的审批待办
  const gmApproval = isGeneralManager.value ? counts.gmApprovalPending : 0
  return userReimbursement > 0 || userRejected > 0 || adminApproval > 0 || gmApproval > 0
})

const hrGroupHasBadge = computed(() => {
  const counts = pendingStore.counts
  // 用户的转正待提交
  const userProbation = counts.myProbationPending
  // 用户的离职待办
  const userResignation = (counts.myResignationPending || 0) + (counts.myHandoverPending || 0)
  // 管理员的转正待审批
  const adminProbation = isAdmin.value ? counts.probationPending : 0
  // 管理员的离职待审批
  const adminResignation = isAdmin.value ? (counts.resignationPending || 0) : 0
  // 总经理的转正待审批
  const gmProbation = isGeneralManager.value ? counts.probationPending : 0
  return userProbation || userResignation > 0 || adminProbation > 0 || adminResignation > 0 || gmProbation > 0
})

// 计算各个报销类型的待办数量（包含待确认收款和已驳回）
const basicReimbursementBadge = computed(() => {
  const pending = pendingStore.counts.myReimbursementBasic || 0
  const rejected = pendingStore.counts.myReimbursementBasicRejected || 0
  const total = pending + rejected
  return total > 0 ? total : undefined
})

const largeReimbursementBadge = computed(() => {
  const pending = pendingStore.counts.myReimbursementLarge || 0
  const rejected = pendingStore.counts.myReimbursementLargeRejected || 0
  const total = pending + rejected
  return total > 0 ? total : undefined
})

const businessReimbursementBadge = computed(() => {
  const pending = pendingStore.counts.myReimbursementBusiness || 0
  const rejected = pendingStore.counts.myReimbursementBusinessRejected || 0
  const total = pending + rejected
  return total > 0 ? total : undefined
})

const probationBadge = computed(() => {
  if (isAdmin.value && pendingStore.counts.probationPending > 0) {
    return pendingStore.counts.probationPending
  }
  if (pendingStore.counts.myProbationPending) {
    return 1
  }
  return undefined
})

const resignationBadge = computed(() => {
  // 管理员待审批（排除自己的申请，已在后端过滤）
  const adminPending = isAdmin.value ? (pendingStore.counts.resignationPending || 0) : 0
  // 自己作为离职人/交接人的待办
  const myPending = (pendingStore.counts.myResignationPending || 0) + (pendingStore.counts.myHandoverPending || 0)
  const total = adminPending + myPending
  return total > 0 ? total : undefined
})

// 管理员「员工数据」菜单待办：转正待审批 + 离职待审批（含自己的申请）
const employeeDataBadge = computed(() => {
  if (!isAdmin.value) return undefined
  // resignationPending 已排除自己，再加上自己的离职待办
  const resignationTotal = (pendingStore.counts.resignationPending || 0) + (pendingStore.counts.myResignationPending || 0)
  const total = (pendingStore.counts.probationPending || 0) + resignationTotal
  return total > 0 ? total : undefined
})

// 页面标题
const pageTitle = computed(() => {
  const routeTitles: Record<string, string> = {
    '/': '今日日志',
    '/history': '历史日志',
    '/calendar': '日历',
    '/basic-reimbursement': '',
    '/basic-reimbursement/create': '', // 不显示标题
    '/large-reimbursement': '',
    '/large-reimbursement/create': '', // 不显示标题
    '/business-reimbursement': '',
    '/business-reimbursement/create': '', // 不显示标题
    '/reimbursement-statistics': '', // 不显示标题
    '/reimbursement-management': '', // 不显示标题
    '/onboarding': '',
    '/probation': '',
    '/resignation': '',
    '/employee-data': '',
    '/leave': '',
    '/projects': '项目管理',
    '/project-initiation': '项目立项',
    '/project-progress': '项目进度',
    '/project-archive': '项目封存',
    '/presets': '预设方案',
    '/blocks': '预设板块',
    '/events': '事件库',
    '/departments': '部门管理',
    '/users': '用户管理',
    '/settings': '个人设置',
    '/approval': '', // 不显示标题
    '/system-settings': '系统设置',
    '/user-settings': '用户设置',
  }

  // 检查是否是报销单详情页面（带 ID 参数的路由）
  if (route.path.match(/^\/(basic|large|business)-reimbursement\/.+$/)) {
    return ''
  }

  return routeTitles[route.path] !== undefined ? routeTitles[route.path] : ''
})

// 切换锁定状态
const toggleSidebar = () => {
  isPinned.value = !isPinned.value
  if (isPinned.value) {
    // 锁定时，展开并保持展开
    sidebarCollapsed.value = false
    groupTitlesVisible.value = true
    isHovering.value = false
    // 清除可能存在的折叠定时器
    if (collapseTimer) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
  } else {
    // 取消锁定时，不立即折叠，保持展开状态
    // 用户移开鼠标后会自动折叠
    isHovering.value = true
  }
  localStorage.setItem('sidebar-pinned', String(isPinned.value))
}

// 处理退出登录
const handleLogout = async () => {
  try {
    // 清除侧边栏锁定状态，确保下次登录时侧边栏是折叠的
    localStorage.removeItem('sidebar-pinned')
    await authStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  } catch (error) {
    ElMessage.error('退出登录失败')
  }
}

// 处理设置
const handleSettings = () => {
  router.push('/settings')
}

// 处理主题切换
const handleToggleTheme = () => {
  ElMessage.info('主题切换功能即将推出')
}

// 处理鼠标悬停 - 立即展开，延迟折叠
const handleMouseEnter = () => {
  // 如果已锁定，不响应悬停
  if (isPinned.value) return

  // 清除可能存在的折叠定时器
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }

  // 立即展开
  isHovering.value = true
  sidebarCollapsed.value = false
  groupTitlesVisible.value = true
}

const handleMouseLeave = () => {
  // 如果已锁定，不响应离开
  if (isPinned.value) return

  // 立即隐藏分组标题（显示横线）
  groupTitlesVisible.value = false

  // 延迟400ms后才收起侧边栏宽度和折叠内容
  collapseTimer = window.setTimeout(() => {
    isHovering.value = false
    sidebarCollapsed.value = true
    collapseTimer = null
  }, 400)
}

// 组件挂载
onMounted(() => {
  // 从 localStorage 读取锁定状态，如果没有保存过，默认为 false（不锁定）
  const savedPinned = localStorage.getItem('sidebar-pinned')
  isPinned.value = savedPinned === 'true'

  // 根据锁定状态设置侧边栏：锁定时展开，不锁定时折叠
  sidebarCollapsed.value = !isPinned.value
  groupTitlesVisible.value = isPinned.value

  // 启动待办事项轮询（统一管理所有待办数量）
  pendingStore.fetchPendingCounts()
  pendingStore.startPolling()
})

onUnmounted(() => {
  // 清理定时器
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  // 停止待办事项轮询
  pendingStore.stopPolling()
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  background-color: #ffffff;
  position: relative;
  overflow-x: hidden;
}

/* 侧边栏 - 优雅展开动画 */
.app-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 64px;
  height: 100vh;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  z-index: 10;
  overflow: hidden;
}

/* 悬停展开状态 */
.app-sidebar.is-hovering:not(.is-pinned) {
  width: 220px;
  z-index: 100;
  box-shadow: 4px 0 20px rgba(79, 70, 229, 0.08),
    2px 0 8px rgba(0, 0, 0, 0.04);
  border-right-color: rgba(79, 70, 229, 0.2);
}

/* 锁定状态 */
.app-sidebar.is-pinned {
  width: 220px;
  z-index: 10;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.05);
}

.sidebar-menu-scrollbar {
  flex: 1;
  height: 0;
}

.sidebar-menu {
  padding: 12px 4px;
}

/* 主内容区域 - 优化模块34：隐藏滚动条但保持滚动功能 */
.app-main {
  --yl-main-padding-y: 24px;
  --yl-main-padding-x: 45px;
  margin-top: 60px;
  margin-left: 64px;
  min-height: calc(100vh - 60px);
  overflow: auto;
  overflow-x: hidden;
  background-color: #ffffff;
  padding: var(--yl-main-padding-y) var(--yl-main-padding-x);
  max-width: none;
  transition: margin-left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  /* 优化模块34：隐藏滚动条但保持滚动功能 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE 10+ */
}

/* 优化模块34：隐藏Webkit浏览器滚动条 */
.app-main::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}

/* 锁定状态下主内容区域调整 */
.app-main.sidebar-pinned {
  margin-left: 220px;
}

/* 路由切换动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 响应式 - 笔记本屏幕 */
@media (max-width: 1366px) {
  .app-main {
    --yl-main-padding-y: 16px;
    --yl-main-padding-x: 20px;
  }
}

@media (max-width: 768px) {
  .app-sidebar {
    transform: translateX(0);
  }

  .app-sidebar.is-collapsed {
    transform: translateX(-100%);
  }
}
</style>
