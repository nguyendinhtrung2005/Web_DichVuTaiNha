import { handleStaffJobs } from "../../../../../lib/server/jobs-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const GET = handleStaffJobs
