const STEALTH_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
  window.chrome = { runtime: {} }
  const origQuery = window.navigator.permissions.query
  window.navigator.permissions.query = (params) => (
    params.name === 'notifications' ? Promise.resolve({ state: 'denied' }) : origQuery(params)
  )
}

async function findKeellsProducts(page) {
  const results = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="product"], [class*="Product"], [class*="item"], [class*="Item"], .product-item, .product-box')
    return Array.from(items).slice(0, 30).map(el => {
      const name = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], a[href*="product"], h3, h4, h5')?.textContent?.trim() || ''
      const priceEl = el.querySelector('[class*="price"], [class*="Price"], .amount')
      const priceText = priceEl?.textContent?.trim() || ''
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
      const image = el.querySelector('img')?.getAttribute('src') || ''
      const link = el.querySelector('a')?.getAttribute('href') || ''
      return { name, price, image, url: link.startsWith('http') ? link : `https://keellssuper.com${link}`, id: link.split('/').filter(Boolean).pop() || name }
    }).filter(p => p.name && p.price > 0)
  })
  return results
}

async function trySearchKeells(page, query) {
  const inputs = page.locator('input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i]')
  const count = await inputs.count()
  if (count === 0) return false

  for (let i = 0; i < count; i++) {
    try {
      await inputs.nth(i).click({ timeout: 5000 })
      await page.waitForTimeout(300)
      await inputs.nth(i).fill(query)
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      return true
    } catch { continue }
  }
  return false
}

export async function scrapeKeells(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' })
  await page.addInitScript(STEALTH_SCRIPT)

  try {
    await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    console.log(`  [keells] "${query}": page loaded, waiting for Cloudflare/React...`)
    await page.waitForTimeout(12000)

    const searched = await trySearchKeells(page, query)
    console.log(`  [keells] "${query}": search submitted=${searched}`)

    if (searched) await page.waitForTimeout(8000)
    else await page.waitForTimeout(4000)

    let products = await findKeellsProducts(page)
    console.log(`  [keells] "${query}": ${products.length} products`)

    if (products.length === 0 && searched) {
      await page.waitForTimeout(8000)
      products = await findKeellsProducts(page)
      console.log(`  [keells] "${query}": retry => ${products.length} products`)
    }

    return {
      results: products.slice(0, limit).map((p, i) => ({
        id: `keells:${p.id || i}`,
        originalId: String(p.id || i),
        name: p.name,
        store: 'keells',
        storeName: 'Keells',
        price: p.price,
        priceFormatted: `Rs ${p.price.toFixed(2)}`,
        currency: 'LKR',
        image: p.image,
        url: p.url,
        inStock: true,
        category: '',
        sku: '',
      })),
      total: Math.min(products.length, limit),
    }
  } finally {
    await page.close()
  }
}

export async function createBrowser() {
  const { chromium: pw } = await import('playwright')
  const browser = await pw.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  })
  return browser
}
