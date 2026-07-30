import { defineComponent, h } from 'vue'
import LeaveDatePicker from '../src/components/leave/LeaveDatePicker.vue'

const { flushPromises, mount } =
  require('../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js') as typeof import('@vue/test-utils')

jest.mock('@/utils/holidays', () => ({
  getHolidaysByYearSync: (year: number) =>
    year === 2026
      ? [
          {
            date: '2026-10-01',
            name: '国庆节',
            type: 'holiday',
          },
          {
            date: '2026-10-10',
            name: '国庆节补班',
            type: 'workday',
          },
        ]
      : [],
  getHolidaysByYear: jest.fn().mockResolvedValue([]),
}))

const DatePickerStub = defineComponent({
  setup(_, { slots }) {
    return () =>
      h('div', [
        slots.default?.({ date: new Date(2026, 9, 1) }),
        slots.default?.({ date: new Date(2026, 9, 10) }),
        slots.default?.({ date: new Date(2026, 9, 11) }),
      ])
  },
})

describe('请假日期选择器节假日数据', () => {
  it('异步请求为空时不清除已加载的备用节假日', async () => {
    const wrapper = mount(LeaveDatePicker, {
      props: {
        modelValue: '2026-10-31',
      },
      global: {
        stubs: {
          'el-date-picker': DatePickerStub,
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('国庆节')
    expect(wrapper.text()).toContain('班')
    expect(wrapper.find('[title="国庆节补班"]').exists()).toBe(true)
    expect(wrapper.findAll('.leave-date-cell__name')).toHaveLength(1)
  })
})
