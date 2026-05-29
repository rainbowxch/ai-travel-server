import { getDb } from './db.js'
import type { Itinerary } from './types.js'
import crypto from 'node:crypto'

export interface FavoriteRow {
  id: number
  user_id: string
  itinerary_json: string
  created_at: number
}

function fingerprint(itinerary: Itinerary): string {
  const raw = `${itinerary.meta.city}|${itinerary.meta.days}|${itinerary.meta.budgetTotal}|${itinerary.meta.summary}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

export function addFavorite(userId: string, itinerary: Itinerary): { id: number; existed: boolean } {
  const db = getDb()
  const fp = fingerprint(itinerary)
  const existing = db.prepare(
    `SELECT id FROM favorites WHERE user_id = ? AND fingerprint = ?`
  ).get(userId, fp) as { id: number } | undefined
  if (existing) return { id: existing.id, existed: true }

  const result = db.prepare(`
    INSERT INTO favorites (user_id, itinerary_json, fingerprint, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, JSON.stringify(itinerary), fp, Date.now())
  return { id: result.lastInsertRowid as number, existed: false }
}

export function getFavorites(userId: string): FavoriteRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, user_id, itinerary_json, created_at
    FROM favorites
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as FavoriteRow[]
}

export function removeFavorite(id: number, userId: string): boolean {
  const db = getDb()
  const result = db.prepare(
    `DELETE FROM favorites WHERE id = ? AND user_id = ?`
  ).run(id, userId)
  return result.changes > 0
}
