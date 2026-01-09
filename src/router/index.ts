import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
        path: '/projects',
        name: 'Projects',
        component: () => import('@/views/Projects.vue'),
        meta: { title: '我的项目' },
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
        next({ name: 'Home' })
        return
      }
    } else {
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
  }

  next()
})

export default router
