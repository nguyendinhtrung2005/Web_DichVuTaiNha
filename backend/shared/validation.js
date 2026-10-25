const { HttpError } = require("./http")

function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(" ")
    throw new HttpError(400, "VALIDATION_ERROR", message || "Dữ liệu gửi lên không hợp lệ.")
  }
  return result.data
}

function numericId(value, label = "Mã định danh") {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "INVALID_ID", `${label} không hợp lệ.`)
  return id
}

module.exports = { parse, numericId }
