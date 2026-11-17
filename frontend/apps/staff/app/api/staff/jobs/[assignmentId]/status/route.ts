import { handleStaffStatus } from '../../../../../../lib/server/status-http.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = handleStaffStatus
export const PATCH = handleStaffStatus
export const POST = handleStaffStatus
export const PUT = handleStaffStatus
export const DELETE = handleStaffStatus
