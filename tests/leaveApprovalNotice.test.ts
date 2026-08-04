import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import Leave from '../src/views/Leave.vue'
import { usePendingStore } from '../src/stores/pending'
import {
  markApprovedLeaveNoticesRead,
  markRejectedLeaveNoticeRead,
} from '../src/utils/leaveApi'

const { mount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

jest.mock('@/utils/leaveApi', () => ({
  markApprovedLeaveNoticesRead: jest.fn().mockResolvedValue(undefined),
  markRejectedLeaveNoticeRead: jest.fn().mockResolvedValue(0),
}))

jest.mock('@/utils/api', () => ({
  api: {
    get: jest.fn(),
  },
}))

const AlertStub = defineComponent({
  props: {
    title: { type: String, default: '' },
    type: { type: String, default: '' },
  },
  emits: ['close'],
  template: `
    <div :class="'alert-' + type">
      <span>{{ title }}</span>
      <button v-if="type === 'success'" @click="$emit('close')">关闭</button>
    </div>
  `,
})

const LeaveRequestListStub = {
  emits: ['rejected-viewed'],
  template: `
    <button class="view-rejected" @click="$emit('rejected-viewed', 'request-rejected-1')">
      查看驳回
    </button>
  `,
}

describe('员工请假审批结果提醒', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('同时展示审批通过和驳回提示，并可确认通过提醒已读', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const pendingStore = usePendingStore()
    pendingStore.counts.myLeaveApproved = 2
    pendingStore.counts.myLeaveRejected = 1
    const refreshPendingCounts = jest
      .spyOn(pendingStore, 'refreshPendingCounts')
      .mockResolvedValue(undefined)

    const wrapper = mount(Leave, {
      global: {
        plugins: [pinia],
        stubs: {
          'el-alert': AlertStub,
          'el-card': { template: '<section><slot name="header" /><slot /></section>' },
          LeaveBalancePanel: true,
          LeaveRequestForm: true,
          LeaveRequestList: LeaveRequestListStub,
        },
      },
    })

    expect(wrapper.get('.alert-success').text()).toContain('2 条请假申请已审批通过')
    expect(wrapper.get('.alert-error').text()).toContain('1 条请假申请已被驳回')

    await wrapper.get('.alert-success button').trigger('click')

    expect(markApprovedLeaveNoticesRead).toHaveBeenCalledTimes(1)
    expect(refreshPendingCounts).toHaveBeenCalledTimes(1)
  })

  it('查看驳回申请详情后立即清除对应未读提醒', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const pendingStore = usePendingStore()
    pendingStore.counts.myLeaveRejected = 1
    jest.mocked(markRejectedLeaveNoticeRead).mockResolvedValueOnce(0)

    const wrapper = mount(Leave, {
      global: {
        plugins: [pinia],
        stubs: {
          'el-alert': AlertStub,
          'el-card': { template: '<section><slot name="header" /><slot /></section>' },
          LeaveBalancePanel: true,
          LeaveRequestForm: true,
          LeaveRequestList: LeaveRequestListStub,
        },
      },
    })

    expect(wrapper.find('.alert-error').exists()).toBe(true)

    await wrapper.get('.view-rejected').trigger('click')
    await flushPromises()

    expect(markRejectedLeaveNoticeRead).toHaveBeenCalledWith('request-rejected-1')
    expect(pendingStore.counts.myLeaveRejected).toBe(0)
    expect(wrapper.find('.alert-error').exists()).toBe(false)
  })
})
