import { handleStaffAreas } from "../../../../lib/server/areas-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffAreas(request)
}
