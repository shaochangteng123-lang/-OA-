<template>
  <div class="app-layout">
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
          <!-- 工作区 -->
          <SidebarGroup
            title="工作区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
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

          <!-- 项目区 -->
          <SidebarGroup
            title="项目区"
            :title-collapsed="!groupTitlesVisible"
            :sidebar-collapsed="sidebarCollapsed"
          >
            <SidebarMenuItem
              path="/projects"
              label="项目管理"
              :icon="FolderOpened"
              :collapsed="sidebarCollapsed"
              tooltip-content="项目管理"
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
          >
            <SidebarMenuItem
              v-if="isAdmin"
              path="/system-settings"
              label="系统设置"
              :icon="Setting"
              :collapsed="sidebarCollapsed"
              tooltip-content="系统设置"
            />
            <SidebarMenuItem
              path="/user-settings"
              label="用户设置"
              :icon="User"
              :collapsed="sidebarCollapsed"
              tooltip-content="用户设置"
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'
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
} from '@element-plus/icons-vue'
import SidebarHeader from './components/SidebarHeader.vue'
import SidebarMenuItem from './components/SidebarMenuItem.vue'
import SidebarGroup from './components/SidebarGroup.vue'
import TopBar from './components/TopBar.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// 侧边栏折叠状态 - 默认折叠，默认不锁定
const sidebarCollapsed = ref(true)
const isHovering = ref(false)
const isPinned = ref(false)
const groupTitlesVisible = ref(false) // 分组标题独立控制
let collapseTimer: number | null = null

// 是否是管理员
const isAdmin = computed(() => {
  return authStore.user?.role === 'super_admin' || authStore.user?.role === 'admin'
})

// 页面标题
const pageTitle = computed(() => {
  const routeTitles: Record<string, string> = {
    '/': '今日日志',
    '/history': '历史日志',
    '/calendar': '日历',
    '/projects': '项目管理',
    '/presets': '预设方案',
    '/blocks': '预设板块',
    '/events': '事件库',
    '/departments': '部门管理',
    '/system-settings': '系统设置',
    '/user-settings': '用户设置',
  }
  return routeTitles[route.path] || '工作日志管理系统'
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
    await authStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  } catch (error) {
    ElMessage.error('退出登录失败')
  }
}

// 处理设置
const handleSettings = () => {
  router.push('/user-settings')
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
  // 从 localStorage 读取锁定状态
  const savedPinned = localStorage.getItem('sidebar-pinned')
  if (savedPinned !== null) {
    isPinned.value = savedPinned === 'true'
  }

  // 如果锁定，则展开；否则折叠
  sidebarCollapsed.value = !isPinned.value
  groupTitlesVisible.value = isPinned.value
})

onUnmounted(() => {
  // 清理定时器
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  background-color: #f5f5f5;
  position: relative;
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
  margin-top: 60px;
  margin-left: 64px;
  min-height: calc(100vh - 60px);
  overflow: auto;
  background-color: #f5f5f5;
  padding: 24px;
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

/* 响应式 */
@media (max-width: 768px) {
  .app-sidebar {
    transform: translateX(0);
  }

  .app-sidebar.is-collapsed {
    transform: translateX(-100%);
  }
}
</style>
