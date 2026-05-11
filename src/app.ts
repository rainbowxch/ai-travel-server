import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { streamSSE } from 'hono/streaming'
import { config } from './config.js'
import { initDb, getMessages, deleteUserMessages } from './db.js'
import { addMessage, buildChatHistory, deleteSession } from './session.js'
import { runAgent } from './agent.js'
import { itineraryResult } from './tools/itinerary.js'
import { authRouter } from './auth.js'
import { checkRequirements } from './requirements.js'
import { enrichItineraryImages } from './images.js'
import { addFavorite, getFavorites, removeFavorite } from './favorites.js'
import type { ChatResponse, AgentStep, Itinerary } from './types.js'
import {
  getTravelState, persistTravelState, deleteTravelState,
  getAskCount, incrementAskCount, resetAskCount,
  isItineraryExpired, suggestDefaults,
} from './travel-state.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
}))

/* ── Auth ── */

app.route('/api/auth', authRouter)

/* ── JWT auth middleware ── */

const requireAuth = jwt({ secret: config.jwtSecret, alg: 'HS256' })

/* ── Get history ── */

app.get('/api/history/:userId', requireAuth, async (c) => {
  const { userId } = c.req.param()
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) {
    return c.json({ error: '无权访问' }, 403)
  }
  const dbMessages = getMessages(userId)
  const messages = dbMessages.map(m => ({
    role: m.role,
    content: m.content,
    ts: m.created_at,
    itinerary: m.itinerary_json ? JSON.parse(m.itinerary_json) as Record<string, unknown> : null,
  }))
  return c.json({ userId, messages })
})

/* ── Chat with SSE streaming ── */

app.post('/api/chat/stream', requireAuth, async (c) => {
  const { message, userId } = await c.req.json<{ message: string; userId?: string }>()
  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message 字段必填' }, 400)
  }
  if (!userId) {
    return c.json({ error: 'userId 必填，请先登录' }, 401)
  }
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) {
    return c.json({ error: '无权操作' }, 403)
  }

  addMessage(userId, 'human', message)

  return streamSSE(c, async (sseStream) => {
    const chatHistory = await buildChatHistory(userId)

    // ── Phase 1: Load travel state & check expiry ──
    const travelState = getTravelState(userId)
    if (travelState.lastItinerary && isItineraryExpired(travelState.lastItinerary)) {
      const last = travelState.lastItinerary
      const lines: string[] = []
      if (travelState.historicalSummary) lines.push(travelState.historicalSummary)
      lines.push(`[历史行程] ${last.city}${last.days}天，预算¥${last.budgetTotal}，${last.summary}`)
      travelState.historicalSummary = lines.join('\n')
      travelState.lastItinerary = null
      persistTravelState(userId)
    }

    // Add historical context to chat history for the agent
    if (travelState.historicalSummary) {
      chatHistory.unshift({
        role: 'system',
        content: `[用户历史出行参考]\n${travelState.historicalSummary}\n（以上为历史记录，当前行程以用户最新需求为准）`,
      })
    }

    // ── Phase 2: Check requirements ──
    const reqCheck = await checkRequirements(chatHistory)
    if (!reqCheck.complete) {
      const askCount = getAskCount(userId)
      if (askCount < 2) {
        addMessage(userId, 'ai', reqCheck.question)
        incrementAskCount(userId)
        await sseStream.writeSSE({
          event: 'result',
          data: JSON.stringify({ type: 'text', content: reqCheck.question, itinerary: null, steps: [] }),
        })
        return
      }

      // Asked twice already → fill defaults for missing fields
      const defaults = await suggestDefaults(reqCheck.requirements)
      const defLines: string[] = []
      if (!reqCheck.requirements.destination && defaults.destination) {
        defLines.push(`目的地：${defaults.destination}`)
      }
      if (!reqCheck.requirements.peopleCount && defaults.peopleCount && !reqCheck.flexibleFields.includes('peopleCount')) {
        defLines.push(`出行人数：${defaults.peopleCount}`)
      }
      if (!reqCheck.requirements.duration && defaults.duration && !reqCheck.flexibleFields.includes('duration')) {
        defLines.push(`游玩天数：${defaults.duration}天`)
      }
      if (!reqCheck.requirements.dates && defaults.dates && !reqCheck.flexibleFields.includes('dates')) {
        defLines.push(`出行日期：${defaults.dates}`)
      }
      if (!reqCheck.requirements.departureCity && defaults.departureCity) {
        defLines.push(`出发城市：${defaults.departureCity}`)
      }
      if (defLines.length > 0) {
        chatHistory.push({
          role: 'system',
          content: `[系统补充默认信息]\n${defLines.join('\n')}\n（以上为未指定字段的系统推荐值）`,
        })
      }
    }

    // ── Phase 3: Run agent ──
    try {
      const abort = new AbortController()

      const { response, steps } = await runAgent(message, chatHistory, (tool, status, data) => {
        sseStream.writeSSE({
          event: 'step',
          data: JSON.stringify({ tool, status, data }),
        }).catch(() => {})
      }, abort)

      resetAskCount(userId)

      let resp: ChatResponse
      if (itineraryResult.data) {
        const it = itineraryResult.data
        await enrichItineraryImages(it).catch(() => {})
        resp = {
          type: 'itinerary',
          content: null,
          itinerary: it,
          steps,
        }
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
        await enrichItineraryImages(it).catch(() => {})
        addMessage(userId, 'ai', `[行程: ${it.meta.city} ${it.meta.days}天 预算¥${it.meta.budgetTotal} · ${it.meta.summary}]`, it as unknown as Record<string, unknown>)
        await sseStream.writeSSE({
          event: 'result',
          data: JSON.stringify({ type: 'itinerary', content: null, itinerary: it, steps: [] }),
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

app.post('/api/reset/:userId', requireAuth, async (c) => {
  const { userId } = c.req.param()
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) {
    return c.json({ error: '无权操作' }, 403)
  }
  deleteSession(userId)
  deleteTravelState(userId)
  deleteUserMessages(userId)
  return c.json({ ok: true })
})

/* ── Favorites ── */

app.post('/api/favorites', requireAuth, async (c) => {
  const { userId, itinerary } = await c.req.json<{ userId: string; itinerary: Itinerary }>()
  if (!userId || !itinerary) return c.json({ error: '参数缺失' }, 400)
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) return c.json({ error: '无权操作' }, 403)
  const result = addFavorite(userId, itinerary)
  return c.json(result)
})

app.get('/api/favorites/:userId', requireAuth, async (c) => {
  const { userId } = c.req.param()
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) return c.json({ error: '无权访问' }, 403)
  const rows = getFavorites(userId)
  const favorites = rows.map(r => ({
    id: r.id,
    itinerary: JSON.parse(r.itinerary_json) as Itinerary,
    createdAt: r.created_at,
  }))
  return c.json({ favorites })
})

app.delete('/api/favorites/:id', requireAuth, async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: '参数缺失' }, 400)
  const { userId } = await c.req.json<{ userId: string }>()
  const payload = c.get('jwtPayload') as { userId: string }
  if (payload.userId !== userId) return c.json({ error: '无权操作' }, 403)
  const ok = removeFavorite(id, userId)
  return ok ? c.json({ ok: true }) : c.json({ error: '收藏不存在' }, 404)
})

/* ── Balance ── */

let balanceCache: { data: unknown; ts: number } | null = null
const BALANCE_TTL = 60_000

app.get('/api/balance', async (c) => {
  if (balanceCache && Date.now() - balanceCache.ts < BALANCE_TTL) {
    return c.json(balanceCache.data)
  }
  try {
    const resp = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
    if (!resp.ok) {
      return c.json({ error: `DeepSeek API ${resp.status}`, is_available: false, balance_infos: [] }, 502)
    }
    const data = await resp.json()
    balanceCache = { data, ts: Date.now() }
    return c.json(data)
  } catch (err) {
    return c.json({ error: (err as Error).message, is_available: false, balance_infos: [] }, 502)
  }
})

/* ── Health ── */

app.get('/api/health', (c) => c.json({ status: 'ok', model: config.model }))

/* ── Serve built frontend (SPA catch-all) ── */

const distPath = path.resolve(__dirname, '../../vue-project/dist')
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

app.get('*', (c) => {
  // Only handle non-API routes
  if (c.req.path.startsWith('/api/')) return c.notFound()

  const url = c.req.path === '/' ? '/index.html' : c.req.path
  const filePath = path.join(distPath, url)

  // Security: prevent path traversal
  if (!filePath.startsWith(distPath)) return c.notFound()

  try {
    const content = fs.readFileSync(filePath)
    const ext = path.extname(filePath)
    return c.body(content, 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=86400',
    })
  } catch {
    // SPA fallback — serve index.html for any non-file route
    const html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8')
    return c.html(html)
  }
})
