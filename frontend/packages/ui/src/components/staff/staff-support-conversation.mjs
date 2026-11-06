/** Public limits/validation only; no configuration, identity or provider credentials. */
export const STAFF_CONVERSATION_POLICY = 'general-conversation-v1'
export const STAFF_CONVERSATION_LIMITS = Object.freeze({ inputLength: 1000, inputBytes: 3000, turns: 10, contextPairs: 4, contextBytes: 6000, promptBytes: 12000, ttlMs: 15 * 60 * 1000 })
const folded = value => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()

export function supportSensitiveContent(value) {
  const text = folded(value)
  return /(?:\b(?:gsk_|sk-(?:proj-)?)[a-z0-9_-]{12,}|\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|-----begin .*private key|\bbearer\s+\S+|\b(?:cookie|authorization)\s*[:=])/i.test(text)
    || /\b(?:mat khau|password|otp|ma xac thuc|access.?token|refresh.?token|api.?key|secret|session.?key)\s*(?:la\b|is\b|[:=])\s*\S+/i.test(text)
    || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/|\b(?:\d[ ().+-]*){7,}|\b[a-z0-9_/-]{40,}\b/i.test(text)
    || /\b(?:toi ten la|ho ten|ten khach(?: hang)?|dia chi (?:nha|khach)|so dien thoai|cccd|cmnd|tai khoan ngan hang|ma don|ma booking|booking.?id|customer.?id)\s*(?:la\b|[:=])?\s+\S+/i.test(text)
    || /(?:^|\s)(?:Nguyễn|Trần|Lê|Phạm|Hoàng|Huỳnh|Phan|Vũ|Võ|Đặng|Bùi|Đỗ|Hồ|Ngô|Dương|Lý)\s+\p{Lu}\p{L}*(?:\s+\p{Lu}\p{L}*)*/u.test(value)
    || /\b(?:so\s+)?\d{1,5}\s+(?:duong|pho|ngach|hem|ngo|ap|thon|quan|phuong|xa|street|road)\b/i.test(text)
}
export function supportPromptOverride(value) {
  const text = folded(value)
  return /(?:ignore|disregard|override|forget)\s+(?:all\s+)?(?:previous|above|system|instructions|rules)|(?:bo qua|quen|vo hieu|ghi de)\s+(?:tat ca\s+)?(?:huong dan|chi dan|quy tac|lenh|he thong)|(?:reveal|print|show|hien thi|tiet lo)\s+(?:the\s+)?(?:system prompt|api key|secret|khoa bi mat)|<\/?(?:system|assistant|tool)>|\[\/?(?:inst|system)\]|\b(?:system|developer)\s*:/i.test(text)
}
export function validateSupportText(value) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'SUPPORT_MESSAGE_REQUIRED' }
  if (value.length > STAFF_CONVERSATION_LIMITS.inputLength || new TextEncoder().encode(value).length > STAFF_CONVERSATION_LIMITS.inputBytes) return { ok: false, code: 'SUPPORT_MESSAGE_TOO_LONG' }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/u.test(value)) return { ok: false, code: 'SUPPORT_MESSAGE_INVALID' }
  if (supportSensitiveContent(value)) return { ok: false, code: 'SUPPORT_SENSITIVE_CONTENT' }
  if (supportPromptOverride(value)) return { ok: false, code: 'SUPPORT_UNSAFE_INSTRUCTIONS' }
  return { ok: true, value: value.normalize('NFC').replace(/\r\n?/g, '\n').trim() }
}
