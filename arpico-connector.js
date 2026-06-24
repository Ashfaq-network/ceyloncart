import { cleanName, formatPrice } from './utils.js'

const ARPICO_BASE = 'https://myarpico.com'

export async function searchArpico(query, opts = {}) {
  const limit = opts.limit || 20
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(
      `${ARPICO_BASE}/index.php?route=product/search&search=${encodeURIComponent(query)}&limit=${limit}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html, */*',
          'Referer': `${ARPICO_BASE}/`,
        },
      }
    )
    if (!res.ok) throw new Error(`Arpico error: ${res.status}`)
    const html = await res.text()
    return parseArpicoProducts(html)
  } finally {
    clearTimeout(timeout)
  }
}

export function parseArpicoProducts(html) {
  const results = []
  const blocks = html.split('<div class="product-thumb')
  for (let i = 1; i < blocks.length; i++) {
    try {
      const block = blocks[i]
      const nameMatch = block.match(/class="product-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)
      if (!nameMatch) continue
      const name = cleanName(nameMatch[1].trim())

      const priceMatch = block.match(/class="price-new"[^>]*>₨\s*([0-9,]+(?:\.[0-9]+)?)/)
      const priceStr = priceMatch ? priceMatch[1].replace(/,/g, '') : '0'
      const price = parseFloat(priceStr) || 0

      const imgMatch = block.match(/<img[^>]+src="([^"]+)"[^>]*>/)
      const image = imgMatch ? imgMatch[1] : ''

      const urlMatch = block.match(/<a href="([^"]+)"[^>]*>\s*<img[^>]+alt="[^"]*"/)
      const url = urlMatch ? urlMatch[1] : ''

      const idMatch = block.match(/product_id=(\d+)/)
      const id = idMatch ? idMatch[1] : `arpico:${i}`

      const stockMatch = block.match(/stock-info\s+in-stock/)
      const inStock = !!stockMatch

      const storeId = 'arpico'

      results.push({
        id: `${storeId}:${id}`,
        originalId: id,
        name,
        store: storeId,
        storeName: 'Arpico',
        price,
        priceFormatted: formatPrice(price),
        currency: 'LKR',
        image: image.startsWith('http') ? image : `${ARPICO_BASE}/${image.replace(/^\//, '')}`,
        url: url.startsWith('http') ? url : `${ARPICO_BASE}/${url.replace(/^\//, '')}`,
        inStock,
        category: '',
        sku: '',
      })
    } catch {}
  }
  return { results, total: results.length }
}
