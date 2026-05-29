import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { getUserByAccount, createUser, getUser } from './db.js'
import { config } from './config.js'

const app = new Hono()

const SALT_ROUNDS = 10
const TOKEN_EXPIRY = '7d'

function generateId(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * POST /api/auth/register
 * Body: { account: string, password: string, name?: string }
 *
 * account 可以是邮箱或手机号
 * password 最少 6 位
 */
app.post('/register', async (c) => {
  const { account, password, name } = await c.req.json<{
    account: string
    password: string
    name?: string
  }>()

  if (!account || typeof account !== 'string') {
    return c.json({ error: '邮箱/手机号必填' }, 400)
  }
  if (!password || password.length < 6) {
    return c.json({ error: '密码至少 6 位' }, 400)
  }

  // Check if account already exists
  const existing = getUserByAccount(account)
  if (existing) {
    return c.json({ error: '该账号已注册，请直接登录' }, 409)
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
  const userId = generateId()
  createUser(userId, account, passwordHash, name)

  const token = jwt.sign(
    { userId, account },
    config.jwtSecret,
    { expiresIn: TOKEN_EXPIRY },
  )

  return c.json({
    token,
    userId,
    account,
    name: name ?? null,
  })
})

/**
 * POST /api/auth/login
 * Body: { account: string, password: string }
 */
app.post('/login', async (c) => {
  const { account, password } = await c.req.json<{
    account: string
    password: string
  }>()

  if (!account || !password) {
    return c.json({ error: '账号和密码必填' }, 400)
  }

  const user = getUserByAccount(account)
  if (!user) {
    return c.json({ error: '账号未注册' }, 401)
  }

  if (!user.password_hash) {
    return c.json({ error: '该账号未设置密码，请使用其他方式登录' }, 401)
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return c.json({ error: '密码错误' }, 401)
  }

  const token = jwt.sign(
    { userId: user.id, account },
    config.jwtSecret,
    { expiresIn: TOKEN_EXPIRY },
  )

  return c.json({
    token,
    userId: user.id,
    account: user.account,
    name: user.name,
  })
})

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 * Returns current user info (for page refresh token validation)
 */
app.get('/me', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: '未登录' }, 401)
  }

  try {
    const payload = jwt.verify(auth.slice(7), config.jwtSecret) as { userId: string }
    const user = getUser(payload.userId)
    if (!user) {
      return c.json({ error: '用户不存在' }, 401)
    }
    return c.json({
      userId: user.id,
      account: user.account,
      name: user.name,
    })
  } catch {
    return c.json({ error: '登录已过期，请重新登录' }, 401)
  }
})

export { app as authRouter }
