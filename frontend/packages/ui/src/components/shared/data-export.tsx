"use client"

import { useRef, useState } from 'react'
import Link from 'next/link'
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react'
import type { Role } from '@/lib/types'
import { createPrivateBackup } from '@/lib/data-migration'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/shared/logo'

export async function downloadPrivateBackup(raw: string, source: { role: string; origin: string; key: string }) {
  const backup = await createPrivateBackup(raw, source)
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `cleanhome-backup-${source.role}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.appendChild(anchor)
  try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return backup
}

/** Intentionally reads raw storage only. Never loads the old store or its seed fallback. */
export function RawDataExportPage({ role }: { role: Role }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mutex = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  async function exportData() {
    if (mutex.current) return
    mutex.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const key = `cleanhome-demo-state-${role}`
      const raw = window.localStorage.getItem(key)
      if (raw === null) throw new Error('Trình duyệt này chưa có dữ liệu để sao lưu. Trang này không tự khởi tạo dữ liệu.')
      await downloadPrivateBackup(raw, { role, origin: window.location.origin, key })
      setNotice('Đã yêu cầu tải file sao lưu. Hãy kiểm tra thư mục tải xuống trước khi đóng trang.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa thể tạo file sao lưu. Hãy kiểm tra quyền lưu trữ của trình duyệt.') }
    finally { mutex.current = false; setBusy(false); requestAnimationFrame(() => feedback.current?.focus()) }
  }
  return <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
    <Logo />
    <div><h1 className="m-0 text-2xl font-bold sm:text-3xl">Sao lưu dữ liệu CleanHome</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">Tải bản sao nguyên vẹn từ trình duyệt của website hiện tại. Dữ liệu nguồn được giữ nguyên.</p></div>
    <Card><CardContent className="space-y-5 pt-2"><p className="m-0 text-sm leading-7">File có thông tin cá nhân và thông tin xác thực. Chỉ lưu tại nơi tin cậy và không đăng công khai. File được giữ nguyên ngay cả khi dữ liệu nguồn chưa đọc được.</p>
      <Button className="min-h-11 w-full whitespace-normal sm:w-auto" disabled={busy} onClick={exportData}>{busy ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <DownloadIcon aria-hidden="true" />} {busy ? 'Đang tạo file...' : 'Tải file sao lưu'}</Button>
      {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? 'alert' : 'status'} className={`m-0 break-words rounded-xl p-4 text-sm leading-7 ${error ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{error || notice}</p>}
    </CardContent></Card>
    <Link href="/" className="text-sm text-primary underline underline-offset-4">Quay lại trang chính</Link>
  </main>
}
