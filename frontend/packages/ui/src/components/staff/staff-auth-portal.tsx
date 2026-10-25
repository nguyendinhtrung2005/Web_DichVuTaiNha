"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ClipboardListIcon, ShieldCheckIcon } from "lucide-react"
import { AreaLink as Link, AreaRoutesProvider } from "@/components/shared/area-routes"
import { validAreaPath } from "@/components/shared/route-policy"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StaffAuthProvider, useStaffAuth } from "./staff-auth-session"
import { StaffLayout } from "./staff-layout"
import { StaffJobsRemote } from "./staff-jobs-remote"
import { StaffJobDetailRemote } from "./staff-job-detail-remote"
import { StaffScheduleRemote } from "./staff-schedule-remote"
import { StaffLogin } from "./staff-login"
import { staffLoginReturnTo } from "./staff-login-route"
import { StaffEmpty, StaffPageHeader } from "./staff-shared"

/** Staff-only entry: the local business store is deliberately not mounted under a Backend identity. */
export function StaffAuthPortal({ path }: { path: string[] }) {
  return <AreaRoutesProvider role="staff" unified={false}><StaffAuthProvider><StaffAuthScreen path={path} /></StaffAuthProvider></AreaRoutesProvider>
}

function SessionLoading() {
  return <div role="status" aria-label="Đang kiểm tra phiên đăng nhập" className="mx-auto max-w-lg space-y-5"><span className="sr-only">Đang kiểm tra phiên đăng nhập</span><Skeleton className="h-10 w-56" /><Skeleton className="h-64 w-full rounded-3xl" /></div>
}

function StaffAuthScreen({ path }: { path: string[] }) {
  const auth = useStaffAuth()!
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const route = path[0] || ""
  const authPage = route === "dang-nhap" || route === "dang-ky"
  const validRoute = validAreaPath("staff", path)
  const [logoutError, setLogoutError] = useState("")
  const logoutAlert = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!validRoute) return
    if (auth.status === "unauthenticated" && !authPage) {
      const target = staffLoginReturnTo(window.location.pathname + window.location.search + window.location.hash)
      router.replace("/dang-nhap" + (target === "/" ? "" : "?next=" + encodeURIComponent(target)))
    } else if (auth.status === "authenticated" && authPage) {
      router.replace(staffLoginReturnTo(params.get("next") || ""))
    }
  }, [auth.status, authPage, params, pathname, router, validRoute])

  useEffect(() => { if (logoutError) logoutAlert.current?.focus() }, [logoutError])

  async function logout() {
    setLogoutError("")
    const result = await auth.logout()
    if (result.ok) router.replace("/dang-nhap")
    else setLogoutError(result.message)
  }

  const authenticated = auth.status === "authenticated" && auth.session !== null
  let content
  if (!validRoute) content = <StaffEmpty title="Trang không tồn tại" action={<Button render={<Link href="/" />} nativeButton={false}>Về trang chính</Button>} />
  else if (auth.status === "loading") content = <SessionLoading />
  else if (auth.status === "unavailable") content = <section role="alert" className="mx-auto max-w-lg rounded-3xl border border-border bg-white px-6 py-8"><h1 className="m-0 text-xl font-semibold">Chưa thể kiểm tra phiên đăng nhập</h1><p className="mt-4 text-sm leading-7 text-muted-foreground">{auth.error}</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={() => void auth.checkSession()}>Thử lại</Button><Button variant="outline" disabled={auth.busy === "logout"} onClick={() => void logout()}>{auth.busy === "logout" ? "Đang đăng xuất..." : "Đăng xuất"}</Button></div></section>
  else if (auth.status === "unauthenticated" && route === "dang-nhap") content = <StaffLogin />
  else if (auth.status === "unauthenticated" && route === "dang-ky") content = <StaffEmpty title="Tài khoản nhân viên được người quản lý cấp" description="Liên hệ người quản lý để được cấp tài khoản làm việc." action={<Button render={<Link href="/dang-nhap" />} nativeButton={false}>Đăng nhập</Button>} />
  else if (!authenticated || authPage) content = <SessionLoading />
  else if (!route) content = <><StaffPageHeader title="Không gian làm việc" description="Bạn đã đăng nhập bằng tài khoản nhân viên CleanHome." /><Card className="max-w-2xl rounded-2xl shadow-none ring-border"><CardContent className="flex min-w-0 items-start gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary"><ShieldCheckIcon aria-hidden="true" className="size-6" /></div><div className="min-w-0"><h2 className="m-0 text-lg font-semibold">Sẵn sàng cho công việc của bạn</h2><p className="mt-3 mb-0 break-all text-sm leading-7 text-muted-foreground">Mã tài khoản: {auth.session!.user.id}</p><p className="mt-2 mb-5 text-sm leading-7 text-muted-foreground">Xem các công việc được phân công và lịch thực hiện trong danh sách công việc.</p><Button className="min-h-11 max-w-full whitespace-normal" render={<Link href="/cong-viec" />} nativeButton={false}>Xem công việc được phân công</Button></div></CardContent></Card></>
  else if (route === "cong-viec") content = <StaffJobsRemote />
  else if (route === "lich-lam-viec") content = <StaffScheduleRemote />
  else if (route === "don") content = <StaffJobDetailRemote id={path[1] || ""} />
  else {
    const titles: Record<string, string> = { "cong-viec": "Công việc", "don": "Chi tiết công việc", "lich-lam-viec": "Lịch làm việc", "ho-so": "Hồ sơ cá nhân" }
    content = <><StaffPageHeader title={titles[route] || "Không gian làm việc"} /><section className="rounded-2xl border border-border bg-white px-5 py-10"><ClipboardListIcon aria-hidden="true" className="mb-4 size-7 text-primary" /><h2 className="m-0 text-lg font-semibold">Thông tin hiện chưa khả dụng</h2><p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">Vui lòng quay lại sau hoặc liên hệ người quản lý nếu cần hỗ trợ.</p><Button variant="outline" render={<Link href="/" />} nativeButton={false}>Về tổng quan</Button></section></>
  }

  return <StaffLayout route={authPage ? route : authenticated ? route : "dang-nhap"} user={authenticated ? auth.session!.user : null} onLogout={() => void logout()} logoutBusy={auth.busy === "logout"}>{logoutError && <div ref={logoutAlert} tabIndex={-1} role="alert" className="mx-auto mb-6 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-destructive">{logoutError}</div>}{content}</StaffLayout>
}
