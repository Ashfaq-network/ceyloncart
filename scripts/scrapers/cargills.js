import { chromium } from 'playwright'

export async function scrapeCargills(query, opts = {}) {
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
    await page.goto('https://cargillsonline.com/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.waitForTimeout(3000)

    const searchInput = page.locator('#txtSearch, input[type="text"][placeholder*="Search"], input.sb_input')
    const count = await searchInput.count()

    if (count > 0) {
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

    const products = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="product"], [class*="Product"], .pro-box, [class*="pro-"], .item-box, .product-item')
      return Array.from(items).slice(0, 30).map(el => {
        const name = el.querySelector('[class*="title"], [class*="name"], [class*="Name"], h3, h4, h5, a[href*="product"]')?.textContent?.trim() || ''
        const priceEl = el.querySelector('[class*="price"], [class*="Price"], .offer-price, .regular-price')
        const priceText = priceEl?.textContent?.trim() || ''
        const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0
        const image = el.querySelector('img')?.getAttribute('src') || ''
        const link = el.querySelector('a')?.getAttribute('href') || ''
        return { name, price, image, url: link.startsWith('http') ? link : `https://cargillsonline.com${link}`, id: name }
      }).filter(p => p.name && p.price > 0)
    })

    const results = products.slice(0, limit).map((p, i) => ({
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
    }))

    return { results, total: results.length }
  } catch (e) {
    throw new Error(`Cargills scrape failed: ${e.message}`)
  } finally {
    await browser.close()
  }
}