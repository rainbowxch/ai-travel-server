import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { config } from './config.js'
import { getOrCreateSession, buildChatHistory, updateSession, deleteSession } from './session.js'
import { runAgent } from './agent.js'
import { itineraryResult } from './tools/itinerary.js'
import type { ChatResponse, AgentStep } from './types.js'

const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

/* ── Chat ── */

app.post('/api/chat', async (c) => {
  const { message, sessionId } = await c.req.json<{ message: string; sessionId?: string }>()
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message 字段必填' }, 400)
  }

  const sid = sessionId || `session_${Date.now()}`
  const session = getOrCreateSession(sid)

  // Save user message
  session.messages.push({ role: 'human', content: message, ts: Date.now() })
  updateSession(sid)

  // Build chat history (with auto-compression if too long)
  const chatHistory = buildChatHistory(session)

  // Run agent
  const { response, steps } = await runAgent(message, chatHistory)

  // Check if generate_itinerary was called
  let resp: ChatResponse
  if (itineraryResult.data) {
    resp = {
      type: 'itinerary',
      content: null,
      itinerary: itineraryResult.data,
      steps,
    }
    // Save the itinerary summary to history rather than the raw JSON
    const it = itineraryResult.data
    session.messages.push({
      role: 'ai',
      content: `[行程: ${it.meta.city} ${it.meta.days}天 预算¥${it.meta.budgetTotal} · ${it.meta.summary}]`,
      ts: Date.now(),
    })
  } else {
    resp = {
      type: 'text',
      content: response,
      itinerary: null,
      steps,
    }
    session.messages.push({ role: 'ai', content: response, ts: Date.now() })
  }

  updateSession(sid)

  return c.json({ ...resp, sessionId: sid })
})

/* ── Reset conversation ── */

app.post('/api/reset/:sessionId', async (c) => {
  const { sessionId } = c.req.param()
  deleteSession(sessionId)
  return c.json({ ok: true })
})

/* ── Health ── */

app.get('/api/health', (c) => c.json({ status: 'ok', model: config.model }))

/* ── Start ── */

if (!config.baseUrl) throw new Error('缺少环境变量 AI_BASE_URL')
if (!config.apiKey) throw new Error('缺少环境变量 AI_API_KEY')

console.log(`[server] starting on port ${config.port}`)
console.log(`[server] model: ${config.model}`)
console.log(`[server] baseUrl: ${config.baseUrl}`)

serve({ fetch: app.fetch, port: config.port })
