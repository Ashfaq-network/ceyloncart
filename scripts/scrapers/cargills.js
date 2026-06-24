async function trySearchCargills(page, query) {
  const searchInput = page.locator('#txtSearch')
  const count = await searchInput.count()
  if (count === 0) return false

  await searchInput.first().click()
  await searchInput.first().fill(query)
  await page.waitForTimeout(500)
  const btn = page.locator('#btnSearch')
  if (await btn.count() > 0) {
    await btn.first().click()
  } else {
    await page.keyboard.press('Enter')
  }
  return true
}

async function extractProducts(page) {
  return await page.evaluate(() => {
    const items = new Map()
    const selectors = [
      '[ng-repeat*="product in DS.Data"]',
      '.cargillProdNeed',
      '.prdSH',
      '[class*="pro-"]',
      '.cargillProdNeedImg1',
    ]
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const nameEl = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], [class*="ItemName"], h3, h4, h5, p.lH22, p[class*="name"]')
        const name = nameEl?.textContent?.trim() || ''
        const priceEl = el.querySelector('[class*="price"], [class*="Price"], .offer-price, .regular-price, [class*="offer"]')
        const priceText = priceEl?.textContent?.trim() || ''
        const price = parseFloat(priceText.replace(/[^0-9.]/g, '').replace(/,/g, '')) || 0
        const img = el.querySelector('img')
        const image = img?.getAttribute('src') || img?.getAttribute('ng-src') || ''
        const link = el.querySelector('a')?.getAttribute('href') || ''
        const url = link.startsWith('http') ? link : `https://cargillsonline.com${link}`
        const key = name.replace(/\s+/g, '').toLowerCase()
        if (name && price > 0 && !name.includes('{{')) {
          items.set(key, { name, price, image, url, id: key })
        }
      }
    }
    return Array.from(items.values())
  })
}

export async function scrapeCargills(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  const q = encodeURIComponent(query)

  try {
    const searchUrl = `https://cargillsonline.com/Product/Search?q=${q}`
    console.log(`  [cargills] "${query}": loading search URL...`)
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(3000)

    let products = await extractProducts(page)
    const cleaned = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    console.log(`  [cargills] "${query}": ${products.length} total, ${cleaned.length} matching`)

    if (products.length > 0) {
      return {
        results: cleaned.slice(0, limit).map((p, i) => ({
          id: `cargills:${p.id || i}`,
          originalId: String(p.id || i),
          name: p.name,
          store: 'cargills',
          storeName: 'Cargills',
          price: p.price,
          priceFormatted: `Rs ${p.price.toFixed(2)}`,
          currency: 'LKR',
          image: p.image,
          url: p.url,
          inStock: true,
          category: '',
          sku: '',
        })),
        total: Math.min(cleaned.length, limit),
      }
    }

    console.log(`  [cargills] "${query}": trying homepage instead...`)
    await page.goto('https://cargillsonline.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(6000)

    const searched = await trySearchCargills(page, query)
    console.log(`  [cargills] "${query}": search submitted=${searched}`)

    if (searched) await page.waitForTimeout(7000)
    else await page.waitForTimeout(4000)

    let results2 = await extractProducts(page)
    console.log(`  [cargills] "${query}": homepage search => ${results2.length} products`)

    if (results2.length === 0) {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(12000)
      results2 = await extractProducts(page)
      console.log(`  [cargills] "${query}": retry search URL => ${results2.length} products`)
    }

    const finalProducts = results2.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))

    return {
      results: finalProducts.slice(0, limit).map((p, i) => ({
        id: `cargills:${p.id || i}`,
        originalId: String(p.id || i),
        name: p.name,
        store: 'cargills',
        storeName: 'Cargills',
        price: p.price,
        priceFormatted: `Rs ${p.price.toFixed(2)}`,
        currency: 'LKR',
        image: p.image,
        url: p.url,
        inStock: true,
        category: '',
        sku: '',
      })),
      total: Math.min(finalProducts.length, limit),
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
