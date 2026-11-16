import type { Role } from "./types"

export type AppRole = Role

export const APP_ROLE = (process.env.NEXT_PUBLIC_APP_ROLE ?? "customer") as AppRole

/** Standalone apps retain their original storage and build role. */
export const APP_MODE = process.env.NEXT_PUBLIC_APP_MODE === "unified" ? "unified" : "legacy"
export const IS_UNIFIED_APP = APP_MODE === "unified"
export const UNIFIED_APP = IS_UNIFIED_APP

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"

export const SITE_URLS: Record<Role, string> = {
  customer: process.env.NEXT_PUBLIC_CUSTOMER_URL ?? "http://localhost:3001",
  staff: process.env.NEXT_PUBLIC_STAFF_URL ?? "http://localhost:3002",
  admin: process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3003",
}

export const SITE_HOST_LABEL: Record<Role, string> = {
  customer: "cleanhome.vn",
  staff: "cleanhome-staff.vn",
  admin: "cleanhome-admin.vn",
}

export const USE_MOCK_API = (process.env.NEXT_PUBLIC_USE_MOCK ?? "true") === "true"
