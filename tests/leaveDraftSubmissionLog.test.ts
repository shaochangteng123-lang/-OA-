import fs from 'fs'
import path from 'path'

describe('撤回草稿再次提交日志语义', () => {
  it('后端按事务内状态区分提交申请和驳回重提', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/routes/leave.ts'),
      'utf8'
    )
    expect(source).toContain("lockedRequest.status === 'draft' ? 'submit' : 'resubmit'")
    expect(source).toContain(
      "message: originalRequest.status === 'draft' ? '请假申请已提交' : '已重新提交申请'"
    )
  })

  it('启动迁移只修正同一申请撤回后的旧重新提交日志', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/db/index.ts'),
      'utf8'
    )
    const start = source.indexOf('const draftSubmitLogMigration')
    const end = source.indexOf('if ((draftSubmitLogMigration', start)
    const migration = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(migration).toContain("SET action = 'submit'")
    expect(migration).toContain("WHERE action = 'resubmit'")
    expect(migration).toContain("previous_action = 'cancel'")
    expect(migration).toContain('previous_created_at < created_at')
    expect(migration).toContain('same_time_count = 1')
    expect(migration).toContain('previous_same_time_count = 1')
    expect(migration).toContain('AND all_times_valid')
    expect(migration).toContain("BTRIM(COALESCE(target.comment, '')) = '重新提交'")
    expect(migration).toContain("THEN REPLACE(target.comment, '重新提交，', '')")
    expect(migration).toContain("THEN REPLACE(target.comment, '提交申请，', '')")
  })

  it('页面不再把草稿提交操作写成重新提交', () => {
    const listSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/leave/LeaveRequestList.vue'),
      'utf8'
    )
    const formSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/leave/LeaveResubmitForm.vue'),
      'utf8'
    )
    expect(listSource).toContain("row.status === 'draft' ? '提交申请' : '修改重提'")
    expect(listSource).toContain("'编辑草稿并提交申请'")
    expect(formSource).toContain("isDraft.value ? '提交申请' : '重新提交'")
  })
})
