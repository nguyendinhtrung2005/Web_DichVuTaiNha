import { cookieValue, createSessionAuth } from "../../shared/session-auth.js";

function createAdminAuth(options) {
  return createSessionAuth({ ...options, requiredRole: "ADMIN" })
}

export { cookieValue, createAdminAuth };
