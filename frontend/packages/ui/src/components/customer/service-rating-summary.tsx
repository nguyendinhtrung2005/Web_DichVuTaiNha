"use client"

import { useEffect, useState } from "react"
import { StarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getServiceReviewSummary, type ServiceReviewSummary } from "@/lib/customer-service-reviews"

export function ServiceRatingSummary({ serviceId }: { serviceId: string }) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ id: string; data?: ServiceReviewSummary; error?: string }>({ id: "" })
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void getServiceReviewSummary(serviceId, controller.signal).then(
      (data) => { if (!cancelled) setResult({ id: serviceId, data }) },
      (error: unknown) => { if (!cancelled) setResult({ id: serviceId, error: error instanceof Error ? error.message : "Chưa thể tải điểm đánh giá." }) },
    )
    return () => { cancelled = true; controller.abort() }
  }, [serviceId, retry])
  const ready = result.id === serviceId
  return <section className="rounded-2xl border border-border p-6" aria-label="Điểm đánh giá chung">
    <h2 className="m-0 mb-3 text-lg font-semibold">Điểm đánh giá chung</h2>
    {!ready ? <p role="status" className="m-0 text-sm text-muted-foreground">Đang tải đánh giá...</p> : result.error ? <div role="alert"><p className="m-0 mb-3 text-sm leading-6 text-muted-foreground">{result.error}</p><Button variant="outline" onClick={() => { setResult({ id: "" }); setRetry((value) => value + 1) }}>Thử tải đánh giá</Button></div> : result.data?.count ? <p className="m-0 flex items-center gap-2 text-sm"><StarIcon aria-hidden="true" className="size-5 fill-amber-400 text-amber-500" /><strong>{result.data.averageRating?.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}/5</strong><span className="text-muted-foreground">từ {result.data.count} đánh giá của đơn đã hoàn thành</span></p> : <p className="m-0 text-sm text-muted-foreground">Chưa có đánh giá cho dịch vụ này.</p>}
  </section>
}
