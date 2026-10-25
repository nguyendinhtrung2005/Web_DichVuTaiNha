import { HOUSE_TYPE_LABEL, TIME_SLOTS } from "@/lib/config"
import { estimateDuration, estimatePrice } from "@/lib/mock-data"
import type { HouseType, Service } from "@/lib/types"

export interface BookingValues {
  serviceId: string
  quantity: string
  name: string
  phone: string
  address: string
  houseType: HouseType
  area: string
  rooms: string
  floors: string
  hasPets: boolean
  date: string
  time: string
  specialRequest: string
}

export type BookingErrors = Partial<Record<keyof BookingValues, string>>

export function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function bookingDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TIME_SLOTS.includes(time)) return null
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  const value = new Date(year, month - 1, day, hour, minute, 0, 0)
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? value : null
}

export function bookingQuantity(values: BookingValues, service?: Service) {
  return Number(service?.unit === "m²" ? values.area : values.quantity)
}

export function validateBookingStep(step: number, values: BookingValues, service?: Service, now = new Date()): BookingErrors {
  const errors: BookingErrors = {}
  if (step === 0 || step === 3) {
    if (!service || service.status !== "active" || service.id !== values.serviceId) errors.serviceId = "Vui lòng chọn dịch vụ đang cung cấp."
    if (service?.unit !== "m²") {
      const quantity = Number(values.quantity)
      if (!values.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) errors.quantity = "Vui lòng nhập số lượng hợp lệ lớn hơn 0."
      else if (service && quantity < service.minQuantity) errors.quantity = `Số lượng tối thiểu là ${service.minQuantity} ${service.unit}.`
      else if (service && (!Number.isFinite(estimatePrice(service, quantity)) || !Number.isFinite(estimateDuration(service, quantity)))) errors.quantity = "Số lượng quá lớn để tính giá và thời lượng. Vui lòng nhập số lượng nhỏ hơn."
    }
  }
  if (step === 1 || step === 3) {
    const residential = service?.category === "ve-sinh-nha-o" || service?.category === "ve-sinh-phong-tro"
    const areaRequired = residential || service?.unit === "m²"
    const name = values.name.trim()
    if (!name) errors.name = "Vui lòng nhập họ tên liên hệ."
    else if (name.length < 2 || name.length > 120) errors.name = "Họ tên cần từ 2 đến 120 ký tự."
    const phone = values.phone.trim()
    const digits = phone.replace(/[^0-9]/g, "")
    if (!phone) errors.phone = "Vui lòng nhập số điện thoại liên hệ."
    else if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 9 || digits.length > 15 || phone.length > 20) errors.phone = "Số điện thoại cần từ 9 đến 15 chữ số."
    const address = values.address.trim()
    if (!address) errors.address = "Vui lòng nhập địa chỉ thực hiện dịch vụ."
    else if (address.length < 8 || address.length > 300) errors.address = "Địa chỉ cần từ 8 đến 300 ký tự, gồm số nhà và đường hoặc khu vực."
    if (!Object.prototype.hasOwnProperty.call(HOUSE_TYPE_LABEL, values.houseType)) errors.houseType = "Vui lòng chọn loại nhà hợp lệ."
    for (const [key, label] of [["area", "Diện tích"], ["rooms", "Số phòng"], ["floors", "Số tầng"]] as const) {
      if ((key === "area" && !areaRequired) || (key !== "area" && !residential)) continue
      const value = Number(values[key])
      if (!values[key].trim() || !Number.isFinite(value) || value <= 0 || (key !== "area" && !Number.isInteger(value))) errors[key] = `${label} cần là ${key === "area" ? "số" : "số nguyên"} lớn hơn 0.`
      else if (key === "area" && service?.unit === "m²" && value < service.minQuantity) errors.area = `Diện tích tối thiểu là ${service.minQuantity} m².`
      else if (key === "area" && service?.unit === "m²" && (!Number.isFinite(estimatePrice(service, value)) || !Number.isFinite(estimateDuration(service, value)))) errors.area = "Diện tích quá lớn để tính giá và thời lượng. Vui lòng nhập diện tích nhỏ hơn."
    }
  }
  if (step === 2 || step === 3) {
    if (!values.date) errors.date = "Vui lòng chọn ngày mong muốn."
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors.date = "Ngày đã chọn không hợp lệ."
    if (!values.time) errors.time = "Vui lòng chọn giờ mong muốn."
    else if (!TIME_SLOTS.includes(values.time)) errors.time = "Vui lòng chọn một giờ trong danh sách."
    if (values.date && values.time && !errors.date && !errors.time) {
      const scheduled = bookingDateTime(values.date, values.time)
      if (!scheduled) errors.date = "Ngày đã chọn không hợp lệ."
      else if (scheduled.getTime() <= now.getTime()) errors.time = "Vui lòng chọn ngày và giờ trong tương lai."
    }
    if (values.specialRequest.length > 1000) errors.specialRequest = "Ghi chú tối đa 1.000 ký tự."
  }
  return errors
}

export function firstInvalidBookingStep(errors: BookingErrors) {
  if (errors.serviceId || errors.quantity) return 0
  if (errors.name || errors.phone || errors.address || errors.houseType || errors.area || errors.rooms || errors.floors) return 1
  return 2
}
