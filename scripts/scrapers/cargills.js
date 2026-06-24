export async function scrapeCargills(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  const q = encodeURIComponent(query)

  const allApiResponses = []
  page.on('response', async (resp) => {
    const url = resp.url()
    if (url.includes('cargillsonline')) {
      try {
        const text = await resp.text()
        if (text.startsWith('[') || text.startsWith('{')) {
          try { allApiResponses.push({ url, data: JSON.parse(text) }) } catch {}
        }
      } catch {}
    }
  })

  try {
    console.log(`  [cargills] "${query}": loading search page...`)
    await page.goto(`https://cargillsonline.com/Product/Search?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    // Set hidden field + trigger Angular
    const injected = await page.evaluate((q) => {
      const el = document.getElementById('txtCatSearch')
      if (el) el.value = q
      const ctrlEl = document.querySelector('[ng-controller="productCtrl"]')
      if (ctrlEl && window.angular) {
        const scope = window.angular.element(ctrlEl).scope()
        if (scope && scope.getProductList) {
          scope.$apply(() => scope.getProductList('-1'))
          return 'angular_injected'
        }
        return 'angular_found_no_scope'
      }
      return window.angular ? 'no_ctrl' : 'no_angular'
    }, query)
    console.log(`  [cargills] "${query}": evaluate=${injected}`)

    await page.waitForTimeout(5000)

    console.log(`  [cargills] "${query}": ${allApiResponses.length} API responses captured`)
    for (const { url, data } of allApiResponses) {
      const items = Array.isArray(data) ? data.length : (data && data.Data ? data.Data.length : '?')
      console.log(`  [cargills] "${query}": API ${url.split('/').pop()} items=${items}`)
    }

    // Parse products from API responses
    let products = []
    for (const { url, data } of allApiResponses) {
      const items = extractCargillsItems(data, query)
      if (items.length > 0) {
        products = items
        break
      }
    }

    if (products.length === 0) {
      console.log(`  [cargills] "${query}": API extraction gave 0, trying DOM...`)
      await page.waitForTimeout(3000)
      products = await page.evaluate((q) => {
        const all = new Map()
        const items = document.querySelectorAll('[ng-repeat*="product in DS.Data"], [class*="pro-"], .cargillProdNeed, .prdSH, [class*="product"], [class*="Product"]')
        for (const el of items) {
          const nameEl = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], [class*="ItemName"], h3, h4, h5, p.lH22')
          const name = nameEl?.textContent?.trim() || ''
          const priceEl = el.querySelector('[class*="price"], [class*="Price"], .offer-price')
          const price = parseFloat((priceEl?.textContent?.trim() || '').replace(/[^0-9.]/g, '').replace(/,/g, '')) || 0
          const img = el.querySelector('img')
          const image = img?.getAttribute('src') || img?.getAttribute('ng-src') || ''
          const link = el.querySelector('a')?.getAttribute('href') || ''
          const url = link.startsWith('http') ? link : `https://cargillsonline.com${link}`
          const key = name.replace(/\s+/g, '').toLowerCase()
          if (name && price > 0 && !name.includes('{{')) {
            all.set(key, { name, price, image, url, id: key })
          }
        }
        return Array.from(all.values()).filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
      }, query)
      console.log(`  [cargills] "${query}": DOM => ${products.length}`)
    }

    return {
      results: products.slice(0, limit).map((p, i) => ({
        id: `cargills:${p.id || i}`,
        originalId: String(p.id || i),
        name: p.name.replace(/\s+/g, ' ').trim(),
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
      total: Math.min(products.length, limit),
    }
  } finally {
    await page.close()
  }
}

function extractCargillsItems(data, query) {
  const results = []
  const q = query.toLowerCase()
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
    } else {
      const itemName = obj.ItemName || obj.itemName || obj.Item_Name || obj.Name || obj.name || ''
      const price = parseFloat(obj.Price || obj.price || obj.UnitPrice || obj.SellingPrice || 0)
      if (itemName && price > 0 && !itemName.includes('{{') && itemName.toLowerCase().includes(q)) {
        results.push({
          name: itemName.replace(/\s+/g, ' ').trim(),
          price,
          image: obj.WebImage || obj.ImageUrl || obj.image || obj.Img || '',
          url: `https://cargillsonline.com/Product/Search?q=${encodeURIComponent(itemName)}`,
          id: String(obj.EnId || obj.ID || obj.Id || obj.id || itemName),
        })
      }
      // Also handle Data property (common in .NET APIs)
      if (obj.Data && Array.isArray(obj.Data)) {
        for (const sub of obj.Data) {
          const sn = sub.ItemName || sub.itemName || sub.Name || sub.name || ''
          const sp = parseFloat(sub.Price || sub.price || sub.UnitPrice || sub.SellingPrice || 0)
          if (sn && sp > 0 && !sn.includes('{{') && sn.toLowerCase().includes(q)) {
            results.push({
              name: sn.replace(/\s+/g, ' ').trim(),
              price: sp,
              image: sub.WebImage || sub.ImageUrl || sub.image || '',
              url: `https://cargillsonline.com/Product/Search?q=${encodeURIComponent(sn)}`,
              id: String(sub.EnId || sub.ID || sub.Id || sn),
            })
          }
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
