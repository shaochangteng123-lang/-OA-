jest.mock('../src/utils/leaveApi', () => ({
  calculateDays: jest.fn().mockResolvedValue({ days: 10 }),
  calculateFullLeavePeriod: jest.fn(),
  calculatePeriodByDays: jest.fn().mockResolvedValue({
    startDate: '2026-08-10',
    startHalf: 'morning',
    endDate: '2026-08-12',
    endHalf: 'afternoon',
    days: 3,
  }),
  getLeaveTypes: jest.fn().mockResolvedValue([
    {
      id: 'personal',
      code: 'personal',
      name: '带薪事假',
      requires_attachment: false,
      requires_balance_check: true,
      default_days: 3,
      description: null,
      sort_order: 1,
      is_active: true,
      is_available: true,
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
      is_available: true,
    },
  ]),
  getMyBalances: jest.fn().mockResolvedValue([
    {
      leave_type_code: 'personal',
      leave_type_name: '带薪事假',
      requires_balance_check: true,
      year: 2026,
      total_days: 3,
      used_days: 0,
      pending_days: 0,
      available_days: 3,
      is_available: true,
    },
  ]),
  submitCombinedLeaveRequests: jest.fn(),
  submitLeaveRequest: jest.fn(),
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
import LeaveRequestForm from '../src/components/leave/LeaveRequestForm.vue'
import { calculatePeriodByDays } from '../src/utils/leaveApi'

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
  'el-form': FormStub,
  'el-form-item': { template: '<section><slot /></section>' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<button><slot /></button>' },
  'el-select': { template: '<div><slot /></div>' },
  'el-option': { template: '<div><slot /></div>' },
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

describe('组合请假时间段', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('手动选择开始和结束时间后，新增假期类型不改变请假时长', async () => {
    const wrapper = mount(LeaveRequestForm, {
      global: { stubs: globalStubs },
    })
    await flushPromises()

    const vm = wrapper.vm as unknown as {
      form: {
        startDate: string
        startHalf: 'morning' | 'afternoon'
        endDate: string
        endHalf: 'morning' | 'afternoon'
      }
      requestMode: 'single' | 'combined'
      calculatedDays: number | null
      segments: Array<{
        key: number
        leaveTypeCode: string
        days: number | null
        reason: string
      }>
      onEndDateChange: () => void
      handleModeChange: () => void
      handleSegmentTypeChange: (segment: {
        key: number
        leaveTypeCode: string
        days: number | null
        reason: string
      }) => void
      handleSegmentDaysChange: () => void
    }

    vm.form.startDate = '2026-08-10'
    vm.form.startHalf = 'morning'
    vm.form.endDate = '2026-08-21'
    vm.form.endHalf = 'afternoon'
    vm.onEndDateChange()
    jest.advanceTimersByTime(400)
    await flushPromises()
    expect(vm.calculatedDays).toBe(10)

    vm.requestMode = 'combined'
    vm.handleModeChange()
    jest.advanceTimersByTime(300)
    await flushPromises()

    const automaticPeriodCalculation = calculatePeriodByDays as jest.Mock
    automaticPeriodCalculation.mockClear()

    vm.segments[0].leaveTypeCode = 'personal'
    vm.handleSegmentTypeChange(vm.segments[0])
    vm.segments[1].leaveTypeCode = 'other'
    vm.handleSegmentTypeChange(vm.segments[1])
    vm.segments[1].days = 7
    vm.handleSegmentDaysChange()
    await nextTick()

    expect(vm.form.endDate).toBe('2026-08-21')
    expect(vm.form.endHalf).toBe('afternoon')
    expect(vm.calculatedDays).toBe(10)
    expect(automaticPeriodCalculation).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('组合总计 10 天')
    expect(wrapper.text()).toContain('分配已完成')

    wrapper.unmount()
  })
})
