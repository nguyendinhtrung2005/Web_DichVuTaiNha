"use client"

import Link from "next/link"
import { LockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useAppState, useCurrentUser } from "@/lib/store"
import type { Role } from "@/lib/types"

const ROLE_LABEL: Record<Role, string> = { customer: "khách hàng", staff: "nhân viên", admin: "quản trị viên" }

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải dữ liệu">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const state = useAppState()
  const user = useCurrentUser()
  if (!state) return <PageSkeleton />
  if (!user || user.role !== role) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Cần đăng nhập tài khoản {ROLE_LABEL[role]}</EmptyTitle>
          <EmptyDescription>
            {user ? `Bạn đang đăng nhập với vai trò ${ROLE_LABEL[user.role]}. ` : ""}Vui lòng đăng nhập đúng vai trò để truy cập trang này.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button render={<Link href="/dang-nhap" />} nativeButton={false}>
            Đăng nhập
          </Button>
          
        </EmptyContent>
      </Empty>
    )
  }
  return <>{children}</>
}
