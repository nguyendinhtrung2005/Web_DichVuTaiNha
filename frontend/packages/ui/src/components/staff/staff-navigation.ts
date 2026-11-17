import { BellIcon, CalendarDaysIcon, ClipboardListIcon, LayoutDashboardIcon, UserRoundIcon, WalletCardsIcon, MapPinIcon, AwardIcon, SettingsIcon } from "lucide-react"

export const STAFF_NAVIGATION = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboardIcon, group: "Công việc" },
  { href: "/cong-viec", label: "Công việc", icon: ClipboardListIcon, group: "Công việc" },
  { href: "/lich-lam-viec", label: "Lịch", icon: CalendarDaysIcon, group: "Công việc" },
  { href: "/thong-bao", label: "Thông báo", icon: BellIcon, group: "Cá nhân" },
  { href: "/ho-so", label: "Cá nhân", icon: UserRoundIcon, group: "Cá nhân" },
] as const

/** Extra desktop/Sheet destinations; the five mobile bottom-nav slots stay unchanged. */
export const STAFF_SECONDARY_NAVIGATION = [
  { href: "/thu-nhap", label: "Thu nhập", icon: WalletCardsIcon, group: "Cá nhân" },
  { href: "/khu-vuc", label: "Khu vực & ca làm", icon: MapPinIcon, group: "Cá nhân" },
  { href: "/thanh-tich", label: "Thành tích & đánh giá", icon: AwardIcon, group: "Cá nhân" },
] as const

/** Separate from the five mobile bottom-nav slots; last in desktop and Sheet menus. */
export const STAFF_FOOTER_NAVIGATION = [
  { href: "/cai-dat", label: "Cài đặt", icon: SettingsIcon },
] as const

export function staffSidebarNavigationActive(href: string, route: string): boolean {
  return ["thu-nhap", "khu-vuc", "thanh-tich", "cai-dat"].includes(route) ? href === "/" + route : staffNavigationActive(href, route)
}

export function staffNavigationActive(href: string, route: string): boolean {
  return href === "/" ? route === "" : route === href.slice(1) || (href === "/cong-viec" && route === "don") || (href === "/ho-so" && ["lich-su", "ho-tro", "cai-dat", "thong-ke-cong-viec", "thu-nhap", "khu-vuc", "thanh-tich"].includes(route))
}
