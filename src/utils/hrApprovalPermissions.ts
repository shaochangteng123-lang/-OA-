import type { UserRole } from '@/types'

export const HR_APPROVAL_CENTER_ROLES: UserRole[] = ['general_manager', 'super_admin']

export function canAccessHRApprovalCenter(role: UserRole | null | undefined): boolean {
  return role === 'general_manager' || role === 'super_admin'
}
