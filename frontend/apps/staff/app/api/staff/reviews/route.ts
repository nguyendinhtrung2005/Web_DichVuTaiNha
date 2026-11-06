import { handleStaffReviews } from "../../../../lib/server/reviews-http.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return handleStaffReviews(request) }
