"use client"

import { ArrowLeftIcon } from "lucide-react"
import { AreaLink as Link } from "@/components/shared/area-routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { StaffEmpty, StaffLoading, StaffPageHeader } from "./staff-shared"
import { StaffIncomeRemote } from "./staff-income-remote"

/**
 * Real assignments + the illustrative 60.000đ/DONE estimate are only shown in
 * an explicitly configured development/demo run. Production keeps an honest
 * unavailable card instead of presenting assumed money as official income.
 */
export function StaffIncome({ demoEnabled }: { demoEnabled: boolean }) {
  const auth = useStaffAuth()
  if (!auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout") return <StaffLoading />
  const accountId = auth.session.user.id
  const enabled = demoEnabled && process.env.NODE_ENV === "development"
  if (!enabled || !/^[1-9]\d{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n) {
    return <div className="staff-income" data-staff-income="unavailable">
      <StaffPageHeader title="Thu nhập" description="Theo dõi tiền công dự kiến và tình trạng chi trả." action={<Button variant="outline" render={<Link href="/ho-so" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Về cá nhân</Button>} />
      <Card><CardContent>
        <StaffEmpty title="Thu nhập chưa khả dụng" description="Chính sách tiền công và quy trình chi trả chính thức chưa được cung cấp." />
        <p className="staff-income-scope-note" role="note">Không dùng giá đơn dịch vụ để ước tính lương.</p>
      </CardContent></Card>
    </div>
  }
  return <StaffIncomeRemote key={accountId} accountId={accountId} checkSession={auth.checkSession} />
}
