import { STAFF_USAGE_HELP } from "./staff-support-questions.mjs"

export type StaffSupportQuestion = { id: string; question: string; answer: string; href: string; label: string }
const questions = STAFF_USAGE_HELP as readonly StaffSupportQuestion[]
const keywords: Record<string, string> = {
  jobs: "công việc phân công nhiệm vụ đơn việc job danh sách",
  "job-steps": "nhận việc bắt đầu hoàn thành thực hiện làm việc check in check out",
  schedule: "lịch lịch làm việc ca làm đổi ca hủy ca đăng ký ca khả dụng ngày tuần calendar",
  income: "thu nhập tiền công tiền lương thanh toán chi trả thưởng phụ phí đối soát salary",
  account: "tài khoản cài đặt hồ sơ đăng xuất mật khẩu bảo mật account logout",
  contact: "liên hệ hỗ trợ sự cố hotline quản lý báo lỗi trợ giúp support",
}

/** Local search only. Typed input is never a provider prompt or persisted data. */
export function normalizeStaffSupportQuery(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
}
export function staffSupportSuggestions(value: string, limit = 5): StaffSupportQuestion[] {
  if (typeof value !== "string" || value.length > 160) return []
  const query = normalizeStaffSupportQuery(value)
  if (!query) return ["jobs", "schedule", "income", "account"].flatMap(id => questions.filter(question => question.id === id)).slice(0, limit)
  const tokens = query.split(" ")
  return questions.map((question, index) => {
    const title = normalizeStaffSupportQuery(question.question), aliases = normalizeStaffSupportQuery(keywords[question.id] || "")
    const words = `${title} ${aliases}`.split(" ")
    if (!tokens.every(token => words.some(word => word.startsWith(token)))) return { question, score: 0, index }
    const score = (title === query ? 1000 : title.includes(query) ? 300 : 0) + (aliases.includes(query) ? 150 : 0)
      + tokens.filter(token => title.split(" ").some(word => word.startsWith(token))).length * 20 + 1
    return { question, score, index }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(item => item.question)
}
export function staffSupportExactQuestion(value: string): StaffSupportQuestion | null {
  if (typeof value !== "string" || value.length > 160) return null
  const query = normalizeStaffSupportQuery(value)
  return questions.find(question => normalizeStaffSupportQuery(question.question) === query) || null
}
