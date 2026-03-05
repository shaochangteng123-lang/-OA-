/**
 * 密码工具函数
 * 使用 bcrypt 进行密码哈希和验证
 */

import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

/**
 * 对密码进行哈希
 * @param password 明文密码
 * @returns 哈希后的密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * 验证密码是否正确
 * @param password 明文密码
 * @param hash 存储的哈希值
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * 同步版本的密码哈希（用于脚本）
 * @param password 明文密码
 * @returns 哈希后的密码
 */
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS)
}

/**
 * 同步版本的密码验证（用于脚本）
 * @param password 明文密码
 * @param hash 存储的哈希值
 * @returns 是否匹配
 */
export function verifyPasswordSync(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

/**
 * 验证密码强度
 * @param password 密码
 * @returns 验证结果
 */
export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password) {
    return { valid: false, message: '密码不能为空' }
  }
  if (password.length < 6) {
    return { valid: false, message: '密码至少需要6个字符' }
  }
  if (password.length > 128) {
    return { valid: false, message: '密码不能超过128个字符' }
  }
  return { valid: true }
}

/**
 * 验证用户名格式
 * @param username 用户名
 * @returns 验证结果
 */
export function validateUsername(username: string): { valid: boolean; message?: string } {
  if (!username) {
    return { valid: false, message: '用户名不能为空' }
  }
  if (username.length < 3) {
    return { valid: false, message: '用户名至少需要3个字符' }
  }
  if (username.length > 50) {
    return { valid: false, message: '用户名不能超过50个字符' }
  }
  // 只允许字母、数字、下划线
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, message: '用户名只能包含字母、数字和下划线' }
  }
  return { valid: true }
}
