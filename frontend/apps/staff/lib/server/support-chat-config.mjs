import { loadStaffAuthConfig } from './config.mjs'
import { STAFF_SUPPORT_POLICY } from '../../../../packages/ui/src/components/staff/staff-support-questions.mjs'
import { SUPPORT_CHAT_ENDPOINTS } from './support-chat-provider.mjs'
import { STAFF_CONVERSATION_POLICY, STAFF_CONVERSATION_LIMITS } from '../../../../packages/ui/src/components/staff/staff-support-conversation.mjs'

/** The extended limit is deliberately unavailable in production or a non-local deployment. */
function conversationTurnLimit(env, appOrigin) {
  let local = false
  try { const url = new URL(appOrigin); local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) } catch {}
  return env.NODE_ENV === 'development' && local && env.STAFF_SUPPORT_AI_QA_ISOLATED === 'true' && env.STAFF_SUPPORT_AI_QA_MAX_TURNS === '30' ? 30 : STAFF_CONVERSATION_LIMITS.turns
}

/** All credentials stay in the Node BFF. Disabled until an operator approves the policy. */
export function loadStaffSupportChatConfig(env = process.env, cwd = process.cwd()) {
  const auth = loadStaffAuthConfig(env, cwd)
  let chat = null
  if (env.STAFF_SUPPORT_AI_ENABLED === 'true' && env.STAFF_SUPPORT_AI_POLICY_VERSION === STAFF_SUPPORT_POLICY) {
    let endpoint
    try { endpoint = new URL(env.STAFF_SUPPORT_AI_ENDPOINT) } catch { return { ...auth, chat } }
    const apiKey = env.STAFF_SUPPORT_AI_API_KEY
    const timeout = env.STAFF_SUPPORT_AI_TIMEOUT_MS || '10000'
    const provider = env.STAFF_SUPPORT_AI_PROVIDER || 'gateway'
    const model = env.STAFF_SUPPORT_AI_MODEL
    const maxOutputTokens = env.STAFF_SUPPORT_AI_MAX_OUTPUT_TOKENS || '512'
    if (endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search
      && typeof apiKey === 'string' && apiKey.length >= 16 && apiKey.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(apiKey)
      && /^\d+$/.test(timeout) && Number(timeout) >= 100 && Number(timeout) <= 15000
      && ['gateway', 'openai-compatible'].includes(provider)
      && (provider !== 'openai-compatible' || Object.values(SUPPORT_CHAT_ENDPOINTS).includes(endpoint.toString()))
      && (endpoint.toString() !== SUPPORT_CHAT_ENDPOINTS.groq || provider === 'openai-compatible' && model === 'openai/gpt-oss-20b')
      && (provider === 'gateway' || typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model))
      && /^\d+$/.test(maxOutputTokens) && Number(maxOutputTokens) >= 64 && Number(maxOutputTokens) <= 2048) {
      chat = Object.freeze({ provider, endpoint: endpoint.toString(), apiKey, timeoutMs: Number(timeout), policyVersion: STAFF_SUPPORT_POLICY,
        ...(provider === 'openai-compatible' ? { model, maxOutputTokens: Number(maxOutputTokens) } : {}),
        freeText: provider === 'openai-compatible' && env.STAFF_SUPPORT_AI_FREE_TEXT_ENABLED === 'true' && env.STAFF_SUPPORT_AI_FREE_TEXT_POLICY_VERSION === STAFF_CONVERSATION_POLICY,
        maxTurns: conversationTurnLimit(env, auth.appOrigin) })
    }
  }
  return Object.freeze({ ...auth, chat })
}
