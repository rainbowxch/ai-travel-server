import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { config } from './config.js'
import { initDb, getMessages, deleteUserMessages } from './db.js'
import { getOrCreateSession, addMessage, buildChatHistory, deleteSession } from './session.js'
import { runAgent } from './agent.js'
import { itineraryResult } from './tools/itinerary.js'
import { authRouter } from './auth.js'
import type { ChatResponse, AgentStep } from './types.js'

export const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

/* ── Auth ── */

app.route('/api/auth', authRouter)

/* ── Get history ── */

app.get('/api/history/:userId', async (c) => {
  const { userId } = c.req.param()
  const dbMessages = getMessages(userId)
  const messages = dbMessages.map(m => ({
    role: m.role,
    content: m.content,
    ts: m.created_at,
    itinerary: m.itinerary_json ? JSON.parse(m.itinerary_json) as Record<string, unknown> : null,
  }))
  return c.json({ userId, messages })
})

/* ── Chat ── */

app.post('/api/chat', async (c) => {
  const { message, userId } = await c.req.json<{ message: string; userId?: string }>()
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message 字段必填' }, 400)
  }
  if (!userId) {
    return c.json({ error: 'userId 必填，请先登录' }, 401)
  }

  getOrCreateSession(userId)
  addMessage(userId, 'human', message)
  const chatHistory = await buildChatHistory(userId)

  const { response, steps } = await runAgent(message, chatHistory)

  let resp: ChatResponse
  if (itineraryResult.data) {
    resp = {
      type: 'itinerary',
      content: null,
      itinerary: itineraryResult.data,
      steps,
    }
    const it = itineraryResult.data
    addMessage(userId, 'ai', `[行程: ${it.meta.city} ${it.meta.days}天 预算¥${it.meta.budgetTotal} · ${it.meta.summary}]`, it as unknown as Record<string, unknown>)
  } else {
    resp = {
      type: 'text',
      content: response,
      itinerary: null,
      steps,
    }
    addMessage(userId, 'ai', response)
  }

  return c.json(resp)
})

/* ── Chat with SSE streaming ── */

app.post('/api/chat/stream', async (c) => {
  const { message, userId } = await c.req.json<{ message: string; userId?: string }>()
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message 字段必填' }, 400)
  }
  if (!userId) {
    return c.json({ error: 'userId 必填，请先登录' }, 401)
  }

  getOrCreateSession(userId)
  addMessage(userId, 'human', message)

  return streamSSE(c, async (sseStream) => {
    const chatHistory = await buildChatHistory(userId)

    try {
      const abort = new AbortController()

      const { response, steps } = await runAgent(message, chatHistory, (tool, status, data) => {
        sseStream.writeSSE({
          event: 'step',
          data: JSON.stringify({ tool, status, data }),
        }).catch(() => {})
      }, abort)

      let resp: ChatResponse
      if (itineraryResult.data) {
        resp = {
          type: 'itinerary',
          content: null,
          itinerary: itineraryResult.data,
          steps,
        }
        const it = itineraryResult.data
        addMessage(userId, 'ai', `[行程: ${it.meta.city} ${it.meta.days}天 预算¥${it.meta.budgetTotal} · ${it.meta.summary}]`, it as unknown as Record<string, unknown>)
      } else {
        resp = {
          type: 'text',
          content: response,
          itinerary: null,
          steps,
        }
        addMessage(userId, 'ai', response)
      }

      await sseStream.writeSSE({
        event: 'result',
        data: JSON.stringify(resp),
      })
    } catch (err: any) {
      // Agent aborted early after generate_itinerary — still send result
      if (itineraryResult.data) {
        const it = itineraryResult.data
        addMessage(userId, 'ai', `[行程: ${it.meta.city} ${it.meta.days}天 预算¥${it.meta.budgetTotal} · ${it.meta.summary}]`, it as unknown as Record<string, unknown>)
        await sseStream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            type: 'itinerary',
            content: null,
            itinerary: it,
            steps: [],
          }),
        })
        return
      }
      const errMsg = err?.message ?? '未知错误'
      await sseStream.writeSSE({
        event: 'result',
        data: JSON.stringify({ type: 'error', content: errMsg, itinerary: null, steps: [] }),
      })
    }
  })
})

/* ── Reset conversation ── */

app.post('/api/reset/:userId', async (c) => {
  const { userId } = c.req.param()
  deleteSession(userId)
  deleteUserMessages(userId)
  return c.json({ ok: true })
})

/* ── Health ── */

app.get('/api/health', (c) => c.json({ status: 'ok', model: config.model }))
