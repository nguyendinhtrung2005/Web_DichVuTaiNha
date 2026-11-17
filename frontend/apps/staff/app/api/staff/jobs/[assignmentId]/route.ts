import { handleStaffJobDetail } from "../../../../../lib/server/job-detail-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffJobDetail(request)
}
