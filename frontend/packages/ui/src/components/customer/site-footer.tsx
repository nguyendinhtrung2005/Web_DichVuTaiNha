"use client"

import Link from "next/link"
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react"
import { Logo } from "@/components/shared/logo"
import { areaHref, useAreaRoutes } from "@/components/shared/area-routes"
import { useData } from "../../common"

const LINK_GROUPS = [
  {
    title: "Dịch vụ",
    links: [
      { href: "/dich-vu", label: "Khám phá dịch vụ" },
      { href: "/san-pham", label: "Sản phẩm tự làm sạch" },
      { href: "/dat-dich-vu", label: "Đặt lịch dọn dẹp" },
      { href: "/#cach-dat-lich", label: "Cách đặt dịch vụ" },
    ],
  },
  {
    title: "Tài khoản",
    links: [
      { href: "/don-cua-toi", label: "Đơn của tôi" },
      { href: "/lich-su", label: "Lịch sử dịch vụ" },
      { href: "/ho-so", label: "Hồ sơ cá nhân" },
    ],
  },
  {
    title: "Tìm hiểu thêm",
    links: [
      { href: "/#cau-hoi-thuong-gap", label: "Câu hỏi thường gặp" },
      { href: "/dang-nhap", label: "Đăng nhập" },
      { href: "/dang-ky", label: "Tạo tài khoản" },
    ],
  },
]

export function SiteFooter() {
  const { user } = useData()
  const { unified } = useAreaRoutes()
  const internalUser = unified && user && user.role !== "customer" ? user : null
  const groups = internalUser ? LINK_GROUPS.map((group) => group.title === "Tài khoản" ? {
    ...group,
    links: [
      { href: areaHref(internalUser.role, "/", true), label: internalUser.role === "admin" ? "Khu vực quản trị" : "Khu vực nhân viên" },
      { href: areaHref(internalUser.role, "/ho-so", true), label: "Hồ sơ cá nhân" },
    ],
  } : group) : LINK_GROUPS
  return (
    <footer className="border-t border-border bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-5 lg:gap-8 lg:py-16">
        <div className="flex flex-col items-start gap-5 sm:col-span-2">
          <Logo />
          <p className="m-0 max-w-sm text-sm leading-7 text-muted-foreground">
            Vệ sinh nhà ở, phòng trọ, chăm sóc, bảo dưỡng và sản phẩm tự làm sạch.
          </p>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-primary"><SparklesIcon aria-hidden="true" className="size-4" />Chăm chút cho không gian sống</span>
        </div>
        {groups.map((g) => (
          <nav key={g.title} aria-label={`Footer — ${g.title}`}>
            <h2 className="m-0 mb-4 text-sm font-semibold text-foreground">{g.title}</h2>
            <ul className="flex flex-col gap-1">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary motion-reduce:transition-none">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="m-0">© {new Date().getFullYear()} CleanHome.</p>
          <Link href="#dau-trang" className="inline-flex min-h-11 w-fit items-center gap-1.5 font-medium transition-colors hover:text-primary motion-reduce:transition-none">Về đầu trang <ArrowUpRightIcon aria-hidden="true" className="size-3.5" /></Link>
        </div>
      </div>
    </footer>
  )
}
