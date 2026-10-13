import { formatDateTime } from "@/lib/format"
import type { HistoryEntry } from "@/lib/types"

export function OrderTimeline({ history }: { history: HistoryEntry[] }) {
  return (
    <ol className="flex flex-col">
      {history.map((h, i) => (
        <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
          {i < history.length - 1 && <span aria-hidden="true" className="absolute top-3 left-[5px] h-full w-px bg-border" />}
          <span aria-hidden="true" className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-card" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">{h.label}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(h.at)} · {h.by}
            </p>
            {h.note && <p className="text-sm text-muted-foreground text-pretty">{h.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
