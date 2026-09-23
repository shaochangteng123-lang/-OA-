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
import fs from 'fs'
import path from 'path'
import HRApprovalCenter from '../src/views/HRApprovalCenter.vue'
import { usePendingStore } from '../src/stores/pending'

const { mount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

describe('人力资源请假审批中心', () => {
  it('总经理审批记录纳入分配给本人的历史导入申请', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/routes/leave.ts'),
      'utf8',
    )
    const reviewedRoute = source.slice(
      source.indexOf("router.get('/reviewed'"),
      source.indexOf("router.get('/employee-statistics'"),
    )

    expect(source).toContain("lal.action = 'historical_import'")
    expect(source).toContain('lr.approver_id = ?')
    expect(reviewedRoute).toContain(
      "ORDER BY CASE WHEN lal.action IN ('approve', 'reject') THEN 0 ELSE 1 END",
    )
    expect(
      reviewedRoute.match(/\$\{reviewedScope\.sql\}/g),
    ).toHaveLength(2)
    expect(reviewedRoute).toContain(
      ').get<{ total: number }>(...queryParams)',
    )
    expect(reviewedRoute).toContain('...reviewedScope.params,')
    expect(source).toContain("delegated_operator.role = 'super_admin'")
    expect(source).toContain("operatorRole === 'super_admin'")
  })

  it('工作台内容区独立纵向滚动，长统计看板不会被外层裁切', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/views/HRApprovalCenter.vue'),
      'utf8',
    )
    const panelStyle = source.slice(
      source.indexOf('.module-panel {'),
      source.indexOf('@media (max-width: 900px)'),
    )
    const workbenchStyle = source.slice(
      source.indexOf('.approval-workbench {'),
      source.indexOf('.workbench-toolbar {'),
    )

    expect(panelStyle).toContain('flex: 1 1 auto;')
    expect(panelStyle).toContain('min-height: 0;')
    expect(panelStyle).toContain('overflow-y: auto;')
    expect(panelStyle).toContain('overflow-x: hidden;')
    expect(workbenchStyle).toContain('display: flex;')
    expect(workbenchStyle).toContain('flex-direction: column;')
    expect(workbenchStyle).toContain('min-height: 0;')
    expect(workbenchStyle).toContain('overflow: hidden;')
  })

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

    const modulePanel = wrapper.find('.module-panel').element as HTMLElement
    modulePanel.scrollTop = 240
    ;(wrapper.vm as unknown as { switchModule: (name: string) => void })
      .switchModule('probation')
    await nextTick()
    expect(modulePanel.scrollTop).toBe(0)

    wrapper.unmount()
  })
})
