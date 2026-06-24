import { initScrapeDb, saveScrapedResults, logScrape } from './db.js'

const QUERIES = [
  'rice', 'dhal', 'coconut', 'milk', 'eggs', 'tea', 'bread', 'sugar',
  'snacks', 'noodles', 'chocolate', 'drinks', 'biscuits', 'oil', 'soap', 'shampoo',
  'dilmah', 'nestle', 'unilever', 'maggi', 'prima', 'elephant house',
  'fruits', 'vegetables', 'chicken', 'fish', 'yogurt', 'cheese', 'butter', 'juice',
  'water', 'salt', 'flour', 'pasta', 'sauce', 'spices', 'curry', 'rice flour',
  'sugar', 'milk powder', 'tinned fish', 'jam', 'honey', 'cereal', 'ice cream',
  'yogurt drink', 'toothpaste', 'soap', 'detergent', 'tissue', 'light bulb',
]

async function scrapeStore(name, scraperFn, query) {
  const start = Date.now()
  try {
    const result = await scraperFn(query, { limit: 20 })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.results.length > 0) {
      await saveScrapedResults(name, query, result)
      await logScrape(name, query, 'success', result.results.length, `${elapsed}s`)
      console.log(`  ✓ ${name} "${query}": ${result.results.length} items (${elapsed}s)`)
    } else {
      await logScrape(name, query, 'empty', 0, `${elapsed}s`)
      console.log(`  - ${name} "${query}": 0 items (${elapsed}s)`)
    }
  } catch (e) {
    await logScrape(name, query, 'error', 0, e.message)
    console.error(`  ✗ ${name} "${query}": ${e.message}`)
  }
}

async function main() {
  console.log('Initializing DB...')
  await initScrapeDb()
  console.log(`Starting scrape for ${QUERIES.length} queries across 3 stores...\n`)

  const storeName = process.argv[2]
  if (storeName && !['gfc', 'keells', 'cargills'].includes(storeName)) {
    console.error(`Unknown store: ${storeName}. Options: gfc, keells, cargills`)
    process.exit(1)
  }

  const stores = storeName
    ? [{ name: storeName, fn: (await import(`./scrapers/${storeName}.js`))[`scrape${storeName.charAt(0).toUpperCase() + storeName.slice(1)}`] }]
    : [
        { name: 'gfc', fn: (await import('./scrapers/gfc.js')).scrapeGFC },
        { name: 'keells', fn: (await import('./scrapers/keells.js')).scrapeKeells },
        { name: 'cargills', fn: (await import('./scrapers/cargills.js')).scrapeCargills },
      ]

  const startAll = Date.now()

  for (const store of stores) {
    console.log(`\n--- ${store.name} ---`)
    for (const q of QUERIES) {
      await scrapeStore(store.name, store.fn, q)
    }
  }

  const totalTime = ((Date.now() - startAll) / 60).toFixed(1)
  console.log(`\nDone! Total time: ${totalTime} min`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})