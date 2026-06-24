import { createClient } from '@libsql/client'

const dbUrl = process.env.TURSO_DB_URL
const dbToken = process.env.TURSO_DB_TOKEN

let db
try {
  db = createClient({
    url: dbUrl || 'file:./scrape-cache.db',
    ...(dbToken ? { authToken: dbToken } : {}),
  })
} catch (e) {
  console.error('DB init:', e.message)
  process.exit(1)
}

async function initScrapeDb() {
  await db.execute(`CREATE TABLE IF NOT EXISTS scraped_data (
    store TEXT NOT NULL,
    query TEXT NOT NULL,
    data TEXT NOT NULL,
    scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (store, query)
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT NOT NULL,
    query TEXT,
    status TEXT NOT NULL,
    items INTEGER DEFAULT 0,
    message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}

export async function saveScrapedResults(store, query, results) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO scraped_data (store, query, data, scraped_at)
      VALUES (?, ?, ?, datetime('now'))`,
    args: [store, query.toLowerCase().trim(), JSON.stringify(results)],
  })
}

export async function logScrape(store, query, status, items, message) {
  await db.execute({
    sql: `INSERT INTO scrape_log (store, query, status, items, message) VALUES (?, ?, ?, ?, ?)`,
    args: [store, query || null, status, items || 0, message || null],
  })
}

export { db }
export { initScrapeDb }