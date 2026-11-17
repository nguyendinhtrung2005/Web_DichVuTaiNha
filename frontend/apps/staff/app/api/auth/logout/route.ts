import { handleStaffAuth } from "../../../../lib/server/auth-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return handleStaffAuth(request, "logout")
}
