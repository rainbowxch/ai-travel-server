import { describe, it, expect } from 'vitest'
import { app } from '../../src/app.js'

/**
 * Health endpoint regression tests.
 *
 * The simplest endpoint — no dependencies, no side effects.
 */

describe('GET /api/health', () => {
  it('should return 200 with status ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.model).toBe('deepseek-chat')
  })

  it('should return JSON content-type', async () => {
    const res = await app.request('/api/health')
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
