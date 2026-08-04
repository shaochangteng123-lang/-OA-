jest.mock('../src/utils/leaveApi', () => ({
  calculateDays: jest.fn().mockResolvedValue({ days: 1 }),
  calculateFullLeavePeriod: jest.fn(),
  calculatePeriodByDays: jest.fn().mockResolvedValue({
    startDate: '2026-08-10',
    startHalf: 'morning',
    endDate: '2026-08-10',
    endHalf: 'afternoon',
    days: 1,
  }),
  getLeaveTypes: jest.fn().mockResolvedValue([
    {
      id: 'annual',
      code: 'annual',
      name: '年假',
      requires_attachment: false,
      requires_balance_check: true,
      default_days: 5,
      description: null,
      sort_order: 1,
      is_active: true,
    },
    {
      id: 'other',
      code: 'other',
      name: '其他请假',
      requires_attachment: false,
      requires_balance_check: false,
      default_days: null,
      description: null,
      sort_order: 2,
      is_active: true,
    },
    {
      id: 'marriage',
      code: 'marriage',
      name: '婚假',
      requires_attachment: false,
      requires_balance_check: true,
      default_days: 3,
      description: null,
      sort_order: 3,
      is_active: true,
      is_available: false,
      unavailable_reason: '该身份证号已使用过婚假，婚假每人只能申请一次',
    },
  ]),
  getMyBalances: jest.fn().mockResolvedValue([
    {
      leave_type_code: 'annual',
      leave_type_name: '年假',
      requires_balance_check: true,
      year: 2026,
      total_days: 5,
      used_days: 0,
      pending_days: 0,
      available_days: 5,
    },
  ]),
  getRelatedLeaveContext: jest.fn().mockResolvedValue({
    parentRequest: {
      id: 'parent-request',
      request_no: 'QJ-2026-00001',
      leave_type_code: 'annual',
      leave_type_name: '年假',
      start_date: '2026-08-03',
      start_half: 'morning',
      end_date: '2026-08-07',
      end_half: 'afternoon',
      total_days: 5,
      reason: '',
    },
    suggestedExtensionStart: {
      date: '2026-08-10',
      half: 'morning',
    },
  }),
  submitRelatedLeaveRequest: jest.fn(),
}))

jest.mock('../src/components/leave/LeaveDatePicker.vue', () => ({
  __esModule: true,
  default: {
    name: 'LeaveDatePicker',
    template: '<div class="leave-date-picker-stub" />',
  },
}))

jest.mock('../src/components/leave/LeaveFileCards.vue', () => ({
  __esModule: true,
  default: {
    name: 'LeaveFileCards',
    template: '<div class="leave-file-cards-stub" />',
  },
}))

import { nextTick } from 'vue'
import LeaveRelatedRequestForm from '../src/components/leave/LeaveRelatedRequestForm.vue'
import { calculatePeriodByDays, type LeaveRequest } from '../src/utils/leaveApi'

const { mount, flushPromises } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

const FormStub = {
  methods: {
    clearValidate() {},
    validate() {
      return Promise.resolve(true)
    },
  },
  template: '<form><slot /></form>',
}

const UploadStub = {
  methods: {
    clearFiles() {},
  },
  template: '<div><slot /></div>',
}

const globalStubs = {
  'el-descriptions': { template: '<section><slot /></section>' },
  'el-descriptions-item': { template: '<div><slot /></div>' },
  'el-form': FormStub,
  'el-form-item': { template: '<section><slot /></section>' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<button><slot /></button>' },
  'el-select': { template: '<div><slot /></div>' },
  'el-option': {
    props: ['disabled', 'value'],
    template: '<div class="leave-type-option" :data-disabled="disabled" :data-value="value"><slot /></div>',
  },
  'el-button': { template: '<button><slot /></button>' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-input': { template: '<textarea />' },
  'el-input-number': { template: '<input />' },
  'el-upload': UploadStub,
  'el-icon': { template: '<span><slot /></span>' },
  LeaveDatePicker: true,
  LeaveFileCards: true,
}

function buildSourceRequest(): LeaveRequest {
  return {
    id: 'parent-request',
    request_no: 'QJ-2026-00001',
    user_id: 'employee-1',
    applicant_name: '测试员工',
    applicant_department: '项目部',
    leave_type_code: 'annual',
    leave_type_name: '年假',
    start_date: '2026-08-03',
    start_half: 'morning',
    end_date: '2026-08-07',
    end_half: 'afternoon',
    total_days: 5,
    reason: '',
    status: 'approved',
    approver_id: 'manager-1',
    approver_name: '审批人',
    reject_reason: null,
    approved_at: '2026-07-31T01:00:00.000Z',
    rejected_at: null,
    cancelled_at: null,
    submitted_at: '2026-07-30T01:00:00.000Z',
    version: 1,
    original_id: null,
    application_kind: 'normal',
    combination_group_id: null,
    parent_request_id: null,
    created_at: '2026-07-30T01:00:00.000Z',
    updated_at: '2026-07-31T01:00:00.000Z',
  }
}

describe('续假补假组合申请表单', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it.each([
    ['extension', '组合续假'],
    ['supplement', '组合补假'],
  ] as const)('支持从单一申请切换到%s组合分配', async (relationType, combinedLabel) => {
    const wrapper = mount(LeaveRelatedRequestForm, {
      props: {
        sourceRequest: buildSourceRequest(),
        relationType,
      },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    expect(wrapper.text()).toContain(combinedLabel)

    const vm = wrapper.vm as unknown as {
      requestMode: 'single' | 'combined'
      handleModeChange: () => void
    }
    vm.requestMode = 'combined'
    vm.handleModeChange()
    await nextTick()

    expect(wrapper.text()).toContain('组合总计')
    expect(wrapper.text()).toContain('添加假期类型')

    wrapper.unmount()
  })

  it('按身份证号资格锁定已申请过的婚假', async () => {
    const wrapper = mount(LeaveRelatedRequestForm, {
      props: {
        sourceRequest: buildSourceRequest(),
        relationType: 'supplement',
      },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const marriageOption = wrapper.get('[data-value="marriage"]')
    expect(marriageOption.attributes('data-disabled')).toBe('true')
    expect(marriageOption.text()).toContain('已锁定')

    wrapper.unmount()
  })

  it('手动调整组合补假结束时间后，修改分配不改变时间段', async () => {
    const wrapper = mount(LeaveRelatedRequestForm, {
      props: {
        sourceRequest: buildSourceRequest(),
        relationType: 'supplement',
      },
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      form: {
        endDate: string
        endHalf: 'morning' | 'afternoon'
      }
      requestMode: 'single' | 'combined'
      segments: Array<{
        key: number
        leaveTypeCode: string
        days: number | null
        reason: string
      }>
      handleModeChange: () => void
      onEndDateChange: () => void
      handleSegmentTypeChange: (segment: {
        key: number
        leaveTypeCode: string
        days: number | null
        reason: string
      }) => void
    }

    vm.requestMode = 'combined'
    vm.handleModeChange()
    jest.advanceTimersByTime(300)
    await flushPromises()

    vm.form.endDate = '2026-08-14'
    vm.form.endHalf = 'afternoon'
    vm.onEndDateChange()
    jest.advanceTimersByTime(300)
    await flushPromises()

    const automaticPeriodCalculation = calculatePeriodByDays as jest.Mock
    automaticPeriodCalculation.mockClear()

    vm.segments[1].leaveTypeCode = 'other'
    vm.handleSegmentTypeChange(vm.segments[1])
    await nextTick()

    expect(vm.form.endDate).toBe('2026-08-14')
    expect(vm.form.endHalf).toBe('afternoon')
    expect(automaticPeriodCalculation).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
