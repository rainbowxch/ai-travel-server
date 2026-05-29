import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { config } from './config.js'
import { getDb } from './db.js'
import type { Itinerary } from './types.js'

/* ── Types ── */

export interface TravelIntent {
  destination: string | null
  peopleCount: string | null
  budget: string | null
  duration: number | null
  dates: string | null
  departureCity: string | null
  preferences: string[]
  flexibleFields: string[]
}

export interface LastItineraryInfo {
  city: string
  days: number
  summary: string
  dates: string
  budgetTotal: number
  generatedAt: number
}

export interface TravelState {
  historicalSummary: string | null
  lastItinerary: LastItineraryInfo | null
  askCount: number
}

/* ── DB schema ── */

function ensureTable() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS travel_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      historical_summary TEXT,
      last_itinerary_json TEXT,
      ask_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `)
}

/* ── State cache ── */

const stateCache = new Map<string, TravelState>()

export function getTravelState(userId: string): TravelState {
  const cached = stateCache.get(userId)
  if (cached) return cached

  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM travel_state WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined

  if (row) {
    const state: TravelState = {
      historicalSummary: (row.historical_summary as string) ?? null,
      lastItinerary: row.last_itinerary_json
        ? JSON.parse(row.last_itinerary_json as string) as LastItineraryInfo
        : null,
      askCount: (row.ask_count as number) ?? 0,
    }
    stateCache.set(userId, state)
    return state
  }

  const state: TravelState = { historicalSummary: null, lastItinerary: null, askCount: 0 }
  stateCache.set(userId, state)
  return state
}

export function persistTravelState(userId: string): void {
  ensureTable()
  const state = stateCache.get(userId)
  if (!state) return

  const db = getDb()
  db.prepare(`
    INSERT INTO travel_state (user_id, historical_summary, last_itinerary_json, ask_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      historical_summary = excluded.historical_summary,
      last_itinerary_json = excluded.last_itinerary_json,
      ask_count = excluded.ask_count,
      updated_at = excluded.updated_at
  `).run(
    userId,
    state.historicalSummary,
    state.lastItinerary ? JSON.stringify(state.lastItinerary) : null,
    state.askCount,
    Date.now(),
  )
}

export function deleteTravelState(userId: string): void {
  stateCache.delete(userId)
  ensureTable()
  getDb().prepare('DELETE FROM travel_state WHERE user_id = ?').run(userId)
}

/* ── Intent extraction ── */

const EXTRACT_PROMPT = `你是一个旅行规划信息提取器。从用户的对话历史中提取旅���规划信息。

提取以下字段（只从用户发言中提取，忽略助手的发言）：
1. destination - 目的地（城市或地区名称）
2. peopleCount - 出行人数（如"2大1小"、"3人"、"一个人"）
3. budget - 预算（可选，用字符串，如"5000"表示总共5000元）
4. duration - 游玩天数（数字，如3表示3天）
5. dates - 出行日期（如"五一"、"下周末"、"2026-05-01"）
6. departureCity - 出发城市
7. preferences - 偏好列表，如["轻松", "不赶", "美食", "带小孩", "穷游", "深度游", "购物"]

同时判断用户对哪些字段明确表达了"都可以/无所谓/随便/不限/你看着办"的态度（加入 flexibleFields）。

以严格的JSON格式输出，只输出JSON：{
  "destination": null,
  "peopleCount": null,
  "budget": null,
  "duration": null,
  "dates": null,
  "departureCity": null,
  "preferences": [],
  "flexibleFields": []
}`

export async function extractIntent(
  conversation: Array<{ role: string; content: string }>,
): Promise<TravelIntent> {
  const llm = new ChatOpenAI({
    modelName: config.model,
    temperature: 0.1,
    configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
  })

  const text = conversation
    .map(m => `${m.role === 'human' ? '用户' : '助手'}: ${m.content}`)
    .join('\n')

  try {
    const result = await llm.invoke([
      new SystemMessage(EXTRACT_PROMPT),
      new HumanMessage(text),
    ], { response_format: { type: 'json_object' } })

    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    const parsed = JSON.parse(content) as Record<string, unknown>

    return {
      destination: (parsed.destination as string)?.trim() || null,
      peopleCount: (parsed.peopleCount as string)?.trim() || null,
      budget: (parsed.budget as string)?.trim() || null,
      duration: typeof parsed.duration === 'number' && !isNaN(parsed.duration) ? (parsed.duration as number) : null,
      dates: (parsed.dates as string)?.trim() || null,
      departureCity: (parsed.departureCity as string)?.trim() || null,
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences as string[] : [],
      flexibleFields: Array.isArray(parsed.flexibleFields) ? parsed.flexibleFields as string[] : [],
    }
  } catch {
    return {
      destination: null, peopleCount: null, budget: null,
      duration: null, dates: null, departureCity: null,
      preferences: [], flexibleFields: [],
    }
  }
}

/* ── Defaults suggestion ── */

const DEFAULTS_PROMPT = `你是一个旅行规划助手。用户缺少一些必填信息，请根据已有信息和当前季节推荐合理的默认值。

当前月份：${new Date().getMonth() + 1}月

已有信息用JSON表示，缺失字段为null：
{requirements}

请返回JSON格式的推荐值（只输出JSON）：
{
  "destination": "推荐的旅游城市（结合已有目的地和当季推荐）",
  "duration": 推荐天数,
  "dates": "推荐的日期或时间段",
  "departureCity": "出发城市",
  "peopleCount": "推荐人数"
}`

export async function suggestDefaults(
  intent: { destination: string | null; duration: number | null; dates: string | null; departureCity: string | null; peopleCount: string | null },
): Promise<{ destination: string | null; duration: number | null; dates: string | null; departureCity: string | null; peopleCount: string | null }> {
  // Only call LLM if destination is missing (the most important field)
  const needsDefaults = !intent.destination || !intent.duration || !intent.dates
  if (!needsDefaults) {
    return { destination: null, duration: null, dates: null, departureCity: null, peopleCount: null }
  }

  try {
    const llm = new ChatOpenAI({
      modelName: config.model,
      temperature: 0.3,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
    })

    const prompt = DEFAULTS_PROMPT.replace('{requirements}', JSON.stringify(intent, null, 2))
    const result = await llm.invoke([
      new SystemMessage('你是一个旅行规划助手，只返回JSON。'),
      new HumanMessage(prompt),
    ], { response_format: { type: 'json_object' } })

    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      destination: (parsed.destination as string)?.trim() || null,
      duration: typeof parsed.duration === 'number' && !isNaN(parsed.duration) ? (parsed.duration as number) : null,
      dates: (parsed.dates as string)?.trim() || null,
      departureCity: (parsed.departureCity as string)?.trim() || null,
      peopleCount: (parsed.peopleCount as string)?.trim() || null,
    }
  } catch {
    return { destination: null, duration: null, dates: null, departureCity: null, peopleCount: null }
  }
}

/* ── Itinerary expiry ── */

export function isItineraryExpired(last: LastItineraryInfo): boolean {
  // Expired if the itinerary was generated more than 30 days ago
  return Date.now() - last.generatedAt > 30 * 24 * 60 * 60 * 1000
}

export function mergeExpiredItinerary(userId: string, itinerary: Itinerary): void {
  const state = getTravelState(userId)
  if (!state.lastItinerary) {
    state.lastItinerary = {
      city: itinerary.meta.city,
      days: itinerary.meta.days,
      summary: itinerary.meta.summary,
      dates: '',
      budgetTotal: itinerary.meta.budgetTotal,
      generatedAt: Date.now(),
    }
    persistTravelState(userId)
    return
  }

  if (isItineraryExpired(state.lastItinerary)) {
    const lines: string[] = []
    if (state.historicalSummary) lines.push(state.historicalSummary)
    lines.push(`[历史行程] ${state.lastItinerary.city}${state.lastItinerary.days}天，预算¥${state.lastItinerary.budgetTotal}，${state.lastItinerary.summary}`)
    state.historicalSummary = lines.join('\n')
    state.lastItinerary = {
      city: itinerary.meta.city,
      days: itinerary.meta.days,
      summary: itinerary.meta.summary,
      dates: '',
      budgetTotal: itinerary.meta.budgetTotal,
      generatedAt: Date.now(),
    }
    persistTravelState(userId)
  }
}

/* ── Enriched context builder ── */

export function buildEnrichedContext(
  intent: TravelIntent,
  state: TravelState,
  defaults: { destination: string | null; duration: number | null; dates: string | null; departureCity: string | null; peopleCount: string | null },
): string {
  const parts: string[] = []

  // 1. Extracted user preferences
  const prefLines: string[] = []
  if (intent.destination) prefLines.push(`目的地：${intent.destination}`)
  if (intent.peopleCount) prefLines.push(`出行人数：${intent.peopleCount}`)
  if (intent.budget) prefLines.push(`预算：${intent.budget}元`)
  if (intent.duration) prefLines.push(`游玩天数：${intent.duration}天`)
  if (intent.dates) prefLines.push(`出行日期：${intent.dates}`)
  if (intent.departureCity) prefLines.push(`出发城市：${intent.departureCity}`)
  if (intent.preferences.length > 0) prefLines.push(`偏好：${intent.preferences.join('、')}`)
  if (prefLines.length > 0) {
    parts.push('=== 用户需求 ===')
    parts.push(prefLines.join('\n'))
  }

  // 2. Defaults (for fields user didn't specify and aren't flexible)
  const defLines: string[] = []
  if (!intent.destination && defaults.destination && !intent.flexibleFields.includes('destination')) {
    defLines.push(`目的地（推荐）：${defaults.destination}`)
  }
  if (!intent.duration && defaults.duration && !intent.flexibleFields.includes('duration')) {
    defLines.push(`游玩天数（推荐）：${defaults.duration}天`)
  }
  if (!intent.dates && defaults.dates && !intent.flexibleFields.includes('dates')) {
    defLines.push(`出行日期（推荐）：${defaults.dates}`)
  }
  if (!intent.departureCity && defaults.departureCity) {
    defLines.push(`出发城市（默认）：${defaults.departureCity}`)
  }
  if (!intent.peopleCount && defaults.peopleCount && !intent.flexibleFields.includes('peopleCount')) {
    defLines.push(`出行人数（默认）：${defaults.peopleCount}`)
  }
  if (defLines.length > 0) {
    parts.push('=== 默认补充信息 ===')
    parts.push(defLines.join('\n'))
    parts.push('（以上为系统根据情况推荐的默认值，如用户未明确反对则以这些为准）')
  }

  // 3. Historical summary
  if (state.historicalSummary) {
    parts.push('=== 历史出行参考 ===')
    parts.push(state.historicalSummary)
    parts.push('（以上为用户此前的旅行记录，仅供参考，当前行程以用户最新需求为准）')
  }

  if (parts.length === 0) return ''
  return parts.join('\n\n')
}

/* ── Ask count management ── */

export function incrementAskCount(userId: string): number {
  const state = getTravelState(userId)
  state.askCount++
  persistTravelState(userId)
  return state.askCount
}

export function resetAskCount(userId: string): void {
  const state = getTravelState(userId)
  state.askCount = 0
  persistTravelState(userId)
}

export function getAskCount(userId: string): number {
  return getTravelState(userId).askCount
}
