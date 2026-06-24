import { createClient } from '@libsql/client'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_TTL = 6 * 60 * 60 * 1000

const dbUrl = process.env.TURSO_DB_URL || `file:${process.env.VERCEL ? join('/tmp', 'cache.db') : join(__dirname, 'cache.db')}`
let db
try {
  db = createClient({
    url: dbUrl,
    ...(process.env.TURSO_DB_TOKEN ? { authToken: process.env.TURSO_DB_TOKEN } : {}),
  })
} catch (e) {
  console.error('DB init error:', e.message)
  db = null
}

let ready = null

async function ensureReady() {
  if (ready) return ready
  ready = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS cached_searches (
      query TEXT NOT NULL,
      store_filter TEXT NOT NULL DEFAULT '',
      sort TEXT NOT NULL DEFAULT '',
      results TEXT NOT NULL,
      matched TEXT NOT NULL DEFAULT '[]',
      total INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      hits INTEGER DEFAULT 0,
      PRIMARY KEY (query, store_filter, sort)
    )`)
    await db.execute(`CREATE TABLE IF NOT EXISTS price_history (
      product_key TEXT NOT NULL,
      store TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'LKR',
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (product_key, recorded_at)
    )`)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_price_history_key ON price_history(product_key)`)
    await db.execute(`CREATE TABLE IF NOT EXISTS page_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      event_data TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    await db.execute(`CREATE TABLE IF NOT EXISTS cached_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    await db.execute(`CREATE TABLE IF NOT EXISTS scraped_data (
      store TEXT NOT NULL,
      query TEXT NOT NULL,
      data TEXT NOT NULL,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (store, query)
    )`)
  })()
  return ready
}

export function getDb() { return db }
export async function initDb() { await ensureReady() }

export async function getCachedSearch(query, stores, sort) {
  await ensureReady()
  const storeKey = Array.isArray(stores) ? [...stores].sort().join(',') : ''
  try {
    const row = await db.execute({
      sql: `SELECT * FROM cached_searches WHERE query = ? AND store_filter = ? AND sort = ? AND expires_at > datetime('now')`,
      args: [query, storeKey, sort || ''],
    }).then(r => r.rows[0])
    if (!row) return null
    await db.execute({
      sql: `UPDATE cached_searches SET hits = hits + 1 WHERE query = ? AND store_filter = ? AND sort = ?`,
      args: [query, storeKey, sort || ''],
    })
    return {
      results: JSON.parse(row.results),
      matched: JSON.parse(row.matched),
      total: row.total,
      query,
      stores: Array.isArray(stores) ? stores : [],
    }
  } catch (e) { return null }
}

export async function setCachedSearch(query, stores, sort, data) {
  await ensureReady()
  const storeKey = Array.isArray(stores) ? [...stores].sort().join(',') : ''
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + CACHE_TTL).toISOString()
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO cached_searches (query, store_filter, sort, results, matched, total, created_at, expires_at, hits)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        query, storeKey, sort || '',
        JSON.stringify(data.results || []),
        JSON.stringify(data.matched || []),
        data.total || 0, now, expires,
      ],
    })
  } catch (e) {}
}

export async function recordEvent(eventType, sessionId, data, ip, ua) {
  await ensureReady()
  try {
    await db.execute({
      sql: `INSERT INTO page_events (event_type, session_id, event_data, ip, user_agent) VALUES (?, ?, ?, ?, ?)`,
      args: [eventType, sessionId || '', data ? JSON.stringify(data) : '', ip || '', ua || ''],
    })
  } catch (e) {}
}

export async function getAnalyticsSummary() {
  await ensureReady()
  try {
    const [visits, searches, lists] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(DISTINCT session_id) as c FROM page_events WHERE event_type = 'visit'` }).then(r => r.rows[0]?.c || 0),
      db.execute({ sql: `SELECT COUNT(*) as c FROM page_events WHERE event_type = 'search'` }).then(r => r.rows[0]?.c || 0),
      db.execute({ sql: `SELECT COUNT(*) as c FROM page_events WHERE event_type = 'add_to_list'` }).then(r => r.rows[0]?.c || 0),
    ])
    const topQueries = await db.execute({
      sql: `SELECT json_extract(event_data, '$.query') as q, COUNT(*) as c
            FROM page_events WHERE event_type = 'search' AND event_data IS NOT NULL
            GROUP BY q ORDER BY c DESC LIMIT 10`,
    }).then(r => r.rows)
    const daily = await db.execute({
      sql: `SELECT date(created_at) as day, COUNT(*) as c
            FROM page_events WHERE created_at > datetime('now', '-14 days')
            GROUP BY day ORDER BY day ASC`,
    }).then(r => r.rows)
    return {
      totalVisits: visits,
      totalSearches: searches,
      totalListsCreated: lists,
      topQueries: topQueries || [],
      dailyEvents: daily || [],
    }
  } catch (e) { return {} }
}

const CAT_CACHE_TTL = 24 * 60 * 60 * 1000

export async function getCachedCategory(category) {
  await ensureReady()
  try {
    const row = await db.execute({
      sql: `SELECT value, updated_at FROM cached_data WHERE key = ?`,
      args: [`cat_${category}`],
    }).then(r => r.rows[0])
    if (!row) return null
    const age = Date.now() - new Date(row.updated_at + 'Z').getTime()
    if (age > CAT_CACHE_TTL) return null
    return JSON.parse(row.value)
  } catch { return null }
}

export async function setCachedCategory(category, data) {
  await ensureReady()
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO cached_data (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      args: [`cat_${category}`, JSON.stringify(data)],
    })
  } catch {}
}

export async function getCacheStats() {
  await ensureReady()
  try {
    const [total, active, totalHits] = await Promise.all([
      db.execute('SELECT COUNT(*) as c FROM cached_searches').then(r => r.rows[0]?.c || 0),
      db.execute(`SELECT COUNT(*) as c FROM cached_searches WHERE expires_at > datetime('now')`).then(r => r.rows[0]?.c || 0),
      db.execute('SELECT COALESCE(SUM(hits), 0) as c FROM cached_searches').then(r => r.rows[0]?.c || 0),
    ])
    return { total, active, totalHits }
  } catch (e) { return { total: 0, active: 0, totalHits: 0 } }
}
