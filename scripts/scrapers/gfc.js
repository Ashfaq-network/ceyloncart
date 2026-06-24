const GFC_BASE = 'https://globalfoodcity.com/wp-json/wc/store/v1'

export async function scrapeGFC(query, opts = {}) {
  const limit = opts.limit || 30
  const params = new URLSearchParams({ search: query, per_page: String(limit) })

  const res = await fetch(`${GFC_BASE}/products?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://globalfoodcity.com/',
    },
  })

  if (!res.ok) throw new Error(`GFC API error: ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('GFC: unexpected response format')

  const results = data.map(p => ({
    id: `gfc:${p.id}`,
    originalId: String(p.id),
    name: p.name || '',
    store: 'gfc',
    storeName: 'Global Food City',
    price: (parseInt(p.prices?.price) || 0) / 100,
    priceFormatted: `Rs ${((parseInt(p.prices?.price) || 0) / 100).toFixed(2)}`,
    currency: 'LKR',
    image: p.images?.[0]?.src || '',
    url: p.permalink || '',
    inStock: p.is_in_stock !== false,
    category: (p.categories || []).map(c => c.name).join(', '),
    sku: p.sku || '',
  }))

  return { results, total: results.length }
}