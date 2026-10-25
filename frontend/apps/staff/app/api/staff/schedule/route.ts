import { handleStaffSchedule } from "../../../../lib/server/schedule-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffSchedule(request)
}
