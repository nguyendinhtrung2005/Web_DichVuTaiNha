"use client"

import { useEffect, useState, type ReactNode } from "react"
import { AreaLink as Link, useAreaRoutes } from "@/components/shared/area-routes"
import { usePathname } from "next/navigation"
import { CalendarDaysIcon, ChevronDownIcon, ClipboardListIcon, LayoutDashboardIcon, LogOutIcon, MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SparklesIcon, UserRoundIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Logo } from "@/components/shared/logo"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { initials } from "@/lib/format"

type StaffLayoutIdentity = { id: string; name?: string; email?: string; avatar?: string }

const navigation = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboardIcon },
  { href: "/cong-viec", label: "Công việc", icon: ClipboardListIcon },
  { href: "/lich-lam-viec", label: "Lịch làm việc", icon: CalendarDaysIcon },
  { href: "/ho-so", label: "Hồ sơ", icon: UserRoundIcon },
]

function StaffNavigation({ route, collapsed = false, onNavigate }: { route: string; collapsed?: boolean; onNavigate?: () => void }) {
  return <nav aria-label="Điều hướng nhân viên" className="flex flex-col gap-2">{navigation.map(({ href, label, icon: Icon }) => {
    const active = href === "/" ? route === "" : route === href.slice(1) || (href === "/cong-viec" && route === "don")
    return <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${collapsed ? "justify-center" : ""} ${active ? "bg-blue-50 font-semibold text-primary" : "text-muted-foreground hover:bg-slate-50 hover:text-foreground"}`}><Icon aria-hidden="true" className="size-5 shrink-0" />{!collapsed && label}</Link>
  })}</nav>
}

export function StaffLayout({ route, user, onLogout, logoutBusy = false, children }: { route: string; user: StaffLayoutIdentity | null; onLogout: () => void; logoutBusy?: boolean; children: ReactNode }) {
  const { homeHref } = useAreaRoutes()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const auth = route === "dang-nhap" || route === "dang-ky"
  const userName = typeof user?.name === "string" ? user.name : "Nhân viên"
  const userEmail = typeof user?.email === "string" ? user.email : ""
  const userAvatar = typeof user?.avatar === "string" ? user.avatar : undefined
  useEffect(() => { setMobileOpen(false) }, [pathname])
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)")
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false) }
    desktop.addEventListener("change", closeOnDesktop)
    return () => desktop.removeEventListener("change", closeOnDesktop)
  }, [])

  return <div className={`staff-app min-h-screen bg-slate-50/60 text-foreground ${collapsed ? "staff-collapsed" : ""} ${auth ? "staff-auth-layout" : ""}`}>
    <a href="#staff-main" className="fixed top-2 left-2 z-[70] -translate-y-24 rounded-xl bg-primary px-4 py-3 text-sm text-white focus:translate-y-0">Đến nội dung chính</a>
    {!auth && <aside className="staff-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-white p-4 lg:flex">
      <div className="mb-8 flex min-h-12 items-center justify-between gap-1 px-1">{collapsed ? <Link href="/" aria-label="CleanHome - Tổng quan" className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50"><SparklesIcon aria-hidden="true" className="size-5" /></Link> : <Logo href={homeHref} />}</div>
      {!collapsed && <p className="m-0 mb-4 px-3 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Không gian nhân viên</p>}
      <StaffNavigation route={route} collapsed={collapsed} />
      <div className="mt-auto border-t border-border pt-4"><Button variant="ghost" onClick={() => setCollapsed((value) => !value)} className={`w-full ${collapsed ? "justify-center" : "justify-start"}`} aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <><PanelLeftCloseIcon aria-hidden="true" /><span>Thu gọn</span></>}</Button></div>
    </aside>}

    <div className="staff-workspace flex min-h-screen min-w-0 flex-col">
      <header className="sticky top-0 z-30 flex min-h-20 min-w-0 items-center justify-between gap-3 border-b border-border bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {!auth && <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger render={<Button variant="outline" size="icon" className="size-11 lg:hidden" aria-label="Mở menu nhân viên" />}><MenuIcon aria-hidden="true" className="size-5" /></SheetTrigger><SheetContent side="left" showCloseButton={false} className="w-[min(19rem,calc(100vw-2rem))] gap-6 p-5"><SheetHeader className="p-0"><SheetTitle className="flex items-center justify-between gap-3"><Logo href={homeHref} /><SheetClose render={<Button variant="ghost" size="icon" className="size-11" aria-label="Đóng menu nhân viên" />}><XIcon aria-hidden="true" className="size-5" /></SheetClose></SheetTitle><SheetDescription className="mt-3">Không gian làm việc của nhân viên</SheetDescription></SheetHeader><StaffNavigation route={route} onNavigate={() => setMobileOpen(false)} />{user && <Button variant="outline" className="mt-auto min-h-11" disabled={logoutBusy} onClick={() => { setMobileOpen(false); onLogout() }}><LogOutIcon aria-hidden="true" />{logoutBusy ? "Đang đăng xuất..." : "Đăng xuất"}</Button>}</SheetContent></Sheet>}
          {auth ? <Logo href={homeHref} /> : <div className="min-w-0"><p className="m-0 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">CleanHome</p><p className="m-0 mt-1 text-sm font-semibold">Khu vực Nhân viên</p></div>}
        </div>
        {user ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" className="max-w-[11rem] gap-2 px-1.5 sm:max-w-xs sm:px-2" aria-label={`Tài khoản của ${userName}`} />}><Avatar className="size-8"><AvatarImage src={userAvatar} alt="" /><AvatarFallback className="bg-blue-50 text-xs text-primary">{initials(userName)}</AvatarFallback></Avatar><span className="hidden max-w-40 truncate text-sm sm:inline">{userName}</span><ChevronDownIcon aria-hidden="true" className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]"><DropdownMenuGroup><DropdownMenuLabel className="min-w-0 px-3 py-3"><span className="block break-words font-semibold text-foreground">{userName}</span>{userEmail && <span className="mt-1 block break-all text-xs font-normal">{userEmail}</span>}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 gap-2 px-3" render={<Link href="/ho-so" />}><UserRoundIcon aria-hidden="true" />Hồ sơ cá nhân</DropdownMenuItem><DropdownMenuItem className="min-h-11 gap-2 px-3" disabled={logoutBusy} onClick={onLogout}><LogOutIcon aria-hidden="true" />{logoutBusy ? "Đang đăng xuất..." : "Đăng xuất"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu> : <span className="shrink-0 rounded-full bg-blue-50 px-3 py-2 text-xs font-medium text-primary">Nhân viên</span>}
      </header>
      <main id="staff-main" tabIndex={-1} className={`mx-auto w-full min-w-0 flex-1 outline-none ${auth ? "max-w-5xl px-4 py-8 sm:px-6 sm:py-12" : "max-w-[90rem] px-4 py-7 sm:px-6 sm:py-8 lg:px-8"}`}>{children}</main>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8"><span>CleanHome · Không gian nhân viên</span><span>Sắp xếp công việc, chăm sóc từng ngôi nhà.</span></footer>
    </div>
  </div>
}
