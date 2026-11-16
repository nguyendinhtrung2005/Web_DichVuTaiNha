"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  HouseIcon,
  ListChecksIcon,
  MinusIcon,
  UserRoundIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ServiceCard } from "@/components/customer/service-card"
import { CATEGORY_LABEL } from "@/lib/config"
import { formatCurrency } from "@/lib/format"
import type { Service } from "@/lib/types"

const PREPARATION = [
  {
    icon: UserRoundIcon,
    title: "Thông tin liên hệ",
    description: "Họ tên, số điện thoại và địa chỉ nơi thực hiện dịch vụ.",
  },
  {
    icon: HouseIcon,
    title: "Thông tin nhà ở",
    description: "Loại nhà, diện tích, số phòng, số tầng và thông tin về thú cưng nếu có.",
  },
  {
    icon: CalendarDaysIcon,
    title: "Lịch hẹn và ghi chú",
    description: "Ngày giờ bạn muốn đặt và những yêu cầu đặc biệt cần lưu ý.",
  },
]

function WorkList({
  title,
  items,
  excluded = false,
}: {
  title: string
  items: string[]
  excluded?: boolean
}) {
  const visibleItems = items.filter((item) => item.trim())
  if (!visibleItems.length) return null
  const Icon = excluded ? MinusIcon : CheckIcon

  return (
    <Card className="h-full min-w-0 overflow-visible rounded-2xl shadow-none ring-border [--card-spacing:--spacing(6)]">
      <CardHeader>
        <h2 className="m-0 text-lg leading-7 font-semibold">{title}</h2>
      </CardHeader>
      <CardContent>
        <ul className="m-0 grid list-none gap-4 p-0">
          {visibleItems.map((item, index) => (
            <li key={`${index}-${item}`} className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${excluded ? "bg-slate-100 text-muted-foreground" : "bg-blue-50 text-primary"}`}>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0 break-words text-sm leading-6 text-muted-foreground">{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function ServiceDetail({
  service,
  relatedServices,
}: {
  service: Service
  relatedServices: Service[]
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const image = service.image || "/placeholder.svg"
  const related = relatedServices
    .filter((item) => item.id !== service.id && item.category === service.category && item.status === "active")
    .slice(0, 3)
  const description = service.description.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const isActive = service.status === "active"
  const hasIncluded = service.included.some((item) => item.trim())
  const hasExcluded = service.excluded.some((item) => item.trim())

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 md:pt-8 md:pb-24">
      <nav aria-label="Đường dẫn trang" className="mb-8 text-sm text-muted-foreground md:mb-10">
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0">
          <li>
            <Link href="/" className="inline-flex min-h-11 items-center rounded-md hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Trang chủ</Link>
          </li>
          <li aria-hidden="true"><ChevronRightIcon className="size-3.5" /></li>
          <li>
            <Link href="/dich-vu" className="inline-flex min-h-11 items-center rounded-md hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Dịch vụ</Link>
          </li>
          <li aria-hidden="true"><ChevronRightIcon className="size-3.5" /></li>
          <li aria-current="page" className="min-w-0 break-words text-foreground">{service.name}</li>
        </ol>
      </nav>

      <header className="mb-8 max-w-3xl md:mb-10">
        <Badge variant="secondary" className="mb-4 border-blue-100 bg-blue-50 px-3 py-1.5 text-primary">
          {CATEGORY_LABEL[service.category]}
        </Badge>
        <h1 className="m-0 break-words text-3xl leading-tight font-bold tracking-tight md:text-4xl">{service.name}</h1>
        <p className="m-0 mt-4 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">{service.shortDesc}</p>
        <div className="mt-6 flex flex-col items-start gap-4 lg:hidden">
          <p className="m-0 text-sm text-muted-foreground">Giá tham khảo: <span className="font-semibold text-primary">{formatCurrency(service.price)}</span> / {service.unit}</p>
          {isActive ? <Button size="lg" className="w-full sm:w-auto" render={<Link href={`/dat-dich-vu/${service.id}`} />} nativeButton={false}>Đặt dịch vụ ngay<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button> : <p role="status" className="m-0 text-sm text-muted-foreground">Dịch vụ đang tạm ngừng cung cấp.</p>}
        </div>
      </header>

      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="min-w-0 space-y-8 md:space-y-10">
          <div className="relative aspect-[16/10] rounded-2xl bg-muted">
            <Image
              src={failedImage === image ? "/placeholder.svg" : image}
              alt={service.name}
              fill
              priority
              sizes="(min-width: 1152px) 744px, (min-width: 1024px) calc(100vw - 408px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
              className="rounded-2xl object-cover"
              onError={() => setFailedImage(image)}
            />
          </div>

          {description.length > 0 && (
            <section aria-labelledby="service-introduction-heading">
              <h2 id="service-introduction-heading" className="m-0 mb-4 text-xl leading-7 font-semibold md:text-2xl">Về dịch vụ này</h2>
              <div className="space-y-4">
                {description.map((paragraph, index) => (
                  <p key={`${index}-${paragraph}`} className="m-0 break-words text-base leading-8 text-muted-foreground">{paragraph}</p>
                ))}
              </div>
            </section>
          )}

          {service.scope.some((item) => item.trim()) && (
            <section aria-labelledby="service-scope-heading" className="rounded-2xl border border-blue-100 bg-blue-50/50 p-6 sm:p-7">
              <div className="mb-5 flex items-center gap-3">
                <ListChecksIcon aria-hidden="true" className="size-5 shrink-0 text-primary" />
                <h2 id="service-scope-heading" className="m-0 text-xl leading-7 font-semibold">Phạm vi công việc</h2>
              </div>
              <ul className="m-0 grid list-none gap-4 p-0">
                {service.scope.filter((item) => item.trim()).map((item, index) => (
                  <li key={`${index}-${item}`} className="flex min-w-0 items-start gap-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    <CheckIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(hasIncluded || hasExcluded) && (
            <div className={`grid min-w-0 gap-5 ${hasIncluded && hasExcluded ? "sm:grid-cols-2" : ""}`}>
              <WorkList title="Đã bao gồm" items={service.included} />
              <WorkList title="Chưa bao gồm" items={service.excluded} excluded />
            </div>
          )}
        </div>

        <aside aria-label="Giá và đặt dịch vụ" className="min-w-0 space-y-6 lg:sticky lg:top-28">
          <Card className="min-w-0 overflow-visible rounded-2xl bg-white shadow-lg shadow-slate-900/5 ring-blue-100 [--card-spacing:--spacing(6)]">
            <CardHeader className="gap-3">
              <h2 className="m-0 text-sm font-medium text-muted-foreground">Giá tham khảo</h2>
              <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-3xl font-bold tracking-tight text-primary tabular-nums">{formatCurrency(service.price)}</span>
                <span className="text-sm text-muted-foreground">/ {service.unit}</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="m-0 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-muted-foreground">
                Đặt tối thiểu <span className="font-semibold text-foreground">{service.minQuantity} {service.unit}</span>.
              </p>
              <p className="m-0 text-sm leading-6 text-muted-foreground">Tổng giá dự kiến được tính theo số lượng bạn chọn trong bước đặt lịch.</p>
              {isActive ? (
                <Button size="lg" className="w-full px-4" render={<Link href={`/dat-dich-vu/${service.id}`} />} nativeButton={false}>
                  Đặt dịch vụ ngay
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
              ) : (
                <div className="space-y-3">
                  <Button size="lg" className="w-full px-4" disabled>Đặt dịch vụ ngay</Button>
                  <p role="status" className="m-0 text-sm leading-6 text-muted-foreground">Dịch vụ đang tạm ngừng cung cấp.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <section aria-labelledby="service-preparation-heading" className="rounded-2xl border border-border p-6">
            <div className="mb-5 flex items-start gap-3">
              <ClipboardListIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <h2 id="service-preparation-heading" className="m-0 text-lg leading-6 font-semibold">Chuẩn bị trước khi đặt</h2>
            </div>
            <ul className="m-0 grid list-none gap-5 p-0">
              {PREPARATION.map(({ icon: Icon, title, description: text }) => (
                <li key={title} className="flex min-w-0 items-start gap-3">
                  <Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <h3 className="m-0 text-sm leading-6 font-medium">{title}</h3>
                    <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-services-heading" className="mt-16 border-t border-border pt-12 md:mt-20 md:pt-16">
          <div className="mb-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="related-services-heading" className="m-0 text-2xl leading-tight font-semibold md:text-3xl">Dịch vụ liên quan</h2>
              <p className="m-0 mt-3 text-sm leading-6 text-muted-foreground">Khám phá thêm trong nhóm {CATEGORY_LABEL[service.category].toLowerCase()}.</p>
            </div>
            <Button variant="outline" render={<Link href="/dich-vu" />} nativeButton={false}>
              Xem tất cả dịch vụ
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
          <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => <ServiceCard key={item.id} service={item} />)}
          </div>
        </section>
      )}

      <div className="mt-10">
        <Button variant="ghost" className="text-muted-foreground" render={<Link href="/dich-vu" />} nativeButton={false}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Trở về danh sách dịch vụ
        </Button>
      </div>
    </div>
  )
}
