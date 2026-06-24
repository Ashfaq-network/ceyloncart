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

export async function scrapeKeells(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  await page.addInitScript(STEALTH_SCRIPT)

  const allApiResponses = []
  page.on('response', async (resp) => {
    const url = resp.url()
    if (url.includes('zebraliveback') || url.includes('api/search') || url.includes('api/product') || url.includes('product/search')) {
      try {
        const json = await resp.json()
        allApiResponses.push({ url, data: json })
      } catch {}
    }
  })

  try {
    console.log(`  [keells] "${query}": loading...`)
    await page.goto('https://keellssuper.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    console.log(`  [keells] "${query}": page loaded, waiting for Cloudflare/React...`)
    await page.waitForTimeout(15000)

    // Try submitting search via DOM
    const inputs = page.locator('input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i]')
    const count = await inputs.count()
    console.log(`  [keells] "${query}": ${count} inputs found`)
    let searched = false
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        try {
          await inputs.nth(i).click({ timeout: 5000 })
          await page.waitForTimeout(300)
          await inputs.nth(i).fill(query)
          await page.waitForTimeout(500)
          await page.keyboard.press('Enter')
          searched = true
          console.log(`  [keells] "${query}": submitted via input #${i}`)
          break
        } catch { continue }
      }
    }

    await page.waitForTimeout(8000)

    // Try direct React state manipulation too
    if (!searched) {
      const injected = await page.evaluate((q) => {
        const inputs = document.querySelectorAll('input')
        for (const inp of inputs) {
          if (inp.type === 'text' || !inp.type) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
            nativeInputValueSetter.call(inp, q)
            inp.dispatchEvent(new Event('input', { bubbles: true }))
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            return true
          }
        }
        return false
      }, query)
      console.log(`  [keells] "${query}": injected=${injected}`)
      await page.waitForTimeout(8000)
    }

    console.log(`  [keells] "${query}": ${allApiResponses.length} API responses captured`)

    // Parse products from captured API responses
    let products = []
    for (const { url, data } of allApiResponses) {
      console.log(`  [keells] "${query}": API ${url} -> type=${typeof data}`)
      const items = extractProductsFromResponse(data, query)
      if (items.length > 0) {
        console.log(`  [keells] "${query}": found ${items.length} in ${url}`)
        products = items
        break
      }
    }

    // Fallback: try DOM extraction
    if (products.length === 0) {
      console.log(`  [keells] "${query}": falling back to DOM extraction`)
      products = await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="product"], [class*="Product"], [class*="item"], [class*="Item"]')
        return Array.from(items).slice(0, 30).map(el => {
          const name = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], a[href*="product"], h3, h4, h5')?.textContent?.trim() || ''
          const priceEl = el.querySelector('[class*="price"], [class*="Price"], .amount')
          const priceText = priceEl?.textContent?.trim() || ''
          const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
          const image = el.querySelector('img')?.getAttribute('src') || ''
          const link = el.querySelector('a')?.getAttribute('href') || ''
          return { name, price, image, url: link.startsWith('http') ? link : `https://keellssuper.com${link}`, id: link.split('/').filter(Boolean).pop() || name }
        }).filter(p => p.name && p.price > 0 && !p.name.includes('{{') && !p.name.includes('undefined'))
      })
      console.log(`  [keells] "${query}": DOM => ${products.length} products`)
    }

    return {
      results: products.slice(0, limit).map((p, i) => ({
        id: `keells:${p.id || i}`,
        originalId: String(p.id || i),
        name: p.name.replace(/\s+/g, ' ').trim(),
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

function extractProductsFromResponse(data, query) {
  const results = []
  const q = query.toLowerCase()
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
    } else {
      if (obj.name && obj.price) {
        const name = String(obj.name || '')
        const price = parseFloat(obj.price) || parseFloat(obj.sale_price) || parseFloat(obj.selling_price) || parseFloat(obj.unit_price) || 0
        if (name && price > 0 && !name.includes('{{') && !name.includes('undefined') && name.toLowerCase().includes(q)) {
          results.push({
            name: name,
            price: price,
            image: obj.image || obj.image_url || obj.img || obj.thumbnail || '',
            url: obj.url || obj.link || obj.product_url || '',
            id: String(obj.id || obj.product_id || obj.sku || name),
          })
        }
      }
      for (const val of Object.values(obj)) {
        if (typeof val === 'object') walk(val)
      }
    }
  }
  walk(data)
  return results
}

export async function createBrowser() {
  const { chromium: pw } = await import('playwright')
  const browser = await pw.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  })
  return browser
}
