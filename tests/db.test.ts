import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

/**
 * DB regression tests using an isolated in-memory database.
 *
 * Covers: table creation, user CRUD, message CRUD, message limit enforcement.
 */

let db: Database.Database

function initTestDb() {
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account TEXT UNIQUE,
      email TEXT,
      name TEXT,
      password_hash TEXT,
      email_verified INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('human', 'ai', 'system')),
      content TEXT NOT NULL,
      itinerary_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user
      ON messages(user_id, created_at);
  `)
  return db
}

beforeAll(() => {
  initTestDb()
})

beforeEach(() => {
  // Clear tables between tests
  db.exec('DELETE FROM messages; DELETE FROM users;')
})

function createUser(id = 'u_test', account = 'test@test.com', hash = 'hash123', name = '测试') {
  db.prepare(`
    INSERT INTO users (id, account, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, account, name, hash, Date.now())
}

function insertMessage(userId: string, role: string, content: string, itineraryJson?: string | null, maxMessages = 30) {
  db.prepare(`
    INSERT INTO messages (user_id, role, content, itinerary_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, role, content, itineraryJson ?? null, Date.now())

  // Mirror the production logic: keep only latest N messages
  db.prepare(`
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    )
  `).run(userId, maxMessages)
}

describe('DB: table creation', () => {
  it('should have users table with correct schema', () => {
    const cols = db.prepare('PRAGMA table_info(users)').all() as any[]
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('account')
    expect(names).toContain('password_hash')
    expect(names).toContain('created_at')
  })

  it('should have messages table with foreign key', () => {
    const cols = db.prepare('PRAGMA table_info(messages)').all() as any[]
    const names = cols.map(c => c.name)
    expect(names).toContain('user_id')
    expect(names).toContain('role')
    expect(names).toContain('content')
  })
})

describe('DB: users', () => {
  it('should create and retrieve a user', () => {
    createUser('u1', 'alice@test.com', 'hash1', 'Alice')
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as any
    expect(user).toBeDefined()
    expect(user.account).toBe('alice@test.com')
    expect(user.name).toBe('Alice')
    expect(user.password_hash).toBe('hash1')
  })

  it('should find user by account', () => {
    createUser('u2', 'bob@test.com', 'hash2')
    const user = db.prepare('SELECT * FROM users WHERE account = ?').get('bob@test.com') as any
    expect(user).toBeDefined()
    expect(user.id).toBe('u2')
  })

  it('should return undefined for nonexistent account', () => {
    const user = db.prepare('SELECT * FROM users WHERE account = ?').get('nobody') as any
    expect(user).toBeUndefined()
  })

  it('should enforce unique account constraint', () => {
    createUser('u3', 'dup@test.com', 'hash3')
    expect(() => {
      db.prepare('INSERT INTO users (id, account, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run('u4', 'dup@test.com', 'hash4', Date.now())
    }).toThrow()
  })
})

describe('DB: messages', () => {
  it('should insert and retrieve messages for a user', () => {
    createUser('u_msg', 'msg@test.com', 'hash')
    insertMessage('u_msg', 'human', 'Hello')
    insertMessage('u_msg', 'ai', 'Hi there!')

    const rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all('u_msg') as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0].role).toBe('human')
    expect(rows[0].content).toBe('Hello')
    expect(rows[1].role).toBe('ai')
    expect(rows[1].content).toBe('Hi there!')
  })

  it('should store itinerary_json', () => {
    createUser('u_it', 'it@test.com', 'hash')
    const it = JSON.stringify({ meta: { city: '杭州' }, days: [] })
    insertMessage('u_it', 'ai', '行程', it)

    const row = db.prepare('SELECT * FROM messages WHERE user_id = ?').get('u_it') as any
    expect(row.itinerary_json).toBe(it)
  })

  it('should enforce role CHECK constraint', () => {
    createUser('u_role', 'role@test.com', 'hash')
    expect(() => {
      db.prepare('INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)')
        .run('u_role', 'invalid_role', 'test', Date.now())
    }).toThrow()
  })

  it('should cascade delete messages when user is deleted', () => {
    createUser('u_del', 'del@test.com', 'hash')
    insertMessage('u_del', 'human', 'msg1')
    db.prepare('DELETE FROM users WHERE id = ?').run('u_del')

    const rows = db.prepare('SELECT * FROM messages WHERE user_id = ?').all('u_del') as any[]
    expect(rows).toHaveLength(0)
  })
})

describe('DB: message limit enforcement', () => {
  it('should keep only the latest N messages per user', () => {
    const MAX = 5
    createUser('u_limit', 'limit@test.com', 'hash')

    for (let i = 0; i < 10; i++) {
      insertMessage('u_limit', 'human', `msg${i}`, null, MAX)
    }

    const rows = db.prepare('SELECT content FROM messages WHERE user_id = ? ORDER BY created_at ASC').all('u_limit') as any[]
    expect(rows).toHaveLength(MAX)
    // The last MAX messages should remain
    expect(rows[0].content).toBe('msg5')
    expect(rows[MAX - 1].content).toBe('msg9')
  })

  it('should not delete messages when under limit', () => {
    createUser('u_under', 'under@test.com', 'hash')
    for (let i = 0; i < 3; i++) {
      insertMessage('u_under', 'human', `msg${i}`)
    }

    const rows = db.prepare('SELECT * FROM messages WHERE user_id = ?').all('u_under') as any[]
    expect(rows).toHaveLength(3)
  })
})

describe('DB: delete user messages', () => {
  it('should delete all messages for a user but not other users', () => {
    createUser('u_a', 'a@test.com', 'hash')
    createUser('u_b', 'b@test.com', 'hash')
    insertMessage('u_a', 'human', 'A msg')
    insertMessage('u_b', 'human', 'B msg')

    db.prepare('DELETE FROM messages WHERE user_id = ?').run('u_a')

    const aMsgs = db.prepare('SELECT * FROM messages WHERE user_id = ?').all('u_a') as any[]
    const bMsgs = db.prepare('SELECT * FROM messages WHERE user_id = ?').all('u_b') as any[]
    expect(aMsgs).toHaveLength(0)
    expect(bMsgs).toHaveLength(1)
  })
})
