"use client"

import { AreaLink as Link } from "@/components/shared/area-routes"
import { STAFF_NAVIGATION, staffNavigationActive } from "./staff-navigation"

export function StaffBottomNavigation({ route }: { route: string }) {
  return <nav aria-label="Điều hướng nhanh nhân viên" className="staff-bottom-nav">
    {STAFF_NAVIGATION.map(({ href, label, icon: Icon }) => {
      const active = staffNavigationActive(href, route)
      return <Link key={href} href={href} className="staff-bottom-link" aria-current={active ? "page" : undefined}>
        <span className="staff-bottom-icon"><Icon aria-hidden="true" className="size-5" /></span>
        <span className="staff-bottom-label">{label}</span>
      </Link>
    })}
  </nav>
}
