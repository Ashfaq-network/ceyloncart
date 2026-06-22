import { Database } from 'bun:sqlite'

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'cache.db')
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

let db

export function getDb() { return db }

export function initDb() {
  db = new Database(DB_PATH)
  db.run('PRAGMA journal_mode = WAL')
  db.run(`CREATE TABLE IF NOT EXISTS cached_searches (
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
  db.run(`CREATE TABLE IF NOT EXISTS crawl_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    queries INTEGER DEFAULT 0,
    products INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running'
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS price_history (
    product_key TEXT NOT NULL,
    store TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT DEFAULT 'LKR',
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (product_key, recorded_at)
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_key ON price_history(product_key)`)
  db.run(`CREATE TABLE IF NOT EXISTS page_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    session_id TEXT,
    event_data TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db
}

export function getCachedSearch(query, stores, sort) {
  if (!db) return null
  const storeKey = Array.isArray(stores) ? [...stores].sort().join(',') : ''
  const row = db.query(`SELECT * FROM cached_searches WHERE query = ? AND store_filter = ? AND sort = ? AND expires_at > datetime('now')`)
    .get(query, storeKey, sort || '')
  if (!row) return null
  db.run('UPDATE cached_searches SET hits = hits + 1 WHERE query = ? AND store_filter = ? AND sort = ?',
    query, storeKey, sort || '')
  return {
    results: JSON.parse(row.results),
    matched: JSON.parse(row.matched),
    total: row.total,
    query,
    stores: Array.isArray(stores) ? stores : [],
  }
}

export function setCachedSearch(query, stores, sort, data) {
  if (!db) return
  const storeKey = Array.isArray(stores) ? [...stores].sort().join(',') : ''
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + CACHE_TTL).toISOString()
  db.run(`INSERT OR REPLACE INTO cached_searches (query, store_filter, sort, results, matched, total, created_at, expires_at, hits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    query,
    storeKey,
    sort || '',
    JSON.stringify(data.results || []),
    JSON.stringify(data.matched || []),
    data.total || 0,
    now,
    expires,
  )
}

export function recordEvent(eventType, sessionId, data, ip, ua) {
  if (!db) return
  try {
    db.run(`INSERT INTO page_events (event_type, session_id, event_data, ip, user_agent) VALUES (?, ?, ?, ?, ?)`,
      eventType, sessionId || '', data ? JSON.stringify(data) : '', ip || '', ua || '')
  } catch (_) {}
}

export function getAnalyticsSummary() {
  if (!db) return {}
  try {
    const visits = db.query(`SELECT COUNT(DISTINCT session_id) as c FROM page_events WHERE event_type = 'visit'`).get()
    const searches = db.query(`SELECT COUNT(*) as c FROM page_events WHERE event_type = 'search'`).get()
    const lists = db.query(`SELECT COUNT(*) as c FROM page_events WHERE event_type = 'add_to_list'`).get()
    const topQueries = db.query(`
      SELECT json_extract(event_data, '$.query') as q, COUNT(*) as c
      FROM page_events WHERE event_type = 'search' AND event_data IS NOT NULL
      GROUP BY q ORDER BY c DESC LIMIT 10
    `).all()
    const daily = db.query(`
      SELECT date(created_at) as day, COUNT(*) as c
      FROM page_events WHERE created_at > datetime('now', '-14 days')
      GROUP BY day ORDER BY day ASC
    `).all()
    return {
      totalVisits: (visits && visits.c) || 0,
      totalSearches: (searches && searches.c) || 0,
      totalListsCreated: (lists && lists.c) || 0,
      topQueries: topQueries || [],
      dailyEvents: daily || [],
    }
  } catch (_) { return {} }
}

export function getCacheStats() {
  if (!db) return { total: 0, active: 0, totalHits: 0 }
  const total = db.query('SELECT COUNT(*) as c FROM cached_searches').get()
  const active = db.query(`SELECT COUNT(*) as c FROM cached_searches WHERE expires_at > datetime('now')`).get()
  const totalHits = db.query('SELECT COALESCE(SUM(hits), 0) as c FROM cached_searches').get()
  return { total: total.c, active: active.c, totalHits: totalHits.c }
}

export function closeDb() {
  if (db) db.close()
}
