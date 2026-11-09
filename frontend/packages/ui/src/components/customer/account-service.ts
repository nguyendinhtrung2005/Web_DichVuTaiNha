"use client"

import { apiRequest } from '@/lib/api-client'
import { acceptCustomerAuthentication, captureCustomerSession, customerRequestError, finishCustomerMutation, isCustomerSessionCurrent, normalizeCustomerUser, type CustomerSessionScope } from '@/lib/customer-api-store'
import type { User } from '@/lib/types'
import type { Persistence } from './booking-service'

export type CustomerRegistrationInput = { name: string; phone: string; email?: string; password: string }
export type CustomerProfilePatch = Pick<User, 'name' | 'phone'> & { email?: string }
export type AccountResult = { ok: true; user: User; persistence: Persistence; scope: CustomerSessionScope; warning?: string } | { ok: false; error: string }
export type ProfileResult = { ok: true; persistence: Persistence } | { ok: false; error: string }
export interface CustomerAccountService {
  login(identifier: string, password: string): Promise<AccountResult>
  register(input: CustomerRegistrationInput): Promise<AccountResult>
  saveProfile(userId: string, patch: CustomerProfilePatch, expectedUser?: User): Promise<ProfileResult>
}

export const customerAccountService: CustomerAccountService = {
  async login(identifier, password) {
    const scope = captureCustomerSession()
    try {
      const user = normalizeCustomerUser(await apiRequest<User>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), password }) }))
      return await acceptedAuthentication(user, scope, false)
    } catch (error) { return { ok: false, error: customerRequestError(error, scope) } }
  },
  async register(input) {
    const scope = captureCustomerSession()
    try {
      const body = { name: input.name.trim(), phone: input.phone.trim(), password: input.password, ...(input.email?.trim() ? { email: input.email.trim() } : {}) }
      const user = normalizeCustomerUser(await apiRequest<User>('/auth/register', { method: 'POST', body: JSON.stringify(body) }))
      return await acceptedAuthentication(user, scope, true)
    } catch (error) { return { ok: false, error: customerRequestError(error, scope) } }
  },
  async saveProfile(userId, patch) {
    const scope = captureCustomerSession()
    if (scope.userId !== userId) return { ok: false, error: 'Phiên đã thay đổi. Vui lòng mở lại hồ sơ hiện tại.' }
    try {
      await apiRequest<User>('/users/me', { method: 'PATCH', body: JSON.stringify({ name: patch.name.trim(), phone: patch.phone.trim(), ...(patch.email === undefined ? {} : { email: patch.email.trim() }) }) })
      if (!isCustomerSessionCurrent(scope)) return { ok: false, error: 'Phiên đã thay đổi. Vui lòng kiểm tra hồ sơ hiện tại.' }
      await finishCustomerMutation(scope)
      return { ok: true, persistence: 'server' }
    } catch (error) { return { ok: false, error: customerRequestError(error, scope) } }
  },
}

async function acceptedAuthentication(user: User, requestScope: CustomerSessionScope, registered: boolean): Promise<AccountResult> {
  const scope = acceptCustomerAuthentication(user, requestScope)
  try {
    await finishCustomerMutation(scope)
    return { ok: true, user, scope, persistence: 'server' }
  } catch {
    return {
      ok: true, user, scope, persistence: 'server',
      warning: registered
        ? 'Tài khoản đã được tạo. Chưa tải lại được dữ liệu; không cần đăng ký lại. Bạn có thể tải lại hoặc đăng nhập khi cần.'
        : 'Đã đăng nhập nhưng chưa tải lại được dữ liệu. Vui lòng tải lại hoặc đăng nhập lại nếu phiên đã thay đổi.',
    }
  }
}

export const loginCustomer = (identifier: string, password: string) => customerAccountService.login(identifier, password)
export const registerCustomer = (input: CustomerRegistrationInput) => customerAccountService.register(input)
export const saveCustomerProfile = (userId: string, patch: CustomerProfilePatch, expectedUser?: User) => customerAccountService.saveProfile(userId, patch, expectedUser)
