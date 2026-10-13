"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { DownloadIcon, FileUpIcon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react'
import { previewMigration, parsePrivateBackup, snapshotChecksum, createPrivateBackup, canonicalSnapshot, type MigrationSource, type MigrationCollection } from '@/lib/data-migration'
import { createSeedState } from '@/lib/mock-data'
import { readUnifiedEnvelope, initializeUnifiedData, UNIFIED_STORAGE_KEY } from '@/lib/unified-storage'
import { getStoreSnapshot, useCurrentUser, useDataStatus, reloadUnifiedData } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field } from '../../common'
import { Logo } from '@/components/shared/logo'
import { AdminDialog } from '@/components/admin/admin-dialog'
import { downloadPrivateBackup } from './data-export'

const labels: Record<MigrationCollection, string> = { users: 'Tài khoản', services: 'Dịch vụ', orders: 'Đơn dịch vụ', payments: 'Thanh toán', reviews: 'Đánh giá' }
const localCustomerKey = 'cleanhome-demo-state-customer'
const buttonStyle = 'min-h-11 whitespace-normal'
type Target = ReturnType<typeof readUnifiedEnvelope>

export function DataSetupGate() { return <DataManagement setup /> }

/** Backup, preview, whole-record conflict choice and explicit import. No automatic migration. */
export function DataManagement({ setup = false }: { setup?: boolean }) {
  const dataStatus = useDataStatus()
  const user = useCurrentUser()
  const [target, setTarget] = useState<Target | null>(null)
  const [sources, setSources] = useState<MigrationSource[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [targetBackedUp, setTargetBackedUp] = useState<string | null>(null)
  const [localBackedUp, setLocalBackedUp] = useState<string | null>(null)
  const [expectedRaw, setExpectedRaw] = useState<string | null | undefined>(undefined)
  const [confirm, setConfirm] = useState(false)
  const [approved, setApproved] = useState(false)
  const [seedMode, setSeedMode] = useState(false)
  const [dirtyBackup, setDirtyBackup] = useState('')
  const [reloadConfirm, setReloadConfirm] = useState(false)
  const [reloadApproved, setReloadApproved] = useState(false)
  const mutex = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const reloadOpener = useRef<HTMLButtonElement>(null)
  const preview = useMemo(() => previewMigration(sources, choices), [sources, choices])
  const isAdmin = user?.role === 'admin' && user.status === 'active'
  const canManage = !!target && (target.status !== 'ready' || isAdmin)
  const canImport = sources.length > 0 && preview.unresolved === 0 && preview.issues.length === 0 && expectedRaw !== undefined
    && canManage && !dataStatus.dirty && target?.status !== 'unavailable' && (expectedRaw === null || targetBackedUp === expectedRaw)

  useEffect(() => { setTarget(readUnifiedEnvelope()) }, [dataStatus.revision, dataStatus.status])
  function feedbackFocus() { requestAnimationFrame(() => feedback.current?.focus({ preventScroll: false })) }
  async function task(action: () => Promise<void>) {
    if (mutex.current) return
    mutex.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa thể thực hiện thao tác. Dữ liệu nguồn được giữ nguyên.') }
    finally { mutex.current = false; setBusy(false); feedbackFocus() }
  }
  async function backupTarget() { await task(async () => {
    const current = readUnifiedEnvelope(); setTarget(current)
    if (current.status === 'ready' && !isAdmin) throw new Error('Chỉ quản trị viên đang hoạt động được sao lưu toàn bộ dữ liệu chung.')
    if (current.raw === null) throw new Error('Chưa có dữ liệu chung để sao lưu.')
    await downloadPrivateBackup(current.raw, { role: 'unified', origin: window.location.origin, key: UNIFIED_STORAGE_KEY })
    setTargetBackedUp(current.raw); setNotice('Đã yêu cầu tải bản sao dữ liệu chung. Hãy kiểm tra file đã được lưu trên máy.')
  }) }
  async function backupCustomer() { await task(async () => {
    const raw = localStorage.getItem(localCustomerKey)
    if (raw === null) throw new Error('Không có dữ liệu Customer cũ tại địa chỉ hiện tại. Bạn có thể chọn file sao lưu từ ứng dụng khác.')
    await downloadPrivateBackup(raw, { role: 'customer', origin: window.location.origin, key: localCustomerKey })
    setLocalBackedUp(raw); setNotice('Đã yêu cầu tải bản sao Customer. Hãy kiểm tra file trước khi thêm nguồn này.')
  }) }
  async function collectTarget(): Promise<{ source?: MigrationSource; raw: string | null }> {
    const current = readUnifiedEnvelope(); setTarget(current)
    if (current.status === 'ready' && !isAdmin) throw new Error('Chỉ quản trị viên đang hoạt động được nhập hoặc đối chiếu dữ liệu chung.')
    if (dataStatus.dirty) throw new Error('Bản hiện tại có thay đổi chưa lưu. Hãy sao lưu bản này và xác nhận tải lại trước khi nhập dữ liệu.')
    if (current.status === 'unavailable') throw new Error('Chưa thể đọc dữ liệu chung. Hãy cho phép lưu trữ hoặc thử trình duyệt khác.')
    if (current.raw !== null && targetBackedUp !== current.raw) throw new Error('Hãy sao lưu dữ liệu chung hiện tại trước khi chuẩn bị bản nhập.')
    if (current.status === 'ready' && current.envelope) return {
      raw: current.raw,
      source: { id: 'current-target', name: 'Dữ liệu chung hiện tại', state: { ...current.envelope.data, session: null }, checksum: await snapshotChecksum(current.raw!), origin: window.location.origin, key: UNIFIED_STORAGE_KEY },
    }
    return { raw: current.raw }
  }
  async function addSources(incoming: MigrationSource[]) {
    const current = await collectTarget()
    const existing = expectedRaw === undefined ? [] : sources.filter(source => source.id !== 'current-target')
    if (expectedRaw !== undefined && expectedRaw !== current.raw) throw new Error('Dữ liệu chung đã đổi kể từ lần xem trước. Hãy bắt đầu xem lại các nguồn nhập.')
    const combined = [...(current.source ? [current.source] : []), ...existing]
    for (const source of incoming) {
      if (combined.some(item => item.checksum === source.checksum && item.origin === source.origin && item.key === source.key)) continue
      combined.push(source)
    }
    setSources(combined); setExpectedRaw(current.raw); setChoices({}); setSeedMode(false)
    setNotice('Đã đọc các nguồn. Hãy kiểm tra số lượng và chọn bản ghi cho từng xung đột trước khi xác nhận.')
  }
  async function addCustomer() { await task(async () => {
    const raw = localStorage.getItem(localCustomerKey)
    if (raw === null) throw new Error('Không tìm thấy dữ liệu Customer cũ.')
    if (localBackedUp !== raw) throw new Error('Hãy tải bản sao Customer hiện tại trước khi thêm nguồn.')
    const backup = await createPrivateBackup(raw, { role: 'customer', origin: window.location.origin, key: localCustomerKey })
    await addSources([await parsePrivateBackup(JSON.stringify(backup), 'legacy-customer', 'Customer tại địa chỉ hiện tại')])
  }) }
  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    const selected = Array.from(files)
    await task(async () => {
      const incoming: MigrationSource[] = []
      for (const file of selected) {
        if (file.size > 20 * 1024 * 1024) throw new Error('File vượt quá 20 MB. Hãy liên hệ người phụ trách để kiểm tra trước khi nhập.')
        const id = `file-${crypto.randomUUID()}`
        const source = await parsePrivateBackup(await file.text(), id, file.name)
        incoming.push(source)
      }
      await addSources(incoming)
    })
  }
  async function prepareSeed() { await task(async () => {
    const current = readUnifiedEnvelope(); setTarget(current)
    if (current.status !== 'missing') throw new Error('Chỉ khởi tạo khi chưa có dữ liệu chung. Hãy dùng quy trình sao lưu và nhập cho dữ liệu hiện có.')
    const state = createSeedState()
    setSources([{ id: 'project-source', name: 'Dữ liệu phát triển có sẵn trong dự án', state: { ...state, session: null }, checksum: await snapshotChecksum(JSON.stringify(state)), origin: window.location.origin, key: 'project-existing-data' }])
    setChoices({}); setExpectedRaw(null); setSeedMode(true)
    setNotice('Đã chuẩn bị để xem lại. Chưa ghi dữ liệu. Nguồn này dành cho phát triển và kiểm tra giao diện.')
  }) }
  async function backupDirtySnapshot() { await task(async () => {
    const snapshot = getStoreSnapshot()
    const actor = snapshot?.users.find(item => item.id === snapshot.session?.userId && item.role === snapshot.session.role && item.status === 'active')
    if (!snapshot || !actor || !dataStatus.dirty) throw new Error('Chưa có bản thay đổi chưa lưu của tài khoản hợp lệ để sao lưu.')
    const clean = { ...snapshot, session: null }
    const current = readUnifiedEnvelope()
    const raw = JSON.stringify({ schemaVersion: 1, revision: Math.max(1, dataStatus.revision), provenance: current.envelope?.provenance ?? [], data: clean })
    await downloadPrivateBackup(raw, { role: 'unsaved-tab', origin: window.location.origin, key: UNIFIED_STORAGE_KEY })
    setDirtyBackup(canonicalSnapshot(clean)); setNotice('Đã yêu cầu tải bản thay đổi chưa lưu trong tab này. Kiểm tra file tải xuống trước khi xác nhận tải lại.')
  }) }
  async function discardDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutex.current) return
    await task(async () => {
      const snapshot = getStoreSnapshot()
      if (!reloadApproved || !snapshot || !dirtyBackup || dirtyBackup !== canonicalSnapshot({ ...snapshot, session: null })) throw new Error('Hãy sao lưu đúng bản thay đổi hiện tại và đánh dấu xác nhận trước khi tải lại.')
      reloadUnifiedData()
      setReloadConfirm(false); setReloadApproved(false); setDirtyBackup(''); setSources([]); setChoices({}); setExpectedRaw(undefined); setSeedMode(false); setTarget(readUnifiedEnvelope())
      setNotice('Đã tải lại dữ liệu đã lưu. Bản thay đổi trước đó được giữ trong file sao lưu bạn vừa tải.')
    })
  }
  function resetPreview() {
    if (mutex.current) return
    setSources([]); setChoices({}); setExpectedRaw(undefined); setSeedMode(false); setError(''); setNotice(''); setTarget(readUnifiedEnvelope())
  }
  function closeConfirmation() { if (!mutex.current) { setConfirm(false); setApproved(false); requestAnimationFrame(() => opener.current?.focus()) } }
  async function importData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutex.current) return
    if (!approved) { setError('Hãy đánh dấu xác nhận sau khi đã kiểm tra bản nhập.'); return }
    await task(async () => {
      const currentPreview = previewMigration(sources, choices)
      if (!canImport || currentPreview.unresolved || currentPreview.issues.length || expectedRaw === undefined) throw new Error('Bản nhập chưa đủ điều kiện. Hãy kiểm tra các nguồn và xung đột.')
      const result = await initializeUnifiedData(currentPreview.state, sources.map(source => ({ origin: source.origin, key: source.key, checksum: source.checksum, name: source.name })), { expectedRaw })
      if (!result.ok) throw new Error(result.error)
      const saved = readUnifiedEnvelope()
      if (saved.status !== 'ready' || !saved.envelope || saved.envelope.revision !== result.revision) throw new Error('Chưa kiểm chứng được dữ liệu vừa lưu. Hãy giữ các file sao lưu và tải lại để kiểm tra.')
      setTarget(saved); setSources([]); setChoices({}); setExpectedRaw(undefined); setConfirm(false); setApproved(false); setSeedMode(false)
      setNotice('Đã lưu dữ liệu chung trên trình duyệt này. Các nguồn cũ được giữ nguyên; bạn cần đăng nhập để tiếp tục.')
    })
  }

  return <main data-data-management aria-busy={busy} className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-7 px-4 py-7 sm:px-6 sm:py-10">
    <div className="flex flex-wrap items-center justify-between gap-3"><Logo /><Link href="/" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Trang chủ</Link></div>
    <header><p className="mb-2 text-xs font-semibold tracking-wider text-primary uppercase">CleanHome / Quản lý dữ liệu</p><h1 className="m-0 text-2xl leading-tight font-bold sm:text-3xl">{setup ? 'Chọn dữ liệu để bắt đầu' : 'Sao lưu và nhập dữ liệu'}</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">Chọn nguồn, sao lưu và xem lại trước khi nhập. Website giữ nguyên dữ liệu nguồn và không tự chọn bản ghi khi có xung đột.</p></header>
    {busy && <p role="status" className="m-0 flex items-center gap-2 text-sm"><LoaderCircleIcon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Đang xử lý dữ liệu...</p>}
    {dataStatus.dirty && user && <Card><CardContent className="space-y-4 pt-2"><h2 className="m-0 text-lg font-semibold">Giữ bản thay đổi chưa lưu</h2><p className="m-0 text-sm leading-7 text-muted-foreground">Tab này có thay đổi chưa lưu được trên trình duyệt. Sao lưu bản đang giữ trong tab trước khi tải lại; bản này khác với dữ liệu đã lưu trước đó.</p><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Button variant="outline" className={buttonStyle} disabled={busy} onClick={backupDirtySnapshot}><DownloadIcon aria-hidden="true" />Sao lưu bản thay đổi trong tab</Button><Button ref={reloadOpener} variant="outline" className={buttonStyle} disabled={busy || !dirtyBackup} onClick={() => { setReloadApproved(false); setError(''); setReloadConfirm(true) }}>Xem xác nhận tải lại dữ liệu đã lưu</Button></div></CardContent></Card>}
    {!target ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircleIcon aria-hidden="true" className="animate-spin" />Đang kiểm tra dữ liệu...</p> : !canManage ? <Card><CardContent className="space-y-4 pt-2"><h2 className="m-0 text-lg font-semibold">Quản trị viên quản lý dữ liệu chung</h2><p className="m-0 text-sm leading-7 text-muted-foreground">Chỉ quản trị viên đang hoạt động được nhập, đối chiếu hoặc sao lưu toàn bộ dữ liệu chung. {dataStatus.dirty ? 'Bạn vẫn có thể giữ bản thay đổi chưa lưu bằng nút sao lưu ở trên.' : user ? 'Đăng xuất ở khu vực của bạn, rồi dùng tài khoản quản trị để tiếp tục.' : 'Hãy đăng nhập bằng tài khoản quản trị để tiếp tục.'}</p><Link href={user ? user.role === 'staff' ? '/staff' : '/' : '/dang-nhap'} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">{user ? 'Về khu vực của tôi' : 'Mở trang đăng nhập'}</Link></CardContent></Card> : <>
      {target.status === 'ready' && <p className="m-0 rounded-xl bg-blue-50 p-4 text-sm leading-7 text-blue-900">Đã có dữ liệu chung. Nguồn nhập sẽ được đối chiếu với dữ liệu này; mọi khác biệt cần được bạn xem lại.</p>}
      {['corrupt', 'unsupported', 'unavailable'].includes(target.status) && <p role="alert" className="m-0 rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-800">{target.status === 'unavailable' ? 'Chưa thể truy cập dữ liệu của trình duyệt. Hãy kiểm tra quyền lưu trữ rồi tải lại.' : 'Dữ liệu chung hiện tại chưa đọc được. Tải bản sao nguyên vẹn trước; chỉ khôi phục bằng nguồn hợp lệ sau khi xem lại và xác nhận.'}</p>}
      <Card><CardContent className="space-y-5 pt-2"><h2 className="m-0 text-lg font-semibold">1. Giữ bản sao an toàn</h2><p className="m-0 text-sm leading-7 text-muted-foreground">File sao lưu chứa thông tin cá nhân và thông tin xác thực. Chỉ lưu ở nơi tin cậy, không đăng công khai. Kiểm tra file đã được tải xuống trước khi nhập.</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Button variant="outline" className={buttonStyle} disabled={busy || target.raw === null} onClick={backupTarget}><DownloadIcon aria-hidden="true" />Sao lưu dữ liệu chung</Button><Button variant="outline" className={buttonStyle} disabled={busy} onClick={backupCustomer}><DownloadIcon aria-hidden="true" />Sao lưu Customer cũ</Button></div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="http://localhost:3002/du-lieu" target="_blank" rel="noopener noreferrer">Mở sao lưu Staff cũ</a><a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="http://localhost:3003/du-lieu" target="_blank" rel="noopener noreferrer">Mở sao lưu Admin cũ</a></div>
      </CardContent></Card>
      <Card><CardContent className="space-y-5 pt-2"><h2 className="m-0 text-lg font-semibold">2. Chọn nguồn cần nhập</h2><p className="m-0 text-sm leading-7 text-muted-foreground">Dữ liệu ở địa chỉ Staff và Admin được đưa vào bằng file sao lưu. Phiên đăng nhập cũ không được chuyển sang website chung.</p>
        <fieldset disabled={busy || target.status === 'unavailable'} className="m-0 min-w-0 space-y-4 border-0 p-0"><Field label="File sao lưu CleanHome" hint="Có thể chọn nhiều file. Mỗi file tối đa 20 MB."><input type="file" name="migration-files" accept="application/json,.json" multiple className="min-h-11 w-full min-w-0 rounded-lg border border-border p-2 text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-primary" onChange={event => { void addFiles(event.currentTarget.files); event.currentTarget.value = '' }} /></Field>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap"><Button variant="outline" className={buttonStyle} disabled={localBackedUp === null} onClick={addCustomer}><FileUpIcon aria-hidden="true" />Thêm nguồn Customer đã sao lưu</Button>{target.status === 'missing' && <Button variant="outline" className={buttonStyle} onClick={prepareSeed}>Xem dữ liệu có sẵn của dự án</Button>}</div>
        </fieldset>
      </CardContent></Card>
      {sources.length > 0 && <Card><CardContent className="space-y-5 pt-2"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-lg font-semibold">3. Xem lại bản nhập</h2><Button variant="ghost" className={buttonStyle} disabled={busy} onClick={resetPreview}>Bắt đầu xem lại</Button></div>
        <ul className="m-0 space-y-2 pl-5 text-sm leading-7">{sources.map(source => <li key={source.id} className="break-words">{source.name} <span className="text-muted-foreground">({source.origin})</span></li>)}</ul>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(preview.counts).map(([key, count]) => <div key={key} className="min-w-0 rounded-xl bg-blue-50 p-3"><dt className="text-xs leading-5 text-muted-foreground">{labels[key as MigrationCollection]}</dt><dd className="m-0 mt-1 text-xl font-semibold">{count}</dd></div>)}</dl>
        <p className="m-0 text-sm leading-7 text-muted-foreground">{preview.duplicateCount} bản ghi trùng hoàn toàn được gộp. {preview.conflicts.length} xung đột; {preview.unresolved} chưa có lựa chọn. Giá, lịch, lịch sử và số tiền được giữ nguyên theo bản ghi đã chọn.</p>
        {preview.conflicts.length > 0 && <div className="space-y-4">{preview.conflicts.map(conflict => <div key={conflict.key} className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="m-0 mb-3 break-words text-sm leading-6"><strong>{labels[conflict.collection]} / {conflict.id}</strong><br />Trường khác nhau: {conflict.fields.map(field => field === 'authentication' ? 'Thông tin xác thực' : field).join(', ')}</p><Field label="Nguồn bản ghi được giữ"><select name={`conflict-${conflict.key}`} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-white px-3 text-sm" value={choices[conflict.key] ?? ''} disabled={busy} onChange={event => setChoices(current => ({ ...current, [conflict.key]: event.target.value }))}><option value="">Chọn một nguồn</option>{conflict.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></Field></div>)}</div>}
        {preview.issues.length > 0 && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-800"><p className="m-0 font-semibold">Bản nhập còn dữ liệu hoặc quan hệ chưa hợp lệ:</p><ul className="mt-2 mb-0 space-y-1 pl-5">{preview.issues.slice(0, 12).map((issue, index) => <li key={index} className="break-words">{labels[issue.collection as MigrationCollection] ?? issue.collection}{issue.id ? ` / ${issue.id}` : ''}: {issue.message}</li>)}</ul>{preview.issues.length > 12 && <p className="mt-2 mb-0">Còn {preview.issues.length - 12} vấn đề khác. Hãy kiểm tra đầy đủ nguồn trước khi nhập.</p>}</div>}
        <Button ref={opener} className={`${buttonStyle} w-full sm:w-auto`} disabled={busy || !canImport} onClick={() => { setApproved(false); setError(''); setConfirm(true) }}><ShieldCheckIcon aria-hidden="true" />Xem xác nhận nhập dữ liệu</Button>
      </CardContent></Card>}
      {target.status === 'ready' && <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" href="/dang-nhap">Tiếp tục đăng nhập</Link>}
    </>}
    {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? 'alert' : 'status'} className={`m-0 break-words rounded-xl p-4 text-sm leading-7 ${error ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{error || notice}</p>}
    {confirm && <AdminDialog title={seedMode ? 'Xác nhận khởi tạo dữ liệu phát triển' : target && ['corrupt', 'unsupported'].includes(target.status) ? 'Xác nhận khôi phục dữ liệu chung' : 'Xác nhận nhập dữ liệu chung'} busy={busy} error={error} isBusy={() => mutex.current} close={closeConfirmation} submit={importData} submitLabel="Xác nhận lưu dữ liệu">
      <p className="m-0 text-sm leading-7">{seedMode ? 'Nguồn này là dữ liệu phát triển đã có trong dự án, dùng để kiểm tra giao diện. ' : expectedRaw !== null && target?.status !== 'ready' ? 'Bản nhập hợp lệ sẽ thay dữ liệu chung chưa đọc được. Hãy giữ file sao lưu nguyên vẹn để khôi phục nếu cần. ' : 'Bản nhập sẽ lưu các bản ghi và lựa chọn bạn vừa xem lại. '}Các khóa dữ liệu cũ và file sao lưu được giữ nguyên. Bạn sẽ đăng nhập bằng tài khoản có trong nguồn đã chọn.</p>
      <dl className="grid grid-cols-2 gap-3">{Object.entries(preview.counts).map(([key, count]) => <div key={key} className="rounded-xl bg-blue-50 p-3"><dt className="text-xs text-muted-foreground">{labels[key as MigrationCollection]}</dt><dd className="m-0 mt-1 font-semibold">{count}</dd></div>)}</dl>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-7"><input type="checkbox" name="migration-approved" className="mt-1.5 size-5 shrink-0 accent-blue-600" checked={approved} onChange={event => setApproved(event.target.checked)} /><span>Tôi đã kiểm tra bản nhập, các lựa chọn và đã giữ file sao lưu cần thiết.</span></label>
    </AdminDialog>}
    {reloadConfirm && <AdminDialog title="Xác nhận tải lại dữ liệu đã lưu" busy={busy} error={error} isBusy={() => mutex.current} close={() => { if (!mutex.current) { setReloadConfirm(false); setReloadApproved(false); requestAnimationFrame(() => reloadOpener.current?.focus()) } }} submit={discardDraft} submitLabel="Xác nhận tải lại"><p className="m-0 text-sm leading-7">Thao tác này bỏ bản chưa lưu đang giữ trong tab và mở lại dữ liệu đã lưu. Nguồn trên trình duyệt và file sao lưu không bị xóa. Bạn có thể nhập lại file vừa sao lưu qua quản trị viên sau khi đối chiếu.</p><label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-7"><input type="checkbox" name="reload-approved" className="mt-1.5 size-5 shrink-0 accent-blue-600" checked={reloadApproved} onChange={event => setReloadApproved(event.target.checked)} /><span>Tôi đã kiểm tra file sao lưu bản thay đổi và đồng ý tải lại dữ liệu đã lưu.</span></label></AdminDialog>}
  </main>
}
