jest.mock('../src/utils/api', () => ({
  api: {
    get: jest.fn(),
  },
}))

jest.mock('../src/views/GMProbationApproval.vue', () => ({
  __esModule: true,
  default: {
    name: 'GMProbationApproval',
    template: '<div class="probation-panel-stub" />',
  },
}))

jest.mock('../src/components/leave/LeavePendingList.vue', () => ({
  __esModule: true,
  default: {
    name: 'LeavePendingList',
    template: '<div class="leave-panel-stub">请假列表</div>',
  },
}))

import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import HRApprovalCenter from '../src/views/HRApprovalCenter.vue'
import { usePendingStore } from '../src/stores/pending'

const { mount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

describe('人力资源请假审批中心', () => {
  it('展示请假待办和请假审批页签，供总经理处理普通员工任务', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const pendingStore = usePendingStore()
    pendingStore.counts.probationPending = 0
    pendingStore.counts.leaveApprovalPending = 2
    jest.spyOn(pendingStore, 'fetchPendingCounts').mockResolvedValue()

    const wrapper = mount(HRApprovalCenter, {
      global: {
        plugins: [pinia],
        stubs: {
          'el-icon': { template: '<span><slot /></span>' },
          'el-tooltip': { template: '<span><slot /></span>' },
          'el-button': { template: '<button><slot /></button>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.text()).toContain('请假待审')
    expect(wrapper.text()).toContain('请假审批')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.find('.leave-panel-stub').exists()).toBe(true)

    wrapper.unmount()
  })
})
