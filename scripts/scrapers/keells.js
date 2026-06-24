import { chromium } from 'playwright'

export async function scrapeKeells(query, opts = {}) {
  const limit = opts.limit || 20
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en',
  })
  const page = await context.newPage()

  try {
    await page.goto('https://keellssuper.com/', {
      waitUntil: 'networkidle',
      timeout: 35000,
    })

    await page.waitForTimeout(3000)

    const searchInput = page.locator('input[type="text"], input[placeholder*="search" i], input[placeholder*="Search" i], .search-input, [class*="search"] input')
    const count = await searchInput.count()

    if (count > 0) {
      const input = searchInput.first()
      await input.click()
      await input.fill(query)
      await page.waitForTimeout(2000)

      const submitBtn = page.locator('button[type="submit"], input[type="submit"], [class*="search"] button, .sb_search')
      if (await submitBtn.count() > 0) {
        await submitBtn.first().click()
        await page.waitForTimeout(4000)
      }
    }

    await page.waitForTimeout(2000)

    const products = await page.evaluate(() => {
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

    const results = products.slice(0, limit).map((p, i) => ({
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
    }))

    return { results, total: results.length }
  } catch (e) {
    throw new Error(`Keells scrape failed: ${e.message}`)
  } finally {
    await browser.close()
  }
}