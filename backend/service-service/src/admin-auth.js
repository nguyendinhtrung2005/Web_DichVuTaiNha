const { cookieValue, createSessionAuth } = require("../../shared/session-auth")

function createAdminAuth(options) {
  return createSessionAuth({ ...options, requiredRole: "ADMIN" })
}

module.exports = { cookieValue, createAdminAuth }
