import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { getMessages, insertMessage } from './db.js'
import { config } from './config.js'

export interface SessionEntry {
  role: 'human' | 'ai' | 'system'
  content: string
  ts: number
  itinerary?: Record<string, unknown> | null
}

interface UserSession {
  userId: string
  messages: SessionEntry[]
  cachedSummary: string | null
  summarizedUpTo: number
}

const sessions = new Map<string, UserSession>()
const MAX_VISIBLE_MSGS = 6

export function getOrCreateSession(userId: string): UserSession {
  let session = sessions.get(userId)
  if (!session) {
    const dbMessages = getMessages(userId)
    const entries: SessionEntry[] = dbMessages.map(m => ({
      role: m.role as SessionEntry['role'],
      content: m.content,
      ts: m.created_at,
      itinerary: m.itinerary_json ? JSON.parse(m.itinerary_json) as Record<string, unknown> : null,
    }))

    session = { userId, messages: entries, cachedSummary: null, summarizedUpTo: 0 }
    sessions.set(userId, session)
  }
  return session
}

export function addMessage(
  userId: string,
  role: SessionEntry['role'],
  content: string,
  itinerary?: Record<string, unknown> | null,
) {
  const session = getOrCreateSession(userId)
  const entry: SessionEntry = { role, content, ts: Date.now(), itinerary }
  session.messages.push(entry)

  // Persist to database
  insertMessage(userId, role, content, itinerary ? JSON.stringify(itinerary) : null)
}

/**
 * Use LLM to summarize chat messages into a concise 3-5 sentence summary.
 * Supports incremental updates: pass existing summary + new messages.
 */
async function summarizeWithLLM(
  oldSummary: string | null,
  newMessages: SessionEntry[],
): Promise<string> {
  const llm = new ChatOpenAI({
    modelName: config.model,
    temperature: 0.2,
    configuration: {
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    },
  })

  const input = oldSummary
    ? `已有的摘要：\n${oldSummary}\n\n新增的对话：\n${formatMessages(newMessages)}`
    : formatMessages(newMessages)

  const result = await llm.invoke([
    new SystemMessage(
      '你是一个旅行规划助手的对话摘要器。请将以下旅行规划对话浓缩为 3-5 句中文摘要。' +
      '必须保留：目的地、天数、预算、出行人数、已确认的行程安排、关键偏好或限制条件。' +
      '忽略寒暄和确认性消息。如果提供了"已有的摘要"，请将其与新增对话合并生成一份最新的完整摘要。',
    ),
    new HumanMessage(input),
  ])

  const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  return text.slice(0, 500)
}

function formatMessages(msgs: SessionEntry[]): string {
  return msgs.map(m => {
    const role = m.role === 'human' ? '用户' : m.role === 'ai' ? '助手' : '系统'
    const content = m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content
    return `${role}: ${content}`
  }).join('\n---\n')
}

/**
 * Fallback: text truncation based summary when LLM is unavailable.
 */
function fallbackSummary(msgs: SessionEntry[]): string {
  const lines: string[] = []
  for (const m of msgs) {
    if (lines.length >= 10) break
    if (m.role === 'human') {
      const text = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content
      lines.push(`用户: ${text}`)
    } else if (m.content && !m.content.startsWith('{')) {
      const firstLine = m.content.split('\n')[0]!
      const text = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine
      lines.push(`→ ${text}`)
    }
  }
  return lines.join('\n')
}

/**
 * Build input history for LangChain agent.
 * When message count exceeds MAX_VISIBLE_MSGS, older messages are
 * summarized by LLM and cached. The cache is updated incrementally.
 */
export async function buildChatHistory(userId: string) {
  const session = getOrCreateSession(userId)
  const msgs = session.messages

  if (msgs.length <= MAX_VISIBLE_MSGS) {
    return msgs.map(m => ({ role: m.role, content: m.content }))
  }

  // Messages before splitIdx need to be summarized
  const splitIdx = msgs.length - (MAX_VISIBLE_MSGS - 1)

  // Regenerate summary if cache is stale
  if (session.summarizedUpTo < splitIdx) {
    const toSummarize = msgs.slice(session.summarizedUpTo, splitIdx)
    try {
      session.cachedSummary = await summarizeWithLLM(session.cachedSummary, toSummarize)
      session.summarizedUpTo = splitIdx
    } catch {
      // LLM failed — fall back to text truncation, rebuild from scratch
      session.cachedSummary = fallbackSummary(msgs.slice(0, splitIdx))
      session.summarizedUpTo = splitIdx
    }
  }

  const keep = msgs.slice(splitIdx)
  return [
    { role: 'system' as const, content: `以下为此前对话摘要（仅保留规划关键信息）：\n${session.cachedSummary}` },
    ...keep.map(m => ({ role: m.role, content: m.content })),
  ]
}

export function deleteSession(userId: string) {
  sessions.delete(userId)
}
