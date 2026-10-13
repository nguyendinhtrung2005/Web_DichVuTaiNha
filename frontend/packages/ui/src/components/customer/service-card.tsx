"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CATEGORY_LABEL } from "@/lib/config"
import { formatCurrency } from "@/lib/format"
import type { Service } from "@/lib/types"

export function ServiceCard({ service, showBooking = false, headingLevel = "h3" }: { service: Service; showBooking?: boolean; headingLevel?: "h2" | "h3" }) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const image = service.image || "/placeholder.svg"
  const Heading = headingLevel

  return (
    <Card className="group h-full overflow-hidden rounded-2xl pt-0 shadow-sm shadow-slate-900/5 ring-border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/8 motion-reduce:transform-none motion-reduce:transition-none [--card-spacing:--spacing(5)]">
      <div className="relative aspect-[3/2] overflow-hidden bg-muted">
        <Image
          src={failedImage === image ? "/placeholder.svg" : image}
          alt={service.name}
          fill
          sizes="(min-width: 1280px) 360px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
          onError={() => setFailedImage(image)}
        />
        <Badge variant="secondary" className="absolute top-3 left-3 border-white/80 bg-white/95 px-3 py-1 text-primary shadow-sm">
          {CATEGORY_LABEL[service.category]}
        </Badge>
      </div>
      <CardHeader className="gap-3">
        <CardTitle><Heading className={`m-0 text-lg leading-6 font-semibold${showBooking ? " min-h-12" : ""}`}>{service.name}</Heading></CardTitle>
        <CardDescription className="line-clamp-2 min-h-12 leading-6">{service.shortDesc}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="m-0 text-xs text-muted-foreground">Giá tham khảo từ</p>
        <p className="m-0 mt-1.5 text-xl font-semibold text-primary tabular-nums">
          {formatCurrency(service.price)}
          <span className="text-sm font-normal text-muted-foreground"> / {service.unit}</span>
        </p>
      </CardContent>
      <CardFooter className={showBooking ? "flex-col gap-2 bg-white" : "bg-white"}>
        <Button variant="outline" className="w-full justify-between" aria-label={`Xem chi tiết ${service.name}`} render={<Link href={`/dich-vu/${service.slug}`} />} nativeButton={false}>
          Xem chi tiết
          <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
        {showBooking && (
          <Button className="w-full justify-between" aria-label={`Đặt dịch vụ ${service.name}`} render={<Link href={`/dat-dich-vu/${service.id}`} />} nativeButton={false}>
            Đặt dịch vụ
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
