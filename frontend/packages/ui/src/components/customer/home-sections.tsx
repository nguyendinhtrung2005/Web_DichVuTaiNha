"use client"

import Image from "next/image"
import Link from "next/link"
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  Clock3Icon,
  HouseIcon,
  ListChecksIcon,
  PlusIcon,
  ReceiptTextIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ServiceCard } from "@/components/customer/service-card"
import { useAppState } from "@/lib/store"

const FEATURED_SLUGS = [
  "don-nha-theo-gio",
  "tong-ve-sinh",
  "ve-sinh-sofa",
  "ve-sinh-may-lanh",
  "ve-sinh-sau-xay-dung",
  "ve-sinh-nem",
]

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-b from-blue-50 via-blue-50/50 to-white" aria-labelledby="home-heading">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 md:gap-12 md:py-20 lg:gap-16">
        <div className="flex min-w-0 flex-col items-start gap-6 md:gap-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3.5 py-2 text-xs font-semibold tracking-wide text-primary">
            <SparklesIcon aria-hidden="true" className="size-4" />
            Chăm sóc không gian sống cùng CleanHome
          </span>
          <h1 id="home-heading" className="m-0 text-[2.375rem] leading-[1.14] font-bold tracking-tight text-foreground sm:text-5xl md:text-[2.5rem] lg:text-[3.6rem]">
            Nhà sạch hơn.
            <br />
            <span className="text-primary">Thảnh thơi hơn.</span>
          </h1>
          <p className="m-0 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg lg:leading-8">
            Dọn dẹp hằng ngày, làm sạch chuyên sâu hay chăm sóc nội thất. Chọn dịch vụ phù hợp để dành thêm thời gian cho những điều bạn yêu thích.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
            <Button size="lg" className="px-6" render={<Link href="/dat-dich-vu" />} nativeButton={false}>
              Đặt dịch vụ ngay
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
            <Button size="lg" variant="outline" className="bg-white px-6" render={<Link href="/dich-vu" />} nativeButton={false}>
              Khám phá dịch vụ
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-3 pt-1 text-xs text-muted-foreground sm:text-sm">
            {[
              { icon: CalendarDaysIcon, label: "Chọn lịch phù hợp" },
              { icon: ReceiptTextIcon, label: "Xem giá dự kiến" },
              { icon: ClipboardListIcon, label: "Theo dõi đơn" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 text-primary" />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative min-w-0">
          <div aria-hidden="true" className="absolute -top-4 -right-4 size-32 rounded-[2rem] border border-blue-100 bg-white/80 sm:-top-5 sm:-right-5 sm:size-44" />
          <div className="relative aspect-[6/5] overflow-hidden rounded-[1.5rem] shadow-xl shadow-blue-950/10 md:aspect-[1/1.1] md:rounded-[2rem]">
            <Image
              src="/images/hero.png"
              alt="Nhân viên đang lau sàn trong phòng khách sáng sủa"
              fill
              priority
              sizes="(min-width: 1280px) 520px, (min-width: 768px) 46vw, calc(100vw - 32px)"
              className="object-cover object-[60%_center]"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-slate-950/20 via-transparent to-transparent" />
            <div className="absolute right-4 bottom-4 left-4 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-sm sm:right-5 sm:bottom-5 sm:left-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
                <HouseIcon aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="m-0 text-sm font-semibold text-foreground sm:text-base">Nhẹ việc nhà, thêm thời gian cho bạn</p>
                <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">Bắt đầu từ một dịch vụ phù hợp.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function FeaturedServices() {
  const state = useAppState()
  const services = state?.services.filter((service) => FEATURED_SLUGS.includes(service.slug) && service.status === "active")

  return (
    <section id="dich-vu-noi-bat" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-16 sm:px-6 md:py-24" aria-labelledby="featured-heading">
      <div className="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between md:mb-10">
        <div className="max-w-xl">
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Dịch vụ CleanHome</p>
          <h2 id="featured-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance lg:text-4xl">Dịch vụ cho từng nhu cầu</h2>
          <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Từ việc nhà thường ngày đến những góc cần làm sạch kỹ hơn, tìm lựa chọn phù hợp với không gian của bạn.</p>
        </div>
        <Button variant="outline" className="shrink-0" render={<Link href="/dich-vu" />} nativeButton={false}>
          Xem tất cả dịch vụ
          <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
      {!services ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Đang tải danh sách dịch vụ.</span>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {FEATURED_SLUGS.map((slug) => (
              <div key={slug} className="overflow-hidden rounded-2xl border border-border">
                <Skeleton className="aspect-[3/2] rounded-none" />
                <div className="flex flex-col gap-4 p-5">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-8 w-1/2" />
                  <Skeleton className="h-11 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : services.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => <ServiceCard key={service.id} service={service} />)}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/50 px-6 py-12 text-center">
          <SparklesIcon aria-hidden="true" className="size-8 text-primary" />
          <p className="m-0 text-muted-foreground">Chưa có dịch vụ phù hợp để hiển thị.</p>
          <Button variant="outline" render={<Link href="/dich-vu" />} nativeButton={false}>Xem danh sách dịch vụ</Button>
        </div>
      )}
    </section>
  )
}

const STEPS = [
  { icon: ListChecksIcon, title: "Chọn dịch vụ", desc: "Xem phạm vi công việc và chọn số giờ, diện tích hoặc số lượng phù hợp." },
  { icon: HouseIcon, title: "Thông tin nhà ở", desc: "Điền địa chỉ, thông tin liên hệ và đặc điểm không gian cần làm sạch." },
  { icon: CalendarDaysIcon, title: "Chọn ngày và giờ", desc: "Chọn thời gian bạn mong muốn, thêm ghi chú cho các yêu cầu riêng." },
  { icon: ClipboardListIcon, title: "Kiểm tra và đặt lịch", desc: "Xem lại thông tin và giá dự kiến trước khi xác nhận yêu cầu đặt dịch vụ." },
]

export function ProcessSection() {
  return (
    <section id="cach-dat-lich" className="scroll-mt-28 border-y border-blue-100/70 bg-blue-50/60" aria-labelledby="process-heading">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto mb-9 max-w-2xl text-center md:mb-12">
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Cách đặt lịch</p>
          <h2 id="process-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance lg:text-4xl">Gọn gàng từ bước đầu tiên</h2>
          <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Bốn bước để chuẩn bị một yêu cầu đầy đủ, theo đúng nhu cầu của bạn.</p>
        </div>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full rounded-2xl shadow-none ring-blue-100 [--card-spacing:--spacing(5)]">
                <CardHeader className="gap-5">
                  <div className="flex items-center justify-between">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-primary">
                      <step.icon aria-hidden="true" className="size-6" />
                    </span>
                    <span aria-hidden="true" className="text-3xl font-semibold text-blue-100 tabular-nums">0{index + 1}</span>
                  </div>
                  <h3 className="m-0 text-lg leading-6 font-semibold">{step.title}</h3>
                </CardHeader>
                <CardContent>
                  <p className="m-0 text-sm leading-6 text-muted-foreground">{step.desc}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const BENEFITS = [
  { icon: ListChecksIcon, title: "Phạm vi rõ ràng", desc: "Xem công việc bao gồm và không bao gồm trên từng trang dịch vụ." },
  { icon: ReceiptTextIcon, title: "Xem trước giá dự kiến", desc: "Chi phí dự kiến thay đổi theo khối lượng bạn chọn trong bước đặt lịch." },
  { icon: Clock3Icon, title: "Lịch hẹn theo nhu cầu", desc: "Chọn ngày giờ và ghi chú những điều cần lưu ý tại nhà của bạn." },
  { icon: ClipboardListIcon, title: "Đơn hàng dễ theo dõi", desc: "Xem trạng thái, lịch sử và chi tiết các yêu cầu trong tài khoản của bạn." },
]

export function BenefitsSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24" aria-labelledby="benefits-heading">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12 lg:gap-16">
        <div className="relative aspect-[6/5] overflow-hidden rounded-[1.5rem] bg-muted md:aspect-[1/1.1] md:rounded-[2rem]">
          <Image
            src="/images/tong-ve-sinh.png"
            alt="Lau cửa kính và hút bụi sofa trong không gian phòng khách"
            fill
            sizes="(min-width: 1280px) 520px, (min-width: 768px) 46vw, calc(100vw - 32px)"
            className="object-cover"
          />
        </div>
        <div>
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Đặt lịch dễ dàng</p>
          <h2 id="benefits-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance lg:text-4xl">Một lịch đặt,<br />đủ thông tin cần biết.</h2>
          <p className="m-0 mt-4 text-base leading-7 text-muted-foreground">Biết rõ mình chọn gì, xem chi phí dự kiến và quản lý các lần sử dụng dịch vụ trong cùng một nơi.</p>
          <ul className="mt-8 grid gap-x-6 gap-y-7 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-blue-50 text-primary">
                  <benefit.icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="m-0 text-base leading-6 font-semibold">{benefit.title}</h3>
                <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{benefit.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const FAQS = [
  {
    question: "Tôi nên chọn dịch vụ nào cho nhà của mình?",
    answer: "Dọn nhà theo giờ phù hợp với công việc thường ngày. Tổng vệ sinh hoặc vệ sinh sau xây dựng dành cho nhu cầu làm sạch nhiều khu vực. Bạn cũng có thể chọn riêng dịch vụ sofa, nệm hoặc máy lạnh. Hãy xem phạm vi trên trang chi tiết trước khi đặt.",
  },
  {
    question: "Giá trên website được tính như thế nào?",
    answer: "Mỗi dịch vụ có giá tham khảo theo giờ, diện tích hoặc số lượng. Khi chọn khối lượng công việc, bạn sẽ thấy giá dự kiến trong bước đặt lịch. Đây là mức tham khảo, chưa phải báo giá cuối cùng.",
  },
  {
    question: "Tôi cần cung cấp thông tin gì khi đặt lịch?",
    answer: "Bạn cần thông tin liên hệ, địa chỉ thực hiện, loại nhà và ngày giờ mong muốn. Các thông tin về diện tích, số phòng, số tầng, thú cưng và yêu cầu riêng giúp mô tả rõ công việc cần làm.",
  },
  {
    question: "Tôi xem lại hoặc đặt lại dịch vụ ở đâu?",
    answer: "Sau khi đăng nhập, mở Đơn của tôi để xem trạng thái và chi tiết yêu cầu. Các đơn đã hoàn thành xuất hiện trong Lịch sử. Tại chi tiết đơn đã hoàn thành, bạn có thể chọn Đặt lại và kiểm tra thông tin cho lịch hẹn mới.",
  },
]

export function FaqSection() {
  return (
    <section id="cau-hoi-thuong-gap" className="scroll-mt-28 border-y border-border bg-slate-50/70" aria-labelledby="faq-heading">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[0.8fr_1.2fr] md:gap-14 md:py-20">
        <div>
          <p className="m-0 mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Trước khi đặt dịch vụ</p>
          <h2 id="faq-heading" className="m-0 text-3xl leading-tight font-bold tracking-tight text-balance lg:text-4xl">Bạn có thể muốn biết</h2>
          <p className="m-0 mt-4 max-w-sm text-base leading-7 text-muted-foreground">Một vài thông tin hữu ích để chọn dịch vụ và chuẩn bị lịch hẹn phù hợp.</p>
        </div>
        <div className="divide-y divide-border rounded-2xl border border-border bg-white px-5 sm:px-6">
          {FAQS.map((faq) => (
            <details key={faq.question} name="cleanhome-faq" className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-5 text-sm leading-6 font-semibold transition-colors hover:text-primary sm:text-base [&::-webkit-details-marker]:hidden">
                {faq.question}
                <PlusIcon aria-hidden="true" className="size-5 shrink-0 text-primary transition-transform group-open:rotate-45 motion-reduce:transition-none" />
              </summary>
              <p className="m-0 pb-5 text-sm leading-7 text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CtaSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20" aria-labelledby="cta-heading">
      <div className="relative isolate overflow-hidden rounded-[1.5rem] bg-primary px-6 py-10 text-primary-foreground sm:px-10 md:rounded-[2rem] md:px-12 md:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 -z-10 size-80 rounded-full border-[48px] border-white/5" />
        <div className="flex flex-col items-start gap-7 md:flex-row md:items-center md:justify-between md:gap-10">
          <div className="max-w-xl">
            <h2 id="cta-heading" className="m-0 text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl">Nhà sạch bắt đầu từ một lịch hẹn.</h2>
            <p className="m-0 mt-4 text-sm leading-7 text-primary-foreground/85 sm:text-base">Chọn dịch vụ và thời gian phù hợp. Xem lại yêu cầu trước khi hoàn tất đặt lịch.</p>
          </div>
          <Button size="lg" variant="secondary" className="w-full shrink-0 bg-white px-6 text-primary hover:bg-blue-50 sm:w-auto" render={<Link href="/dat-dich-vu" />} nativeButton={false}>
            Đặt dịch vụ ngay
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  )
}
