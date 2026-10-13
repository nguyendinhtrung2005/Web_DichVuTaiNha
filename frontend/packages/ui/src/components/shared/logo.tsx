import Link from "next/link"
import { SparklesIcon } from "lucide-react"

export function Logo({ href = "/", suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <SparklesIcon aria-hidden="true" className="size-4" />
      </span>
      <span className="text-lg tracking-tight">CleanHome</span>
      {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
    </Link>
  )
}
