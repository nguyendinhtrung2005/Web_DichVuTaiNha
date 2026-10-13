"use client"

import { useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react"
import { LoaderCircleIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function AdminDialog({ title, busy, error, isBusy, close, submit, children, submitLabel }: {
  title: string
  busy: boolean
  error: string
  isBusy: () => boolean
  close: () => void
  submit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  submitLabel: string
}) {
  const element = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const errorElement = useRef<HTMLParagraphElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = element.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelButton.current?.focus({ preventScroll: true })
    return () => dialog?.close()
  }, [])
  useLayoutEffect(() => { if (error && !busy) errorElement.current?.focus({ preventScroll: true }) }, [error, busy])
  return <dialog ref={element} aria-labelledby={titleId}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl outline-none backdrop:bg-slate-950/35 backdrop:backdrop-blur-sm sm:p-7"
    onCancel={(event) => { event.preventDefault(); if (!isBusy()) close() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || isBusy()) return
      const box = event.currentTarget.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
    }}>
    <div className="mb-5 flex min-w-0 items-start justify-between gap-3"><h2 id={titleId} className="m-0 min-w-0 break-words pt-2 text-xl leading-7 font-semibold">{title}</h2><Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Đóng hộp thoại" disabled={busy} onClick={close}><XIcon aria-hidden="true" /></Button></div>
    <form noValidate onSubmit={submit} aria-busy={busy} className="flex min-w-0 flex-col gap-5">
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">{children}</fieldset>
      {error && <p ref={errorElement} role="alert" tabIndex={-1} className="m-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-7 text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{error}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end"><Button ref={cancelButton} type="button" variant="outline" className="h-11" disabled={busy} onClick={close}>Quay lại</Button><Button type="submit" className="h-11 whitespace-normal" disabled={busy}>{busy ? <><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang lưu...</> : submitLabel}</Button></div>
    </form>
  </dialog>
}
