"use client"

import { apiRequest } from '@/lib/api-client'
import { customerRequestError, finishCustomerMutation, normalizeCustomerUser } from '@/lib/customer-api-store'
import type { User } from '@/lib/types'
import type { Persistence } from './booking-service'

export type CustomerRegistrationInput = { name: string; phone: string; email?: string; password: string }
export type CustomerProfilePatch = Pick<User, 'name' | 'phone'> & { email?: string }
export type AccountResult = { ok: true; user: User; persistence: Persistence } | { ok: false; error: string }
export type ProfileResult = { ok: true; persistence: Persistence } | { ok: false; error: string }
export interface CustomerAccountService {
  login(identifier: string, password: string): Promise<AccountResult>
  register(input: CustomerRegistrationInput): Promise<AccountResult>
  saveProfile(userId: string, patch: CustomerProfilePatch, expectedUser?: User): Promise<ProfileResult>
}

export const customerAccountService: CustomerAccountService = {
  async login(identifier, password) {
    try {
      const user = normalizeCustomerUser(await apiRequest<User>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), password }) }))
      await finishCustomerMutation()
      return { ok: true, user, persistence: 'server' }
    } catch (error) { return { ok: false, error: customerRequestError(error) } }
  },
  async register(input) {
    try {
      const body = { name: input.name.trim(), phone: input.phone.trim(), password: input.password, ...(input.email?.trim() ? { email: input.email.trim() } : {}) }
      const user = normalizeCustomerUser(await apiRequest<User>('/auth/register', { method: 'POST', body: JSON.stringify(body) }))
      await finishCustomerMutation()
      return { ok: true, user, persistence: 'server' }
    } catch (error) { return { ok: false, error: customerRequestError(error) } }
  },
  async saveProfile(_userId, patch) {
    try {
      await apiRequest<User>('/users/me', { method: 'PATCH', body: JSON.stringify({ name: patch.name.trim(), phone: patch.phone.trim(), ...(patch.email === undefined ? {} : { email: patch.email.trim() }) }) })
      await finishCustomerMutation()
      return { ok: true, persistence: 'server' }
    } catch (error) { return { ok: false, error: customerRequestError(error) } }
  },
}

export const loginCustomer = (identifier: string, password: string) => customerAccountService.login(identifier, password)
export const registerCustomer = (input: CustomerRegistrationInput) => customerAccountService.register(input)
export const saveCustomerProfile = (userId: string, patch: CustomerProfilePatch, expectedUser?: User) => customerAccountService.saveProfile(userId, patch, expectedUser)
