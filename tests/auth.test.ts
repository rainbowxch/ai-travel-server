import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

/**
 * Auth regression tests.
 *
 * Tests JWT token generation/verification and password hashing logic.
 * These are unit tests for the primitives used in src/auth.ts.
 */

const JWT_SECRET = 'test-secret-for-unit-tests'

describe('Auth: JWT token', () => {
  it('should sign and verify a valid token', () => {
    const payload = { userId: 'u_test', account: 'test@test.com' }
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })

    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; account: string }
    expect(decoded.userId).toBe('u_test')
    expect(decoded.account).toBe('test@test.com')
  })

  it('should reject token with wrong secret', () => {
    const token = jwt.sign({ userId: 'u_test' }, JWT_SECRET)
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow()
  })

  it('should reject malformed token', () => {
    expect(() => jwt.verify('not-a-token', JWT_SECRET)).toThrow()
  })

  it('should extract userId from token payload', () => {
    const token = jwt.sign({ userId: 'u_abc123' }, JWT_SECRET, { expiresIn: '1h' })
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }
    expect(decoded.userId).toBe('u_abc123')
  })

  it('should reject expired token', async () => {
    // Token that expired in the past
    const token = jwt.sign({ userId: 'u_test' }, JWT_SECRET, { expiresIn: '0s' })
    // Wait a tick for expiry
    await new Promise(r => setTimeout(r, 100))
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow(/expired|exp/)
  })
})

describe('Auth: password hashing', () => {
  it('should hash and compare password correctly', async () => {
    const password = 'mypassword123'
    const hash = await bcrypt.hash(password, 10)

    expect(hash).not.toBe(password)
    expect(hash).toMatch(/^\$2[ab]\$\d+/) // bcrypt hash prefix ($2a$ or $2b$)

    const valid = await bcrypt.compare(password, hash)
    expect(valid).toBe(true)
  })

  it('should reject wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    const valid = await bcrypt.compare('wrong', hash)
    expect(valid).toBe(false)
  })

  it('should produce different hashes for same password', async () => {
    const password = 'samepassword'
    const hash1 = await bcrypt.hash(password, 10)
    const hash2 = await bcrypt.hash(password, 10)
    // bcrypt uses random salt, so hashes should differ
    expect(hash1).not.toBe(hash2)
    // But both should verify correctly
    expect(await bcrypt.compare(password, hash1)).toBe(true)
    expect(await bcrypt.compare(password, hash2)).toBe(true)
  })
})
