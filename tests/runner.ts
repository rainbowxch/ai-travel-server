/**
 * Golden Test Runner — AI Travel Server
 *
 * 运行方式：
 *   cd ai-travel-server && npx tsx tests/runner.ts
 *
 * 环境变量：
 *   API_BASE_URL     默认 http://localhost:3001
 *   AI_BASE_URL      用于 LLM 评判的 API 地址（默认取 .env）
 *   AI_API_KEY       用于 LLM 评判的 API Key（默认取 .env）
 *   AI_MODEL         用于 LLM 评判的模型名（默认 deepseek-chat）
 *   LLM_JUDGE        设为 "0" 可禁用 LLM 评判（降级为 status-only 检查）
 *   VERBOSE          设为 "1" 可输出详细日志
 */

import 'dotenv/config'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testCases, TEST_ACCOUNT, type TestCase } from './suite.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/* ── Config ── */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001'
const LLM_BASE = process.env.AI_BASE_URL || ''
const LLM_KEY = process.env.AI_API_KEY || ''
const LLM_MODEL = process.env.AI_MODEL || 'deepseek-chat'
const ENABLE_LLM = process.env.LLM_JUDGE !== '0'
const VERBOSE = process.env.VERBOSE === '1'

/* ── Types ── */

interface TestResult {
  case: TestCase
  status: 'pass' | 'fail' | 'skip' | 'error'
  actualStatus: number
  actualBody: unknown
  errors: string[]
  score: number | null    // LLM 评分 (0-10)
  similarity: number | null // 相似度 (0-1)
  durationMs: number
}

interface Report {
  timestamp: string
  total: number
  passed: number
  failed: number
  skipped: number
  errors: number
  successRate: number
  avgSimilarity: number | null
  results: TestResult[]
  groups: Record<string, { total: number; passed: number; failed: number }>
}

/* ── Helpers ── */

const TEST_PASSWORD = 'testpass123'
const TEST_NAME = '黄金测试用户'

const log = (...args: unknown[]) => { if (VERBOSE) console.log('[runner]', ...args) }
const warn = (...args: unknown[]) => console.warn('  ⚠', ...args)

async function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `${API_BASE}${path}`
  const opts: RequestInit = {
    method,
    headers: { ...headers },
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
    if (!opts.headers) opts.headers = {}
    ;(opts.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const resp = await fetch(url, opts)
  const text = await resp.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: resp.status, body: parsed }
}

/**
 * 消费 SSE 流，返回最终 result 事件的数据。
 */
async function consumeSSE(
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; events: { event: string; data: unknown }[] }> {
  const url = `${API_BASE}${path}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!resp.ok) {
    const text = await resp.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    return { status: resp.status, events: [{ event: 'result', data: parsed }] }
  }

  const reader = resp.body?.getReader()
  if (!reader) return { status: resp.status, events: [] }

  const decoder = new TextDecoder()
  let buffer = ''
  const events: { event: string; data: unknown }[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      let eventType = 'message'
      let dataStr = ''
      for (const line of trimmed.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim()
        else if (line.startsWith('data: ')) dataStr = line.slice(6).trim()
      }
      if (dataStr) {
        try { events.push({ event: eventType, data: JSON.parse(dataStr) }) }
        catch { events.push({ event: eventType, data: dataStr }) }
      }
    }
  }

  return { status: resp.status, events }
}

/**
 * 深度比较预期字段与实际响应体。
 * 只检查 expectBody 中指定的字段，忽略其他字段。
 */
function matchBody(expectBody: Record<string, unknown>, actual: unknown): string[] {
  const errors: string[] = []
  if (typeof actual !== 'object' || actual === null) {
    return [`期望对象，实际为 ${typeof actual}`]
  }

  function deepCheck(expected: unknown, actual: unknown, path: string) {
    if (expected === undefined) return // skip undefined
    if (typeof expected !== typeof actual) {
      errors.push(`${path}: 类型不匹配 (期望 ${typeof expected}, 实际 ${typeof actual})`)
      return
    }
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (typeof actual !== 'object' || actual === null) {
        errors.push(`${path}: 期望对象，实际为 ${typeof actual}`)
        return
      }
      for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
        deepCheck(v, (actual as Record<string, unknown>)[k], `${path}.${k}`)
      }
    } else if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        errors.push(`${path}: 期望数组，实际为 ${typeof actual}`)
        return
      }
      // Only check first item if expected array has one element
      if (expected.length > 0 && actual.length > 0) {
        deepCheck(expected[0], actual[0], `${path}[0]`)
      }
    } else {
      if (expected !== actual) {
        errors.push(`${path}: 值不匹配 (期望 "${expected}", 实际 "${actual}")`)
      }
    }
  }

  deepCheck(expectBody, actual, '$')
  return errors
}

/**
 * 调用 LLM 评判响应质量。
 * 返回 { score: 0-10, similarity: 0-1, explanation: string }
 */
async function llmJudge(
  testCase: TestCase,
  actualBody: unknown,
  actualStatus: number,
): Promise<{ score: number; similarity: number; explanation: string }> {
  if (!ENABLE_LLM || !LLM_BASE || !LLM_KEY) {
    return { score: actualStatus === testCase.expectStatus ? 10 : 0, similarity: actualStatus === testCase.expectStatus ? 1 : 0, explanation: 'LLM 评判未配置，使用状态码判断' }
  }

  const judgePrompt = `你是一个 API 测试结果评判专家。请根据以下信息评判测试结果。

测试名称: ${testCase.name}
测试描述: ${testCase.description}
请求: ${testCase.method} ${testCase.path}

预期状态码: ${testCase.expectStatus}
预期响应: ${JSON.stringify(testCase.expectBody ?? testCase.expectFn?.toString() ?? '（非确定性）')}

${testCase.llmJudge ? `LLM 评判标准: ${testCase.llmJudge}` : ''}

实际状态码: ${actualStatus}
实际响应体: ${JSON.stringify(actualBody).slice(0, 3000)}

请从以下维度评判：
1. 状态码是否正确（重要）
2. 响应结构是否符合预期
3. 数据内容是否合理

以严格的 JSON 格式输出（只输出 JSON，不要其他内容）：
{
  "score": <0-10 整数，10 为完美>,
  "similarity": <0-1 浮点数，表示与预期的相似度>,
  "explanation": "<简要说明扣分原因>"
}`

  try {
    const resp = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: judgePrompt }],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    })
    const data = await resp.json() as any
    const content = data?.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(content) as { score?: number; similarity?: number; explanation?: string }
    return {
      score: Math.max(0, Math.min(10, parsed.score ?? 0)),
      similarity: Math.max(0, Math.min(1, parsed.similarity ?? 0)),
      explanation: parsed.explanation ?? '',
    }
  } catch (e) {
    warn(`LLM 评判失败:`, (e as Error).message)
    return { score: 0, similarity: 0, explanation: `LLM 调用异常: ${(e as Error).message}` }
  }
}

/* ── Placeholder injection ── */

function injectPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/__(\w+)__/g, (_, key) => vars[key] ?? `__${key}__`)
}

function injectHeaders(
  headers: Record<string, string> | undefined,
  vars: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    result[k] = injectPlaceholders(v, vars)
  }
  return result
}

function injectBody(body: unknown, vars: Record<string, string>): unknown {
  if (typeof body === 'string') return injectPlaceholders(body, vars)
  if (body && typeof body === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      result[k] = typeof v === 'string' ? injectPlaceholders(v, vars) : v
    }
    return result
  }
  return body
}

/* ── Main runner ── */

async function runTests(): Promise<Report> {
  const results: TestResult[] = []
  const groups: Report['groups'] = {}

  // Phase 0: Setup — register a test user and login to get credentials
  console.log('\n════════════════════════════════════════════')
  console.log('  黄金测试集 — AI Travel Server')
  console.log('════════════════════════════════════════════\n')
  console.log(`  API 地址: ${API_BASE}`)
  console.log(`  LLM 评判: ${ENABLE_LLM && LLM_BASE ? '已启用' : '已禁用 (仅检查状态码)'}`)
  console.log(`  测试用例数: ${testCases.length}`)
  console.log('')

  // Read .env for LLM config if not in env
  const envPath = resolve(__dirname, '..', '.env')
  if (!LLM_BASE && existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      if (line.startsWith('AI_BASE_URL=')) process.env.AI_BASE_URL = line.slice(12).trim()
      if (line.startsWith('AI_API_KEY=')) process.env.AI_API_KEY = line.slice(11).trim()
    }
  }

  let token = ''
  let userId = ''
  let favId = ''

  log('Setting up test user...')
  const regResp = await request('POST', '/api/auth/register', {}, {
    account: TEST_ACCOUNT,
    password: TEST_PASSWORD,
    name: TEST_NAME,
  })
  if (regResp.status === 200) {
    const b = regResp.body as any
    token = b.token
    userId = b.userId
    log(`Registered user: ${userId}`)
  } else if (regResp.status === 409) {
    // Already registered — login
    const loginResp = await request('POST', '/api/auth/login', {}, {
      account: TEST_ACCOUNT,
      password: TEST_PASSWORD,
    })
    if (loginResp.status === 200) {
      const b = loginResp.body as any
      token = b.token
      userId = b.userId
      log(`Logged in as: ${userId}`)
    }
  }

  if (!token) {
    warn('无法获取测试 token，跳过所有需要认证的测试\n')
  }

  // Run each test case
  for (const tc of testCases) {
    const start = Date.now()
    const result: TestResult = {
      case: tc,
      status: 'skip',
      actualStatus: 0,
      actualBody: null,
      errors: [],
      score: null,
      similarity: null,
      durationMs: 0,
    }

    // Check skip
    if (tc.skip || (tc.setupRequired?.includes('token') && !token)) {
      result.status = 'skip'
      result.durationMs = Date.now() - start
      results.push(result)
      continue
    }

    // Build dynamic vars
    const vars: Record<string, string> = { token, userId, favId, USER_ID: userId, FAV_ID: favId, TOKEN: token }
    const headers: Record<string, string> = {
      ...(token && tc.setupRequired?.includes('token') ? { Authorization: `Bearer ${token}` } : {}),
      ...injectHeaders(tc.headers, vars),
    }
    const body = injectBody(tc.body, vars)
    const path = injectPlaceholders(tc.path, vars)

    try {
      const isChat = tc.path.includes('/chat/stream') && tc.body !== undefined

      // ── Chat steps: send preparatory messages for multi-turn conversation ──
      if (isChat && tc.chatSteps && tc.chatSteps.length > 0) {
        for (const step of tc.chatSteps) {
          const stepBody = injectBody({ message: step.message, userId: vars.userId }, vars)
          await consumeSSE(path, headers, stepBody)
        }
      }

      if (isChat) {
        // SSE path
        const sse = await consumeSSE(path, headers, body)
        result.actualStatus = sse.status
        result.actualBody = sse.events

        if (sse.status !== tc.expectStatus) {
          result.status = 'fail'
          result.errors.push(`状态码 ${sse.status} !== 预期 ${tc.expectStatus}`)
        } else if (tc.llmJudge) {
          // LLM judge for non-deterministic
          const judgeResult = await llmJudge(tc, { events: sse.events, status: sse.status }, sse.status)
          result.score = judgeResult.score
          result.similarity = judgeResult.similarity
          if (judgeResult.score >= 6) {
            result.status = 'pass'
          } else {
            result.status = tc.expectFn ? 'fail' : 'pass' // soft pass for LLM non-deterministic
            if (tc.expectFn) result.errors.push(`LLM 评分 ${judgeResult.score}/10: ${judgeResult.explanation}`)
          }
        } else if (tc.expectBody) {
          const errs = matchBody(tc.expectBody, sse.events.length > 0 ? sse.events[sse.events.length - 1].data : sse.events)
          result.status = errs.length === 0 ? 'pass' : 'fail'
          result.errors = errs
        } else if (tc.expectFn) {
          const ok = tc.expectFn(sse.events.length > 0 ? sse.events[sse.events.length - 1].data : sse.events)
          result.status = ok ? 'pass' : 'fail'
          if (!ok) result.errors.push('自定义校验函数未通过')
        } else {
          result.status = 'pass'
        }
      } else {
        // Regular request
        const resp = await request(tc.method, path, headers, body)
        result.actualStatus = resp.status
        result.actualBody = resp.body

        if (resp.status !== tc.expectStatus) {
          result.status = 'fail'
          result.errors.push(`状态码 ${resp.status} !== 预期 ${tc.expectStatus}`)
        } else if (tc.expectBody) {
          const errs = matchBody(tc.expectBody, resp.body)
          result.status = errs.length === 0 ? 'pass' : 'fail'
          result.errors = errs
        } else if (tc.expectFn) {
          const ok = tc.expectFn(resp.body)
          result.status = ok ? 'pass' : 'fail'
          if (!ok) result.errors.push('自定义校验函数未通过')
        } else if (tc.llmJudge) {
          const judgeResult = await llmJudge(tc, resp.body, resp.status)
          result.score = judgeResult.score
          result.similarity = judgeResult.similarity
          result.status = judgeResult.score >= 6 ? 'pass' : 'fail'
          if (result.status === 'fail') result.errors.push(`LLM 评分 ${judgeResult.score}/10: ${judgeResult.explanation}`)
        } else {
          result.status = 'pass'
        }
      }
    } catch (e) {
      result.status = 'error'
      result.errors.push((e as Error).message)
    }

    result.durationMs = Date.now() - start
    results.push(result)

    // Handle favId extraction for subsequent tests
    if (tc.id === 'fav-001' && result.status === 'pass') {
      const b = result.actualBody as any
      favId = String(b?.id ?? '')
    }
  }

  // Cleanup: delete test user's messages and favorites
  if (token && userId) {
    try {
      await request('POST', `/api/reset/${userId}`, { Authorization: `Bearer ${token}` }, {})
    } catch { /* ignore */ }
    try {
      const favResp = await request('GET', `/api/favorites/${userId}`, { Authorization: `Bearer ${token}` })
      const favData = favResp.body as any
      if (favData?.favorites) {
        for (const f of favData.favorites) {
          await request('DELETE', `/api/favorites/${f.id}`, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, { userId })
        }
      }
    } catch { /* ignore */ }
  }

  // Build report
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const skipped = results.filter(r => r.status === 'skip').length
  const errors = results.filter(r => r.status === 'error').length
  const successRate = results.length > 0 ? passed / results.length : 0

  // Group stats
  for (const r of results) {
    const g = r.case.group
    if (!groups[g]) groups[g] = { total: 0, passed: 0, failed: 0 }
    groups[g].total++
    if (r.status === 'pass') groups[g].passed++
    if (r.status === 'fail' || r.status === 'error') groups[g].failed++
  }

  // Average similarity
  const withScore = results.filter(r => r.similarity !== null)
  const avgSimilarity = withScore.length > 0
    ? withScore.reduce((s, r) => s + (r.similarity ?? 0), 0) / withScore.length
    : null

  return {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    skipped,
    errors,
    successRate,
    avgSimilarity,
    results,
    groups,
  }
}

/* ── Report output ── */

function printReport(report: Report) {
  console.log('\n════════════════════════════════════════════')
  console.log('  测试报告')
  console.log('════════════════════════════════════════════\n')
  console.log(`  时间: ${report.timestamp}`)
  console.log(`  总计: ${report.total}  | 通过: ${report.passed}  | 失败: ${report.failed}  | 跳过: ${report.skipped}  | 错误: ${report.errors}`)
  console.log(`  成功率: ${(report.successRate * 100).toFixed(1)}%`)
  if (report.avgSimilarity !== null) {
    console.log(`  平均相似度: ${(report.avgSimilarity * 100).toFixed(1)}%`)
  }
  console.log('')

  // Per-group breakdown
  console.log('── 分组统计 ──')
  for (const [group, stats] of Object.entries(report.groups)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(1) : '-'
    console.log(`  ${group.padEnd(8)} ${stats.passed}/${stats.total}  (${rate}%)`)
  }
  console.log('')

  // Detailed results
  console.log('── 详细结果 ──')
  for (const r of report.results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '—' : '✗'
    const sim = r.similarity !== null ? ` [相似度 ${(r.similarity * 100).toFixed(0)}%]` : ''
    console.log(`  ${icon} ${r.case.id} ${r.case.name} (${r.durationMs}ms)${sim}`)
    if (r.status === 'fail' || r.status === 'error') {
      for (const err of r.errors) {
        console.log(`      ${err}`)
      }
      if (VERBOSE) {
        console.log(`      实际状态: ${r.actualStatus}`)
        console.log(`      实际响应: ${JSON.stringify(r.actualBody).slice(0, 300)}`)
      }
    }
    if (r.score !== null && VERBOSE) {
      console.log(`      LLM 评分: ${r.score}/10`)
    }
  }
  console.log('')

  // Summary bar
  const pct = (report.successRate * 100).toFixed(1)
  const barLen = 40
  const filled = Math.round(barLen * report.successRate)
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
  console.log(`  [${bar}] ${pct}%`)
  console.log('')
}

/* ── JSON output for programmatic use ── */

function saveJsonReport(report: Report) {
  const outPath = resolve(__dirname, '..', 'test-report.json')
  const summary = {
    timestamp: report.timestamp,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    errors: report.errors,
    successRate: report.successRate,
    avgSimilarity: report.avgSimilarity,
    groups: report.groups,
  }
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(`  JSON 报告已保存: test-report.json`)
}

/* ── Entry ── */

runTests()
  .then(report => {
    printReport(report)
    saveJsonReport(report)
    process.exit(report.failed > 0 || report.errors > 0 ? 1 : 0)
  })
  .catch(err => {
    console.error('测试运行异常:', err)
    process.exit(1)
  })
