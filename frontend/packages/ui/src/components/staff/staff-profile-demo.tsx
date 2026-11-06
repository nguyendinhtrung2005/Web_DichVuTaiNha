"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { AwardIcon, BriefcaseBusinessIcon, CheckIcon, HouseIcon, InfoIcon, LeafIcon, MapPinIcon, PencilIcon, PlusIcon, RotateCcwIcon, SaveIcon, SparklesIcon, SunIcon, Trash2Icon, UserRoundIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useStaffAuth } from "./staff-auth-session"
import { createProfileDemoAdapter } from "./staff-profile-demo-adapter"
import { AVATAR_LABELS, EMPLOYMENT_LABELS, PROFILE_AVATARS, PROFILE_SKILLS, SKILL_LABELS, ProfileDemoValidationError, cloneProfileDemo, validateProfileDemo, type ProfileDemoAdapter, type ProfileDemoData, type ProfileErrors, type ProfileAvatar } from "./staff-profile-demo-model"

const avatarIcons = { sparkle: SparklesIcon, leaf: LeafIcon, home: HouseIcon, sun: SunIcon }
function Avatar({ value, large = false }: { value: ProfileAvatar; large?: boolean }) {
  const Icon = avatarIcons[value]
  return <span role="img" aria-label={"Biểu tượng minh họa: " + AVATAR_LABELS[value]} className={"staff-profile-demo-avatar staff-profile-demo-avatar-" + value + (large ? " staff-profile-demo-avatar-large" : "")}><Icon aria-hidden="true" /></span>
}
/** Identity is used only to mount a private ephemeral adapter. It never seeds fictional fields. */
export function StaffProfileDemo({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const auth = useStaffAuth()
  if (!enabled || process.env.NODE_ENV !== "development" || !auth || auth.status !== "authenticated" || !auth.session || auth.busy === "logout" || auth.session.user.id !== accountScope) return null
  return <BoundProfileDemo key={accountScope} enabled={enabled} accountScope={accountScope} />
}
function BoundProfileDemo({ enabled, accountScope }: { enabled: boolean; accountScope: string }) {
  const adapter = useMemo(() => createProfileDemoAdapter({ enabled, accountScope }), [enabled, accountScope])
  return adapter.kind === "unavailable" ? null : <ProfileDemoPanel adapter={adapter} />
}
function DateValue({ value }: { value: string }) {
  return value ? <time dateTime={value}>{value.slice(8, 10) + "/" + value.slice(5, 7) + "/" + value.slice(0, 4)}</time> : <span>Không có thời hạn</span>
}
function DataField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children || "Chưa có thông tin minh họa"}</dd></div>
}
function ProfileView({ profile }: { profile: ProfileDemoData }) {
  return <div className="staff-profile-demo-view">
    <div className="staff-profile-demo-person"><Avatar value={profile.avatar} large /><div><p className="staff-profile-demo-eyebrow">Hồ sơ minh họa</p><h3 data-profile-demo-name>{profile.fullName}</h3><p>{profile.jobTitle}</p><span className="staff-profile-demo-chip">Chỉ dùng cho trải nghiệm giao diện</span></div></div>
    {profile.bio && <p className="staff-profile-demo-bio">{profile.bio}</p>}
    <section aria-label="Liên hệ minh họa"><h3><UserRoundIcon aria-hidden="true" />Thông tin liên hệ</h3><dl className="staff-profile-demo-details"><DataField label="Số liên hệ">{profile.phone}</DataField><DataField label="Email">{profile.email}</DataField><DataField label="Địa chỉ">{profile.address}</DataField></dl></section>
    <section aria-label="Công việc minh họa"><h3><BriefcaseBusinessIcon aria-hidden="true" />Thông tin nghề nghiệp</h3><dl className="staff-profile-demo-details"><DataField label="Chi nhánh">{profile.branch}</DataField><DataField label="Chức danh">{profile.jobTitle}</DataField><DataField label="Loại hình">{EMPLOYMENT_LABELS[profile.employmentType]}</DataField><DataField label="Kinh nghiệm">{profile.experienceYears + " năm (minh họa)"}</DataField><DataField label="Ngày bắt đầu"><DateValue value={profile.startedOn} /></DataField></dl></section>
    <section aria-label="Kỹ năng minh họa"><h3><CheckIcon aria-hidden="true" />Kỹ năng</h3>{profile.skills.length ? <ul className="staff-profile-demo-skills">{profile.skills.map(skill => <li key={skill}>{SKILL_LABELS[skill]}</li>)}</ul> : <p className="staff-profile-demo-empty">Chưa chọn kỹ năng minh họa.</p>}</section>
    <section aria-label="Chứng chỉ minh họa"><h3><AwardIcon aria-hidden="true" />Chứng chỉ</h3><p className="staff-profile-demo-caption">Các chứng chỉ giả lập chưa được xác minh và không có giá trị chứng nhận.</p>{profile.certificates.length ? <ul className="staff-profile-demo-certificates">{profile.certificates.map(item => <li key={item.id}><AwardIcon aria-hidden="true" /><div><h4>{item.title}</h4><p>{item.issuer}</p><p>Cấp ngày <DateValue value={item.issuedOn} /> · {item.expiresOn ? <>Hết hạn <DateValue value={item.expiresOn} /></> : "Không có thời hạn"}</p><span className="staff-profile-demo-chip">Chứng chỉ minh họa</span></div></li>)}</ul> : <p className="staff-profile-demo-empty">Chưa có chứng chỉ minh họa.</p>}</section>
  </div>
}
const errorId = (name: string) => "staff-profile-demo-error-" + name.replaceAll(".", "-")
function ErrorText({ name, errors }: { name: string; errors: ProfileErrors }) {
  return errors[name] ? <p className="staff-profile-demo-field-error" id={errorId(name)}>{errors[name]}</p> : null
}
type PanelBusy = "read" | "save" | "reset" | null
function ProfileDemoPanel({ adapter }: { adapter: ProfileDemoAdapter }) {
  const [profile, setProfile] = useState<ProfileDemoData | null>(null), [draft, setDraft] = useState<ProfileDemoData | null>(null)
  const [errors, setErrors] = useState<ProfileErrors>({}), [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState<PanelBusy>("read"), [reload, setReload] = useState(0)
  const form = useRef<HTMLFormElement>(null), editButton = useRef<HTMLButtonElement>(null), operation = useRef<AbortController | null>(null), mutation = useRef(false), nextCertificate = useRef(0)
  const isDemo = adapter.kind === "demo"
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller
    setBusy("read"); setError(""); setProfile(null); setDraft(null)
    void adapter.read(controller.signal).then(value => { if (!controller.signal.aborted) setProfile(value) }).catch(() => { if (!controller.signal.aborted) setError("Chưa thể mở hồ sơ minh họa. Vui lòng thử lại.") }).finally(() => { if (!controller.signal.aborted) setBusy(null) })
    return () => { controller.abort(); operation.current?.abort(); mutation.current = false }
  }, [adapter, reload])
  useEffect(() => {
    if (Object.keys(errors).length) {
      const input = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (input) input.focus()
      else form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus()
    }
  }, [errors])
  const focusEdit = () => window.setTimeout(() => editButton.current?.focus(), 0)
  function edit() { if (profile && !busy) { setDraft(cloneProfileDemo(profile)); setErrors({}); setError(""); setNotice("") } }
  function cancel() { if (busy) return; setDraft(null); setErrors({}); setError(""); setNotice("Đã hủy thay đổi bản minh họa."); focusEdit() }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || mutation.current) return
    const invalid = validateProfileDemo(draft); setErrors(invalid)
    if (Object.keys(invalid).length) return
    mutation.current = true; const controller = new AbortController(); operation.current = controller; setBusy("save"); setError(""); setNotice("")
    try {
      const value = await adapter.save(draft, controller.signal)
      if (controller.signal.aborted) return
      setProfile(value); setDraft(null); setErrors({}); setNotice(isDemo ? "Đã lưu bản minh họa tạm thời. Chưa cập nhật hồ sơ thật." : "Đã lưu hồ sơ."); focusEdit()
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof ProfileDemoValidationError) setErrors(reason.errors)
      else setError("Chưa thể lưu bản minh họa. Dữ liệu cũ được giữ nguyên; vui lòng thử lại.")
    } finally { if (!controller.signal.aborted) { mutation.current = false; setBusy(null) } }
  }
  async function reset() {
    if (mutation.current || busy) return
    mutation.current = true; const controller = new AbortController(); operation.current = controller; setBusy("reset"); setError(""); setNotice("")
    try {
      const value = await adapter.reset(controller.signal)
      if (controller.signal.aborted) return
      setProfile(value); setDraft(null); setErrors({}); setNotice("Đã đặt lại hồ sơ minh họa. Tài khoản thật không thay đổi."); focusEdit()
    } catch { if (!controller.signal.aborted) setError("Chưa thể đặt lại hồ sơ minh họa. Vui lòng thử lại.") }
    finally { if (!controller.signal.aborted) { mutation.current = false; setBusy(null) } }
  }
  function setField<K extends keyof ProfileDemoData>(name: K, value: ProfileDemoData[K]) { setDraft(current => current ? { ...current, [name]: value } : current); setErrors(current => ({ ...current, [name]: "" })) }
  function certificate(index: number, field: "title" | "issuer" | "issuedOn" | "expiresOn", value: string) {
    setDraft(current => current ? { ...current, certificates: current.certificates.map((item, i) => i === index ? { ...item, [field]: value } : item) } : current)
    setErrors(current => ({ ...current, ["certificates." + index + "." + field]: "" }))
  }
  function textField(name: "fullName" | "phone" | "email" | "address" | "branch" | "jobTitle" | "experienceYears" | "startedOn", label: string, type = "text", maxLength = 100) {
    if (!draft) return null
    const ids = { fullName: "name", jobTitle: "job-title", experienceYears: "experience", startedOn: "started", phone: "phone", email: "email", address: "address", branch: "branch" }
    return <div className="staff-profile-demo-field"><label htmlFor={"staff-profile-demo-" + ids[name]}>{label}</label><input id={"staff-profile-demo-" + ids[name]} name={name} type={type} value={draft[name]} maxLength={maxLength} {...(type === "date" ? { min: "1971-01-01", max: "2099-12-31" } : type === "number" ? { min: 0, max: 50, step: 1 } : {})} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? errorId(name) : undefined} onChange={event => setField(name, event.target.value)} /><ErrorText name={name} errors={errors} /></div>
  }
  return <Card className="staff-profile-demo" data-profile-demo={busy === "read" ? "loading" : draft ? "edit" : error && !profile ? "error" : "view"}><CardContent>
    <header className="staff-profile-demo-heading"><div><p className="staff-profile-demo-eyebrow">Trải nghiệm hồ sơ</p><h2>Hồ sơ nhân viên {isDemo ? "DEMO" : ""}</h2></div>{!draft && profile && <Button ref={editButton} variant="outline" disabled={!!busy} onClick={edit} aria-label="Chỉnh sửa hồ sơ minh họa"><PencilIcon aria-hidden="true" />Chỉnh sửa</Button>}</header>
    {isDemo && <div className="staff-profile-demo-notice" role="note"><InfoIcon aria-hidden="true" /><div><strong>DỮ LIỆU MINH HỌA</strong><p>Hồ sơ hoàn toàn giả lập, tách khỏi thông tin tài khoản thật. Không nhập thông tin cá nhân nhạy cảm.</p><p>Chỉ lưu tạm khi đang mở trang; F5, rời trang hoặc đăng xuất sẽ đặt lại. Mỗi tài khoản có trạng thái minh họa riêng.</p></div></div>}
    {notice && <p className="staff-profile-demo-feedback" role="status" aria-live="polite">{notice}</p>}
    {error && <div className="staff-profile-demo-error" role="alert"><p>{error}</p>{!profile && <Button variant="outline" onClick={() => setReload(value => value + 1)}>Thử tải lại</Button>}</div>}
    {busy === "read" ? <p role="status" aria-busy="true" className="staff-profile-demo-empty">Đang tải bản minh họa...</p> : draft ? <form ref={form} noValidate onSubmit={event => void save(event)} aria-label="Chỉnh sửa hồ sơ minh họa">
      <p className="staff-profile-demo-caption">Chỉ sửa bản minh họa bên dưới. Mã tài khoản, vai trò và trạng thái Auth ở phía trên luôn chỉ đọc.</p>
      {Object.values(errors).some(Boolean) && <div role="alert" tabIndex={-1} className="staff-profile-demo-error"><strong>Vui lòng kiểm tra thông tin đã nhập.</strong>{errors._form && <p>{errors._form}</p>}</div>}
      <fieldset disabled={!!busy} className="staff-profile-demo-form-fields">
        <legend className="sr-only">Thông tin minh họa có thể chỉnh sửa</legend>
        <fieldset className="staff-profile-demo-avatar-picker"><legend>Avatar minh họa</legend><p>Chọn biểu tượng có sẵn; không tải ảnh hoặc gửi ảnh lên máy chủ.</p><div>{PROFILE_AVATARS.map(value => <button key={value} type="button" aria-label={"Avatar minh họa: " + AVATAR_LABELS[value]} aria-pressed={draft.avatar === value} onClick={() => setField("avatar", value)}><Avatar value={value} /><span>{AVATAR_LABELS[value]}</span></button>)}</div><ErrorText name="avatar" errors={errors} /></fieldset>
        <div className="staff-profile-demo-form-grid">{textField("fullName", "Họ tên minh họa", "text", 80)}{textField("phone", "Số liên hệ minh họa", "tel", 30)}{textField("email", "Email minh họa", "email", 120)}{textField("address", "Địa chỉ minh họa", "text", 240)}{textField("branch", "Chi nhánh minh họa")}{textField("jobTitle", "Chức danh minh họa")}<div className="staff-profile-demo-field"><label htmlFor="staff-profile-demo-employment-type">Loại hình công việc minh họa</label><select id="staff-profile-demo-employment-type" value={draft.employmentType} onChange={event => setField("employmentType", event.target.value as ProfileDemoData["employmentType"])} aria-invalid={!!errors.employmentType} aria-describedby={errors.employmentType ? errorId("employmentType") : undefined}>{Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ErrorText name="employmentType" errors={errors} /></div>{textField("experienceYears", "Kinh nghiệm minh họa (năm)", "number")}{textField("startedOn", "Ngày bắt đầu minh họa", "date")}</div>
        <div className="staff-profile-demo-field"><label htmlFor="staff-profile-demo-bio">Giới thiệu minh họa</label><textarea id="staff-profile-demo-bio" rows={3} maxLength={500} value={draft.bio} onChange={event => setField("bio", event.target.value)} aria-invalid={!!errors.bio} aria-describedby={errors.bio ? errorId("bio") : undefined} /><ErrorText name="bio" errors={errors} /></div>
        <fieldset className="staff-profile-demo-skill-picker"><legend>Kỹ năng minh họa</legend><div>{PROFILE_SKILLS.map(value => <label key={value} htmlFor={"staff-profile-demo-skill-" + value}><input id={"staff-profile-demo-skill-" + value} type="checkbox" checked={draft.skills.includes(value)} onChange={event => setField("skills", event.target.checked ? [...draft.skills, value] : draft.skills.filter(skill => skill !== value))} /><span>{SKILL_LABELS[value]}</span></label>)}</div><ErrorText name="skills" errors={errors} /></fieldset>
        <fieldset className="staff-profile-demo-certificate-editor"><legend>Chứng chỉ minh họa</legend><p className="staff-profile-demo-caption">Tối đa 5 chứng chỉ giả lập. Bỏ trống ngày hết hạn nếu không có thời hạn.</p><ErrorText name="certificates" errors={errors} />{draft.certificates.map((item, index) => <fieldset className="staff-profile-demo-certificate-fields" key={item.id}><legend>Chứng chỉ {index + 1}</legend><div className="staff-profile-demo-form-grid">{(["title", "issuer", "issuedOn", "expiresOn"] as const).map(field => { const name = "certificates." + index + "." + field, label = { title: "Tên chứng chỉ", issuer: "Nơi cấp minh họa", issuedOn: "Ngày cấp", expiresOn: "Ngày hết hạn" }[field]; return <div className="staff-profile-demo-field" key={field}><label htmlFor={"staff-profile-demo-certificate-" + index + "-" + field}>{label}</label><input id={"staff-profile-demo-certificate-" + index + "-" + field} type={field.endsWith("On") ? "date" : "text"} maxLength={100} min={field.endsWith("On") ? "1971-01-01" : undefined} max={field.endsWith("On") ? "2099-12-31" : undefined} value={item[field]} onChange={event => certificate(index, field, event.target.value)} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? errorId(name) : undefined} /><ErrorText name={name} errors={errors} /></div> })}</div><Button type="button" variant="outline" aria-label={"Xóa chứng chỉ minh họa " + (index + 1)} onClick={() => { setField("certificates", draft.certificates.filter((_, i) => i !== index)); setErrors({}) }}><Trash2Icon aria-hidden="true" />Xóa chứng chỉ</Button></fieldset>)}<Button type="button" variant="outline" disabled={draft.certificates.length >= 5} aria-label="Thêm chứng chỉ minh họa" onClick={() => setField("certificates", [...draft.certificates, { id: "DEMO-CERT-NEW-" + (++nextCertificate.current), title: "", issuer: "", issuedOn: "", expiresOn: "" }])}><PlusIcon aria-hidden="true" />Thêm chứng chỉ</Button></fieldset>
      </fieldset>
      <div className="staff-profile-demo-actions"><Button type="submit" disabled={!!busy} aria-label="Lưu hồ sơ minh họa"><SaveIcon aria-hidden="true" />{busy === "save" ? "Đang lưu..." : "Lưu bản minh họa"}</Button><Button type="button" variant="outline" disabled={!!busy} onClick={cancel} aria-label="Hủy chỉnh sửa hồ sơ minh họa"><XIcon aria-hidden="true" />Hủy chỉnh sửa</Button></div>
    </form> : profile ? <ProfileView profile={profile} /> : !error && <p className="staff-profile-demo-empty">Chưa có bản hồ sơ minh họa. Đặt lại để tạo bộ minh họa ban đầu.</p>}
    {isDemo && busy !== "read" && <footer className="staff-profile-demo-footer"><p>Đặt lại chỉ tác động bản minh họa đang mở, không thay đổi tài khoản hoặc hồ sơ thật.</p><Button type="button" variant="outline" disabled={!!busy} onClick={() => void reset()} aria-label="Đặt lại hồ sơ minh họa"><RotateCcwIcon aria-hidden="true" />{busy === "reset" ? "Đang đặt lại..." : "Đặt lại minh họa"}</Button></footer>}
  </CardContent></Card>
}
