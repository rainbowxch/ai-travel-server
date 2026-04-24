import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Auth API regression tests.
 *
 * Mocks the DB layer to test request validation, response format,
 * and status codes for register/login/me endpoints.
 */

// Mock db.ts — provides controlled user data for auth tests
vi.mock('../../src/db.js', () => {
  const users = new Map<string, { id: string; account: string; name: string | null; password_hash: string | null }>()

  return {
    getUserByAccount: vi.fn((account: string) => {
      for (const u of users.values()) {
        if (u.account === account) return { id: u.id, account: u.account, name: u.name, password_hash: u.password_hash, email: null, email_verified: 0, created_at: Date.now() }
      }
      return undefined
    }),
    createUser: vi.fn((id: string, account: string, passwordHash: string, name?: string) => {
      users.set(id, { id, account, name: name ?? null, password_hash: passwordHash })
    }),
    getUser: vi.fn((id: string) => {
      const u = users.get(id)
      if (!u) return undefined
      return { id: u.id, account: u.account, name: u.name, password_hash: u.password_hash, email: null, email_verified: 0, created_at: Date.now() }
    }),
    initDb: vi.fn(() => ({}) as any),
    getDb: vi.fn(() => ({}) as any),
    insertMessage: vi.fn(),
    getMessages: vi.fn(() => []),
    deleteUserMessages: vi.fn(),
    upsertUser: vi.fn(),
    __reset: () => users.clear(),
  }
})

// Mock session building to avoid LLM calls
vi.mock('../../src/session.js', () => ({
  getOrCreateSession: vi.fn(() => ({ userId: 'any', messages: [], cachedSummary: null, summarizedUpTo: 0 })),
  addMessage: vi.fn(),
  buildChatHistory: vi.fn(() => Promise.resolve([])),
  deleteSession: vi.fn(),
}))

import { app } from '../../src/app.js'
// @ts-expect-error access mock internals
import { __reset } from '../../src/db.js'

beforeEach(() => {
  __reset()
})

describe('POST /api/auth/register', () => {
  it('should register a new user and return token', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'newuser@test.com', password: 'password123', name: '新用户' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body.userId).toBeTruthy()
    expect(body.account).toBe('newuser@test.com')
    expect(body.name).toBe('新用户')
  })

  it('should return 400 when account is missing', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('邮箱/手机号')
  })

  it('should return 400 when password is too short', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'test@test.com', password: '123' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('6 位')
  })

  it('should return 409 when account already exists', async () => {
    // Register once
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'dup@test.com', password: 'password123' }),
    })
    // Register again with same account
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'dup@test.com', password: 'password123' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('已注册')
  })
})

describe('POST /api/auth/login', () => {
  it('should login with correct password and return token', async () => {
    // Register first
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'login@test.com', password: 'mypassword' }),
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'login@test.com', password: 'mypassword' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body.account).toBe('login@test.com')
  })

  it('should return 401 with wrong password', async () => {
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'wrongpw@test.com', password: 'correct' }),
    })

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'wrongpw@test.com', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('密码错误')
  })

  it('should return 401 for unregistered account', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'nobody@test.com', password: 'whatever' }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('未注册')
  })
})

describe('GET /api/auth/me', () => {
  it('should return user info for valid token', async () => {
    // Register to get a token
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'me@test.com', password: 'password123', name: 'Me' }),
    })
    const { token } = await regRes.json()

    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBeTruthy()
    expect(body.account).toBe('me@test.com')
    expect(body.name).toBe('Me')
  })

  it('should return 401 without auth header', async () => {
    const res = await app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('should return 401 with invalid token', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('过期')
  })
})
