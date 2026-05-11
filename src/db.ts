import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { config } from './config.js'

const DB_PATH = path.join(config.storageDir, 'travel.db')
const MAX_MESSAGES = 30

let db: Database.Database

export function initDb(): Database.Database {
  fs.mkdirSync(config.storageDir, { recursive: true })

  db = new Database(DB_PATH)
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

    CREATE TABLE IF NOT EXISTS travel_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      historical_summary TEXT,
      last_itinerary_json TEXT,
      ask_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      itinerary_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user
      ON favorites(user_id, created_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_fp
      ON favorites(user_id, fingerprint);
  `)

  // Migration: add columns for existing databases
  for (const sql of [
    'ALTER TABLE users ADD COLUMN password_hash TEXT',
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN account TEXT',
  ]) {
    try { db.exec(sql) } catch { /* column may already exist */ }
  }

  return db
}

export function getDb(): Database.Database {
  return db
}

/* ── Users ── */

export interface UserRow {
  id: string
  account: string | null
  email: string | null
  name: string | null
  password_hash: string | null
  email_verified: number
  created_at: number
}

export function getUserByAccount(account: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE account = ?`).get(account) as UserRow | undefined
}

export function createUser(id: string, account: string, passwordHash: string, name?: string): void {
  db.prepare(`
    INSERT INTO users (id, account, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, account, name ?? null, passwordHash, Date.now())
}

export function upsertUser(id: string, email?: string, name?: string): void {
  db.prepare(`
    INSERT INTO users (id, email, name, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = COALESCE(NULLIF(?, ''), users.email),
      name = COALESCE(NULLIF(?, ''), users.name)
  `).run(id, email ?? null, name ?? null, Date.now(), email ?? null, name ?? null)
}

export function getUser(id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
}

/* ── Messages ── */

export interface MessageRow {
  id: number
  user_id: string
  role: string
  content: string
  itinerary_json: string | null
  created_at: number
}

export function insertMessage(
  userId: string,
  role: string,
  content: string,
  itineraryJson?: string | null,
): void {
  db.prepare(`
    INSERT INTO messages (user_id, role, content, itinerary_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, role, content, itineraryJson ?? null, Date.now())

  // Keep only the latest MAX_MESSAGES per user
  db.prepare(`
    DELETE FROM messages
    WHERE id IN (
      SELECT id FROM messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    )
  `).run(userId, MAX_MESSAGES)
}

export function getMessages(userId: string): MessageRow[] {
  return db.prepare(`
    SELECT id, user_id, role, content, itinerary_json, created_at
    FROM messages
    WHERE user_id = ?
    ORDER BY created_at ASC
  `).all(userId) as MessageRow[]
}

export function deleteUserMessages(userId: string): void {
  db.prepare(`DELETE FROM messages WHERE user_id = ?`).run(userId)
}
