"use client"

import { Component, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeftIcon, RefreshCwIcon, SearchXIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ServiceCatalog } from "@/components/customer/service-catalog"
import { ServiceDetail } from "@/components/customer/service-detail"
import { PageSkeleton } from "@/components/shared/role-guard"
import { useData } from "../../common"

function ServiceMessage({ error = false }: { error?: boolean }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24" aria-labelledby="service-message-heading">
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-slate-50 px-5 py-12 text-center sm:px-8" role={error ? "alert" : undefined}>
        <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-primary"><SearchXIcon aria-hidden="true" className="size-6" /></span>
        <h1 id="service-message-heading" className="m-0 text-2xl leading-tight font-bold sm:text-3xl">{error ? "Chưa thể tải thông tin dịch vụ" : "Không tìm thấy dịch vụ"}</h1>
        <p className="m-0 mt-4 max-w-md text-sm leading-7 text-muted-foreground">{error ? "Vui lòng tải lại trang để thử lại." : "Dịch vụ bạn đang tìm không có trong danh sách hiện tại. Hãy khám phá các dịch vụ khác của CleanHome."}</p>
        <div className="mt-7 flex w-full max-w-md flex-col gap-3 sm:w-auto sm:flex-row">
          {error && <Button onClick={() => window.location.reload()}><RefreshCwIcon aria-hidden="true" />Tải lại trang</Button>}
          <Button variant={error ? "outline" : "default"} render={<Link href="/dich-vu" />} nativeButton={false}><ArrowLeftIcon aria-hidden="true" />Xem danh sách dịch vụ</Button>
        </div>
      </div>
    </section>
  )
}

class ServiceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <ServiceMessage error /> : this.props.children }
}

function ServiceContent({ slug }: { slug?: string }) {
  const { s } = useData()
  if (!s) return <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6" role="status"><PageSkeleton /></div>
  if (!Array.isArray(s.services)) return <ServiceMessage error />
  if (!slug) return <ServiceCatalog services={s.services} />
  const service = s.services.find((item) => item.slug === slug)
  return service ? <ServiceDetail service={service} relatedServices={s.services} /> : <ServiceMessage />
}

export function Services({ slug }: { slug?: string }) {
  return <ServiceErrorBoundary key={slug || "catalog"}><ServiceContent slug={slug} /></ServiceErrorBoundary>
}
