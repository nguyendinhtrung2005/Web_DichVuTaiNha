import { handleStaffAuth } from "../../../../lib/server/auth-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return handleStaffAuth(request, "session")
}
