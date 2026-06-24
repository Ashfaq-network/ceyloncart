import { chromium } from 'playwright'

async function extractViaEval(page, query) {
  return await page.evaluate((q) => {
    const results = []

    const $ = window.jQuery
    if ($) {
      const existing = $('#txtCatSearch').val()
      if (existing !== q) {
        $('#txtCatSearch').val(q)
        const el = window.angular && window.angular.element(document.querySelector('[ng-controller="productCtrl"]'))
        if (el && el.scope && el.scope().getProductList) {
          el.scope().getProductList('-1')
          el.scope().$apply()
        }
      }
    }

    const selectors = [
      '.cargillProdNeedImg1', '[class*="pro-"]', '[class*="product"]',
      '.item-box', '.prdSH', '[ng-repeat*="product"]',
    ]
    const seen = new Set()
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const hasPrice = el.querySelector('[class*="price"], [class*="Price"], .offer-price')
        const hasImg = el.querySelector('img[src*="ItemImages"], img[src*="Product"]')
        if (hasPrice || hasImg || sel.includes('ng-repeat')) {
          const nameEl = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], h3, h4, h5, a[href*="product"], p[class*="name"], [class*="ItemName"]')
          let name = nameEl?.textContent?.trim() || el.getAttribute('title') || ''
          const priceEl = el.querySelector('[class*="price"], [class*="Price"], .offer-price, .regular-price, [class*="offer"], [class*="sale"]')
          const priceText = priceEl?.textContent?.trim() || ''
          const price = parseFloat(priceText.replace(/[^0-9.]/g, '').replace(/,/g, '')) || 0
          const img = el.querySelector('img')
          const image = img?.getAttribute('src') || img?.getAttribute('ng-src') || ''
          const link = el.querySelector('a')?.getAttribute('href') || ''
          const url = link.startsWith('http') ? link : `https://cargillsonline.com${link}`
          const key = name + price
          if (name && price > 0 && !seen.has(key) && !name.includes('{{')) {
            seen.add(key)
            results.push({ name, price, image, url, id: name })
          }
        }
      }
    }
    return results
  }, query)
}

export async function scrapeCargills(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  try {
    console.log(`  [cargills] Loading homepage for "${query}"...`)
    await page.goto('https://cargillsonline.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(5000)
    console.log(`  [cargills] Page title: ${await page.title()}`)

    const searchInput = page.locator('#txtSearch')
    if (await searchInput.count() > 0) {
      await searchInput.first().click()
      await searchInput.first().fill(query)
      await page.waitForTimeout(800)
      const btnCount = await page.locator('#btnSearch').count()
      if (btnCount > 0) {
        await page.locator('#btnSearch').first().click()
      } else {
        await page.keyboard.press('Enter')
      }
      await page.waitForTimeout(5000)
      console.log(`  [cargills] Search submitted`)
    } else {
      console.log(`  [cargills] Search input not found on homepage, trying search URL`)
      await page.goto(`https://cargillsonline.com/Product/Search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(8000)
    }

    let products = await extractViaEval(page, query)
    console.log(`  [cargills] Products found: ${products.length}`)

    if (products.length === 0) {
      await page.waitForTimeout(8000)
      products = await extractViaEval(page, query)
      console.log(`  [cargills] Products found (retry 1): ${products.length}`)
    }
    if (products.length === 0) {
      const searchUrl = `https://cargillsonline.com/Product/Search?q=${encodeURIComponent(query)}`
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(10000)
      products = await extractViaEval(page, query)
      console.log(`  [cargills] Products found (retry 2): ${products.length}`)
    }
    if (products.length === 0) {
      const bodyPreview = await page.evaluate(() => document.body.innerText.substring(0, 300))
      console.log(`  [cargills] Body preview: ${bodyPreview.replace(/\n/g, ' | ')}`)
    }

    return {
      results: products.slice(0, limit).map((p, i) => ({
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
