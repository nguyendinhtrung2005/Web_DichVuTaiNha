"use client"
import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { STAFF_PROFILE_FIELDS, parseEditableStaffProfile, staffProfileDraft, staffProfileSaveError, validateStaffProfileDraft, type StaffEditableProfile, type StaffProfileDraft, type StaffProfileField } from "./staff-profile-edit-model"

type Props = {
  accountId: string
  profile?: StaffEditableProfile | null
  editableFields?: readonly StaffProfileField[]
  /** Only wire after Auth's GET/PATCH/verification contract is approved and available. */
  onSave?: (changes: Partial<StaffProfileDraft>, revision: string) => Promise<unknown>
  onCancel: () => void
}
export function StaffProfileEditor(props: Props) { return <ProfileForm key={props.accountId} {...props} /> }
function ProfileForm({ accountId, profile = null, editableFields = [], onSave, onCancel }: Props) {
  const [own, setOwn] = useState(() => parseEditableStaffProfile(profile, accountId))
  const supported = !!own && editableFields.length > 0 && editableFields.every(field => STAFF_PROFILE_FIELDS.includes(field)) && !!onSave
  const [draft, setDraft] = useState(() => staffProfileDraft(own)), [errors, setErrors] = useState<Partial<Record<StaffProfileField, string>>>({})
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [saved, setSaved] = useState(false)
  const mutex = useRef(false), id = useId()
  const fields = [["fullName", "Họ và tên", "text", "name"], ["phone", "Số điện thoại", "tel", "tel"], ["email", "Email", "email", "email"]] as const
  return <form noValidate aria-describedby={!supported ? `${id}-unavailable` : undefined} onSubmit={async event => {
    event.preventDefault()
    if (!supported || !own || !onSave || mutex.current) return
    const checked = validateStaffProfileDraft(draft, editableFields); setErrors(checked.errors); setMessage(""); setSaved(false)
    if (!checked.valid) return
    mutex.current = true; setSaving(true)
    try {
      const result = parseEditableStaffProfile(await onSave(checked.changes, own.revision), accountId)
      if (!result) throw Error("PROFILE_RESPONSE_INVALID")
      setOwn(result); setDraft(staffProfileDraft(result)); setSaved(true); setMessage("Đã lưu thay đổi.")
    } catch (error) { setSaved(false); setMessage(staffProfileSaveError(error)) }
    finally { mutex.current = false; setSaving(false) }
  }}>
    {!supported && <p id={`${id}-unavailable`} role="note">Chưa thể cập nhật hồ sơ. Vui lòng liên hệ người quản lý.</p>}
    <fieldset disabled={!supported || saving} className="staff-account-form">{fields.map(([key, label, type, autoComplete]) => <label key={key} htmlFor={`${id}-${key}`}>{label}<input id={`${id}-${key}`} name={`profile-${key}`} type={type} autoComplete={autoComplete} maxLength={key === "fullName" ? 100 : key === "phone" ? 20 : 254} value={draft[key]} disabled={!editableFields.includes(key)} placeholder="Chưa được cung cấp" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined} onChange={event => { setDraft(value => ({ ...value, [key]: event.target.value })); setSaved(false); setMessage("") }} />{errors[key] && <span id={`${id}-${key}-error`} role="alert">{errors[key]}</span>}</label>)}</fieldset>
    {message && <p role={saved ? "status" : "alert"} aria-live="polite">{message}</p>}
    <div className="staff-account-actions"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Hủy</Button><Button disabled={!supported || saving} type="submit" data-staff-settings-profile-save>{saving ? "Đang lưu..." : "Lưu thay đổi"}</Button></div>
  </form>
}
