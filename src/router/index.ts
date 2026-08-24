import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { ElMessage } from "element-plus";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/Login.vue"),
    meta: { requiresAuth: false },
  },
  {
    path: "/invoice-print",
    name: "InvoicePrint",
    component: () => import("@/views/InvoicePrint.vue"),
    meta: { requiresAuth: true, skipOnboardingCheck: true },
  },
  {
    path: "/onboarding/template-preview/:templateId",
    name: "OnboardingTemplatePreview",
    component: () => import("@/views/OnboardingTemplatePreview.vue"),
    meta: { requiresAuth: true, skipOnboardingCheck: true },
  },
  {
    path: "/resignation-template-editor/:requestId",
    name: "ResignationTemplateEditor",
    component: () => import("@/views/ResignationTemplateEditorPage.vue"),
    meta: {
      requiresAuth: true,
      requiresAdmin: true,
      skipOnboardingCheck: true,
    },
  },
  {
    path: "/",
    component: () => import("@/layouts/MainLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "Home",
        component: () => import("@/views/DailyLog.vue"),
        meta: { title: "今日日志" },
      },
      {
        path: "/boss-dashboard",
        name: "BossDashboard",
        component: () => import("@/views/BossDashboard.vue"),
        meta: {
          title: "羽隶经营看板",
          requiresRole: ["super_admin", "admin", "boss"],
        },
      },
      {
        path: "/contracts",
        name: "ContractList",
        component: () => import("@/views/ContractList.vue"),
        meta: {
          title: "合同管理",
          requiresRole: [
            "super_admin",
            "chairman",
            "admin",
            "general_manager",
            "boss",
            "user",
          ],
        },
      },
      {
        path: "/contracts/create",
        name: "ContractCreate",
        component: () => import("@/views/ContractCreate.vue"),
        meta: { title: "新增合同", requiresAdmin: true },
      },
      {
        path: "/contracts/cancelled",
        name: "CancelledContracts",
        component: () => import("@/views/CancelledContracts.vue"),
        meta: { title: "已撤销合同", requiresAdmin: true },
      },
      {
        path: "/contracts/:id",
        name: "ContractDetail",
        component: () => import("@/views/ContractDetail.vue"),
        meta: {
          title: "合同详情",
          requiresRole: [
            "super_admin",
            "chairman",
            "admin",
            "general_manager",
            "boss",
            "user",
          ],
        },
      },
      {
        path: "/contract-approvals",
        name: "ContractApprovalCenter",
        component: () => import("@/views/ContractApprovalCenter.vue"),
        meta: {
          title: "合同审批",
          requiresRole: ["general_manager"],
        },
      },
      {
        path: "/contract-applications/mine",
        name: "MyContractApplications",
        component: () => import("@/views/MyContractApplications.vue"),
        meta: {
          title: "我的申请",
          requiresRole: ["user"],
        },
      },
      {
        path: "/contract-download-requests/new",
        name: "ContractDownloadRequestCreate",
        component: () => import("@/views/ContractDownloadRequestCreate.vue"),
        meta: {
          title: "申请下载合同附件",
          requiresRole: ["user"],
        },
      },
      {
        path: "/contract-download-requests/mine",
        name: "ContractDownloadRequestList",
        redirect: (to) => ({
          path: "/contract-applications/mine",
          query: { ...to.query, tab: "download" },
        }),
        meta: {
          title: "我的申请",
          requiresRole: ["user"],
        },
      },
      {
        path: "/contract-download-requests/approval",
        name: "ContractDownloadRequestApproval",
        component: () => import("@/views/ContractDownloadRequestCenter.vue"),
        meta: {
          title: "合同下载申请审批",
          requiresRole: ["general_manager"],
        },
      },
      {
        path: "/contract-tasks",
        name: "AdminContractTasks",
        component: () => import("@/views/AdminContractTasks.vue"),
        meta: {
          title: "合同待办",
          requiresAdmin: true,
        },
      },
      {
        path: "/contract-download-requests/tasks",
        name: "ContractDownloadTaskList",
        redirect: (to) => ({
          path: "/contract-tasks",
          query: { ...to.query, tab: "download" },
        }),
        meta: {
          title: "合同待办",
          requiresRole: ["admin"],
        },
      },
      {
        path: "/invoice-applications/new",
        name: "InvoiceApplicationCreate",
        component: () => import("@/views/InvoiceApplicationCreate.vue"),
        meta: {
          title: "发起开票及用印申请",
          requiresRole: ["user"],
        },
      },
      {
        path: "/invoice-applications/mine",
        name: "InvoiceApplicationList",
        redirect: (to) => ({
          path: "/contract-applications/mine",
          query: { ...to.query, tab: "invoice" },
        }),
        meta: {
          title: "我的申请",
          requiresRole: ["user"],
        },
      },
      {
        path: "/invoice-applications/approval",
        name: "InvoiceApplicationApproval",
        component: () => import("@/views/InvoiceApplicationCenter.vue"),
        meta: {
          title: "开票申请审批",
          requiresRole: ["general_manager"],
        },
      },
      {
        path: "/invoice-applications/tasks",
        name: "InvoiceApplicationTasks",
        redirect: (to) => ({
          path: "/contract-tasks",
          query: { ...to.query, tab: "invoice" },
        }),
        meta: {
          title: "合同待办",
          requiresAdmin: true,
        },
      },
      {
        path: "/contract-dashboard",
        name: "ContractDashboard",
        component: () => import("@/views/ContractDashboard.vue"),
        meta: {
          title: "合同经营看板",
          requiresRole: [
            "super_admin",
            "chairman",
            "admin",
            "general_manager",
            "boss",
          ],
        },
      },
      {
        path: "/calendar",
        name: "Calendar",
        component: () => import("@/views/Calendar.vue"),
        meta: { title: "日历" },
      },
      {
        path: "/daily-log",
        name: "DailyLog",
        component: () => import("@/views/DailyLog.vue"),
        meta: { title: "今日日志" },
      },
      {
        path: "/history",
        name: "History",
        component: () => import("@/views/History.vue"),
        meta: { title: "历史日志" },
      },
      {
        path: "/worklog-projects",
        name: "WorklogProjectList",
        component: () => import("@/views/WorklogProjectList.vue"),
        meta: { title: "项目动态" },
      },
      {
        path: "/worklog-reports",
        name: "WorklogReports",
        component: () => import("@/views/WorklogReports.vue"),
        meta: {
          title: "日志中心",
          requiresRole: ["super_admin", "admin", "general_manager"],
        },
      },
      {
        path: "/worklog-dicts",
        name: "WorklogDictManager",
        component: () => import("@/views/WorklogDictManager.vue"),
        meta: {
          title: "日志管理",
          requiresRole: ["super_admin", "admin", "general_manager"],
        },
      },
      {
        path: "/team-logs",
        name: "TeamDailyLogs",
        component: () => import("@/views/TeamDailyLogs.vue"),
        meta: {
          title: "团队日志",
          requiresRole: ["super_admin", "admin", "general_manager"],
        },
      },
      {
        path: "/team-weekly-report",
        name: "TeamWeeklyReport",
        component: () => import("@/views/TeamWeeklyReport.vue"),
        meta: {
          title: "团队周报",
          requiresRole: ["super_admin", "admin", "general_manager"],
        },
      },
      {
        path: "/basic-reimbursement",
        name: "BasicReimbursement",
        component: () => import("@/views/BasicReimbursement.vue"),
        meta: { title: "基础报销" },
      },
      {
        path: "/basic-reimbursement/create",
        name: "BasicReimbursementCreate",
        component: () => import("@/views/BasicReimbursementCreate.vue"),
        meta: { title: "新建报销单" },
      },
      {
        path: "/basic-reimbursement/:id",
        name: "BasicReimbursementDetail",
        component: () => import("@/views/BasicReimbursementDetail.vue"),
        meta: { title: "报销单详情" },
      },
      {
        path: "/large-reimbursement",
        name: "LargeReimbursement",
        component: () => import("@/views/LargeReimbursement.vue"),
        meta: { title: "大额报销" },
      },
      {
        path: "/large-reimbursement/create",
        name: "LargeReimbursementCreate",
        component: () => import("@/views/LargeReimbursementCreate.vue"),
        meta: { title: "新建大额报销单" },
      },
      {
        path: "/large-reimbursement/:id",
        name: "LargeReimbursementDetail",
        component: () => import("@/views/LargeReimbursementDetail.vue"),
        meta: { title: "大额报销单详情" },
      },
      {
        path: "/business-reimbursement",
        name: "BusinessReimbursement",
        component: () => import("@/views/BusinessReimbursement.vue"),
        meta: { title: "商务报销" },
      },
      {
        path: "/business-reimbursement/create",
        name: "BusinessReimbursementCreate",
        component: () => import("@/views/BusinessReimbursementCreate.vue"),
        meta: { title: "新建商务报销单" },
      },
      {
        path: "/business-reimbursement/:id",
        name: "BusinessReimbursementDetail",
        component: () => import("@/views/BusinessReimbursementDetail.vue"),
        meta: { title: "商务报销单详情" },
      },
      {
        path: "/reimbursement-statistics",
        name: "ReimbursementStatistics",
        component: () => import("@/views/ReimbursementStatistics.vue"),
        meta: { title: "报销统计" },
      },
      {
        path: "/monthly-financial-report",
        name: "MonthlyFinancialReport",
        component: () => import("@/views/MonthlyFinancialReport.vue"),
        meta: {
          title: "月度财务报表",
          requiresRole: ["admin", "general_manager"],
        },
      },
      {
        path: "/reimbursement-management",
        name: "ReimbursementManagement",
        component: () => import("@/views/ReimbursementManagement.vue"),
        meta: { title: "报销管理", requiresAdmin: true },
      },
      {
        path: "/onboarding",
        name: "Onboarding",
        component: () => import("@/views/Onboarding.vue"),
        meta: { title: "入职", skipOnboardingCheck: true },
      },
      {
        path: "/probation",
        name: "Probation",
        component: () => import("@/views/Probation.vue"),
        meta: { title: "转正申请" },
      },
      {
        path: "/probation/application",
        name: "ProbationApplication",
        component: () => import("@/views/ProbationApplication.vue"),
        meta: { title: "填写转正申请单" },
      },
      {
        path: "/resignation",
        name: "Resignation",
        redirect: { path: "/employee-data", query: { tab: "resignation" } },
        meta: { title: "", requiresAdmin: true },
      },
      {
        path: "/employee-data",
        name: "EmployeeData",
        component: () => import("@/views/EmployeeData.vue"),
        meta: { title: "", requiresAdmin: true },
      },
      {
        path: "/leave",
        name: "Leave",
        component: () => import("@/views/Leave.vue"),
        meta: { title: "请假" },
      },
      {
        path: "/gm-probation-approval",
        name: "GMProbationApproval",
        component: () => import("@/views/HRApprovalCenter.vue"),
        meta: {
          title: "审批中心",
          requiresRole: ["general_manager"],
        },
      },
      {
        path: "/projects",
        name: "Projects",
        component: () => import("@/views/Projects.vue"),
        meta: { title: "我的项目" },
      },
      {
        path: "/project-initiation",
        name: "ProjectInitiation",
        component: () => import("@/views/ProjectInitiation.vue"),
        meta: { title: "项目立项" },
      },
      {
        path: "/project-progress",
        name: "ProjectProgress",
        component: () => import("@/views/ProjectProgress.vue"),
        meta: { title: "项目进度" },
      },
      {
        path: "/project-archive",
        name: "ProjectArchive",
        component: () => import("@/views/ProjectArchive.vue"),
        meta: { title: "项目封存" },
      },
      {
        path: "/projects/:id",
        name: "ProjectDetail",
        component: () => import("@/views/ProjectDetail.vue"),
        meta: { title: "项目详情" },
      },
      {
        path: "/presets",
        name: "Presets",
        component: () => import("@/views/Presets.vue"),
        meta: { title: "预设方案" },
      },
      {
        path: "/blocks",
        name: "Blocks",
        component: () => import("@/views/Blocks.vue"),
        meta: { title: "板块设置" },
      },
      {
        path: "/events",
        name: "Events",
        component: () => import("@/views/EventLibrary.vue"),
        meta: { title: "事件库管理" },
      },
      {
        path: "/departments",
        name: "Departments",
        component: () => import("@/views/Departments.vue"),
        meta: { title: "部门管理" },
      },
      {
        path: "/users",
        name: "Users",
        component: () => import("@/views/Users.vue"),
        meta: { title: "用户管理", requiresAdmin: true },
      },
      {
        path: "/settings",
        name: "Settings",
        component: () => import("@/views/Settings.vue"),
        meta: { title: "个人设置" },
      },
      {
        path: "/approval",
        name: "ApprovalCenter",
        component: () => import("@/views/ApprovalCenter.vue"),
        meta: { title: "审批中心", requiresAdmin: true },
      },
      {
        path: "/gm-approval",
        name: "GMApprovalCenter",
        component: () => import("@/views/GMApprovalCenter.vue"),
        meta: {
          title: "审批中心",
          requiresRole: ["super_admin", "admin", "general_manager"],
        },
      },
      {
        path: "/approval/payment/:id",
        name: "ApprovalPayment",
        component: () => import("@/views/ApprovalPayment.vue"),
        meta: { title: "付款", requiresAdmin: true },
      },
      {
        path: "/approval/batch-payment/:batchId",
        name: "BatchPayment",
        component: () => import("@/views/ApprovalPayment.vue"),
        meta: { title: "批量付款", requiresAdmin: true },
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    redirect: "/",
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // 如果访问登录页
  if (to.name === "Login") {
    // 检查是否已登录
    if (!authStore.isLoggedIn) {
      const isLoggedIn = await authStore.checkSession();
      if (isLoggedIn) {
        if (authStore.user?.role === "boss") {
          next({ name: "BossDashboard" });
          return;
        }
        // 已登录，检查是否需要跳转到入职页面
        if (!authStore.hasCompletedOnboarding) {
          next({ name: "Onboarding" });
          return;
        }
        next({ name: "Home" });
        return;
      }
    } else {
      if (authStore.user?.role === "boss") {
        next({ name: "BossDashboard" });
        return;
      }
      // 已登录，检查是否需要跳转到入职页面
      if (!authStore.hasCompletedOnboarding) {
        next({ name: "Onboarding" });
        return;
      }
      next({ name: "Home" });
      return;
    }
    next();
    return;
  }

  // 检查是否需要认证
  if (to.meta.requiresAuth !== false) {
    // 如果未登录，检查会话
    if (!authStore.isLoggedIn) {
      const isLoggedIn = await authStore.checkSession();
      if (!isLoggedIn) {
        // 如果有 redirect 参数，说明是从受保护页面被踢出（登录已过期）
        const query: Record<string, string> = { redirect: to.fullPath };
        if (to.fullPath !== "/") {
          query.reason = "expired";
        }
        next({ name: "Login", query });
        return;
      }
    }

    // 检查是否需要管理员权限
    if (to.meta.requiresAdmin) {
      const role = authStore.user?.role;
      if (role !== "super_admin" && role !== "chairman" && role !== "admin") {
        next({ name: "Home" });
        return;
      }
    }

    // 检查是否需要特定角色权限
    if (to.meta.requiresRole) {
      const role = authStore.user?.role;
      const requiredRoles = to.meta.requiresRole as string[];
      const roleAllowed =
        !!role &&
        (requiredRoles.includes(role) ||
          (role === "chairman" && requiredRoles.includes("super_admin")));
      if (!roleAllowed) {
        next({ name: "Home" });
        return;
      }
    }

    // 注意：强制修改密码通过 MainLayout 弹窗处理，不在此做路由跳转

    // 检查入职信息是否已提交；BOSS账号不属于员工，无需填写入职资料。
    if (
      authStore.user?.role !== "boss" &&
      !to.meta.skipOnboardingCheck &&
      !authStore.hasCompletedOnboarding
    ) {
      // 显示提示信息
      ElMessage.warning("请填写完入职基础信息后使用");
      next({ name: "Onboarding" });
      return;
    }

    // BOSS角色以只读经营分析为主，不进入普通业务操作页面。
    if (
      authStore.user?.role === "boss" &&
      ![
        "BossDashboard",
        "ContractList",
        "ContractDashboard",
        "ContractDetail",
        "Settings",
      ].includes(String(to.name))
    ) {
      next({ name: "BossDashboard" });
      return;
    }
  }

  next();
});

export default router;
