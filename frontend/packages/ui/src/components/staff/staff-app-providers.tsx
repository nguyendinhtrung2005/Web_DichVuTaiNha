"use client"
import { type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { StaffAuthProvider, useStaffAuth } from "./staff-auth-session"
import { StaffDisplayPreferencesProvider } from "./staff-display-preferences"
import { StaffSupportWidgetProvider } from "./staff-support-widget"
import { validStaffPath } from "./staff-route-policy"

function StaffConversationBoundary({ children }: { children: ReactNode }) {
  const auth = useStaffAuth()!, pathname = usePathname()
  const path = (pathname || "/").split("/").filter(Boolean), scope = auth.session?.user.id || ""
  const active = auth.status === "authenticated" && !!auth.session && auth.busy !== "logout" && validStaffPath(path) && !["dang-nhap", "dang-ky"].includes(path[0])
  return <StaffSupportWidgetProvider key={scope || "anonymous"} accountScope={scope} active={active} checkSession={auth.checkSession}>{children}</StaffSupportWidgetProvider>
}
/** Mounted in the Staff root layout so navigation cannot remount the conversation. */
export function StaffAppProviders({ children }: { children: ReactNode }) {
  return <StaffAuthProvider><StaffDisplayPreferencesProvider><StaffConversationBoundary>{children}</StaffConversationBoundary></StaffDisplayPreferencesProvider></StaffAuthProvider>
}
