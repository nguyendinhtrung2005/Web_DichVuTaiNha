"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRightIcon, LogOutIcon, MenuIcon, UserRoundIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/shared/logo"
import { areaHref, useAreaRoutes } from "@/components/shared/area-routes"
import type { User } from "@/lib/types"

const NAVIGATION = [
  { href: "/", route: "", label: "Trang chủ" },
  { href: "/dich-vu", route: "dich-vu", label: "Dịch vụ" },
  { href: "/san-pham", route: "san-pham", label: "Sản phẩm" },
  { href: "/don-cua-toi", route: "don-cua-toi", label: "Đơn của tôi" },
  { href: "/lich-su", route: "lich-su", label: "Lịch sử" },
  { href: "/ho-so", route: "ho-so", label: "Hồ sơ" },
]

export function SiteHeader({ route, user, onLogout }: { route: string; user: User | null; onLogout: () => void }) {
  const { unified } = useAreaRoutes()
  const internalUser = unified && user && user.role !== "customer" ? user : null
  const workspaceHref = internalUser ? areaHref(internalUser.role, "/", true) : "/dat-dich-vu"
  const workspaceLabel = internalUser?.role === "admin" ? "Quản trị" : "Công việc"
  const profileHref = internalUser ? areaHref(internalUser.role, "/ho-so", true) : "/ho-so"
  const navigation = internalUser ? [
    ...NAVIGATION.slice(0, 2),
    { href: workspaceHref, route: internalUser.role, label: workspaceLabel },
    { href: profileHref, route: `${internalUser.role}/ho-so`, label: "Hồ sơ" },
  ] : NAVIGATION
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()
  const headerRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMenuOpen(false) }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const desktop = window.matchMedia("(min-width: 1280px)")
    const onResize = () => { if (desktop.matches) setMenuOpen(false) }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    desktop.addEventListener("change", onResize)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
      desktop.removeEventListener("change", onResize)
    }
  }, [menuOpen])

  const navigationLinks = (mobile = false) => navigation.map((item) => (
    <Link key={item.href} href={item.href} aria-current={route === item.route ? "page" : undefined}
      onClick={() => setMenuOpen(false)}
      className={`${mobile ? "flex min-h-12 items-center px-4" : "inline-flex min-h-11 items-center px-3"} rounded-xl text-sm font-medium transition-colors motion-reduce:transition-none ${route === item.route ? "bg-blue-50 text-primary" : "text-muted-foreground hover:bg-slate-50 hover:text-foreground"}`}>
      {item.label}
    </Link>
  ))

  return (
    <header ref={headerRef} id="dau-trang" className="sticky top-0 z-40 border-b border-border bg-white">
      <a href="#noi-dung-chinh" className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-4">Chuyển đến nội dung chính</a>
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
        <Logo />
        <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 xl:flex">{navigationLinks()}</nav>
        <div className="flex items-center gap-2">
          {user ? <>
            <Button variant="ghost" size="icon" render={<Link href={profileHref} />} nativeButton={false} aria-label={`Hồ sơ của ${user.name}`}><UserRoundIcon aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon" className="hidden xl:inline-flex" onClick={onLogout} aria-label="Đăng xuất" title="Đăng xuất"><LogOutIcon aria-hidden="true" /></Button>
          </> : <Button variant="ghost" className="min-w-11" render={<Link href="/dang-nhap" />} nativeButton={false} aria-label="Đăng nhập"><UserRoundIcon aria-hidden="true" className="min-[360px]:hidden" /><span className="hidden min-[360px]:inline">Đăng nhập</span></Button>}
          <Button className="hidden sm:inline-flex" render={<Link href={workspaceHref} />} nativeButton={false}>{internalUser ? `Vào ${workspaceLabel.toLocaleLowerCase("vi-VN")}` : "Đặt dịch vụ"} <ArrowRightIcon aria-hidden="true" /></Button>
          <Button ref={toggleRef} variant="outline" size="icon" className="xl:hidden" aria-label={menuOpen ? "Đóng menu" : "Mở menu"} aria-expanded={menuOpen} aria-controls="customer-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <XIcon aria-hidden="true" /> : <MenuIcon aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <nav id="customer-mobile-navigation" aria-label="Điều hướng trên điện thoại" hidden={!menuOpen} className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-border bg-white px-4 pt-2 pb-5 shadow-lg xl:hidden">
        <div className="mx-auto flex max-w-6xl flex-col gap-1">
          {navigationLinks(true)}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-4">
            {user ? <Button variant="outline" onClick={() => { setMenuOpen(false); onLogout() }}><LogOutIcon aria-hidden="true" /> Đăng xuất</Button> : <Button variant="outline" render={<Link href="/dang-ky" />} nativeButton={false} onClick={() => setMenuOpen(false)}>Tạo tài khoản</Button>}
            <Button render={<Link href={workspaceHref} />} nativeButton={false} onClick={() => setMenuOpen(false)}>{internalUser ? workspaceLabel : "Đặt dịch vụ"}</Button>
          </div>
        </div>
      </nav>
    </header>
  )
}
