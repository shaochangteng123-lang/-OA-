import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import Leave from '../src/views/Leave.vue'
import { usePendingStore } from '../src/stores/pending'
import { markApprovedLeaveNoticesRead } from '../src/utils/leaveApi'

const { mount } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

jest.mock('@/utils/leaveApi', () => ({
  markApprovedLeaveNoticesRead: jest.fn().mockResolvedValue(undefined),
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
          LeaveRequestList: true,
        },
      },
    })

    expect(wrapper.get('.alert-success').text()).toContain('2 条请假申请已审批通过')
    expect(wrapper.get('.alert-error').text()).toContain('1 条请假申请已被驳回')

    await wrapper.get('.alert-success button').trigger('click')

    expect(markApprovedLeaveNoticesRead).toHaveBeenCalledTimes(1)
    expect(refreshPendingCounts).toHaveBeenCalledTimes(1)
  })
})
