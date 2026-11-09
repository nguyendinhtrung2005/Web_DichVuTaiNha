const timeZone = 'Asia/Ho_Chi_Minh'
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function customerDay(value: Date = new Date()) {
  const parts = dayFormatter.formatToParts(value)
  const read = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

export const customerDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? date.toString() : dateFormatter.format(date)
}
