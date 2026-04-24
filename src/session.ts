import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

interface SessionEntry {
  role: 'human' | 'ai' | 'system'
  content: string
  ts: number
}

interface SessionData {
  id: string
  messages: SessionEntry[]
  summary?: string
  createdAt: number
  updatedAt: number
}

const sessions = new Map<string, SessionData>()
const MAX_VISIBLE_MSGS = 12

function getFilePath(sessionId: string): string {
  return path.join(config.storageDir, 'sessions', `${sessionId}.json`)
}

function loadFromDisk(sessionId: string): SessionData | null {
  const file = getFilePath(sessionId)
  if (!fs.existsSync(file)) return null
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

function saveToDisk(session: SessionData) {
  const file = getFilePath(session.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(session, null, 2))
}

export function getOrCreateSession(sessionId: string): SessionData {
  let session = sessions.get(sessionId)
  if (!session) {
    const disk = loadFromDisk(sessionId)
    if (disk) {
      session = disk
    } else {
      session = { id: sessionId, messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    }
    sessions.set(sessionId, session)
  }
  return session
}

export function updateSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (session) {
    session.updatedAt = Date.now()
    saveToDisk(session)
  }
}

/**
 * Build input history for LangChain agent.
 * When the message count exceeds MAX_VISIBLE_MSGS,
 * older messages are replaced with a summary system message.
 */
export function buildChatHistory(session: SessionData) {
  const msgs = session.messages
  if (msgs.length <= MAX_VISIBLE_MSGS) {
    return msgs.map(m => ({ role: m.role, content: m.content }))
  }

  // Keep the last (MAX_VISIBLE_MSGS - 1) messages + summary
  const keep = msgs.slice(-(MAX_VISIBLE_MSGS - 1))
  const summaryText = generateSummary(msgs.slice(0, -keep.length))

  return [
    { role: 'system' as const, content: `以下为此前对话摘要（仅保留规划关键信息）：\n${summaryText}` },
    ...keep.map(m => ({ role: m.role, content: m.content })),
  ]
}

function generateSummary(msgs: SessionEntry[]): string {
  // Simple string-based extraction (same logic as the Vue project's buildSmartSummary)
  const lines: string[] = []
  for (const m of msgs) {
    if (lines.length >= 40) break
    if (m.role === 'human') {
      lines.push(`用户: ${m.content}`)
    } else if (m.content && !m.content.startsWith('{')) {
      const firstLine = m.content.split('\n')[0]!
      const text = firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine
      lines.push(`→ ${text}`)
    }
  }
  return lines.join('\n')
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId)
  const file = getFilePath(sessionId)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}
