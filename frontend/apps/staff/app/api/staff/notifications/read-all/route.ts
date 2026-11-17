import { handleStaffNotifications } from "../../../../../lib/server/notifications-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function PATCH(request: Request) {
  return handleStaffNotifications(request)
}
