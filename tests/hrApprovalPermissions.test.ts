import fs from 'fs'
import path from 'path'
import { canAccessHRApprovalCenter, HR_APPROVAL_CENTER_ROLES } from '../src/utils/hrApprovalPermissions'
import { isRouteRoleAllowed } from '../src/utils/routeRoleAccess'
import type { UserRole } from '../src/types'

describe('人力资源审批中心权限', () => {
  it.each<[UserRole | undefined, boolean]>([
    ['general_manager', true], ['super_admin', true],
    ['admin', false], ['chairman', false], ['user', false], ['boss', false], ['guest', false], [undefined, false],
  ])('%s 的菜单能力与精确路由权限一致', (role, allowed) => {
    expect(canAccessHRApprovalCenter(role)).toBe(allowed)
    expect(isRouteRoleAllowed(role, HR_APPROVAL_CENTER_ROLES, true)).toBe(allowed)
  })

  it('审批中心路由启用精确角色判断，不通过董事长的管理权限继承放行', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/router/index.ts'), 'utf8')
    const start = source.indexOf('path: "/gm-probation-approval"')
    const route = source.slice(start, source.indexOf('path:', start + 8))
    expect(route).toContain('requiresRole: HR_APPROVAL_CENTER_ROLES')
    expect(route).toContain('requiresExactRole: true')
  })
})
