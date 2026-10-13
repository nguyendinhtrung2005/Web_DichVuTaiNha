import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { JOB_STATUS_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/config"
import type { CancelRequest, JobStatus, OrderStatus, PaymentStatus } from "@/lib/types"

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary"

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info text-info-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  )
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  pending: "warning",
  confirmed: "info",
  in_progress: "primary",
  completed: "success",
  cancelled: "danger",
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <ToneBadge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABEL[status]}</ToneBadge>
}

const JOB_TONE: Record<JobStatus, Tone> = {
  waiting: "warning",
  accepted: "info",
  in_progress: "primary",
  done: "success",
}

export function JobStatusBadge({ status }: { status?: JobStatus }) {
  if (!status) return <ToneBadge tone="neutral">Chưa phân công</ToneBadge>
  return <ToneBadge tone={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</ToneBadge>
}

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  unpaid: "neutral",
  pending: "warning",
  paid: "success",
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <ToneBadge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</ToneBadge>
}

export function CancelRequestBadge({ request }: { request?: CancelRequest }) {
  if (!request) return null
  if (request.status === "pending") return <ToneBadge tone="warning">Yêu cầu hủy chờ duyệt</ToneBadge>
  if (request.status === "rejected") return <ToneBadge tone="neutral">Yêu cầu hủy bị từ chối</ToneBadge>
  return null
}
