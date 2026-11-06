"use client"

import { useStaffAuth } from "./staff-auth-session"
import { StaffNotificationsDemo } from "./staff-notifications-demo"
import { StaffNotificationsRemote } from "./staff-notifications-remote"
import { StaffNotificationsUnavailable } from "./staff-notifications-unavailable"

/**
 * Real notifications are the production default. The labelled demo is only
 * reachable with an explicit development flag and never replaces real data.
 */
export function StaffNotifications({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return null
  const accountId = auth.session.user.id
  if (!/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n) return <StaffNotificationsUnavailable />
  if (demoEnabled && process.env.NODE_ENV === "development") return <StaffNotificationsDemo enabled={demoEnabled} />
  return <StaffNotificationsRemote key={accountId} accountId={accountId} />
}
