import { chromium } from 'playwright'

function extractProducts(page) {
  return page.evaluate(() => {
    const selectors = [
      '.cargillProdNeedImg1',
      '[class*="pro-"]',
      '[class*="product"]',
      '.item-box',
      '.prdSH',
    ]
    const all = new Set()
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.querySelector('img[src*="ItemImages"], img[src*="Product"], img[src*="vendor"], img[src*="cargills"]') || el.querySelector('[class*="price"], [class*="Price"]')) {
          all.add(el)
        }
      }
    }

    return Array.from(all).slice(0, 30).map(el => {
      const nameEl = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], h3, h4, h5, a[href*="product"], [class*="ItemName"], p[class*="name"]')
      const name = nameEl?.textContent?.trim() || el.getAttribute('title') || ''

      const priceEl = el.querySelector('[class*="price"], [class*="Price"], .offer-price, .regular-price, [class*="offer"], [class*="sale"]')
      const priceText = priceEl?.textContent?.trim() || ''
      const price = parseFloat(priceText.replace(/[^0-9.]/g, '').replace(/,/g, '')) || 0

      const img = el.querySelector('img')
      const image = img?.getAttribute('src') || img?.getAttribute('ng-src') || ''

      const link = el.querySelector('a')?.getAttribute('href') || ''
      const url = link.startsWith('http') ? link : `https://cargillsonline.com${link}`

      return { name, price, image, url, id: name || url }
    }).filter(p => p.name && p.price > 0)
  })
}

export async function scrapeCargills(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = opts.browser
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  try {
    await page.goto('https://cargillsonline.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(4000)

    const searchInput = page.locator('#txtSearch, input[type="text"][placeholder*="Search"], input.sb_input')
    if (await searchInput.count() > 0) {
      await searchInput.first().click()
      await searchInput.first().fill(query)
      await page.waitForTimeout(1000)

      const searchBtn = page.locator('#btnSearch, .sb_search, input[value=""][type="submit"]')
      if (await searchBtn.count() > 0) {
        await searchBtn.first().click()
      } else {
        await page.keyboard.press('Enter')
      }
      await page.waitForTimeout(5000)
    }

    let products = await extractProducts(page)
    if (products.length === 0) {
      await page.waitForTimeout(7000)
      products = await extractProducts(page)
    }
    if (products.length === 0) {
      const searchUrl = `https://cargillsonline.com/Product/Search?q=${encodeURIComponent(query)}`
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(8000)
      products = await extractProducts(page)
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
