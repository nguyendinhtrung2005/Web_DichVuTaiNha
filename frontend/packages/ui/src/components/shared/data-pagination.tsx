"use client"

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function usePaged<T>(items: T[], pageSize = 8) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, totalPages)
  return {
    page: current,
    totalPages,
    setPage,
    total: items.length,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
  }
}

export function DataPagination({ page, totalPages, total, setPage }: { page: number; totalPages: number; total: number; setPage: (p: number) => void }) {
  if (total === 0) return null
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
      <span>
        Trang {page}/{totalPages} · {total} kết quả
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeftIcon data-icon="inline-start" />
          Trước
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Sau
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  )
}
