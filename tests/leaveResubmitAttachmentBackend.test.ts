import fs from 'fs'
import path from 'path'
import { parseRemovedLeaveAttachmentIds } from '../server/utils/leave'

describe('请假草稿重提附件删除后端规则', () => {
  it('严格解析、去重并限制待删除附件编号', () => {
    expect(parseRemovedLeaveAttachmentIds(undefined)).toEqual([])
    expect(parseRemovedLeaveAttachmentIds('["attachment-1","attachment-2"]')).toEqual([
      'attachment-1',
      'attachment-2',
    ])
    expect(parseRemovedLeaveAttachmentIds('["attachment-1","attachment-1"]')).toBeNull()
    expect(parseRemovedLeaveAttachmentIds('[1]')).toBeNull()
    expect(parseRemovedLeaveAttachmentIds('not-json')).toBeNull()
    expect(parseRemovedLeaveAttachmentIds(JSON.stringify(['1', '2', '3', '4', '5', '6']))).toBeNull()
  })

  it('重提事务只删除当前草稿附件，并在提交后清理无引用物理文件', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/routes/leave.ts'),
      'utf8'
    )
    const routeStart = source.indexOf("router.post('/requests/:id/resubmit'")
    const routeEnd = source.indexOf('// ==================== 审批端接口', routeStart)
    const route = source.slice(routeStart, routeEnd)

    expect(route).toContain("originalRequest.status !== 'draft'")
    expect(route).toContain("attachment.leave_request_id === id")
    expect(route).toContain('WHERE leave_request_id = $1')
    expect(route).toContain('AND id = ANY($2::text[])')
    expect(route).toContain('DELETE FROM leave_attachments')
    expect(route).toContain('RETURNING file_path')
    expect(route).toContain('await removeUnreferencedLeaveAttachmentFiles(removedAttachmentPaths)')
    expect(route.indexOf('await removeUnreferencedLeaveAttachmentFiles')).toBeGreaterThan(
      route.indexOf('await db.transaction')
    )
    expect(route).toContain("lockedRequest.status === 'draft' ? 'submit' : 'resubmit'")
    expect(route).toContain("? `删除当前草稿附件 ${removedAttachmentIds.length} 个`")
    expect(route).toContain("lockedRequest.status === 'draft'\n              ? null\n              : '重新提交'")
  })

  it('物理文件清理包含路径边界和共享引用保护', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'server/routes/leave.ts'),
      'utf8'
    )
    expect(source).toContain("path.resolve(workspaceRoot, 'uploads', 'leave-attachments')")
    expect(source).toContain('fullPath.startsWith(`${attachmentRoot}${path.sep}`)')
    expect(source).toContain('WHERE file_path IN (?, ?, ?)')
    expect(source).toContain("?.code !== 'ENOENT'")
  })
})
