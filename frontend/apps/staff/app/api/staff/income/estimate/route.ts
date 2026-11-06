import { handleStaffIncome } from "../../../../../lib/server/income-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffIncome(request)
}
