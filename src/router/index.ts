import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '/calendar',
        name: 'Calendar',
        component: () => import('@/views/Calendar.vue'),
        meta: { title: '日历' },
      },
      {
        path: '',
        name: 'Home',
        component: () => import('@/views/Home.vue'),
        meta: { title: '今日日志' },
      },
      {
        path: '/history',
        name: 'History',
        component: () => import('@/views/History.vue'),
        meta: { title: '历史日志' },
      },
      {
        path: '/basic-reimbursement',
        name: 'BasicReimbursement',
        component: () => import('@/views/BasicReimbursement.vue'),
        meta: { title: '基础报销' },
      },
      {
        path: '/basic-reimbursement/create',
        name: 'BasicReimbursementCreate',
        component: () => import('@/views/BasicReimbursementCreate.vue'),
        meta: { title: '新建报销单' },
      },
      {
        path: '/basic-reimbursement/:id',
        name: 'BasicReimbursementDetail',
        component: () => import('@/views/BasicReimbursementDetail.vue'),
        meta: { title: '报销单详情' },
      },
      {
        path: '/large-reimbursement',
        name: 'LargeReimbursement',
        component: () => import('@/views/LargeReimbursement.vue'),
        meta: { title: '大额报销' },
      },
      {
        path: '/large-reimbursement/create',
        name: 'LargeReimbursementCreate',
        component: () => import('@/views/LargeReimbursementCreate.vue'),
        meta: { title: '新建大额报销单' },
      },
      {
        path: '/large-reimbursement/:id',
        name: 'LargeReimbursementDetail',
        component: () => import('@/views/LargeReimbursementDetail.vue'),
        meta: { title: '大额报销单详情' },
      },
      {
        path: '/business-reimbursement',
        name: 'BusinessReimbursement',
        component: () => import('@/views/BusinessReimbursement.vue'),
        meta: { title: '商务报销' },
      },
      {
        path: '/business-reimbursement/create',
        name: 'BusinessReimbursementCreate',
        component: () => import('@/views/BusinessReimbursementCreate.vue'),
        meta: { title: '新建商务报销单' },
      },
      {
        path: '/business-reimbursement/:id',
        name: 'BusinessReimbursementDetail',
        component: () => import('@/views/BusinessReimbursementDetail.vue'),
        meta: { title: '商务报销单详情' },
      },
      {
        path: '/reimbursement-statistics',
        name: 'ReimbursementStatistics',
        component: () => import('@/views/ReimbursementStatistics.vue'),
        meta: { title: '报销统计' },
      },
      {
        path: '/onboarding',
        name: 'Onboarding',
        component: () => import('@/views/Onboarding.vue'),
        meta: { title: '入职', skipOnboardingCheck: true },
      },
      {
        path: '/probation',
        name: 'Probation',
        component: () => import('@/views/Probation.vue'),
        meta: { title: '转正申请' },
      },
      {
        path: '/resignation',
        name: 'Resignation',
        component: () => import('@/views/Resignation.vue'),
        meta: { title: '离职' },
      },
      {
        path: '/employee-data',
        name: 'EmployeeData',
        component: () => import('@/views/EmployeeData.vue'),
        meta: { title: '员工数据', requiresAdmin: true },
      },
      {
        path: '/leave',
        name: 'Leave',
        component: () => import('@/views/Leave.vue'),
        meta: { title: '请假' },
      },
      {
        path: '/projects',
        name: 'Projects',
        component: () => import('@/views/Projects.vue'),
        meta: { title: '我的项目' },
      },
      {
        path: '/project-initiation',
        name: 'ProjectInitiation',
        component: () => import('@/views/ProjectInitiation.vue'),
        meta: { title: '项目立项' },
      },
      {
        path: '/project-progress',
        name: 'ProjectProgress',
        component: () => import('@/views/ProjectProgress.vue'),
        meta: { title: '项目进度' },
      },
      {
        path: '/project-archive',
        name: 'ProjectArchive',
        component: () => import('@/views/ProjectArchive.vue'),
        meta: { title: '项目封存' },
      },
      {
        path: '/projects/:id',
        name: 'ProjectDetail',
        component: () => import('@/views/ProjectDetail.vue'),
        meta: { title: '项目详情' },
      },
      {
        path: '/presets',
        name: 'Presets',
        component: () => import('@/views/Presets.vue'),
        meta: { title: '预设方案' },
      },
      {
        path: '/blocks',
        name: 'Blocks',
        component: () => import('@/views/Blocks.vue'),
        meta: { title: '板块设置' },
      },
      {
        path: '/events',
        name: 'Events',
        component: () => import('@/views/EventLibrary.vue'),
        meta: { title: '事件库管理' },
      },
      {
        path: '/departments',
        name: 'Departments',
        component: () => import('@/views/Departments.vue'),
        meta: { title: '部门管理' },
      },
      {
        path: '/users',
        name: 'Users',
        component: () => import('@/views/Users.vue'),
        meta: { title: '用户管理' },
      },
      {
        path: '/settings',
        name: 'Settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '个人设置' },
      },
      {
        path: '/approval',
        name: 'ApprovalCenter',
        component: () => import('@/views/ApprovalCenter.vue'),
        meta: { title: '审批中心' },
      },
      {
        path: '/approval/payment/:id',
        name: 'ApprovalPayment',
        component: () => import('@/views/ApprovalPayment.vue'),
        meta: { title: '付款' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  // 如果访问登录页
  if (to.name === 'Login') {
    // 检查是否已登录
    if (!authStore.isLoggedIn) {
      const isLoggedIn = await authStore.checkSession()
      if (isLoggedIn) {
        // 已登录，检查是否需要跳转到入职页面
        if (!authStore.hasCompletedOnboarding) {
          next({ name: 'Onboarding' })
          return
        }
        next({ name: 'Home' })
        return
      }
    } else {
      // 已登录，检查是否需要跳转到入职页面
      if (!authStore.hasCompletedOnboarding) {
        next({ name: 'Onboarding' })
        return
      }
      next({ name: 'Home' })
      return
    }
    next()
    return
  }

  // 检查是否需要认证
  if (to.meta.requiresAuth !== false) {
    // 如果未登录，检查会话
    if (!authStore.isLoggedIn) {
      const isLoggedIn = await authStore.checkSession()
      if (!isLoggedIn) {
        next({ name: 'Login', query: { redirect: to.fullPath } })
        return
      }
    }

    // 检查是否需要管理员权限
    if (to.meta.requiresAdmin) {
      const role = authStore.user?.role
      if (role !== 'super_admin' && role !== 'admin') {
        next({ name: 'Home' })
        return
      }
    }

    // 检查入职信息是否已提交（跳过入职页面本身和标记为跳过检查的页面）
    // 超级管理员不受此限制
    const role = authStore.user?.role
    if (!to.meta.skipOnboardingCheck && !authStore.hasCompletedOnboarding && role !== 'super_admin') {
      // 显示提示信息
      ElMessage.warning('请填写完入职基础信息后使用')
      next({ name: 'Onboarding' })
      return
    }
  }

  next()
})

export default router
