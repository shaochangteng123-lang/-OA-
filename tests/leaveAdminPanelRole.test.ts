jest.mock('../src/utils/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}))

jest.mock('../src/utils/leaveApi', () => ({
  getLeaveTypes: jest.fn().mockResolvedValue([]),
  adminGetTypes: jest.fn().mockResolvedValue([]),
  adminCreateType: jest.fn(),
  adminUpdateType: jest.fn(),
  adminDeleteType: jest.fn(),
  adminGetRequests: jest.fn().mockResolvedValue({ list: [], total: 0 }),
  adminGetBalances: jest.fn().mockResolvedValue({ users: [], types: [] }),
  adminAdjustBalance: jest.fn(),
  getRequestDetail: jest.fn(),
  getExportUrl: jest.fn().mockReturnValue('/api/leave/admin/export'),
}))

jest.mock('../src/components/leave/LeaveApprovalTimeline.vue', () => ({
  __esModule: true,
  default: {
    name: 'LeaveApprovalTimeline',
    template: '<div />',
  },
}))

jest.mock('../src/components/leave/LeavePendingList.vue', () => ({
  __esModule: true,
  default: {
    name: 'LeavePendingList',
    template: '<div class="leave-pending-list-stub" />',
  },
}))

import { createPinia, setActivePinia } from 'pinia'
import LeaveAdminPanel from '../src/components/leave/LeaveAdminPanel.vue'
import { useAuthStore } from '../src/stores/auth'

const { shallowMount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<section><slot /></section>' },
  'el-input': true,
  'el-option': true,
  'el-select': true,
  'el-date-picker': true,
  'el-button': true,
  'el-icon': true,
  'el-table': true,
  'el-table-column': true,
  'el-tag': true,
  'el-pagination': true,
  'el-popconfirm': true,
  'el-input-number': true,
  'el-tooltip': true,
  'el-drawer': true,
  'el-skeleton': true,
  'el-form': true,
  'el-form-item': true,
  'el-switch': true,
  'el-dialog': true,
  'el-descriptions': true,
  'el-descriptions-item': true,
}

function createUser(role: 'chairman' | 'admin') {
  return {
    id: `${role}-id`,
    name: role === 'chairman' ? '董事长' : '管理员',
    email: null,
    avatarUrl: null,
    role,
    status: 'active' as const,
  }
}

describe('员工数据请假管理角色入口', () => {
  it('董事长默认进入请假审批并显示待办组件', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = createUser('chairman')

    const wrapper = shallowMount(LeaveAdminPanel, {
      global: {
        plugins: [pinia],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      isChairman: boolean
      activeSubTab: string
    }
    expect(vm.isChairman).toBe(true)
    expect(vm.activeSubTab).toBe('approval')
    expect(wrapper.findComponent({ name: 'LeavePendingList' }).exists()).toBe(true)

    wrapper.unmount()
  })

  it('管理员默认进入抄送记录且不显示审批组件', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = createUser('admin')

    const wrapper = shallowMount(LeaveAdminPanel, {
      global: {
        plugins: [pinia],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      isChairman: boolean
      activeSubTab: string
    }
    expect(vm.isChairman).toBe(false)
    expect(vm.activeSubTab).toBe('requests')
    expect(wrapper.findComponent({ name: 'LeavePendingList' }).exists()).toBe(false)

    wrapper.unmount()
  })

  it('病假余额检查可以自由开关，其他固定额度类型保持原规则', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = createUser('admin')

    const wrapper = shallowMount(LeaveAdminPanel, {
      global: {
        plugins: [pinia],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      isFixedBalanceType: (code: string) => boolean
      openEditTypeDialog: (row: {
        id: string
        code: string
        name: string
        requires_attachment: boolean
        requires_balance_check: boolean
        default_days: number
        description: string
        sort_order: number
        is_active: boolean
      }) => void
      editTypeForm: {
        default_days: number
        requires_balance_check: boolean
        requires_attachment: boolean
      }
    }

    expect(vm.isFixedBalanceType('annual')).toBe(true)
    expect(vm.isFixedBalanceType('sick')).toBe(false)

    vm.openEditTypeDialog({
      id: 'lt_sick',
      code: 'sick',
      name: '病假',
      requires_attachment: true,
      requires_balance_check: true,
      default_days: 3,
      description: '需提供证明材料',
      sort_order: 3,
      is_active: true,
    })

    expect(vm.editTypeForm).toMatchObject({
      default_days: 3,
      requires_balance_check: true,
      requires_attachment: true,
    })

    vm.openEditTypeDialog({
      id: 'lt_sick',
      code: 'sick',
      name: '病假',
      requires_attachment: true,
      requires_balance_check: false,
      default_days: 3,
      description: '需提供证明材料',
      sort_order: 3,
      is_active: true,
    })
    expect(vm.editTypeForm.requires_balance_check).toBe(false)

    wrapper.unmount()
  })
})
