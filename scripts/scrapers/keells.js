import { chromium } from 'playwright'

export async function scrapeKeells(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  try {
    console.log(`  [keells] Loading homepage for "${query}"...`)
    await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(8000)

    console.log(`  [keells] Page title: ${await page.title()}`)
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, [contenteditable]')).slice(0, 10).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        placeholder: el.placeholder || '',
        id: el.id || '',
        cls: el.className || '',
      }))
    })
    console.log(`  [keells] Inputs found: ${JSON.stringify(inputs)}`)

    let searchPerformed = false
    const searchInput = page.locator('input[type="text"], input:not([type="hidden"]), [contenteditable="true"]')
    const count = await searchInput.count()
    console.log(`  [keells] Text inputs count: ${count}`)

    for (let i = 0; i < count; i++) {
      const el = searchInput.nth(i)
      const placeholder = await el.getAttribute('placeholder') || ''
      const id = await el.getAttribute('id') || ''
      const cls = await el.getAttribute('class') || ''
      const aria = await el.getAttribute('aria-label') || ''
      console.log(`  [keells] Input ${i}: placeholder="${placeholder}" id="${id}" class="${cls}" aria="${aria}"`)
    }

    if (count > 0) {
      await searchInput.first().click()
      await page.waitForTimeout(500)
      await searchInput.first().fill(query)
      await page.waitForTimeout(1000)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(6000)
      searchPerformed = true
      console.log(`  [keells] Search submitted for "${query}"`)
    }

    await page.waitForTimeout(3000)

    const products = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="product"], [class*="Product"], [class*="item"], [class*="Item"], .product-item, .product-box')
      const results = Array.from(items).slice(0, 30).map(el => {
        const name = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], a[href*="product"], h3, h4, h5')?.textContent?.trim() || ''
        const priceEl = el.querySelector('[class*="price"], [class*="Price"], .amount')
        const priceText = priceEl?.textContent?.trim() || ''
        const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
        const image = el.querySelector('img')?.getAttribute('src') || ''
        const link = el.querySelector('a')?.getAttribute('href') || ''
        return { name, price, image, url: link.startsWith('http') ? link : `https://keellssuper.com${link}`, id: link.split('/').filter(Boolean).pop() || name }
      }).filter(p => p.name && p.price > 0)
      return results
    })

    console.log(`  [keells] Products found: ${products.length}`)
    if (products.length === 0) {
      const bodyPreview = await page.evaluate(() => document.body.innerText.substring(0, 300))
      console.log(`  [keells] Body preview: ${bodyPreview.replace(/\n/g, ' | ')}`)
    }

    if (products.length === 0 && searchPerformed) {
      await page.waitForTimeout(6000)
      const products2 = await page.evaluate(() => {
        const items = document.querySelectorAll('a[href*="product"], [class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"]')
        return Array.from(items).slice(0, 30).map(el => {
          const name = el.getAttribute('title') || el.textContent?.trim() || ''
          const priceEl = el.querySelector('[class*="price"], [class*="Price"]')
          const priceText = priceEl?.textContent?.trim() || ''
          const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
          const image = el.querySelector('img')?.getAttribute('src') || ''
          return { name, price, image, url: el.getAttribute('href') || '', id: name }
        }).filter(p => p.name && p.price > 0)
      })
      console.log(`  [keells] Products found (retry): ${products2.length}`)
      return {
        results: products2.slice(0, limit).map((p, i) => ({
          id: `keells:${p.id || i}`,
          originalId: String(p.id || i),
          name: p.name,
          store: 'keells',
          storeName: 'Keells',
          price: p.price,
          priceFormatted: `Rs ${p.price.toFixed(2)}`,
          currency: 'LKR',
          image: p.image,
          url: p.url.startsWith('http') ? p.url : `https://keellssuper.com${p.url}`,
          inStock: true,
          category: '',
          sku: '',
        })),
        total: Math.min(products2.length, limit),
      }
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
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  })
  return browser
}
