import { initScrapeDb, saveScrapedResults, logScrape } from './db.js'

const QUERIES = [
  'rice', 'dhal', 'coconut', 'milk', 'eggs', 'tea', 'bread', 'sugar',
  'snacks', 'noodles', 'chocolate', 'drinks', 'biscuits', 'oil', 'soap', 'shampoo',
  'dilmah', 'nestle', 'unilever', 'maggi', 'prima', 'elephant house',
  'fruits', 'vegetables', 'chicken', 'fish', 'yogurt', 'cheese', 'butter', 'juice',
  'water', 'salt', 'flour', 'pasta', 'sauce', 'spices', 'curry', 'rice flour',
  'milk powder', 'tinned fish', 'jam', 'honey', 'cereal', 'ice cream',
  'yogurt drink', 'toothpaste', 'detergent', 'tissue', 'light bulb',
]

const CONCURRENCY = 3

async function scrapeOne(store, query, opts = {}) {
  const start = Date.now()
  try {
    const result = await store.fn(query, { limit: 20, ...opts })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.results.length > 0) {
      await saveScrapedResults(store.name, query, result)
      await logScrape(store.name, query, 'success', result.results.length, `${elapsed}s`)
      console.log(`  ✓ ${store.name} "${query}": ${result.results.length} items (${elapsed}s)`)
    } else {
      await logScrape(store.name, query, 'empty', 0, `${elapsed}s`)
      console.log(`  - ${store.name} "${query}": 0 items (${elapsed}s)`)
    }
  } catch (e) {
    await logScrape(store.name, query, 'error', 0, e.message)
    console.error(`  ✗ ${store.name} "${query}": ${e.message}`)
  }
}

async function scrapeStoreBatch(store, queries, opts = {}) {
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const batch = queries.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(q => scrapeOne(store, q, opts)))
  }
}

const PLAYWRIGHT_STORES = ['keells', 'cargills']

async function main() {
  console.log('Initializing DB...')
  await initScrapeDb()
  console.log(`Starting scrape for ${QUERIES.length} queries\n`)

  const storeName = process.argv[2]
  if (storeName && !['gfc', 'keells', 'cargills'].includes(storeName)) {
    console.error(`Unknown store: ${storeName}. Options: gfc, keells, cargills`)
    process.exit(1)
  }

  const SCRAPER_NAMES = {
    gfc: 'scrapeGFC',
    keells: 'scrapeKeells',
    cargills: 'scrapeCargills',
  }

  const stores = storeName
    ? [{ name: storeName, fn: (await import(`./scrapers/${storeName}.js`))[SCRAPER_NAMES[storeName]] }]
    : [
        { name: 'gfc', fn: (await import('./scrapers/gfc.js')).scrapeGFC },
        { name: 'keells', fn: (await import('./scrapers/keells.js')).scrapeKeells },
        { name: 'cargills', fn: (await import('./scrapers/cargills.js')).scrapeCargills },
      ]

  const startAll = Date.now()

  for (const store of stores) {
    console.log(`\n--- ${store.name} ---`)
    if (PLAYWRIGHT_STORES.includes(store.name)) {
      const mod = await import(`./scrapers/${store.name}.js`)
      const browser = await mod.createBrowser()
      try {
        await scrapeStoreBatch(store, QUERIES, { browser })
      } finally {
        await browser.close()
      }
    } else {
      await scrapeStoreBatch(store, QUERIES)
    }
  }

  const totalTime = ((Date.now() - startAll) / 60).toFixed(1)
  console.log(`\nDone! Total time: ${totalTime} min`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})