"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AreaLink as Link, useAreaRoutes } from "@/components/shared/area-routes"
import { usePathname } from "next/navigation"
import { ChevronDownIcon, LogOutIcon, MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SettingsIcon, SparklesIcon, UserRoundIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Logo } from "@/components/shared/logo"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { initials } from "@/lib/format"
import { STAFF_NAVIGATION, STAFF_SECONDARY_NAVIGATION, STAFF_FOOTER_NAVIGATION, staffNavigationActive, staffSidebarNavigationActive } from "./staff-navigation"
import { StaffBottomNavigation } from "./staff-bottom-nav"
import { useStaffDisplayPreferences } from "./staff-display-preferences"

type StaffLayoutIdentity = { id: string; name?: string; email?: string; avatar?: string }

function StaffNavigation({ route, collapsed = false, onNavigate }: { route: string; collapsed?: boolean; onNavigate?: () => void }) {
  return <nav aria-label="Điều hướng nhân viên" className="staff-navigation">
    {(["Công việc", "Cá nhân"] as const).map(group => <div key={group}>
      <p className={collapsed ? "sr-only" : "staff-nav-group"}>{group}</p>
      <div className="flex flex-col gap-1.5">{[...STAFF_NAVIGATION, ...STAFF_SECONDARY_NAVIGATION].filter(item => item.group === group).map(({ href, label, icon: Icon }) => {
        const active = staffSidebarNavigationActive(href, route)
        return <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={"staff-nav-link" + (collapsed ? " staff-nav-link-collapsed" : "")}>
          <Icon aria-hidden="true" className="size-5 shrink-0" />{!collapsed && <span>{label}</span>}
        </Link>
      })}</div>
    </div>)}
    <div className="staff-navigation-footer">{STAFF_FOOTER_NAVIGATION.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onNavigate} data-staff-settings-link aria-current={staffSidebarNavigationActive(href, route) ? "page" : undefined} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={"staff-nav-link" + (collapsed ? " staff-nav-link-collapsed" : "")}><Icon aria-hidden="true" className="size-5 shrink-0" />{!collapsed && <span>{label}</span>}</Link>)}</div>
  </nav>
}

export function StaffLayout({ route, user, onLogout, logoutBusy = false, children }: { route: string; user: StaffLayoutIdentity | null; onLogout: () => void; logoutBusy?: boolean; children: ReactNode }) {
  const { homeHref } = useAreaRoutes()
  const display = useStaffDisplayPreferences()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileTrigger = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const auth = route === "dang-nhap" || route === "dang-ky"
  const userName = typeof user?.name === "string" ? user.name : "Nhân viên"
  const userEmail = typeof user?.email === "string" ? user.email : ""
  const userAvatar = typeof user?.avatar === "string" ? user.avatar : undefined
  const currentLabel = route === "cai-dat" ? "Cài đặt" : route === "khu-vuc" ? "Khu vực & ca làm" : route === "thanh-tich" ? "Thành tích & đánh giá" : route === "thu-nhap" ? "Thu nhập" : route === "don" ? "Chi tiết công việc" : STAFF_NAVIGATION.find(item => staffNavigationActive(item.href, route))?.label || "Không gian nhân viên"
  useEffect(() => { setMobileOpen(false) }, [pathname])
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)")
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false) }
    desktop.addEventListener("change", closeOnDesktop)
    return () => desktop.removeEventListener("change", closeOnDesktop)
  }, [])

  return <div data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} className={"staff-app min-h-screen bg-slate-50/60 text-foreground" + (collapsed ? " staff-collapsed" : "") + (auth ? " staff-auth-layout" : "")}>
    <a href="#staff-main" className="fixed top-2 left-2 z-[70] -translate-y-24 rounded-xl bg-primary px-4 py-3 text-sm text-white focus:translate-y-0">Đến nội dung chính</a>
    {!auth && <aside className="staff-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col overflow-y-auto border-r border-border bg-white p-4 lg:flex">
      <div className={"mb-8 flex min-h-16 items-center" + (collapsed ? " justify-center" : " px-2")}>{collapsed ? <Link href="/" aria-label="CleanHome - Tổng quan" className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50"><SparklesIcon aria-hidden="true" className="size-5" /></Link> : <Logo href={homeHref} />}</div>
      <StaffNavigation route={route} collapsed={collapsed} />
      <div className="shrink-0 pt-3">
        <div className="border-t border-border pt-3"><Button variant="ghost" onClick={() => setCollapsed(value => !value)} className={"min-h-11 w-full " + (collapsed ? "justify-center" : "justify-start")} aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <><PanelLeftCloseIcon aria-hidden="true" /><span>Thu gọn</span></>}</Button></div>
      </div>
    </aside>}

    <div className="staff-workspace flex min-h-screen min-w-0 flex-col">
      <header className="staff-header sticky top-0 z-30 flex min-h-16 min-w-0 items-center justify-between gap-3 border-b border-border bg-white/95 px-4 backdrop-blur-sm sm:min-h-20 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {!auth && <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger render={<Button variant="outline" size="icon" ref={mobileTrigger} className="size-11 lg:hidden" aria-label="Mở menu nhân viên" />}><MenuIcon aria-hidden="true" className="size-5" /></SheetTrigger><SheetContent data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} side="left" finalFocus={mobileTrigger} showCloseButton={false} className="staff-preference-surface staff-mobile-sheet w-[min(19rem,calc(100vw-2rem))] gap-6 overflow-y-auto p-5"><SheetHeader className="p-0"><SheetTitle className="flex items-center justify-between gap-3"><Logo href={homeHref} /><SheetClose render={<Button variant="ghost" size="icon" className="size-11" aria-label="Đóng menu nhân viên" />}><XIcon aria-hidden="true" className="size-5" /></SheetClose></SheetTitle><SheetDescription className="mt-3">Không gian làm việc của nhân viên</SheetDescription></SheetHeader><StaffNavigation route={route} onNavigate={() => setMobileOpen(false)} />{user && <Button variant="outline" className="mt-auto min-h-11" disabled={logoutBusy} onClick={() => { setMobileOpen(false); onLogout() }}><LogOutIcon aria-hidden="true" />{logoutBusy ? "Đang đăng xuất..." : "Đăng xuất"}</Button>}</SheetContent></Sheet>}
          {auth ? <Logo href={homeHref} /> : <><div className="lg:hidden"><Logo href={homeHref} /></div><div className="staff-header-location hidden min-w-0 lg:block"><p className="m-0 text-[11px] font-medium text-muted-foreground">CleanHome / Nhân viên</p><p className="m-0 mt-1 text-sm font-semibold">{currentLabel}</p></div></>}
        </div>
        {user ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" className="staff-account-trigger max-w-[11rem] gap-2 px-1.5 sm:max-w-xs sm:px-2" aria-label={"Tài khoản của " + userName} />}><Avatar className="size-8"><AvatarImage src={userAvatar} alt="" /><AvatarFallback className="bg-blue-50 text-xs text-primary">{initials(userName)}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-sm sm:inline">{userName}</span><ChevronDownIcon aria-hidden="true" className="size-4" /></DropdownMenuTrigger><DropdownMenuContent data-staff-motion={display?.preferences.motion || "system"} data-staff-focus={display?.preferences.focus || "standard"} align="end" className="staff-preference-surface w-64 max-w-[calc(100vw-2rem)]"><DropdownMenuGroup><DropdownMenuLabel className="min-w-0 px-3 py-3"><span className="block break-words font-semibold text-foreground">{userName}</span>{userEmail && <span className="mt-1 block break-all text-xs font-normal">{userEmail}</span>}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 gap-2 px-3" render={<Link href="/ho-so" />}><UserRoundIcon aria-hidden="true" />Hồ sơ cá nhân</DropdownMenuItem><DropdownMenuItem className="min-h-11 gap-2 px-3" disabled={logoutBusy} onClick={onLogout}><LogOutIcon aria-hidden="true" />{logoutBusy ? "Đang đăng xuất..." : "Đăng xuất"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu> : <span className="staff-header-label shrink-0 rounded-full bg-blue-50 px-3 py-2 text-xs font-medium text-primary">Nhân viên</span>}
      </header>
      <main id="staff-main" tabIndex={-1} className={"mx-auto w-full min-w-0 flex-1 outline-none " + (auth ? "max-w-5xl px-4 py-8 sm:px-6 sm:py-12" : "max-w-[90rem] px-4 py-7 sm:px-6 sm:py-8 lg:px-8")}>{children}</main>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8"><span>CleanHome · Không gian nhân viên</span><span>Sắp xếp công việc, chăm sóc từng ngôi nhà.</span></footer>
    </div>
    {!auth && <StaffBottomNavigation route={route} />}
  </div>
}
