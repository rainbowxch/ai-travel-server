import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Chat API regression tests.
 *
 * Mocks the agent and DB layers to test request validation,
 * response format for both streaming and non-streaming endpoints.
 */

// Hoisted mock factories (hoisted above vi.mock calls by vitest)
const mockRunAgent = vi.hoisted(() => vi.fn())
const mockItineraryData = vi.hoisted(() => ({ data: null as any }))

// Mock agent to avoid real LLM calls
vi.mock('../../src/agent.js', () => ({
  runAgent: mockRunAgent,
}))

// Mock tools/itinerary for controlling itineraryResult
vi.mock('../../src/tools/itinerary.js', () => ({
  generateItineraryTool: {},
  itineraryResult: mockItineraryData,
}))

// Mock db.ts
vi.mock('../../src/db.js', () => ({
  getMessages: vi.fn(() => []),
  insertMessage: vi.fn(),
  deleteUserMessages: vi.fn(),
  getUserByAccount: vi.fn(),
  createUser: vi.fn(),
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  initDb: vi.fn(() => ({}) as any),
  getDb: vi.fn(() => ({}) as any),
}))

// Mock session
vi.mock('../../src/session.js', () => ({
  getOrCreateSession: vi.fn(() => ({ userId: 'any', messages: [], cachedSummary: null, summarizedUpTo: 0 })),
  addMessage: vi.fn(),
  buildChatHistory: vi.fn(() => Promise.resolve([])),
  deleteSession: vi.fn(),
}))

import { app } from '../../src/app.js'

const SAMPLE_STEPS = [
  { tool: 'get_weather', status: 'done' as const, args: '{"city":"杭州"}', result: '20°C' },
  { tool: 'search_pois', status: 'done' as const, args: '{"city":"杭州"}', result: '西湖' },
]

beforeEach(() => {
  mockRunAgent.mockReset()
  mockItineraryData.data = null
})

describe('POST /api/chat (non-streaming)', () => {
  it('should return 400 when message is missing', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test-user' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('message')
  })

  it('should return 401 when userId is missing', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('userId')
  })

  it('should return text response when no itinerary generated', async () => {
    mockRunAgent.mockResolvedValueOnce({
      response: '杭州是个好地方！',
      steps: SAMPLE_STEPS,
    })

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '推荐杭州景点', userId: 'u_test' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.type).toBe('text')
    expect(body.content).toBe('杭州是个好地方！')
    expect(body.itinerary).toBeNull()
    expect(body.steps).toHaveLength(2)
  })

  it('should return itinerary response when generate_itinerary called', async () => {
    mockRunAgent.mockResolvedValueOnce({
      response: '',
      steps: [...SAMPLE_STEPS, { tool: 'generate_itinerary', status: 'done' as const, args: '{}', result: 'ok' }],
    })
    mockItineraryData.data = {
      meta: { city: '杭州', days: 2, summary: '杭州两日游', budgetTotal: 2000, constraints: [] },
      days: [{ dayIndex: 0, theme: '西湖', blocks: [{ start: '09:00', end: '12:00', title: '西湖', type: 'sight' as const, why: '必去' }] }],
    }

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '帮我规划杭州', userId: 'u_test' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.type).toBe('itinerary')
    expect(body.itinerary).toBeTruthy()
    expect(body.itinerary.meta.city).toBe('杭州')
    expect(body.itinerary.meta.days).toBe(2)
  })
})

describe('POST /api/chat/stream (SSE)', () => {
  it('should return 400 when message is missing', async () => {
    const res = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'test-user' }),
    })
    expect(res.status).toBe(400)
  })

  it('should return 401 when userId is missing', async () => {
    const res = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })
    expect(res.status).toBe(401)
  })

  it('should emit step events then result event', async () => {
    mockRunAgent.mockImplementationOnce(async (_msg: string, _history: any, onStep?: any) => {
      if (onStep) {
        onStep('get_weather', 'running', '{"city":"杭州"}')
        onStep('get_weather', 'done', '20°C')
        onStep('search_pois', 'running', '{"city":"杭州"}')
        onStep('search_pois', 'done', '西湖')
      }
      return { response: '推荐杭州', steps: SAMPLE_STEPS }
    })

    const res = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '杭州推荐', userId: 'u_test' }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    // Should contain step events
    expect(text).toContain('event: step')
    expect(text).toContain('get_weather')
    expect(text).toContain('search_pois')
    // Should contain result event
    expect(text).toContain('event: result')
    expect(text).toContain('推荐杭州')
  })

  it('should emit error result when agent throws', async () => {
    mockRunAgent.mockRejectedValueOnce(new Error('API 超时'))

    const res = await app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '杭州推荐', userId: 'u_test' }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain('event: result')
    expect(text).toContain('API 超时')
  })
})

describe('GET /api/history/:userId', () => {
  it('should return empty messages for new user', async () => {
    const res = await app.request('/api/history/new-user')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('new-user')
    expect(body.messages).toEqual([])
  })
})

describe('POST /api/reset/:userId', () => {
  it('should return ok on reset', async () => {
    const res = await app.request('/api/reset/test-user', { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
