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
})
