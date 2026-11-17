import { handleStaffJobs } from "../../../../lib/server/jobs-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffJobs(request)
}
