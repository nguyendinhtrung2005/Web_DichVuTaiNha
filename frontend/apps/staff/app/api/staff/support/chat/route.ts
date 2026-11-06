import { handleStaffSupportChat } from "../../../../../lib/server/support-chat-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => handleStaffSupportChat(request)
export const POST = (request: Request) => handleStaffSupportChat(request)
export const DELETE = (request: Request) => handleStaffSupportChat(request)
