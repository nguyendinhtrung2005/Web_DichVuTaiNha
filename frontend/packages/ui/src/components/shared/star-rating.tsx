"use client"

import { StarIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function StarDisplay({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value.toFixed(1)} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} aria-hidden="true" className={cn("size-4", i <= Math.round(value) ? "fill-chart-4 text-chart-4" : "text-border")} />
      ))}
    </span>
  )
}

export function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} sao`}
          onClick={() => onChange(i)}
          className="rounded-md p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <StarIcon aria-hidden="true" className={cn("size-7 transition-colors", i <= value ? "fill-chart-4 text-chart-4" : "text-border hover:text-chart-4")} />
        </button>
      ))}
    </div>
  )
}
